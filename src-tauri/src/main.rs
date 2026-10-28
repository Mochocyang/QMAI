#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    qmai::assert_supported_platform();
    // WebView2 缺失时必须在建窗之前拦截：进入 tauri::Builder 之后，wry 只会
    // 打一条日志，用户看到的是「双击没反应 / 白屏」（见 webview2_check 模块头）。
    #[cfg(windows)]
    if !qmai::ensure_webview2_or_guide() {
        std::process::exit(1);
    }
    qmai::run();
}
