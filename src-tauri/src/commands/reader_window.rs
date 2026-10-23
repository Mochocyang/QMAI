//! 「在独立窗口中打开」的建窗命令与窗口生命周期诊断。
//!
//! # 为什么建窗放在 Rust 侧
//!
//! JS 的 `new WebviewWindow()` 失败时只能从 `tauri://error` 拿到一句含糊文案，
//! 而「窗口闪一下就没了」的场景里连这句都来不及看。放到 Rust 侧能记日志。
//!
//! # 🔴 三条踩出来的硬结论
//!
//! 1. `WebviewWindowBuilder::build()` 在**非主线程**上是投递式的：
//!    `send_user_message` 只把消息塞进事件循环就返回 `Ok`。所以 `Ok` 不代表窗口建成。
//!    建窗闭包里失败时 tauri 只 `log::error!` 并把刚建好的原生窗口 drop 掉 ——
//!    表现就是闪一下消失。因此这里自己装了 `log` 接收器把那句错误捞进文件。
//!
//! 2. 不能让它和主窗口共用 WebView2 环境。试过 `with_environment(主窗口的 environment)`
//!    （tauri 给子窗口用的那条路），在本机实测：`main.with_webview(...)` 返回 `Ok`
//!    但回调**一次都没有执行**（`tauri-runtime-wry` 在 webview 查不到时是静默丢弃），
//!    窗口自然不存在。另外 wry 自建环境 / 建控制器都走 `wait_with_pump` 死等回调，
//!    回调不来主线程就永久卡死（实测整个应用冻住，`taskkill` 不带 `/F` 都关不掉）。
//!
//! 3. 🔴 **真凶只有一条**：这台机器上 WebView2 的 **GPU 子进程在沙箱内起不来**。
//!    WebView2 自己的浏览器日志（`--enable-logging --v=1`）里是
//!    `GPU process exited unexpectedly: exit_code=7` ×9 → `FATAL: GPU process isn't
//!    usable. Goodbye.`，浏览器进程随即自杀。于是
//!    `CreateCoreWebView2EnvironmentWithOptions` 的回调**永不返回**，而 wry 是在主线程
//!    用 `wait_with_pump` 阻塞等它的 —— 主线程直接死锁：新窗口停在 `about:blank`、
//!    没有任何 `PageLoadEvent`、主窗口也不再重绘、`taskkill` 不带 `/F` 都关不掉。
//!    用户看到的就是「闪一下」或「整个软件假死 + 一片白」。
//!    **解法：`--disable-gpu-sandbox`**（实测 2/2；`--no-sandbox` 也管用但攻击面更大）。
//!
//!    排除过的假因（都做过实验，别再走一遍）：`--disable-gpu` 无效（0/2）；
//!    与主窗口 args 完全一致无效（0/3）；换 profile / 清缓存 / 换 `file://` 或本机 http
//!    全部无效 —— 跟协议、缓存内容、环境选项一致性都无关。GPU 崩溃是唯一的因。
//!
//! 4. 仍然保留**每进程一个 profile**（`reader-webview-<pid>`）+ 启动时清掉别的进程的旧目录：
//!    这不是修 bug 的手段，而是防「上一轮被强杀后残留的浏览器进程占着
//!    `GPUPersistentCache`（`另一个程序正在使用此文件 (0x20)`）」把问题带进下一轮。
//!    加了 `--disable-gpu-sandbox` 之后 GPU 不再崩，但这层隔离成本很低、收益明确。

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// 已建出、但前端还没报到的窗口 label。
fn pending_labels() -> &'static Mutex<Vec<String>> {
    static PENDING: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(Vec::new()))
}

/// 已经重建过一次的 label，避免无限重试。
fn retried_labels() -> &'static Mutex<std::collections::HashSet<String>> {
    static RETRIED: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    RETRIED.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

/// 与 tauri.conf.json 的 `identifier` 保持一致：日志目录要在拿到 AppHandle 之前
/// 就能算出来（`log` 接收器是全局的，拿不到 app），所以按平台惯例手工拼。
const APP_IDENTIFIER: &str = "com.qingmuai.writer";

/// 独立窗口的 WebView2 数据目录名（`app_local_data_dir` 下）。
const READER_DATA_DIR: &str = "reader-webview";

/// 日志超过这个大小就在下次启动时重建，避免多年累积成大文件。
const LOG_MAX_BYTES: u64 = 512 * 1024;

/// 本进程里是否已有过一张**真的把前端跑起来**的独立窗口。只用于日志与就绪判定。
static READER_WINDOW_HEALTHY: AtomicBool = AtomicBool::new(false);

/// 日志文件：`<本地应用数据目录>/window-debug.log`。
fn log_file() -> PathBuf {
    static CACHE: OnceLock<PathBuf> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            let base = if cfg!(windows) {
                std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
            } else if cfg!(target_os = "macos") {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Application Support"))
            } else {
                std::env::var_os("XDG_DATA_HOME")
                    .map(PathBuf::from)
                    .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
            }
            .unwrap_or_else(std::env::temp_dir);
            let dir = base.join(APP_IDENTIFIER);
            let _ = std::fs::create_dir_all(&dir);
            dir.join("window-debug.log")
        })
        .clone()
}

fn stamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn append_line(line: &str) {
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file())
    {
        let _ = writeln!(file, "[{}] {line}", stamp_ms());
    }
}

/// 追加一行窗口日志。写不进去就算了 —— 诊断设施不能反过来弄坏功能。
pub fn log_line(message: &str) {
    append_line(message);
}

/// 诊断开关（设了就为真）。正式使用时这些变量都不存在，代码走默认分支。
fn env_flag(name: &str) -> bool {
    std::env::var_os(name).is_some()
}

/// 独立窗口本该加载的地址。
///
/// tauri 在 Windows 上把前端资源挂在 `http://tauri.localhost/`，其它平台用自定义
/// scheme。这里写常量是为了在「webview 建出来了但一直停在 about:blank」时
/// 能手动补一次导航 —— 那条路只能用字符串 URL。
#[cfg(windows)]
const APP_ROOT_URL: &str = "http://tauri.localhost/index.html";
#[cfg(not(windows))]
const APP_ROOT_URL: &str = "tauri://localhost/index.html";

/// 把 `log` 宏（wry / tauri 内部）的 warn 以上输出也导到同一个文件里。
///
/// 不装这个接收器，建窗闭包里的错误只走 `log::error!`，
/// 而项目没有初始化任何 logger —— 在发布版里等于被丢弃。
struct FileLogger;

impl log::Log for FileLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Warn
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        append_line(&format!(
            "log {} {}: {}",
            record.level(),
            record.target(),
            record.args()
        ));
    }

    fn flush(&self) {}
}

static FILE_LOGGER: FileLogger = FileLogger;

/// 进程启动时调一次：装日志接收器 + panic 钩子。必须在 `Builder::default()` 之前。
pub fn init_diagnostics() {
    static ONCE: OnceLock<()> = OnceLock::new();
    ONCE.get_or_init(|| {
        if let Ok(meta) = std::fs::metadata(log_file()) {
            if meta.len() > LOG_MAX_BYTES {
                let _ = std::fs::remove_file(log_file());
            }
        }
        append_line("=== app start ===");
        if log::set_logger(&FILE_LOGGER).is_ok() {
            log::set_max_level(log::LevelFilter::Warn);
        }
        // 主线程上的 panic 在发布版里没有任何可见痕迹（没有控制台），
        // 而建窗闭包正好跑在主线程上，所以顺手把它也记下来。
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            append_line(&format!("panic: {info}"));
            default_hook(info);
        }));
    });
}

/// 独立窗口的前端在启动时调用它，用来确认「建出来了」之后「页面跑起来了」。
#[tauri::command]
pub async fn reader_window_log(message: String) -> Result<(), String> {
    log_line(&format!("[frontend] {message}"));
    Ok(())
}

/// 前端真正跑起来之后报到。这是判断窗口是否可用的唯一依据。
///
/// 🔴 这个命令必须在前端入口**同步**调用（`main.tsx` 顶层，React 渲染之前）：
/// 只有它能证明「模块脚本执行了」。建窗成功、页面开始导航都不算数。
#[tauri::command]
pub async fn reader_window_ready() -> Result<(), String> {
    let first = !READER_WINDOW_HEALTHY.swap(true, Ordering::Relaxed);
    if let Ok(mut pending) = pending_labels().lock() {
        pending.pop();
    }
    log_line(if first {
        "[frontend] reader window ready (first in this process)"
    } else {
        "[frontend] reader window ready"
    });
    Ok(())
}

/// 独立窗口的 WebView2 数据目录（不存在就建）。拿不到就返回 None，退回共享目录。
///
/// 🔴 目录名带**进程号**是刻意的：上一轮进程如果是被强杀/崩溃退出的，
/// 它的 WebView2 浏览器子进程会继续活几秒甚至更久，死死占住 profile 里的
/// `GPUPersistentCache` 等文件。新一轮再用同一个目录，就会撞上
/// `Failed to open persistent cache files ... 另一个程序正在使用此文件 (0x20)`，
/// 接着 GPU 进程反复崩溃 → `FATAL: GPU process isn't usable. Goodbye.` →
/// 浏览器进程自杀 → 窗口停在 about:blank / 一片白，且**永不恢复**（实测）。
/// 每进程一个目录之后，这种跨进程抢锁在物理上不可能发生。
fn reader_data_dir(app: &AppHandle) -> Option<PathBuf> {
    let base = match app.path().app_local_data_dir() {
        Ok(base) => base,
        Err(err) => {
            log_line(&format!("app_local_data_dir failed: {err}"));
            return None;
        }
    };
    cleanup_stale_profiles(&base);
    let dir = base.join(format!("{READER_DATA_DIR}-{}", std::process::id()));
    if let Err(err) = std::fs::create_dir_all(&dir) {
        log_line(&format!("create reader data dir failed: {err}"));
    }
    Some(dir)
}

/// 清掉别的进程留下的 `reader-webview-*` 目录。删不掉的（还被占着）就跳过。
fn cleanup_stale_profiles(base: &Path) {
    static DONE: OnceLock<()> = OnceLock::new();
    if DONE.get().is_some() {
        return;
    }
    let own = format!("{READER_DATA_DIR}-{}", std::process::id());
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.starts_with(READER_DATA_DIR) || name == own {
            continue;
        }
        if std::fs::remove_dir_all(entry.path()).is_ok() {
            removed += 1;
        }
    }
    if removed > 0 {
        log_line(&format!("removed {removed} stale reader profiles"));
    }
    let _ = DONE.set(());
}

/// 把整个 reader profile 删掉重建。
///
/// 🔴 这是本模块最重要的一步：坏缓存必须**不可能**跨启动存活。
/// 只删 Cache 子目录不够稳（实测删不干净时仍会命中坏响应），
/// 而这个 profile 里没有任何需要保留的东西，所以整个删。
///
/// 删不掉（上一轮浏览器进程还占着文件）时退一步：sleep 后重试一次；
/// 仍失败就照常继续，由 `watch_reader_window` 的重建兜底。
fn reset_reader_profile(dir: &Path) {
    if dir.exists() {
        match std::fs::remove_dir_all(dir) {
            Ok(()) => log_line("reader profile wiped"),
            Err(err) => {
                log_line(&format!("wipe reader profile failed: {err}; retrying"));
                std::thread::sleep(Duration::from_millis(400));
                match std::fs::remove_dir_all(dir) {
                    Ok(()) => log_line("reader profile wiped on retry"),
                    Err(err) => log_line(&format!("wipe reader profile failed again: {err}")),
                }
            }
        }
    }
    if let Err(err) = std::fs::create_dir_all(dir) {
        log_line(&format!("recreate reader profile failed: {err}"));
    }
}

/// 独立窗口的浏览器参数。
///
/// 🔴 必须把 wry 的默认串一起带上：`additional_browser_args` 会**替换**默认值
/// （`wry-0.55.1/src/webview2/mod.rs:298`），只写自己的那一项会把默认的
/// `--disable-features=...` 弄丢。
///
/// 三条各自的理由：
/// - `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`：wry 默认值。
/// - `--disk-cache-size=0`：本地自定义协议（`tauri.localhost`）不需要磁盘缓存。
/// - `--disable-gpu-sandbox`：**这是真正解决问题的那一条**。
///
/// 🔴 故障链（有 WebView2 自己的浏览器日志为证，`--enable-logging --v=1`）：
/// ```text
/// ERROR gpu_process_host.cc  GPU process exited unexpectedly: exit_code=7   ×9
/// FATAL gpu_data_manager_impl_private.cc:408  GPU process isn't usable. Goodbye.
/// ```
/// 这台机器上 GPU 子进程在沙箱内**起不来**（不是显卡驱动问题 —— Edge 用同一套
/// Chromium 渲染栈、同样的 `--disable-gpu` 能正常出图），Chromium 重试 9 次后
/// 让浏览器进程自杀。于是 `CreateCoreWebView2EnvironmentWithOptions` 的回调**永远
/// 不返回**，而 wry 是在主线程用 `webview2_com::wait_with_pump` 阻塞等这个回调 ——
/// 主线程就此死锁：新窗口停在 `about:blank`、没有任何 `PageLoadEvent`、
/// 连主窗口都不再重绘、`taskkill` 不带 `/F` 都关不掉。用户看到的就是
/// 「点一下闪一下」或「整个软件假死、窗口一片白」。
///
/// 判别实验（都做过，别再重复）：
/// - `--disable-gpu` → 0/2，无效（GPU 进程照样起、照样崩）。
/// - 与主窗口完全相同的 args → 0/3，无效（不是环境选项不一致）。
/// - 换 profile 目录、清缓存、换 `file://` 或本机 http → 全部无效（与协议/缓存无关）。
/// - `--no-sandbox` → 3/3 通过，但攻击面更大；
///   `--disable-gpu-sandbox` → 2/2 通过，**渲染进程仍然在沙箱里**，所以选它。
const READER_BROWSER_ARGS: &str = concat!(
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
    " --disk-cache-size=0",
    " --disable-gpu-sandbox"
);

/// 主窗口在 tauri.conf.json 里配的浏览器参数。
///
/// 🔴 共用 profile 时**必须逐字一致**：WebView2 对同一个 user data dir 的所有
/// webview 要求环境级选项（additionalBrowserArgs / scrollBarStyle /
/// browserExtensionsEnabled）完全相同，否则第二个 webview 建不出来
/// （`ERROR_INVALID_STATE 0x8007139F`），表现就是窗口闪一下消失。
/// 所以这里直接读配置，而不是手抄一份常量。
fn main_window_browser_args(app: &AppHandle) -> Option<String> {
    app.config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .and_then(|window| window.additional_browser_args.clone())
}

/// 允许用环境变量覆盖浏览器参数，方便现场试不同组合而不必重新编译。
fn reader_browser_args() -> String {
    std::env::var("QMAI_READER_ARGS").unwrap_or_else(|_| READER_BROWSER_ARGS.to_string())
}

/// 真正建窗的那段逻辑，命令与自检共用。
fn build_reader_window(
    app: &AppHandle,
    label: &str,
    title: &str,
    payload: &Value,
) -> Result<(), String> {
    let script = match serde_json::to_string(payload) {
        Ok(json) => format!("window.__QMAI_READER_PAYLOAD__ = {json};"),
        Err(err) => {
            log_line(&format!("payload failed label={label}: {err}"));
            return Err(format!("窗口参数序列化失败: {err}"));
        }
    };

    let url = match std::env::var("QMAI_READER_SELFTEST_URL") {
        Ok(target) => match target.parse() {
            Ok(parsed) => {
                log_line(&format!("external url override: {target}"));
                WebviewUrl::External(parsed)
            }
            Err(_) => WebviewUrl::App("index.html".into()),
        },
        Err(_) => WebviewUrl::App("index.html".into()),
    };

    // 页面加载的两端也记一笔：能区分「窗口建出来了但页面没进来」
    // 和「页面进来了之后才出事」，这两种在界面上看着都是闪一下。
    let mut builder = WebviewWindowBuilder::new(app, label, url)
        .title(title)
        .inner_size(920.0, 780.0)
        .min_inner_size(480.0, 400.0)
        .center()
        .resizable(true)
        .initialization_script(&script)
        .on_page_load(|window, payload| {
            let stage = match payload.event() {
                tauri::webview::PageLoadEvent::Started => "page load started",
                tauri::webview::PageLoadEvent::Finished => "page load finished",
            };
            log_line(&format!("{stage} label={} url={}", window.label(), payload.url()));
        });

    // 默认：独立窗口有自己的 WebView2 数据目录（目录名带进程号，见 reader_data_dir）。
    // 想试「共用主窗口 profile」可以设 QMAI_READER_SHARED_PROFILE=1 ——
    // 那条路在本机实测建出来的窗口会被直接丢掉（只剩主窗口），所以不作默认。
    if !env_flag("QMAI_READER_SHARED_PROFILE") {
        match reader_data_dir(app) {
            Some(dir) => {
                log_line(&format!("own data directory: {}", dir.display()));
                builder = builder.data_directory(dir);
                if !env_flag("QMAI_READER_NO_ARGS") {
                    let args = reader_browser_args();
                    log_line(&format!("browser args: {args}"));
                    builder = builder.additional_browser_args(&args);
                }
            }
            None => log_line("app_local_data_dir failed, fall back to shared profile"),
        }
    } else {
        // 诊断分支（QMAI_READER_SHARED_PROFILE=1）：profile 与主窗口共用。
        // 参数必须与主窗口一致，但 `--disable-gpu-sandbox` 无论如何都要带上，
        // 否则就是上面注释里那条 GPU 崩溃 → 主线程死锁的老路。
        let args = match main_window_browser_args(app) {
            Some(args) => format!("{args} --disable-gpu-sandbox"),
            None => READER_BROWSER_ARGS.to_string(),
        };
        log_line(&format!("shared profile, browser args: {args}"));
        builder = builder.additional_browser_args(&args);
    }

    match builder.build() {
        Ok(_) => {
            log_line(&format!("build() returned ok label={label}"));
            if let Ok(mut pending) = pending_labels().lock() {
                if !pending.iter().any(|item| item == label) {
                    pending.push(label.to_string());
                }
            }
            Ok(())
        }
        Err(err) => {
            log_line(&format!("build() failed label={label}: {err}"));
            if let Ok(mut pending) = pending_labels().lock() {
                pending.retain(|item| item != label);
            }
            Err(format!("独立窗口创建失败: {err}"))
        }
    }
}

/// 盯着一张刚建出来的窗口，等它报到。
///
/// 分三段时间轴：
/// - +4s：还在 `about:blank` ⇒ webview 建出来了但**导航从没发起**，手动补一次。
/// - +10s：仍没收到前端 ready ⇒ 销毁 + 清 profile + 重建一次。
/// - +16s：还不行就放弃（日志里留痕迹，不再无限重试）。
fn watch_reader_window(app: AppHandle, label: String, title: String, payload: Value) {
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(Duration::from_secs(4));
        if !is_pending(&label) {
            return;
        }
        if let Some(window) = app.get_webview_window(&label) {
            let url = window
                .url()
                .map(|u| u.to_string())
                .unwrap_or_else(|err| format!("<err {err}>"));
            log_line(&format!("watchdog: {label} url at +4s = {url}"));
            // about:blank = 导航压根没发出去。补一次通常就好了。
            if url == "about:blank" || url.is_empty() {
                match APP_ROOT_URL.parse() {
                    Ok(target) => {
                        log_line(&format!("watchdog: {label} navigating manually"));
                        if let Err(err) = window.navigate(target) {
                            log_line(&format!("watchdog: navigate failed label={label}: {err}"));
                        }
                    }
                    Err(err) => log_line(&format!("watchdog: bad app url: {err}")),
                }
            }
        } else {
            log_line(&format!("watchdog: {label} window missing at +4s"));
        }

        std::thread::sleep(Duration::from_secs(6));
        if !is_pending(&label) {
            return;
        }

        let first_attempt = retried_labels()
            .lock()
            .map(|mut retried| retried.insert(label.clone()))
            .unwrap_or(false);
        if !first_attempt {
            log_line(&format!("watchdog: {label} still not ready, giving up"));
            return;
        }

        log_line(&format!("watchdog: {label} never became ready, rebuilding once"));
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.destroy();
        }
        // 让浏览器进程把 profile 放开再动手。
        std::thread::sleep(Duration::from_millis(600));
        if let Ok(mut pending) = pending_labels().lock() {
            pending.retain(|item| item != &label);
        }
        if let Some(dir) = reader_data_dir(&app) {
            reset_reader_profile(&dir);
        }
        match build_reader_window(&app, &label, &title, &payload) {
            Ok(()) => watch_reader_window(app.clone(), label.clone(), title.clone(), payload.clone()),
            Err(err) => log_line(&format!("watchdog rebuild failed label={label}: {err}")),
        }
    });
}

/// 这个 label 还在等前端报到吗。
fn is_pending(label: &str) -> bool {
    pending_labels()
        .lock()
        .map(|pending| pending.iter().any(|item| item == label))
        .unwrap_or(false)
}

/// 建窗（或复用已开的同一个窗口）。
///
/// label 由文档路径哈希而来，同一份文档重复右键只会聚焦，不会长出一排窗。
#[tauri::command]
pub async fn open_reader_window(
    app: AppHandle,
    label: String,
    title: String,
    payload: Value,
) -> Result<(), String> {
    log_line(&format!("create requested label={label}"));

    if let Some(existing) = app.get_webview_window(&label) {
        log_line(&format!("reuse existing label={label}"));
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    build_reader_window(&app, &label, &title, &payload)?;
    watch_reader_window(app.clone(), label, title, payload);
    Ok(())
}

/// 诊断自检：设了环境变量 `QMAI_READER_SELFTEST=<某个 .md 路径>` 时，
/// 启动 1.5 秒后自动开一个独立窗口（与右键菜单走同一条路径）。
///
/// 这台机器上 WebView2 的调试通道被拦住，没法用脚本点界面，只能让程序自己点。
/// 平时不设这个变量，什么都不会发生。
pub fn maybe_run_selftest(app: &AppHandle) {
    let Some(path) = std::env::var_os("QMAI_READER_SELFTEST") else {
        return;
    };
    let path = PathBuf::from(path);
    let delay_ms = std::env::var("QMAI_READER_SELFTEST_DELAY_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(1500);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(Duration::from_millis(delay_ms));
        let label = format!("reader-selftest-{}", stamp_ms());
        log_line(&format!("selftest start label={label} path={}", path.display()));
        let payload = serde_json::json!({
            "kind": "chapter",
            "path": path.to_string_lossy(),
            "projectPath": null,
        });
        match build_reader_window(&app, &label, "自检", &payload) {
            Ok(()) => log_line(&format!("selftest build returned ok label={label}")),
            Err(err) => log_line(&format!("selftest build error label={label}: {err}")),
        }
        std::thread::sleep(Duration::from_secs(5));
        let healthy = READER_WINDOW_HEALTHY.load(Ordering::Relaxed);
        match app.get_webview_window(&label) {
            Some(window) => {
                let url = window
                    .url()
                    .map(|u| u.to_string())
                    .unwrap_or_else(|err| format!("<err {err}>"));
                log_line(&format!(
                    "selftest probe label={label} url={url} healthy={healthy}"
                ));
                // 页面内部状态：JS 到底跑没跑、React 挂没挂。
                let probe = r#"(function(){
                  var out = {
                    ready: document.readyState,
                    rootKids: (document.getElementById('root')||{}).childElementCount || 0,
                    payload: !!window.__QMAI_READER_PAYLOAD__,
                    bodyLen: (document.body && document.body.innerText || '').length,
                    href: location.href
                  };
                  try { window.__TAURI_INTERNALS__.invoke('reader_window_log', { message: 'eval-probe ' + JSON.stringify(out) }); } catch (e) {}
                })()"#;
                let _ = window.eval(probe);
            }
            None => log_line(&format!("selftest probe label={label} window missing")),
        }
    });
}
