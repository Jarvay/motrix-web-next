//! File system REST API routes.
//!
//! Provides file existence checks, directory detection, and file
//! deletion operations that mirror the Tauri `commands::fs` commands
//! for the web mode.

use crate::web::AppState;
use axum::{Json, Router, routing::post};
use std::path::Path;

// ── Router ──────────────────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/files/check-path-exists", post(check_path_exists))
        .route("/files/check-path-is-dir", post(check_path_is_dir))
        .route("/files/trash-file", post(trash_file))
        .route("/files/remove-file", post(remove_file))
        .route("/files/show-item-in-dir", post(show_item_in_dir))
        .route("/files/open-path-normalized", post(open_path_normalized))
        .route("/files/read-local-file", post(read_local_file))
        .route("/files/list-dir-files", post(list_dir_files))
}

// ── Handlers ────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct PathPayload {
    path: String,
}

async fn check_path_exists(
    axum::extract::Json(payload): axum::extract::Json<PathPayload>,
) -> Json<bool> {
    let exists = Path::new(&payload.path).exists();
    Json(exists)
}

async fn check_path_is_dir(
    axum::extract::Json(payload): axum::extract::Json<PathPayload>,
) -> Json<bool> {
    let is_dir = Path::new(&payload.path).is_dir();
    Json(is_dir)
}

async fn trash_file(
    axum::extract::Json(payload): axum::extract::Json<PathPayload>,
) -> Result<Json<()>, (axum::http::StatusCode, String)> {
    trash::delete(&payload.path)
        .map(|_| Json(()))
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to trash file: {e}"),
            )
        })
}

async fn remove_file(
    axum::extract::Json(payload): axum::extract::Json<PathPayload>,
) -> Result<Json<()>, (axum::http::StatusCode, String)> {
    let p = Path::new(&payload.path);
    if !p.exists() {
        return Ok(Json(()));
    }
    std::fs::remove_file(p).map(|_| Json(())).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to remove file: {e}"),
        )
    })
}

/// Opens the file manager / explorer at the given path (or its parent if a file).
async fn show_item_in_dir(
    axum::extract::Json(payload): axum::extract::Json<PathPayload>,
) -> Result<Json<()>, (axum::http::StatusCode, String)> {
    let p = Path::new(&payload.path);
    if !p.exists() {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            format!("Path not found: {}", payload.path),
        ));
    }
    opener::reveal(&payload.path).map(|_| Json(())).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to show item in dir: {e}"),
        )
    })
}

/// Opens the file or directory with the system default application.
async fn open_path_normalized(
    axum::extract::Json(payload): axum::extract::Json<PathPayload>,
) -> Result<Json<()>, (axum::http::StatusCode, String)> {
    let p = Path::new(&payload.path);
    if !p.exists() {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            format!("Path not found: {}", payload.path),
        ));
    }
    opener::open(&payload.path).map(|_| Json(())).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to open path: {e}"),
        )
    })
}

/// Reads a local file and returns its content as a byte array (JSON number array).
async fn read_local_file(
    axum::extract::Json(payload): axum::extract::Json<PathPayload>,
) -> Result<Json<Vec<u8>>, (axum::http::StatusCode, String)> {
    let p = Path::new(&payload.path);
    if !p.exists() {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            format!("File not found: {}", payload.path),
        ));
    }
    std::fs::read(p).map(Json).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read file: {e}"),
        )
    })
}

/// Lists all file/directory names in a directory (basenames only).
async fn list_dir_files(
    axum::extract::Json(payload): axum::extract::Json<PathPayload>,
) -> Result<Json<Vec<String>>, (axum::http::StatusCode, String)> {
    let p = Path::new(&payload.path);
    if !p.is_dir() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            format!("Not a directory: {}", payload.path),
        ));
    }
    let mut names = Vec::new();
    let entries = std::fs::read_dir(p).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read directory: {e}"),
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to read directory entry: {e}"),
            )
        })?;
        if let Some(name) = entry.file_name().to_str() {
            names.push(name.to_owned());
        }
    }
    Ok(Json(names))
}