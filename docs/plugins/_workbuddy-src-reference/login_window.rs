//! 对内嵌登录窗口的托管：开窗、白名单、关窗即取消。
//!
//! ── 为什么每次登录都要一个新的数据目录 ───────────────────────
//! WebView2 的 Cookie / localStorage 按**数据目录**存放。共用默认目录就等于共用
//! 登录态：用户想添加第二个账号时，官方登录页会直接把上一个账号放行过去，
//! 他根本没有机会换人。所以每次登录新建一个临时目录，关窗后删除。
//!
//! 刻意**不开**隐私模式（`incognito(true)`）：那个开关会让 Google / GitHub 之类
//! 的身份提供方判定为「不支持登录的浏览器」而拒绝登录，而独立数据目录已经提供
//! 了本功能真正需要的隔离。
//!
//! ── 为什么不改 UA ───────────────────────────────────────────
//! WebView2 用的是标准 Edge UA，本来就是一个普通浏览器的形态。主动拼一份 UA
//! 反而会与 `Sec-CH-UA` 头不一致 —— 在站点的风控里，「UA 与客户端提示头打架」
//! 比「多一个 Electron 段」更显眼。
//!
//! ── 导航白名单 ─────────────────────────────────────────────
//! 登录页会经过 SSO 中转与静态资源域。只放行 WorkBuddy 自己的域名后缀 + 协议
//! 内部的 `about:` / `data:` / `blob:`；其余一律拦。二期放开国际版与
//! 「恢复 Google / GitHub 入口」时，才额外放行 `accounts.google.com` 等身份域
//! （见规格第九节）。

use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::endpoints::Edition;
use super::login::LoginTasks;

/// 允许在登录窗口里导航的域名后缀。
///
/// 只看后缀（`host == suffix || host.ends_with(".suffix")`），所以
/// `copilot.tencent.com` 与 `staging-copilot.tencent.com` 都能覆盖。
pub const ALLOWED_HOSTS: &[&str] = &[
    "tencent.com",
    "workbuddy.cn",
    "codebuddy.cn",
    "workbuddy.ai",
    "codebuddy.ai",
];

/// 窗口标题：`登录 WorkBuddy 国内版账号`。
pub fn window_title(edition: Edition) -> String {
    format!("登录 WorkBuddy {}账号", edition.label)
}

/// 窗口 label：`login-<state 的 sha256 前 16 位>`。
///
/// 用哈希而不是原 state：state 是不透明随机串，直接当 label 会带进窗口 id 与
/// 日志；哈希够短也够唯一。
pub fn window_label(state: &str) -> String {
    let digest = Sha256::digest(state.as_bytes());
    let hex: String = digest.iter().take(8).map(|byte| format!("{byte:02x}")).collect();
    format!("login-{hex}")
}

/// 每次登录一个独立的临时数据目录（关窗后删除）。
pub struct LoginProfile {
    path: PathBuf,
}

impl LoginProfile {
    pub fn new() -> Result<LoginProfile, String> {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "qmai-workbuddy-login-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&path)
            .map_err(|error| format!("创建登录窗口数据目录失败：{error}"))?;
        Ok(LoginProfile { path })
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
}

impl Drop for LoginProfile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// 登录窗口允许的导航目标。
pub fn host_allowed(url: &tauri::Url) -> bool {
    match url.scheme() {
        "about" | "data" | "blob" => true,
        "https" | "http" => {
            let host = url.host_str().unwrap_or("").to_ascii_lowercase();
            ALLOWED_HOSTS
                .iter()
                .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
        }
        _ => false,
    }
}

/// 打开内嵌登录窗口。窗口关闭 = 取消这次登录。
pub fn open_embedded(
    app: &AppHandle,
    edition: Edition,
    auth_url: &str,
    state: &str,
    tasks: Arc<LoginTasks>,
) -> Result<(), String> {
    let url = tauri::Url::parse(auth_url).map_err(|error| format!("登录链接无效：{error}"))?;
    let profile = LoginProfile::new()?;
    let label = window_label(state);
    let state_owned = state.to_string();

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .title(window_title(edition))
        .inner_size(1100.0, 820.0)
        .min_inner_size(760.0, 560.0)
        .center()
        // 关掉地址/密码自动填充建议：这个窗口只用来过一次登录，
        // 自动填充弹层会盖住登录表单。
        .general_autofill_enabled(false)
        .data_directory(profile.path().to_path_buf())
        .on_navigation(|url| host_allowed(url))
        .build()
        .map_err(|error| format!("打开登录窗口失败：{error}"))?;

    // 窗口活多久，profile 就留多久；窗口销毁时把目录删掉。
    let profile_path = profile.path().to_path_buf();
    std::mem::forget(profile);
    let window_for_close = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            tasks.cancel(&state_owned);
            let path = profile_path.clone();
            let _ = window_for_close.destroy();
            // WebView2 释放文件句柄需要一点时间；删早了会失败，删晚了会留垃圾。
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                let _ = std::fs::remove_dir_all(&path);
            });
        }
    });

    Ok(())
}

/// 关掉某个 state 对应的窗口（登录成功后由命令层调用）。
pub fn close(app: &AppHandle, state: &str) {
    let label = window_label(state);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.destroy();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_is_stable_and_short() {
        let label = window_label("state-1");
        assert!(label.starts_with("login-"));
        assert_eq!(label.len(), "login-".len() + 16);
        assert_eq!(label, window_label("state-1"));
        assert_ne!(label, window_label("state-2"));
    }

    #[test]
    fn title_matches_edition() {
        assert_eq!(window_title(Edition::CN), "登录 WorkBuddy 国内版账号");
        assert_eq!(window_title(Edition::INTL), "登录 WorkBuddy 国际版账号");
    }

    #[test]
    fn allows_workbuddy_hosts_and_blocks_others() {
        let ok = |value: &str| host_allowed(&tauri::Url::parse(value).unwrap());
        assert!(ok("https://copilot.tencent.com/login?state=x"));
        assert!(ok("https://staging-copilot.tencent.com/x"));
        assert!(ok("https://www.workbuddy.cn/x"));
        assert!(ok("https://sso.codebuddy.cn/x"));
        assert!(ok("https://www.workbuddy.ai/login"));
        assert!(ok("about:blank"));
        assert!(!ok("https://evil.example.com/x"));
        assert!(!ok("https://notworkbuddy.ai/x"));
        assert!(!ok("file:///C:/windows/system32"));
        assert!(!ok("office-raccoon://auth/callback"));
    }
}
