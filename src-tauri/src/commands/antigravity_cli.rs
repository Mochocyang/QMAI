//! Antigravity CLI (`agy`) subprocess transport.
//!
//! QMAI uses `agy` as a text completion engine. Each request starts one
//! headless process, writes a single user event, and reads `text_delta`
//! until the process exits. The process cwd is an empty temporary directory
//! because workspace file access is auto-allowed. This module never passes
//! `--dangerously-skip-permissions`, `--continue`, or `--conversation`, and
//! it does not write `~/.gemini/antigravity-cli/settings.json`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::cli_resolver::{child_path_env, find_cli_command};
use super::claude_cli::CliEmitter;
use super::local_cli_config::apply_local_cli_environment;

const VERSION_TIMEOUT: Duration = Duration::from_secs(15);
const MODELS_TIMEOUT: Duration = Duration::from_secs(45);
const PRINT_TIMEOUT: &str = "30m";
const TEXT_ONLY_PREAMBLE: &str =
    "你是纯文本补全。禁止调用任何工具，禁止读写文件，禁止执行命令。只输出正文。";

static NEXT_WORKDIR_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub struct TauriAntigravityEmitter {
    app: AppHandle,
}

impl TauriAntigravityEmitter {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl CliEmitter for TauriAntigravityEmitter {
    fn emit_data(&self, stream_id: &str, data: String) {
        let topic = format!("antigravity-cli:{stream_id}");
        let _ = self.app.emit(&topic, data);
    }

    fn emit_done(&self, stream_id: &str, code: Option<i32>, stderr: String) {
        let done_topic = format!("antigravity-cli:{stream_id}:done");
        let _ = self.app.emit(
            &done_topic,
            serde_json::json!({
                "code": code,
                "stderr": stderr,
            }),
        );
    }
}

#[derive(Default)]
pub struct AntigravityCliState {
    children: Arc<Mutex<HashMap<String, Child>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectResult {
    installed: bool,
    version: Option<String>,
    path: Option<String>,
    model: Option<String>,
    models: Vec<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
pub struct AgyMessage {
    role: String,
    content: AgyContent,
}

#[derive(Clone, Deserialize)]
#[serde(untagged)]
enum AgyContent {
    Text(String),
    Blocks(Vec<AgyContentBlock>),
}

#[derive(Clone, Deserialize)]
#[serde(tag = "type")]
enum AgyContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image {
        #[serde(rename = "mediaType")]
        #[allow(dead_code)]
        media_type: String,
        #[serde(rename = "dataBase64")]
        #[allow(dead_code)]
        data_base64: String,
    },
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

async fn find_agy_command() -> Result<PathBuf, String> {
    find_cli_command("agy", &["agy.cmd", "agy.exe"]).await
}

async fn configure_agy_command(cmd: &mut Command) {
    suppress_windows_console(cmd);
    apply_local_cli_environment(cmd);
    if let Some(path_env) = child_path_env().await {
        cmd.env("PATH", path_env);
    }
}

pub(crate) fn antigravity_workdir(stream_id: &str) -> PathBuf {
    let safe: String = stream_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-')
        .collect();
    let generation = NEXT_WORKDIR_GENERATION.fetch_add(1, Ordering::SeqCst);
    std::env::temp_dir().join(format!(
        "qmai-agy-{}-{}-{}",
        std::process::id(),
        generation,
        safe
    ))
}

fn prepare_workdir(stream_id: &str) -> Result<PathBuf, String> {
    let dir = antigravity_workdir(stream_id);
    std::fs::create_dir_all(&dir).map_err(|err| format!("无法创建 Antigravity 临时目录：{err}"))?;
    Ok(dir)
}

fn remove_workdir(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
}

pub(crate) fn build_antigravity_cli_args(model: &str) -> Vec<String> {
    let mut args = vec![
        "--input-format".to_string(),
        "stream-json".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--print-timeout".to_string(),
        PRINT_TIMEOUT.to_string(),
    ];
    let model = model.trim();
    if !model.is_empty() {
        args.extend(["--model".to_string(), model.to_string()]);
    }
    args
}

fn message_text(content: &AgyContent) -> String {
    match content {
        AgyContent::Text(text) => text.clone(),
        AgyContent::Blocks(blocks) => blocks
            .iter()
            .filter_map(|block| match block {
                AgyContentBlock::Text { text } => Some(text.as_str()),
                AgyContentBlock::Image { .. } => None,
            })
            .collect::<Vec<_>>()
            .join(""),
    }
}

pub(crate) fn flatten_antigravity_prompt(messages: &[AgyMessage]) -> Result<String, String> {
    let mut parts = vec![TEXT_ONLY_PREAMBLE.to_string()];
    let mut any = false;
    for message in messages {
        let text = message_text(&message.content).trim().to_string();
        if text.is_empty() {
            continue;
        }
        any = true;
        let label = match message.role.as_str() {
            "system" => "系统",
            "assistant" => "助手",
            "tool" => "工具",
            _ => "用户",
        };
        parts.push(format!("【{label}】\n{text}"));
    }
    if !any {
        return Err("没有可发送给 Antigravity CLI 的文本".to_string());
    }
    Ok(parts.join("\n\n"))
}

fn user_event_line(prompt: &str) -> String {
    let event = serde_json::json!({
        "event": "user",
        "message": { "content": prompt },
    });
    format!("{event}\n")
}

pub(crate) fn parse_model_catalog(stdout: &str) -> Vec<String> {
    let mut models = Vec::new();
    for line in stdout.lines() {
        let Some((slug, _label)) = line.trim().split_once('\t') else {
            continue;
        };
        let slug = slug.trim();
        if slug.is_empty()
            || !slug
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        {
            continue;
        }
        if !models.iter().any(|existing: &String| existing == slug) {
            models.push(slug.to_string());
        }
    }
    models
}

fn first_version_line(stdout: &str, stderr: &str) -> Option<String> {
    for source in [stdout, stderr] {
        for line in source.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with("ERROR:") {
                continue;
            }
            if line.starts_with(['I', 'E', 'W']) && line.contains(".go:") {
                continue;
            }
            if line.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
                return Some(line.to_string());
            }
        }
    }
    None
}

fn missing_binary_result(error: String) -> DetectResult {
    DetectResult {
        installed: false,
        version: None,
        path: None,
        model: None,
        models: Vec::new(),
        error: Some(error),
    }
}

async fn run_agy(path: &Path, args: &[&str], workdir: &Path) -> Result<std::process::Output, String> {
    let mut cmd = Command::new(path);
    configure_agy_command(&mut cmd).await;
    cmd.args(args)
        .current_dir(workdir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    cmd.output()
        .await
        .map_err(|err| format!("无法启动 agy：{err}"))
}

pub async fn do_antigravity_cli_detect() -> Result<DetectResult, String> {
    let path = match find_agy_command().await {
        Ok(path) => path,
        Err(_) => {
            return Ok(missing_binary_result(
                "未检测到 agy。可执行 curl -fsSL https://antigravity.google/cli/install.sh | bash 安装后再检查。"
                    .to_string(),
            ));
        }
    };
    let path_str = path.to_string_lossy().to_string();

    let version_dir = prepare_workdir("version")?;
    let version_output = tokio::time::timeout(
        VERSION_TIMEOUT,
        run_agy(&path, &["--version"], &version_dir),
    )
    .await;
    remove_workdir(&version_dir);

    let version = match version_output {
        Ok(Ok(output)) => first_version_line(
            &String::from_utf8_lossy(&output.stdout),
            &String::from_utf8_lossy(&output.stderr),
        ),
        Ok(Err(error)) => {
            return Ok(DetectResult {
                installed: false,
                version: None,
                path: Some(path_str),
                model: None,
                models: Vec::new(),
                error: Some(error),
            });
        }
        Err(_) => {
            return Ok(DetectResult {
                installed: false,
                version: None,
                path: Some(path_str),
                model: None,
                models: Vec::new(),
                error: Some("agy --version 在 15 秒内没有返回".to_string()),
            });
        }
    };

    let Some(version) = version else {
        return Ok(DetectResult {
            installed: false,
            version: None,
            path: Some(path_str),
            model: None,
            models: Vec::new(),
            error: Some("agy --version 没有返回版本号".to_string()),
        });
    };

    let models_dir = prepare_workdir("models")?;
    let models_output = tokio::time::timeout(
        MODELS_TIMEOUT,
        run_agy(&path, &["models"], &models_dir),
    )
    .await;
    remove_workdir(&models_dir);

    let models = match models_output {
        Ok(Ok(output)) => parse_model_catalog(&String::from_utf8_lossy(&output.stdout)),
        Ok(Err(error)) => {
            return Ok(DetectResult {
                installed: true,
                version: Some(version),
                path: Some(path_str),
                model: None,
                models: Vec::new(),
                error: Some(error),
            });
        }
        Err(_) => {
            return Ok(DetectResult {
                installed: true,
                version: Some(version),
                path: Some(path_str),
                model: None,
                models: Vec::new(),
                error: Some("模型列表获取超时。请稍后重新检查。若尚未登录，请先在终端运行 agy。".to_string()),
            });
        }
    };

    if models.is_empty() {
        return Ok(DetectResult {
            installed: true,
            version: Some(version),
            path: Some(path_str),
            model: None,
            models,
            error: Some("未检测到可用模型。请先在终端运行 agy 完成登录，然后重新检查。".to_string()),
        });
    }

    Ok(DetectResult {
        installed: true,
        version: Some(version),
        path: Some(path_str),
        model: models.first().cloned(),
        models,
        error: None,
    })
}

#[tauri::command]
pub async fn antigravity_cli_detect() -> Result<DetectResult, String> {
    do_antigravity_cli_detect().await
}

pub async fn do_antigravity_cli_spawn<E: CliEmitter>(
    state: &AntigravityCliState,
    emitter: E,
    stream_id: String,
    model: String,
    messages: Vec<AgyMessage>,
) -> Result<(), String> {
    let prompt = flatten_antigravity_prompt(&messages)?;
    let line = user_event_line(&prompt);
    let agy = find_agy_command().await.map_err(|_| {
        "未找到 agy。请安装 Antigravity CLI，或在设置里改用其他模型源。".to_string()
    })?;
    let workdir = prepare_workdir(&stream_id)?;

    let mut cmd = Command::new(&agy);
    configure_agy_command(&mut cmd).await;
    cmd.args(build_antigravity_cli_args(&model))
        .current_dir(&workdir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(err) => {
            remove_workdir(&workdir);
            return Err(format!("无法启动 agy：{err}"));
        }
    };

    let mut stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            remove_workdir(&workdir);
            return Err("agy 没有 stdin".to_string());
        }
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            remove_workdir(&workdir);
            return Err("agy 没有 stdout".to_string());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            remove_workdir(&workdir);
            return Err("agy 没有 stderr".to_string());
        }
    };

    if let Err(err) = stdin.write_all(line.as_bytes()).await {
        remove_workdir(&workdir);
        return Err(format!("写入 agy stdin 失败：{err}"));
    }
    if let Err(err) = stdin.flush().await {
        remove_workdir(&workdir);
        return Err(format!("刷新 agy stdin 失败：{err}"));
    }
    drop(stdin);

    state.children.lock().await.insert(stream_id.clone(), child);

    let children = Arc::clone(&state.children);
    let stream_id_task = stream_id.clone();
    let emitter_task = emitter.clone();

    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();
        let stderr_task = tokio::spawn(async move {
            let mut collected = String::new();
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                eprintln!("[antigravity-cli stderr] {line}");
                collected.push_str(&line);
                collected.push('\n');
            }
            collected
        });

        loop {
            match reader.next_line().await {
                Ok(Some(line)) => emitter_task.emit_data(&stream_id_task, line),
                Ok(None) => break,
                Err(err) => {
                    eprintln!("[antigravity-cli stdout] read error: {err}");
                    break;
                }
            }
        }

        let child_opt = children.lock().await.remove(&stream_id_task);
        let exit_code = if let Some(mut child) = child_opt {
            match child.wait().await {
                Ok(status) => status.code(),
                Err(_) => None,
            }
        } else {
            None
        };
        let stderr_text = stderr_task.await.unwrap_or_default();
        remove_workdir(&workdir);
        emitter_task.emit_done(&stream_id_task, exit_code, stderr_text);
    });

    Ok(())
}

#[tauri::command]
pub async fn antigravity_cli_spawn(
    app: AppHandle,
    state: State<'_, AntigravityCliState>,
    stream_id: String,
    model: String,
    messages: Vec<AgyMessage>,
) -> Result<(), String> {
    let emitter = TauriAntigravityEmitter::new(app);
    do_antigravity_cli_spawn(&state, emitter, stream_id, model, messages).await
}

pub async fn do_antigravity_cli_kill(
    state: &AntigravityCliState,
    stream_id: &str,
) -> Result<(), String> {
    if let Some(mut child) = state.children.lock().await.remove(stream_id) {
        let _ = child.start_kill();
    }
    Ok(())
}

#[tauri::command]
pub async fn antigravity_cli_kill(
    state: State<'_, AntigravityCliState>,
    stream_id: String,
) -> Result<(), String> {
    do_antigravity_cli_kill(&state, &stream_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args_have_flag(args: &[String], flag: &str) -> bool {
        args.iter().any(|arg| arg == flag)
    }

    #[test]
    fn args_are_text_only_and_skip_an_empty_model() {
        let args = build_antigravity_cli_args("  ");
        assert!(args_have_flag(&args, "--input-format"));
        assert!(args_have_flag(&args, "--output-format"));
        assert!(args.windows(2).any(|pair| pair[0] == "--input-format" && pair[1] == "stream-json"));
        assert!(args.windows(2).any(|pair| pair[0] == "--output-format" && pair[1] == "stream-json"));
        assert!(args.windows(2).any(|pair| pair[0] == "--print-timeout" && pair[1] == "30m"));
        assert!(!args_have_flag(&args, "--model"));
        assert!(!args_have_flag(&args, "--dangerously-skip-permissions"));
        assert!(!args_have_flag(&args, "--continue"));
        assert!(!args_have_flag(&args, "--conversation"));
        assert!(!args_have_flag(&args, "-c"));
        assert!(!args_have_flag(&args, "-p"));
    }

    #[test]
    fn args_pin_a_trimmed_model() {
        let args = build_antigravity_cli_args(" gemini-3.8-flash-high ");
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "--model" && pair[1] == "gemini-3.8-flash-high"));
    }

    #[test]
    fn workdir_stays_under_the_temp_directory() {
        let dir = antigravity_workdir("stream-1");
        let temp = std::env::temp_dir();
        assert!(dir.starts_with(&temp));
        assert_ne!(dir, std::env::current_dir().unwrap());
        assert!(dir
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("qmai-agy-")));
    }

    #[test]
    fn model_catalog_reads_stdout_slugs_and_ignores_logs() {
        let stdout = "\
You are not logged into Antigravity.\n\
gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n\
gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\n\
claude-sonnet-5-5-high\tClaude Sonnet 5.5 (High)\n\
gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n";
        assert_eq!(
            parse_model_catalog(stdout),
            vec![
                "gemini-3.8-flash-high",
                "gemini-3.8-flash-medium",
                "claude-sonnet-5-5-high",
            ]
        );
    }

    #[test]
    fn prompt_folds_history_into_one_text_and_drops_images() {
        let messages: Vec<AgyMessage> = serde_json::from_value(serde_json::json!([
            { "role": "system", "content": "保持第三人称" },
            { "role": "user", "content": [
                { "type": "text", "text": "写一段" },
                { "type": "image", "mediaType": "image/png", "dataBase64": "abc" }
            ]},
            { "role": "assistant", "content": "第一段" }
        ]))
        .expect("messages");
        let prompt = flatten_antigravity_prompt(&messages).expect("prompt");
        assert!(prompt.starts_with(TEXT_ONLY_PREAMBLE));
        assert!(prompt.contains("【系统】\n保持第三人称"));
        assert!(prompt.contains("【用户】\n写一段"));
        assert!(prompt.contains("【助手】\n第一段"));
        assert!(!prompt.contains("abc"));
    }
}
