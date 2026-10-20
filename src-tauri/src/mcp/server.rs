use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::paths::ensure_loopback;
use super::protocol::{handle_jsonrpc, jsonrpc_error};

pub type PendingCalls = Arc<Mutex<HashMap<String, Sender<Result<Value, String>>>>>;
type ToolCaller = Arc<dyn Fn(&Value) -> Result<Value, String> + Send + Sync>;

pub struct RunningServer {
    port: u16,
    token: String,
    stop: Arc<AtomicBool>,
}

impl RunningServer {
    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn stop(self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect_timeout(
            &SocketAddr::from((Ipv4Addr::LOCALHOST, self.port)),
            Duration::from_millis(200),
        );
    }
}

pub fn start(app: AppHandle, pending: PendingCalls) -> Result<RunningServer, String> {
    start_with(Arc::new(move |params| call_frontend(&app, &pending, params)))
}

pub fn start_with(call_tool: ToolCaller) -> Result<RunningServer, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("无法监听本机 MCP 端口：{error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("无法设置 MCP 监听：{error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("无法读取 MCP 端口：{error}"))?
        .port();
    assert!(listener.local_addr().unwrap().ip().is_loopback());
    let token = Uuid::new_v4().to_string();
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let thread_token = token.clone();
    thread::spawn(move || accept_loop(listener, thread_stop, thread_token, call_tool));
    Ok(RunningServer { port, token, stop })
}

pub fn complete_call(pending: &PendingCalls, id: &str, body: Value) -> Result<(), String> {
    let sender = pending
        .lock()
        .map_err(|_| "MCP 状态不可用".to_string())?
        .remove(id)
        .ok_or_else(|| "找不到对应的 MCP 请求".to_string())?;
    let outcome = if body.get("ok").and_then(|value| value.as_bool()) == Some(true) {
        Ok(body.get("result").cloned().unwrap_or(Value::Null))
    } else {
        Err(body
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("MCP 调用失败")
            .to_string())
    };
    let _ = sender.send(outcome);
    Ok(())
}

fn accept_loop(listener: TcpListener, stop: Arc<AtomicBool>, token: String, call_tool: ToolCaller) {
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, peer)) => {
                let token = token.clone();
                let call_tool = call_tool.clone();
                thread::spawn(move || {
                    if let Err(error) = handle_connection(stream, peer, &token, call_tool.as_ref()) {
                        eprintln!("[mcp] {error}");
                    }
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(20));
            }
            Err(_) => break,
        }
    }
}

fn handle_connection(
    mut stream: TcpStream,
    peer: SocketAddr,
    token: &str,
    call_tool: &dyn Fn(&Value) -> Result<Value, String>,
) -> Result<(), String> {
    if let Err(error) = ensure_loopback(peer.ip()) {
        write_http(&mut stream, 403, &jsonrpc_error(Value::Null, &error).to_string())?;
        return Ok(());
    }
    let (header, body) = read_http(&mut stream)?;
    if !authorized(&header, token) {
        write_http(&mut stream, 401, &jsonrpc_error(Value::Null, "MCP 令牌无效").to_string())?;
        return Ok(());
    }
    let message: Value = serde_json::from_slice(&body).unwrap_or(json!({}));
    let response = handle_jsonrpc(&message, &mut |params| call_tool(params));
    if let Some(response) = response {
        write_http(&mut stream, 200, &response.to_string())?;
    } else {
        write_http(&mut stream, 202, "")?;
    }
    Ok(())
}

fn call_frontend(app: &AppHandle, pending: &PendingCalls, params: &Value) -> Result<Value, String> {
    let id = Uuid::new_v4().to_string();
    let (sender, receiver) = mpsc::channel();
    pending
        .lock()
        .map_err(|_| "MCP 状态不可用".to_string())?
        .insert(id.clone(), sender);
    if let Err(error) = app.emit("mcp-request", json!({
        "id": id,
        "method": "tools/call",
        "params": params,
    })) {
        pending.lock().ok().and_then(|mut calls| calls.remove(&id));
        return Err(format!("无法把 MCP 请求交给界面：{error}"));
    }
    match receiver.recv_timeout(Duration::from_secs(1800)) {
        Ok(result) => result,
        Err(_) => {
            pending.lock().ok().and_then(|mut calls| calls.remove(&id));
            Err("青幕写作没有响应 MCP 调用。".to_string())
        }
    }
}

fn authorized(header: &str, token: &str) -> bool {
    header.lines().any(|line| {
        let Some((name, value)) = line.split_once(':') else { return false };
        name.eq_ignore_ascii_case("authorization") && value.trim() == format!("Bearer {token}")
    })
}

fn read_http(stream: &mut TcpStream) -> Result<(String, Vec<u8>), String> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let mut buf = Vec::new();
    let mut tmp = [0_u8; 4096];
    let header_end = loop {
        let read = stream.read(&mut tmp).map_err(|error| format!("读取 MCP 请求失败：{error}"))?;
        if read == 0 {
            return Err("MCP 连接已关闭".to_string());
        }
        buf.extend_from_slice(&tmp[..read]);
        if let Some(pos) = buf.windows(4).position(|window| window == b"\r\n\r\n") {
            break pos;
        }
        if buf.len() > 65_536 {
            return Err("MCP 请求头过大".to_string());
        }
    };
    let header = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let length = header
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .ok_or_else(|| "MCP 请求缺少 Content-Length".to_string())?;
    if length > 8 * 1024 * 1024 {
        return Err("MCP 请求过大".to_string());
    }
    let mut body = buf[header_end + 4..].to_vec();
    while body.len() < length {
        let read = stream.read(&mut tmp).map_err(|error| format!("读取 MCP 请求失败：{error}"))?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..read]);
    }
    body.truncate(length);
    Ok((header, body))
}

pub fn write_http(stream: &mut TcpStream, status: u16, body: &str) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        401 => "Unauthorized",
        403 => "Forbidden",
        _ => "Error",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|error| format!("写出 MCP 响应失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn http_post(port: u16, token: Option<&str>, body: &str) -> String {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let auth = token
            .map(|token| format!("Authorization: Bearer {token}\r\n"))
            .unwrap_or_default();
        let request = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n{auth}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(request.as_bytes()).unwrap();
        let mut response = String::new();
        let _ = stream.read_to_string(&mut response);
        response
    }

    #[test]
    fn loopback_server_lists_tools_and_rejects_a_bad_token() {
        let server = start_with(Arc::new(|_| Err("界面拒绝了这次调用".to_string()))).unwrap();
        let listed = http_post(server.port(), Some(server.token()), r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#);
        assert!(listed.contains("200"));
        assert!(listed.contains("format_chapter"));
        assert!(listed.contains("writing_conversation"));
        let denied = http_post(server.port(), None, r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#);
        assert!(denied.contains("401"));
        assert!(denied.contains("MCP 令牌无效"));
        let forwarded = http_post(
            server.port(),
            Some(server.token()),
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"save_document"}}"#,
        );
        assert!(forwarded.contains("界面拒绝了这次调用"));
        server.stop();
    }
}
