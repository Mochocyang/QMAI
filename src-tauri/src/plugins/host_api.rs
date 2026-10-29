//! 宿主能力面：插件通过本机回环 HTTP 反调宿主能力（读项目文件、写日志、查状态）。
//!
//! 为什么用 HTTP 而不是复用 stdio JSON-RPC：stdio 那条通道的方向是「宿主 → 插件」，
//! 插件在 tool 调用里要**主动**问宿主事情，需要一条独立、可鉴权、可并发处置的入口。
//! 回环 HTTP 天然满足（只绑 127.0.0.1），并且每个插件一条独立 token，泄漏面被限在单个插件。
//!
//! 本文件分两层：
//!   1. 纯函数（`require` / `is_inside` / `canonical_inside`）——
//!      安全判定的全部逻辑，可单测；
//!   2. HTTP 层（`router` / `start`）—— 只做接线：取 token → 查权限 → 调纯函数。

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use super::project_context;

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
///
/// **这是第一道便宜闸门，不是全部**：词法上在 root 内不代表真实路径在 root 内 ——
/// 项目里的符号链接 / NTFS junction 可以指向任意外部目录。调用方必须再走
/// [`canonical_inside`] 做真实路径复检（设计文档 6.2「符号链接需解析后检查」）。
pub fn is_inside(root: &Path, candidate: &str) -> bool {
    let norm = normalize_lexically(Path::new(candidate));
    let root_norm = normalize_lexically(root);
    norm.starts_with(&root_norm) && norm != root_norm
}

/// 解析真实路径后再比一次 root —— 挡住符号链接 / junction 逃逸。
///
/// 为什么两道闸门都做：词法闸门便宜、能拦住 `../` 这类明显越界且不碰文件系统；
/// canonical 闸门要读文件系统（会失败、会慢），只对已经过了词法闸门的路径做。
/// 返回的是**可安全使用的真实路径**，调用方必须用它去读文件 —— 否则「检查的对象」
/// 和「使用的对象」不是同一个，攻击者仍可在两者之间做手脚。
pub fn canonical_inside(root: &Path, candidate: &Path) -> Result<PathBuf, &'static str> {
    let real_root = std::fs::canonicalize(root).map_err(|_| "E_NO_PROJECT")?;
    // 文件可能还不存在 → 解析父目录；父也解析不了就按路径逃逸处理
    let real_candidate = match std::fs::canonicalize(candidate) {
        Ok(path) => path,
        Err(_) => {
            let parent = candidate.parent().ok_or("E_PATH_ESCAPE")?;
            let name = candidate.file_name().ok_or("E_PATH_ESCAPE")?;
            std::fs::canonicalize(parent)
                .map_err(|_| "E_PATH_ESCAPE")?
                .join(name)
        }
    };
    // Windows 的 canonicalize 返回 `\\?\C:\…` 形式：两侧都 canonicalize 后再比，
    // 前缀才不会一边带扩展前缀一边不带。`Path::starts_with` 按组件比较，
    // 不会把 `booking` 误判成 `book` 的子路径。
    if real_candidate.starts_with(&real_root) && real_candidate != real_root {
        Ok(real_candidate)
    } else {
        Err("E_PATH_ESCAPE")
    }
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

// ── 关于 net/fetch（尚未实现）──────────────────────────────
//
// 这里曾有三个从未被调用的守卫：is_safe_url / is_public_v4 / is_blocked_v6，
// 是为「插件让宿主去抓某个 URL」这个能力预留的。该能力至今未实现（没有任何端点），
// 所以它们是纯死代码，已删除 —— 保留"从未接线的安全代码"比没有更危险：
// 它会让后来人以为防护已经存在。
//
// 将来真要实现 net/fetch，必须带走的经验（原注释要点）：
//  1. 只做语法判定是不够的，**必须 resolve-then-pin**：解析域名拿到 IP，按 IP 复查，
//     并钉住该 IP 去连接（否则 DNS rebinding 可以绕过）。
//  2. IPv6 字面量要用 `url::Url::host()` 判断，不要用 `host_str()` + `parse::<IpAddr>()`：
//     `host_str()` 对 IPv6 返回带方括号的 `[::1]`，`parse` 会失败，于是**回环地址被当成域名放过去**。
//  3. 要拦的是：非 https、回环（127/8、::1）、私网（10/8、172.16/12、192.168/16、fc00::/7）、
//     链路本地（169.254/16、fe80::/10）、以及 0.0.0.0 与广播地址。
//  4. 插件与宿主同权、本可直接连任何地址，所以这道守卫防的**不是**恶意插件，
//     而是"插件把用户凭据发到我们没审计过的地方"这类间接风险。

// ---------------------------------------------------------------------------
// HTTP 层
// ---------------------------------------------------------------------------

/// 一个插件会话：token → 身份与权限
#[derive(Clone)]
pub struct PluginSession {
    pub plugin_id: String,
    pub granted: Vec<String>,
    /// **已不是项目根的真源**：项目根改由进程级的 [`project_context::ProjectContext`]
    /// 提供（设计 §7.2「打开/切换项目时注册」，而不是插件启动时）。
    /// 字段保留是为了「会话建立时确实带过一个 root」这件事仍有处可查（迁移/测试方便）；
    /// 读取一律 `动态值.or(这个值)`，动态值优先。
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
    /// 当前项目根。生产路径用进程级单例（[`shared_project_context`]），
    /// 这样「前端调 `plugins_set_project`」与「早已起着的 HTTP 服务」看到的是同一份。
    pub project: Arc<project_context::ProjectContext>,
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
/// 单条日志上限：只按条数封顶不够 —— axum 默认 body 上限 2MB，
/// 500 条 × 2MB ≈ 1GB 常驻内存，插件反复发大消息就能把宿主撑爆。
const MAX_LOG_MESSAGE_BYTES: usize = 4 * 1024;
/// 单次读取上限：`read_to_string` 会按文件大小一次性分配，
/// 项目里一个大文件就能让 tokio worker 阻塞并吃掉 GB 级内存。
const MAX_READ_BYTES: u64 = 8 * 1024 * 1024;

/// 日志级别白名单：插件写什么都不能污染宿主的级别语义，不认识的降级成 `info`。
fn normalize_level(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "trace" => "trace",
        "debug" => "debug",
        "warn" => "warn",
        "error" => "error",
        _ => "info",
    }
}

/// 抹平换行 + 截断超长消息。
///
/// 换行必须去掉：否则插件可以在一条日志里伪造出「宿主级」的下一行（日志注入）。
/// 截断按 `char_boundary` 回退，避免切断 UTF-8 造成非法字符串。
fn sanitize_message(raw: &str) -> String {
    let flat: String = raw
        .chars()
        .map(|c| if c == '\r' || c == '\n' { ' ' } else { c })
        .collect();
    if flat.len() > MAX_LOG_MESSAGE_BYTES {
        let mut cut = MAX_LOG_MESSAGE_BYTES;
        while cut > 0 && !flat.is_char_boundary(cut) {
            cut -= 1;
        }
        format!("{}…(truncated)", &flat[..cut])
    } else {
        flat
    }
}

impl HostApiState {
    /// 新建一个空的宿主能力面状态（会话由安装/启动流程逐步登记）。
    ///
    /// 项目上下文用**独立实例**而不是进程级单例：这是测试与「一次性状态」的正确语义
    /// （多个用例并行跑时不会互相看到对方的项目）。生产路径走 [`shared_state`]。
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            log_sink: Arc::new(Mutex::new(Vec::new())),
            project: Arc::new(project_context::ProjectContext::new()),
        }
    }

    /// 从 `Authorization: Bearer <token>` 取 token 查表。
    ///
    /// 查不到就返回 `None`：handler 一律以 401 结束，不区分「没带 token」与
    /// 「token 错了」—— 后者不告诉调用方「这个 token 格式对但过期了」，
    /// 免得成为爆破探针的判别信号。
    pub fn session(&self, headers: &HeaderMap) -> Option<PluginSession> {
        let raw = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
        // scheme 名按 HTTP 规范大小写不敏感（`bearer` / `Bearer` 都得认），
        // 但 token 部分逐字比较。
        let (scheme, token) = raw.split_once(' ')?;
        if !scheme.eq_ignore_ascii_case("bearer") {
            return None;
        }
        let token = token.trim();
        if token.is_empty() {
            return None;
        }
        let sessions = self.sessions.lock().ok()?;
        sessions.get(token).cloned()
    }

    /// 当前项目根：**以进程级动态值为准**，会话里的旧值只做兜底。
    ///
    /// 为什么不直接用 `session.project_root`：会话是插件**启动时**建的，而用户可以在
    /// 插件跑着的时候切换项目（设计 §7.2）。只有动态值才能反映「现在打开的是哪个项目」。
    /// 兜底是为了兼容「会话自带 root」的老路径与测试（v2 之前没有任何动态来源）。
    pub fn project_root(&self, session: &PluginSession) -> Option<PathBuf> {
        self.project
            .get()
            .or_else(|| session.project_root.clone())
    }
}

impl Default for HostApiState {
    fn default() -> Self {
        Self::new()
    }
}

/// 进程级会话表。
///
/// 为什么需要单例：`start_plugin` 每条命令都会构造一次 `HostApiState`，但 HTTP
/// handler 在另一个任务里长期运行；如果每次用 `HostApiState::new()`，注册进去的
/// token 对正在跑的 server 不可见。会话表必须是进程级、所有 state 共享的同一份。
static SESSIONS: OnceLock<Arc<Mutex<HashMap<String, PluginSession>>>> = OnceLock::new();

fn session_store() -> &'static Arc<Mutex<HashMap<String, PluginSession>>> {
    SESSIONS.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

/// 把会话里的数据目录钉成绝对路径。
///
/// `paths::plugin_data_dir` 只是把插件根和 `<id>.data` 拼起来：插件根默认来自
/// `app_data_dir()`（绝对），但 `QMAI_PLUGIN_HOME` 是开发用覆盖，可以被设成相对路径
/// （如 `plugins`）。而插件进程的 cwd 是插件目录（`supervisor::build_command`），
/// 同一个相对路径在宿主和插件两边会解析到**两个不同目录** —— 宿主建的目录插件写不到。
/// 所以会话建立时就把相对值钉成绝对，两边指向同一处。
///
/// 用 `std::path::absolute`（不碰文件系统、不解析 `..`）：失败只可能是拿不到 cwd，
/// 那就退回原值，让插件写入时得到真实错误，也好过宿主在这里 panic。
fn absolute_data_root(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        return path;
    }
    match std::path::absolute(&path) {
        Ok(absolute) => absolute,
        Err(_) => path,
    }
}

/// 注册一个插件会话（token → 身份与权限）。重复注册同一 token 会覆盖。
///
/// 顺带把 `data_root` 钉成绝对路径并创建它：插件拿到 `/host/status` 的 `dataRoot`
/// 就该能直接往里写，不该先自己 mkdir 一遍。放在这里而不是 `start_plugin` 里，
/// 是因为「会话可见」与「目录可用」必须是同一个时刻，否则插件在启动早期拿到路径
/// 仍可能写失败。创建失败**不阻断启动**：只读盘、配额打满这类情况下宿主的正确姿态
/// 是让插件照常起来，由它自己写入时得到真实错误（而不是整个插件因为建不了一个
/// 空目录就启不来）。
pub fn register_session(token: &str, mut session: PluginSession) {
    session.data_root = absolute_data_root(session.data_root);
    let _ = std::fs::create_dir_all(&session.data_root);
    if let Ok(mut sessions) = session_store().lock() {
        sessions.insert(token.to_string(), session);
    }
}

/// 注销一个插件会话（停用/卸载时调用，避免 token 继续有效）。
pub fn unregister_session(token: &str) {
    if let Ok(mut sessions) = session_store().lock() {
        sessions.remove(token);
    }
}

/// 进程级「当前项目」。
///
/// 与会话表同理：`plugins_set_project` 命令与 HTTP 服务分处两个任务，
/// 只有共享同一个实例，「打开/切换项目」才对已经在跑的插件生效（设计 §7.2）。
static PROJECT: OnceLock<Arc<project_context::ProjectContext>> = OnceLock::new();

/// 取进程级的项目上下文（首次调用时创建）。
pub fn shared_project_context() -> Arc<project_context::ProjectContext> {
    PROJECT
        .get_or_init(|| Arc::new(project_context::ProjectContext::new()))
        .clone()
}

/// 构造一个共享同一会话表的 [`HostApiState`]（`start` 时用）。
///
/// 日志环仍是每个 state 独立的：当前没有命令读取它，等日志查看功能落地时
/// 再决定是否也要进程级共享。
pub fn shared_state() -> HostApiState {
    HostApiState {
        sessions: session_store().clone(),
        log_sink: Arc::new(Mutex::new(Vec::new())),
        project: shared_project_context(),
    }
}

/// 测试辅助：统计某个插件在全局会话表里的残留数量。
/// 失败路径测试用它断言「进程没起来时 token 也必须注销」。
#[cfg(test)]
pub(crate) fn sessions_for_plugin(plugin_id: &str) -> usize {
    session_store()
        .lock()
        .map(|sessions| {
            sessions
                .values()
                .filter(|session| session.plugin_id == plugin_id)
                .count()
        })
        .unwrap_or(0)
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

/// 错误码 → HTTP 状态 + `{"error": <code>}`。
///
/// 统一出口，避免每个 handler 各写一套 status/JSON 组合而漂移；
/// 依赖方（插件 SDK）只认 error 码，状态码用于快速分流。
fn error_response(code: &str) -> Response {
    let status = match code {
        "E_NO_PROJECT"
        | "E_PATH_ESCAPE"
        | "E_FILE_TOO_LARGE"
        | "E_FIELD_NOT_ALLOWED"
        | "E_CHAPTER_ID_INVALID" => StatusCode::BAD_REQUEST,
        "E_NOT_FOUND" => StatusCode::NOT_FOUND,
        // 501：契约存在、宿主还没接实现。用 400 会诱导插件以为是它参数写错了而反复重试。
        "E_FIELD_WRITE_UNSUPPORTED" | "E_NOTE_WRITE_UNSUPPORTED" => StatusCode::NOT_IMPLEMENTED,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, Json(serde_json::json!({ "error": code }))).into_response()
}

/// 读失败：只回报错误种类，**不回绝对路径**（回路径等于把宿主目录结构告诉插件）。
fn read_failed(kind: std::io::ErrorKind) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({
            "error": "E_READ_FAILED",
            "message": format!("{:?}", kind),
        })),
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
        // 项目根走动态值：插件在 initialize 之后才可能拿到项目，不可能更早。
        "projectRoot": state.project_root(&session).map(|p| p.to_string_lossy().to_string()),
        // 插件的私有数据目录（绝对路径：`register_session` 会把相对值钉成绝对并创建）。
        // 凭证、缓存都该存这里：插件是子进程，不能假设自己知道插件根在哪，
        // 靠 cwd 反推会随启动方式变化而断裂（`supervisor::build_command` 现在把 cwd
        // 设成插件目录，但那是实现细节，插件侧不该依赖它去拼 `../<id>.data`）。
        "dataRoot": session.data_root.to_string_lossy(),
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
        level: normalize_level(&body.level).to_string(),
        message: sanitize_message(&body.message),
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
    // 顺序固定：先 token、再权限、最后路径。反过来会把「路径存在性」泄漏给无权限插件。
    if let Err(permission) = require(&session.granted, "fs:project-read") {
        return forbidden(&permission);
    }
    let Some(root) = state.project_root(&session) else {
        // 没有项目就没有可读的目录；这不算逃逸，单独给个码便于插件区分。
        return error_response("E_NO_PROJECT");
    };
    // 第一道闸门：词法（便宜，不碰文件系统，挡 `../` 与绝对路径越界）
    if !is_inside(&root, &body.path) {
        return error_response("E_PATH_ESCAPE");
    }
    // 第二道闸门：解析真实路径（挡符号链接 / junction）。后续读的必须是它返回的
    // real_path，而不是 body.path —— 检查对象与使用对象必须是同一个。
    let real_path = match canonical_inside(&root, Path::new(&body.path)) {
        Ok(path) => path,
        Err(code) => return error_response(code),
    };
    let meta = match std::fs::metadata(&real_path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return error_response("E_NOT_FOUND")
        }
        Err(error) => return read_failed(error.kind()),
    };
    if meta.len() > MAX_READ_BYTES {
        return error_response("E_FILE_TOO_LARGE");
    }
    // 读放阻塞线程池：本项目 tokio 没开 `fs` feature，直接在 async 里 `read_to_string`
    // 会把 worker 线程按文件大小阻塞住；`spawn_blocking` 不需要额外 feature。
    let read_path = real_path.clone();
    match tokio::task::spawn_blocking(move || std::fs::read_to_string(&read_path)).await {
        Ok(Ok(content)) => Json(serde_json::json!({ "content": content })).into_response(),
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            error_response("E_NOT_FOUND")
        }
        Ok(Err(error)) => read_failed(error.kind()),
        // 阻塞任务自己 panic 了：是宿主内部问题，不能伪装成「文件不存在」
        Err(_) => read_failed(std::io::ErrorKind::Other),
    }
}

// ── 项目读写地基（设计 §7）────────────────────────────
//
// 三个端点的共同前置：token → 权限 → 项目存在 → 再干活。顺序固定，理由同
// `project_read`：反过来会把「有没有打开项目」这类信息泄漏给无权限插件。

/// `GET /host/project/info`：项目快照，够插件在提示词里引用书名/简介/章节数。
async fn project_info(State(state): State<HostApiState>, headers: HeaderMap) -> Response {
    let Some(session) = state.session(&headers) else {
        return unauthorized();
    };
    if let Err(permission) = require(&session.granted, "fs:project-read") {
        return forbidden(&permission);
    }
    let Some(root) = state.project_root(&session) else {
        return error_response("E_NO_PROJECT");
    };
    // 读元数据 + 数章节会碰文件系统：放阻塞线程池（同 `project_read` 的理由）。
    match tokio::task::spawn_blocking(move || project_context::read_project_info(&root)).await {
        Ok(info) => Json(info).into_response(),
        Err(_) => read_failed(std::io::ErrorKind::Other),
    }
}

#[derive(Deserialize)]
pub struct FieldBody {
    pub field: String,
    #[serde(default)]
    pub value: serde_json::Value,
}

/// `POST /host/project/field`：写一个**枚举内**的项目字段（设计 D9）。
///
/// 枚举外的字段名一律 `E_FIELD_NOT_ALLOWED`；枚举内但宿主还没接写入的，
/// 回 `E_FIELD_WRITE_UNSUPPORTED`（501）。**绝不提供任意路径写入**。
async fn project_field(
    State(state): State<HostApiState>,
    headers: HeaderMap,
    Json(body): Json<FieldBody>,
) -> Response {
    let Some(session) = state.session(&headers) else {
        return unauthorized();
    };
    // 写权限单独一条：读项目与改项目是两件性质完全不同的事（设计 §4 权限表）。
    if let Err(permission) = require(&session.granted, "fs:project-write") {
        return forbidden(&permission);
    }
    let Some(root) = state.project_root(&session) else {
        return error_response("E_NO_PROJECT");
    };
    let outcome = tokio::task::spawn_blocking(move || {
        project_context::write_project_field(&root, &body.field, &body.value)
    })
    .await;
    match outcome {
        Ok(Ok(())) => Json(serde_json::json!({ "ok": true })).into_response(),
        Ok(Err(code)) => error_response(code),
        Err(_) => read_failed(std::io::ErrorKind::Other),
    }
}

#[derive(Deserialize)]
pub struct ChapterNoteBody {
    #[serde(rename = "chapterId")]
    pub chapter_id: String,
    #[serde(default)]
    pub note: String,
}

/// `POST /host/project/chapter-note`：向当前章节追加备注（只追加、不改正文）。
///
/// 与 `project_field` 同构：**先校验再判断能力**，能力不具备就明确回
/// `E_NOTE_WRITE_UNSUPPORTED`，而不是往正文或备份快照里塞字。
async fn project_chapter_note(
    State(state): State<HostApiState>,
    headers: HeaderMap,
    Json(body): Json<ChapterNoteBody>,
) -> Response {
    let Some(session) = state.session(&headers) else {
        return unauthorized();
    };
    if let Err(permission) = require(&session.granted, "fs:project-write") {
        return forbidden(&permission);
    }
    let Some(root) = state.project_root(&session) else {
        return error_response("E_NO_PROJECT");
    };
    let outcome = tokio::task::spawn_blocking(move || {
        project_context::append_chapter_note(&root, &body.chapter_id, &body.note)
    })
    .await;
    match outcome {
        Ok(Ok(())) => Json(serde_json::json!({ "ok": true })).into_response(),
        Ok(Err(code)) => error_response(code),
        Err(_) => read_failed(std::io::ErrorKind::Other),
    }
}

pub fn router(state: HostApiState) -> Router {
    Router::new()
        .route("/host/status", get(status))
        .route("/host/log", post(log))
        .route("/host/project/read", post(project_read))
        .route("/host/project/info", get(project_info))
        .route("/host/project/field", post(project_field))
        .route("/host/project/chapter-note", post(project_chapter_note))
        .with_state(state)
}

/// 起一个只绑回环的宿主 API，返回实际端口。
///
/// 同步绑定 + `spawn_task` 起服务：调用方通常是 Tauri 的同步初始化路径。
/// 没有运行时 / `from_std` 失败时**不静默**：前者直接返回 Err（否则调用方会拿着
/// 一个永不应答的端口去接插件），后者打一条可诊断日志。都不 panic。
pub fn start(state: HostApiState) -> Result<u16, String> {
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| format!("无法监听宿主 API 端口：{e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    if tokio::runtime::Handle::try_current().is_err() {
        return Err(format!(
            "宿主 API 无法监听：当前没有 Tokio 运行时（已绑定端口 {port}，服务未启动）"
        ));
    }
    let app = router(state);
    super::spawn_task(async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(l) => {
                let _ = axum::serve(l, app).await;
            }
            Err(error) => {
                // 拿不到监听器意味着运行时已经异常（端口本就为 0 分配）。
                eprintln!("[plugins] 宿主 API 未能接管监听器，服务未启动：{error}");
            }
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
    fn log_level_whitelist_and_message_sanitizing() {
        assert_eq!(normalize_level("WARN"), "warn");
        assert_eq!(normalize_level(" trace "), "trace");
        assert_eq!(normalize_level("verbose"), "info");
        assert_eq!(normalize_level(""), "info");
        // 换行必须被抹平：否则插件可以伪造一行「宿主级」日志
        assert_eq!(sanitize_message("a\r\nb\nc"), "a  b c");
        // 超长消息按字符边界截断，且不切断 UTF-8
        let long = "中".repeat(MAX_LOG_MESSAGE_BYTES);
        let cut = sanitize_message(&long);
        assert!(cut.len() <= MAX_LOG_MESSAGE_BYTES + "…(truncated)".len());
        assert!(cut.ends_with("…(truncated)"));
        assert!(std::str::from_utf8(cut.as_bytes()).is_ok());
        // 不超长就原样保留
        assert_eq!(sanitize_message("hello"), "hello");
    }

    // ------------------------------------------------------------------
    // 文件系统闸门：符号链接 / junction 逃逸 + canonical 复检
    // ------------------------------------------------------------------

    /// 临时目录（不引入 tempfile 依赖）：进程号 + 纳秒时间戳保证唯一。
    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "qmai-hostapi-{tag}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("创建临时目录");
        dir
    }

    /// 建一个指向 `target` 的目录链接（unix symlink / Windows symlink 或 junction）。
    ///
    /// Windows 普通用户没有 `SeCreateSymbolicLinkPrivilege`，`symlink_dir` 会报
    /// os error 1314；但 NTFS junction 不需要特权，所以退一步用 `mklink /J`。
    /// junction 与 symlink 在 `canonicalize` 眼里都是重解析点，对本用例等价。
    fn try_symlink_dir(target: &Path, link: &Path) -> std::io::Result<()> {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link)
        }
        #[cfg(windows)]
        {
            if std::os::windows::fs::symlink_dir(target, link).is_ok() {
                return Ok(());
            }
            let status = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .status()?;
            if status.success() && link.exists() {
                Ok(())
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!("symlink 与 mklink /J 都失败（{status}）"),
                ))
            }
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = (target, link);
            Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "本平台不支持符号链接测试",
            ))
        }
    }

    /// 删掉链接本身（不能跟随进目标目录）。
    fn remove_link(link: &Path) {
        if std::fs::remove_dir(link).is_err() {
            let _ = std::process::Command::new("cmd")
                .args(["/C", "rmdir"])
                .arg(link)
                .status();
        }
    }

    #[test]
    fn symlink_escape_is_rejected_by_canonical_check() {
        // 词法上 link/secret.md 在 root 内，但真实路径在 root 外 —— 必须拒绝。
        let root = temp_dir("sym-root");
        let inside = root.join("wiki");
        std::fs::create_dir_all(&inside).expect("建项目内目录");
        std::fs::write(inside.join("01.md"), "项目内正文").expect("写项目内文件");

        let outside = temp_dir("sym-outside");
        std::fs::write(outside.join("secret.md"), "TOPSECRET").expect("写外部文件");

        let link = root.join("link");
        if let Err(error) = try_symlink_dir(&outside, &link) {
            // 跳过时必须说清原因，且仍然验证一件真事：外部绝对路径被拒。
            eprintln!("跳过符号链接用例：本机无法创建链接（{error}）");
            assert!(canonical_inside(&root, &outside.join("secret.md")).is_err());
            let _ = std::fs::remove_dir_all(&root);
            let _ = std::fs::remove_dir_all(&outside);
            return;
        }

        let escaped = link.join("secret.md");
        // 词法闸门确实被绕过（这就是漏洞点，留着断言免得有人把词法闸门删掉）
        assert!(is_inside(&root, escaped.to_str().unwrap()));
        // canonical 复检必须拦住
        assert_eq!(
            canonical_inside(&root, &escaped).unwrap_err(),
            "E_PATH_ESCAPE"
        );

        // 真正在内部的路径要放行，且返回可安全使用的真实路径
        let ok = canonical_inside(&root, &inside.join("01.md")).expect("内部路径应放行");
        assert_eq!(
            std::fs::read_to_string(&ok).expect("读内部文件"),
            "项目内正文"
        );
        // 根目录自身仍不算「文件」
        assert_eq!(canonical_inside(&root, &root).unwrap_err(), "E_PATH_ESCAPE");

        remove_link(&link);
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    // ------------------------------------------------------------------
    // handler 级测试：起真实回环端口 + reqwest 发请求
    // ------------------------------------------------------------------

    /// 测试用的回环 client。
    ///
    /// 必须 `.no_proxy()`：这些桩全部打 `127.0.0.1`，而 `proxy.rs` 的用例会临时设置
    /// 进程级 `HTTP_PROXY/ALL_PROXY`（`bypassLocal=false` 那一档连回环也走代理），
    /// 不绕过代理会让本组用例随机 502。生产侧同样处理见 `provider_http_client`。
    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("构造测试用 reqwest client")
    }

    /// 起一个真实的 HostApi，返回 base URL。
    /// 服务随测试运行时一起销毁（`start` 把 serve 挂到当前 Tokio 运行时上）。
    async fn spawn_test_api(state: HostApiState) -> String {
        let port = super::start(state).expect("宿主 API 应能起在回环端口上");
        format!("http://127.0.0.1:{port}")
    }

    fn session(root: Option<PathBuf>, perms: &[&str]) -> PluginSession {
        PluginSession {
            plugin_id: "demo.novel".to_string(),
            granted: granted(perms),
            project_root: root,
            // 与生产同构：`<插件根>/<id>.data`，父目录（插件根，这里用临时目录代替）已存在。
            data_root: temp_dir("data-root").join("demo.novel.data"),
        }
    }

    fn state_with(token: &str, session: PluginSession) -> HostApiState {
        let state = HostApiState::new();
        state
            .sessions
            .lock()
            .expect("会话表")
            .insert(token.to_string(), session);
        state
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn handler_returns_401_without_valid_token() {
        let state = state_with("tok-good", session(None, &["data:write"]));
        let base = spawn_test_api(state).await;
        let client = test_client();

        // 没带 token
        let response = client
            .get(format!("{base}/host/status"))
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 401);
        assert_eq!(response.text().await.expect("读 body"), "invalid token");

        // 带了但不存在
        let response = client
            .get(format!("{base}/host/status"))
            .bearer_auth("tok-bad")
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 401);

        // 前缀大小写不该影响识别
        let response = client
            .get(format!("{base}/host/status"))
            .header("Authorization", "bearer tok-good")
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 200);
    }

    /// `/host/status` 必须直接给出插件私有数据目录的**绝对路径**。
    ///
    /// 插件是子进程，宿主没通过环境变量告诉过它插件根在哪；文档只写了「存在
    /// `<插件根>/<id>.data/`」。不暴露这个字段时，插件只能靠 cwd（`supervisor` 现在把
    /// cwd 设成插件目录）拼 `../<id>.data/` —— 那是实现细节，启动方式一变就断。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn host_status_exposes_data_root() {
        let state = state_with("tok", session(None, &["data:write"]));
        let base = spawn_test_api(state).await;

        let body: serde_json::Value = test_client()
            .get(format!("{base}/host/status"))
            .bearer_auth("tok")
            .send()
            .await
            .expect("请求")
            .json()
            .await
            .expect("JSON");

        let data_root = body["dataRoot"].as_str().expect("dataRoot 应是字符串");
        assert!(!data_root.is_empty(), "dataRoot 不能为空");
        assert!(
            Path::new(data_root).is_absolute(),
            "dataRoot 必须是绝对路径（插件无法据此再拼相对路径）：{data_root}"
        );
        // 约定是 `<插件根>/<id>.data`：以 `.data` 结尾，插件才能判断「这是宿主给我的目录」
        // 而不是顺手拿到了别的路径。
        assert!(
            data_root.ends_with(".data"),
            "dataRoot 应以 .data 结尾：{data_root}"
        );
    }

    /// 相对 `data_root` 必须被钉成绝对：宿主与插件的 cwd 不同，同一个相对值在两边
    /// 会解析到不同目录（宿主建了目录、插件却写到别处）。
    #[test]
    fn relative_data_root_is_pinned_to_absolute() {
        let pinned = absolute_data_root(PathBuf::from("qmai-relative-root/demo.novel.data"));
        assert!(
            pinned.is_absolute(),
            "相对路径必须被钉成绝对：{}",
            pinned.display()
        );
        assert!(pinned.ends_with("demo.novel.data"));

        // 已是绝对路径就原样返回：这里不做规范化，免得与调用方手里的形态不一致。
        let already = temp_dir("absolute").join("demo.novel.data");
        assert_eq!(absolute_data_root(already.clone()), already);
    }

    /// 注册会话后数据目录必须真实存在，且可写：插件拿到 `dataRoot` 就该能直接落凭证。
    #[test]
    fn data_root_directory_exists_after_register_session() {
        let data_root = temp_dir("register").join("demo.novel.data");
        assert!(!data_root.exists(), "前置条件：注册前目录不该存在");

        let token = format!("test-data-root-{}", uuid::Uuid::new_v4());
        register_session(
            &token,
            PluginSession {
                plugin_id: "demo.novel".to_string(),
                granted: granted(&["data:write"]),
                project_root: None,
                data_root: data_root.clone(),
            },
        );

        assert!(
            data_root.is_dir(),
            "注册会话后数据目录应已就绪：{}",
            data_root.display()
        );
        // 「存在」不等于「能写」：验证真正被承诺的那件事。
        let probe = data_root.join("probe.txt");
        std::fs::write(&probe, "ok").expect("数据目录应可写");
        assert_eq!(std::fs::read_to_string(&probe).expect("读回"), "ok");

        unregister_session(&token);
        let _ = std::fs::remove_file(&probe);
        let _ = std::fs::remove_dir_all(&data_root);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn handler_returns_403_json_without_permission() {
        let root = temp_dir("perm");
        std::fs::write(root.join("01.md"), "正文").expect("写文件");
        let state = state_with("tok", session(Some(root.clone()), &["data:write"]));
        let base = spawn_test_api(state).await;

        let response = test_client()
            .post(format!("{base}/host/project/read"))
            .bearer_auth("tok")
            .json(&serde_json::json!({ "path": root.join("01.md").to_string_lossy() }))
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 403);
        let body: serde_json::Value = response.json().await.expect("403 应是 JSON");
        assert_eq!(body["error"], "E_PERMISSION_DENIED");
        assert_eq!(body["permission"], "fs:project-read");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn handler_rejects_path_escape_and_missing_file() {
        let root = temp_dir("escape");
        std::fs::create_dir_all(root.join("wiki")).expect("建目录");
        let state = state_with("tok", session(Some(root.clone()), &["fs:project-read"]));
        let base = spawn_test_api(state).await;
        let client = test_client();

        // 词法穿越
        let escaped = format!("{}/wiki/../../../etc/passwd", root.display());
        let response = client
            .post(format!("{base}/host/project/read"))
            .bearer_auth("tok")
            .json(&serde_json::json!({ "path": escaped }))
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 400);
        let body: serde_json::Value = response.json().await.expect("JSON");
        assert_eq!(body["error"], "E_PATH_ESCAPE");

        // 路径干净但文件不存在 → 404（不是 400，也不回绝对路径）
        let missing = root.join("nope.md");
        let response = client
            .post(format!("{base}/host/project/read"))
            .bearer_auth("tok")
            .json(&serde_json::json!({ "path": missing.to_string_lossy() }))
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 404);
        let body: serde_json::Value = response.json().await.expect("JSON");
        assert_eq!(body["error"], "E_NOT_FOUND");
        assert!(
            !body.to_string().contains(&root.display().to_string()),
            "错误体不该回绝对路径：{body}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn handler_reads_project_file() {
        let root = temp_dir("read");
        let file = root.join("chapter.md");
        std::fs::write(&file, "# 第一章\n正文").expect("写文件");
        let state = state_with("tok", session(Some(root.clone()), &["fs:project-read"]));
        let base = spawn_test_api(state).await;

        let response = test_client()
            .post(format!("{base}/host/project/read"))
            .bearer_auth("tok")
            .json(&serde_json::json!({ "path": file.to_string_lossy() }))
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 200);
        let body: serde_json::Value = response.json().await.expect("JSON");
        assert_eq!(body["content"], "# 第一章\n正文");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn handler_rejects_file_over_size_limit() {
        let root = temp_dir("big");
        let file = root.join("huge.md");
        std::fs::write(&file, vec![b'a'; MAX_READ_BYTES as usize + 1]).expect("写大文件");
        let state = state_with("tok", session(Some(root.clone()), &["fs:project-read"]));
        let base = spawn_test_api(state).await;

        let response = test_client()
            .post(format!("{base}/host/project/read"))
            .bearer_auth("tok")
            .json(&serde_json::json!({ "path": file.to_string_lossy() }))
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 400);
        let body: serde_json::Value = response.json().await.expect("JSON");
        assert_eq!(body["error"], "E_FILE_TOO_LARGE");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn handler_rejects_symlink_escape_end_to_end() {
        let root = temp_dir("symlink-http");
        let outside = temp_dir("symlink-outside");
        std::fs::write(outside.join("secret.md"), "TOPSECRET").expect("写外部文件");
        let link = root.join("link");
        if let Err(error) = try_symlink_dir(&outside, &link) {
            eprintln!("跳过端到端链接用例：本机无法创建链接（{error}）");
            let _ = std::fs::remove_dir_all(&root);
            let _ = std::fs::remove_dir_all(&outside);
            return;
        }
        let state = state_with("tok", session(Some(root.clone()), &["fs:project-read"]));
        let base = spawn_test_api(state).await;

        let response = test_client()
            .post(format!("{base}/host/project/read"))
            .bearer_auth("tok")
            .json(&serde_json::json!({ "path": link.join("secret.md").to_string_lossy() }))
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 400);
        let body: serde_json::Value = response.json().await.expect("JSON");
        assert_eq!(body["error"], "E_PATH_ESCAPE");

        remove_link(&link);
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn handler_accepts_log_and_keeps_it_in_ring() {
        let state = state_with("tok", session(None, &["data:write"]));
        let sink = state.log_sink.clone();
        let base = spawn_test_api(state).await;

        let response = test_client()
            .post(format!("{base}/host/log"))
            .bearer_auth("tok")
            .json(&serde_json::json!({
                "level": "WARN",
                "message": "第一行\r\n伪造宿主行",
            }))
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 204);

        let lines = sink.lock().expect("日志环");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].plugin_id, "demo.novel");
        assert_eq!(lines[0].level, "warn");
        assert_eq!(lines[0].message, "第一行  伪造宿主行");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn handler_reports_status_fields() {
        let root = temp_dir("status");
        let state = state_with(
            "tok",
            session(Some(root.clone()), &["fs:project-read", "data:write"]),
        );
        let base = spawn_test_api(state).await;

        let response = test_client()
            .get(format!("{base}/host/status"))
            .bearer_auth("tok")
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 200);
        let body: serde_json::Value = response.json().await.expect("JSON");
        assert_eq!(body["hostVersion"], env!("CARGO_PKG_VERSION"));
        assert_eq!(body["pluginId"], "demo.novel");
        assert_eq!(body["grantedPermissions"][0], "fs:project-read");
        assert!(body["projectRoot"]
            .as_str()
            .expect("projectRoot 应是字符串")
            .contains("qmai-hostapi-status"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn handler_returns_no_project_code_without_root() {
        let state = state_with("tok", session(None, &["fs:project-read"]));
        let base = spawn_test_api(state).await;

        let response = test_client()
            .post(format!("{base}/host/project/read"))
            .bearer_auth("tok")
            .json(&serde_json::json!({ "path": "/etc/passwd" }))
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 400);
        let body: serde_json::Value = response.json().await.expect("JSON");
        assert_eq!(body["error"], "E_NO_PROJECT");
    }

    // ------------------------------------------------------------------
    // 项目读写地基（设计 §7）：info / field / chapter-note
    // ------------------------------------------------------------------

    /// 造一个最小项目结构：`QM/chapters/` 下两章 + 一份 `.novel/project-meta.json`。
    fn make_project(tag: &str) -> PathBuf {
        let root = temp_dir(tag);
        let chapters = root.join("QM").join("chapters");
        std::fs::create_dir_all(&chapters).expect("建章节目录");
        std::fs::write(chapters.join("第1章 开局.md"), "正文一").expect("写第一章");
        std::fs::write(chapters.join("第2章 转折.md"), "正文二").expect("写第二章");
        std::fs::create_dir_all(root.join(".novel")).expect("建 .novel");
        std::fs::write(
            root.join(".novel/project-meta.json"),
            r#"{"title":"长夜将至","description":"一句话简介"}"#,
        )
        .expect("写项目元数据");
        root
    }

    /// 任务 1 · 用例 1：设了项目之后 info 能读到元数据（不再恒 E_NO_PROJECT）。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn set_project_then_info_returns_metadata() {
        let root = make_project("info");
        // 会话里**不带** root：只有进程级动态值，这才是生产路径的样子。
        let state = state_with("tok", session(None, &["fs:project-read"]));
        state.project.set(Some(root.clone()));
        let base = spawn_test_api(state).await;

        let response = test_client()
            .get(format!("{base}/host/project/info"))
            .bearer_auth("tok")
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 200);
        let body: serde_json::Value = response.json().await.expect("JSON");
        assert_eq!(body["bookTitle"], "长夜将至");
        assert_eq!(body["intro"], "一句话简介");
        assert_eq!(body["chapterCount"], 2);
        assert_eq!(body["fieldApiVersion"], 1);
        assert!(body["tags"].as_array().expect("tags 应是数组").is_empty());
        assert!(
            body["root"]
                .as_str()
                .expect("root 应是字符串")
                .contains("qmai-hostapi-info"),
            "root 应是当前项目根：{body}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 任务 1 · 用例 2：枚举外的字段名必须拒绝（D9：写项目只走枚举）。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn project_field_rejects_unknown_field() {
        let root = make_project("field-unknown");
        let state = state_with("tok", session(None, &["fs:project-read", "fs:project-write"]));
        state.project.set(Some(root.clone()));
        let base = spawn_test_api(state).await;

        let response = test_client()
            .post(format!("{base}/host/project/field"))
            .bearer_auth("tok")
            .json(&serde_json::json!({ "field": "chapterBody", "value": "随便改正文" }))
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 400);
        let body: serde_json::Value = response.json().await.expect("JSON");
        assert_eq!(body["error"], "E_FIELD_NOT_ALLOWED");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 任务 1 · 用例 3：写字段必须持 `fs:project-write`（这条权限到本次改动才真正有用）。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn project_field_write_requires_fs_project_write() {
        let root = make_project("field-perm");
        // 只给读权限：写入必须 403，且要告诉插件缺的是哪条权限。
        let state = state_with("tok", session(None, &["fs:project-read"]));
        state.project.set(Some(root.clone()));
        let base = spawn_test_api(state).await;

        let response = test_client()
            .post(format!("{base}/host/project/field"))
            .bearer_auth("tok")
            .json(&serde_json::json!({ "field": "bookTitle", "value": "新书名" }))
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 403);
        let body: serde_json::Value = response.json().await.expect("JSON");
        assert_eq!(body["error"], "E_PERMISSION_DENIED");
        assert_eq!(body["permission"], "fs:project-write");

        // 同一条件对 chapter-note 成立：漏一条就多一个绕过权限的写入口。
        let response = test_client()
            .post(format!("{base}/host/project/chapter-note"))
            .bearer_auth("tok")
            .json(&serde_json::json!({ "chapterId": "ch-1", "note": "备注" }))
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 403);
        let body: serde_json::Value = response.json().await.expect("JSON");
        assert_eq!(body["permission"], "fs:project-write");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 任务 1 · 用例 4：没有项目时三个新端点都必须回 `E_NO_PROJECT`（沿用既有错误码）。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn no_project_returns_e_no_project() {
        let state = state_with(
            "tok",
            session(None, &["fs:project-read", "fs:project-write"]),
        );
        // 动态值为 None、会话也没有 root → 确实是「没打开项目」
        let base = spawn_test_api(state).await;
        let client = test_client();

        let info = client
            .get(format!("{base}/host/project/info"))
            .bearer_auth("tok")
            .send()
            .await
            .expect("请求");
        assert_eq!(info.status(), 400);
        assert_eq!(
            info.json::<serde_json::Value>().await.expect("JSON")["error"],
            "E_NO_PROJECT"
        );

        let field = client
            .post(format!("{base}/host/project/field"))
            .bearer_auth("tok")
            .json(&serde_json::json!({ "field": "bookTitle", "value": "x" }))
            .send()
            .await
            .expect("请求");
        assert_eq!(field.status(), 400);
        assert_eq!(
            field.json::<serde_json::Value>().await.expect("JSON")["error"],
            "E_NO_PROJECT"
        );

        let note = client
            .post(format!("{base}/host/project/chapter-note"))
            .bearer_auth("tok")
            .json(&serde_json::json!({ "chapterId": "ch-1", "note": "x" }))
            .send()
            .await
            .expect("请求");
        assert_eq!(note.status(), 400);
        assert_eq!(
            note.json::<serde_json::Value>().await.expect("JSON")["error"],
            "E_NO_PROJECT"
        );
    }

    /// 白名单内但宿主未接实现的字段：明确 501 + 错误码，绝不静默写一个文件。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn known_field_reports_write_unsupported_without_touching_files() {
        let root = make_project("field-unsupported");
        let meta_before =
            std::fs::read_to_string(root.join(".novel/project-meta.json")).expect("读元数据");
        let state = state_with("tok", session(None, &["fs:project-write"]));
        state.project.set(Some(root.clone()));
        let base = spawn_test_api(state).await;

        let response = test_client()
            .post(format!("{base}/host/project/field"))
            .bearer_auth("tok")
            .json(&serde_json::json!({ "field": "bookTitle", "value": "新书名" }))
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 501);
        let body: serde_json::Value = response.json().await.expect("JSON");
        assert_eq!(body["error"], "E_FIELD_WRITE_UNSUPPORTED");

        // 关键断言：一个字节都没动过（宁可明确不支持，也不写坏用户的文件）
        assert_eq!(
            std::fs::read_to_string(root.join(".novel/project-meta.json")).expect("读元数据"),
            meta_before
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 章节备注同理：当前没有「只追加、不改正文」的落点，明确回不支持。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn chapter_note_reports_unsupported() {
        let root = make_project("note");
        let chapter = root.join("QM/chapters/第1章 开局.md");
        let before = std::fs::read_to_string(&chapter).expect("读正文");
        let state = state_with("tok", session(None, &["fs:project-write"]));
        state.project.set(Some(root.clone()));
        let base = spawn_test_api(state).await;

        let response = test_client()
            .post(format!("{base}/host/project/chapter-note"))
            .bearer_auth("tok")
            .json(&serde_json::json!({ "chapterId": "ch-1", "note": "备注" }))
            .send()
            .await
            .expect("请求");
        assert_eq!(response.status(), 501);
        let body: serde_json::Value = response.json().await.expect("JSON");
        assert_eq!(body["error"], "E_NOTE_WRITE_UNSUPPORTED");
        // 正文是用户最珍贵的资产：这次调用必须一个字都没改
        assert_eq!(std::fs::read_to_string(&chapter).expect("读正文"), before);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 会话自带 root 的老路径仍要能用（动态值为空时兜底），
    /// 但动态值一旦设过就**以动态为准** —— 否则切换项目对已在跑的插件无效。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dynamic_project_overrides_session_root() {
        let session_root = make_project("dyn-session");
        let dynamic_root = make_project("dyn-dynamic");
        let state = state_with(
            "tok",
            session(Some(session_root.clone()), &["fs:project-read"]),
        );
        state.project.set(Some(dynamic_root.clone()));
        // `spawn_test_api` 会把 state 挪走，先留住项目上下文（`Arc` 克隆，同一实例）。
        let project = state.project.clone();
        let base = spawn_test_api(state).await;

        let body: serde_json::Value = test_client()
            .get(format!("{base}/host/project/info"))
            .bearer_auth("tok")
            .send()
            .await
            .expect("请求")
            .json()
            .await
            .expect("JSON");
        let root = body["root"].as_str().expect("root 应是字符串");
        assert!(
            root.contains("qmai-hostapi-dyn-dynamic"),
            "动态项目根必须压过会话里的旧值：{root}"
        );

        // 关闭项目（动态值 None）后回落到会话值：老路径不破。
        project.set(None);
        let body: serde_json::Value = test_client()
            .get(format!("{base}/host/project/info"))
            .bearer_auth("tok")
            .send()
            .await
            .expect("请求")
            .json()
            .await
            .expect("JSON");
        assert!(body["root"]
            .as_str()
            .expect("root 应是字符串")
            .contains("qmai-hostapi-dyn-session"));

        let _ = std::fs::remove_dir_all(&session_root);
        let _ = std::fs::remove_dir_all(&dynamic_root);
    }

    #[test]
    fn process_wide_session_store_is_shared_and_revocable() {
        // 命令层每次 start_plugin 都新建一个 HostApiState，但 HTTP handler 必须看到
        // 同一份会话表；这里直接验证 shared_state() 确实指向进程级单例。
        let token = format!("test-{}", uuid::Uuid::new_v4());
        let session = PluginSession {
            plugin_id: "global-session-test".to_string(),
            granted: granted(&["data:write"]),
            project_root: None,
            // 走临时目录：`register_session` 会创建它，别往磁盘根上留垃圾（Windows 上
            // `/tmp/...` 会被解析成当前盘符根）。
            data_root: temp_dir("global-session").join("global-session-test.data"),
        };
        register_session(&token, session);

        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {token}").parse().expect("合法 header"),
        );
        let state = shared_state();
        let got = state.session(&headers).expect("共享会话表应能看到注册项");
        assert_eq!(got.plugin_id, "global-session-test");

        unregister_session(&token);
        // 注销后旧 token 必须立即失效：停用/卸载后不能继续用旧凭据反调宿主。
        assert!(shared_state().session(&headers).is_none());
    }
}
