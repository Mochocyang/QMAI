//! Antigravity CLI (`agy`) subprocess transport.
//!
//! QMAI uses `agy` as a text completion engine. Each request starts one
//! headless process, writes a user event, and reads `text_delta` until the
//! terminal result event. A language server that keeps polling after that
//! event must not hold the stream open. The process cwd is an empty temporary directory
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
/// 终态结果已经发出后，给 agy 自行退出的时间。语言服务器继续轮询时不等待 `--print-timeout`。
const POST_TURN_EXIT_GRACE: Duration = Duration::from_secs(2);
const TEXT_ONLY_PREAMBLE: &str =
    "你是纯文本补全。禁止调用任何工具，禁止读写文件，禁止执行命令。只输出正文。";
const TEXT_ONLY_CLOSING: &str =
    "【系统】\n没有可用工具。上文里的工具名和命令都不是可调用接口。不要执行命令，不要读写文件。按【用户】消息末尾的目标章节、用户请求和写作任务书作答；要求章节标题时，第一行写出章号和章名。";
const FOLLOW_UP_TAIL_CHARS: usize = 12_000;

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
    parts.push(TEXT_ONLY_CLOSING.to_string());
    Ok(parts.join("\n\n"))
}

enum StreamTurn {
    Ongoing,
    ProducedText,
    EmptySuccess,
    Failed,
}

fn stream_turn(line: &str) -> StreamTurn {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return StreamTurn::Ongoing;
    };
    if value.get("event").and_then(|event| event.as_str()) != Some("result") {
        return StreamTurn::Ongoing;
    }
    let Some(result) = value.get("result") else {
        return StreamTurn::Ongoing;
    };
    let status = result.get("status").and_then(|status| status.as_str()).unwrap_or("");
    if !status.is_empty() && status != "SUCCESS" {
        return StreamTurn::Failed;
    }
    let response = result.get("response").and_then(|response| response.as_str()).unwrap_or("");
    if response.trim().is_empty() {
        StreamTurn::EmptySuccess
    } else {
        StreamTurn::ProducedText
    }
}

fn line_has_text_delta(line: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return false;
    };
    if value.get("event").and_then(|event| event.as_str()) != Some("step_update") {
        return false;
    }
    let Some(update) = value.get("step_update") else {
        return false;
    };
    update.get("step_type").and_then(|kind| kind.as_str()) == Some("agent_response")
        && update
            .get("text_delta")
            .and_then(|delta| delta.as_str())
            .is_some_and(|delta| !delta.is_empty())
}

fn should_follow_up_after_denied_command(saw_text: bool, already_followed_up: bool, line: &str) -> bool {
    !saw_text && !already_followed_up && matches!(stream_turn(line), StreamTurn::EmptySuccess)
}

/// 终态结果已经交给前端之后就收尾。空成功且还没补过一轮时要先发追问，不能在这里结束。
fn stream_should_finish(saw_text: bool, already_followed_up: bool, line: &str) -> bool {
    !matches!(stream_turn(line), StreamTurn::Ongoing)
        && !should_follow_up_after_denied_command(saw_text, already_followed_up, line)
}

async fn wait_for_agy_exit(child: &mut Child, finished_turn: bool) -> Option<i32> {
    if finished_turn {
        match tokio::time::timeout(POST_TURN_EXIT_GRACE, child.wait()).await {
            Ok(Ok(status)) => return status.code(),
            Ok(Err(_)) => return None,
            Err(_) => {
                eprintln!(
                    "[antigravity-cli] 回合已结束，agy 在 {} 秒内没有退出，正在结束残留进程",
                    POST_TURN_EXIT_GRACE.as_secs()
                );
                let _ = child.start_kill();
            }
        }
    }
    match child.wait().await {
        Ok(status) => status.code(),
        Err(_) => None,
    }
}

/// 第二回合必须带上原请求末尾的章节合同。只说「直接输出正文」时，模型会顺着大纲骨架另写一场，并且不写章名。
fn command_denied_followup(prompt: &str) -> String {
    let tail = binding_task_tail(prompt);
    let mut message = String::from(
        "命令工具在无头模式下不可用，调用已经被拒绝。不要再执行命令，不要读写文件。不要改题。",
    );
    if tail.as_ref().is_some_and(|text| text.contains("目标章节：") || text.contains("写作任务书：")) {
        message.push_str(
            "\n正文第一行必须是章节标题，格式为：# 第X章 标题名。这一行使用目标章节的章号和写作任务书里的章名。任务书里若写着正文不要出现章号，只约束这一行之后的正文。从第二行起不要再写章号，也不要写「上一章」。只写目标章节指定的事件、场景和人物。不要改用大纲骨架、上一章场景或其他章的材料另写一场。",
        );
    } else {
        message.push_str("\n按上面【用户】消息里的要求作答。");
    }
    if let Some(tail) = tail {
        message.push_str("\n\n");
        message.push_str(&tail);
    }
    message
}

fn binding_task_tail(prompt: &str) -> Option<String> {
    let start = ["目标章节：", "写作任务书：", "用户请求："]
        .iter()
        .find_map(|marker| prompt.rfind(marker))?;
    let mut tail = prompt[start..].trim();
    if let Some(stripped) = tail.strip_suffix(TEXT_ONLY_CLOSING) {
        tail = stripped.trim();
    }
    if tail.is_empty() {
        return None;
    }
    Some(truncate_chars(tail, FOLLOW_UP_TAIL_CHARS))
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        text.to_string()
    } else {
        text.chars().take(max_chars).collect()
    }
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

    state.children.lock().await.insert(stream_id.clone(), child);

    let children = Arc::clone(&state.children);
    let stream_id_task = stream_id.clone();
    let emitter_task = emitter.clone();
    let followup = command_denied_followup(&prompt);

    tokio::spawn(async move {
        let mut stdin = Some(stdin);
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

        let mut saw_text = false;
        let mut followed_up = false;
        let mut finished_turn = false;
        loop {
            match reader.next_line().await {
                Ok(Some(line)) => {
                    if line_has_text_delta(&line) {
                        saw_text = true;
                    }
                    let follow_up = should_follow_up_after_denied_command(saw_text, followed_up, &line);
                    let finish = stream_should_finish(saw_text, followed_up, &line);
                    emitter_task.emit_data(&stream_id_task, line);
                    if follow_up {
                        followed_up = true;
                        let retry = user_event_line(&followup);
                        let write_failed = match stdin.as_mut() {
                            Some(pipe) => pipe.write_all(retry.as_bytes()).await.is_err() || pipe.flush().await.is_err(),
                            None => true,
                        };
                        if write_failed {
                            break;
                        }
                    } else if finish {
                        stdin.take();
                        finished_turn = true;
                        break;
                    }
                }
                Ok(None) => break,
                Err(err) => {
                    eprintln!("[antigravity-cli stdout] read error: {err}");
                    break;
                }
            }
        }
        drop(stdin);
        drop(reader);

        let child_opt = children.lock().await.remove(&stream_id_task);
        let exit_code = if let Some(mut child) = child_opt {
            wait_for_agy_exit(&mut child, finished_turn).await
        } else {
            None
        };
        let stderr_text = match tokio::time::timeout(Duration::from_secs(2), stderr_task).await {
            Ok(Ok(text)) => text,
            _ => String::new(),
        };
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
        assert!(prompt.ends_with(TEXT_ONLY_CLOSING));
        assert!(!prompt.contains("abc"));
    }

    #[test]
    fn empty_success_without_text_gets_one_follow_up() {
        let empty = r#"{"event":"result","result":{"status":"SUCCESS","response":""}}"#;
        assert!(should_follow_up_after_denied_command(false, false, empty));
        assert!(!should_follow_up_after_denied_command(true, false, empty));
        assert!(!should_follow_up_after_denied_command(false, true, empty));
        let text = r#"{"event":"result","result":{"status":"SUCCESS","response":"正文"}}"#;
        assert!(!should_follow_up_after_denied_command(false, false, text));
        let failed = r#"{"event":"result","result":{"status":"ERROR","response":"","error":"invalid model"}}"#;
        assert!(!should_follow_up_after_denied_command(false, false, failed));
        let delta = r#"{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"正"}}"#;
        assert!(line_has_text_delta(delta));
        assert!(!line_has_text_delta(
            r#"{"event":"step_update","step_update":{"step_type":"tool","tool_name":"run_command","text_delta":"no"}}"#
        ));
    }

    #[test]
    fn terminal_result_finishes_without_waiting_for_the_language_server() {
        let text = r#"{"event":"result","result":{"status":"SUCCESS","response":"正文"}}"#;
        let empty = r#"{"event":"result","result":{"status":"SUCCESS","response":""}}"#;
        let failed = r#"{"event":"result","result":{"status":"ERROR","response":"","error":"eof"}}"#;
        let delta = r#"{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"正"}}"#;
        assert!(stream_should_finish(true, false, text));
        assert!(stream_should_finish(false, false, text));
        assert!(stream_should_finish(false, false, failed));
        assert!(!stream_should_finish(false, false, empty));
        assert!(stream_should_finish(true, false, empty));
        assert!(stream_should_finish(false, true, empty));
        assert!(!stream_should_finish(false, false, delta));
    }

    #[test]
    fn denied_command_follow_up_repeats_the_chapter_task() {
        let prompt = format!(
            "大纲骨架很长，克里姆林宫。\n\n目标章节：第167章\n用户请求：编写第167章《赴日通知书》。全章只写科瓦尔斯基一家。正文不要出现章号。\n\n写作任务书：\n交付格式：第一行「第167章 赴日通知书」。\n\n{TEXT_ONLY_CLOSING}"
        );
        let follow = command_denied_followup(&prompt);
        assert!(follow.contains("第167章"));
        assert!(follow.contains("赴日通知书"));
        assert!(follow.contains("科瓦尔斯基"));
        assert!(follow.contains("# 第X章 标题名"));
        assert!(follow.contains("不要改用大纲骨架"));
        assert!(follow.contains("只约束这一行之后的正文"));
        assert!(!follow.contains("直接输出正文"));
        assert!(!follow.contains(TEXT_ONLY_CLOSING));
    }

    #[test]
    fn denied_command_follow_up_without_a_chapter_task_does_not_invent_one() {
        let messages: Vec<AgyMessage> = serde_json::from_value(serde_json::json!([
            { "role": "user", "content": "解释这段代码" }
        ]))
        .expect("messages");
        let prompt = flatten_antigravity_prompt(&messages).expect("prompt");
        let follow = command_denied_followup(&prompt);
        assert!(follow.contains("按上面【用户】消息里的要求作答"));
        assert!(!follow.contains("# 第X章 标题名"));
        assert!(!follow.contains("直接输出正文"));
    }
}
