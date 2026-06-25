use axum::response::sse::{Event, Sse};
use axum::extract::State;
use futures::stream::Stream;
use std::convert::Infallible;
use std::time::Duration;

use crate::server::state::{ServerEvent, SharedState};

/// Extract the SSE event name from a ServerEvent.
/// This maps each variant to its serde rename value so the client
/// can use `EventSource.addEventListener(name, ...)` for targeted dispatch.
fn event_name(evt: &ServerEvent) -> &'static str {
    match evt {
        ServerEvent::ClaudeCli { .. } => "claude-cli",
        ServerEvent::ClaudeCliDone { .. } => "claude-cli:done",
        ServerEvent::CodexCli { .. } => "codex-cli",
        ServerEvent::CodexCliDone { .. } => "codex-cli:done",
        ServerEvent::FileSyncQueueUpdated { .. } => "file-sync://queue-updated",
        ServerEvent::FileSyncChanged { .. } => "file-sync://changed",
        ServerEvent::BackupProgress { .. } => "backup-progress",
    }
}

pub async fn sse_events(
    State(state): State<SharedState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut rx = state.event_tx.subscribe();
    let stream = async_stream::stream! {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let name = event_name(&event);
                    let data = serde_json::to_string(&event).unwrap_or_else(|e| {
                        eprintln!("[SSE] serialize error: {e}");
                        format!(r#"{{"error":"serialize failed"}}"#)
                    });
                    yield Ok(Event::default().event(name).data(data));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    eprintln!("[SSE] client lagged, skipped {n} messages");
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    // Channel closed, end the stream
                    break;
                }
            }
        }
    };
    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(30)),
    )
}
