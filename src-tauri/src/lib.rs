mod commands;
mod panic_guard;
mod proxy;
mod types;

#[tauri::command]
fn set_proxy_env(config: proxy::ProxyConfig) -> String {
    let summary = proxy::apply_proxy_env(&config);
    eprintln!("[proxy] live update: {summary}");
    summary
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            use tauri::Manager;
            if let Ok(dir) = app.path().resource_dir() {
                commands::fs::set_resource_dir_hint(dir);
            }
            if let Ok(dir) = app.path().app_data_dir() {
                let store_path = dir.join("app-state.json");
                eprintln!("[proxy] reading from {}", store_path.display());
                let summary = proxy::apply_proxy_env_from_store(&store_path);
                eprintln!("[proxy] {summary}");
            } else {
                eprintln!("[proxy] could not resolve app_data_dir");
            }
            app.manage(commands::claude_cli::ClaudeCliState::default());
            app.manage(commands::codex_cli::CodexCliState::default());
            app.manage(commands::file_sync::FileSyncState::default());
            app.manage(commands::mcp_stdio::McpStdioState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::write_export_file,
            commands::fs::write_file_atomic,
            commands::fs::list_directory,
            commands::fs::copy_file,
            commands::fs::copy_directory,
            commands::fs::preprocess_file,
            commands::fs::delete_file,
            commands::fs::find_related_wiki_pages,
            commands::fs::create_directory,
            commands::fs::file_exists,
            commands::fs::get_file_modified_time,
            commands::fs::get_file_size,
            commands::fs::get_file_md5,
            commands::fs::read_file_as_base64,
            commands::fs::get_executable_dir,
            commands::fs::get_resource_dir,
            commands::project::create_project,
            commands::project::open_project,
            commands::project::open_project_folder,
            commands::project::open_file_location,
            commands::vectorstore::vector_upsert,
            commands::vectorstore::vector_search,
            commands::vectorstore::vector_delete,
            commands::vectorstore::vector_count,
            commands::vectorstore::vector_upsert_chunks,
            commands::vectorstore::vector_search_chunks,
            commands::vectorstore::vector_delete_page,
            commands::vectorstore::vector_count_chunks,
            commands::vectorstore::vector_legacy_row_count,
            commands::vectorstore::vector_drop_legacy,
            commands::claude_cli::claude_cli_detect,
            commands::claude_cli::claude_cli_spawn,
            commands::claude_cli::claude_cli_kill,
            commands::codex_cli::codex_cli_detect,
            commands::codex_cli::codex_cli_spawn,
            commands::codex_cli::codex_cli_kill,
            commands::extract_images::extract_pdf_images_cmd,
            commands::extract_images::extract_office_images_cmd,
            commands::extract_images::extract_and_save_pdf_images_cmd,
            commands::extract_images::extract_and_save_office_images_cmd,
            commands::file_sync::start_project_file_watcher,
            commands::file_sync::stop_project_file_watcher,
            commands::file_sync::rescan_project_files,
            commands::file_sync::get_file_change_queue,
            commands::file_sync::retry_file_change_task,
            commands::file_sync::ignore_file_change_task,
            commands::mcp_stdio::mcp_stdio_spawn,
            commands::mcp_stdio::mcp_stdio_write,
            commands::mcp_stdio::mcp_stdio_read,
            commands::mcp_stdio::mcp_stdio_kill,
            commands::backup::export_backup,
            commands::backup::import_backup,
            commands::backup::read_backup_manifest,
            set_proxy_env,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                #[cfg(target_os = "macos")]
                {
                    let _ = window.hide();
                    api.prevent_close();
                }

                #[cfg(not(target_os = "macos"))]
                {
                    use tauri::Manager;
                    api.prevent_close();
                    let win = window.clone();
                    let app = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        use tauri_plugin_dialog::DialogExt;
                        let confirmed = app
                            .dialog()
                            .message("确定要退出小说写作助手吗？")
                            .title("确认退出")
                            .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
                            .blocking_show();

                        if confirmed {
                            let _ = win.destroy();
                        }
                    });
                }
            }
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            let msg = format!("应用程序启动失败: {e}");
            eprintln!("{msg}");
            #[cfg(windows)]
            {
                use std::ffi::OsStr;
                use std::os::windows::ffi::OsStrExt;
                extern "system" {
                    fn MessageBoxW(
                        hwnd: *mut std::ffi::c_void,
                        lp_text: *const u16,
                        lp_caption: *const u16,
                        u_type: u32,
                    ) -> i32;
                }
                fn to_wide(s: &str) -> Vec<u16> {
                    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
                }
                let text = to_wide(&msg);
                let caption = to_wide("启动错误");
                unsafe {
                    MessageBoxW(
                        std::ptr::null_mut(),
                        text.as_ptr(),
                        caption.as_ptr(),
                        0x10,
                    );
                }
            }
            std::process::exit(1);
        })
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    use tauri::Manager;
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            let _ = (app, event);
        });
}
