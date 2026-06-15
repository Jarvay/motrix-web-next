//! Configuration REST API routes.
//!
//! System config (system.json) and general app configuration.

use crate::error::AppError;
use crate::web::AppState;
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use serde_json::Value;

fn app_err(e: AppError) -> (StatusCode, String) {
    match &e {
        AppError::NotFound(_) => (StatusCode::NOT_FOUND, e.to_string()),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

// ── Router ──────────────────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/config/system", get(get_system_config))
        .route("/config/system", post(save_system_config))
        .route("/config/factory-reset", post(factory_reset))
}

// ── Handlers ────────────────────────────────────────────────────────

async fn get_system_config(
    State(state): State<AppState>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let path = state.data_dir.join("system.json");
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| app_err(AppError::Io(e.to_string())))?;
    let value: Value = serde_json::from_str(&content)
        .map_err(|e| app_err(AppError::Store(e.to_string())))?;
    Ok(Json(value))
}

async fn save_system_config(
    State(state): State<AppState>,
    Json(config): Json<Value>,
) -> Result<Json<()>, (StatusCode, String)> {
    let path = state.data_dir.join("system.json");

    // Read existing config, merge, write back
    let mut existing: Value = if path.exists() {
        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| app_err(AppError::Io(e.to_string())))?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if let (Value::Object(ref mut existing_obj), Value::Object(ref new_obj)) =
        (&mut existing, &config)
    {
        for (k, v) in new_obj {
            existing_obj.insert(k.clone(), v.clone());
        }
    }

    let serialized = serde_json::to_string_pretty(&existing)
        .map_err(|e| app_err(AppError::Store(e.to_string())))?;
    tokio::fs::write(&path, serialized)
        .await
        .map_err(|e| app_err(AppError::Io(e.to_string())))?;

    log::debug!("config:save-system saved to {}", path.display());
    Ok(Json(()))
}

async fn factory_reset(
    State(state): State<AppState>,
) -> Result<Json<()>, (StatusCode, String)> {
    log::warn!("config:factory-reset");

    let files = ["system.json", "user.json", "config.json"];
    for fname in &files {
        let path = state.data_dir.join(fname);
        let _ = std::fs::remove_file(&path);
    }

    // Remove aria2 session file
    let session_path = state.data_dir.join("aria2.session");
    let _ = std::fs::remove_file(&session_path);

    Ok(Json(()))
}