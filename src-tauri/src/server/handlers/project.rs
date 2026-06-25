use std::path::Path;

use axum::Json;
use serde::Deserialize;

use crate::commands::fs::resolve_project_storage_path;
use crate::commands::project::{create_project_impl, migrate_project_dirs, validate_wiki_project_root};
use crate::types::wiki::WikiProject;

// ── Request types ──────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectReq {
    pub name: String,
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathReq {
    pub path: String,
}

// ── Helper ─────────────────────────────────────────────────────────

fn ok<T: serde::Serialize>(data: T) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "data": data}))
}

fn err(e: String) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": false, "error": e}))
}

// ── Handlers ───────────────────────────────────────────────────────

pub async fn create_project(Json(req): Json<CreateProjectReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || create_project_impl(req.name, req.path)).await {
        Ok(Ok(project)) => ok(project),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("create_project 任务失败：{e}")),
    }
}

pub async fn open_project(Json(req): Json<PathReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || {
        let root = Path::new(&req.path);

        validate_wiki_project_root(root)?;
        migrate_project_dirs(root)?;

        let name = root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();

        Ok::<WikiProject, String>(WikiProject {
            name,
            path: req.path.replace('\\', "/"),
        })
    })
    .await
    {
        Ok(Ok(project)) => ok(project),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("open_project 任务失败：{e}")),
    }
}

pub async fn open_project_folder(Json(req): Json<PathReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || {
        let root = Path::new(&req.path);
        validate_wiki_project_root(root)?;

        let canonical = root
            .canonicalize()
            .map_err(|e| format!("解析项目路径失败 '{}': {}", req.path, e))?;

        open::that(&canonical).map_err(|e| format!("打开项目文件夹失败：{e}"))?;

        Ok::<(), String>(())
    })
    .await
    {
        Ok(Ok(())) => ok(serde_json::json!({})),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("open_project_folder 任务失败：{e}")),
    }
}

pub async fn open_file_location(Json(req): Json<PathReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || {
        let resolved = resolve_project_storage_path(&req.path);
        let file_path = Path::new(&resolved);

        if !file_path.exists() {
            return Err(format!("文件不存在：'{}'", resolved));
        }

        let canonical = file_path
            .canonicalize()
            .map_err(|e| format!("解析文件路径失败 '{}': {}", resolved, e))?;

        // Open the parent directory to reveal the file's location
        if let Some(parent) = canonical.parent() {
            open::that(parent).map_err(|e| format!("打开文件所在目录失败：{e}"))?;
        } else {
            open::that(&canonical).map_err(|e| format!("打开文件位置失败：{e}"))?;
        }

        Ok::<(), String>(())
    })
    .await
    {
        Ok(Ok(())) => ok(serde_json::json!({})),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("open_file_location 任务失败：{e}")),
    }
}
