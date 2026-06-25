use axum::Json;
use axum::extract::Query;
use serde::Deserialize;

use crate::commands::vectorstore;

// ── Request types ──────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorUpsertReq {
    pub project_path: String,
    pub page_id: String,
    pub embedding: Vec<f32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorSearchReq {
    pub project_path: String,
    pub query_embedding: Vec<f32>,
    pub top_k: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorDeleteReq {
    pub project_path: String,
    pub page_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPathReq {
    pub project_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorUpsertChunksReq {
    pub project_path: String,
    pub page_id: String,
    pub chunks: Vec<vectorstore::ChunkUpsertInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorSearchChunksReq {
    pub project_path: String,
    pub query_embedding: Vec<f32>,
    pub top_k: usize,
}

// ── Helper ─────────────────────────────────────────────────────────

fn ok<T: serde::Serialize>(data: T) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "data": data}))
}

fn err(e: String) -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": false, "error": e}))
}

// ── Handlers ───────────────────────────────────────────────────────

pub async fn vector_upsert(Json(req): Json<VectorUpsertReq>) -> Json<serde_json::Value> {
    match vectorstore::do_vector_upsert(req.project_path, req.page_id, req.embedding).await {
        Ok(()) => ok(serde_json::Value::Null),
        Err(e) => err(e),
    }
}

pub async fn vector_search(Json(req): Json<VectorSearchReq>) -> Json<serde_json::Value> {
    match vectorstore::do_vector_search(req.project_path, req.query_embedding, req.top_k).await {
        Ok(results) => ok(results),
        Err(e) => err(e),
    }
}

pub async fn vector_delete(Json(req): Json<VectorDeleteReq>) -> Json<serde_json::Value> {
    match vectorstore::do_vector_delete(req.project_path, req.page_id).await {
        Ok(()) => ok(serde_json::Value::Null),
        Err(e) => err(e),
    }
}

pub async fn vector_count(Query(req): Query<ProjectPathReq>) -> Json<serde_json::Value> {
    match vectorstore::do_vector_count(req.project_path).await {
        Ok(count) => ok(count),
        Err(e) => err(e),
    }
}

pub async fn vector_upsert_chunks(Json(req): Json<VectorUpsertChunksReq>) -> Json<serde_json::Value> {
    match vectorstore::do_vector_upsert_chunks(req.project_path, req.page_id, req.chunks).await {
        Ok(()) => ok(serde_json::Value::Null),
        Err(e) => err(e),
    }
}

pub async fn vector_search_chunks(Json(req): Json<VectorSearchChunksReq>) -> Json<serde_json::Value> {
    match vectorstore::do_vector_search_chunks(req.project_path, req.query_embedding, req.top_k).await {
        Ok(results) => ok(results),
        Err(e) => err(e),
    }
}

pub async fn vector_delete_page(Json(req): Json<VectorDeleteReq>) -> Json<serde_json::Value> {
    match vectorstore::do_vector_delete_page(req.project_path, req.page_id).await {
        Ok(()) => ok(serde_json::Value::Null),
        Err(e) => err(e),
    }
}

pub async fn vector_count_chunks(Query(req): Query<ProjectPathReq>) -> Json<serde_json::Value> {
    match vectorstore::do_vector_count_chunks(req.project_path).await {
        Ok(count) => ok(count),
        Err(e) => err(e),
    }
}

pub async fn vector_legacy_row_count(Query(req): Query<ProjectPathReq>) -> Json<serde_json::Value> {
    match vectorstore::do_vector_legacy_row_count(req.project_path).await {
        Ok(count) => ok(count),
        Err(e) => err(e),
    }
}

pub async fn vector_drop_legacy(Json(req): Json<ProjectPathReq>) -> Json<serde_json::Value> {
    match vectorstore::do_vector_drop_legacy(req.project_path).await {
        Ok(()) => ok(serde_json::Value::Null),
        Err(e) => err(e),
    }
}
