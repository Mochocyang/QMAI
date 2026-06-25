use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::Deserialize;

use crate::commands::file_sync;
use crate::server::state::SharedState;

// ── Request types ──────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartWatcherReq {
    pub project_id: String,
    pub project_path: String,
    pub source_watch_config: Option<file_sync::SourceWatchConfig>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RescanReq {
    pub project_id: String,
    pub project_path: String,
    pub source_watch_config: Option<file_sync::SourceWatchConfig>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPathReq {
    pub project_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskActionReq {
    pub project_id: String,
    pub project_path: String,
    pub task_id: String,
}

// ── Helper ─────────────────────────────────────────────────────────

fn ok<T: serde::Serialize>(data: T) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "data": data}))
}

fn err(e: String) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": false, "error": e}))
}

/// Create an EventEmitter that forwards file-sync events via the
/// server's broadcast channel. The callback maps event names to the
/// appropriate `ServerEvent` variant.
fn make_event_emitter(event_tx: tokio::sync::broadcast::Sender<crate::server::state::ServerEvent>) -> file_sync::EventEmitter {
    Box::new(move |event: &str, payload: serde_json::Value| {
        let project_id = payload.get("projectId").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let tasks = payload.get("tasks").cloned().unwrap_or(serde_json::Value::Null);
        let server_event = match event {
            "file-sync://queue-updated" => crate::server::state::ServerEvent::FileSyncQueueUpdated { project_id, tasks },
            "file-sync://changed" => crate::server::state::ServerEvent::FileSyncChanged { project_id, tasks },
            _ => return,
        };
        let _ = event_tx.send(server_event);
    })
}

// ── Handlers ───────────────────────────────────────────────────────

pub async fn start_project_file_watcher(
    State(state): State<SharedState>,
    Json(req): Json<StartWatcherReq>,
) -> Json<serde_json::Value> {
    let emit = make_event_emitter(state.event_tx.clone());
    match tokio::task::spawn_blocking(move || {
        file_sync::do_start_project_file_watcher(
            &state.file_sync,
            req.project_id,
            req.project_path,
            req.source_watch_config,
            emit,
        )
    })
    .await
    {
        Ok(Ok(queue)) => ok(queue),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("start_project_file_watcher join error: {e}")),
    }
}

pub async fn stop_project_file_watcher(
    State(state): State<SharedState>,
) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || {
        file_sync::do_stop_project_file_watcher(&state.file_sync)
    })
    .await
    {
        Ok(Ok(_)) => ok(serde_json::Value::Null),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("stop_project_file_watcher join error: {e}")),
    }
}

pub async fn rescan_project_files(
    State(state): State<SharedState>,
    Json(req): Json<RescanReq>,
) -> Json<serde_json::Value> {
    let emit: Arc<file_sync::EventEmitter> = Arc::from(make_event_emitter(state.event_tx.clone()));
    match tokio::task::spawn_blocking(move || {
        file_sync::do_rescan_project_files(
            req.project_id,
            req.project_path,
            req.source_watch_config,
            &emit,
        )
    })
    .await
    {
        Ok(Ok(result)) => ok(result),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("rescan_project_files join error: {e}")),
    }
}

pub async fn get_file_change_queue(
    Json(req): Json<ProjectPathReq>,
) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || {
        file_sync::do_get_file_change_queue(req.project_path)
    })
    .await
    {
        Ok(Ok(queue)) => ok(queue),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("get_file_change_queue join error: {e}")),
    }
}

pub async fn retry_file_change_task(
    State(state): State<SharedState>,
    Json(req): Json<TaskActionReq>,
) -> Json<serde_json::Value> {
    let emit: Arc<file_sync::EventEmitter> = Arc::from(make_event_emitter(state.event_tx.clone()));
    match tokio::task::spawn_blocking(move || {
        file_sync::do_retry_file_change_task(
            req.project_id,
            req.project_path,
            req.task_id,
            &emit,
        )
    })
    .await
    {
        Ok(Ok(queue)) => ok(queue),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("retry_file_change_task join error: {e}")),
    }
}

pub async fn ignore_file_change_task(
    State(state): State<SharedState>,
    Json(req): Json<TaskActionReq>,
) -> Json<serde_json::Value> {
    let emit: Arc<file_sync::EventEmitter> = Arc::from(make_event_emitter(state.event_tx.clone()));
    match tokio::task::spawn_blocking(move || {
        file_sync::do_ignore_file_change_task(
            req.project_id,
            req.project_path,
            req.task_id,
            &emit,
        )
    })
    .await
    {
        Ok(Ok(queue)) => ok(queue),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("ignore_file_change_task join error: {e}")),
    }
}
