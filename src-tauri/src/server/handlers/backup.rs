use std::path::PathBuf;

use axum::extract::{Multipart, State};
use axum::Json;

use crate::commands::backup;
use crate::server::state::SharedState;

// ── Helper ─────────────────────────────────────────────────────────

fn ok<T: serde::Serialize>(data: T) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "data": data}))
}

fn err(e: String) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": false, "error": e}))
}

/// Derive the server's data directory from the executable path.
fn server_data_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("data")))
        .unwrap_or_else(|| PathBuf::from("data"))
}

// ── Handlers ───────────────────────────────────────────────────────

pub async fn export_backup(
    State(state): State<SharedState>,
    Json(params): Json<backup::ExportParams>,
) -> Json<serde_json::Value> {
    let app_state_path = server_data_dir().join("app-state.json");
    let event_tx = state.event_tx.clone();

    match tokio::task::spawn_blocking(move || {
        backup::do_export_backup(params, &app_state_path, |payload| {
            let percent = if payload.total > 0 {
                Some((payload.current as f64 / payload.total as f64) * 100.0)
            } else {
                None
            };
            let _ = event_tx.send(crate::server::state::ServerEvent::BackupProgress {
                message: payload.message.clone(),
                percent,
            });
        })
    })
    .await
    {
        Ok(Ok(result)) => ok(result),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("export_backup join error: {e}")),
    }
}

/// Multipart 文件上传导入（浏览器模式使用）
pub async fn import_backup_upload(
    State(state): State<SharedState>,
    mut multipart: Multipart,
) -> Json<serde_json::Value> {
    let mut file_data: Option<Vec<u8>> = None;
    let mut strategy = backup::ImportStrategy::Full;
    let mut projects: Option<Vec<backup::ProjectRestoreInfo>> = None;

    // 解析 multipart 字段
    while let Ok(Some(field)) = multipart.next_field().await {
        let field_name = field.name().unwrap_or("").to_string();

        match field_name.as_str() {
            "file" => {
                match field.bytes().await {
                    Ok(bytes) => file_data = Some(bytes.to_vec()),
                    Err(e) => return err(format!("读取上传文件失败: {e}")),
                }
            }
            "strategy" => {
                if let Ok(text) = field.text().await {
                    strategy = match text.as_str() {
                        "full" => backup::ImportStrategy::Full,
                        "global-only" => backup::ImportStrategy::GlobalOnly,
                        "selective" => backup::ImportStrategy::Selective,
                        _ => backup::ImportStrategy::Full,
                    };
                }
            }
            "projects" => {
                if let Ok(text) = field.text().await {
                    projects = serde_json::from_str(&text).ok();
                }
            }
            _ => {
                // 忽略未知字段
                let _ = field.bytes().await;
            }
        }
    }

    let file_data = match file_data {
        Some(d) => d,
        None => return err("未找到上传文件".to_string()),
    };

    // 将上传文件保存到临时目录
    let temp_dir = std::env::temp_dir().join("qmai-server-import");
    let _ = std::fs::create_dir_all(&temp_dir);
    let zip_path = temp_dir.join(format!("import-{}.zip", uuid::Uuid::new_v4()));

    if let Err(e) = std::fs::write(&zip_path, &file_data) {
        return err(format!("保存临时文件失败: {e}"));
    }

    let params = backup::ImportParams {
        zip_path: zip_path.to_string_lossy().to_string(),
        strategy,
        projects,
    };

    let app_state_dir = server_data_dir();
    let event_tx = state.event_tx.clone();
    let zip_path_clone = zip_path.clone();

    let result = tokio::task::spawn_blocking(move || {
        let result = backup::do_import_backup(params, &app_state_dir, |payload| {
            let percent = if payload.total > 0 {
                Some((payload.current as f64 / payload.total as f64) * 100.0)
            } else {
                None
            };
            let _ = event_tx.send(crate::server::state::ServerEvent::BackupProgress {
                message: payload.message.clone(),
                percent,
            });
        });
        // 清理临时文件
        let _ = std::fs::remove_file(&zip_path_clone);
        result
    })
    .await;

    match result {
        Ok(Ok(result)) => ok(result),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("import_backup join error: {e}")),
    }
}

/// JSON 参数导入（桌面端 Tauri 模式使用）
pub async fn import_backup(
    State(state): State<SharedState>,
    Json(params): Json<backup::ImportParams>,
) -> Json<serde_json::Value> {
    let app_state_dir = server_data_dir();
    let event_tx = state.event_tx.clone();

    match tokio::task::spawn_blocking(move || {
        backup::do_import_backup(params, &app_state_dir, |payload| {
            let percent = if payload.total > 0 {
                Some((payload.current as f64 / payload.total as f64) * 100.0)
            } else {
                None
            };
            let _ = event_tx.send(crate::server::state::ServerEvent::BackupProgress {
                message: payload.message.clone(),
                percent,
            });
        })
    })
    .await
    {
        Ok(Ok(result)) => ok(result),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("import_backup join error: {e}")),
    }
}
