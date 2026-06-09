use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
pub struct LocalCliConfigInfo {
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
pub struct LocalCliEnvironmentInfo {
    pub path: Option<String>,
    pub home: Option<String>,
    pub user_profile: Option<String>,
    pub app_data: Option<String>,
    pub http_proxy: Option<String>,
    pub https_proxy: Option<String>,
    pub all_proxy: Option<String>,
    pub no_proxy: Option<String>,
}

pub fn apply_local_cli_environment(cmd: &mut tokio::process::Command) -> LocalCliEnvironmentInfo {
    let info = current_local_cli_environment();

    if let Some(path) = &info.path {
        cmd.env("PATH", path);
    }
    if let Some(home) = &info.home {
        cmd.env("HOME", home);
    }
    if let Some(user_profile) = &info.user_profile {
        cmd.env("USERPROFILE", user_profile);
    }
    if let Some(app_data) = &info.app_data {
        cmd.env("APPDATA", app_data);
    }

    apply_optional_env(cmd, "HTTP_PROXY", &info.http_proxy);
    apply_optional_env(cmd, "HTTPS_PROXY", &info.https_proxy);
    apply_optional_env(cmd, "ALL_PROXY", &info.all_proxy);
    apply_optional_env(cmd, "NO_PROXY", &info.no_proxy);

    info
}

fn apply_optional_env(cmd: &mut tokio::process::Command, key: &str, value: &Option<String>) {
    match value {
        Some(v) if !v.is_empty() => {
            cmd.env(key, v);
            cmd.env(key.to_ascii_lowercase(), v);
        }
        _ => {
            cmd.env_remove(key);
            cmd.env_remove(key.to_ascii_lowercase());
        }
    }
}

pub fn current_local_cli_environment() -> LocalCliEnvironmentInfo {
    LocalCliEnvironmentInfo {
        path: std::env::var("PATH").ok().filter(|v| !v.trim().is_empty()),
        home: resolve_home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .filter(|v| !v.trim().is_empty()),
        user_profile: std::env::var("USERPROFILE")
            .ok()
            .filter(|v| !v.trim().is_empty()),
        app_data: std::env::var("APPDATA").ok().filter(|v| !v.trim().is_empty()),
        http_proxy: read_env_any(["HTTP_PROXY", "http_proxy"]),
        https_proxy: read_env_any(["HTTPS_PROXY", "https_proxy"]),
        all_proxy: read_env_any(["ALL_PROXY", "all_proxy"]),
        no_proxy: read_env_any(["NO_PROXY", "no_proxy"]),
    }
}

fn read_env_any<const N: usize>(keys: [&str; N]) -> Option<String> {
    keys.into_iter()
        .find_map(|key| std::env::var(key).ok())
        .filter(|v| !v.trim().is_empty())
}

pub fn resolve_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        })
}

pub fn read_claude_local_config(home_dir: Option<&Path>) -> LocalCliConfigInfo {
    let Some(home_dir) = home_dir else {
        return LocalCliConfigInfo::default();
    };
    let path = home_dir.join(".claude").join("settings.json");
    let Ok(content) = std::fs::read_to_string(path) else {
        return LocalCliConfigInfo::default();
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else {
        return LocalCliConfigInfo::default();
    };

    LocalCliConfigInfo {
        model: json
            .get("model")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
    }
}

pub fn read_codex_local_config(home_dir: Option<&Path>) -> LocalCliConfigInfo {
    let Some(home_dir) = home_dir else {
        return LocalCliConfigInfo::default();
    };
    let path = home_dir.join(".codex").join("config.toml");
    let Ok(content) = std::fs::read_to_string(path) else {
        return LocalCliConfigInfo::default();
    };
    let Ok(value) = content.parse::<toml::Value>() else {
        return LocalCliConfigInfo::default();
    };

    LocalCliConfigInfo {
        model: value
            .get("model")
            .and_then(toml::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_claude_model_from_settings_json() {
        let dir = tempdir_for_test();
        let claude_dir = dir.join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        std::fs::write(
            claude_dir.join("settings.json"),
            r#"{"model":"haiku","env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:15721"}}"#,
        )
        .unwrap();

        let config = read_claude_local_config(Some(&dir));
        assert_eq!(config.model.as_deref(), Some("haiku"));
    }

    #[test]
    fn reads_codex_model_from_config_toml() {
        let dir = tempdir_for_test();
        let codex_dir = dir.join(".codex");
        std::fs::create_dir_all(&codex_dir).unwrap();
        std::fs::write(
            codex_dir.join("config.toml"),
            "model_provider = \"custom\"\nmodel = \"gpt-5.4\"\n",
        )
        .unwrap();

        let config = read_codex_local_config(Some(&dir));
        assert_eq!(config.model.as_deref(), Some("gpt-5.4"));
    }

    #[test]
    fn current_environment_prefers_existing_proxy_values() {
        let _guard = env_lock();
        set_env("HTTP_PROXY", Some("http://proxy:7890"));
        set_env("HTTPS_PROXY", Some("http://proxy:7890"));
        set_env("ALL_PROXY", Some("http://proxy:7890"));
        set_env("NO_PROXY", Some("localhost,127.0.0.1"));

        let info = current_local_cli_environment();
        assert_eq!(info.http_proxy.as_deref(), Some("http://proxy:7890"));
        assert_eq!(info.https_proxy.as_deref(), Some("http://proxy:7890"));
        assert_eq!(info.all_proxy.as_deref(), Some("http://proxy:7890"));
        assert_eq!(info.no_proxy.as_deref(), Some("localhost,127.0.0.1"));
    }

    fn tempdir_for_test() -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("qmai-local-cli-config-test-{stamp}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        static ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());
        ENV_MUTEX.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn set_env(key: &str, value: Option<&str>) {
        match value {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
        let lower = key.to_ascii_lowercase();
        match value {
            Some(value) => std::env::set_var(lower, value),
            None => std::env::remove_var(lower),
        }
    }
}
