mod paths;
mod protocol;
mod server;
mod stdio;

use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use server::RunningServer;

pub struct McpState {
    pending: server::PendingCalls,
    server: Mutex<Option<RunningServer>>,
}

impl Default for McpState {
    fn default() -> Self {
        Self {
            pending: Arc::new(Mutex::new(std::collections::HashMap::new())),
            server: Mutex::new(None),
        }
    }
}

pub fn stdio_requested() -> bool {
    std::env::args().any(|arg| arg == "--mcp-stdio")
}

pub fn run_stdio() {
    stdio::run();
}

#[tauri::command]
pub fn mcp_set_enabled(app: AppHandle, state: State<'_, McpState>, enabled: bool) -> Result<(), String> {
    let mut server = state.server.lock().map_err(|_| "MCP 状态不可用".to_string())?;
    if !enabled {
        if let Some(running) = server.take() {
            running.stop();
        }
        let _ = std::fs::remove_file(paths::endpoint_file());
        return Ok(());
    }
    if server.is_some() {
        return Ok(());
    }
    let running = server::start(app, state.pending.clone())?;
    paths::write_endpoint(running.port(), running.token())?;
    *server = Some(running);
    Ok(())
}

#[tauri::command]
pub fn mcp_respond(state: State<'_, McpState>, id: String, body: Value) -> Result<(), String> {
    server::complete_call(&state.pending, &id, body)
}

#[tauri::command]
pub fn mcp_stdio_executable() -> Result<String, String> {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| format!("无法定位程序路径：{error}"))
}

#[tauri::command]
pub fn resolve_qmai_mcp_skill_dir(app: AppHandle) -> Result<String, String> {
    let mut starts = Vec::new();
    if let Ok(resource) = app.path().resource_dir() {
        starts.push(resource);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            starts.push(dir.to_path_buf());
        }
    }
    if let Ok(current) = std::env::current_dir() {
        starts.push(current);
    }
    paths::find_skill_dir(&starts)
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| "找不到随包 qmai-mcp skill".to_string())
}

