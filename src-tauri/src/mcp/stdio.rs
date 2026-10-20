use std::io::{self, BufRead, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

use serde_json::{json, Value};

use super::paths::{endpoint_file, read_endpoint};
use super::protocol::jsonrpc_error;

pub fn run() {
    let endpoint = read_endpoint(&endpoint_file());
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        if let Some(response) = bridge_line(&line, endpoint.as_ref().map(|(port, token)| (*port, token.as_str())).map_err(|error| error.as_str())) {
            println!("{response}");
            let _ = io::stdout().flush();
        }
    }
}

pub fn bridge_line(line: &str, endpoint: Result<(u16, &str), &str>) -> Option<String> {
    let message: Value = serde_json::from_str(line).unwrap_or(json!({}));
    let id = message.get("id").cloned();
    let Some(id) = id else {
        return None;
    };
    match endpoint {
        Ok((port, token)) => match post(port, token, &message) {
            Ok(response) => Some(response.to_string()),
            Err(error) => Some(jsonrpc_error(id, &error).to_string()),
        },
        Err(error) => Some(jsonrpc_error(id, error).to_string()),
    }
}

fn post(port: u16, token: &str, message: &Value) -> Result<Value, String> {
    let mut stream = TcpStream::connect_timeout(
        &SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        Duration::from_secs(2),
    ).map_err(|_| "青幕写作未启动，或尚未打开 MCP 开关。".to_string())?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(900)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let body = message.to_string();
    let request = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|_| "青幕写作未启动，或尚未打开 MCP 开关。".to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|_| "青幕写作没有响应 MCP 调用。".to_string())?;
    let payload = response.split("\r\n\r\n").nth(1).unwrap_or("");
    if response.starts_with("HTTP/1.1 401") || response.starts_with("HTTP/1.1 403") {
        return Err("MCP 连接被拒绝。".to_string());
    }
    serde_json::from_str(payload).map_err(|_| "MCP 响应无法解析。".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::server::start_with;
    use std::sync::Arc;

    #[test]
    fn missing_endpoint_returns_a_chinese_startup_error() {
        let response = bridge_line(
            r#"{"jsonrpc":"2.0","id":4,"method":"tools/list"}"#,
            Err("青幕写作未启动，或尚未打开 MCP 开关。"),
        ).unwrap();
        assert!(response.contains("青幕写作未启动"));
        assert!(response.contains("\"id\":4") || response.contains("\"id\": 4"));
    }

    #[test]
    fn stdio_bridge_forwards_tool_list_and_call_errors() {
        let server = start_with(Arc::new(|_| Err("保存被拒绝".to_string()))).unwrap();
        let listed = bridge_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#,
            Ok((server.port(), server.token())),
        ).unwrap();
        assert!(listed.contains("extract_memory"));
        assert!(listed.contains("format_chapter"));
        let called = bridge_line(
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"save_document"}}"#,
            Ok((server.port(), server.token())),
        ).unwrap();
        assert!(called.contains("保存被拒绝"));
        server.stop();
    }
}
