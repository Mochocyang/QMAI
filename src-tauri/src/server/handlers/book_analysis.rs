use axum::Json;
use axum::extract::Query;
use serde::Deserialize;
use std::path::Path;

// ── Request types ──────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeBookReq {
    pub project_path: String,
    pub mode: String,
    pub source_type: String,
    pub source_path: Option<String>,
    pub source_url: Option<String>,
    #[serde(default = "default_chunk_size")]
    pub chunk_size: usize,
    #[serde(default = "default_summary_group_size")]
    pub summary_group_size: usize,
}

fn default_chunk_size() -> usize {
    8
}

fn default_summary_group_size() -> usize {
    3
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskIdReq {
    pub task_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPathReq {
    pub project_path: String,
}

// ── Helper ─────────────────────────────────────────────────────────

fn ok<T: serde::Serialize>(data: T) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "data": data}))
}

fn err(e: String) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": false, "error": e}))
}

// ── Handlers ───────────────────────────────────────────────────────

pub async fn analyze_book(
    Json(req): Json<AnalyzeBookReq>,
) -> Json<serde_json::Value> {
    // 验证配置
    if req.source_type == "file" {
        if let Some(ref path) = req.source_path {
            if !Path::new(path).exists() {
                return err("文件不存在".to_string());
            }
        } else {
            return err("未指定文件路径".to_string());
        }
    } else if req.source_type == "url" {
        if req.source_url.is_none() {
            return err("未指定URL".to_string());
        }
    }

    let task_id = format!("book-analysis-{}", chrono::Utc::now().timestamp_millis());
    ok(serde_json::json!({"taskId": task_id}))
}

pub async fn get_book_analysis_status(
    Query(req): Query<TaskIdReq>,
) -> Json<serde_json::Value> {
    // TODO: 从状态管理中获取进度
    ok(serde_json::json!({"taskId": req.task_id, "progress": {}}))
}

pub async fn list_book_analyses(
    Query(_req): Query<ProjectPathReq>,
) -> Json<serde_json::Value> {
    // TODO: 从状态管理中获取分析列表
    ok(serde_json::json!([]))
}

pub async fn delete_book_analysis(
    Json(req): Json<TaskIdReq>,
) -> Json<serde_json::Value> {
    // TODO: 实现删除逻辑
    ok(serde_json::json!({"taskId": req.task_id}))
}

pub async fn export_book_analysis(
    Json(_req): Json<TaskIdReq>,
) -> Json<serde_json::Value> {
    // TODO: 实现导出逻辑
    err("导出功能尚未实现".to_string())
}
