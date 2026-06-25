pub mod config;
pub mod state;
pub mod routes;
pub mod handlers;
pub mod static_files;

use config::ServerConfig;
use state::SharedState;
use std::net::SocketAddr;

pub async fn start_server(config: ServerConfig) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr: SocketAddr = format!("{}:{}", config.server.host, config.server.port)
        .parse()?;
    let state = SharedState::new(state::AppState::new(config.clone()));
    let app = routes::create_router(state);

    eprintln!("[QMAI Server] Listening on http://{}", addr);

    if config.app.open_browser {
        let url = format!("http://{}", addr);
        let _ = open::that(&url);
    }

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
