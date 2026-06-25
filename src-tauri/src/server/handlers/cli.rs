use axum::extract::State;
use axum::Json;
use serde::Deserialize;

use crate::commands::claude_cli::{self, CliEmitter};
use crate::commands::codex_cli::{self, CodexEmitter};
use crate::server::state::{ServerEvent, SharedState};

// ── Helpers ────────────────────────────────────────────────────────

fn ok<T: serde::Serialize>(data: T) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "data": data}))
}

fn err(e: String) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": false, "error": e}))
}

// ── Broadcast-based emitters ───────────────────────────────────────

#[derive(Clone)]
struct BroadcastClaudeEmitter {
    tx: tokio::sync::broadcast::Sender<ServerEvent>,
}

impl BroadcastClaudeEmitter {
    fn new(tx: tokio::sync::broadcast::Sender<ServerEvent>) -> Self {
        Self { tx }
    }
}

impl CliEmitter for BroadcastClaudeEmitter {
    fn emit_data(&self, stream_id: &str, data: String) {
        let _ = self.tx.send(ServerEvent::ClaudeCli {
            stream_id: stream_id.to_string(),
            data,
        });
    }

    fn emit_done(&self, stream_id: &str, code: Option<i32>, stderr: String) {
        let _ = self.tx.send(ServerEvent::ClaudeCliDone {
            stream_id: stream_id.to_string(),
            code,
            stderr,
        });
    }
}

#[derive(Clone)]
struct BroadcastCodexEmitter {
    tx: tokio::sync::broadcast::Sender<ServerEvent>,
}

impl BroadcastCodexEmitter {
    fn new(tx: tokio::sync::broadcast::Sender<ServerEvent>) -> Self {
        Self { tx }
    }
}

impl CodexEmitter for BroadcastCodexEmitter {
    fn emit_data(&self, stream_id: &str, data: String) {
        let _ = self.tx.send(ServerEvent::CodexCli {
            stream_id: stream_id.to_string(),
            data,
        });
    }

    fn emit_done(&self, stream_id: &str, code: Option<i32>, stderr: String, _stdout: String) {
        let _ = self.tx.send(ServerEvent::CodexCliDone {
            stream_id: stream_id.to_string(),
            code,
            stderr,
        });
    }
}

// ── Request types ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ClaudeCliSpawnReq {
    stream_id: String,
    model: String,
    messages: Vec<claude_cli::ClaudeMessage>,
    #[serde(default)]
    isolate_local_config: bool,
}

#[derive(Deserialize)]
pub struct ClaudeCliKillReq {
    stream_id: String,
}

#[derive(Deserialize)]
pub struct CodexCliSpawnReq {
    stream_id: String,
    model: String,
    prompt: String,
    #[serde(default)]
    isolate_local_config: bool,
    timeout_minutes: Option<u64>,
}

#[derive(Deserialize)]
pub struct CodexCliKillReq {
    stream_id: String,
}

// ── Handlers ───────────────────────────────────────────────────────

pub async fn claude_cli_detect() -> Json<serde_json::Value> {
    match claude_cli::do_claude_cli_detect().await {
        Ok(result) => ok(result),
        Err(e) => err(e),
    }
}

pub async fn claude_cli_spawn(
    State(state): State<SharedState>,
    Json(req): Json<ClaudeCliSpawnReq>,
) -> Json<serde_json::Value> {
    let emitter = BroadcastClaudeEmitter::new(state.event_tx.clone());
    match claude_cli::do_claude_cli_spawn(
        &state.claude_cli,
        emitter,
        req.stream_id,
        req.model,
        req.messages,
        req.isolate_local_config,
    )
    .await
    {
        Ok(()) => ok(true),
        Err(e) => err(e),
    }
}

pub async fn claude_cli_kill(
    State(state): State<SharedState>,
    Json(req): Json<ClaudeCliKillReq>,
) -> Json<serde_json::Value> {
    match claude_cli::do_claude_cli_kill(&state.claude_cli, &req.stream_id).await {
        Ok(()) => ok(true),
        Err(e) => err(e),
    }
}

pub async fn codex_cli_detect() -> Json<serde_json::Value> {
    match codex_cli::do_codex_cli_detect().await {
        Ok(result) => ok(result),
        Err(e) => err(e),
    }
}

pub async fn codex_cli_spawn(
    State(state): State<SharedState>,
    Json(req): Json<CodexCliSpawnReq>,
) -> Json<serde_json::Value> {
    let emitter = BroadcastCodexEmitter::new(state.event_tx.clone());
    match codex_cli::do_codex_cli_spawn(
        &state.codex_cli,
        emitter,
        req.stream_id,
        req.model,
        req.prompt,
        req.isolate_local_config,
        req.timeout_minutes,
    )
    .await
    {
        Ok(()) => ok(true),
        Err(e) => err(e),
    }
}

pub async fn codex_cli_kill(
    State(state): State<SharedState>,
    Json(req): Json<CodexCliKillReq>,
) -> Json<serde_json::Value> {
    match codex_cli::do_codex_cli_kill(&state.codex_cli, &req.stream_id).await {
        Ok(()) => ok(true),
        Err(e) => err(e),
    }
}
