use axum::Json;
use serde::Deserialize;

use crate::clip_server;

// ── Request types ──────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetClipServerConfigReq {
    pub enabled: bool,
    pub port: u16,
}

// ── Helper ─────────────────────────────────────────────────────────

fn ok<T: serde::Serialize>(data: T) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "data": data}))
}

fn err(e: String) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": false, "error": e}))
}

// ── Handlers ───────────────────────────────────────────────────────

pub async fn clip_server_status() -> Json<serde_json::Value> {
    let status = clip_server::get_daemon_status();
    ok(serde_json::json!({"status": status}))
}

pub async fn get_clip_server_config() -> Json<serde_json::Value> {
    let config = clip_server::get_runtime_config();
    ok(config)
}

pub async fn set_clip_server_config(
    Json(req): Json<SetClipServerConfigReq>,
) -> Json<serde_json::Value> {
    let config = clip_server::ClipServerConfig {
        enabled: req.enabled,
        port: req.port,
    };
    match clip_server::apply_clip_server_config(config) {
        Ok(runtime_config) => ok(runtime_config),
        Err(e) => err(e),
    }
}

pub async fn stop_clip_server() -> Json<serde_json::Value> {
    clip_server::stop_clip_server();
    let config = clip_server::get_runtime_config();
    ok(config)
}
