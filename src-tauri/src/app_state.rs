use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_store::StoreExt;

use crate::atomic_file::write_bytes_atomically;

pub const PRIMARY_FILE_NAME: &str = "app-state.json";
pub const BAK_FILE_NAME: &str = "app-state.json.bak";

const SUBSTANTIVE_KEYS: &[&str] = &[
    "llmConfig",
    "providerConfigs",
    "recentProjects",
    "lastProject",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoverAction {
    Unchanged,
    RefreshedBak,
    RestoredFromBak,
    Quarantined,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoverReport {
    pub action: RecoverAction,
    pub message: String,
}

enum Classified {
    Missing,
    Unusable,
    Object { value: Value, has_substance: bool },
}

fn value_has_substance(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    SUBSTANTIVE_KEYS.iter().any(|key| match object.get(*key) {
        None | Some(Value::Null) => false,
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Array(items)) => !items.is_empty(),
        Some(Value::Object(nested)) => !nested.is_empty(),
        Some(_) => true,
    })
}

fn classify(path: &Path) -> Classified {
    if !path.exists() {
        return Classified::Missing;
    }
    let Ok(bytes) = fs::read(path) else {
        return Classified::Unusable;
    };
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Classified::Unusable;
    }
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(value) if value.is_object() => {
            let has_substance = value_has_substance(&value);
            Classified::Object {
                value,
                has_substance,
            }
        }
        _ => Classified::Unusable,
    }
}

fn object_bytes(value: &Value) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(value).map_err(|error| format!("序列化 app-state 失败: {error}"))
}

fn quarantine_primary(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let dest = path.with_file_name(format!("app-state.json.corrupt-{stamp}"));
    fs::rename(path, &dest)
        .or_else(|_| {
            fs::copy(path, &dest)
                .and_then(|_| fs::remove_file(path))
                .map(|_| ())
        })
        .map_err(|error| {
            format!(
                "隔离损坏的 app-state 失败 '{}' -> '{}': {error}",
                path.display(),
                dest.display()
            )
        })
}

fn write_value(path: &Path, value: &Value) -> Result<(), String> {
    write_bytes_atomically(path, &object_bytes(value)?)
}

pub fn recover_app_state_file(dir: &Path) -> RecoverReport {
    let primary_path = dir.join(PRIMARY_FILE_NAME);
    let bak_path = dir.join(BAK_FILE_NAME);
    let primary = classify(&primary_path);
    let bak = classify(&bak_path);

    let primary_unusable = matches!(primary, Classified::Missing | Classified::Unusable);
    let primary_has_substance = matches!(
        primary,
        Classified::Object {
            has_substance: true,
            ..
        }
    );
    let bak_has_substance = matches!(
        bak,
        Classified::Object {
            has_substance: true,
            ..
        }
    );
    let bak_usable_value = match &bak {
        Classified::Object {
            has_substance: true,
            value,
        } => Some(value.clone()),
        _ => None,
    };

    if (!primary_has_substance && bak_has_substance) || (primary_unusable && bak_has_substance) {
        if let Some(value) = bak_usable_value {
            if let Err(error) = quarantine_primary(&primary_path) {
                return RecoverReport {
                    action: RecoverAction::Unchanged,
                    message: format!("无法隔离损坏的 app-state.json: {error}"),
                };
            }
            return match write_value(&primary_path, &value) {
                Ok(()) => RecoverReport {
                    action: RecoverAction::RestoredFromBak,
                    message: "已从 app-state.json.bak 恢复全局配置".to_string(),
                },
                Err(error) => RecoverReport {
                    action: RecoverAction::Unchanged,
                    message: format!("从 bak 恢复 app-state.json 失败: {error}"),
                },
            };
        }
    }

    if primary_has_substance {
        let bak_needs_refresh = !matches!(
            bak,
            Classified::Object {
                has_substance: true,
                ..
            }
        );
        if bak_needs_refresh {
            if let Classified::Object { value, .. } = primary {
                return match write_value(&bak_path, &value) {
                    Ok(()) => RecoverReport {
                        action: RecoverAction::RefreshedBak,
                        message: "已用当前配置刷新 app-state.json.bak".to_string(),
                    },
                    Err(error) => RecoverReport {
                        action: RecoverAction::Unchanged,
                        message: format!("刷新 app-state.json.bak 失败: {error}"),
                    },
                };
            }
        }
        return RecoverReport {
            action: RecoverAction::Unchanged,
            message: "app-state.json 完好".to_string(),
        };
    }

    if matches!(primary, Classified::Unusable) {
        return match quarantine_primary(&primary_path) {
            Ok(()) => RecoverReport {
                action: RecoverAction::Quarantined,
                message: "已隔离损坏的 app-state.json，未写入空配置".to_string(),
            },
            Err(error) => RecoverReport {
                action: RecoverAction::Unchanged,
                message: format!("隔离损坏的 app-state.json 失败: {error}"),
            },
        };
    }

    RecoverReport {
        action: RecoverAction::Unchanged,
        message: "app-state.json 不存在或尚无实质配置".to_string(),
    }
}

pub fn persist_app_state_object(dir: &Path, value: &Value) -> Result<(), String> {
    if !value.is_object() {
        return Err("app-state 必须是 JSON 对象".to_string());
    }
    let primary_path = dir.join(PRIMARY_FILE_NAME);
    let incoming_has_substance = value_has_substance(value);
    if let Classified::Object {
        has_substance: true,
        ..
    } = classify(&primary_path)
    {
        if !incoming_has_substance {
            eprintln!("[app-state] 拒绝用无实质配置的内容覆盖现有 app-state.json");
            return Err("拒绝用空配置覆盖现有应用配置".to_string());
        }
    }

    let bytes = object_bytes(value)?;
    write_bytes_atomically(&primary_path, &bytes)?;
    if incoming_has_substance {
        write_bytes_atomically(&dir.join(BAK_FILE_NAME), &bytes)?;
    }
    Ok(())
}

fn open_app_state_store<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<std::sync::Arc<tauri_plugin_store::Store<R>>, String> {
    app.store_builder(PRIMARY_FILE_NAME)
        .disable_auto_save()
        .build()
        .map_err(|error| format!("无法打开应用状态存储: {error}"))
}

pub fn persist_plugin_store<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取 app_data_dir: {error}"))?;
    let path = dir.join(PRIMARY_FILE_NAME);
    let store = open_app_state_store(app)?;
    let mut map = Map::new();
    for (key, value) in store.entries() {
        map.insert(key, value);
    }
    persist_app_state_object(&dir, &Value::Object(map))?;
    Ok(path)
}

/// Flush plugin-store memory to disk before the process dies.
/// Debounced frontend writes can otherwise be lost on window destroy.
pub fn persist_app_state_before_exit<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = persist_plugin_store(app) {
        eprintln!("[app-state] 退出前持久化失败: {error}");
    }
}

pub fn prepare_app_state_store<R: Runtime>(app: &AppHandle<R>) {
    let Ok(dir) = app.path().app_data_dir() else {
        eprintln!("[app-state] could not resolve app_data_dir");
        return;
    };
    let report = recover_app_state_file(&dir);
    eprintln!("[app-state] {}", report.message);
    if let Err(error) = open_app_state_store(app) {
        eprintln!("[app-state] 打开存储失败: {error}");
    }
}

#[tauri::command]
pub async fn write_app_state_atomic(
    app: AppHandle,
    entries: Value,
) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取 app_data_dir: {error}"))?;
    tauri::async_runtime::spawn_blocking(move || persist_app_state_object(&dir, &entries))
        .await
        .map_err(|error| format!("write_app_state_atomic join error: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atomic_file::write_bytes_atomically_with_replace;

    fn unique_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qmai_app_state_{name}_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_raw(dir: &Path, name: &str, contents: &str) {
        fs::write(dir.join(name), contents).unwrap();
    }

    fn read(dir: &Path, name: &str) -> String {
        fs::read_to_string(dir.join(name)).unwrap()
    }

    fn corrupt_names(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("app-state.json.corrupt-"))
            .collect()
    }

    #[test]
    fn restores_truncated_primary_from_bak() {
        let dir = unique_test_dir("truncated");
        write_raw(&dir, PRIMARY_FILE_NAME, r#"{"llmConfig":{"model":""#);
        write_raw(
            &dir,
            BAK_FILE_NAME,
            r#"{"llmConfig":{"model":"kept"},"recentProjects":[{"path":"/novel"}]}"#,
        );

        let report = recover_app_state_file(&dir);
        assert_eq!(report.action, RecoverAction::RestoredFromBak);
        let restored: Value = serde_json::from_str(&read(&dir, PRIMARY_FILE_NAME)).unwrap();
        assert_eq!(restored["llmConfig"]["model"], "kept");
        assert_eq!(corrupt_names(&dir).len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn restores_when_primary_lost_substantive_keys() {
        let dir = unique_test_dir("shrink");
        write_raw(
            &dir,
            PRIMARY_FILE_NAME,
            r#"{"analytics_device_uuid":"abc"}"#,
        );
        write_raw(
            &dir,
            BAK_FILE_NAME,
            r#"{"llmConfig":{"provider":"openai","model":"gpt"},"providerConfigs":{"openai":{}}}"#,
        );

        let report = recover_app_state_file(&dir);
        assert_eq!(report.action, RecoverAction::RestoredFromBak);
        let restored: Value = serde_json::from_str(&read(&dir, PRIMARY_FILE_NAME)).unwrap();
        assert!(restored.get("llmConfig").is_some());
        assert!(restored.get("analytics_device_uuid").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn quarantines_unusable_primary_without_writing_empty_json() {
        let dir = unique_test_dir("quarantine");
        write_raw(&dir, PRIMARY_FILE_NAME, "{not-json");

        let report = recover_app_state_file(&dir);
        assert_eq!(report.action, RecoverAction::Quarantined);
        assert!(!dir.join(PRIMARY_FILE_NAME).exists());
        assert_eq!(corrupt_names(&dir).len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn refreshes_missing_bak_from_healthy_primary() {
        let dir = unique_test_dir("bak");
        write_raw(
            &dir,
            PRIMARY_FILE_NAME,
            r#"{"lastProject":{"path":"/novel","name":"n"}}"#,
        );

        let report = recover_app_state_file(&dir);
        assert_eq!(report.action, RecoverAction::RefreshedBak);
        let bak: Value = serde_json::from_str(&read(&dir, BAK_FILE_NAME)).unwrap();
        assert_eq!(bak["lastProject"]["path"], "/novel");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_to_overwrite_substantive_state_with_empty_payload() {
        let dir = unique_test_dir("refuse");
        write_raw(
            &dir,
            PRIMARY_FILE_NAME,
            r#"{"llmConfig":{"model":"keep"},"recentProjects":[{"path":"/a"}]}"#,
        );

        let error = persist_app_state_object(
            &dir,
            &serde_json::json!({"analytics_device_uuid":"x"}),
        )
        .unwrap_err();
        assert!(error.contains("拒绝"));
        let kept: Value = serde_json::from_str(&read(&dir, PRIMARY_FILE_NAME)).unwrap();
        assert_eq!(kept["llmConfig"]["model"], "keep");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn persist_writes_primary_and_bak() {
        let dir = unique_test_dir("persist");
        persist_app_state_object(
            &dir,
            &serde_json::json!({"providerConfigs":{"openai":{"apiKey":"k"}}}),
        )
        .unwrap();
        let primary: Value = serde_json::from_str(&read(&dir, PRIMARY_FILE_NAME)).unwrap();
        let bak: Value = serde_json::from_str(&read(&dir, BAK_FILE_NAME)).unwrap();
        assert_eq!(primary, bak);
        assert_eq!(primary["providerConfigs"]["openai"]["apiKey"], "k");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn failed_atomic_replace_keeps_original_app_state() {
        let dir = unique_test_dir("persist_fail");
        let path = dir.join(PRIMARY_FILE_NAME);
        fs::write(&path, r#"{"llmConfig":{"model":"keep"}}"#).unwrap();
        let result = write_bytes_atomically_with_replace(
            &path,
            br#"{"llmConfig":{"model":"new"}}"#,
            |_temp, _dest| Err("injected".to_string()),
        );
        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            r#"{"llmConfig":{"model":"keep"}}"#
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
