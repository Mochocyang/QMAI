fn main() {
    let config = llm_wiki_lib::server::config::ServerConfig::load();
    let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    rt.block_on(async {
        if let Err(e) = llm_wiki_lib::server::start_server(config).await {
            eprintln!("[QMAI Server] Error: {}", e);
            std::process::exit(1);
        }
    });
}
