//! 插件 provider 的**受控登录 / 设置窗口**（设计 5.1 / 5.2）。
//!
//! 与原版 `workbuddy/login_window.rs` 是同一套隔离做法（那份是内嵌版，代码不复用：
//! 它把白名单写死在 `ALLOWED_HOSTS` 里，而插件是第三方写的，宿主根本不认识它的域名）。
//! 三条做法都要保留：
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
//! ── 白名单必须来自清单（设计 5.2）────────────────────────────
//! 这个窗口本质是一个**浏览器**：白名单一旦松，插件就能把 QMAI 变成「任意网页浏览器」，
//! 用户在里输的任何凭据都会被插件看到。所以规则写死为四条，且域名列表只能来自
//! `plugin.json` 的 `authDomains` —— 代码里**一个第三方域名都不许写死**：
//!
//! 1. 始终放行宿主的回环端点 `127.0.0.1:<providerPort>`（插件自己的设置页就在这儿）；
//! 2. 放行清单 `authDomains` 里声明的主机后缀（含其子域）；
//! 3. 放行 `about:` / `data:` / `blob:`（页面自身的字体、图片、空白页）；
//! 4. **其余一律拦**。
//!
//! ── 被拦时为什么给不出可读提示 ───────────────────────────────
//! `on_navigation` 返回 `false` 之后，WebView **不加载任何东西**：那个目标页面根本没被
//! 加载，也就没有任何机会在它里面渲染一段「该域名被拦截」的说明；宿主也拿不到一个
//! 「空白页」去注入。窗口停在原页面，用户只看到「点了没反应」。
//! 因此这里**不假装**做了可读提示，只做了一件事：把「被拦」这件事通过
//! `plugin-provider-navigation-blocked` 事件发给前端，由宿主侧（QMAI 主窗口）弹提示条。
//! **前端接这个事件之前，用户侧仍然看不出原因。**
//! **绝不会**为了「让用户看得见」而放松白名单 —— 那正是设计 5.2 点名的失败方式。

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use super::providers::PluginProvider;

/// 窗口 label：`plugin-login-<pluginId>-<providerId>`。
///
/// 不用随机串：同一个 provider 重复点「登录」时必须能找回上一个窗口并关掉，
/// 否则用户会开出好几个窗口、各自带一份 Cookie 目录。
pub fn window_label(plugin_id: &str, provider_id: &str) -> String {
    format!("plugin-login-{plugin_id}-{provider_id}")
}

/// 算出登录窗口要打开的 URL 与宿主分配的端口（纯函数，便于单测）。
///
/// 前置校验都放在这里而不是散在命令层：三种「打不开」的原因（不需要登录、没声明设置页、
/// 地址拼不出来）都必须是**可读的 Err**，而不是开一个空白窗口让用户对着它发呆。
pub fn login_target(provider: &PluginProvider) -> Result<(String, u16), String> {
    if provider.auth_kind == "none" {
        // `none` 表示「不需要登录」（例如转发到本机推理端点）：没有登录 UI 可开。
        return Err(format!(
            "provider {} 不需要登录（authKind = none），没有可打开的设置页",
            provider.provider_id
        ));
    }
    let path = provider
        .settings_page
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| {
            format!(
                "provider {} 的清单未声明 settingsPagePath，无法打开登录/设置窗口",
                provider.provider_id
            )
        })?;
    // 纵深防御：清单校验（E_SETTINGS_PAGE_INVALID）在安装时已经拦过一次，但插件目录在
    // 用户机上，运行期读到的清单可能与安装时不同。规则与 manifest 侧保持同一套。
    if !path.starts_with('/') || path.contains("..") || path.contains("://") {
        return Err(format!(
            "provider {} 的 settingsPagePath 不合法：{path}",
            provider.provider_id
        ));
    }
    let port = port_from_base_url(&provider.base_url)?;
    Ok((format!("http://127.0.0.1:{port}{path}"), port))
}

/// 从 `http://127.0.0.1:<port>` 里取端口。
fn port_from_base_url(base_url: &str) -> Result<u16, String> {
    let url = tauri::Url::parse(base_url)
        .map_err(|error| format!("provider 地址无效（{base_url}）：{error}"))?;
    url.port()
        .ok_or_else(|| format!("provider 地址缺少端口（{base_url}）"))
}

/// 登录窗口允许的导航目标（设计 5.2 的四条规则）。
pub fn navigation_allowed(url: &tauri::Url, provider_port: u16, auth_domains: &[String]) -> bool {
    match url.scheme() {
        // 规则 3：页面自身的空白页 / data: 资源 / blob: 资源。
        "about" | "data" | "blob" => true,
        "http" | "https" => {
            let host = url.host_str().unwrap_or("").to_ascii_lowercase();
            // 规则 1：只放行**宿主分配的那一个**回环端口，且 host 必须是 `127.0.0.1` 字面量。
            //
            // 三条收紧都是刻意的：
            // - 不放 `localhost`：它可能解析到别的主机名/别名，而清单校验本来就拒了它；
            // - 不放其它端口：宿主的插件 API 服务也在回环上，按端口放行等于把宿主自己的
            //   接口暴露给一个第三方页面；
            // - 端口必须精确相等（默认端口 80/443 的 `None` 不等于任何一个分配端口）。
            if host == "127.0.0.1" && url.port() == Some(provider_port) {
                return true;
            }
            // 规则 2：清单声明的主机后缀（含子域）。**列表只来自清单**。
            auth_domains
                .iter()
                .any(|suffix| host_matches_suffix(&host, suffix))
        }
        // 规则 4：其余协议（`file:`、自定义 scheme…）一律拦。
        _ => false,
    }
}

/// 主机是否属于某个后缀（`host == suffix || host.ends_with(".suffix")`）。
///
/// 对清单里的脏数据（`*`、裸后缀 `.cn`、IP、`localhost`）选择「**不匹配**」而不是「匹配」：
/// 清单校验本该早就拒掉这些，万一漏进来，白名单应当失效关闭，而不是意外放行。
///
/// 特别注意**不要**替作者补上开头的点：`.cn` 若被当成 `cn` 处理，一个笔误就能把
/// 整个顶级域放行进来（等于白名单形同虚设）。
fn host_matches_suffix(host: &str, suffix: &str) -> bool {
    let suffix = suffix.trim().to_ascii_lowercase();
    if suffix.is_empty()
        || suffix.starts_with('.')
        || suffix.ends_with('.')
        || suffix.contains('*')
        || suffix.eq_ignore_ascii_case("localhost")
        || suffix.parse::<std::net::IpAddr>().is_ok()
    {
        return false;
    }
    host == suffix || host.ends_with(&format!(".{suffix}"))
}

/// 一次登录窗口专属的临时 WebView 数据目录（关窗后删除）。
struct LoginProfile {
    path: PathBuf,
}

impl LoginProfile {
    fn new() -> Result<LoginProfile, String> {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "qmai-plugin-login-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&path)
            .map_err(|error| format!("创建登录窗口数据目录失败：{error}"))?;
        Ok(LoginProfile { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }

    /// 交出目录所有权：建窗成功后由 [`OPEN_PROFILES`] 负责删。
    ///
    /// 建窗失败时它仍然由 `Drop` 收掉 —— 不能因为一次 `build()` 失败就在临时目录里
    /// 留下一个再也没人认领的 Cookie 目录。
    fn release(self) -> PathBuf {
        let path = self.path.clone();
        std::mem::forget(self);
        path
    }
}

impl Drop for LoginProfile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// 已开窗的临时数据目录（label → 路径）。
///
/// 为什么不能只靠 `CloseRequested` 删：**重新打开同一个 provider 时我们主动 `destroy()`
/// 旧窗口，那不会触发 `CloseRequested`**。只靠事件回调的话，这些目录会永远留在临时目录里
/// （每个都是几十 MB 的 Cookie 与缓存，用户多点几次「登录」就肉眼可见）。
static OPEN_PROFILES: std::sync::Mutex<Vec<(String, PathBuf)>> = std::sync::Mutex::new(Vec::new());

fn stash_profile(label: &str, path: PathBuf) {
    let mut guard = match OPEN_PROFILES.lock() {
        Ok(guard) => guard,
        // 锁中毒只可能来自别的线程 panic；这里的数据是「待删目录清单」，
        // 拿回内层值继续用比 panic 更合适（丢掉它就会漏删目录）。
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.retain(|(key, _)| key != label);
    guard.push((label.to_string(), path));
}

fn take_profile(label: &str) -> Option<PathBuf> {
    let mut guard = match OPEN_PROFILES.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let position = guard.iter().position(|(key, _)| key == label)?;
    Some(guard.swap_remove(position).1)
}

/// 延迟删除一个已关闭窗口的数据目录。
fn schedule_profile_cleanup(path: PathBuf) {
    tauri::async_runtime::spawn(async move {
        // WebView2 释放文件句柄需要一点时间；删早了会失败，删晚了会留垃圾。
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let _ = std::fs::remove_dir_all(&path);
    });
}

/// 打开某个插件 provider 的受控设置/登录窗口。
///
/// 与原版（`workbuddy/login_window.rs`）同样的三条隔离做法，但**白名单来自插件清单**，
/// 而不是写死在代码里 —— 插件是第三方写的，我们不认识它的域名。
///
/// 关窗 = 用户完成了登录/设置，因此关窗后会自动「重新探活 + 重抓模型」，
/// 用户不必回设置页手动点「刷新模型」（见函数末尾的 `CloseRequested` 处理）。
pub fn open_provider_window(
    app: &AppHandle,
    plugin_id: &str,
    provider_id: &str,
    provider_url: &str,
    provider_port: u16,
    auth_domains: &[String],
) -> Result<(), String> {
    let url = tauri::Url::parse(provider_url)
        .map_err(|error| format!("登录页地址无效（{provider_url}）：{error}"))?;
    // 首屏也过一遍白名单：`on_navigation` 只拦「导航」，而初始 URL 本身就是一次导航，
    // 别指望它会替我们把一个错的设置页地址挡在门外。
    if !navigation_allowed(&url, provider_port, auth_domains) {
        return Err(format!(
            "provider {provider_id} 的设置页地址不在白名单内：{provider_url}"
        ));
    }

    let label = window_label(plugin_id, provider_id);

    // 同一个 provider 重复打开：先关旧的再开新的。
    // 旧的临时目录不会收到 `CloseRequested`（我们是强制 destroy），所以在这里收尸。
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.destroy();
    }
    if let Some(previous) = take_profile(&label) {
        schedule_profile_cleanup(previous);
    }

    let profile = LoginProfile::new()?;
    let auth_domains_owned = auth_domains.to_vec();
    let app_for_blocked = app.clone();
    let plugin_id_for_blocked = plugin_id.to_string();
    let provider_id_for_blocked = provider_id.to_string();

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .title(format!("插件登录 / 设置 · {provider_id}"))
        .inner_size(1100.0, 820.0)
        .min_inner_size(760.0, 560.0)
        .center()
        // 同原版：这个窗口只用来过一次登录/设置，自动填充弹层会盖住表单。
        .general_autofill_enabled(false)
        .data_directory(profile.path().to_path_buf())
        .on_navigation(move |url| {
            let allowed = navigation_allowed(url, provider_port, &auth_domains_owned);
            if !allowed {
                // 见模块头「被拦时为什么给不出可读提示」：窗口内给不出，只能交给宿主侧。
                // 这里只上报，不改变返回值 —— 上报失败也不能放行（白名单是安全边界）。
                let _ = app_for_blocked.emit(
                    "plugin-provider-navigation-blocked",
                    serde_json::json!({
                        "pluginId": plugin_id_for_blocked.clone(),
                        "providerId": provider_id_for_blocked.clone(),
                        "host": url.host_str().unwrap_or(""),
                    }),
                );
            }
            allowed
        })
        .build()
        .map_err(|error| format!("打开登录窗口失败：{error}"))?;

    // 窗口活多久，profile 就留多久；窗口销毁时把目录删掉。
    stash_profile(&label, profile.release());

    let window_for_close = window.clone();
    let app_for_close = app.clone();
    let label_for_close = label.clone();
    let plugin_id_for_close = plugin_id.to_string();
    let provider_id_for_close = provider_id.to_string();
    window.on_window_event(move |event| {
        if !matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
            return;
        }
        // 用户按 X —— 这就是「登录/设置结束」的信号。
        let _ = window_for_close.destroy();
        let path = take_profile(&label_for_close);
        let app = app_for_close.clone();
        let plugin_id = plugin_id_for_close.clone();
        let provider_id = provider_id_for_close.clone();
        tauri::async_runtime::spawn(async move {
            // WebView2 释放文件句柄需要一点时间；删早了会失败，删晚了会留垃圾。
            // 同一个 sleep 也顺便给插件一点时间把凭证落盘，再去探活。
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if let Some(path) = path {
                let _ = std::fs::remove_dir_all(&path);
            }
            // 关窗后的自动刷新：重新探活 + 重抓模型，用户登录完不用手动点「刷新模型」。
            //
            // 这里拿不到命令层的 `State`（回调由 WebView 事件驱动，没有命令上下文），
            // 所以用 `AppHandle::try_state` 现取 —— 取不到就安静放弃：应用正在退出时
            // 不该因为一个后置刷新 panic（release 档是 panic=abort）。
            let Some(state) = app.try_state::<super::PluginsState>() else {
                return;
            };
            let outcome = super::refresh_provider_models(
                state.inner(),
                &provider_id,
                super::PROVIDER_REFRESH_PROBE_TIMEOUT,
            )
            .await;
            if let Err(error) = &outcome {
                // 登录成功但刷新失败是常见情况（插件还在落盘凭证、或 /health 短暂不响应）：
                // 只记日志，不弹窗打扰用户 —— provider 卡片的 `last_error` 已写明原因，
                // 用户还能手动点「刷新模型」重试。
                eprintln!("[plugins] provider {provider_id} 关窗后自动刷新失败：{error}");
            }
            // 必须**通知前端**：刷新是在后端悄悄做的，界面手里还是关窗前的快照。
            // 没有这个事件，用户会觉得「登录完模型没变」，只能再点一次「刷新模型」——
            // 而这正是本次自动刷新想省掉的那一步。事件只上报结果，不夹带 token。
            let _ = app.emit(
                "plugin-provider-models-refreshed",
                serde_json::json!({
                    "pluginId": plugin_id,
                    "providerId": provider_id,
                    "ok": outcome.is_ok(),
                    "modelCount": outcome.as_ref().map(|models| models.len()).unwrap_or(0),
                    "error": outcome.as_ref().err().cloned().unwrap_or_default(),
                }),
            );
        });
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::providers::PluginProvider;

    fn provider(settings_page: Option<&str>, auth_kind: &str) -> PluginProvider {
        PluginProvider {
            plugin_id: "wb-connect".to_string(),
            provider_id: "wb-connect".to_string(),
            name: "WorkBuddy 插件".to_string(),
            base_url: "http://127.0.0.1:51235".to_string(),
            token: "secret".to_string(),
            capabilities: vec!["balance.query".to_string()],
            settings_page: settings_page.map(str::to_string),
            auth_domains: vec!["workbuddy.cn".to_string()],
            auth_kind: auth_kind.to_string(),
            models: Vec::new(),
            ready: true,
            last_error: None,
        }
    }

    #[test]
    fn open_login_requires_settings_page_path() {
        // 没有 settingsPagePath：必须是一句可读的 Err，而不是开一个空白窗口。
        let error = login_target(&provider(None, "browser-login"))
            .expect_err("没声明 settingsPagePath 时必须报错");
        assert!(
            error.contains("settingsPagePath"),
            "错误要指明缺的是哪个字段：{error}"
        );
        assert!(
            error.contains("wb-connect"),
            "错误要指明是哪个 provider，否则用户不知道该找谁：{error}"
        );

        // 空串与非法路径同样拒绝（纵深防御：清单可能被改过）
        assert!(login_target(&provider(Some("   "), "browser-login")).is_err());
        assert!(login_target(&provider(Some("/../escape"), "browser-login")).is_err());
        assert!(login_target(&provider(Some("https://evil.example/x"), "browser-login")).is_err());
    }

    #[test]
    fn open_login_rejects_none_auth_kind() {
        // authKind=none = 不需要登录（如本机推理端点），没有设置页可开。
        let error =
            login_target(&provider(Some("/login"), "none")).expect_err("authKind=none 必须拒绝");
        assert!(error.contains("none"), "错误应说明 authKind：{error}");

        // 正常路径：URL 拼在宿主的回环端口上，端口与 base_url 一致
        let (url, port) = login_target(&provider(Some("/login"), "browser-login"))
            .expect("声明了设置页就该能打开");
        assert_eq!(port, 51235);
        assert_eq!(url, "http://127.0.0.1:51235/login");
    }

    #[test]
    fn navigation_whitelist_allows_loopback_port_and_declared_domains_only() {
        let domains = vec![
            "workbuddy.cn".to_string(),
            "accounts.google.com".to_string(),
        ];
        let ok =
            |value: &str| navigation_allowed(&tauri::Url::parse(value).unwrap(), 51235, &domains);

        // 规则 1：宿主的回环端点（插件自己的设置页）
        assert!(ok("http://127.0.0.1:51235/login"));
        assert!(ok("http://127.0.0.1:51235/login?next=/x"));
        // 规则 2：清单声明的主机后缀，含子域
        assert!(ok("https://www.workbuddy.cn/sso"));
        assert!(ok("https://accounts.google.com/o/oauth2"));
        assert!(ok("https://workbuddy.cn/"));
        // 规则 3：页面自身需要的协议
        assert!(ok("about:blank"));
        assert!(ok("data:text/html,hi"));
        assert!(ok("blob:https://www.workbuddy.cn/uuid"));
        // 规则 4：其余一律拦
        assert!(!ok("https://evil.example.com/x"), "清单没声明的域名必须拦");
        assert!(
            !ok("https://notworkbuddy.cn/x"),
            "后缀必须整段匹配，不能只看结尾"
        );
        assert!(
            !ok("http://127.0.0.1:9/x"),
            "别的回环端口不放过（宿主 API 也在回环上）"
        );
        assert!(!ok("http://localhost:51235/x"), "localhost 不在白名单里");
        assert!(!ok("file:///C:/windows/system32"));
        assert!(!ok("office-raccoon://auth/callback"));
        // 脏数据（本该被清单校验拒掉）：失效关闭，不能意外放行
        let dirty = vec!["*".to_string(), ".cn".to_string(), "127.0.0.1".to_string()];
        assert!(!navigation_allowed(
            &tauri::Url::parse("https://evil.cn/x").unwrap(),
            51235,
            &dirty
        ));
    }
}
