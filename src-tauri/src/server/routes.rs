use axum::{
    Router,
    routing::{get, post},
    Json,
};
use tower_http::cors::CorsLayer;

use crate::server::handlers;
use crate::server::state::SharedState;
use crate::server::static_files;

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok"}))
}

pub fn create_router(state: SharedState) -> Router {
    let api = Router::new()
        // health
        .route("/health", get(health))
        // fs — 17 routes
        .route("/fs/read-file", post(handlers::fs::read_file))
        .route("/fs/write-file", post(handlers::fs::write_file))
        .route("/fs/write-file-atomic", post(handlers::fs::write_file_atomic))
        .route("/fs/list-directory", post(handlers::fs::list_directory))
        .route("/fs/copy-file", post(handlers::fs::copy_file))
        .route("/fs/copy-directory", post(handlers::fs::copy_directory))
        .route("/fs/preprocess-file", post(handlers::fs::preprocess_file))
        .route("/fs/delete-file", post(handlers::fs::delete_file))
        .route("/fs/find-related-wiki-pages", post(handlers::fs::find_related_wiki_pages))
        .route("/fs/create-directory", post(handlers::fs::create_directory))
        .route("/fs/file-exists", post(handlers::fs::file_exists))
        .route("/fs/get-file-modified-time", post(handlers::fs::get_file_modified_time))
        .route("/fs/get-file-size", post(handlers::fs::get_file_size))
        .route("/fs/get-file-md5", post(handlers::fs::get_file_md5))
        .route("/fs/read-file-as-base64", post(handlers::fs::read_file_as_base64))
        .route("/fs/get-executable-dir", get(handlers::fs::get_executable_dir))
        .route("/fs/get-resource-dir", get(handlers::fs::get_resource_dir))
        .route("/fs/upload-files", post(handlers::fs::upload_files))
        // vector — 10 routes
        .route("/vector/upsert", post(handlers::vector::vector_upsert))
        .route("/vector/search", post(handlers::vector::vector_search))
        .route("/vector/delete", post(handlers::vector::vector_delete))
        .route("/vector/count", get(handlers::vector::vector_count))
        .route("/vector/upsert-chunks", post(handlers::vector::vector_upsert_chunks))
        .route("/vector/search-chunks", post(handlers::vector::vector_search_chunks))
        .route("/vector/delete-page", post(handlers::vector::vector_delete_page))
        .route("/vector/count-chunks", get(handlers::vector::vector_count_chunks))
        .route("/vector/legacy-row-count", get(handlers::vector::vector_legacy_row_count))
        .route("/vector/drop-legacy", post(handlers::vector::vector_drop_legacy))
        // project — 4 routes
        .route("/project/create", post(handlers::project::create_project))
        .route("/project/open", post(handlers::project::open_project))
        .route("/project/open-folder", post(handlers::project::open_project_folder))
        .route("/project/open-file-location", post(handlers::project::open_file_location))
        // backup — 3 routes
        .route("/backup/export", post(handlers::backup::export_backup))
        .route("/backup/import", post(handlers::backup::import_backup))
        .route("/backup/import-upload", post(handlers::backup::import_backup_upload))
        // extract — 4 routes
        .route("/extract/pdf-images", post(handlers::extract::extract_pdf_images))
        .route("/extract/office-images", post(handlers::extract::extract_office_images))
        .route("/extract/save-pdf-images", post(handlers::extract::extract_and_save_pdf_images))
        .route("/extract/save-office-images", post(handlers::extract::extract_and_save_office_images))
        // cli — 6 routes
        .route("/cli/claude-detect", get(handlers::cli::claude_cli_detect))
        .route("/cli/claude-spawn", post(handlers::cli::claude_cli_spawn))
        .route("/cli/claude-kill", post(handlers::cli::claude_cli_kill))
        .route("/cli/codex-detect", get(handlers::cli::codex_cli_detect))
        .route("/cli/codex-spawn", post(handlers::cli::codex_cli_spawn))
        .route("/cli/codex-kill", post(handlers::cli::codex_cli_kill))
        // sync — 6 routes
        .route("/sync/start-watcher", post(handlers::sync::start_project_file_watcher))
        .route("/sync/stop-watcher", post(handlers::sync::stop_project_file_watcher))
        .route("/sync/rescan", post(handlers::sync::rescan_project_files))
        .route("/sync/queue", post(handlers::sync::get_file_change_queue))
        .route("/sync/retry", post(handlers::sync::retry_file_change_task))
        .route("/sync/ignore", post(handlers::sync::ignore_file_change_task))
        // clip — 4 routes
        .route("/clip/status", get(handlers::clip::clip_server_status))
        .route("/clip/config", get(handlers::clip::get_clip_server_config))
        .route("/clip/set-config", post(handlers::clip::set_clip_server_config))
        .route("/clip/stop", post(handlers::clip::stop_clip_server))
        // proxy — 1 route
        .route("/proxy/set-env", post(handlers::proxy::set_proxy_env))
        // book-analysis — 5 routes
        .route("/book-analysis/analyze", post(handlers::book_analysis::analyze_book))
        .route("/book-analysis/status", get(handlers::book_analysis::get_book_analysis_status))
        .route("/book-analysis/list", get(handlers::book_analysis::list_book_analyses))
        .route("/book-analysis/delete", post(handlers::book_analysis::delete_book_analysis))
        .route("/book-analysis/export", post(handlers::book_analysis::export_book_analysis))
        // events — SSE
        .route("/events", get(handlers::events::sse_events))
        .with_state(state.clone());

    Router::new()
        .nest("/api", api)
        .layer(
            CorsLayer::new()
                .allow_origin(
                    state.config.allowed_origins
                        .iter()
                        .filter_map(|o| o.parse().ok())
                        .collect::<Vec<_>>(),
                )
                .allow_methods([axum::http::Method::GET, axum::http::Method::POST, axum::http::Method::OPTIONS])
                .allow_headers([axum::http::header::CONTENT_TYPE])
        )
        .fallback(static_files::serve_static)
}
