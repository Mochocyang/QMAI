use axum::Json;
use serde::Deserialize;
use std::path::Path;

use crate::commands::extract_images::{self, ExtractOptions};

// ── Request types ──────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathReq {
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractAndSaveReq {
    pub source_path: String,
    pub dest_dir: String,
    pub rel_to: String,
}

// ── Helper ─────────────────────────────────────────────────────────

fn ok<T: serde::Serialize>(data: T) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "data": data}))
}

fn err(e: String) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": false, "error": e}))
}

// ── Handlers ───────────────────────────────────────────────────────

pub async fn extract_pdf_images(Json(req): Json<PathReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || {
        extract_images::extract_pdf_images(&req.path, &ExtractOptions::default())
    })
    .await
    {
        Ok(Ok(images)) => ok(images),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("extract_pdf_images join error: {e}")),
    }
}

pub async fn extract_office_images(Json(req): Json<PathReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || {
        extract_images::extract_office_images(&req.path, &ExtractOptions::default())
    })
    .await
    {
        Ok(Ok(images)) => ok(images),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("extract_office_images join error: {e}")),
    }
}

pub async fn extract_and_save_pdf_images(Json(req): Json<ExtractAndSaveReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || {
        extract_images::extract_and_save_pdf_images(
            &req.source_path,
            Path::new(&req.dest_dir),
            Path::new(&req.rel_to),
            &ExtractOptions::default(),
        )
    })
    .await
    {
        Ok(Ok(images)) => ok(images),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("extract_and_save_pdf_images join error: {e}")),
    }
}

pub async fn extract_and_save_office_images(Json(req): Json<ExtractAndSaveReq>) -> Json<serde_json::Value> {
    match tokio::task::spawn_blocking(move || {
        extract_images::extract_and_save_office_images(
            &req.source_path,
            Path::new(&req.dest_dir),
            Path::new(&req.rel_to),
            &ExtractOptions::default(),
        )
    })
    .await
    {
        Ok(Ok(images)) => ok(images),
        Ok(Err(e)) => err(e),
        Err(e) => err(format!("extract_and_save_office_images join error: {e}")),
    }
}
