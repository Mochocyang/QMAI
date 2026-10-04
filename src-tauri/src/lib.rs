mod app_state;
mod atomic_file;
mod commands;
#[cfg(target_os = "macos")]
mod macos_window;
mod panic_guard;
mod platform_guard;
mod proxy;
mod types;

pub use platform_guard::assert_supported_platform;

#[tauri::command]
fn set_proxy_env(config: proxy::ProxyConfig) -> String {
    let summary = proxy::apply_proxy_env(&config);
    eprintln!("[proxy] live update: {summary}");
    summary
}

#[tauri::command]
fn log_error(message: String, stack: String, component_stack: String) {
    eprintln!("[frontend-error] message: {}", message);
    if !stack.is_empty() {
        eprintln!("[frontend-error] stack: {}", stack);
    }
    if !component_stack.is_empty() {
        eprintln!("[frontend-error] component-stack: {}", component_stack);
    }
}

#[tauri::command]
fn log_diagnostic(message: String) {
    eprintln!("[frontend-diagnostic] message: {}", message);
}

#[tauri::command]
fn restore_macos_window_frame(window: tauri::WebviewWindow) {
    #[cfg(not(target_os = "macos"))]
    let _ = window;
    #[cfg(target_os = "macos")]
    {
        let cloned = window.clone();
        if let Err(error) = window.run_on_main_thread(move || {
            if let Ok(ptr) = cloned.ns_window() {
                macos_window::restore_overlay_frame(ptr);
            }
        }) {
            eprintln!("[window] 恢复 macOS 圆角失败：{error}");
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                if let Ok(ptr) = window.ns_window() {
                    macos_window::restore_overlay_frame(ptr);
                }
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
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            use tauri::Manager;
            if let Ok(dir) = app.path().resource_dir() {
                commands::fs::set_resource_dir_hint(dir);
            }
            app_state::prepare_app_state_store(app.handle());
            if let Ok(dir) = app.path().app_data_dir() {
                let store_path = dir.join("app-state.json");
                eprintln!("[proxy] reading from {}", store_path.display());
                let summary = proxy::apply_proxy_env_from_store(&store_path);
                eprintln!("[proxy] {summary}");
            } else {
                eprintln!("[proxy] could not resolve app_data_dir");
            }
            app.manage(commands::claude_cli::ClaudeCliState::default());
            app.manage(commands::codex_cli::CodexAppServerState::default());
            app.manage(commands::cursor_cli::CursorProxyState::default());
            app.manage(commands::file_sync::FileSyncState::default());
            app.manage(commands::writing_wake_lock::WritingWakeLockManager::default());
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(ptr) = window.ns_window() {
                    macos_window::restore_overlay_frame(ptr);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::write_file_if_absent,
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
            commands::project::rename_project,
            commands::project::move_project_to_system_trash,
            commands::project::save_project_cover,
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
            commands::vectorstore::vector_rebuild_begin,
            commands::vectorstore::vector_rebuild_append,
            commands::vectorstore::vector_rebuild_commit,
            commands::vectorstore::vector_rebuild_abort,
            commands::claude_cli::claude_cli_detect,
            commands::claude_cli::claude_cli_spawn,
            commands::claude_cli::claude_cli_kill,
            commands::codex_cli::codex_cli_detect,
            commands::codex_cli::codex_app_server_start,
            commands::codex_cli::codex_app_server_write,
            commands::codex_cli::codex_app_server_stop,
            commands::cursor_cli::cursor_cli_detect,
            commands::cursor_cli::cursor_cli_about,
            commands::cursor_cli::cursor_cli_update,
            commands::cursor_cli::cursor_cli_apply_acp_model,
            commands::cursor_cli::cursor_cli_acp_models,
            commands::cursor_cli::cursor_proxy_status,
            commands::cursor_cli::cursor_proxy_ensure,
            commands::cursor_cli::cursor_proxy_stop,
            commands::extract_images::extract_office_images_cmd,
            commands::extract_images::extract_and_save_office_images_cmd,
            commands::file_sync::start_project_file_watcher,
            commands::file_sync::stop_project_file_watcher,
            commands::file_sync::rescan_project_files,
            commands::file_sync::get_file_change_queue,
            commands::file_sync::retry_file_change_task,
            commands::file_sync::ignore_file_change_task,
            commands::backup::export_backup,
            commands::backup::import_backup,
            commands::backup::read_backup_manifest,
            app_state::write_app_state_atomic,
            commands::writing_wake_lock::acquire_writing_wake_lock,
            commands::writing_wake_lock::release_writing_wake_lock,
            set_proxy_env,
            log_error,
            log_diagnostic,
            restore_macos_window_frame,
        ])
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if matches!(
                event,
                tauri::WindowEvent::Focused(_)
                    | tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::ThemeChanged(_)
                    | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) {
                if let Ok(ptr) = window.ns_window() {
                    macos_window::restore_overlay_frame(ptr);
                }
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                #[cfg(target_os = "macos")]
                {
                    let _ = window.hide();
                    api.prevent_close();
                }

                #[cfg(not(target_os = "macos"))]
                {
                    use tauri::Manager;
                    // 退出确认与保存统一由前端 onCloseRequested 负责：Tauri 检测到前端注册了
                    // close-requested 监听后会自行 prevent_close，前端确认通过后销毁窗口。
                    // 这里不能再 prevent_close / 弹原生确认框 / destroy，
                    // 否则同一次关闭会先后弹出两个确认框（前端手动 close() 会再次触发本回调）。
                    let _ = api;
                    app_state::persist_app_state_before_exit(window.app_handle());
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
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = &event {
                if !has_visible_windows {
                    use tauri::Manager;
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            // macOS 红叉只 hide；真正退出（Cmd+Q）必须在这里落盘。
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                app_state::persist_app_state_before_exit(app);
            }
        });
}
