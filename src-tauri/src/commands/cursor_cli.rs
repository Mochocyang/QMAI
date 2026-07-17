//! Cursor CLI + cursor-api-proxy management.
//!
//! Detects the local `agent` binary and can start `cursor-api-proxy` so the
//! frontend can talk OpenAI-compatible HTTP. Port is chosen dynamically
//! (prefer 8765, else an ephemeral free port) via `CURSOR_BRIDGE_PORT`.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::cli_resolver::{child_path_env, find_cli_command};
use super::local_cli_config::{apply_local_cli_environment, resolve_home_dir};

const PREFERRED_PROXY_PORT: u16 = 8765;
const DEFAULT_PROXY_BASE: &str = "http://127.0.0.1:8765";
const PROXY_START_TIMEOUT_MS: u64 = 15_000;
const PROXY_POLL_MS: u64 = 200;

#[derive(Default)]
struct ManagedProxy {
    child: Option<Child>,
    /// e.g. http://127.0.0.1:8765 — the port this managed child actually bound.
    base_url: Option<String>,
}

#[derive(Default)]
pub struct CursorProxyState {
    managed: Arc<Mutex<ManagedProxy>>,
}

#[derive(Serialize)]
pub struct DetectResult {
    installed: bool,
    version: Option<String>,
    path: Option<String>,
    model: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct ProxyStatus {
    healthy: bool,
    base_url: String,
    managed: bool,
    error: Option<String>,
}

fn suppress_windows_console(_cmd: &mut Command) {
    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        _cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

async fn find_agent_command() -> Result<std::path::PathBuf, String> {
    find_cli_command("agent", &["agent.cmd", "agent.exe"]).await
}

async fn find_proxy_launcher() -> Result<(std::path::PathBuf, Vec<String>), String> {
    if let Ok(bin) = find_cli_command(
        "cursor-api-proxy",
        &["cursor-api-proxy.cmd", "cursor-api-proxy.exe"],
    )
    .await
    {
        return Ok((bin, vec![]));
    }

    let npx = find_cli_command("npx", &["npx.cmd", "npx.exe"])
        .await
        .map_err(|_| {
            "`cursor-api-proxy` and `npx` not found on PATH. Install Node.js 18+ and `npm i -g cursor-api-proxy`, or ensure `npx` works."
                .to_string()
        })?;
    Ok((
        npx,
        vec![
            "--yes".to_string(),
            "cursor-api-proxy".to_string(),
        ],
    ))
}

fn normalize_proxy_base(base_url: Option<String>) -> String {
    let raw = base_url
        .unwrap_or_else(|| DEFAULT_PROXY_BASE.to_string())
        .trim()
        .to_string();
    let trimmed = raw.trim_end_matches('/').to_string();
    if trimmed.to_lowercase().ends_with("/v1") {
        trimmed[..trimmed.len() - 3].trim_end_matches('/').to_string()
    } else {
        trimmed
    }
}

fn parse_http_url(base: &str) -> Result<(String, u16, String), String> {
    let url = base.trim();
    let without_scheme = if let Some(rest) = url.strip_prefix("http://") {
        rest
    } else if url.starts_with("https://") {
        return Err("cursor-api-proxy health check only supports http:// localhost URLs".to_string());
    } else {
        return Err(format!("Invalid proxy base URL: {base}"));
    };

    let (host_port, path) = match without_scheme.split_once('/') {
        Some((hp, p)) => (hp, format!("/{p}")),
        None => (without_scheme, "/".to_string()),
    };

    let (host, port) = if let Some((h, p)) = host_port.rsplit_once(':') {
        let port: u16 = p
            .parse()
            .map_err(|_| format!("Invalid port in proxy URL: {base}"))?;
        (h.to_string(), port)
    } else {
        (host_port.to_string(), 80)
    };

    Ok((host, port, path))
}

fn port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Prefer 8765; if taken, bind `:0` once to learn a free ephemeral port.
fn allocate_proxy_port() -> Result<u16, String> {
    if port_available(PREFERRED_PROXY_PORT) {
        return Ok(PREFERRED_PROXY_PORT);
    }
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("Failed to allocate free localhost port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read allocated port: {e}"))?
        .port();
    drop(listener);
    Ok(port)
}

fn base_url_for_port(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

async fn http_get_status(base: &str, path: &str) -> Result<u16, String> {
    let (host, port, _) = parse_http_url(base)?;
    let request_path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };

    let mut stream = tokio::time::timeout(
        Duration::from_secs(2),
        TcpStream::connect((host.as_str(), port)),
    )
    .await
    .map_err(|_| "health check timed out connecting".to_string())?
    .map_err(|e| format!("health check connect failed: {e}"))?;

    let req = format!(
        "GET {request_path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(req.as_bytes())
        .await
        .map_err(|e| format!("health check write failed: {e}"))?;

    let mut buf = vec![0u8; 1024];
    let n = tokio::time::timeout(Duration::from_secs(2), stream.read(&mut buf))
        .await
        .map_err(|_| "health check timed out reading".to_string())?
        .map_err(|e| format!("health check read failed: {e}"))?;

    let text = String::from_utf8_lossy(&buf[..n]);
    let status_line = text.lines().next().unwrap_or("");
    let code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| format!("unexpected health response: {status_line}"))?;
    Ok(code)
}

async fn ping_health(base: &str) -> bool {
    matches!(http_get_status(base, "/health").await, Ok(200))
}

/// Detect whether Cursor `agent` CLI is installed on PATH.
pub async fn do_cursor_cli_detect() -> Result<DetectResult, String> {
    let path = match find_agent_command().await {
        Ok(p) => p,
        Err(error) => {
            return Ok(DetectResult {
                installed: false,
                version: None,
                path: None,
                model: None,
                error: Some(error),
            });
        }
    };

    let path_str = path.to_string_lossy().to_string();
    let mut cmd = Command::new(&path);
    suppress_windows_console(&mut cmd);
    apply_local_cli_environment(&mut cmd);
    if let Some(path_env) = child_path_env().await {
        cmd.env("PATH", path_env);
    }

    let output = tokio::time::timeout(Duration::from_secs(5), cmd.arg("--version").output()).await;

    match output {
        Ok(Ok(out)) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let version = if !stdout.is_empty() {
                stdout
            } else if !stderr.is_empty() {
                stderr
            } else {
                "agent".to_string()
            };
            Ok(DetectResult {
                installed: true,
                version: Some(version),
                path: Some(path_str),
                model: None,
                error: None,
            })
        }
        Ok(Ok(out)) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Ok(DetectResult {
                installed: true,
                version: None,
                path: Some(path_str),
                model: None,
                error: Some(if stderr.is_empty() {
                    format!("`agent --version` exited with {}", out.status)
                } else {
                    stderr
                }),
            })
        }
        Ok(Err(e)) => Ok(DetectResult {
            installed: false,
            version: None,
            path: Some(path_str),
            model: None,
            error: Some(format!("Failed to spawn `agent`: {e}")),
        }),
        Err(_) => Ok(DetectResult {
            installed: true,
            version: None,
            path: Some(path_str),
            model: None,
            error: Some("`agent --version` timed out after 5s".to_string()),
        }),
    }
}

#[tauri::command]
pub async fn cursor_cli_detect() -> Result<DetectResult, String> {
    do_cursor_cli_detect().await
}

#[tauri::command]
pub async fn cursor_proxy_status(state: State<'_, CursorProxyState>) -> Result<ProxyStatus, String> {
    let (base, managed) = {
        let guard = state.managed.lock().await;
        (
            guard
                .base_url
                .clone()
                .unwrap_or_else(|| DEFAULT_PROXY_BASE.to_string()),
            guard.child.is_some(),
        )
    };
    let healthy = ping_health(&base).await;
    Ok(ProxyStatus {
        healthy,
        base_url: base,
        managed,
        error: if healthy {
            None
        } else {
            Some("cursor-api-proxy is not reachable".to_string())
        },
    })
}

fn read_nonempty_env(keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        std::env::var(key)
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    })
}

/// Parse `export NAME=value` / `NAME=value` from a shell rc file. No secret logging.
fn read_export_from_rc(rc_path: &std::path::Path, name: &str) -> Option<String> {
    let content = std::fs::read_to_string(rc_path).ok()?;
    let prefix = format!("{name}=");
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line).trim();
        if let Some(rest) = line.strip_prefix(&prefix) {
            let value = rest
                .trim()
                .trim_matches(|c| c == '\'' || c == '"')
                .trim()
                .to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

fn read_cursor_api_key_from_user_files() -> Option<String> {
    let home = resolve_home_dir()?;
    for rel in [".zshrc", ".zprofile", ".bashrc", ".bash_profile", ".profile"] {
        if let Some(v) = read_export_from_rc(&home.join(rel), "CURSOR_API_KEY") {
            return Some(v);
        }
    }
    let auth_path = home.join(".cursor").join("auth.json");
    let content = std::fs::read_to_string(auth_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    json.get("apiKey")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
}

fn read_agent_credential_store_from_user_files() -> Option<String> {
    let home = resolve_home_dir()?;
    for rel in [".zshrc", ".zprofile", ".bashrc", ".bash_profile", ".profile"] {
        if let Some(v) = read_export_from_rc(&home.join(rel), "AGENT_CLI_CREDENTIAL_STORE") {
            return Some(v);
        }
    }
    None
}

/// GUI apps do not load ~/.zshrc. Inject the same Cursor CLI auth the user
/// exports in shell: CURSOR_API_KEY + AGENT_CLI_CREDENTIAL_STORE.
fn apply_cursor_auth_env(cmd: &mut Command) {
    let api_key = read_nonempty_env(&["CURSOR_API_KEY"]).or_else(read_cursor_api_key_from_user_files);
    if let Some(api_key) = api_key {
        cmd.env("CURSOR_API_KEY", api_key);
    }

    let store = read_nonempty_env(&["AGENT_CLI_CREDENTIAL_STORE"])
        .or_else(read_agent_credential_store_from_user_files)
        .unwrap_or_else(|| "file".to_string());
    cmd.env("AGENT_CLI_CREDENTIAL_STORE", store);

    if let Some(token) = read_nonempty_env(&["CURSOR_AUTH_TOKEN"]) {
        cmd.env("CURSOR_AUTH_TOKEN", token);
    }

    for key in [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ] {
        cmd.env_remove(key);
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

async fn spawn_proxy_process(port: u16) -> Result<Child, String> {
    let (launcher, extra_args) = find_proxy_launcher().await?;
    let path_env = child_path_env().await;

    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut parts = Vec::with_capacity(1 + extra_args.len());
        parts.push(shell_quote(&launcher.to_string_lossy()));
        for arg in &extra_args {
            parts.push(shell_quote(arg));
        }
        let cmdline = format!("exec {}", parts.join(" "));

        let mut cmd = Command::new(&shell);
        suppress_windows_console(&mut cmd);
        apply_local_cli_environment(&mut cmd);
        if let Some(path_env) = path_env {
            cmd.env("PATH", path_env);
        }
        apply_cursor_auth_env(&mut cmd);
        cmd.env("CURSOR_BRIDGE_HOST", "127.0.0.1");
        cmd.env("CURSOR_BRIDGE_PORT", port.to_string());
        cmd.args(["-l", "-c", &cmdline]);
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);

        return cmd
            .spawn()
            .map_err(|e| format!("Failed to start cursor-api-proxy: {e}"));
    }

    #[cfg(windows)]
    {
        let mut cmd = Command::new(&launcher);
        suppress_windows_console(&mut cmd);
        apply_local_cli_environment(&mut cmd);
        if let Some(path_env) = path_env {
            cmd.env("PATH", path_env);
        }
        apply_cursor_auth_env(&mut cmd);
        cmd.env("CURSOR_BRIDGE_HOST", "127.0.0.1");
        cmd.env("CURSOR_BRIDGE_PORT", port.to_string());
        cmd.args(&extra_args);
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);

        cmd.spawn()
            .map_err(|e| format!("Failed to start cursor-api-proxy: {e}"))
    }
}

async fn stop_managed_child(state: &CursorProxyState) {
    let mut guard = state.managed.lock().await;
    if let Some(mut child) = guard.child.take() {
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
    }
    guard.base_url = None;
}

async fn wait_until_healthy(base: &str) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_millis(PROXY_START_TIMEOUT_MS);
    while tokio::time::Instant::now() < deadline {
        if ping_health(base).await {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(PROXY_POLL_MS)).await;
    }
    false
}

/// Ensure cursor-api-proxy is healthy. Starts (or force-restarts) on a free port.
#[tauri::command]
pub async fn cursor_proxy_ensure(
    state: State<'_, CursorProxyState>,
    force_restart: Option<bool>,
) -> Result<ProxyStatus, String> {
    let force = force_restart.unwrap_or(false);

    {
        let mut guard = state.managed.lock().await;
        if let Some(child) = guard.child.as_mut() {
            match child.try_wait() {
                Ok(None) => {
                    if !force {
                        if let Some(base) = guard.base_url.clone() {
                            drop(guard);
                            if ping_health(&base).await {
                                return Ok(ProxyStatus {
                                    healthy: true,
                                    base_url: base,
                                    managed: true,
                                    error: None,
                                });
                            }
                        }
                    }
                }
                _ => {
                    guard.child = None;
                    guard.base_url = None;
                }
            }
        }
    }

    stop_managed_child(&state).await;

    let port = allocate_proxy_port()?;
    let base = base_url_for_port(port);
    let child = spawn_proxy_process(port).await?;
    {
        let mut guard = state.managed.lock().await;
        guard.child = Some(child);
        guard.base_url = Some(base.clone());
    }

    if wait_until_healthy(&base).await {
        return Ok(ProxyStatus {
            healthy: true,
            base_url: base,
            managed: true,
            error: None,
        });
    }

    stop_managed_child(&state).await;
    Err(format!(
        "Started cursor-api-proxy on {base} but /health did not become ready within {PROXY_START_TIMEOUT_MS}ms. Ensure Node.js 18+, `agent` CLI, and that CURSOR_API_KEY / AGENT_CLI_CREDENTIAL_STORE are set in ~/.zshrc (or auth.json)."
    ))
}

/// Stop the proxy process if this app started it.
#[tauri::command]
pub async fn cursor_proxy_stop(state: State<'_, CursorProxyState>) -> Result<(), String> {
    stop_managed_child(&state).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_v1_suffix() {
        assert_eq!(
            normalize_proxy_base(Some("http://127.0.0.1:8765/v1".into())),
            "http://127.0.0.1:8765"
        );
        assert_eq!(
            normalize_proxy_base(Some("http://127.0.0.1:8765/".into())),
            "http://127.0.0.1:8765"
        );
        assert_eq!(normalize_proxy_base(None), DEFAULT_PROXY_BASE);
    }

    #[test]
    fn parse_localhost_url() {
        let (host, port, path) = parse_http_url("http://127.0.0.1:8765").unwrap();
        assert_eq!(host, "127.0.0.1");
        assert_eq!(port, 8765);
        assert_eq!(path, "/");
    }

    #[test]
    fn allocate_prefers_8765_when_free() {
        if port_available(PREFERRED_PROXY_PORT) {
            assert_eq!(allocate_proxy_port().unwrap(), PREFERRED_PROXY_PORT);
        }
    }

    #[test]
    fn allocate_returns_nonzero_when_preferred_taken() {
        let _hold = std::net::TcpListener::bind(("127.0.0.1", PREFERRED_PROXY_PORT));
        if _hold.is_err() {
            let port = allocate_proxy_port().unwrap();
            assert!(port > 0);
            return;
        }
        let port = allocate_proxy_port().unwrap();
        assert_ne!(port, PREFERRED_PROXY_PORT);
        assert!(port > 0);
    }

    #[test]
    fn reads_export_lines_from_rc() {
        let dir = std::env::temp_dir().join(format!("qmai-cursor-rc-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let rc = dir.join(".zshrc");
        std::fs::write(
            &rc,
            "# comment\nexport CURSOR_API_KEY=crsr_test_key\nexport AGENT_CLI_CREDENTIAL_STORE=file\n",
        )
        .unwrap();
        assert_eq!(
            read_export_from_rc(&rc, "CURSOR_API_KEY").as_deref(),
            Some("crsr_test_key")
        );
        assert_eq!(
            read_export_from_rc(&rc, "AGENT_CLI_CREDENTIAL_STORE").as_deref(),
            Some("file")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
