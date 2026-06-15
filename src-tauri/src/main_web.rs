//! Web server binary entry point.
//!
//! Starts the Motrix Next engine and exposes a REST API + static file server
//! via Axum so the Vue.js frontend can run in the browser without Tauri.
//!
//! ## Environment variables
//!
//! | Variable | Default | Description |
//! |----------|---------|-------------|
//! | `PORT` | `22077` | HTTP listen port |
//! | `HOST` | `127.0.0.1` | Bind address |
//! | `DATA_DIR` | platform default | App data directory |
//! | `FRONTEND_DIR` | `../dist` | Static files to serve |
//! | `RPC_PORT` | `29100` | aria2 next RPC listen port |

use std::net::SocketAddr;
use std::path::PathBuf;

use motrix_next_lib::*;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn data_dir() -> PathBuf {
    if let Ok(d) = std::env::var("DATA_DIR") {
        return PathBuf::from(d);
    }
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.motrix.next")
}

fn frontend_dir() -> PathBuf {
    if let Ok(d) = std::env::var("FRONTEND_DIR") {
        return PathBuf::from(d);
    }
    // In dev mode, serve from the Vite dev server (proxied by vite.config.ts proxy)
    // In production, serve from the dist directory relative to the binary
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."));

    let candidate = exe_dir.join("dist");
    if candidate.exists() {
        return candidate;
    }

    // Fallback: look for dist in project root (cargo run scenario)
    PathBuf::from("dist")
}

#[tokio::main]
async fn main() {
    // ── Logging ──────────────────────────────────────────────────────
    let data = data_dir();
    std::fs::create_dir_all(&data).ok();

    let log_dir = data.join("logs");
    std::fs::create_dir_all(&log_dir).ok();

    motrix_next_lib::gpu_guard::pre_flight();

    std::panic::set_hook(Box::new(|info| {
        log::error!("PANIC: {info}");
    }));

    let log_level = motrix_next_lib::read_log_level();
    env_logger::Builder::new()
        .filter_level(log_level)
        .filter_module("hyper_util", log::LevelFilter::Warn)
        .filter_module("reqwest", log::LevelFilter::Warn)
        .filter_module("maxminddb", log::LevelFilter::Warn)
        .try_init()
        .ok();

    // ── DB migration guard ──────────────────────────────────────────
    motrix_next_lib::db_guard::check(&data);

    let rpc_port: u16 = env_or("RPC_PORT", "29100").parse().unwrap_or(29100);

    log::info!(
        "motrix-web-next starting — data_dir={} rpc_port={}",
        data.display(),
        rpc_port
    );

    // ── Build application state ─────────────────────────────────────
    let state = web::build_state(data.clone(), rpc_port).await;

    // ── Start the aria2 engine ──────────────────────────────────────
    if let Err(e) = web::start_engine(&state).await {
        log::error!("Failed to start engine: {e}");
        log::warn!("Server will run without engine — download features unavailable");
    }

    // ── Start SSE background polling ────────────────────────────────
    let _stat_handle = web::spawn_stat_polling(&state);

    // ── Build Axum router ───────────────────────────────────────────
    let app = web::build_router(state, frontend_dir());

    // ── Start HTTP server ───────────────────────────────────────────
    let port: u16 = env_or("PORT", "22077").parse().unwrap_or(22077);
    let host = env_or("HOST", "127.0.0.1");
    let addr: SocketAddr = format!("{host}:{port}").parse().expect("Invalid HOST:PORT");

    log::info!("motrix-web-next listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .expect("server error");
}
