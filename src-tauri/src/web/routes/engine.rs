//! Engine lifecycle REST API routes.
//!
//! Start, stop, restart, and health-check the aria2 engine.

use crate::web::AppState;
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};

// ── Router ──────────────────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/engine/status", get(engine_status))
        .route("/engine/restart", post(restart_engine))
        .route("/engine/wait-ready", get(wait_for_engine))
}

// ── Handlers ────────────────────────────────────────────────────────

async fn engine_status(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let running = state.engine.lock().unwrap().is_running();

    // Try to probe aria2 for additional status
    let engine_info = match state.aria2_client.get_version().await {
        Ok(version) => serde_json::json!({
            "running": true,
            "version": version,
        }),
        Err(_) => serde_json::json!({
            "running": running,
            "version": null,
        }),
    };

    Ok(Json(engine_info))
}

async fn restart_engine(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    log::info!("engine:restart requested via API");

    // Stop current engine
    crate::web::engine::stop_engine(&state.engine);

    // Read system config
    let config_path = state.data_dir.join("system.json");
    let mut system_config: serde_json::Value = match tokio::fs::read_to_string(&config_path).await {
        Ok(content) => serde_json::from_str(&content).unwrap_or(serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    };

    // Re-inject default RPC settings (same as on first startup) so the
    // engine always binds to the correct port — even when system.json
    // hasn't been persisted yet.
    if system_config.get("rpc-listen-port").is_none() {
        system_config["rpc-listen-port"] =
            serde_json::Value::String(state.rpc_port.to_string());
    }
    if system_config.get("rpc-listen-all").is_none() {
        system_config["rpc-listen-all"] = serde_json::Value::Bool(true);
    }
    if system_config.get("rpc-allow-origin-all").is_none() {
        system_config["rpc-allow-origin-all"] = serde_json::Value::Bool(true);
    }

    // Start new engine
    crate::web::engine::start_engine(
        &state.engine,
        &state.data_dir,
        state.rpc_port,
        &system_config,
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // Sync Aria2Client credentials to match the actual port — the user
    // may have changed rpc-listen-port via /api/config/system.
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

    tokio::spawn(async move {
        crate::web::engine::wait_for_engine_ready(&state.aria2_client, 30).await;
    });

    Ok(Json(serde_json::json!({
        "status": "started",
        "message": "Engine restart initiated",
        "port": actual_port,
    })))
}

async fn wait_for_engine(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    match crate::web::engine::wait_for_engine_ready(&state.aria2_client, 60).await {
        Ok(()) => Ok(Json(serde_json::json!({
            "ready": true,
        }))),
        Err(e) => Err((StatusCode::SERVICE_UNAVAILABLE, e)),
    }
}