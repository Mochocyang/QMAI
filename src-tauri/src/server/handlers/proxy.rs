use axum::Json;
use serde::Deserialize;

use crate::proxy;

// ── Request types ──────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetProxyEnvReq {
    pub enabled: bool,
    pub url: String,
    #[serde(default = "default_true")]
    pub bypass_local: bool,
}

fn default_true() -> bool {
    true
}

// ── Helper ─────────────────────────────────────────────────────────

fn ok<T: serde::Serialize>(data: T) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "data": data}))
}

// ── Handlers ───────────────────────────────────────────────────────

pub async fn set_proxy_env(
    Json(req): Json<SetProxyEnvReq>,
) -> Json<serde_json::Value> {
    let config = proxy::ProxyConfig {
        enabled: req.enabled,
        url: req.url,
        bypass_local: req.bypass_local,
    };
    let summary = proxy::apply_proxy_env(&config);
    ok(serde_json::json!({"summary": summary}))
}
