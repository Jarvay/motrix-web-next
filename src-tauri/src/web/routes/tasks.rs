//! Task (download) REST API routes.
//!
//! Maps to the existing `Aria2Client` methods.
//! All handlers receive [`AppState`](crate::web::AppState) via `State` extractor.

use crate::aria2::types::Aria2Task;
use crate::error::AppError;
use crate::web::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Router,
};
use serde_json::{Map, Value};

// ── Type aliases ────────────────────────────────────────────────────

type AppResult<T> = Result<axum::Json<T>, (StatusCode, String)>;

/// Convert an [`AppError`] into an HTTP error response.
fn app_err(e: AppError) -> (StatusCode, String) {
    let status = match &e {
        AppError::NotFound(_) => StatusCode::NOT_FOUND,
        AppError::Engine(_) | AppError::Aria2(_) => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, e.to_string())
}

fn map_err<T>(r: Result<T, AppError>) -> AppResult<T> {
    r.map(axum::Json).map_err(app_err)
}

// ── Router ──────────────────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new()
        // Task listing
        .route("/tasks", get(list_tasks))
        .route("/tasks/active", get(list_active_tasks))
        // Batch operations
        .route("/tasks/pause-all", post(pause_all))
        .route("/tasks/force-pause-all", post(force_pause_all))
        .route("/tasks/unpause-all", post(unpause_all))
        .route("/tasks/batch/pause", post(batch_force_pause))
        .route("/tasks/batch/unpause", post(batch_unpause))
        .route("/tasks/batch/remove", post(batch_force_remove))
        // Task creation
        .route("/tasks/uri", post(add_uri))
        .route("/tasks/torrent", post(add_torrent))
        // ED2K search
        .route("/tasks/ed2k-search", post(ed2k_search))
        .route("/tasks/ed2k-results/{gid}", get(get_ed2k_results))
        .route("/tasks/ed2k-cleanup/{gid}", post(cleanup_ed2k_search))
        // Per-task operations
        .route("/tasks/{gid}", get(get_task))
        .route("/tasks/{gid}/peers", get(get_task_with_peers))
        .route("/tasks/{gid}/pause", post(pause_task))
        .route("/tasks/{gid}/force-pause", post(force_pause_task))
        .route("/tasks/{gid}/unpause", post(unpause_task))
        .route("/tasks/{gid}/remove", delete(force_remove_task))
        .route("/tasks/{gid}", delete(force_remove_task))
        .route("/tasks/{gid}/options", get(get_task_options))
        .route("/tasks/{gid}/options", put(change_task_options))
        .route("/tasks/{gid}/files", get(get_task_files))
        // Results cleanup
        .route("/results/{gid}", delete(remove_download_result))
        .route("/results", delete(purge_download_result))
        // Session
        .route("/session/save", post(save_session))
        // Status
        .route("/status", get(get_global_stat))
        .route("/version", get(get_version))
        .route("/options", get(get_global_option))
        .route("/options", put(change_global_option))
}

// ── Handlers ────────────────────────────────────────────────────────

async fn list_tasks(
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> AppResult<Vec<Aria2Task>> {
    let client = &state.aria2_client;
    let list_type = params.get("type").map(String::as_str).unwrap_or("active");

    match list_type {
        "active" => {
            let active = client.tell_active().await;
            let waiting = client.tell_waiting(0, 1000).await;
            let mut result = active.map_err(app_err)?;
            result.extend(waiting.map_err(app_err)?);
            Ok(axum::Json(result))
        }
        "waiting" => {
            let limit: i32 = params
                .get("limit")
                .and_then(|v| v.parse().ok())
                .unwrap_or(1000);
            map_err(client.tell_waiting(0, limit.into()).await)
        }
        "stopped" => {
            let limit: i32 = params
                .get("limit")
                .and_then(|v| v.parse().ok())
                .unwrap_or(128);
            map_err(client.tell_stopped(0, limit.into()).await)
        }
        _ => {
            let active = client.tell_active().await;
            let waiting = client.tell_waiting(0, 1000).await;
            let mut result = active.map_err(app_err)?;
            result.extend(waiting.map_err(app_err)?);
            Ok(axum::Json(result))
        }
    }
}

async fn list_active_tasks(State(state): State<AppState>) -> AppResult<Vec<Aria2Task>> {
    map_err(state.aria2_client.tell_active().await)
}

async fn get_task(State(state): State<AppState>, Path(gid): Path<String>) -> AppResult<Aria2Task> {
    map_err(state.aria2_client.tell_status(&gid).await)
}

async fn get_task_with_peers(
    State(state): State<AppState>,
    Path(gid): Path<String>,
) -> AppResult<Value> {
    let task = state
        .aria2_client
        .tell_status(&gid)
        .await
        .map_err(app_err)?;
    let peers = if task.bittorrent.is_some() {
        state.aria2_client.get_peers(&gid).await.map_err(app_err)?
    } else {
        serde_json::json!([])
    };
    let mut result = serde_json::to_value(&task)
        .map_err(|e| AppError::Aria2(format!("serialize task: {e}")))
        .map_err(app_err)?;
    result["peers"] = peers;
    Ok(axum::Json(result))
}

async fn pause_task(State(state): State<AppState>, Path(gid): Path<String>) -> AppResult<String> {
    map_err(state.aria2_client.pause(&gid).await)
}

async fn force_pause_task(
    State(state): State<AppState>,
    Path(gid): Path<String>,
) -> AppResult<String> {
    map_err(state.aria2_client.force_pause(&gid).await)
}

async fn unpause_task(State(state): State<AppState>, Path(gid): Path<String>) -> AppResult<String> {
    map_err(state.aria2_client.unpause(&gid).await)
}

async fn force_remove_task(
    State(state): State<AppState>,
    Path(gid): Path<String>,
) -> AppResult<String> {
    map_err(state.aria2_client.force_remove(&gid).await)
}

async fn pause_all(State(state): State<AppState>) -> AppResult<String> {
    map_err(state.aria2_client.pause_all().await)
}

async fn force_pause_all(State(state): State<AppState>) -> AppResult<String> {
    map_err(state.aria2_client.force_pause_all().await)
}

async fn unpause_all(State(state): State<AppState>) -> AppResult<String> {
    map_err(state.aria2_client.unpause_all().await)
}

// ── Batch operations ──────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct BatchGids {
    gids: Vec<String>,
}

async fn batch_force_pause(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<BatchGids>,
) -> AppResult<Vec<serde_json::Value>> {
    let calls: Vec<_> = body
        .gids
        .iter()
        .map(|gid| ("forcePause".to_string(), vec![serde_json::json!(gid)]))
        .collect();
    map_err(state.aria2_client.multicall(calls).await)
}

async fn batch_unpause(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<BatchGids>,
) -> AppResult<Vec<serde_json::Value>> {
    let calls: Vec<_> = body
        .gids
        .iter()
        .map(|gid| ("unpause".to_string(), vec![serde_json::json!(gid)]))
        .collect();
    map_err(state.aria2_client.multicall(calls).await)
}

async fn batch_force_remove(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<BatchGids>,
) -> AppResult<Vec<serde_json::Value>> {
    let calls: Vec<_> = body
        .gids
        .iter()
        .map(|gid| ("forceRemove".to_string(), vec![serde_json::json!(gid)]))
        .collect();
    map_err(state.aria2_client.multicall(calls).await)
}

// ── Task creation ──────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct AddUriBody {
    uris: Vec<String>,
    #[serde(default)]
    options: Map<String, Value>,
}

async fn add_uri(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<AddUriBody>,
) -> AppResult<String> {
    let opts: Value = if body.options.is_empty() {
        serde_json::json!({})
    } else {
        Value::Object(body.options)
    };
    map_err(state.aria2_client.add_uri(body.uris, opts).await)
}

#[derive(serde::Deserialize)]
struct AddTorrentBody {
    /// Base64-encoded .torrent content (matching aria2's addTorrent RPC).
    torrent: String,
    #[serde(default)]
    options: Map<String, Value>,
}

async fn add_torrent(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<AddTorrentBody>,
) -> AppResult<String> {
    let opts: Value = if body.options.is_empty() {
        serde_json::json!({})
    } else {
        Value::Object(body.options)
    };
    map_err(state.aria2_client.add_torrent(&body.torrent, opts).await)
}

// ── ED2K search ────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct Ed2kSearchBody {
    query: String,
}

async fn ed2k_search(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<Ed2kSearchBody>,
) -> AppResult<String> {
    map_err(
        state
            .aria2_client
            .ed2k_search(&body.query, serde_json::json!({}))
            .await,
    )
}

async fn get_ed2k_results(
    State(state): State<AppState>,
    Path(gid): Path<String>,
) -> AppResult<Value> {
    map_err(state.aria2_client.get_ed2k_search_results(&gid).await)
}

async fn cleanup_ed2k_search(
    State(state): State<AppState>,
    Path(gid): Path<String>,
) -> AppResult<()> {
    map_err(state.aria2_client.cleanup_ed2k_search(&gid).await)
}

// ── Task options ───────────────────────────────────────────────────

async fn get_task_options(
    State(state): State<AppState>,
    Path(gid): Path<String>,
) -> AppResult<Value> {
    map_err(state.aria2_client.get_option(&gid).await)
}

async fn change_task_options(
    State(state): State<AppState>,
    Path(gid): Path<String>,
    axum::Json(body): axum::Json<Value>,
) -> AppResult<String> {
    map_err(state.aria2_client.change_option(&gid, body).await)
}

async fn get_task_files(
    State(state): State<AppState>,
    Path(gid): Path<String>,
) -> AppResult<Value> {
    let files = state.aria2_client.get_files(&gid).await.map_err(app_err)?;
    let value = serde_json::to_value(&files)
        .map_err(|e| AppError::Aria2(format!("serialize files: {e}")))
        .map_err(app_err)?;
    Ok(axum::Json(value))
}

// ── Results / Session ──────────────────────────────────────────────

async fn remove_download_result(
    State(state): State<AppState>,
    Path(gid): Path<String>,
) -> AppResult<String> {
    map_err(state.aria2_client.remove_download_result(&gid).await)
}

async fn purge_download_result(State(state): State<AppState>) -> AppResult<String> {
    map_err(state.aria2_client.purge_download_result().await)
}

async fn save_session(State(state): State<AppState>) -> AppResult<String> {
    map_err(state.aria2_client.save_session().await)
}

// ── Global status / options ────────────────────────────────────────

async fn get_global_stat(State(state): State<AppState>) -> AppResult<Value> {
    let stat = state
        .aria2_client
        .get_global_stat()
        .await
        .map_err(app_err)?;
    let value = serde_json::to_value(&stat)
        .map_err(|e| AppError::Aria2(format!("serialize stat: {e}")))
        .map_err(app_err)?;
    Ok(axum::Json(value))
}

async fn get_version(State(state): State<AppState>) -> AppResult<Value> {
    map_err(state.aria2_client.get_version().await)
}

async fn get_global_option(State(state): State<AppState>) -> AppResult<Value> {
    map_err(state.aria2_client.get_global_option().await)
}

async fn change_global_option(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<Map<String, Value>>,
) -> AppResult<String> {
    map_err(state.aria2_client.change_global_option(body).await)
}
