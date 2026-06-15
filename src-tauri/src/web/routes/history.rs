//! History REST API routes.
//!
//! CRUD operations on the download history database.

use crate::error::AppError;
use crate::history::HistoryRecord;
use crate::web::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;

fn app_err(e: AppError) -> (StatusCode, String) {
    match &e {
        AppError::NotFound(_) => (StatusCode::NOT_FOUND, e.to_string()),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

fn map_err<T>(r: Result<T, AppError>) -> Result<Json<T>, (StatusCode, String)> {
    r.map(Json).map_err(app_err)
}

// ── Router ──────────────────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/history", get(get_records))
        .route("/history", post(add_record))
        .route("/history/{gid}", delete(remove_record))
        .route("/history/clear", post(clear_records))
        .route("/history/stale", post(remove_stale))
        .route("/history/birth", post(record_birth))
        .route("/history/births", get(load_births))
        .route("/history/integrity", get(check_integrity))
}

// ── Query params ────────────────────────────────────────────────────

#[derive(Deserialize, Default)]
struct HistoryQuery {
    status: Option<String>,
    limit: Option<u32>,
}

// ── Handlers ────────────────────────────────────────────────────────

async fn get_records(
    State(state): State<AppState>,
    axum::extract::Query(q): axum::extract::Query<HistoryQuery>,
) -> Result<Json<Vec<HistoryRecord>>, (StatusCode, String)> {
    map_err(
        state
            .history_db
            .get_records(q.status.as_deref(), q.limit)
            .await,
    )
}

async fn add_record(
    State(state): State<AppState>,
    Json(record): Json<HistoryRecord>,
) -> Result<Json<()>, (StatusCode, String)> {
    map_err(state.history_db.add_record(&record).await)
}

async fn remove_record(
    State(state): State<AppState>,
    Path(gid): Path<String>,
) -> Result<Json<()>, (StatusCode, String)> {
    map_err(state.history_db.remove_record(&gid).await)
}

#[derive(Deserialize)]
struct ClearBody {
    status: Option<String>,
}

async fn clear_records(
    State(state): State<AppState>,
    Json(body): Json<ClearBody>,
) -> Result<Json<()>, (StatusCode, String)> {
    map_err(state.history_db.clear_records(body.status.as_deref()).await)
}

#[derive(Deserialize)]
struct RemoveStaleBody {
    gids: Vec<String>,
}

async fn remove_stale(
    State(state): State<AppState>,
    Json(body): Json<RemoveStaleBody>,
) -> Result<Json<()>, (StatusCode, String)> {
    map_err(state.history_db.remove_stale_records(&body.gids).await)
}

#[derive(Deserialize)]
struct BirthBody {
    gid: String,
    added_at: String,
}

async fn record_birth(
    State(state): State<AppState>,
    Json(body): Json<BirthBody>,
) -> Result<Json<()>, (StatusCode, String)> {
    map_err(
        state
            .history_db
            .record_task_birth(&body.gid, &body.added_at)
            .await,
    )
}

async fn load_births(
    State(state): State<AppState>,
) -> Result<Json<Vec<(String, String)>>, (StatusCode, String)> {
    map_err(state.history_db.load_birth_records().await)
}

async fn check_integrity(
    State(state): State<AppState>,
) -> Result<Json<String>, (StatusCode, String)> {
    map_err(state.history_db.check_integrity().await)
}
