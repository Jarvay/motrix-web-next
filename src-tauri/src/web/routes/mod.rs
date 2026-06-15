//! Web API route modules.
//!
//! Each module defines its own `Router` with handlers that receive
//! [`AppState`](crate::web::AppState) via `axum::extract::State`.

pub mod config;
pub mod engine;
pub mod events;
pub mod files;
pub mod history;
pub mod misc;
pub mod tasks;
