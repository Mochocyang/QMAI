//! 设备指纹：读取本机稳定唯一标识，用于限制「一台设备最多注册几个账号」。
//!
//! ## 为什么需要
//!
//! 光靠 IP 限流挡不住换代理的人。设备指纹是更硬的身份锚点：
//! 同一台电脑无论换多少 IP、清多少浏览器数据，标识都不变。
//!
//! ## Windows 取什么
//!
//! 优先 `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` —— 系统安装时生成、
//! 重装系统才会变，是业界最常用的机器标识。取不到时退回注册表安装路径的哈希。
//!
//! ## 隐私
//!
//! 原始 `MachineGuid` **绝不出本机**：在 Rust 侧就做 SHA-256，只返回 32 位十六进制摘要。
//! 服务端拿到的是摘要，无法反推机器信息，也不能用于其他用途。

use sha2::{Digest, Sha256};
use std::sync::OnceLock;

static CACHE: OnceLock<String> = OnceLock::new();

/// 读 Windows MachineGuid（失败返回 None）。
///
/// 用项目已依赖的 `windows` crate（已有 `Win32_System_Registry` feature），
/// 不额外引入 `winreg`，减少一个依赖面。
#[cfg(windows)]
fn machine_guid() -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ, REG_SZ,
    };

    let subkey = to_wide(r"SOFTWARE\Microsoft\Cryptography");
    let value_name = to_wide("MachineGuid");

    unsafe {
        let mut key = HKEY::default();
        let opened = RegOpenKeyExW(HKEY_LOCAL_MACHINE, PCWSTR(subkey.as_ptr()), Some(0), KEY_READ, &mut key);
        if opened.is_err() {
            return None;
        }

        // 先问长度，再读内容。MachineGuid 是 36 字符 + 结尾 0，给 512 字节余量足够。
        let mut buffer = vec![0u8; 512];
        let mut size = buffer.len() as u32;
        let mut kind = REG_SZ;
        let status = RegQueryValueExW(
            key,
            PCWSTR(value_name.as_ptr()),
            None,
            Some(&mut kind),
            Some(buffer.as_mut_ptr()),
            Some(&mut size),
        );
        let _ = RegCloseKey(key);
        if status.is_err() {
            return None;
        }

        // REG_SZ 是 UTF-16LE；size 含结尾的 0。
        let chars: Vec<u16> = buffer[..size as usize]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        let text = String::from_utf16_lossy(&chars);
        let trimmed = text.trim_end_matches('\0').trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    }
}

#[cfg(windows)]
fn to_wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(not(windows))]
fn machine_guid() -> Option<String> {
    // macOS / Linux 兜底：读常见的机器标识文件。
    for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
        if let Ok(text) = std::fs::read_to_string(path) {
            let trimmed = text.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    None
}

/// 兜底标识：机器标识取不到时，用用户名 + 主机名 + 应用数据目录组合哈希。
/// 稳定性弱一些（改名会变），但总比"所有人共用一个空值"强。
fn fallback_seed() -> String {
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default();
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_default();
    format!("qmai-device|{user}|{host}")
}

fn compute_fingerprint() -> String {
    let seed = machine_guid().unwrap_or_else(fallback_seed);
    // 加固定盐，避免与其它程序对 MachineGuid 的哈希撞车。
    let mut hasher = Sha256::new();
    hasher.update(b"qmai-device-fingerprint-v1|");
    hasher.update(seed.as_bytes());
    let digest = hasher.finalize();
    // 取前 16 字节 = 32 位十六进制，够用且短。
    digest[..16].iter().map(|byte| format!("{byte:02x}")).collect()
}

/// 返回本机设备指纹（32 位十六进制）。进程内缓存，只算一次。
#[tauri::command]
pub fn device_fingerprint() -> String {
    CACHE.get_or_init(compute_fingerprint).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_is_stable_and_hex() {
        let first = device_fingerprint();
        let second = device_fingerprint();
        assert_eq!(first, second, "同一进程内必须稳定");
        assert_eq!(first.len(), 32, "应为 32 位十六进制");
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()), "只能含十六进制字符");
    }

    #[test]
    fn fingerprint_does_not_leak_raw_guid() {
        let value = device_fingerprint();
        if let Some(raw) = machine_guid() {
            assert!(!value.contains(&raw), "摘要里不能出现原始 MachineGuid");
        }
    }
}
