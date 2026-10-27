//! 宿主能力面：插件通过本机回环 HTTP 反调宿主能力（读项目文件、写日志、查状态）。
//!
//! 为什么用 HTTP 而不是复用 stdio JSON-RPC：stdio 那条通道的方向是「宿主 → 插件」，
//! 插件在 tool 调用里要**主动**问宿主事情，需要一条独立、可鉴权、可并发处置的入口。
//! 回环 HTTP 天然满足（只绑 127.0.0.1），并且每个插件一条独立 token，泄漏面被限在单个插件。
//!
//! 本文件分两层：
//!   1. 纯函数（`require` / `is_inside` / `is_safe_url`）—— 安全判定的全部逻辑，可单测；
//!   2. HTTP 层（`router` / `start`）—— 只做接线：取 token → 查权限 → 调纯函数。

use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

/// 检查是否拥有某个权限；`data:write` 永远放行（设计文档 6.2：自动授予）
pub fn require(granted: &[String], permission: &str) -> Result<(), String> {
    if permission == "data:write" {
        return Ok(());
    }
    if granted.iter().any(|g| g == permission) {
        Ok(())
    } else {
        Err(permission.to_string())
    }
}

/// 路径是否落在 root 之内（先做词法归一化，再做前缀比较）
///
/// 只做词法归一，不碰文件系统：`is_inside` 的调用方是 HTTP handler，
/// 不该为了判路径去 stat 一个可能不存在的文件。
pub fn is_inside(root: &Path, candidate: &str) -> bool {
    let norm = normalize_lexically(Path::new(candidate));
    let root_norm = normalize_lexically(root);
    norm.starts_with(&root_norm) && norm != root_norm
}

fn normalize_lexically(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// 只允许 https，且拒绝回环与私有网段（防 SSRF）
pub fn is_safe_url(raw: &str) -> bool {
    let Ok(u) = url::Url::parse(raw) else {
        return false;
    };
    if u.scheme() != "https" {
        return false;
    }
    // 用 `host()` 而不是 `host_str()` + 字符串解析：`host_str()` 对 IPv6 带方括号
    // （`[::1]`），`parse::<IpAddr>()` 会失败，于是回环地址被当成「域名」放过去。
    // `host()` 已经替我们做完归一化（数字型 host 一律解析成 Ipv4/Ipv6 变体）。
    let Some(host) = u.host() else {
        return false;
    };
    match host {
        url::Host::Ipv4(ip) => is_public_v4(ip),
        url::Host::Ipv6(ip) => match ip.to_ipv4_mapped() {
            // `::ffff:192.168.1.1` 这类映射地址按内嵌的 IPv4 判，
            // 否则它们会绕过私有网段检查（经典 SSRF 绕过手法）。
            Some(v4) => is_public_v4(v4),
            None => !is_blocked_v6(ip),
        },
        // 域名：不做 DNS 解析（避免额外网络依赖与 DNS 重绑定时序问题），
        // 只挡明显的 localhost 别名；其余交给系统解析。
        url::Host::Domain(d) => !d.eq_ignore_ascii_case("localhost"),
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    !(ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified())
}

fn is_blocked_v6(ip: Ipv6Addr) -> bool {
    // `IpAddr` 上只有 is_loopback / is_unspecified，私有段（fc00::/7）与
    // 链路本地（fe80::/10）必须走 `Ipv6Addr` 自己的判定。
    ip.is_loopback() || ip.is_unspecified() || ip.is_unique_local() || ip.is_unicast_link_local()
}

// ---------------------------------------------------------------------------
// HTTP 层
// ---------------------------------------------------------------------------

/// 一个插件会话：token → 身份与权限
#[derive(Clone)]
pub struct PluginSession {
    pub plugin_id: String,
    pub granted: Vec<String>,
    pub project_root: Option<PathBuf>,
    pub data_root: PathBuf,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PluginLogLine {
    pub plugin_id: String,
    pub level: String,
    pub message: String,
}

#[derive(Clone)]
pub struct HostApiState {
    pub sessions: Arc<Mutex<HashMap<String, PluginSession>>>,
    pub log_sink: Arc<Mutex<Vec<PluginLogLine>>>,
}

#[derive(Deserialize)]
pub struct LogBody {
    pub level: String,
    pub message: String,
}

#[derive(Deserialize)]
pub struct PathBody {
    pub path: String,
}

/// 日志环上限：只留最近 N 条，防止插件刷爆内存
const MAX_LOG_LINES: usize = 500;

impl HostApiState {
    /// 新建一个空的宿主能力面状态（会话由安装/启动流程逐步登记）。
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            log_sink: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// 从 `Authorization: Bearer <token>` 取 token 查表。
    ///
    /// 查不到就返回 `None`：handler 一律以 401 结束，不区分「没带 token」与
    /// 「token 错了」—— 后者不告诉调用方「这个 token 格式对但过期了」，
    /// 免得成为爆破探针的判别信号。
    pub fn session(&self, headers: &HeaderMap) -> Option<PluginSession> {
        let raw = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
        let token = raw.strip_prefix("Bearer ")?.trim();
        if token.is_empty() {
            return None;
        }
        let sessions = self.sessions.lock().ok()?;
        sessions.get(token).cloned()
    }
}

impl Default for HostApiState {
    fn default() -> Self {
        Self::new()
    }
}

/// 无 token / token 无效：纯文本，避免给出结构化线索
fn unauthorized() -> Response {
    (StatusCode::UNAUTHORIZED, "invalid token").into_response()
}

/// 权限不足：结构化给插件，插件才能把「缺哪个权限」写进自己的错误里
fn forbidden(permission: &str) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(serde_json::json!({
            "error": "E_PERMISSION_DENIED",
            "permission": permission,
        })),
    )
        .into_response()
}

fn path_escape() -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({ "error": "E_PATH_ESCAPE" })),
    )
        .into_response()
}

async fn status(State(state): State<HostApiState>, headers: HeaderMap) -> Response {
    let Some(session) = state.session(&headers) else {
        return unauthorized();
    };
    Json(serde_json::json!({
        "hostVersion": env!("CARGO_PKG_VERSION"),
        "pluginId": session.plugin_id,
        "grantedPermissions": session.granted,
        "projectRoot": session.project_root.map(|p| p.to_string_lossy().to_string()),
    }))
    .into_response()
}

async fn log(
    State(state): State<HostApiState>,
    headers: HeaderMap,
    Json(body): Json<LogBody>,
) -> Response {
    let Some(session) = state.session(&headers) else {
        return unauthorized();
    };
    let line = PluginLogLine {
        plugin_id: session.plugin_id,
        level: body.level,
        message: body.message,
    };
    // 锁中毒不该让插件日志变成 500：丢日志比丢请求好，所以这里用 `if let Ok`
    // 静默降级，仍然回 204（插件侧不该因为宿主内存状态异常而重试）。
    if let Ok(mut sink) = state.log_sink.lock() {
        sink.push(line);
        if sink.len() > MAX_LOG_LINES {
            let overflow = sink.len() - MAX_LOG_LINES;
            sink.drain(0..overflow);
        }
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn project_read(
    State(state): State<HostApiState>,
    headers: HeaderMap,
    Json(body): Json<PathBody>,
) -> Response {
    let Some(session) = state.session(&headers) else {
        return unauthorized();
    };
    // 顺序固定：先token、再权限、最后路径。反过来会把「路径存在性」泄漏给无权限插件。
    if let Err(permission) = require(&session.granted, "fs:project-read") {
        return forbidden(&permission);
    }
    let Some(root) = session.project_root else {
        // 没有项目就没有可读的目录；这不算逃逸，单独给个码便于插件区分。
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "E_NO_PROJECT" })),
        )
            .into_response();
    };
    if !is_inside(&root, &body.path) {
        return path_escape();
    }
    // 用阻塞读而不是 tokio::fs：本 crate 的 tokio 没开 `fs` feature，
    // 而这里读的是项目内的 Markdown 文本（KB 量级），阻塞可接受。
    match std::fs::read_to_string(&body.path) {
        Ok(content) => Json(serde_json::json!({ "content": content })).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "E_READ_FAILED",
                "message": error.to_string(),
            })),
        )
            .into_response(),
    }
}

pub fn router(state: HostApiState) -> Router {
    Router::new()
        .route("/host/status", get(status))
        .route("/host/log", post(log))
        .route("/host/project/read", post(project_read))
        .with_state(state)
}

/// 起一个只绑回环的宿主 API，返回实际端口。
///
/// 同步绑定 + `spawn_task` 起服务：调用方通常是 Tauri 的同步初始化路径，
/// 拿不到运行时上下文时安静放弃（见 `super::spawn_task`）。
pub fn start(state: HostApiState) -> Result<u16, String> {
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| format!("无法监听宿主 API 端口：{e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let app = router(state);
    super::spawn_task(async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(l) => {
                let _ = axum::serve(l, app).await;
            }
            Err(_) => { /* 拿不到就放弃；端口本就为 0 分配，失败意味着运行时异常 */ }
        }
    });
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn granted(p: &[&str]) -> Vec<String> {
        p.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn missing_permission_is_denied() {
        let g = granted(&["data:write"]);
        assert_eq!(
            require(&g, "fs:project-write").unwrap_err(),
            "fs:project-write"
        );
    }

    #[test]
    fn granted_permission_passes() {
        assert!(require(&granted(&["fs:project-read"]), "fs:project-read").is_ok());
    }

    #[test]
    fn data_write_is_always_granted() {
        assert!(require(&granted(&[]), "data:write").is_ok());
    }

    #[test]
    fn project_path_inside_root_is_allowed() {
        let root = Path::new("/novel/book");
        assert!(is_inside(root, "/novel/book/wiki/chapters/01.md"));
    }

    #[test]
    fn project_path_outside_root_is_rejected() {
        let root = Path::new("/novel/book");
        assert!(!is_inside(root, "/novel/other/secret.md"));
        assert!(!is_inside(root, "/etc/passwd"));
        // 根目录本身不是「文件」，也应拒绝
        assert!(!is_inside(root, "/novel/book"));
    }

    #[test]
    fn traversal_attempt_is_rejected() {
        let root = Path::new("/novel/book");
        assert!(!is_inside(root, "/novel/book/../../etc/passwd"));
        assert!(!is_inside(root, "/novel/book/wiki/../../../etc/passwd"));
    }

    #[test]
    fn net_url_must_be_https_and_public() {
        assert!(is_safe_url("https://api.example.com/x"));
        assert!(!is_safe_url("http://api.example.com/x"));
        assert!(!is_safe_url("https://127.0.0.1:8080/x"));
        assert!(!is_safe_url("https://192.168.1.1/x"));
        assert!(!is_safe_url("https://10.0.0.5/x"));
        assert!(!is_safe_url("https://localhost/x"));
        assert!(!is_safe_url("file:///etc/passwd"));
    }
}
