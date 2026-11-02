//! Antigravity CLI（`agy`）主 Agent 代理。
//!
//! agy 没有原生 function calling，也没有 ACP。这里仿照 cursor-api-proxy 的做法，在本机
//! 127.0.0.1 上起一个带随机令牌的 OpenAI 兼容接口（`/v1/chat/completions`，SSE 流式）：
//!
//! 1. 请求带 `tools` 时启动一个 agy 进程，并给它一个只属于本回合的 MCP 服务
//!    （同一个端口下的 `/mcp/<session>`），把 QMAI 传来的工具原样暴露出去。
//! 2. agy 调用 MCP 工具时先按 JSON Schema 校验参数；不合格直接把错误和正确 schema
//!    回给 agy 让它重试，不打扰 QMAI。合格的调用被“挂起”，以标准 `tool_calls`
//!    返回给 QMAI。
//! 3. QMAI 执行工具后带着 `role:"tool"` 消息再次请求，代理按 `tool_call_id` 找回挂起的
//!    调用，把结果交给 agy，同一个 agy 进程继续往下跑。
//!
//! 隔离：每个回合使用独立的临时 HOME（只链接登录凭据），在里面写 MCP 配置和权限规则，
//! 不碰用户全局 `~/.gemini`，所以反重力搜索和用户自己的 agy 不受影响。权限规则只放行
//! `mcp(qmai/*)`，拒绝 agy 自带的读写文件、执行命令和读网页工具。

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use uuid::Uuid;

use super::antigravity_cli::{configure_agy_command, find_agy_command};
use super::local_cli_config::current_local_cli_environment;

/// 主 Agent 默认模型：用户没选模型时用 medium 档。
pub const DEFAULT_AGENT_MODEL: &str = "gemini-3.8-flash-medium";
/// 挂起的工具调用最多等多久（与 Cursor CLI 的 30 分钟兜底一致）。
const PENDING_TOOL_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// 同一批并行工具调用的合并窗口。
const TOOL_BATCH_WINDOW: Duration = Duration::from_millis(200);
const SSE_KEEPALIVE: Duration = Duration::from_secs(5);
const PRINT_TIMEOUT: &str = "0";
const MCP_SERVER_NAME: &str = "qmai";
const OAUTH_TOKEN_FILE: &str = "antigravity-oauth-token";
const INSTALLATION_ID_FILE: &str = "installation_id";

static PROXY: OnceLock<Mutex<Option<Arc<Proxy>>>> = OnceLock::new();

fn proxy_slot() -> &'static Mutex<Option<Arc<Proxy>>> {
    PROXY.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProxyStatus {
    pub base_url: String,
    pub token: String,
}

#[derive(Debug, Clone, PartialEq)]
struct PendingCall {
    id: String,
    name: String,
    arguments: Value,
}

#[derive(Debug, Clone, PartialEq)]
enum Event {
    Text(String),
    ToolCalls(Vec<PendingCall>),
    Done {
        usage: Option<Value>,
        error: Option<String>,
    },
}

struct Session {
    id: String,
    model: String,
    tools: HashMap<String, Value>,
    tool_defs: Vec<Value>,
    events: Mutex<VecDeque<Event>>,
    signal: Condvar,
    pending: Mutex<HashMap<String, Sender<Result<String, String>>>>,
    batch: Mutex<Vec<PendingCall>>,
    batch_generation: AtomicU64,
    child: Mutex<Option<Child>>,
    home: PathBuf,
    closed: AtomicBool,
}

impl Session {
    fn push(&self, event: Event) {
        if let Ok(mut events) = self.events.lock() {
            events.push_back(event);
        }
        self.signal.notify_all();
    }

    fn next_event(&self, wait: Duration) -> Option<Event> {
        let mut events = self.events.lock().ok()?;
        if events.is_empty() {
            let (guard, _) = self.signal.wait_timeout(events, wait).ok()?;
            events = guard;
        }
        events.pop_front()
    }

    fn close(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Ok(mut child) = self.child.lock() {
            if let Some(child) = child.as_mut() {
                let _ = child.start_kill();
            }
        }
        if let Ok(mut pending) = self.pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err("青幕写作已取消本次工具调用。".to_string()));
            }
        }
        let _ = std::fs::remove_dir_all(&self.home);
        self.signal.notify_all();
    }
}

struct Proxy {
    port: u16,
    token: String,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    call_index: Mutex<HashMap<String, String>>,
    stop: AtomicBool,
}

impl Proxy {
    fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn session(&self, id: &str) -> Option<Arc<Session>> {
        self.sessions.lock().ok()?.get(id).cloned()
    }

    fn drop_session(&self, session: &Session) {
        session.close();
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(&session.id);
        }
        if let Ok(mut index) = self.call_index.lock() {
            index.retain(|_, sid| sid != &session.id);
        }
    }

    fn shutdown(&self) {
        self.stop.store(true, Ordering::SeqCst);
        let sessions: Vec<Arc<Session>> = self
            .sessions
            .lock()
            .map(|mut map| map.drain().map(|(_, s)| s).collect())
            .unwrap_or_default();
        for session in sessions {
            session.close();
        }
        let _ = TcpStream::connect_timeout(
            &SocketAddr::from((Ipv4Addr::LOCALHOST, self.port)),
            Duration::from_millis(200),
        );
    }
}

// ---------------------------------------------------------------------------
// 纯函数：参数校验、提示词、SSE 片段（有单元测试）
// ---------------------------------------------------------------------------

fn type_matches(expected: &str, value: &Value) -> bool {
    match expected {
        "string" => value.is_string(),
        "number" => value.is_number(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "boolean" => value.is_boolean(),
        "array" => value.is_array(),
        "object" => value.is_object(),
        "null" => value.is_null(),
        _ => true,
    }
}

/// 按工具的 JSON Schema 校验 agy 传来的参数，返回中文错误列表（空表示通过）。
pub(crate) fn validate_tool_arguments(schema: &Value, args: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    let Some(args) = args.as_object() else {
        return vec!["参数必须是 JSON 对象".to_string()];
    };
    let empty = Map::new();
    let props = schema
        .get("properties")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        for key in required.iter().filter_map(Value::as_str) {
            if args.get(key).map_or(true, Value::is_null) {
                errors.push(format!("缺少必填参数 \"{key}\""));
            }
        }
    }
    for (key, value) in args {
        let Some(prop) = props.get(key) else {
            errors.push(format!("未知参数 \"{key}\""));
            continue;
        };
        if value.is_null() {
            continue;
        }
        let type_ok = match prop.get("type") {
            Some(Value::String(t)) => type_matches(t, value),
            Some(Value::Array(types)) => types
                .iter()
                .filter_map(Value::as_str)
                .any(|t| type_matches(t, value)),
            _ => true,
        };
        if !type_ok {
            errors.push(format!(
                "参数 \"{key}\" 类型应为 {}",
                prop.get("type").cloned().unwrap_or(Value::Null)
            ));
        }
        if let Some(options) = prop.get("enum").and_then(Value::as_array) {
            if !options.contains(value) {
                errors.push(format!(
                    "参数 \"{key}\" 只能是 {}",
                    Value::Array(options.clone())
                ));
            }
        }
    }
    errors
}

fn tool_error_text(name: &str, errors: &[String], schema: Option<&Value>) -> String {
    match schema {
        Some(schema) => format!(
            "参数错误：{}。请严格按以下 JSON Schema 重新调用 {MCP_SERVER_NAME}/{name}：{schema}",
            errors.join("；")
        ),
        None => format!("没有名为 {name} 的工具。只能调用 {MCP_SERVER_NAME} 服务器列出的工具。"),
    }
}

fn content_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// 把 OpenAI 消息历史和工具 schema 拼成一段给 agy 的提示词。
/// 实测把 schema 直接写进提示词后，agy 不再先试探调用或去读工具定义文件，参数错误率从约 25% 降到 0。
pub(crate) fn build_agent_prompt(messages: &[Value], tool_defs: &[Value]) -> String {
    let mut parts = Vec::new();
    for message in messages {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("user");
        let text = content_text(message.get("content").unwrap_or(&Value::Null));
        match role {
            "system" | "developer" => parts.push(format!("<system>\n{text}\n</system>")),
            "tool" => {
                let id = message
                    .get("tool_call_id")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                parts.push(format!("<tool_result id=\"{id}\">\n{text}\n</tool_result>"));
            }
            "assistant" => {
                let calls = message
                    .get("tool_calls")
                    .and_then(Value::as_array)
                    .map(|calls| {
                        calls
                            .iter()
                            .map(|call| {
                                json!({
                                    "id": call.get("id"),
                                    "name": call.pointer("/function/name"),
                                    "arguments": call.pointer("/function/arguments"),
                                })
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                if calls.is_empty() {
                    parts.push(format!("<assistant>\n{text}\n</assistant>"));
                } else {
                    parts.push(format!(
                        "<assistant>\n{text}\n<tool_calls>{}</tool_calls>\n</assistant>",
                        Value::Array(calls)
                    ));
                }
            }
            _ => parts.push(format!("<user>\n{text}\n</user>")),
        }
    }
    let schemas = tool_defs
        .iter()
        .map(|tool| {
            format!(
                "- {MCP_SERVER_NAME}/{}: {}",
                tool.get("name").and_then(Value::as_str).unwrap_or(""),
                tool.get("inputSchema").cloned().unwrap_or(json!({}))
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "以下是青幕写作（QMAI）的对话记录。你是其中的 assistant，请继续完成最后一条用户请求。\n\n{}\n\n\
【工具规则】只能通过 MCP 服务器 `{MCP_SERVER_NAME}` 的工具读取或修改项目内容；不要读写本地文件，不要执行命令。\
各工具参数的 JSON Schema 如下，直接按它调用，参数名必须完全一致，不要先读取工具定义文件或做试探调用：\n{}",
        parts.join("\n\n"),
        schemas
    )
}

fn openai_tools_to_mcp(tools: &[Value]) -> Vec<Value> {
    tools
        .iter()
        .filter_map(|tool| {
            let function = tool.get("function").unwrap_or(tool);
            let name = function
                .get("name")
                .and_then(Value::as_str)?
                .trim()
                .to_string();
            if name.is_empty() {
                return None;
            }
            Some(json!({
                "name": name,
                "description": function.get("description").and_then(Value::as_str).unwrap_or(""),
                "inputSchema": function
                    .get("parameters")
                    .cloned()
                    .unwrap_or_else(|| json!({"type": "object", "properties": {}})),
            }))
        })
        .collect()
}

/// 解析 agy 一行 stream-json，返回要转发的事件。
fn parse_agy_line(
    line: &str,
    usage: &mut Option<Value>,
    error: &mut Option<String>,
) -> Option<Event> {
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    if let Some(update) = value.get("step_update") {
        if update.get("step_type").and_then(Value::as_str) == Some("agent_response") {
            if let Some(delta) = update.get("text_delta").and_then(Value::as_str) {
                if !delta.is_empty() {
                    return Some(Event::Text(delta.to_string()));
                }
            }
        }
        if update.get("step_type").and_then(Value::as_str) == Some("tool") {
            if let Some(name) = update.get("tool_name").and_then(Value::as_str) {
                if name != "call_mcp_tool"
                    && update.get("state").and_then(Value::as_str) == Some("ACTIVE")
                {
                    eprintln!("[antigravity-agent] agy 尝试使用自带工具 {name}");
                }
            }
        }
        return None;
    }
    if let Some(result) = value.get("result") {
        *usage = result.get("usage").cloned();
        let status = result.get("status").and_then(Value::as_str).unwrap_or("");
        if status != "SUCCESS" {
            let detail = result
                .get("error")
                .and_then(|e| {
                    e.as_str()
                        .map(str::to_string)
                        .or_else(|| Some(e.to_string()))
                })
                .unwrap_or_else(|| status.to_string());
            *error = Some(format!("Antigravity CLI 返回失败：{detail}"));
        }
    }
    None
}

fn openai_usage(usage: &Value) -> Value {
    let input = usage
        .get("input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output = usage
        .get("output_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let cached = usage
        .get("cache_read_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let thinking = usage
        .get("thinking_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    json!({
        "prompt_tokens": input,
        "completion_tokens": output,
        "total_tokens": usage.get("total_tokens").and_then(Value::as_u64).unwrap_or(input + output),
        "prompt_tokens_details": { "cached_tokens": cached },
        "completion_tokens_details": { "reasoning_tokens": thinking },
    })
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn chunk(
    id: &str,
    model: &str,
    delta: Value,
    finish: Option<&str>,
    usage: Option<Value>,
) -> String {
    let mut body = json!({
        "id": id,
        "object": "chat.completion.chunk",
        "created": unix_now(),
        "model": model,
        "choices": [{ "index": 0, "delta": delta, "finish_reason": finish }],
    });
    if let Some(usage) = usage {
        body["usage"] = usage;
    }
    format!("data: {body}\n\n")
}

fn tool_calls_delta(calls: &[PendingCall]) -> Value {
    json!({
        "role": "assistant",
        "tool_calls": calls.iter().enumerate().map(|(index, call)| json!({
            "index": index,
            "id": call.id,
            "type": "function",
            "function": { "name": call.name, "arguments": call.arguments.to_string() },
        })).collect::<Vec<_>>(),
    })
}

// ---------------------------------------------------------------------------
// 隔离的 HOME
// ---------------------------------------------------------------------------

fn real_agy_dir() -> Option<PathBuf> {
    let home = current_local_cli_environment()
        .home
        .or_else(|| std::env::var("USERPROFILE").ok())?;
    Some(PathBuf::from(home).join(".gemini").join("antigravity-cli"))
}

fn sessions_root() -> PathBuf {
    std::env::temp_dir().join(format!("qmai-agy-agent-{}", std::process::id()))
}

/// 上次异常退出留下的空目录（只删空目录，不会动另一个正在运行的实例的会话）。
fn remove_empty_stale_roots() {
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else {
        return;
    };
    for entry in entries.flatten() {
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with("qmai-agy-agent-")
        {
            let _ = std::fs::remove_dir(entry.path());
        }
    }
}

fn link_or_copy(src: &Path, dst: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(src, dst)
    }
    #[cfg(not(unix))]
    {
        std::fs::copy(src, dst).map(|_| ())
    }
}

pub(crate) fn agent_settings_json() -> Value {
    json!({
        "permissions": {
            "allow": [format!("mcp({MCP_SERVER_NAME}/*)")],
            "deny": ["read_file(*)", "write_file(*)", "command(*)", "read_url(*)"],
        }
    })
}

pub(crate) fn agent_mcp_config(url: &str, token: &str) -> Value {
    json!({
        "mcpServers": {
            MCP_SERVER_NAME: {
                "serverUrl": url,
                "headers": { "Authorization": format!("Bearer {token}") },
                "disabled": false,
            }
        }
    })
}

/// 为一个回合准备隔离 HOME：只带上登录凭据，MCP 和权限配置都写在这里面。
fn prepare_isolated_home(
    root: &Path,
    real_dir: &Path,
    mcp_url: &str,
    token: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let cli_dir = root.join(".gemini").join("antigravity-cli");
    let config_dir = root.join(".gemini").join("config");
    let work = root.join("work");
    for dir in [&cli_dir, &config_dir, &work] {
        std::fs::create_dir_all(dir).map_err(|e| format!("无法创建 Antigravity 隔离目录：{e}"))?;
    }
    let token_src = real_dir.join(OAUTH_TOKEN_FILE);
    if !token_src.exists() {
        return Err(
            "没有找到 Antigravity CLI 的登录凭据，请先在终端运行 agy 完成登录。".to_string(),
        );
    }
    link_or_copy(&token_src, &cli_dir.join(OAUTH_TOKEN_FILE))
        .map_err(|e| format!("无法引用 Antigravity 登录凭据：{e}"))?;
    let installation = real_dir.join(INSTALLATION_ID_FILE);
    if installation.exists() {
        let _ = std::fs::copy(&installation, cli_dir.join(INSTALLATION_ID_FILE));
    }
    std::fs::write(
        cli_dir.join("settings.json"),
        agent_settings_json().to_string(),
    )
    .map_err(|e| format!("无法写入 Antigravity 权限规则：{e}"))?;
    std::fs::write(
        config_dir.join("mcp_config.json"),
        agent_mcp_config(mcp_url, token).to_string(),
    )
    .map_err(|e| format!("无法写入 Antigravity MCP 配置：{e}"))?;
    Ok((root.to_path_buf(), work))
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

struct HttpRequest {
    method: String,
    path: String,
    headers: String,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(60)));
    let mut buf = Vec::new();
    let mut tmp = [0_u8; 8192];
    let header_end = loop {
        let read = stream
            .read(&mut tmp)
            .map_err(|e| format!("读取请求失败：{e}"))?;
        if read == 0 {
            return Err("连接已关闭".to_string());
        }
        buf.extend_from_slice(&tmp[..read]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        if buf.len() > 65_536 {
            return Err("请求头过大".to_string());
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.lines();
    let first = lines.next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("/").to_string();
    let headers = lines.collect::<Vec<_>>().join("\n");
    let length = header_value(&headers, "content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    if length > 64 * 1024 * 1024 {
        return Err("请求体过大".to_string());
    }
    let mut body = buf[header_end + 4..].to_vec();
    while body.len() < length {
        let read = stream
            .read(&mut tmp)
            .map_err(|e| format!("读取请求失败：{e}"))?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..read]);
    }
    body.truncate(length);
    Ok(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn header_value<'a>(headers: &'a str, name: &str) -> Option<&'a str> {
    headers.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim().eq_ignore_ascii_case(name).then(|| value.trim())
    })
}

fn write_response(stream: &mut TcpStream, status: u16, content_type: &str, body: &str) {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

fn write_json(stream: &mut TcpStream, status: u16, body: &Value) {
    write_response(stream, status, "application/json", &body.to_string());
}

fn start_proxy() -> Result<Arc<Proxy>, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| format!("无法监听 Antigravity 代理端口：{e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("无法读取代理端口：{e}"))?
        .port();
    let _ = std::fs::remove_dir_all(sessions_root());
    remove_empty_stale_roots();
    let proxy = Arc::new(Proxy {
        port,
        token: format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()),
        sessions: Mutex::new(HashMap::new()),
        call_index: Mutex::new(HashMap::new()),
        stop: AtomicBool::new(false),
    });
    let accept = proxy.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            if accept.stop.load(Ordering::SeqCst) {
                break;
            }
            let Ok(stream) = stream else { continue };
            let proxy = accept.clone();
            thread::spawn(move || handle_connection(proxy, stream));
        }
    });
    Ok(proxy)
}

fn handle_connection(proxy: Arc<Proxy>, mut stream: TcpStream) {
    let loopback = stream
        .peer_addr()
        .map(|addr| addr.ip().is_loopback())
        .unwrap_or(false);
    if !loopback {
        write_response(&mut stream, 403, "text/plain", "Forbidden");
        return;
    }
    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(_) => return,
    };
    let path = request.path.split('?').next().unwrap_or("").to_string();
    if path == "/health" {
        write_json(&mut stream, 200, &json!({"ok": true}));
        return;
    }
    let expected = format!("Bearer {}", proxy.token);
    if header_value(&request.headers, "authorization") != Some(expected.as_str()) {
        write_json(
            &mut stream,
            401,
            &json!({"error": {"message": "Antigravity 代理令牌无效"}}),
        );
        return;
    }
    if let Some(session_id) = path.strip_prefix("/mcp/") {
        handle_mcp(&proxy, session_id, &request, &mut stream);
        return;
    }
    match (request.method.as_str(), path.as_str()) {
        ("POST", "/v1/chat/completions") => handle_chat(&proxy, &request, stream),
        ("GET", "/v1/models") => write_json(
            &mut stream,
            200,
            &json!({"object": "list", "data": [{"id": DEFAULT_AGENT_MODEL, "object": "model"}]}),
        ),
        _ => write_json(
            &mut stream,
            404,
            &json!({"error": {"message": "not found"}}),
        ),
    }
}

fn handle_mcp(proxy: &Arc<Proxy>, session_id: &str, request: &HttpRequest, stream: &mut TcpStream) {
    if request.method == "GET" {
        write_response(stream, 405, "text/plain", "");
        return;
    }
    if request.method == "DELETE" {
        write_response(stream, 200, "application/json", "{}");
        return;
    }
    let message: Value = serde_json::from_slice(&request.body).unwrap_or(json!({}));
    let Some(id) = message.get("id").cloned() else {
        write_response(stream, 202, "application/json", "");
        return;
    };
    let reply = |result: Value| json!({"jsonrpc": "2.0", "id": id, "result": result});
    let Some(session) = proxy.session(session_id) else {
        write_json(
            stream,
            200,
            &json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32000, "message": "会话已结束"}}),
        );
        return;
    };
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let response = match method {
        "initialize" => reply(json!({
            "protocolVersion": message.pointer("/params/protocolVersion").cloned().unwrap_or(json!("2025-06-18")),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": MCP_SERVER_NAME, "version": "1.0.0" },
        })),
        "tools/list" => reply(json!({ "tools": session.tool_defs })),
        "tools/call" => {
            let name = message
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let args = message
                .pointer("/params/arguments")
                .cloned()
                .unwrap_or(json!({}));
            reply(call_tool(proxy, &session, &name, args))
        }
        "ping" => reply(json!({})),
        _ => reply(json!({})),
    };
    write_json(stream, 200, &response);
}

fn tool_result(text: String, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
}

/// 校验并挂起一次工具调用，直到 QMAI 带着工具结果回来。
fn call_tool(proxy: &Arc<Proxy>, session: &Arc<Session>, name: &str, args: Value) -> Value {
    let schema = session.tools.get(name);
    let errors = match schema {
        Some(schema) => validate_tool_arguments(schema, &args),
        None => vec![format!("未知工具 {name}")],
    };
    if !errors.is_empty() {
        eprintln!(
            "[antigravity-agent] 参数校验失败 {name} {args}: {}",
            errors.join("; ")
        );
        return tool_result(tool_error_text(name, &errors, schema), true);
    }
    let call_id = format!("call_{}", Uuid::new_v4().simple());
    let (sender, receiver) = mpsc::channel();
    if let Ok(mut pending) = session.pending.lock() {
        pending.insert(call_id.clone(), sender);
    }
    if let Ok(mut index) = proxy.call_index.lock() {
        index.insert(call_id.clone(), session.id.clone());
    }
    if let Ok(mut batch) = session.batch.lock() {
        batch.push(PendingCall {
            id: call_id.clone(),
            name: name.to_string(),
            arguments: args,
        });
    }
    let generation = session.batch_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let flush_session = session.clone();
    thread::spawn(move || {
        thread::sleep(TOOL_BATCH_WINDOW);
        if flush_session.batch_generation.load(Ordering::SeqCst) != generation {
            return;
        }
        let calls: Vec<PendingCall> = flush_session
            .batch
            .lock()
            .map(|mut batch| std::mem::take(&mut *batch))
            .unwrap_or_default();
        if !calls.is_empty() {
            flush_session.push(Event::ToolCalls(calls));
        }
    });
    let outcome = receiver.recv_timeout(PENDING_TOOL_TIMEOUT);
    if let Ok(mut index) = proxy.call_index.lock() {
        index.remove(&call_id);
    }
    match outcome {
        Ok(Ok(text)) => tool_result(text, false),
        Ok(Err(message)) => tool_result(message, true),
        Err(_) => {
            // 30 分钟没有等到结果：认为 QMAI 已经放弃这一回合，结束 agy。
            let proxy = proxy.clone();
            let session = session.clone();
            thread::spawn(move || proxy.drop_session(&session));
            tool_result(
                "等待青幕写作返回工具结果超时，本回合已结束。".to_string(),
                true,
            )
        }
    }
}

fn trailing_tool_results(messages: &[Value]) -> Vec<(String, String)> {
    let mut results = Vec::new();
    for message in messages.iter().rev() {
        if message.get("role").and_then(Value::as_str) != Some("tool") {
            break;
        }
        let id = message
            .get("tool_call_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        results.push((
            id,
            content_text(message.get("content").unwrap_or(&Value::Null)),
        ));
    }
    results.reverse();
    results
}

/// 找到挂起这些工具调用的会话，把结果交回去。找不到就返回 None（会新开一个 agy）。
fn resume_session(proxy: &Proxy, messages: &[Value]) -> Option<Arc<Session>> {
    let results = trailing_tool_results(messages);
    let first = results.first()?;
    let session_id = proxy.call_index.lock().ok()?.get(&first.0).cloned()?;
    let session = proxy.session(&session_id)?;
    let mut pending = session.pending.lock().ok()?;
    for (id, text) in results {
        if let Some(sender) = pending.remove(&id) {
            let _ = sender.send(Ok(text));
        }
    }
    drop(pending);
    Some(session)
}

fn spawn_session(proxy: &Arc<Proxy>, body: &Value) -> Result<Arc<Session>, String> {
    let messages = body
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let tools = body
        .get("tools")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let tool_defs = openai_tools_to_mcp(&tools);
    let model = body
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|m| !m.is_empty() && *m != "default")
        .unwrap_or(DEFAULT_AGENT_MODEL)
        .to_string();
    let session_id = Uuid::new_v4().simple().to_string();
    let real_dir = real_agy_dir()
        .ok_or_else(|| "无法确定用户主目录，找不到 Antigravity 登录凭据。".to_string())?;
    let mcp_url = format!("{}/mcp/{session_id}", proxy.base_url());
    let (home, work) = prepare_isolated_home(
        &sessions_root().join(&session_id),
        &real_dir,
        &mcp_url,
        &proxy.token,
    )?;
    let prompt = build_agent_prompt(&messages, &tool_defs);
    let session = Arc::new(Session {
        id: session_id.clone(),
        model: model.clone(),
        tools: tool_defs
            .iter()
            .filter_map(|tool| {
                Some((
                    tool.get("name")?.as_str()?.to_string(),
                    tool.get("inputSchema")?.clone(),
                ))
            })
            .collect(),
        tool_defs,
        events: Mutex::new(VecDeque::new()),
        signal: Condvar::new(),
        pending: Mutex::new(HashMap::new()),
        batch: Mutex::new(Vec::new()),
        batch_generation: AtomicU64::new(0),
        child: Mutex::new(None),
        home: home.clone(),
        closed: AtomicBool::new(false),
    });
    proxy
        .sessions
        .lock()
        .map_err(|_| "代理状态不可用".to_string())?
        .insert(session_id, session.clone());

    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let task_session = session.clone();
    let task_proxy = proxy.clone();
    tauri::async_runtime::spawn(async move {
        let result = run_agy(task_session.clone(), &home, &work, &model, prompt, ready_tx).await;
        if let Err(error) = result {
            task_session.push(Event::Done {
                usage: None,
                error: Some(error),
            });
        }
        // 进程结束后留一会儿让 HTTP 端把最后的事件发出去，再清理。
        tokio::time::sleep(Duration::from_secs(2)).await;
        if task_session
            .pending
            .lock()
            .map(|p| p.is_empty())
            .unwrap_or(true)
        {
            task_proxy.drop_session(&task_session);
        }
    });
    match ready_rx.recv_timeout(Duration::from_secs(30)) {
        Ok(Ok(())) => Ok(session),
        Ok(Err(error)) => {
            proxy.drop_session(&session);
            Err(error)
        }
        Err(_) => {
            proxy.drop_session(&session);
            Err("启动 agy 超时".to_string())
        }
    }
}

async fn run_agy(
    session: Arc<Session>,
    home: &Path,
    work: &Path,
    model: &str,
    prompt: String,
    ready: Sender<Result<(), String>>,
) -> Result<(), String> {
    let fail = |ready: &Sender<Result<(), String>>, message: String| {
        let _ = ready.send(Err(message.clone()));
        Err(message)
    };
    let agy = match find_agy_command().await {
        Ok(agy) => agy,
        Err(_) => return fail(&ready, "未找到 agy。请先安装 Antigravity CLI。".to_string()),
    };
    let mut cmd = Command::new(&agy);
    configure_agy_command(&mut cmd).await;
    cmd.env("HOME", home)
        .env("USERPROFILE", home)
        .env("ANTIGRAVITY_BROWSER_TOOLS_ENABLED", "false")
        .args([
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--print-timeout",
            PRINT_TIMEOUT,
            "--model",
            model,
        ])
        .current_dir(work)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => return fail(&ready, format!("无法启动 agy：{e}")),
    };
    let (Some(mut stdin), Some(stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        return fail(&ready, "agy 进程缺少标准输入输出".to_string());
    };
    let line = format!(
        "{}\n",
        json!({"event": "user", "message": {"content": prompt}})
    );
    if let Err(e) = stdin.write_all(line.as_bytes()).await {
        return fail(&ready, format!("写入 agy 失败：{e}"));
    }
    let _ = stdin.flush().await;
    if let Ok(mut slot) = session.child.lock() {
        *slot = Some(child);
    }
    let _ = ready.send(Ok(()));

    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut tail = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            eprintln!("[antigravity-agent stderr] {line}");
            tail.push_str(&line);
            tail.push('\n');
            if tail.len() > 4000 {
                tail = tail.split_off(tail.len() - 2000);
            }
        }
        tail
    });
    let mut reader = BufReader::new(stdout).lines();
    let mut usage = None;
    let mut error = None;
    let mut got_result = false;
    let mut stdin = Some(stdin);
    while let Ok(Some(line)) = reader.next_line().await {
        if line.contains("\"event\":\"result\"") {
            got_result = true;
        }
        if let Some(event) = parse_agy_line(&line, &mut usage, &mut error) {
            session.push(event);
        }
        if got_result {
            // stream-json 模式下关闭 stdin，agy 处理完本回合就会退出。
            stdin.take();
            break;
        }
    }
    drop(stdin);
    let child = session.child.lock().ok().and_then(|mut slot| slot.take());
    if let Some(mut child) = child {
        if tokio::time::timeout(Duration::from_secs(3), child.wait())
            .await
            .is_err()
        {
            let _ = child.start_kill();
        }
    }
    let stderr_tail = tokio::time::timeout(Duration::from_secs(1), stderr_task)
        .await
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or_default();
    if !got_result && error.is_none() && !session.closed.load(Ordering::SeqCst) {
        let detail = stderr_tail.trim();
        error = Some(if is_auth_error(detail) {
            "Antigravity CLI 未登录或登录已过期，请在终端运行 agy 重新登录。".to_string()
        } else if detail.is_empty() {
            "Antigravity CLI 意外退出，没有返回结果。".to_string()
        } else {
            format!(
                "Antigravity CLI 意外退出：{}",
                detail
                    .chars()
                    .rev()
                    .take(600)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect::<String>()
            )
        });
    }
    session.push(Event::Done { usage, error });
    Ok(())
}

fn is_auth_error(detail: &str) -> bool {
    let lower = detail.to_lowercase();
    [
        "not logged into antigravity",
        "authentication required",
        "unauthenticated",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn handle_chat(proxy: &Arc<Proxy>, request: &HttpRequest, mut stream: TcpStream) {
    let body: Value = match serde_json::from_slice(&request.body) {
        Ok(body) => body,
        Err(e) => {
            write_json(
                &mut stream,
                400,
                &json!({"error": {"message": format!("请求不是合法 JSON：{e}")}}),
            );
            return;
        }
    };
    let messages = body
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let streaming = body.get("stream").and_then(Value::as_bool).unwrap_or(false);
    let session = match resume_session(proxy, &messages) {
        Some(session) => session,
        None => match spawn_session(proxy, &body) {
            Ok(session) => session,
            Err(error) => {
                write_json(&mut stream, 500, &json!({"error": {"message": error}}));
                return;
            }
        },
    };
    let completion_id = format!("chatcmpl-{}", Uuid::new_v4().simple());
    if streaming {
        stream_events(proxy, &session, &completion_id, stream);
    } else {
        collect_events(proxy, &session, &completion_id, stream);
    }
}

fn client_gone(stream: &TcpStream) -> bool {
    let _ = stream.set_nonblocking(true);
    let mut probe = [0_u8; 1];
    let gone = matches!(stream.peek(&mut probe), Ok(0));
    let _ = stream.set_nonblocking(false);
    gone
}

fn stream_events(proxy: &Arc<Proxy>, session: &Arc<Session>, id: &str, mut stream: TcpStream) {
    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
    if stream.write_all(head.as_bytes()).is_err() {
        proxy.drop_session(session);
        return;
    }
    let model = session.model.clone();
    let mut sent_role = false;
    loop {
        let event = session.next_event(SSE_KEEPALIVE);
        let payload = match event {
            None => {
                if session.closed.load(Ordering::SeqCst) {
                    let error = json!({"error": {"message": "Antigravity 会话已结束"}});
                    let _ =
                        stream.write_all(format!("data: {error}\n\ndata: [DONE]\n\n").as_bytes());
                    return;
                }
                // 保活；写失败或对端已关闭说明 QMAI 取消了请求，结束 agy。
                if stream.write_all(b": keepalive\n\n").is_err() || client_gone(&stream) {
                    proxy.drop_session(session);
                    return;
                }
                continue;
            }
            Some(Event::Text(text)) => {
                let delta = if sent_role {
                    json!({"content": text})
                } else {
                    json!({"role": "assistant", "content": text})
                };
                sent_role = true;
                chunk(id, &model, delta, None, None)
            }
            Some(Event::ToolCalls(calls)) => {
                let mut out = chunk(id, &model, tool_calls_delta(&calls), None, None);
                out.push_str(&chunk(id, &model, json!({}), Some("tool_calls"), None));
                out.push_str("data: [DONE]\n\n");
                let _ = stream.write_all(out.as_bytes());
                return;
            }
            Some(Event::Done { usage, error }) => {
                let out = match error {
                    Some(message) => format!(
                        "data: {}\n\ndata: [DONE]\n\n",
                        json!({"error": {"message": message}})
                    ),
                    None => {
                        let mut out = chunk(
                            id,
                            &model,
                            json!({}),
                            Some("stop"),
                            usage.as_ref().map(openai_usage),
                        );
                        out.push_str("data: [DONE]\n\n");
                        out
                    }
                };
                let _ = stream.write_all(out.as_bytes());
                proxy.drop_session(session);
                return;
            }
        };
        if stream.write_all(payload.as_bytes()).is_err() {
            proxy.drop_session(session);
            return;
        }
    }
}

fn collect_events(proxy: &Arc<Proxy>, session: &Arc<Session>, id: &str, mut stream: TcpStream) {
    let mut text = String::new();
    let started = Instant::now();
    loop {
        match session.next_event(SSE_KEEPALIVE) {
            None => {
                if session.closed.load(Ordering::SeqCst)
                    || client_gone(&stream)
                    || started.elapsed() > PENDING_TOOL_TIMEOUT
                {
                    proxy.drop_session(session);
                    return;
                }
            }
            Some(Event::Text(delta)) => text.push_str(&delta),
            Some(Event::ToolCalls(calls)) => {
                let message = json!({
                    "role": "assistant",
                    "content": if text.trim().is_empty() { Value::Null } else { json!(text) },
                    "tool_calls": tool_calls_delta(&calls)["tool_calls"].as_array().map(|calls| calls.iter().map(|c| {
                        let mut c = c.clone();
                        if let Some(obj) = c.as_object_mut() { obj.remove("index"); }
                        c
                    }).collect::<Vec<_>>()),
                });
                write_json(
                    &mut stream,
                    200,
                    &json!({
                        "id": id, "object": "chat.completion", "created": unix_now(), "model": session.model,
                        "choices": [{"index": 0, "message": message, "finish_reason": "tool_calls"}],
                    }),
                );
                return;
            }
            Some(Event::Done { usage, error }) => {
                proxy.drop_session(session);
                if let Some(message) = error {
                    write_json(&mut stream, 502, &json!({"error": {"message": message}}));
                } else {
                    write_json(
                        &mut stream,
                        200,
                        &json!({
                            "id": id, "object": "chat.completion", "created": unix_now(), "model": session.model,
                            "choices": [{"index": 0, "message": {"role": "assistant", "content": text.trim()}, "finish_reason": "stop"}],
                            "usage": usage.as_ref().map(openai_usage),
                        }),
                    );
                }
                return;
            }
        }
    }
}

fn ensure_proxy() -> Result<Arc<Proxy>, String> {
    let mut slot = proxy_slot()
        .lock()
        .map_err(|_| "Antigravity 代理状态不可用".to_string())?;
    if let Some(proxy) = slot.as_ref() {
        if !proxy.stop.load(Ordering::SeqCst) {
            return Ok(proxy.clone());
        }
    }
    let proxy = start_proxy()?;
    *slot = Some(proxy.clone());
    Ok(proxy)
}

/// 启动（或复用）主 Agent 代理，返回 OpenAI 兼容地址和令牌。
#[tauri::command]
pub async fn antigravity_agent_proxy_ensure() -> Result<AgentProxyStatus, String> {
    let proxy = ensure_proxy()?;
    Ok(AgentProxyStatus {
        base_url: format!("{}/v1", proxy.base_url()),
        token: proxy.token.clone(),
    })
}

/// 取消挂起这些工具调用的 agy 会话（Agent 被用户停止时调用）。
#[tauri::command]
pub async fn antigravity_agent_cancel(tool_call_ids: Vec<String>) -> Result<usize, String> {
    let Some(proxy) = proxy_slot().lock().ok().and_then(|slot| slot.clone()) else {
        return Ok(0);
    };
    let session_ids: std::collections::HashSet<String> = {
        let index = proxy
            .call_index
            .lock()
            .map_err(|_| "代理状态不可用".to_string())?;
        tool_call_ids
            .iter()
            .filter_map(|id| index.get(id).cloned())
            .collect()
    };
    let mut cancelled = 0;
    for session_id in session_ids {
        if let Some(session) = proxy.session(&session_id) {
            proxy.drop_session(&session);
            cancelled += 1;
        }
    }
    Ok(cancelled)
}

/// 应用退出时结束所有 agy 进程。
pub fn shutdown_antigravity_agent_proxy() {
    if let Some(proxy) = proxy_slot().lock().ok().and_then(|mut slot| slot.take()) {
        proxy.shutdown();
    }
    let _ = std::fs::remove_dir_all(sessions_root());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schema() -> Value {
        json!({"type": "object", "properties": {"name": {"type": "string"}, "count": {"type": "number"}, "mode": {"type": "string", "enum": ["a", "b"]}}, "required": ["name"]})
    }

    #[test]
    fn validation_reports_missing_unknown_and_wrong_types() {
        assert!(validate_tool_arguments(&schema(), &json!({"name": "第3章"})).is_empty());
        let errors = validate_tool_arguments(&schema(), &json!({"chapter_number": 3}));
        assert!(errors.iter().any(|e| e.contains("缺少必填参数 \"name\"")));
        assert!(errors
            .iter()
            .any(|e| e.contains("未知参数 \"chapter_number\"")));
        let errors =
            validate_tool_arguments(&schema(), &json!({"name": 1, "count": "x", "mode": "c"}));
        assert_eq!(errors.len(), 3);
        assert_eq!(
            validate_tool_arguments(&schema(), &json!([1])),
            vec!["参数必须是 JSON 对象".to_string()]
        );
        assert!(
            validate_tool_arguments(&json!({"type": "object", "properties": {}}), &json!({}))
                .is_empty()
        );
    }

    #[test]
    fn error_text_includes_schema_for_retry() {
        let text = tool_error_text(
            "read_chapter",
            &["缺少必填参数 \"name\"".into()],
            Some(&schema()),
        );
        assert!(text.contains("qmai/read_chapter") && text.contains("\"required\":[\"name\"]"));
        assert!(tool_error_text("nope", &[], None).contains("没有名为 nope 的工具"));
    }

    #[test]
    fn prompt_carries_history_tool_results_and_schemas() {
        let tools = openai_tools_to_mcp(&[
            json!({"type": "function", "function": {"name": "read_chapter", "description": "读章节", "parameters": schema()}}),
        ]);
        let prompt = build_agent_prompt(
            &[
                json!({"role": "system", "content": "你是调度器"}),
                json!({"role": "user", "content": [{"type": "text", "text": "看第3章"}]}),
                json!({"role": "assistant", "content": null, "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "read_chapter", "arguments": "{\"name\":\"第3章\"}"}}]}),
                json!({"role": "tool", "tool_call_id": "call_1", "content": "正文"}),
            ],
            &tools,
        );
        assert!(prompt.contains("<system>\n你是调度器"));
        assert!(prompt.contains("<user>\n看第3章"));
        assert!(prompt.contains("call_1") && prompt.contains("<tool_result id=\"call_1\">\n正文"));
        assert!(prompt.contains("- qmai/read_chapter: {"));
    }

    #[test]
    fn agy_lines_become_events() {
        let mut usage = None;
        let mut error = None;
        let text = r#"{"event":"step_update","step_update":{"step_type":"agent_response","state":"ACTIVE","text_delta":"你好"}}"#;
        assert_eq!(
            parse_agy_line(text, &mut usage, &mut error),
            Some(Event::Text("你好".into()))
        );
        let result = r#"{"event":"result","result":{"status":"SUCCESS","usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}"#;
        assert_eq!(parse_agy_line(result, &mut usage, &mut error), None);
        assert_eq!(openai_usage(usage.as_ref().unwrap())["total_tokens"], 12);
        assert!(error.is_none());
        let failed = r#"{"event":"result","result":{"status":"ERROR","error":"quota exceeded"}}"#;
        parse_agy_line(failed, &mut usage, &mut error);
        assert!(error.unwrap().contains("quota exceeded"));
    }

    #[test]
    fn tool_call_chunks_follow_openai_shape() {
        let calls = vec![
            PendingCall {
                id: "call_a".into(),
                name: "read_chapter".into(),
                arguments: json!({"name": "第3章"}),
            },
            PendingCall {
                id: "call_b".into(),
                name: "list_chapters".into(),
                arguments: json!({}),
            },
        ];
        let delta = tool_calls_delta(&calls);
        assert_eq!(delta["tool_calls"][1]["index"], 1);
        assert_eq!(
            delta["tool_calls"][0]["function"]["arguments"],
            "{\"name\":\"第3章\"}"
        );
        let sse = chunk("c", "m", delta, Some("tool_calls"), None);
        assert!(sse.starts_with("data: {") && sse.ends_with("\n\n"));
    }

    #[test]
    fn isolated_home_has_rules_mcp_config_and_login_only() {
        let base = std::env::temp_dir().join(format!("qmai-agy-test-{}", Uuid::new_v4().simple()));
        let real = base.join("real");
        std::fs::create_dir_all(&real).unwrap();
        assert!(
            prepare_isolated_home(&base.join("s0"), &real, "http://x", "t")
                .unwrap_err()
                .contains("登录")
        );
        std::fs::write(real.join(OAUTH_TOKEN_FILE), "tok").unwrap();
        let (home, work) = prepare_isolated_home(
            &base.join("s1"),
            &real,
            "http://127.0.0.1:1/mcp/s1",
            "secret",
        )
        .unwrap();
        assert!(work.is_dir());
        let token =
            std::fs::read_to_string(home.join(".gemini/antigravity-cli").join(OAUTH_TOKEN_FILE))
                .unwrap();
        assert_eq!(token, "tok");
        let settings: Value = serde_json::from_str(
            &std::fs::read_to_string(home.join(".gemini/antigravity-cli/settings.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(settings["permissions"]["allow"][0], "mcp(qmai/*)");
        assert!(settings["permissions"]["deny"]
            .as_array()
            .unwrap()
            .contains(&json!("command(*)")));
        let mcp: Value = serde_json::from_str(
            &std::fs::read_to_string(home.join(".gemini/config/mcp_config.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            mcp["mcpServers"]["qmai"]["headers"]["Authorization"],
            "Bearer secret"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn proxy_rejects_bad_token_and_resumes_parked_calls() {
        let proxy = start_proxy().unwrap();
        let send = |path: &str, token: &str, body: &str| -> String {
            let mut s = TcpStream::connect((Ipv4Addr::LOCALHOST, proxy.port)).unwrap();
            let req = format!("POST {path} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\n\r\n{body}", body.len());
            s.write_all(req.as_bytes()).unwrap();
            let mut out = String::new();
            let _ = s.read_to_string(&mut out);
            out
        };
        assert!(send("/v1/chat/completions", "bad", "{}").contains("401"));
        // 手工放一个会话，模拟 agy 通过 MCP 调工具。
        let session = Arc::new(Session {
            id: "s1".into(),
            model: "m".into(),
            tools: [("read_chapter".to_string(), schema())]
                .into_iter()
                .collect(),
            tool_defs: vec![],
            events: Mutex::new(VecDeque::new()),
            signal: Condvar::new(),
            pending: Mutex::new(HashMap::new()),
            batch: Mutex::new(Vec::new()),
            batch_generation: AtomicU64::new(0),
            child: Mutex::new(None),
            home: std::env::temp_dir().join("qmai-agy-none"),
            closed: AtomicBool::new(false),
        });
        proxy
            .sessions
            .lock()
            .unwrap()
            .insert("s1".into(), session.clone());
        let token = proxy.token.clone();
        let bad = send(
            "/mcp/s1",
            &token,
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_chapter","arguments":{"chapter":3}}}"#,
        );
        assert!(bad.contains("isError\":true") && bad.contains("未知参数"));
        let port = proxy.port;
        let caller = thread::spawn(move || {
            let mut s = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
            let body = r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_chapter","arguments":{"name":"第3章"}}}"#;
            let req = format!("POST /mcp/s1 HTTP/1.1\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\n\r\n{body}", body.len());
            s.write_all(req.as_bytes()).unwrap();
            let mut out = String::new();
            let _ = s.read_to_string(&mut out);
            out
        });
        let Some(Event::ToolCalls(calls)) = session.next_event(Duration::from_secs(3)) else {
            panic!("no tool call")
        };
        assert_eq!(calls[0].name, "read_chapter");
        let messages =
            vec![json!({"role": "tool", "tool_call_id": calls[0].id, "content": "第三章正文"})];
        assert!(resume_session(&proxy, &messages).is_some());
        let mcp_reply = caller.join().unwrap();
        assert!(mcp_reply.contains("第三章正文") && mcp_reply.contains("isError\":false"));
        proxy.shutdown();
    }

    /// 手动联调：`cargo test --lib live_proxy_for_manual_e2e -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_proxy_for_manual_e2e() {
        let proxy = ensure_proxy().unwrap();
        std::fs::write(
            "/tmp/qmai-agy-proxy.json",
            json!({"base": proxy.base_url(), "token": proxy.token}).to_string(),
        )
        .unwrap();
        thread::sleep(Duration::from_secs(1500));
    }
}
