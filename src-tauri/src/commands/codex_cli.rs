//! Codex app-server transport.
//!
//! QMAI owns the agent loop, permissions, and tools.  Codex is hosted as a
//! long-lived JSON-RPC app-server and receives only QMAI dynamic tools.  The
//! native Codex workspace is an empty temporary directory and the sandbox is
//! always read-only.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;

use super::cli_resolver::{child_path_env, find_cli_command};
use super::local_cli_config::{
    apply_local_cli_environment, read_codex_local_config, resolve_home_dir,
};

const APP_SERVER_EVENT: &str = "codex-app-server:event";
const APP_SERVER_EXIT_EVENT: &str = "codex-app-server:exit";
const DETECT_TIMEOUT: Duration = Duration::from_secs(8);
static NEXT_PROBE_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct AppServerProcess {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    generation: u64,
    cwd: Option<PathBuf>,
    root: Option<PathBuf>,
}

#[derive(Default)]
pub struct CodexAppServerState {
    process: Arc<Mutex<AppServerProcess>>,
    next_generation: AtomicU64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerStartResult {
    generation: u64,
    cwd: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectResult {
    installed: bool,
    version: Option<String>,
    path: Option<String>,
    model: Option<String>,
    app_server_ready: bool,
    dynamic_tools_ready: bool,
    models: Vec<String>,
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

async fn find_codex_command() -> Result<PathBuf, String> {
    find_cli_command("codex", &["codex.cmd", "codex.exe"]).await
}

async fn configure_codex_command(cmd: &mut Command) {
    suppress_windows_console(cmd);
    apply_local_cli_environment(cmd);
    if let Some(path_env) = child_path_env().await {
        cmd.env("PATH", path_env);
    }
}

fn controlled_temp_dir(label: &str, generation: u64) -> PathBuf {
    std::env::temp_dir().join(format!(
        "qmai-codex-{label}-{}-{generation}",
        std::process::id()
    ))
}

fn next_probe_generation() -> u64 {
    NEXT_PROBE_GENERATION.fetch_add(1, Ordering::SeqCst)
}

const CODEX_CONFIG_PASSTHROUGH_KEYS: &[&str] = &[
    "model_provider",
    "model_providers",
    "openai_base_url",
    "chatgpt_base_url",
    "cli_auth_credentials_store",
    "forced_login_method",
    "forced_chatgpt_workspace_id",
];

fn isolated_codex_config(home_dir: Option<&Path>) -> toml::Table {
    let mut isolated = toml::Table::new();
    let source = home_dir
        .and_then(|home| std::fs::read_to_string(home.join(".codex").join("config.toml")).ok())
        .and_then(|content| content.parse::<toml::Value>().ok())
        .and_then(|value| value.as_table().cloned())
        .unwrap_or_default();
    for key in CODEX_CONFIG_PASSTHROUGH_KEYS {
        if let Some(value) = source.get(*key) {
            isolated.insert((*key).to_string(), value.clone());
        }
    }

    let features = [
        "apps",
        "browser_use",
        "browser_use_external",
        "browser_use_full_cdp_access",
        "computer_use",
        "goals",
        "hooks",
        "image_generation",
        "in_app_browser",
        "memories",
        "multi_agent",
        "multi_agent_v2",
        "plugins",
        "remote_plugin",
        "shell_snapshot",
        "shell_tool",
        "skill_mcp_dependency_install",
        "skill_search",
    ]
    .into_iter()
    .map(|key| (key.to_string(), toml::Value::Boolean(false)))
    .collect::<toml::Table>();
    isolated.insert("features".to_string(), toml::Value::Table(features));
    isolated.insert(
        "web_search".to_string(),
        toml::Value::String("disabled".to_string()),
    );
    isolated.insert("project_doc_max_bytes".to_string(), toml::Value::Integer(0));
    isolated.insert(
        "project_doc_fallback_filenames".to_string(),
        toml::Value::Array(Vec::new()),
    );
    isolated.insert(
        "project_root_markers".to_string(),
        toml::Value::Array(Vec::new()),
    );
    isolated.insert(
        "tools".to_string(),
        toml::Value::Table(
            [
                ("view_image".to_string(), toml::Value::Boolean(false)),
                ("web_search".to_string(), toml::Value::Boolean(false)),
            ]
            .into_iter()
            .collect(),
        ),
    );
    isolated
}

fn serialize_isolated_codex_config(home_dir: Option<&Path>) -> Result<String, String> {
    toml::to_string(&isolated_codex_config(home_dir))
        .map_err(|error| format!("无法序列化 Codex 隔离配置：{error}"))
}

fn prepare_isolated_runtime(
    label: &str,
    generation: u64,
) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let root = controlled_temp_dir(label, generation);
    if root.exists() {
        std::fs::remove_dir_all(&root)
            .map_err(|error| format!("无法清理 Codex 隔离目录：{error}"))?;
    }
    let cwd = root.join("workspace");
    let codex_home = root.join("codex-home");
    std::fs::create_dir_all(&cwd)
        .and_then(|_| std::fs::create_dir_all(&codex_home))
        .map_err(|error| format!("无法创建 Codex 隔离目录：{error}"))?;

    let user_home = resolve_home_dir();
    if let Some(auth_path) = user_home
        .as_deref()
        .map(|home| home.join(".codex").join("auth.json"))
        .filter(|path| path.is_file())
    {
        std::fs::copy(auth_path, codex_home.join("auth.json"))
            .map_err(|error| format!("无法复制 Codex 登录凭据：{error}"))?;
    }

    let config = serialize_isolated_codex_config(user_home.as_deref())?;
    std::fs::write(codex_home.join("config.toml"), config)
        .map_err(|error| format!("无法写入 Codex 隔离配置：{error}"))?;
    Ok((root, cwd, codex_home))
}

async fn spawn_app_server_process(
    codex: &Path,
    cwd: &Path,
    codex_home: &Path,
) -> Result<
    (
        Child,
        ChildStdin,
        tokio::process::ChildStdout,
        tokio::process::ChildStderr,
    ),
    String,
> {
    let mut cmd = Command::new(codex);
    configure_codex_command(&mut cmd).await;
    cmd.args(["app-server", "--stdio"])
        .current_dir(cwd)
        .env("CODEX_HOME", codex_home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd
        .spawn()
        .map_err(|error| format!("无法启动 Codex app-server：{error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or("无法打开 Codex app-server stdin")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("无法打开 Codex app-server stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("无法打开 Codex app-server stderr")?;
    Ok((child, stdin, stdout, stderr))
}

fn initialize_request(id: u64) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "initialize",
        "params": {
            "clientInfo": { "name": "QMaiWrite", "title": "QMaiWrite", "version": env!("CARGO_PKG_VERSION") },
            "capabilities": { "experimentalApi": true, "requestAttestation": false }
        }
    })
}

fn probe_thread_request(id: u64, cwd: &Path) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "thread/start",
        "params": {
            "cwd": cwd.to_string_lossy(),
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "ephemeral": true,
            "baseInstructions": "QMAI capability probe. Do not use native tools.",
            "developerInstructions": "Use only client-provided dynamic tools.",
            "dynamicTools": [{
                "type": "function",
                "name": "qmai_capability_probe",
                "description": "QMAI capability probe; never call it.",
                "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
            }],
            "config": restricted_feature_config()
        }
    })
}

fn restricted_feature_config() -> Value {
    json!({
        "features": {
            "apps": false,
            "browser_use": false,
            "browser_use_external": false,
            "browser_use_full_cdp_access": false,
            "computer_use": false,
            "image_generation": false,
            "in_app_browser": false,
            "multi_agent": false,
            "multi_agent_v2": false,
            "plugins": false,
            "remote_plugin": false,
            "shell_snapshot": false,
            "shell_tool": false,
            "skill_mcp_dependency_install": false,
            "skill_search": false
        },
        "web_search": "disabled",
        "project_doc_max_bytes": 0,
        "project_doc_fallback_filenames": [],
        "project_root_markers": [],
        "tools": { "view_image": false, "web_search": false }
    })
}

async fn write_json_line(stdin: &mut ChildStdin, value: &Value) -> Result<(), String> {
    let mut encoded = serde_json::to_vec(value)
        .map_err(|error| format!("Codex app-server 请求序列化失败：{error}"))?;
    encoded.push(b'\n');
    stdin
        .write_all(&encoded)
        .await
        .map_err(|error| format!("Codex app-server 写入失败：{error}"))?;
    stdin
        .flush()
        .await
        .map_err(|error| format!("Codex app-server 刷新失败：{error}"))
}

async fn read_response_for_id(
    reader: &mut BufReader<tokio::process::ChildStdout>,
    expected_id: u64,
) -> Result<Value, String> {
    let read = async {
        loop {
            let mut line = String::new();
            let count = reader
                .read_line(&mut line)
                .await
                .map_err(|error| format!("Codex app-server 读取失败：{error}"))?;
            if count == 0 {
                return Err("Codex app-server 在握手期间退出".to_string());
            }
            let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
                continue;
            };
            if value.get("id").and_then(Value::as_u64) == Some(expected_id) {
                return Ok(value);
            }
        }
    };
    tokio::time::timeout(DETECT_TIMEOUT, read)
        .await
        .map_err(|_| "Codex app-server 握手超时".to_string())?
}

fn response_error(value: &Value) -> Option<String> {
    value
        .get("error")
        .and_then(|error| error.get("message").or(Some(error)))
        .and_then(|message| message.as_str().map(ToOwned::to_owned))
}

fn models_from_response(value: &Value) -> Vec<String> {
    let mut models = value
        .pointer("/result/data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("model").and_then(Value::as_str))
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    models
}

fn stderr_summary(stderr: &str) -> Option<String> {
    let lines = stderr
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(8)
        .map(|line| {
            let lower = line.to_ascii_lowercase();
            if [
                "authorization",
                "bearer",
                "api_key",
                "api-key",
                "apikey",
                "token",
                "sk-",
            ]
            .iter()
            .any(|secret| lower.contains(secret))
            {
                "[敏感内容已隐藏]".to_string()
            } else {
                line.chars().take(500).collect::<String>()
            }
        })
        .collect::<Vec<_>>();
    (!lines.is_empty()).then(|| lines.join(" | "))
}

async fn probe_app_server(codex: &Path) -> Result<Vec<String>, (bool, String)> {
    let probe_generation = next_probe_generation();
    let (root, cwd, codex_home) =
        prepare_isolated_runtime("probe", probe_generation).map_err(|error| (false, error))?;
    let (mut child, mut stdin, stdout, stderr) =
        match spawn_app_server_process(codex, &cwd, &codex_home).await {
            Ok(spawned) => spawned,
            Err(error) => {
                let _ = std::fs::remove_dir_all(&root);
                return Err((false, error));
            }
        };
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut output = String::new();
        let _ = reader.read_to_string(&mut output).await;
        output
    });
    let mut reader = BufReader::new(stdout);
    let mut app_server_ready = false;
    let result = async {
        write_json_line(&mut stdin, &initialize_request(1)).await?;
        let initialized = read_response_for_id(&mut reader, 1).await?;
        if let Some(error) = response_error(&initialized) {
            return Err(format!("Codex app-server initialize 失败：{error}"));
        }
        app_server_ready = true;
        write_json_line(
            &mut stdin,
            &json!({ "jsonrpc": "2.0", "method": "initialized" }),
        )
        .await?;

        write_json_line(
            &mut stdin,
            &json!({
                "jsonrpc": "2.0", "id": 2, "method": "model/list",
                "params": { "limit": 200, "includeHidden": false }
            }),
        )
        .await?;
        let model_response = read_response_for_id(&mut reader, 2).await?;
        if let Some(error) = response_error(&model_response) {
            return Err(format!("Codex app-server model/list 失败：{error}"));
        }

        write_json_line(&mut stdin, &probe_thread_request(3, &cwd)).await?;
        let thread_response = read_response_for_id(&mut reader, 3).await?;
        if let Some(error) = response_error(&thread_response) {
            return Err(format!("Codex app-server 不支持 dynamicTools：{error}"));
        }
        let instruction_sources = thread_response
            .pointer("/result/instructionSources")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default();
        if !instruction_sources.is_empty() {
            return Err("Codex app-server 仍加载了本机或项目规则".to_string());
        }
        Ok(models_from_response(&model_response))
    }
    .await;
    let _ = child.kill().await;
    let _ = child.wait().await;
    let stderr = tokio::time::timeout(Duration::from_secs(1), stderr_task)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default();
    let _ = std::fs::remove_dir_all(&root);
    result.map_err(|error| {
        let detail = stderr_summary(&stderr)
            .map(|summary| format!("；Codex stderr：{summary}"))
            .unwrap_or_default();
        (app_server_ready, format!("{error}{detail}"))
    })
}

pub async fn do_codex_cli_detect() -> Result<DetectResult, String> {
    let configured_model = read_codex_local_config(resolve_home_dir().as_deref()).model;
    let codex = match find_codex_command().await {
        Ok(path) => path,
        Err(error) => {
            return Ok(DetectResult {
                installed: false,
                version: None,
                path: None,
                model: configured_model,
                app_server_ready: false,
                dynamic_tools_ready: false,
                models: Vec::new(),
                error: Some(error),
            });
        }
    };
    let path = codex.to_string_lossy().to_string();
    let mut version_cmd = Command::new(&codex);
    configure_codex_command(&mut version_cmd).await;
    let version = match tokio::time::timeout(
        Duration::from_secs(3),
        version_cmd.arg("--version").output(),
    )
    .await
    {
        Ok(Ok(output)) if output.status.success() => {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
        }
        Ok(Ok(output)) => {
            let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Ok(DetectResult {
                installed: false,
                version: None,
                path: Some(path),
                model: configured_model,
                app_server_ready: false,
                dynamic_tools_ready: false,
                models: Vec::new(),
                error: Some(if error.is_empty() {
                    format!("`codex --version` exited with {}", output.status)
                } else {
                    error
                }),
            });
        }
        Ok(Err(error)) => {
            return Ok(DetectResult {
                installed: false,
                version: None,
                path: Some(path),
                model: configured_model,
                app_server_ready: false,
                dynamic_tools_ready: false,
                models: Vec::new(),
                error: Some(format!("Failed to spawn `codex`: {error}")),
            });
        }
        Err(_) => {
            return Ok(DetectResult {
                installed: false,
                version: None,
                path: Some(path),
                model: configured_model,
                app_server_ready: false,
                dynamic_tools_ready: false,
                models: Vec::new(),
                error: Some("`codex --version` timed out after 3s".to_string()),
            });
        }
    };

    match probe_app_server(&codex).await {
        Ok(models) => Ok(DetectResult {
            installed: true,
            version,
            path: Some(path),
            model: configured_model,
            app_server_ready: true,
            dynamic_tools_ready: true,
            models,
            error: None,
        }),
        Err((app_server_ready, error)) => Ok(DetectResult {
            installed: true,
            version,
            path: Some(path),
            model: configured_model,
            app_server_ready,
            dynamic_tools_ready: false,
            models: Vec::new(),
            error: Some(format!(
                "当前 Codex CLI 不支持 QMAI 主 Agent，请升级 Codex CLI。{error}"
            )),
        }),
    }
}

#[tauri::command]
pub async fn codex_cli_detect() -> Result<DetectResult, String> {
    do_codex_cli_detect().await
}

#[tauri::command]
pub async fn codex_app_server_start(
    app: AppHandle,
    state: State<'_, CodexAppServerState>,
) -> Result<AppServerStartResult, String> {
    let mut process = state.process.lock().await;
    if let Some(child) = process.child.as_mut() {
        match child.try_wait() {
            Ok(None) => {
                let cwd = process
                    .cwd
                    .as_ref()
                    .ok_or("Codex app-server 隔离目录丢失")?;
                return Ok(AppServerStartResult {
                    generation: process.generation,
                    cwd: cwd.to_string_lossy().to_string(),
                });
            }
            Ok(Some(_)) | Err(_) => {
                process.child = None;
                process.stdin = None;
                if let Some(root) = process.root.take() {
                    let _ = std::fs::remove_dir_all(root);
                }
                process.cwd = None;
            }
        }
    }

    let generation = state.next_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let codex = find_codex_command().await?;
    let (root, cwd, codex_home) = prepare_isolated_runtime("runtime", generation)?;
    let (child, stdin, stdout, stderr) =
        match spawn_app_server_process(&codex, &cwd, &codex_home).await {
            Ok(spawned) => spawned,
            Err(error) => {
                let _ = std::fs::remove_dir_all(&root);
                return Err(error);
            }
        };
    process.child = Some(child);
    process.stdin = Some(stdin);
    process.generation = generation;
    process.cwd = Some(cwd.clone());
    process.root = Some(root);
    drop(process);

    let event_app = app.clone();
    let process_state = state.process.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = event_app.emit(
                APP_SERVER_EVENT,
                json!({ "generation": generation, "line": line }),
            );
        }
        let (mut child, root) = {
            let mut process = process_state.lock().await;
            if process.generation != generation {
                (None, None)
            } else {
                process.stdin = None;
                process.cwd = None;
                (process.child.take(), process.root.take())
            }
        };
        if let Some(child) = child.as_mut() {
            let _ = child.kill().await;
        }
        if let Some(root) = root {
            let _ = std::fs::remove_dir_all(root);
        }
        let _ = event_app.emit(APP_SERVER_EXIT_EVENT, json!({ "generation": generation }));
    });
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            eprintln!("[codex-app-server stderr] {line}");
        }
    });

    Ok(AppServerStartResult {
        generation,
        cwd: cwd.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn codex_app_server_write(
    state: State<'_, CodexAppServerState>,
    generation: u64,
    data: String,
) -> Result<(), String> {
    let mut process = state.process.lock().await;
    if process.generation != generation {
        return Err("Codex app-server 已重启，本次请求不能重放".to_string());
    }
    let stdin = process.stdin.as_mut().ok_or("Codex app-server 未运行")?;
    stdin
        .write_all(data.as_bytes())
        .await
        .map_err(|error| format!("Codex app-server 写入失败：{error}"))?;
    if !data.ends_with('\n') {
        stdin
            .write_all(b"\n")
            .await
            .map_err(|error| format!("Codex app-server 写入失败：{error}"))?;
    }
    stdin
        .flush()
        .await
        .map_err(|error| format!("Codex app-server 刷新失败：{error}"))
}

#[tauri::command]
pub async fn codex_app_server_stop(state: State<'_, CodexAppServerState>) -> Result<(), String> {
    let (mut child, root) = {
        let mut process = state.process.lock().await;
        process.stdin = None;
        process.cwd = None;
        (process.child.take(), process.root.take())
    };
    if let Some(child) = child.as_mut() {
        let _ = child.kill().await;
    }
    if let Some(root) = root {
        let _ = std::fs::remove_dir_all(root);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_uses_dynamic_tools_and_read_only_sandbox() {
        let cwd = Path::new("/tmp/qmai-probe");
        let request = probe_thread_request(3, cwd);
        assert_eq!(
            request.pointer("/params/sandbox").and_then(Value::as_str),
            Some("read-only")
        );
        assert_eq!(
            request
                .pointer("/params/approvalPolicy")
                .and_then(Value::as_str),
            Some("never")
        );
        assert_eq!(
            request
                .pointer("/params/ephemeral")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            request
                .pointer("/params/dynamicTools/0/name")
                .and_then(Value::as_str),
            Some("qmai_capability_probe")
        );
    }

    #[test]
    fn model_response_is_sorted_and_deduplicated() {
        let response = json!({ "result": { "data": [
            { "model": "gpt-z" }, { "model": "gpt-a" }, { "model": "gpt-z" }
        ] } });
        assert_eq!(models_from_response(&response), vec!["gpt-a", "gpt-z"]);
    }

    #[test]
    fn concurrent_probes_receive_distinct_temp_directories() {
        let first = controlled_temp_dir("probe", next_probe_generation());
        let second = controlled_temp_dir("probe", next_probe_generation());
        assert_ne!(first, second);
    }

    #[test]
    fn stderr_summary_redacts_likely_credentials() {
        let summary = stderr_summary(
            "configuration error\nAuthorization: Bearer secret\napi_key=secret\nretry failed",
        )
        .unwrap();
        assert!(summary.contains("configuration error"));
        assert!(summary.contains("[敏感内容已隐藏]"));
        assert!(!summary.contains("secret"));
    }

    #[test]
    fn restricted_config_disables_native_extensions() {
        let config = restricted_feature_config();
        assert_eq!(
            config.pointer("/features/plugins").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            config.get("web_search").and_then(Value::as_str),
            Some("disabled")
        );
        assert_eq!(
            config
                .pointer("/features/multi_agent")
                .and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            config
                .pointer("/features/browser_use")
                .and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn isolated_config_keeps_only_login_and_model_provider_settings() {
        let dir = controlled_temp_dir("config-test", 42);
        let source = dir.join(".codex");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(
            source.join("config.toml"),
            r#"model = "do-not-copy"
model_provider = "proxy"
developer_instructions = "do-not-copy"
[model_providers.proxy]
name = "Proxy"
base_url = "https://example.test/v1"
[mcp_servers.local]
command = "danger"
"#,
        )
        .unwrap();

        let config = isolated_codex_config(Some(&dir));
        assert_eq!(
            config.get("model_provider").and_then(toml::Value::as_str),
            Some("proxy")
        );
        assert!(config.contains_key("model_providers"));
        assert!(!config.contains_key("model"));
        assert!(!config.contains_key("developer_instructions"));
        assert!(!config.contains_key("mcp_servers"));
        assert_eq!(
            config
                .get("features")
                .and_then(toml::Value::as_table)
                .and_then(|features| features.get("hooks"))
                .and_then(toml::Value::as_bool),
            Some(false)
        );
        assert_eq!(
            config.get("web_search").and_then(toml::Value::as_str),
            Some("disabled")
        );

        let serialized = serialize_isolated_codex_config(Some(&dir)).unwrap();
        let reparsed = serialized.parse::<toml::Value>().unwrap();
        assert_eq!(
            reparsed.get("model_provider").and_then(toml::Value::as_str),
            Some("proxy")
        );
        assert_eq!(
            reparsed
                .get("features")
                .and_then(toml::Value::as_table)
                .and_then(|features| features.get("shell_tool"))
                .and_then(toml::Value::as_bool),
            Some(false)
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
