//! Refuse to start on platforms below the published support floor.
//!
//! Windows: 10 2004 (build 19041)+, x64, AVX2.
//! Linux x86_64: AVX2. 32-bit kernels cannot load the shipped ELF.

pub fn assert_supported_platform() {
    #[cfg(all(target_arch = "x86_64", not(target_os = "macos")))]
    assert_avx2();

    #[cfg(windows)]
    assert_windows_version();
}

#[cfg(all(target_arch = "x86_64", not(target_os = "macos")))]
fn assert_avx2() {
    if !is_x86_feature_detected!("avx2") {
        abort_unsupported(
            "青幕AI写作需要支持 AVX2 的 64 位 CPU（Intel Haswell / AMD Excavator 或更新）。",
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
    fn host_ci_machines_have_avx2() {
        assert!(
            is_x86_feature_detected!("avx2"),
            "x86_64 Win/Linux builds assume AVX2; this host cannot run the release binary"
        );
    }
}
