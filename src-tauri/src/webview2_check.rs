//! 启动前确认 WebView2 运行时可用；缺失时用中文提示，并引导用户安装。
//!
//! ── 为什么需要这一层 ──
//! Tauri 用的是系统 WebView2，而不是自带内核。缺失时的默认表现是
//! 「双击没反应 / 白屏 / 一闪而过」：wry 建窗失败只走 `log::error!`，
//! 而 `windows_subsystem = "windows"` 下没有控制台，用户什么都看不到。
//! 安装器已经会在安装阶段补装（见 `windows/_tauri-installer-template.nsi`
//! 的 `EnsureWebView2`），但下面两条路径绕过了安装器，必须在程序里兜底：
//!   ① 自动更新：更新流程会跳过安装器的常规页面；
//!   ② 便携版：根本没有安装器。
//!
//! ── 放在哪个阶段 ──
//! 由 `main` 在 `qmai::run()` 之前调用，即 `tauri::Builder::build()` 之前。
//! 一旦 Builder 开始建窗，缺失就会在 wry 内部变成难以定位的失败，
//! 所以必须在建窗之前拦截。
//!
//! ── 为什么不用额外依赖 ──
//! 检测走注册表 `pv` 值（与安装器、微软文档同一处），弹窗走 `MessageBoxW`，
//! 两者都在已有的 `windows-sys` 依赖里，不新增下载与链接面积。
//!
//! ── 装完之后怎么办 ──
//! 重新执行当前 exe 并退出本进程。`process::Command` 生成的是**独立**子进程，
//! 父进程退出不会带走它。

/// 检测 + 中文提示 + 引导安装。
///
/// 返回 `false` 表示「本次启动应终止」：用户选择退出、或安装后仍需重启、
/// 或安装失败（已打开官方下载页）。返回 `true` 表示运行时可用，可以继续启动。
#[cfg(windows)]
pub fn ensure_webview2_or_guide() -> bool {
    if webview2_version().is_some() {
        return true;
    }

    // 按钮语义：是 = 现在自动安装；否 = 我自己装（打开官方页面）；取消 = 退出程序。
    let choice = show_message_box(
        "青幕AI写作需要「Microsoft Edge WebView2 运行时」才能显示界面，但本机还没有安装。\n\
         \n\
         现在自动安装？（约 2 MB，需要联网，通常 1 分钟内完成）\n\
         \n\
         · 点「是」：自动下载并安装，完成后会自动重新打开软件\n\
         · 点「否」：打开微软官方下载页面，自行安装后重新打开软件\n\
         · 点「取消」：退出软件",
        MB_YESNOCANCEL | MB_ICONWARNING,
    );

    match choice {
        IDYES => {
            match install_via_bootstrapper() {
                Ok(()) => {}
                Err(reason) => {
                    show_message_box(
                        &format!(
                            "自动安装 WebView2 失败：{reason}\n\
                             \n\
                             将为你打开微软官方下载页面，请手动下载并安装「Evergreen Standalone Installer」，\
                             安装完成后重新打开青幕AI写作。"
                        ),
                        MB_OK | MB_ICONERROR,
                    );
                    open_official_page();
                    return false;
                }
            }

            // 安装器可能退出码为 0 却没真正装上（无网 / 被策略拦截），必须复检。
            if webview2_version().is_some() {
                relaunch_self();
                return false;
            }

            show_message_box(
                "WebView2 运行时似乎仍未安装成功。\n\
                 \n\
                 将为你打开微软官方下载页面，请手动安装后重新打开青幕AI写作。",
                MB_OK | MB_ICONERROR,
            );
            open_official_page();
            false
        }
        IDNO => {
            open_official_page();
            false
        }
        _ => false,
    }
}

#[cfg(windows)]
fn webview2_version() -> Option<String> {
    // 与安装器、微软文档一致的三条路径：
    //   系统级 64 位视图（WOW6432Node）、系统级 32 位视图、当前用户（perUser 安装）。
    // 只看 HKLM 会在"当前用户版运行时"上误判为缺失；只看 HKCU 会漏掉绝大多数机器。
    const KEY: &str = r"Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    for (root, path) in [
        (HKEY_LOCAL_MACHINE, format!(r"SOFTWARE\WOW6432Node\{KEY}")),
        (HKEY_LOCAL_MACHINE, format!(r"SOFTWARE\{KEY}")),
        (HKEY_CURRENT_USER, format!(r"Software\{KEY}")),
    ] {
        if let Some(version) = read_pv(root, &path) {
            return Some(version);
        }
    }
    None
}

#[cfg(windows)]
fn read_pv(root: HKEY, subkey: &str) -> Option<String> {
    let subkey_w: Vec<u16> = subkey.encode_utf16().chain(std::iter::once(0)).collect();
    let value_w: Vec<u16> = "pv".encode_utf16().chain(std::iter::once(0)).collect();

    // SAFETY: 指针均指向调用期间存活的缓冲区；`key` 只在打开成功后使用并保证关闭。
    unsafe {
        let mut key = std::mem::zeroed();
        if RegOpenKeyExW(root, subkey_w.as_ptr(), 0, KEY_READ, &mut key) != NO_ERROR {
            return None;
        }

        let mut size = 0u32;
        let mut kind = 0u32;
        // 第一次调用只取长度（数据指针传 null）。
        let status = RegQueryValueExW(key, value_w.as_ptr(), std::ptr::null(), &mut kind, std::ptr::null_mut(), &mut size);
        if status != NO_ERROR || size == 0 || kind != REG_SZ {
            RegCloseKey(key);
            return None;
        }

        let mut buffer = vec![0u8; size as usize];
        let status = RegQueryValueExW(
            key,
            value_w.as_ptr(),
            std::ptr::null(),
            &mut kind,
            buffer.as_mut_ptr(),
            &mut size,
        );
        RegCloseKey(key);
        if status != NO_ERROR {
            return None;
        }

        // REG_SZ 是 UTF-16LE，通常以 NUL 结尾。
        let mut units: Vec<u16> = buffer
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        while units.last() == Some(&0) {
            units.pop();
        }
        if units.is_empty() {
            return None;
        }
        Some(String::from_utf16_lossy(&units))
    }
}

#[cfg(windows)]
fn install_via_bootstrapper() -> Result<(), String> {
    // 微软官方 Evergreen Bootstrapper（约 1.8 MB），运行时会下载并安装最新运行时。
    const BOOTSTRAPPER_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

    let setup = std::env::temp_dir().join("MicrosoftEdgeWebview2Setup.exe");
    download(BOOTSTRAPPER_URL, &setup)?;

    // `/silent /install`：微软官方无交互参数。
    let status = std::process::Command::new(&setup)
        .args(["/silent", "/install"])
        .status()
        .map_err(|error| format!("启动安装程序失败：{error}"))?;
    let _ = std::fs::remove_file(&setup);

    if !status.success() {
        return Err(format!("安装程序退出码 {}", status.code().unwrap_or(-1)));
    }
    Ok(())
}

#[cfg(windows)]
fn download(url: &str, target: &std::path::Path) -> Result<(), String> {
    // 只要一个 2 MB 的文件，不接入应用自己的代理设置：那些设置在 setup 阶段
    // 才读取，而本函数运行在 Builder 之前。reqwest 默认会走系统代理。
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|error| format!("初始化下载器失败：{error}"))?;
    let bytes = client
        .get(url)
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.bytes())
        .map_err(|error| format!("下载失败（请检查网络）：{error}"))?;
    // 引导器约 1.8 MB；明显偏小说明拿到的是错误页。
    if bytes.len() < 512 * 1024 {
        return Err(format!("下载内容异常（{} 字节）", bytes.len()));
    }
    std::fs::write(target, &bytes).map_err(|error| format!("写入临时文件失败：{error}"))
}

#[cfg(windows)]
fn open_official_page() {
    // ShellExecuteW 与安装器的 `ExecShell "open"` 等价。打不开页面不影响后续退出，
    // 因此忽略返回值。
    const PAGE: &str = "https://developer.microsoft.com/zh-cn/microsoft-edge/webview2/";
    let operation: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
    let file: Vec<u16> = PAGE.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: 两个缓冲区在调用期间存活且以 NUL 结尾。
    unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        );
    }
}

#[cfg(windows)]
fn relaunch_self() {
    if let Ok(exe) = std::env::current_exe() {
        if std::process::Command::new(exe).spawn().is_ok() {
            return;
        }
    }
    // 拉不起来就退化成提示，让用户手动重开，而不是静默退出。
    show_message_box(
        "WebView2 运行时已安装完成，请重新打开青幕AI写作。",
        MB_OK | MB_ICONINFORMATION,
    );
}

#[cfg(windows)]
fn show_message_box(message: &str, flags: u32) -> i32 {
    let text: Vec<u16> = message.encode_utf16().chain(std::iter::once(0)).collect();
    let title: Vec<u16> = "青幕AI写作"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: 两个文本缓冲区在调用期间存活且以 NUL 结尾。
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            flags | MB_DEFBUTTON2 | MB_SETFOREGROUND,
        )
    }
}

#[cfg(windows)]
use windows_sys::Win32::Foundation::NO_ERROR;
#[cfg(windows)]
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE,
    KEY_READ, REG_SZ,
};
#[cfg(windows)]
use windows_sys::Win32::UI::Shell::ShellExecuteW;
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, MB_DEFBUTTON2, MB_ICONERROR, MB_ICONINFORMATION, MB_ICONWARNING, MB_OK,
    MB_SETFOREGROUND, MB_YESNOCANCEL, SW_SHOWNORMAL,
};

#[cfg(windows)]
const IDYES: i32 = 6;
#[cfg(windows)]
const IDNO: i32 = 7;
