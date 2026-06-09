//! Codex CLI subprocess transport.
//!
//! This mirrors the Claude Code CLI transport, but treats `codex` as a
//! local completion engine via `codex exec --json`. The webview can only
//! spawn this fixed command; it cannot execute arbitrary shell commands.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::cli_resolver::{child_path_env, find_cli_command};
use super::local_cli_config::{
    apply_local_cli_environment, read_codex_local_config, resolve_home_dir, LocalCliConfigInfo,
};

#[derive(Default)]
pub struct CodexCliState {
    children: Arc<Mutex<HashMap<String, Child>>>,
}

#[derive(Serialize)]
pub struct DetectResult {
    installed: bool,
    version: Option<String>,
    path: Option<String>,
    model: Option<String>,
    error: Option<String>,
}

const DEFAULT_CODEX_SPAWN_TIMEOUT_MINUTES: u64 = 10;
const MIN_CODEX_SPAWN_TIMEOUT_MINUTES: u64 = 1;
const MAX_CODEX_SPAWN_TIMEOUT_MINUTES: u64 = 240;
const STDERR_LIMIT_BYTES: usize = 1024 * 1024;
const STDOUT_LIMIT_BYTES: usize = 1024 * 1024;

fn append_capped_line(collected: &mut String, line: &str, limit_bytes: usize) {
    if collected.len() >= limit_bytes {
        return;
    }
    for ch in line.chars() {
        if collected.len() + ch.len_utf8() > limit_bytes {
            break;
        }
        collected.push(ch);
    }
    if collected.len() < limit_bytes {
        collected.push('\n');
    }
}

async fn find_codex_command() -> Result<std::path::PathBuf, String> {
    find_cli_command("codex", &["codex.cmd", "codex.exe"]).await
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

fn isolate_llm_api_key_env(cmd: &mut Command) {
    for key in [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "OPENAI_BASE_URL",
        "OPENAI_API_BASE",
        "ANTHROPIC_BASE_URL",
    ] {
        cmd.env_remove(key);
    }
}

#[tauri::command]
pub async fn codex_cli_detect() -> Result<DetectResult, String> {
    let local_config = read_current_codex_local_config();
    let path = match find_codex_command().await {
        Ok(p) => p,
        Err(error) => {
            return Ok(DetectResult {
                installed: false,
                version: None,
                path: None,
                model: local_config.model,
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
    let output = tokio::time::timeout(Duration::from_secs(3), cmd.arg("--version").output()).await;

    match output {
        Ok(Ok(out)) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            Ok(DetectResult {
                installed: true,
                version: Some(stdout),
                path: Some(path_str),
                model: local_config.model,
                error: None,
            })
        }
        Ok(Ok(out)) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Ok(DetectResult {
                installed: false,
                version: None,
                path: Some(path_str),
                model: local_config.model,
                error: Some(if stderr.is_empty() {
                    format!("`codex --version` exited with {}", out.status)
                } else {
                    stderr
                }),
            })
        }
        Ok(Err(e)) => Ok(DetectResult {
            installed: false,
            version: None,
            path: Some(path_str),
            model: local_config.model,
            error: Some(format!("Failed to spawn `codex`: {e}")),
        }),
        Err(_) => Ok(DetectResult {
            installed: false,
            version: None,
            path: Some(path_str),
            model: local_config.model,
            error: Some("`codex --version` timed out after 3s".to_string()),
        }),
    }
}

#[tauri::command]
pub async fn codex_cli_spawn(
    app: AppHandle,
    state: State<'_, CodexCliState>,
    stream_id: String,
    model: String,
    prompt: String,
    isolate_local_config: bool,
    timeout_minutes: Option<u64>,
) -> Result<(), String> {
    if prompt.trim().is_empty() {
        return Err("No prompt to send to codex CLI".to_string());
    }

    let codex = find_codex_command().await?;
    let mut cmd = Command::new(&codex);
    suppress_windows_console(&mut cmd);
    apply_local_cli_environment(&mut cmd);
    if let Some(path_env) = child_path_env().await {
        cmd.env("PATH", path_env);
    }
    if isolate_local_config {
        isolate_llm_api_key_env(&mut cmd);
    }
    cmd.args(build_codex_cli_args(&model, isolate_local_config));

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn codex: {e}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Missing stdin handle".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Missing stdout handle".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Missing stderr handle".to_string())?;

    stdin
        .write_all(prompt.as_bytes())
        .await
        .map_err(|e| format!("Failed to write to codex stdin: {e}"))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush codex stdin: {e}"))?;
    drop(stdin);

    state.children.lock().await.insert(stream_id.clone(), child);

    let children = Arc::clone(&state.children);
    let timeout_children = Arc::clone(&state.children);
    let timed_out = Arc::new(AtomicBool::new(false));
    let timeout_flag = Arc::clone(&timed_out);
    let timeout_stream_id = stream_id.clone();
    let timeout_minutes = codex_spawn_timeout_minutes(timeout_minutes);
    let timeout_duration = Duration::from_secs(timeout_minutes * 60);
    let app_for_task = app.clone();
    let stream_id_task = stream_id.clone();
    let topic = format!("codex-cli:{stream_id}");
    let done_topic = format!("codex-cli:{stream_id}:done");

    tokio::spawn(async move {
        tokio::time::sleep(timeout_duration).await;
        if let Some(mut child) = timeout_children.lock().await.remove(&timeout_stream_id) {
            timeout_flag.store(true, Ordering::SeqCst);
            let _ = child.start_kill();
        }
    });

    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();
        let app = app_for_task;

        let stderr_task = tokio::spawn(async move {
            let mut collected = String::new();
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                eprintln!("[codex-cli stderr] {line}");
                append_capped_line(&mut collected, &line, STDERR_LIMIT_BYTES);
            }
            collected
        });

        let mut stdout_text = String::new();
        loop {
            match reader.next_line().await {
                Ok(Some(line)) => {
                    append_capped_line(&mut stdout_text, &line, STDOUT_LIMIT_BYTES);
                    if app.emit(&topic, line).is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    eprintln!("[codex-cli stdout] read error: {e}");
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

        let mut stderr_text = stderr_task.await.unwrap_or_default();
        if timed_out.load(Ordering::SeqCst) {
            if !stderr_text.is_empty() {
                stderr_text.push('\n');
            }
            stderr_text.push_str(&format!("Codex CLI timed out after {timeout_minutes} minutes."));
        } else if stderr_text.len() >= STDERR_LIMIT_BYTES {
            stderr_text.push_str("\n[stderr truncated]");
        }
        if stdout_text.len() >= STDOUT_LIMIT_BYTES {
            stdout_text.push_str("\n[stdout truncated]");
        }

        let code = if timed_out.load(Ordering::SeqCst) {
            Some(-1)
        } else {
            exit_code
        };

        let _ = app.emit(
            &done_topic,
            serde_json::json!({
                "code": code,
                "stderr": stderr_text,
                "stdout": stdout_text,
            }),
        );
    });

    Ok(())
}

fn codex_spawn_timeout_minutes(value: Option<u64>) -> u64 {
    value
        .unwrap_or(DEFAULT_CODEX_SPAWN_TIMEOUT_MINUTES)
        .clamp(MIN_CODEX_SPAWN_TIMEOUT_MINUTES, MAX_CODEX_SPAWN_TIMEOUT_MINUTES)
}

fn build_codex_cli_args(model: &str, isolate_local_config: bool) -> Vec<String> {
    let mut args = vec!["-a".to_string(), "never".to_string(), "exec".to_string()];

    if isolate_local_config {
        args.extend([
            "--ignore-user-config".to_string(),
            "--ignore-rules".to_string(),
        ]);
    }

    args.extend([
        "--json".to_string(),
        "--skip-git-repo-check".to_string(),
        "--sandbox".to_string(),
        "read-only".to_string(),
        "--ephemeral".to_string(),
    ]);
    if !model.trim().is_empty() {
        args.extend(["--model".to_string(), model.to_string()]);
    }
    args.push("-".to_string());
    args
}

fn read_current_codex_local_config() -> LocalCliConfigInfo {
    let home = resolve_home_dir();
    read_codex_local_config(home.as_deref())
}

#[tauri::command]
pub async fn codex_cli_kill(
    state: State<'_, CodexCliState>,
    stream_id: String,
) -> Result<(), String> {
    if let Some(mut child) = state.children.lock().await.remove(&stream_id) {
        let _ = child.start_kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_capped_line_appends_newline_when_space_remains() {
        let mut out = String::new();
        append_capped_line(&mut out, "hello", 16);
        assert_eq!(out, "hello\n");
    }

    #[test]
    fn append_capped_line_never_exceeds_limit() {
        let mut out = String::new();
        append_capped_line(&mut out, "abcdef", 4);
        assert_eq!(out, "abcd");
        assert_eq!(out.len(), 4);
        append_capped_line(&mut out, "ignored", 4);
        assert_eq!(out, "abcd");
    }

    #[test]
    fn append_capped_line_preserves_utf8_boundaries() {
        let mut out = String::new();
        append_capped_line(&mut out, "é水x", 5);
        assert_eq!(out, "é水");
        assert_eq!(out.len(), 5);
        assert!(std::str::from_utf8(out.as_bytes()).is_ok());
    }

    #[test]
    fn codex_spawn_timeout_minutes_defaults_and_clamps() {
        assert_eq!(
            codex_spawn_timeout_minutes(None),
            DEFAULT_CODEX_SPAWN_TIMEOUT_MINUTES
        );
        assert_eq!(codex_spawn_timeout_minutes(Some(0)), MIN_CODEX_SPAWN_TIMEOUT_MINUTES);
        assert_eq!(codex_spawn_timeout_minutes(Some(42)), 42);
        assert_eq!(
            codex_spawn_timeout_minutes(Some(999)),
            MAX_CODEX_SPAWN_TIMEOUT_MINUTES
        );
    }

    #[test]
    fn codex_args_do_not_isolate_local_config_by_default() {
        let args = build_codex_cli_args("gpt-5", false);

        assert!(args
            .windows(3)
            .any(|pair| pair[0] == "-a" && pair[1] == "never" && pair[2] == "exec"));
        assert!(args.contains(&"--model".to_string()));
        assert!(args.contains(&"gpt-5".to_string()));
        assert!(!args.contains(&"--ignore-user-config".to_string()));
        assert!(!args.contains(&"--ignore-rules".to_string()));
    }

    #[test]
    fn codex_args_can_isolate_user_config_and_rules() {
        let args = build_codex_cli_args("gpt-5", true);
        let exec_pos = args.iter().position(|arg| arg == "exec").expect("exec arg");
        let ignore_config_pos = args
            .iter()
            .position(|arg| arg == "--ignore-user-config")
            .expect("ignore-user-config arg");
        let ignore_rules_pos = args
            .iter()
            .position(|arg| arg == "--ignore-rules")
            .expect("ignore-rules arg");

        assert!(ignore_config_pos > exec_pos);
        assert!(ignore_rules_pos > exec_pos);
    }

    #[test]
    fn codex_args_do_not_isolate_user_api_key_by_default() {
        let args = build_codex_cli_args("gpt-5", false);

        assert!(!args.contains(&"--ignore-user-config".to_string()));
        assert!(!args.contains(&"--ignore-rules".to_string()));
    }

    #[test]
    fn codex_args_skip_model_flag_when_model_is_empty() {
        let args = build_codex_cli_args("", false);
        assert!(!args.contains(&"--model".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("-"));
    }
}
