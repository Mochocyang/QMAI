use axum::http::StatusCode;
use axum::response::IntoResponse;
use mime_guess;
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "../dist/"]
struct Assets;

pub async fn serve_static(uri: axum::http::Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    if let Some(content) = Assets::get(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        return (
            StatusCode::OK,
            [("Content-Type", mime.as_ref().to_string())],
            content.data.to_vec(),
        );
    }

    // SPA fallback — any non-API, non-file path serves index.html
    match Assets::get("index.html") {
        Some(content) => (
            StatusCode::OK,
            [("Content-Type", "text/html".to_string())],
            content.data.to_vec(),
        ),
        None => (
            StatusCode::NOT_FOUND,
            [("Content-Type", "text/plain".to_string())],
            b"Not Found".to_vec(),
        ),
    }
}
