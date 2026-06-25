use std::sync::Arc;
use crate::commands::claude_cli::ClaudeCliState;
use crate::commands::codex_cli::CodexCliState;
use crate::commands::file_sync::FileSyncState;
use crate::server::config::ServerConfig;

pub type SharedState = Arc<AppState>;

pub struct AppState {
    pub config: ServerConfig,
    pub claude_cli: ClaudeCliState,
    pub codex_cli: CodexCliState,
    pub file_sync: FileSyncState,
    pub event_tx: tokio::sync::broadcast::Sender<ServerEvent>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", content = "payload")]
pub enum ServerEvent {
    #[serde(rename = "claude-cli")]
    ClaudeCli { stream_id: String, data: String },
    #[serde(rename = "claude-cli:done")]
    ClaudeCliDone { stream_id: String, code: Option<i32>, stderr: String },
    #[serde(rename = "codex-cli")]
    CodexCli { stream_id: String, data: String },
    #[serde(rename = "codex-cli:done")]
    CodexCliDone { stream_id: String, code: Option<i32>, stderr: String },
    #[serde(rename = "file-sync://queue-updated")]
    FileSyncQueueUpdated { project_id: String, tasks: serde_json::Value },
    #[serde(rename = "file-sync://changed")]
    FileSyncChanged { project_id: String, tasks: serde_json::Value },
    #[serde(rename = "backup-progress")]
    BackupProgress { message: String, percent: Option<f64> },
}

impl AppState {
    pub fn new(config: ServerConfig) -> Self {
        let (event_tx, _) = tokio::sync::broadcast::channel(256);
        Self {
            config,
            claude_cli: ClaudeCliState::default(),
            codex_cli: CodexCliState::default(),
            file_sync: FileSyncState::default(),
            event_tx,
        }
    }
}
