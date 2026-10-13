//! 在低于支持基线的平台上拒绝启动，并给出**可见**的提示。
//!
//! Windows: 10 2004 (build 19041)+, x64, SSE4.2（= x86-64-v2 微架构等级）。
//! Linux x86_64: SSE4.2（x86-64-v2）。32 位内核无法加载本 ELF。
//!
//! ⚠️ 本模块的检查只有在**整个二进制都以不高于所检查特性的目标编译**时才有意义。
//! 若编译期把目标定到更高的微架构（曾用过 `target-cpu=x86-64-v3`，等价于强制 AVX2），
//! 编译器会在任意函数（含 Rust 运行时启动、内存拷贝、字符串处理）里直接发射 AVX2
//! 指令，进程可能在跑到本模块**之前**就因非法指令（Windows 异常码 0xC000001D）被
//! 系统终止；`windows_subsystem = "windows"` 下又没有控制台，用户看到的就是
//! 「双击毫无反应」——守卫在最需要它的机器上失效。
//!
//! 因此 `.cargo/config.toml` 的 `target-cpu` 与这里检查的特性**必须保持一致**
//! （现均为 x86-64-v2 / SSE4.2）。改动其一必须同步改另一个。

// 编译期硬约束：整个二进制**不得**以 AVX2 为目标编译。
//
// 缺少 AVX2 的 CPU（Intel Haswell 2013 之前，以及全部低端 Atom / Celeron / Pentium）
// 会在跑到本模块的检查之前，就因非法指令被系统终止 —— 守卫失效、用户只看到
// 「双击无反应」。把这条约束写死在编译期，是为了防止有人再把 `target-cpu` 调回
// `x86-64-v3`：那种改动会让本次修复悄悄失效，而问题只在低端机上复现、极难发现。
//
// 触发条件：`-C target-cpu=x86-64-v3`（或 `native` 且宿主机支持 AVX2）。
#[cfg(all(
    target_arch = "x86_64",
    not(target_os = "macos"),
    target_feature = "avx2"
))]
compile_error!(
    "禁止以 AVX2 为目标编译：缺少 AVX2 的低端 CPU 会在启动检查前因非法指令崩溃，\
表现为「双击毫无反应」。请保持 -C target-cpu=x86-64-v2（见 src-tauri/.cargo/config.toml）。"
);

pub fn assert_supported_platform() {
    #[cfg(all(target_arch = "x86_64", not(target_os = "macos")))]
    assert_x86_64_v2();

    #[cfg(windows)]
    assert_windows_version();
}

/// x86-64-v2 微架构等级：SSE3 / SSSE3 / SSE4.1 / SSE4.2 / POPCNT / CMPXCHG16B / LAHF-SAHF。
///
/// 用其中**引入最晚、最保守**的 SSE4.2 作代表特性做检测：Intel 自 2008 年 Nehalem、
/// AMD 自 2011 年 Bulldozer 起支持，覆盖能正常运行 Windows 10 的绝大多数 64 位机器
/// （含全部 Bay Trail / Apollo Lake / Gemini Lake 低端机型）。
#[cfg(all(target_arch = "x86_64", not(target_os = "macos")))]
fn assert_x86_64_v2() {
    if !is_x86_feature_detected!("sse4.2") {
        abort_unsupported(
            "青幕AI写作需要支持 SSE4.2 指令集的 64 位 CPU（Intel Nehalem 2008 年 / AMD Bulldozer 2011 年 或更新）。",
        );
    }
}

#[cfg(windows)]
const MIN_WINDOWS_BUILD: u32 = 19041;

#[cfg(windows)]
fn assert_windows_version() {
    if windows_build_number() < MIN_WINDOWS_BUILD {
        abort_unsupported("青幕AI写作需要 Windows 10 2004 (20H1) 或更高版本。");
    }
}

#[cfg(windows)]
fn windows_build_number() -> u32 {
    #[repr(C)]
    struct OsVersionInfoW {
        dw_os_version_info_size: u32,
        dw_major_version: u32,
        dw_minor_version: u32,
        dw_build_number: u32,
        dw_platform_id: u32,
        sz_csd_version: [u16; 128],
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(info: *mut OsVersionInfoW) -> i32;
    }

    let mut info = OsVersionInfoW {
        dw_os_version_info_size: std::mem::size_of::<OsVersionInfoW>() as u32,
        dw_major_version: 0,
        dw_minor_version: 0,
        dw_build_number: 0,
        dw_platform_id: 0,
        sz_csd_version: [0; 128],
    };
    // SAFETY: `info` is a well-formed OSVERSIONINFOW; RtlGetVersion only writes it.
    let status = unsafe { RtlGetVersion(&mut info) };
    if status < 0 {
        return 0;
    }
    info.dw_build_number
}

#[cfg(any(windows, all(target_arch = "x86_64", not(target_os = "macos"))))]
fn abort_unsupported(message: &str) -> ! {
    eprintln!("{message}");
    #[cfg(windows)]
    show_windows_error(message);
    std::process::exit(1);
}

#[cfg(windows)]
fn show_windows_error(message: &str) {
    use std::os::windows::ffi::OsStrExt;

    let text: Vec<u16> = std::ffi::OsStr::new(message)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let title: Vec<u16> = std::ffi::OsStr::new("青幕AI写作")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(
            hwnd: *mut core::ffi::c_void,
            text: *const u16,
            caption: *const u16,
            ty: u32,
        ) -> i32;
    }

    const MB_ICONERROR: u32 = 0x0000_0010;
    // SAFETY: `text` and `title` are NUL-terminated UTF-16 buffers that live for the call.
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            MB_ICONERROR,
        );
    }
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn windows_2004_floor_is_build_19041() {
        assert_eq!(super::MIN_WINDOWS_BUILD, 19041);
    }

    #[cfg(all(target_arch = "x86_64", not(target_os = "macos")))]
    #[test]
    fn host_ci_machines_have_x86_64_v2() {
        // 编译目标已降到 x86-64-v2；若连 CI 机器都不满足，说明基线又被人为抬高了。
        assert!(
            is_x86_feature_detected!("sse4.2") && is_x86_feature_detected!("popcnt"),
            "x86_64 Win/Linux builds assume x86-64-v2 (SSE4.2); this host cannot run the release binary"
        );
    }
}
