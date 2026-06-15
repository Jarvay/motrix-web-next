//! Axum-based web server — state, lifecycle, and route tree.
//!
//! ## Architecture
//!
//! The server exposes two layers:
//!
//! **REST API** (`/api/*`) — JSON-based endpoints that wrap the existing
//! command functions. Handlers receive [`AppState`] via Axum's `State`
//! extractor, which is a plain `Arc`-based struct (no Tauri dependency).
//!
//! **SSE Events** (`/api/events`) — Server-Sent Events for real-time
//! updates (stat changes, task updates). Eliminates frequent polling.
//!
//! **Static files** (`/*`) — serves the Vite-built Vue.js frontend with
//! SPA fallback (all non-API, non-file requests return `index.html`).
//!
//! ## State
//!
//! [`AppState`] holds all shared resources. It mirrors the Tauri managed
//! state setup in `lib.rs`, but uses `Arc<…>` directly instead of
//! `tauri::State<…>`.

mod engine;
mod routes;

use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use crate::aria2::client::Aria2Client;
use crate::history::HistoryDb;
use crate::web::routes::events::{
    broadcast_stat_update, create_event_broadcast, SseEvent, StatUpdate,
};

use self::engine::WebEngineState;

/// Shared application state for the web server.
///
/// Uses `Arc` for all fields so each Axum handler can cheaply clone the
/// state it needs.  This matches how Tauri's `State<'_, T>` works under
/// the hood (it's an `Arc<T>` with a lifetime guard).
#[derive(Clone)]
pub struct AppState {
    /// Aria2 JSON-RPC client (shared with engine).
    pub aria2_client: Arc<Aria2Client>,

    /// History database connection.
    pub history_db: Arc<HistoryDb>,

    /// Engine process handle.
    pub engine: WebEngineState,

    /// Application data directory (stores config, session, etc.).
    pub data_dir: PathBuf,

    /// The port aria2 is configured to listen on.
    pub rpc_port: u16,

    /// SSE event broadcast sender for real-time updates.
    pub event_tx: tokio::sync::broadcast::Sender<SseEvent>,
}

/// Build the shared application state from scratch.
pub async fn build_state(data_dir: PathBuf, rpc_port: u16) -> AppState {
    // Open history database
    let db_path = data_dir.join("history.db");
    let history_db = HistoryDb::open(&db_path)
        .map_err(|e| log::error!("Failed to open history.db: {e}"))
        .unwrap_or_else(|_| {
            // Create a minimal in-memory fallback so the server still starts
            log::warn!("Using in-memory history (history.db was unavailable)");
            HistoryDb::open_in_memory()
                .unwrap_or_else(|e| panic!("Cannot open in-memory history: {e}"))
        });

    // Aria2 client with default credentials — credentials are updated
    // after engine start via the RPC probe.
    let aria2_client = Arc::new(Aria2Client::new(rpc_port, String::new()));

    AppState {
        aria2_client,
        history_db: Arc::new(history_db),
        engine: Arc::new(std::sync::Mutex::new(engine::EngineHandle::default())),
        data_dir,
        rpc_port,
        event_tx: create_event_broadcast(),
    }
}

/// Start the bundled aria2 engine and run the post-start readiness probe.
pub async fn start_engine(state: &AppState) -> Result<(), String> {
    log::info!("engine:starting bundled aria2 next");

    let mut system_config = load_system_config(&state.data_dir);

    // First run: inject default RPC settings into the config
    // so the engine binds correctly even without a pre-existing system.json.
    if system_config.get("rpc-listen-port").is_none() {
        system_config["rpc-listen-port"] = serde_json::Value::String(state.rpc_port.to_string());
    }
    if system_config.get("rpc-listen-all").is_none() {
        system_config["rpc-listen-all"] = serde_json::Value::Bool(true);
    }
    if system_config.get("rpc-allow-origin-all").is_none() {
        system_config["rpc-allow-origin-all"] = serde_json::Value::Bool(true);
    }

    engine::start_engine(
        &state.engine,
        &state.data_dir,
        state.rpc_port,
        &system_config,
    )?;

    // Sync Aria2Client credentials to match the engine's actual port.
    // The engine may use a different port than state.rpc_port if system.json
    // was populated by a previous Tauri or web session.
    let actual_port = system_config
        .get("rpc-listen-port")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(state.rpc_port);

    let actual_secret = system_config
        .get("rpc-secret")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    state
        .aria2_client
        .update_credentials(actual_port, actual_secret.to_string())
        .await;

    engine::wait_for_engine_ready(&state.aria2_client, 30).await
}

/// Load system.json config for engine startup.
fn load_system_config(data_dir: &std::path::Path) -> serde_json::Value {
    let path = data_dir.join("system.json");
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or(serde_json::json!({})),
        Err(_) => {
            log::debug!("No system.json at {} — using defaults", path.display());
            serde_json::json!({})
        }
    }
}

/// Build the full Axum router.
pub fn build_router(state: AppState, frontend_dir: PathBuf) -> Router {
    // ── CORS: allow the browser dev server ─────────────────────────
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // ── API routes ────────────────────────────────────────────────
    let api = Router::new()
        .merge(routes::tasks::routes())
        .merge(routes::history::routes())
        .merge(routes::config::routes())
        .merge(routes::engine::routes())
        .merge(routes::misc::routes())
        .merge(routes::files::routes())
        .merge(routes::events::routes())
        .with_state(state.clone());

    let api = api.layer(cors);

    // ── Static file serving with SPA fallback ─────────────────────
    // ServeDir serves actual files (JS, CSS, etc.).  Any non-file
    // request (e.g. /task/all) falls back to index.html so the Vue
    // router can handle client-side navigation.
    let index_path = frontend_dir.join("index.html");
    let serve_dir = ServeDir::new(&frontend_dir).fallback(ServeFile::new(index_path));

    Router::new().nest("/api", api).fallback_service(serve_dir)
}

/// Spawn a background task that polls aria2 stats and broadcasts via SSE.
///
/// Uses adaptive polling intervals matching the desktop stat service.
/// Detects changes in task counts and broadcasts `task:changed` to the
/// frontend so it can refresh the task list.
/// Returns a handle that can be used to abort the task on shutdown.
pub fn spawn_stat_polling(state: &AppState) -> tokio::task::JoinHandle<()> {
    let client = state.aria2_client.clone();
    let tx = state.event_tx.clone();

    tokio::spawn(async move {
        // Adaptive polling constants — aligned with `src/shared/timing.ts`
        const BASE_INTERVAL_MS: u64 = 500;
        const PER_TASK_INTERVAL_MS: u64 = 100;
        const MIN_INTERVAL_MS: u64 = 500;
        const MAX_INTERVAL_MS: u64 = 6000;
        const IDLE_INCREMENT_MS: u64 = 100;

        let mut current_interval = BASE_INTERVAL_MS;
        let mut last_num_active: Option<u64> = None;
        let mut last_num_stopped: Option<u64> = None;

        loop {
            // Poll aria2 global stat
            match client.get_global_stat().await {
                Ok(raw) => {
                    let download_speed = raw.download_speed.parse::<u64>().unwrap_or(0);
                    let upload_speed = raw.upload_speed.parse::<u64>().unwrap_or(0);
                    let num_active = raw.num_active.parse::<u64>().unwrap_or(0);
                    let num_waiting = raw.num_waiting.parse::<u64>().unwrap_or(0);
                    let num_stopped = raw.num_stopped.parse::<u64>().unwrap_or(0);
                    let num_stopped_total = raw.num_stopped_total.parse::<u64>().unwrap_or(0);

                    // If numActive or numStopped changed, notify frontend
                    // to refresh the task list (eliminates polling)
                    let count_changed = last_num_active != Some(num_active)
                        || last_num_stopped != Some(num_stopped);
                    if count_changed {
                        let _ = tx.send(SseEvent::TaskChanged);
                        last_num_active = Some(num_active);
                        last_num_stopped = Some(num_stopped);
                    }

                    broadcast_stat_update(
                        &tx,
                        StatUpdate {
                            download_speed,
                            upload_speed,
                            num_active,
                            num_waiting,
                            num_stopped,
                            num_stopped_total,
                        },
                    );

                    // Adaptive interval: faster when active, slower when idle
                    if num_active > 0 {
                        current_interval = BASE_INTERVAL_MS
                            .saturating_sub(PER_TASK_INTERVAL_MS * num_active)
                            .max(MIN_INTERVAL_MS);
                    } else {
                        current_interval =
                            (current_interval + IDLE_INCREMENT_MS).min(MAX_INTERVAL_MS);
                    }
                }
                Err(_) => {
                    // Engine may be restarting — increase interval to back off
                    current_interval = (current_interval + IDLE_INCREMENT_MS).min(MAX_INTERVAL_MS);
                }
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(current_interval)).await;
        }
    })
}
