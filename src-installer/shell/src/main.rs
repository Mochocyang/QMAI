// 青幕AI写作 —— 安装器动效壳
//
// 职责只有三件：显示页面、拉起静默安装子进程、把进度文本交给页面。
// 所有界面逻辑都在 src-installer 的 HTML/JS 里，这里不做任何业务判断。
//
// 通信只用一条自定义协议 qmai://localhost，不额外引入 IPC 通道：
//   GET /index.html /app.js /bridge.js /protocol.js   静态资源（编译期嵌入）
//   GET /progress                                     进度文件原文
//   GET /cmd/start|abort|close|launch|classic         命令
// 这样页面里的 <script src="./app.js"> 与 fetch 走的是同一个来源，
// 不会出现"资源加载不到"或"跨源被拦"的问题。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    path::PathBuf,
    process::{Child, Command},
    sync::{Arc, Mutex},
};

use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::{Window, WindowBuilder},
};
use wry::{
    http::{header::CONTENT_TYPE, Response},
    WebViewBuilder,
};

/// 自定义事件：把"开始拖动窗口"从协议处理线程派发回事件循环主线程。
///
/// 为什么必须绕这一圈：标题栏拖动最终要调 tao 的 `drag_window()`，
/// 它内部走的是 GetCursorPos + ReleaseCapture + 系统移动循环，
/// 只能在创建窗口的那个线程（事件循环线程）上调用。
/// 而 `/cmd/drag` 来自 WebView2 的资源请求回调，线程归属不由我们决定，
/// 直接在那里调 tao 的窗口方法是未定义行为。
#[derive(Debug)]
enum UserEvent {
    StartDrag,
}

// 资源在编译期嵌进 exe：装机时只有这一个文件，不怕被杀毒软件拆包或路径丢失。
const ASSET_INDEX: &str = include_str!("../../index.html");
const ASSET_APP: &str = include_str!("../../app.js");
const ASSET_BRIDGE: &str = include_str!("../../bridge.js");
const ASSET_PROTOCOL: &str = include_str!("../../protocol.js");

/// CREATE_NO_WINDOW：子进程不要弹控制台黑框。
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct Args {
    installer: PathBuf,
    session: PathBuf,
    dir: String,
    main_exe: PathBuf,
    version: String,
}

struct Shared {
    args: Args,
    child: Option<Child>,
    /// 子进程退出码，仅记录一次
    exit: Option<i32>,
}

fn parse_args() -> Option<Args> {
    let mut installer = None;
    let mut session = None;
    let mut dir = None;
    let mut main_exe = None;
    let mut version = None;

    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i + 1 < argv.len() {
        let value = argv[i + 1].clone();
        match argv[i].as_str() {
            "--installer" => installer = Some(PathBuf::from(value)),
            "--session" => session = Some(PathBuf::from(value)),
            "--dir" => dir = Some(value),
            "--main" => main_exe = Some(PathBuf::from(value)),
            "--version" => version = Some(value),
            _ => {}
        }
        i += 2;
    }

    Some(Args {
        installer: installer?,
        session: session?,
        dir: dir?,
        main_exe: main_exe?,
        // 版本号缺失不算致命：页面会保留内置的占位版本。
        version: version.unwrap_or_default(),
    })
}

/// 把任意字符串转成安全的 JS 字面量。
/// 版本号来自命令行，虽然实际值可控，但直接拼进 JS 仍应转义。
fn js_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '<' => out.push_str("\\u003c"),
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

fn text_response(body: Vec<u8>, mime: &'static str) -> Response<Vec<u8>> {    Response::builder()
        .header(CONTENT_TYPE, mime)
        .header("Cache-Control", "no-store")
        .body(body)
        .unwrap()
}

/// 读进度文本，并顺带回收子进程。
///
/// 子进程是在页面每 200ms 请求 /progress 时顺带用 try_wait 回收的，
/// 不额外开线程：这条路径本来就会被高频调用，回收成本可以忽略。
///
/// 关键：安装失败时 NSIS 自己是写不出错误行的（它可能被直接杀掉），
/// 所以"没有 done 就退出"必须由壳补一条 err，否则界面会永远停在进度页。
fn read_progress(shared: &Arc<Mutex<Shared>>) -> String {
    let mut sh = match shared.lock() {
        Ok(v) => v,
        Err(_) => return String::new(),
    };

    if sh.exit.is_none() {
        let reaped = match sh.child.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(status)) => Some(status.code().unwrap_or(-1)),
                _ => None,
            },
            None => None,
        };
        if let Some(code) = reaped {
            sh.exit = Some(code);
        }
    }

    let file = sh.args.session.join("progress.txt");
    let mut text = std::fs::read_to_string(&file).unwrap_or_default();

    if let Some(code) = sh.exit {
        if !text.contains("done") && !text.contains("err|") {
            text.push_str(&format!(
                "err|E{code}|安装程序异常退出（代码 {code}），可查看日志或切回经典界面重试\r\n"
            ));
        }
    }

    text
}

/// 拼出静默安装子进程的参数表。
///
/// 抽成纯函数是为了能被单元测试直接断言：这条命令行一旦写错，
/// 表现是"点开始安装后进度永远 0%"，在真机上极难排查。
fn installer_args(session: &std::path::Path, dir: &str) -> Vec<String> {
    // /D= 必须是最后一个参数，且整段路径**不加引号** —— 这是 NSIS 的硬性规定。
    // 带空格的安装目录（%LOCALAPPDATA% 就带空格）加了引号会被当成路径的一部分，
    // 结果装到错误位置或直接失败。
    vec![
        "/S".to_string(),
        format!("/QM_SESSION={}", session.display()),
        format!("/D={dir}"),
    ]
}

fn spawn_installer(args: &Args) -> Option<Child> {
    let mut cmd = Command::new(&args.installer);
    cmd.args(installer_args(&args.session, &args.dir))
        .creation_flags_win();
    cmd.spawn().ok()
}

fn spawn_detached(exe: &PathBuf) -> bool {
    let mut cmd = Command::new(exe);
    cmd.creation_flags_win();
    cmd.spawn().is_ok()
}

/// std 的 creation_flags 需要显式引入 trait，包一层免得每处都写 use。
trait CreationFlags {
    fn creation_flags_win(&mut self) -> &mut Self;
}

impl CreationFlags for Command {
    fn creation_flags_win(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

/// 注入宿主对象。页面里的 bridge.js 只认这个契约，
/// 认不到就退回演示桥（会假装安装），所以这段必须和 bridge.js 的字段一一对应。
///
/// 路径必须写成**相对路径**，不能写 qmai://localhost/progress：
/// wry 在 Windows 上会把 qmai://localhost/index.html 重写成
/// http://qmai.localhost/index.html（见 wry 的 custom_protocol_workaround），
/// 文档源随之变成 http://qmai.localhost。此时用绝对 qmai:// 发起 fetch
/// 属于跨源 scheme 请求，会被直接拒绝 —— 实测表现是进度永远停在 0%、
/// 点「开始安装」毫无反应。相对路径经同一源重写后才会被协议处理器接住。
const HOST_SCRIPT: &str = r#"
(function () {
  function cmd(name) {
    return fetch('/cmd/' + name)
      .then(function (r) { return r.text(); })
      .catch(function () { return ''; });
  }
  window.__QMAI_SETUP_HOST__ = {
    readProgress: function () {
      return fetch('/progress')
        .then(function (r) { return r.text(); })
        .catch(function () { return ''; });
    },
    start: function () { return cmd('start'); },
    cancel: function () { return cmd('close'); },
    close: function () { return cmd('close'); },
    abort: function () { return cmd('abort'); },
    retry: function () { return cmd('start'); },
    launch: function () { return cmd('launch'); },
    openLog: function () { return cmd('log'); },
    useClassic: function () { return cmd('classic'); },
    drag: function () { return cmd('drag'); }
  };
})();
"#;

/// 让客户区铺满整个窗口，彻底消掉四周那圈边框。
///
/// 实测数据：`with_decorations(false)` 之后窗口 960x600，客户区只有 944x591，
/// 客户区从窗口内 (8,1) 开始 —— 顶部 1px、左右各 8px、底部 8px 都是非客户区。
/// 8px 正好等于 SM_CXSIZEFRAME(4)+SM_CXPADDEDBORDER(4)，即系统按"可缩放边框"
/// 算出来的尺寸。
///
/// 试过只清样式位（CAPTION/THICKFRAME/BORDER/DLGFRAME，甚至加 WS_POPUP），
/// 客户区**依然**是 944x591 —— 因为客户区尺寸是 WM_NCCALCSIZE 时刻算出来的，
/// 样式改了也要等下一次重新计算，而 tao 在尺寸变化时会按自己的窗口标志
/// 重新套用样式，改动会被覆盖。
///
/// 所以这里直接接管窗口过程，对 WM_NCCALCSIZE（wParam=1）返回 0，
/// 告诉系统"整个窗口都是客户区"。这是无边框窗口的标准做法，
/// 且不依赖样式位，tao 之后再怎么改样式都不影响。
#[cfg(windows)]
fn strip_window_frame(window: &Window) {
    use std::sync::atomic::{AtomicIsize, Ordering};
    use tao::platform::windows::WindowExtWindows;

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
        fn CallWindowProcW(
            prev: isize,
            hwnd: isize,
            msg: u32,
            wparam: usize,
            lparam: isize,
        ) -> isize;
        fn SetWindowPos(
            hwnd: isize,
            insert_after: isize,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
    }

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(hwnd: isize, attr: u32, value: *const i32, size: u32) -> i32;
    }

    const GWLP_WNDPROC: i32 = -4;
    const WM_NCCALCSIZE: u32 = 0x0083;

    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_FRAMECHANGED: u32 = 0x0020;

    /// 原窗口过程。进程内只有一个窗口，用静态变量存即可。
    static PREV_WNDPROC: AtomicIsize = AtomicIsize::new(0);

    extern "system" fn qmai_wndproc(
        hwnd: isize,
        msg: u32,
        wparam: usize,
        lparam: isize,
    ) -> isize {
        // wParam=1 表示"请给出客户区矩形"。返回 0 = 客户区就是整个窗口。
        // 其余消息（含 wParam=0）全部交回原过程，避免影响 tao 自身的逻辑。
        if msg == WM_NCCALCSIZE && wparam != 0 {
            return 0;
        }
        let prev = PREV_WNDPROC.load(Ordering::Relaxed);
        unsafe { CallWindowProcW(prev, hwnd, msg, wparam, lparam) }
    }

    let hwnd = window.hwnd();
    // 先记下接管前的客户区尺寸，也就是设计尺寸（960x600 物理像素）。
    // 接管后客户区=整个窗口，按这个尺寸重设，窗口才正好是 960x600 而不多出 16x9。
    let size = window.inner_size();
    unsafe {
        let proc_addr = qmai_wndproc as *const () as isize;
        let prev = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, proc_addr);
        PREV_WNDPROC.store(prev, Ordering::Relaxed);
        // 立刻触发一次重新计算，让新规则当场生效，并把窗口收成设计尺寸。
        SetWindowPos(
            hwnd,
            0,
            0,
            0,
            size.width as i32,
            size.height as i32,
            SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
        // Windows 11 的桌面窗口管理器会给每个窗口再描一圈 1px 边框。
        // 这一圈由合成器绘制，不在客户区内，WM_NCCALCSIZE 拦不住，
        // PrintWindow 也抓不到（所以只看自绘截图会误判为"已经没有边框"）。
        // DWMWA_BORDER_COLOR = 34，DWMWA_COLOR_NONE = 0xFFFFFFFE 表示不画。
        let none: i32 = 0xFFFF_FFFEu32 as i32;
        let _ = DwmSetWindowAttribute(hwnd, 34, &none, 4);
    }
}

/// 给窗口设置任务栏图标。
///
/// 实测：不设的时候窗口根本没有图标句柄（WM_GETICON 与类图标都返回 0），
/// 任务栏就只能画一个系统默认的空白方块。
///
/// 图标本身已经由 build.rs 通过 qmai-shell.rc 编进 exe 的资源段（资源 ID = 1），
/// 所以这里直接从自己的模块里把它加载出来，再挂到窗口上——不需要在
/// Rust 里再存一份像素数据，图标换图只要换 .ico 重新编译即可。
#[cfg(windows)]
fn set_window_icon(window: &Window) {
    use tao::platform::windows::WindowExtWindows;

    #[link(name = "user32")]
    extern "system" {
        fn LoadImageW(
            instance: isize,
            name: *const u16,
            kind: u32,
            cx: i32,
            cy: i32,
            load: u32,
        ) -> isize;
        fn SendMessageW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(name: *const u16) -> isize;
    }

    const IMAGE_ICON: u32 = 1;
    // 让系统按当前 DPI 取最合适的尺寸，别写死 32x32。
    const LR_DEFAULTSIZE: u32 = 0x0000_0040;
    const LR_SHARED: u32 = 0x0000_8000;
    const WM_SETICON: u32 = 0x0080;
    const ICON_BIG: usize = 1;
    const ICON_SMALL: usize = 0;
    /// qmai-shell.rc 里定义的图标资源 ID
    const ICON_RESOURCE_ID: usize = 1;

    let hwnd = window.hwnd();
    unsafe {
        // 关键：LoadImage 的第一个参数必须是本进程的模块句柄。
        // 传 0 会被当成"从外部文件加载"，资源 ID 找不到，图标就是空的。
        let module = GetModuleHandleW(std::ptr::null());
        // MAKEINTRESOURCE：把小的整数 ID 直接当指针传。
        let name = ICON_RESOURCE_ID as *const u16;
        for (which, size) in [(ICON_BIG, 0), (ICON_SMALL, 0)] {
            let hicon = LoadImageW(
                module,
                name,
                IMAGE_ICON,
                size,
                size,
                LR_DEFAULTSIZE | LR_SHARED,
            );
            if hicon != 0 {
                SendMessageW(hwnd, WM_SETICON, which, hicon);
            }
        }
    }
}

fn main() -> wry::Result<()> {
    let args = match parse_args() {
        Some(a) => a,
        None => {
            // 参数不全说明不是被安装包拉起的，直接退出，不显示空窗口。
            std::process::exit(2);
        }
    };

    // 会话目录由 NSIS 建好；这里兜一层，防止单独调试时不存在。
    let _ = std::fs::create_dir_all(&args.session);

    let shared = Arc::new(Mutex::new(Shared {
        args,
        child: None,
        exit: None,
    }));

    // 版本号与安装目录都由安装包传进来，避免页面里写死一个发版就过期、
    // 或与真实安装位置不符的值。
    let (version, dir) = {
        let sh = shared.lock().unwrap();
        (sh.args.version.clone(), sh.args.dir.clone())
    };
    let mut init_script = String::from(HOST_SCRIPT);
    if !version.is_empty() {
        init_script.push_str(&format!(
            "\nwindow.__QMAI_SETUP_VERSION__ = {};",
            js_string(&version)
        ));
    }
    if !dir.is_empty() {
        init_script.push_str(&format!(
            "\nwindow.__QMAI_SETUP_DIR__ = {};",
            js_string(&dir)
        ));
    }

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title("青幕AI写作 安装程序")
        .with_inner_size(LogicalSize::new(960.0, 600.0))
        .with_resizable(false)
        .with_maximizable(false)
        .with_decorations(false)
        .build(&event_loop)
        .expect("创建窗口失败");

    // 必须在建 webview 之前剥掉边框，让客户区尺寸先稳定下来，
    // 否则 webview 会按旧客户区排版，再缩一次窗口就要重排。
    #[cfg(windows)]
    strip_window_frame(&window);
    // 任务栏图标：不设的话任务栏只会画一个系统默认的空白方块。
    #[cfg(windows)]
    set_window_icon(&window);

    let handler_state = Arc::clone(&shared);
    let webview = WebViewBuilder::new()
        .with_custom_protocol(
            "qmai".into(),
            move |_id, request| {
                let path = request.uri().path().to_string();
                let response = match path.as_str() {
                    "/" | "/index.html" => {
                        text_response(ASSET_INDEX.as_bytes().to_vec(), "text/html")
                    }
                    "/app.js" => text_response(ASSET_APP.as_bytes().to_vec(), "text/javascript"),
                    "/bridge.js" => {
                        text_response(ASSET_BRIDGE.as_bytes().to_vec(), "text/javascript")
                    }
                    "/protocol.js" => {
                        text_response(ASSET_PROTOCOL.as_bytes().to_vec(), "text/javascript")
                    }
                    "/progress" => {
                        text_response(read_progress(&handler_state).into_bytes(), "text/plain")
                    }
                    "/cmd/start" => {
                        let mut sh = handler_state.lock().unwrap();
                        // 重试时必须先回收上一次的子进程，否则 child 仍是 Some，
                        // 新的安装会被直接跳过（表现：点重试没有任何反应）。
                        if sh.child.is_some() {
                            let finished = match sh.child.as_mut() {
                                Some(child) => matches!(child.try_wait(), Ok(Some(_))),
                                None => true,
                            };
                            if finished {
                                sh.child = None;
                                sh.exit = None;
                            }
                        }
                        if sh.child.is_none() {
                            sh.exit = None;
                            if let Some(child) = spawn_installer(&sh.args) {
                                sh.child = Some(child);
                            }
                        }
                        text_response(b"ok".to_vec(), "text/plain")
                    }
                    "/cmd/abort" => {
                        let mut sh = handler_state.lock().unwrap();
                        if let Some(child) = sh.child.as_mut() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                        sh.child = None;
                        text_response(b"ok".to_vec(), "text/plain")
                    }
                    "/cmd/log" => {
                        let session = {
                            let sh = handler_state.lock().unwrap();
                            sh.args.session.clone()
                        };
                        let mut cmd = Command::new("explorer.exe");
                        cmd.arg(&session).creation_flags_win();
                        let _ = cmd.spawn();
                        text_response(b"ok".to_vec(), "text/plain")
                    }
                    "/cmd/launch" => {
                        let exe = {
                            let sh = handler_state.lock().unwrap();
                            sh.args.main_exe.clone()
                        };
                        spawn_detached(&exe);
                        std::process::exit(0);
                    }
                    "/cmd/classic" => {
                        // 切回经典界面：不带 /S 重新拉起安装包，本壳退出。
                        let installer = {
                            let sh = handler_state.lock().unwrap();
                            sh.args.installer.clone()
                        };
                        spawn_detached(&installer);
                        std::process::exit(0);
                    }
                    "/cmd/close" => std::process::exit(0),
                    // 标题栏拖动：转交给事件循环线程处理，见 UserEvent::StartDrag 的说明
                    "/cmd/drag" => {
                        let _ = proxy.send_event(UserEvent::StartDrag);
                        text_response(b"ok".to_vec(), "text/plain")
                    }
                    _ => Response::builder()
                        .status(404)
                        .body(b"not found".to_vec())
                        .unwrap(),
                };
                response.map(Into::into)
            },
        )
        .with_initialization_script(init_script)
        .with_url("qmai://localhost/index.html")
        .build(&window)?;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                *control_flow = ControlFlow::Exit;
            }
            // 在事件循环线程上调用，tao 的 drag_window 才有正确的线程上下文。
            // 它会接管鼠标直到用户松开左键（系统移动循环），期间界面冻结属正常。
            Event::UserEvent(UserEvent::StartDrag) => {
                let _ = window.drag_window();
            }
            _ => {}
        }
        // 让 webview 活到事件循环结束；提前 drop 会把窗口内容清空。
        let _ = &webview;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shared(session: &std::path::Path, exit: Option<i32>) -> Arc<Mutex<Shared>> {
        Arc::new(Mutex::new(Shared {
            args: Args {
                installer: PathBuf::from("setup.exe"),
                session: session.to_path_buf(),
                dir: "C:\\tmp\\app".to_string(),
                main_exe: PathBuf::from("app.exe"),
                version: "1.0.0".to_string(),
            },
            child: None,
            exit,
        }))
    }

    fn temp_session(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("qmai-shell-test-{tag}"));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// 安装段正常写完 done 时，壳不能自作主张再补错误行。
    #[test]
    fn done_is_left_untouched() {
        let dir = temp_session("done");
        std::fs::write(dir.join("progress.txt"), "50|1||\r\ndone\r\n").unwrap();
        let text = read_progress(&shared(&dir, Some(0)));
        assert!(text.contains("done"));
        assert!(!text.contains("err|"), "已成功时不应注入错误行: {text}");
    }

    /// 子进程失败退出且没写终止行时，必须补一条 err，
    /// 否则界面会永远停在进度页（这是最难被用户理解的失败形态）。
    #[test]
    fn failure_injects_error_line() {
        let dir = temp_session("fail");
        std::fs::write(dir.join("progress.txt"), "50|1||\r\n").unwrap();
        let text = read_progress(&shared(&dir, Some(3)));
        assert!(text.contains("err|E3|"), "应注入错误行，实际: {text}");
    }

    /// 已经写过 err 时不要重复注入。
    #[test]
    fn existing_error_is_not_duplicated() {
        let dir = temp_session("dup");
        std::fs::write(dir.join("progress.txt"), "err|E499|用户中止安装\r\n").unwrap();
        let text = read_progress(&shared(&dir, Some(1)));
        assert_eq!(text.matches("err|").count(), 1, "错误行被重复注入: {text}");
    }

    /// 进度文件还没生成时返回空串而不是崩溃。
    #[test]
    fn missing_file_is_empty() {
        let dir = temp_session("missing");
        let text = read_progress(&shared(&dir, None));
        assert!(text.is_empty());
    }

    #[test]
    fn version_is_escaped_for_js() {
        assert_eq!(js_string("4.3.7"), "\"4.3.7\"");
        assert_eq!(js_string("a\"b"), "\"a\\\"b\"");
        assert_eq!(js_string("</script>"), "\"\\u003c/script>\"");
    }

    /// /D= 必须原样传递、不带引号、且排在最后。写错这三条里的任意一条，
    /// 真机表现都是"安装静默跑去了错误目录"或"点了开始安装毫无反应"。
    #[test]
    fn installer_args_follow_nsis_rules() {
        let session = std::path::Path::new("C:\\Users\\me\\AppData\\Local\\Temp\\qmai-setup\\session");
        let args = installer_args(session, "C:\\Users\\me\\AppData\\Local\\QMaiWrite");

        assert_eq!(args[0], "/S");
        assert_eq!(
            args[1],
            "/QM_SESSION=C:\\Users\\me\\AppData\\Local\\Temp\\qmai-setup\\session"
        );

        // 最后一个是 /D=，且整段没有引号
        let last = args.last().unwrap();
        assert!(last.starts_with("/D="), "最后一个参数必须是 /D=，实际: {last}");
        assert!(
            !last.contains('"'),
            "/D= 的值不能带引号，否则 NSIS 会把引号当成路径的一部分: {last}"
        );
        assert_eq!(
            last,
            "/D=C:\\Users\\me\\AppData\\Local\\QMaiWrite",
            "带空格的路径必须原样保留"
        );

        assert_eq!(args.len(), 3, "参数个数变了就要重新核对 NSIS 的命令行约定");
    }
}
