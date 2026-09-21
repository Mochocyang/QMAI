//! Cursor CLI + cursor-api-proxy management.
//!
//! Detects the local `agent` binary and can start `cursor-api-proxy` so the
//! frontend can talk OpenAI-compatible HTTP. Port is chosen dynamically
//! (prefer 8765, else an ephemeral free port) via `CURSOR_BRIDGE_PORT`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::cli_resolver::{child_path_env, find_cli_command};
use super::local_cli_config::{apply_local_cli_environment, resolve_home_dir};

const PREFERRED_PROXY_PORT: u16 = 8765;
const DEFAULT_PROXY_BASE: &str = "http://127.0.0.1:8765";
const PROXY_START_TIMEOUT_MS: u64 = 90_000;
const PROXY_POLL_MS: u64 = 200;
/// Align parked ACP tool turns with the frontend LLM backstop (30 minutes).
const PROXY_TIMEOUT_MS: u64 = 30 * 60 * 1000;
const AGENT_ABOUT_TIMEOUT: Duration = Duration::from_secs(20);
const AGENT_UPDATE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const AGENT_TRUST_TIMEOUT: Duration = Duration::from_secs(45);
const ACP_MODELS_TIMEOUT: Duration = Duration::from_secs(30);
const ACP_MODELS_CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const QMAI_WORKSPACE_TRUST_MARKER: &str = ".qmai-workspace-trusted";
const QMAI_ACP_MODEL_FILE: &str = "qmai-acp-model";
const QMAI_ACP_MODELS_CACHE: &str = "qmai-acp-models.json";
const QMAI_CURSOR_AGENT_WRAPPER: &str = include_str!("../../scripts/qmai-cursor-agent.cjs");
static AGENT_UPDATE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

struct AgentUpdateGuard;

impl Drop for AgentUpdateGuard {
    fn drop(&mut self) {
        AGENT_UPDATE_IN_FLIGHT.store(false, Ordering::SeqCst);
    }
}

#[derive(Default)]
struct ManagedProxy {
    child: Option<Child>,
    /// e.g. http://127.0.0.1:8765 — the port this managed child actually bound.
    base_url: Option<String>,
    launch_fingerprint: Option<String>,
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
pub struct AgentAboutResult {
    installed: bool,
    version: Option<String>,
    latest_status: Option<String>,
    latest_version: Option<String>,
    path: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct AgentUpdateResult {
    ok: bool,
    version: Option<String>,
    output: String,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct ProxyStatus {
    healthy: bool,
    base_url: String,
    managed: bool,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AcpCatalogModel {
    pub name: String,
    #[serde(rename = "modelId")]
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AcpModelsCacheFile {
    fetched_at_ms: u64,
    models: Vec<AcpCatalogModel>,
}

static ACP_MODELS_MEMORY: std::sync::Mutex<Option<Vec<AcpCatalogModel>>> =
    std::sync::Mutex::new(None);

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

fn npx_proxy_args() -> Vec<String> {
    vec!["--yes".to_string(), "cursor-api-proxy@latest".to_string()]
}

fn agent_trust_args(workspace: &Path) -> Vec<String> {
    vec![
        "--trust".to_string(),
        "--workspace".to_string(),
        workspace.to_string_lossy().into_owned(),
        "--mode".to_string(),
        "ask".to_string(),
        "--output-format".to_string(),
        "text".to_string(),
        "-p".to_string(),
        "ok".to_string(),
    ]
}

fn qmai_workspace_trust_marker(config_dir: &Path) -> PathBuf {
    config_dir.join(QMAI_WORKSPACE_TRUST_MARKER)
}

async fn ensure_qmai_workspace_trusted(workspace: &Path, config_dir: &Path) {
    let marker = qmai_workspace_trust_marker(config_dir);
    if marker.is_file() {
        return;
    }
    let args = agent_trust_args(workspace);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    match run_agent_command(&arg_refs, AGENT_TRUST_TIMEOUT, Some(config_dir)).await {
        Ok((_path, true, _output)) => {
            if let Err(error) = std::fs::write(&marker, "") {
                eprintln!(
                    "[cursor-cli] trusted workspace but failed to write {}: {error}",
                    marker.display()
                );
            }
        }
        Ok((_path, false, output)) => {
            eprintln!(
                "[cursor-cli] `agent --trust -p` failed for {}: {output}",
                workspace.display()
            );
        }
        Err(error) => {
            eprintln!("[cursor-cli] workspace trust skipped: {error}");
        }
    }
}

fn npx_missing_error() -> String {
    "`npx` not found on PATH. Install Node.js 18+ or set CURSOR_API_PROXY_BIN to a cursor-api-proxy binary."
        .to_string()
}

fn resolve_explicit_proxy_bin(path: &Path) -> Result<(PathBuf, Vec<String>), String> {
    if path.is_file() {
        Ok((path.to_path_buf(), vec![]))
    } else {
        Err(format!(
            "CURSOR_API_PROXY_BIN is set but is not a file: {}",
            path.display()
        ))
    }
}

async fn find_proxy_launcher() -> Result<(PathBuf, Vec<String>), String> {
    if let Some(bin) = read_nonempty_env(&["CURSOR_API_PROXY_BIN"]) {
        return resolve_explicit_proxy_bin(Path::new(&bin));
    }

    find_cli_command("npx", &["npx.cmd", "npx.exe"])
        .await
        .map(|bin| (bin, npx_proxy_args()))
        .map_err(|_| npx_missing_error())
}

fn qmai_proxy_home_dirs() -> Result<(PathBuf, PathBuf), String> {
    let home = resolve_home_dir().ok_or_else(|| "Cannot resolve home directory for cursor-api-proxy".to_string())?;
    let root = home.join(".cursor-api-proxy");
    let config_dir = root.join("qmai-agent");
    let workspace = root.join("qmai-workspace");
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create {}: {e}", config_dir.display()))?;
    std::fs::create_dir_all(&workspace)
        .map_err(|e| format!("Failed to create {}: {e}", workspace.display()))?;
    Ok((config_dir, workspace))
}

fn ensure_qmai_cli_config(config_dir: &Path) -> Result<PathBuf, String> {
    let path = config_dir.join("cli-config.json");
    let mut value = if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({
            "version": 1,
            "editor": { "vimMode": false },
            "permissions": { "allow": [], "deny": [] }
        })
    };
    if !value.is_object() {
        value = serde_json::json!({});
    }
    value["disableAutoUpdate"] = serde_json::json!(true);
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&value)
            .map_err(|e| format!("Failed to serialize {}: {e}", path.display()))?,
    )
    .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    Ok(path)
}

fn apply_qmai_acp_model(
    config_dir: &Path,
    model: &str,
    fast: Option<bool>,
    effort: Option<&str>,
    cli_model: Option<&str>,
) -> Result<(), String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("ACP model id is empty".to_string());
    }
    let path = ensure_qmai_cli_config(config_dir)?;
    let mut value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !value.is_object() {
        value = serde_json::json!({});
    }
    let mut parameters = Vec::new();
    if let Some(effort) = effort.map(str::trim).filter(|value| !value.is_empty()) {
        parameters.push(serde_json::json!({ "id": "effort", "value": effort }));
    }
    if let Some(fast) = fast {
        parameters.push(serde_json::json!({
            "id": "fast",
            "value": if fast { "true" } else { "false" }
        }));
    }
    value["selectedModel"] = serde_json::json!({
        "modelId": model,
        "parameters": parameters
    });
    if let Some(obj) = value.get_mut("model").and_then(|item| item.as_object_mut()) {
        obj.insert("modelId".to_string(), serde_json::json!(model));
        obj.insert("displayModelId".to_string(), serde_json::json!(model));
    } else {
        value["model"] = serde_json::json!({
            "modelId": model,
            "displayModelId": model
        });
    }
    value["hasChangedDefaultModel"] = serde_json::json!(true);
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&value)
            .map_err(|e| format!("Failed to serialize {}: {e}", path.display()))?,
    )
    .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    let pin = cli_model
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "default" && *value != "auto")
        .unwrap_or(model);
    std::fs::write(config_dir.join(QMAI_ACP_MODEL_FILE), pin)
    .map_err(|e| {
        format!(
            "Failed to write {}: {e}",
            config_dir.join(QMAI_ACP_MODEL_FILE).display()
        )
    })?;
    Ok(())
}

#[allow(dead_code)]
fn qmai_acp_model_value(model: &str, fast: Option<bool>, effort: Option<&str>) -> String {
    let mut params = Vec::new();
    if let Some(effort) = effort.map(str::trim).filter(|value| !value.is_empty()) {
        params.push(format!("effort={effort}"));
    }
    if let Some(fast) = fast {
        params.push(format!("fast={}", if fast { "true" } else { "false" }));
    }
    if params.is_empty() {
        model.to_string()
    } else {
        format!("{model}[{}]", params.join(","))
    }
}

#[tauri::command]
pub async fn cursor_cli_apply_acp_model(
    model: String,
    fast: Option<bool>,
    effort: Option<String>,
    cli_model: Option<String>,
) -> Result<(), String> {
    let (config_dir, _) = qmai_proxy_home_dirs()?;
    apply_qmai_acp_model(
        &config_dir,
        &model,
        fast,
        effort.as_deref(),
        cli_model.as_deref(),
    )
}

fn parse_acp_available_models(value: &serde_json::Value) -> Vec<AcpCatalogModel> {
    let models = value
        .pointer("/result/models/availableModels")
        .or_else(|| value.pointer("/models/availableModels"))
        .and_then(|item| item.as_array())
        .cloned()
        .unwrap_or_default();
    models
        .into_iter()
        .filter_map(|item| {
            let model_id = item.get("modelId")?.as_str()?.trim();
            if model_id.is_empty() {
                return None;
            }
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .unwrap_or(model_id);
            Some(AcpCatalogModel {
                name: name.to_string(),
                model_id: model_id.to_string(),
            })
        })
        .collect()
}

fn unix_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn memory_acp_models() -> Option<Vec<AcpCatalogModel>> {
    ACP_MODELS_MEMORY.lock().ok()?.clone()
}

fn remember_acp_models(models: &[AcpCatalogModel]) {
    if let Ok(mut guard) = ACP_MODELS_MEMORY.lock() {
        *guard = Some(models.to_vec());
    }
}

fn cli_config_has_auth(config_dir: &Path) -> bool {
    let path = config_dir.join("cli-config.json");
    let Ok(raw) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    value
        .get("authInfo")
        .and_then(|auth| auth.get("authId").or_else(|| auth.get("email")))
        .and_then(|v| v.as_str())
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

fn has_cursor_api_key() -> bool {
    read_nonempty_env(&["CURSOR_API_KEY"]).is_some()
        || read_cursor_api_key_from_user_files().is_some()
}

fn should_skip_acp_authenticate(config_dir: &Path) -> bool {
    has_cursor_api_key() || cli_config_has_auth(config_dir)
}

fn is_acp_auth_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("authentication required")
        || lower.contains("not authenticated")
        || lower.contains("unauthorized")
        || lower.contains("cursor_login")
        || lower.contains("please run 'agent login'")
}

fn read_cached_acp_models(config_dir: &Path) -> Option<Vec<AcpCatalogModel>> {
    let path = config_dir.join(QMAI_ACP_MODELS_CACHE);
    let raw = std::fs::read_to_string(path).ok()?;
    let cache: AcpModelsCacheFile = serde_json::from_str(&raw).ok()?;
    if cache.models.is_empty() {
        return None;
    }
    let now = unix_now_ms();
    if now.saturating_sub(cache.fetched_at_ms) > ACP_MODELS_CACHE_TTL.as_millis() as u64 {
        return None;
    }
    Some(cache.models)
}

fn write_cached_acp_models(config_dir: &Path, models: &[AcpCatalogModel]) {
    if models.is_empty() {
        return;
    }
    let payload = AcpModelsCacheFile {
        fetched_at_ms: unix_now_ms(),
        models: models.to_vec(),
    };
    if let Ok(raw) = serde_json::to_string_pretty(&payload) {
        let _ = std::fs::write(config_dir.join(QMAI_ACP_MODELS_CACHE), raw);
    }
}

async fn send_acp_request<W: AsyncWriteExt + Unpin>(
    stdin: &mut W,
    id: u64,
    method: &str,
    params: serde_json::Value,
) -> Result<(), String> {
    let mut raw = serde_json::to_string(&serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
    }))
    .map_err(|e| format!("ACP serialize {method}: {e}"))?;
    raw.push('\n');
    stdin
        .write_all(raw.as_bytes())
        .await
        .map_err(|e| format!("ACP write {method}: {e}"))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("ACP flush {method}: {e}"))
}

fn acp_response_id(value: &serde_json::Value) -> Option<u64> {
    let id = value.get("id")?;
    id.as_u64()
        .or_else(|| id.as_i64().and_then(|v| u64::try_from(v).ok()))
        .or_else(|| id.as_str()?.parse().ok())
}

async fn wait_acp_response<R: AsyncBufReadExt + Unpin>(
    reader: &mut R,
    id: u64,
) -> Result<serde_json::Value, String> {
    let mut line = String::new();
    loop {
        line.clear();
        let n = reader
            .read_line(&mut line)
            .await
            .map_err(|e| format!("ACP read: {e}"))?;
        if n == 0 {
            return Err("ACP stdout closed".to_string());
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        if acp_response_id(&value) != Some(id) {
            continue;
        }
        if let Some(error) = value.get("error") {
            let message = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("ACP error");
            return Err(message.to_string());
        }
        return Ok(value);
    }
}

async fn acp_authenticate<W, R>(stdin: &mut W, reader: &mut R, id: u64) -> Result<(), String>
where
    W: AsyncWriteExt + Unpin,
    R: AsyncBufReadExt + Unpin,
{
    send_acp_request(
        stdin,
        id,
        "authenticate",
        serde_json::json!({ "methodId": "cursor_login" }),
    )
    .await?;
    wait_acp_response(reader, id).await?;
    Ok(())
}

async fn acp_session_models<W, R>(
    stdin: &mut W,
    reader: &mut R,
    id: u64,
    cwd: &str,
) -> Result<Vec<AcpCatalogModel>, String>
where
    W: AsyncWriteExt + Unpin,
    R: AsyncBufReadExt + Unpin,
{
    send_acp_request(
        stdin,
        id,
        "session/new",
        serde_json::json!({ "cwd": cwd, "mcpServers": [] }),
    )
    .await?;
    let sess = wait_acp_response(reader, id).await?;
    let models = parse_acp_available_models(&sess);
    if models.is_empty() {
        return Err("ACP session/new 未返回 availableModels".to_string());
    }
    Ok(models)
}

async fn list_cursor_acp_models() -> Result<Vec<AcpCatalogModel>, String> {
    if let Some(cached) = memory_acp_models() {
        return Ok(cached);
    }
    let (config_dir, workspace) = qmai_proxy_home_dirs()?;
    if let Some(cached) = read_cached_acp_models(&config_dir) {
        remember_acp_models(&cached);
        return Ok(cached);
    }
    ensure_qmai_cli_config(&config_dir)?;
    ensure_qmai_workspace_trusted(&workspace, &config_dir).await;
    let agent = find_agent_command().await?;
    let cwd = workspace.to_string_lossy().into_owned();
    let skip_authenticate = should_skip_acp_authenticate(&config_dir);

    let mut cmd = Command::new(&agent);
    suppress_windows_console(&mut cmd);
    apply_local_cli_environment(&mut cmd);
    if let Some(path_env) = child_path_env().await {
        cmd.env("PATH", path_env);
    }
    apply_cursor_auth_env(&mut cmd);
    cmd.env("CURSOR_CONFIG_DIR", &config_dir);
    cmd.env_remove("CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE");
    cmd.kill_on_drop(true);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.current_dir(&workspace);
    cmd.args(["--workspace", &cwd, "acp", "--mode", "ask"]);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn `agent acp`: {e}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "agent acp stdin missing".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "agent acp stdout missing".to_string())?;
    let mut reader = BufReader::new(stdout);

    let run = async {
        send_acp_request(
            &mut stdin,
            1,
            "initialize",
            serde_json::json!({
                "protocolVersion": 1,
                "clientCapabilities": {
                    "fs": { "readTextFile": false, "writeTextFile": false },
                    "terminal": false
                },
                "clientInfo": { "name": "qmai", "version": "0" }
            }),
        )
        .await?;
        wait_acp_response(&mut reader, 1).await?;
        let mut next_id = 2_u64;
        if !skip_authenticate {
            acp_authenticate(&mut stdin, &mut reader, next_id).await?;
            next_id += 1;
        }
        match acp_session_models(&mut stdin, &mut reader, next_id, &cwd).await {
            Ok(models) => Ok(models),
            Err(error) if skip_authenticate && is_acp_auth_error(&error) => {
                next_id += 1;
                acp_authenticate(&mut stdin, &mut reader, next_id).await?;
                next_id += 1;
                acp_session_models(&mut stdin, &mut reader, next_id, &cwd).await
            }
            Err(error) => Err(error),
        }
    };

    let result = tokio::time::timeout(ACP_MODELS_TIMEOUT, run).await;
    let _ = child.kill().await;
    let _ = child.wait().await;
    let models = match result {
        Ok(inner) => inner?,
        Err(_) => return Err("agent acp session/new timed out".to_string()),
    };
    remember_acp_models(&models);
    write_cached_acp_models(&config_dir, &models);
    Ok(models)
}

#[tauri::command]
pub async fn cursor_cli_acp_models() -> Result<Vec<AcpCatalogModel>, String> {
    list_cursor_acp_models().await
}

fn ensure_qmai_agent_wrapper(
    config_dir: &Path,
    agent_bin: Option<&Path>,
) -> Result<PathBuf, String> {
    let baked = agent_bin
        .map(|path| serde_json::to_string(&path.to_string_lossy().as_ref()).unwrap_or_else(|_| "\"\"".into()))
        .unwrap_or_else(|| "\"\"".to_string());
    let source = QMAI_CURSOR_AGENT_WRAPPER.replace("__QMAI_BAKED_AGENT__", &baked);
    let script = config_dir.join("qmai-cursor-agent.cjs");
    std::fs::write(&script, source)
        .map_err(|e| format!("Failed to write {}: {e}", script.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755));
        Ok(script)
    }
    #[cfg(windows)]
    {
        let cmd_path = config_dir.join("qmai-cursor-agent.cmd");
        std::fs::write(
            &cmd_path,
            "@echo off\r\nnode \"%~dp0qmai-cursor-agent.cjs\" %*\r\n",
        )
        .map_err(|e| format!("Failed to write {}: {e}", cmd_path.display()))?;
        Ok(cmd_path)
    }
}

fn proxy_launch_fingerprint(
    launcher: &Path,
    extra_args: &[String],
    workspace: &Path,
    config_dir: &Path,
) -> String {
    format!(
        "launcher={}|args={}|chat_only=false|acp=true|mode=ask|ws={}|cfg={}|timeout={}|agent_wrap=4|strict=off",
        launcher.display(),
        extra_args.join("\0"),
        workspace.display(),
        config_dir.display(),
        PROXY_TIMEOUT_MS
    )
}

fn extract_json_object(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    if end < start {
        return None;
    }
    Some(&raw[start..=end])
}

fn parse_agent_about_json(raw: &str) -> Option<(String, Option<String>, Option<String>)> {
    let json: serde_json::Value = serde_json::from_str(extract_json_object(raw)?.trim()).ok()?;
    let version = json
        .get("cliVersion")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())?
        .to_string();
    let latest_status = json
        .get("latestStatus")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned);
    let latest_version = json
        .get("latestVersion")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned);
    Some((version, latest_status, latest_version))
}

async fn run_agent_command(
    args: &[&str],
    timeout: Duration,
    config_dir: Option<&Path>,
) -> Result<(PathBuf, bool, String), String> {
    let path = find_agent_command().await?;
    let mut cmd = Command::new(&path);
    suppress_windows_console(&mut cmd);
    apply_local_cli_environment(&mut cmd);
    if let Some(path_env) = child_path_env().await {
        cmd.env("PATH", path_env);
    }
    apply_cursor_auth_env(&mut cmd);
    if let Some(dir) = config_dir {
        cmd.env("CURSOR_CONFIG_DIR", dir);
    } else {
        cmd.env_remove("CURSOR_CONFIG_DIR");
    }
    cmd.env_remove("CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE");
    cmd.args(args);

    let output = tokio::time::timeout(timeout, cmd.output())
        .await
        .map_err(|_| format!("`agent {}` timed out", args.join(" ")))?
        .map_err(|e| format!("Failed to spawn `agent {}`: {e}", args.join(" ")))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let combined = if stderr.is_empty() {
        stdout
    } else if stdout.is_empty() {
        stderr
    } else {
        format!("{stdout}\n{stderr}")
    };
    Ok((path, output.status.success(), combined))
}

fn apply_qmai_proxy_env(
    cmd: &mut Command,
    port: u16,
    workspace: &Path,
    config_dir: &Path,
    agent_bin: Option<&Path>,
    wrapper: Option<&Path>,
) {
    cmd.env("CURSOR_BRIDGE_HOST", "127.0.0.1");
    cmd.env("CURSOR_BRIDGE_PORT", port.to_string());
    cmd.env("CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE", "false");
    cmd.env("CURSOR_BRIDGE_USE_ACP", "true");
    cmd.env("CURSOR_BRIDGE_MODE", "ask");
    // CLI catalog ids (cursor-grok-4.6-medium-fast) are valid for `agent --model`
    // but do not appear in ACP availableModels. Proxy defaults strictModel=true
    // and treats that mismatch as fatal (empty stderr, exit 1).
    cmd.env("CURSOR_BRIDGE_STRICT_MODEL", "false");
    cmd.env("CURSOR_BRIDGE_WORKSPACE", workspace);
    cmd.env("CURSOR_CONFIG_DIR", config_dir);
    cmd.env("CURSOR_BRIDGE_TIMEOUT_MS", PROXY_TIMEOUT_MS.to_string());
    if let (Some(agent_bin), Some(wrapper)) = (agent_bin, wrapper) {
        cmd.env("CURSOR_AGENT_BIN", wrapper);
        cmd.env("QMAI_CURSOR_AGENT_REAL", agent_bin);
    }
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

async fn http_get(base: &str, path: &str) -> Result<(u16, String), String> {
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

    let mut buf = Vec::new();
    let mut chunk = vec![0u8; 4096];
    loop {
        let n = tokio::time::timeout(Duration::from_secs(2), stream.read(&mut chunk))
            .await
            .map_err(|_| "health check timed out reading".to_string())?
            .map_err(|e| format!("health check read failed: {e}"))?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > 64 * 1024 {
            break;
        }
    }

    let text = String::from_utf8_lossy(&buf);
    let status_line = text.lines().next().unwrap_or("");
    let code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| format!("unexpected health response: {status_line}"))?;
    let header_end = text
        .find("\r\n\r\n")
        .map(|i| i + 4)
        .or_else(|| text.find("\n\n").map(|i| i + 2))
        .unwrap_or(0);
    Ok((code, text[header_end..].to_string()))
}

async fn http_get_status(base: &str, path: &str) -> Result<u16, String> {
    http_get(base, path).await.map(|(status, _)| status)
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
pub async fn cursor_cli_about() -> Result<AgentAboutResult, String> {
    let (path, ok, output) = match run_agent_command(
        &["about", "--format", "json"],
        AGENT_ABOUT_TIMEOUT,
        None,
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            return Ok(AgentAboutResult {
                installed: false,
                version: None,
                latest_status: None,
                latest_version: None,
                path: None,
                error: Some(error),
            });
        }
    };
    let path_str = path.to_string_lossy().to_string();
    if let Some((version, latest_status, latest_version)) = parse_agent_about_json(&output) {
        return Ok(AgentAboutResult {
            installed: true,
            version: Some(version),
            latest_status,
            latest_version,
            path: Some(path_str),
            error: if ok {
                None
            } else {
                Some(output)
            },
        });
    }
    Ok(AgentAboutResult {
        installed: true,
        version: None,
        latest_status: None,
        latest_version: None,
        path: Some(path_str),
        error: Some(if output.is_empty() {
            "`agent about --format json` returned no version".to_string()
        } else {
            output
        }),
    })
}

#[tauri::command]
pub async fn cursor_cli_update() -> Result<AgentUpdateResult, String> {
    if AGENT_UPDATE_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(AgentUpdateResult {
            ok: false,
            version: None,
            output: String::new(),
            error: Some("cursor-agent update is already running".to_string()),
        });
    }

    let _guard = AgentUpdateGuard;

    match run_agent_command(&["update"], AGENT_UPDATE_TIMEOUT, None).await {
        Ok((_path, ok, output)) => {
            let version = do_cursor_cli_detect().await.ok().and_then(|detected| detected.version);
            Ok(AgentUpdateResult {
                ok,
                version,
                output: output.clone(),
                error: if ok {
                    None
                } else {
                    Some(if output.is_empty() {
                        "`agent update` failed".to_string()
                    } else {
                        output
                    })
                },
            })
        }
        Err(error) => Ok(AgentUpdateResult {
            ok: false,
            version: None,
            output: String::new(),
            error: Some(error),
        }),
    }
}

#[tauri::command]
pub async fn cursor_proxy_status(state: State<'_, CursorProxyState>) -> Result<ProxyStatus, String> {
    let (base, managed) = {
        let guard = state.managed.lock().await;
        (
            normalize_proxy_base(guard.base_url.clone()),
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

/// Windows: wrap with `cmd /c` so `.cmd`/`.bat` shims like npx resolve.
#[cfg(any(test, windows))]
fn should_wrap_windows_launcher(launcher: &str) -> bool {
    let name = launcher
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(launcher)
        .to_ascii_lowercase();
    name != "cmd" && name != "cmd.exe"
}

async fn spawn_proxy_process(
    port: u16,
    launcher: &Path,
    extra_args: &[String],
    workspace: &Path,
    config_dir: &Path,
) -> Result<Child, String> {
    let path_env = child_path_env().await;
    let agent_bin = find_agent_command().await.ok();
    let wrapper = ensure_qmai_agent_wrapper(config_dir, agent_bin.as_deref()).ok();

    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut parts = Vec::with_capacity(1 + extra_args.len());
        parts.push(shell_quote(&launcher.to_string_lossy()));
        for arg in extra_args {
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
        apply_qmai_proxy_env(
            &mut cmd,
            port,
            workspace,
            config_dir,
            agent_bin.as_deref(),
            wrapper.as_deref(),
        );
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
        let launcher_str = launcher.to_string_lossy();
        let mut cmd = if should_wrap_windows_launcher(&launcher_str) {
            let mut wrapped = Command::new("cmd");
            wrapped.arg("/c").arg(launcher.as_os_str());
            wrapped.args(extra_args);
            wrapped
        } else {
            let mut direct = Command::new(launcher);
            direct.args(extra_args);
            direct
        };
        suppress_windows_console(&mut cmd);
        apply_local_cli_environment(&mut cmd);
        if let Some(path_env) = path_env {
            cmd.env("PATH", path_env);
        }
        apply_cursor_auth_env(&mut cmd);
        apply_qmai_proxy_env(
            &mut cmd,
            port,
            workspace,
            config_dir,
            agent_bin.as_deref(),
            wrapper.as_deref(),
        );
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
    guard.launch_fingerprint = None;
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
    let (config_dir, workspace) = qmai_proxy_home_dirs()?;
    ensure_qmai_cli_config(&config_dir)?;
    ensure_qmai_workspace_trusted(&workspace, &config_dir).await;
    let (launcher, extra_args) = find_proxy_launcher().await?;
    let fingerprint = proxy_launch_fingerprint(&launcher, &extra_args, &workspace, &config_dir);

    {
        let mut guard = state.managed.lock().await;
        if let Some(child) = guard.child.as_mut() {
            match child.try_wait() {
                Ok(None) => {
                    let env_matches = guard.launch_fingerprint.as_deref() == Some(fingerprint.as_str());
                    if !force && env_matches {
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
                    guard.launch_fingerprint = None;
                }
            }
        }
    }

    stop_managed_child(&state).await;

    let port = allocate_proxy_port()?;
    let base = base_url_for_port(port);
    let child = spawn_proxy_process(port, &launcher, &extra_args, &workspace, &config_dir).await?;
    {
        let mut guard = state.managed.lock().await;
        guard.child = Some(child);
        guard.base_url = Some(base.clone());
        guard.launch_fingerprint = Some(fingerprint);
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

    #[test]
    fn trusts_qmai_workspace_with_official_flag() {
        let ws = PathBuf::from("/Users/omi/.cursor-api-proxy/qmai-workspace");
        assert_eq!(
            agent_trust_args(&ws),
            vec![
                "--trust".to_string(),
                "--workspace".to_string(),
                ws.to_string_lossy().into_owned(),
                "--mode".to_string(),
                "ask".to_string(),
                "--output-format".to_string(),
                "text".to_string(),
                "-p".to_string(),
                "ok".to_string(),
            ]
        );
        let cfg = PathBuf::from("/Users/omi/.cursor-api-proxy/qmai-agent");
        assert_eq!(
            qmai_workspace_trust_marker(&cfg),
            cfg.join(".qmai-workspace-trusted")
        );
    }

    #[test]
    fn proxy_fingerprint_enables_acp() {
        let fp = proxy_launch_fingerprint(
            Path::new("/usr/bin/npx"),
            &["--yes".to_string(), "cursor-api-proxy@latest".to_string()],
            Path::new("/tmp/ws"),
            Path::new("/tmp/cfg"),
        );
        assert!(fp.contains("acp=true"));
        assert!(fp.contains("agent_wrap=4"));
        assert!(fp.contains("strict=off"));
        assert!(!fp.contains("acp=false"));
    }

    #[test]
    fn default_npx_proxy_args_pin_latest() {
        assert_eq!(
            npx_proxy_args(),
            vec!["--yes".to_string(), "cursor-api-proxy@latest".to_string()]
        );
        assert!(!npx_missing_error().contains("npm i -g"));
    }

    #[test]
    fn wraps_npx_but_not_cmd_on_windows() {
        assert!(should_wrap_windows_launcher(r"C:\Program Files\nodejs\npx.cmd"));
        assert!(should_wrap_windows_launcher("/usr/local/bin/npx"));
        assert!(!should_wrap_windows_launcher(r"C:\Windows\System32\cmd.exe"));
        assert!(!should_wrap_windows_launcher("cmd"));
    }

    #[test]
    fn explicit_proxy_bin_must_be_a_file() {
        let missing = std::env::temp_dir().join(format!(
            "qmai-missing-proxy-bin-{}",
            std::process::id()
        ));
        let err = resolve_explicit_proxy_bin(&missing).unwrap_err();
        assert!(err.contains("CURSOR_API_PROXY_BIN"));

        let file = std::env::temp_dir().join(format!("qmai-proxy-bin-{}", std::process::id()));
        std::fs::write(&file, "x").unwrap();
        let (path, args) = resolve_explicit_proxy_bin(&file).unwrap();
        assert_eq!(path, file);
        assert!(args.is_empty());
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn writes_disable_auto_update_into_qmai_cli_config() {
        let dir = std::env::temp_dir().join(format!("qmai-agent-config-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = ensure_qmai_cli_config(&dir).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(json["disableAutoUpdate"], true);
        apply_qmai_acp_model(
            &dir,
            "grok-4.6",
            Some(true),
            Some("medium"),
            Some("cursor-grok-4.6-medium-fast"),
        )
        .unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(json["selectedModel"]["modelId"], "grok-4.6");
        assert_eq!(json["selectedModel"]["parameters"][0]["id"], "effort");
        assert_eq!(json["selectedModel"]["parameters"][0]["value"], "medium");
        assert_eq!(json["selectedModel"]["parameters"][1]["id"], "fast");
        assert_eq!(json["selectedModel"]["parameters"][1]["value"], "true");
        assert_eq!(json["model"]["modelId"], "grok-4.6");
        assert_eq!(json["disableAutoUpdate"], true);
        assert_eq!(
            std::fs::read_to_string(dir.join("qmai-acp-model")).unwrap(),
            "cursor-grok-4.6-medium-fast"
        );
        let wrapper = ensure_qmai_agent_wrapper(&dir, Some(Path::new("/usr/local/bin/agent"))).unwrap();
        assert!(wrapper.exists());
        let script = std::fs::read_to_string(dir.join("qmai-cursor-agent.cjs")).unwrap();
        assert!(script.contains("qmai-acp-model"));
        assert!(script.contains("resolveAcpArgvModel"));
        assert!(script.contains("QMAI_CURSOR_AGENT_REAL"));
        assert!(script.contains("/usr/local/bin/agent"));
        assert!(!script.contains("__QMAI_BAKED_AGENT__"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn formats_acp_model_pin() {
        assert_eq!(qmai_acp_model_value("grok-4.6", None, None), "grok-4.6");
        assert_eq!(
            qmai_acp_model_value("grok-4.6", Some(true), Some("high")),
            "grok-4.6[effort=high,fast=true]"
        );
        assert_eq!(
            qmai_acp_model_value("composer-2.5", Some(false), None),
            "composer-2.5[fast=false]"
        );
    }

    #[test]
    fn parses_agent_about_json() {
        let (version, status, latest) = parse_agent_about_json(
            r#"noise
{"cliVersion":"2026.08.31-4057e58","latestStatus":"update_available","latestVersion":"2026.09.01-aaaaaaa"}
tail"#,
        )
        .unwrap();
        assert_eq!(version, "2026.08.31-4057e58");
        assert_eq!(status.as_deref(), Some("update_available"));
        assert_eq!(latest.as_deref(), Some("2026.09.01-aaaaaaa"));
        assert!(parse_agent_about_json(r#"{"latestStatus":"up_to_date"}"#).is_none());
    }

    #[test]
    fn parses_session_new_available_models() {
        let raw = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "result": {
                "sessionId": "s",
                "models": {
                    "availableModels": [
                        { "modelId": "default[]", "name": "Auto" },
                        { "modelId": "gemini-3.7-flash[effort=high]", "name": "gemini-3.7-flash" },
                        { "modelId": "", "name": "skip" },
                        { "name": "no-id" }
                    ]
                }
            }
        });
        let models = parse_acp_available_models(&raw);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].model_id, "default[]");
        assert_eq!(models[0].name, "Auto");
        assert_eq!(models[1].model_id, "gemini-3.7-flash[effort=high]");
        assert_eq!(
            parse_acp_available_models(&serde_json::json!({ "models": { "availableModels": [] } }))
                .len(),
            0
        );
    }

    #[test]
    fn skips_authenticate_when_cli_config_has_auth() {
        let dir = std::env::temp_dir().join(format!(
            "qmai-acp-auth-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(
            dir.join("cli-config.json"),
            r#"{"authInfo":{"email":"user@example.com","authId":"github|x"}}"#,
        )
        .unwrap();
        assert!(cli_config_has_auth(&dir));
        std::fs::write(dir.join("cli-config.json"), r#"{"authInfo":{}}"#).unwrap();
        assert!(!cli_config_has_auth(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_acp_auth_errors() {
        assert!(is_acp_auth_error("Authentication required. Please run 'agent login'"));
        assert!(is_acp_auth_error("ACP Unauthorized"));
        assert!(!is_acp_auth_error("ACP session/new 未返回 availableModels"));
    }

    #[test]
    fn acp_models_disk_cache_roundtrip() {
        let dir = std::env::temp_dir().join(format!(
            "qmai-acp-cache-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        let models = vec![AcpCatalogModel {
            name: "gemini-3.7-flash".into(),
            model_id: "gemini-3.7-flash[effort=high]".into(),
        }];
        write_cached_acp_models(&dir, &models);
        assert_eq!(read_cached_acp_models(&dir), Some(models));
        let stale = AcpModelsCacheFile {
            fetched_at_ms: 1,
            models: vec![AcpCatalogModel {
                name: "old".into(),
                model_id: "old[]".into(),
            }],
        };
        std::fs::write(
            dir.join(QMAI_ACP_MODELS_CACHE),
            serde_json::to_string(&stale).unwrap(),
        )
        .unwrap();
        assert!(read_cached_acp_models(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
