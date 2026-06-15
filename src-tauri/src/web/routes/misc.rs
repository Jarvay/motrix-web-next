//! Miscellaneous utility REST API routes.
//!
//! Health, server info, and other non-domain-specific endpoints.

use crate::web::AppState;
use axum::{extract::State, routing::get, Json, Router};
use serde_json::Value;

// ── Router ──────────────────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/info", get(server_info))
}

// ── Handlers ────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Json<Value> {
    let engine_ready = state.aria2_client.get_version().await.is_ok();

    Json(serde_json::json!({
        "status": "ok",
        "engine": engine_ready,
    }))
}

async fn server_info(State(state): State<AppState>) -> Json<Value> {
    let engine_version = state
        .aria2_client
        .get_version()
        .await
        .ok()
        .and_then(|v| v.get("version").cloned())
        .and_then(|v| v.as_str().map(String::from));

    Json(serde_json::json!({
        "app": "Motrix Next Web",
        "version": env!("CARGO_PKG_VERSION"),
        "data_dir": state.data_dir.to_string_lossy(),
        "rpc_port": state.rpc_port,
        "engine_version": engine_version,
    }))
}
