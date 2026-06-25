use axum::extract::Multipart;
use axum::Json;
use serde::Deserialize;

use crate::commands::fs;

// ── Request types ──────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathReq {
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileReq {
    pub path: String,
    pub contents: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyReq {
    pub source: String,
    pub destination: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindRelatedReq {
    pub project_path: String,
    pub source_name: String,
}

// ── Helper ─────────────────────────────────────────────────────────

fn ok<T: serde::Serialize>(data: T) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "data": data}))
}

fn err(e: String) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": false, "error": e}))
}

// ── Handlers ───────────────────────────────────────────────────────

pub async fn read_file(Json(req): Json<PathReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || fs::do_read_file(&req.path)).await {
        Ok(Ok(content)) => ok(content),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("read_file join error: {e}")),
    }
}

pub async fn write_file(Json(req): Json<WriteFileReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || fs::do_write_file(&req.path, &req.contents)).await {
        Ok(Ok(_)) => ok(serde_json::Value::Null),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("write_file join error: {e}")),
    }
}

pub async fn write_file_atomic(Json(req): Json<WriteFileReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || fs::do_write_file_atomic(&req.path, &req.contents)).await {
        Ok(Ok(_)) => ok(serde_json::Value::Null),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("write_file_atomic join error: {e}")),
    }
}

pub async fn list_directory(Json(req): Json<PathReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || fs::do_list_directory(&req.path)).await {
        Ok(Ok(nodes)) => ok(nodes),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("list_directory join error: {e}")),
    }
}

pub async fn copy_file(Json(req): Json<CopyReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || fs::do_copy_file(&req.source, &req.destination)).await {
        Ok(Ok(_)) => ok(serde_json::Value::Null),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("copy_file join error: {e}")),
    }
}

pub async fn copy_directory(Json(req): Json<CopyReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || fs::do_copy_directory(&req.source, &req.destination)).await {
        Ok(Ok(files)) => ok(files),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("copy_directory join error: {e}")),
    }
}

pub async fn preprocess_file(Json(req): Json<PathReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || fs::do_preprocess_file(&req.path)).await {
        Ok(Ok(text)) => ok(text),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("preprocess_file join error: {e}")),
    }
}

pub async fn delete_file(Json(req): Json<PathReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || fs::do_delete_file(&req.path)).await {
        Ok(Ok(_)) => ok(serde_json::Value::Null),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("delete_file join error: {e}")),
    }
}

pub async fn find_related_wiki_pages(Json(req): Json<FindRelatedReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || fs::do_find_related_wiki_pages(&req.project_path, &req.source_name)).await {
        Ok(Ok(pages)) => ok(pages),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("find_related_wiki_pages join error: {e}")),
    }
}

pub async fn create_directory(Json(req): Json<PathReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || fs::do_create_directory(&req.path)).await {
        Ok(Ok(_)) => ok(serde_json::Value::Null),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("create_directory join error: {e}")),
    }
}

pub async fn file_exists(Json(req): Json<PathReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || fs::do_file_exists(&req.path)).await {
        Ok(Ok(exists)) => ok(exists),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("file_exists join error: {e}")),
    }
}

pub async fn get_file_modified_time(Json(req): Json<PathReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || fs::do_get_file_modified_time(&req.path)).await {
        Ok(Ok(ts)) => ok(ts),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("get_file_modified_time join error: {e}")),
    }
}

pub async fn get_file_size(Json(req): Json<PathReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || fs::do_get_file_size(&req.path)).await {
        Ok(Ok(size)) => ok(size),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("get_file_size join error: {e}")),
    }
}

pub async fn get_file_md5(Json(req): Json<PathReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || fs::do_get_file_md5(&req.path)).await {
        Ok(Ok(hash)) => ok(hash),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("get_file_md5 join error: {e}")),
    }
}

pub async fn read_file_as_base64(Json(req): Json<PathReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || fs::do_read_file_as_base64(&req.path)).await {
        Ok(Ok(file_b64)) => ok(file_b64),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("read_file_as_base64 join error: {e}")),
    }
}

pub async fn get_executable_dir() -> Json<serde_json::Value> {
    match fs::do_get_executable_dir() {
        Ok(dir) => ok(dir),
        Err(e) => err(e),
    }
}

pub async fn get_resource_dir() -> Json<serde_json::Value> {
    match fs::do_get_resource_dir() {
        Ok(dir) => ok(dir),
        Err(e) => err(e),
    }
}

/// Multipart 文件上传（浏览器模式导入章节/大纲文件使用）
/// 接收多个文件，保存到临时目录，返回临时目录路径和文件路径列表
/// 前端 FormData 格式：
///   - paths: JSON 字符串数组，每个元素为文件的相对路径（与 file 字段一一对应）
///   - file: 文件内容（多个，字段名均为 "file"，顺序与 paths 对应）
/// 如果 paths 数量与 file 数量不匹配，则回退到使用原始文件名（平铺保存）
pub async fn upload_files(mut multipart: Multipart) -> Json<serde_json::Value> {
    let temp_dir = std::env::temp_dir().join(format!("qmai-upload-{}", uuid::Uuid::new_v4()));
    if let Err(e) = std::fs::create_dir_all(&temp_dir) {
        return err(format!("创建临时目录失败: {e}"));
    }

    let mut rel_paths: Vec<String> = Vec::new();
    let mut file_entries: Vec<(String, Vec<u8>)> = Vec::new(); // (原始文件名, 数据)

    while let Ok(Some(field)) = multipart.next_field().await {
        let field_name = field.name().unwrap_or("").to_string();

        match field_name.as_str() {
            "paths" => {
                if let Ok(text) = field.text().await {
                    let _ = serde_json::from_str::<Vec<String>>(&text)
                        .map(|p| rel_paths = p);
                }
            }
            "file" => {
                let file_name = field.file_name().unwrap_or("unnamed").to_string();
                match field.bytes().await {
                    Ok(bytes) => {
                        file_entries.push((file_name, bytes.to_vec()));
                    }
                    Err(e) => return err(format!("读取上传文件失败: {e}")),
                }
            }
            _ => {
                let _ = field.bytes().await;
            }
        }
    }

    if file_entries.is_empty() {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return err("未找到上传文件".to_string());
    }

    let use_rel_paths = rel_paths.len() == file_entries.len();
    let mut saved_paths: Vec<String> = Vec::new();

    for (i, (original_name, data)) in file_entries.iter().enumerate() {
        let rel = if use_rel_paths {
            rel_paths[i].clone()
        } else {
            original_name.clone()
        };

        // 安全处理路径：去除驱动器号和前导分隔符，防止路径穿越
        let safe_rel = rel
            .replace('\\', "/")
            .split('/')
            .filter(|s| !s.is_empty() && !s.contains(':') && *s != "..")
            .collect::<Vec<_>>()
            .join("/");

        if safe_rel.is_empty() {
            continue;
        }

        let dest = temp_dir.join(&safe_rel);

        // 创建父目录
        if let Some(parent) = dest.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        if let Err(e) = std::fs::write(&dest, data) {
            return err(format!("保存文件失败: {e}"));
        }
        saved_paths.push(dest.to_string_lossy().to_string());
    }

    if saved_paths.is_empty() {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return err("未找到上传文件".to_string());
    }

    ok(serde_json::json!({
        "tempDir": temp_dir.to_string_lossy(),
        "paths": saved_paths,
    }))
}
