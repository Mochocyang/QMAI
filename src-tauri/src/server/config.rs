use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub server: ServerSection,
    pub app: AppSection,
    #[serde(default = "default_allowed_origins")]
    pub allowed_origins: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerSection {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSection {
    #[serde(default)]
    pub project_path: String,
    #[serde(default = "default_true")]
    pub open_browser: bool,
}

fn default_host() -> String { "127.0.0.1".to_string() }
fn default_port() -> u16 { 5800 }
fn default_true() -> bool { true }
fn default_allowed_origins() -> Vec<String> {
    vec![
        "http://localhost:5800".to_string(),
        "http://127.0.0.1:5800".to_string(),
        "http://localhost:1420".to_string(),
        "http://127.0.0.1:1420".to_string(),
        "tauri://localhost".to_string(),
        "https://tauri.localhost".to_string(),
    ]
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            server: ServerSection {
                host: default_host(),
                port: default_port(),
            },
            app: AppSection {
                project_path: String::new(),
                open_browser: true,
            },
            allowed_origins: default_allowed_origins(),
        }
    }
}

impl ServerConfig {
    pub fn load() -> Self {
        let config_path = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("qmai-server.toml")))
            .unwrap_or_else(|| PathBuf::from("qmai-server.toml"));

        if config_path.exists() {
            match std::fs::read_to_string(&config_path) {
                Ok(content) => toml::from_str(&content).unwrap_or_default(),
                Err(_) => Self::default(),
            }
        } else {
            Self::default()
        }
    }
}
