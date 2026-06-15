//! SSE (Server-Sent Events) endpoint for real-time event streaming.
//!
//! In web mode, the backend can't use Tauri IPC events so we use SSE to
//! push stat updates to the frontend. This eliminates frequent polling
//! and reduces unnecessary HTTP overhead.

use std::convert::Infallible;
use std::time::Duration;
use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::StreamExt;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use crate::web::AppState;

/// Global stat payload pushed to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatUpdate {
    pub download_speed: u64,
    pub upload_speed: u64,
    pub num_active: u64,
    pub num_waiting: u64,
    pub num_stopped: u64,
    pub num_stopped_total: u64,
}

/// Event types that can be sent via SSE.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", content = "payload")]
pub enum SseEvent {
    /// Global statistics update (download speed, active task count, etc.).
    StatUpdate(StatUpdate),
    /// Notifies the frontend that task list has changed and should be refreshed.
    TaskChanged,
}

/// Create a broadcast channel for SSE events.
pub fn create_event_broadcast() -> broadcast::Sender<SseEvent> {
    broadcast::channel(16).0
}

/// Broadcast a stat update to all connected SSE clients.
pub fn broadcast_stat_update(sender: &broadcast::Sender<SseEvent>, update: StatUpdate) {
    let _ = sender.send(SseEvent::StatUpdate(update));
}

/// SSE endpoint that streams events to the client.
///
/// The client opens a long-lived HTTP connection and the server pushes
/// events as they happen. This eliminates polling.
pub async fn sse_events(
    State(state): State<AppState>,
) -> Sse<impl futures_util::stream::Stream<Item = Result<Event, Infallible>>> {
    let rx = state.event_tx.subscribe();

    let stream = BroadcastStream::new(rx)
        .filter_map(|result| async move {
            match result {
                Ok(event) => Some(Ok(Event::default()
                    .event(match &event {
                        SseEvent::StatUpdate(_) => "stat:update",
                        SseEvent::TaskChanged => "task:changed",
                    })
                    .data(serde_json::to_string(&event).unwrap_or_default()))),
                Err(_) => None,
            }
        });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(30))
            .text("keep-alive"),
    )
}

/// Route definition for SSE events.
pub fn routes() -> axum::Router<AppState> {
    use axum::routing::get;
    axum::Router::new().route("/events", get(sse_events))
}