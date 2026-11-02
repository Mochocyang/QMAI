//! 「记住密码」用的系统级凭据存储。
//!
//! ── 为什么不用 localStorage / 配置文件 ──
//!
//! 密码是要长期保存的高敏感数据。明文或可逆加密存在应用目录里，等于
//! 「拿到这台电脑的人就能读到明文密码」——本地加密的密钥也在本机，
//! 只是把门槛从「打开文件」提高到「打开文件 + 找到密钥」，本质上不防本机访问。
//!
//! ── 用 Windows DPAPI ──
//!
//! `CryptProtectData` / `CryptUnprotectData` 把数据绑定到**当前 Windows 用户账户**：
//!   · 密文只能被同一个用户在同一台机器上解密；
//!   · 密钥由系统保管，应用自己拿不到，也无法导出；
//!   · 换个用户登录 Windows、或把文件拷到别的机器，都解不开。
//!
//! 这不是「绝对安全」——能登进当前 Windows 会话的进程仍可调用解密。
//! 但对「防止密码泄漏到磁盘明文、防止被其他用户读走」这个目标是恰当的方案，
//! 也是 Windows 上密码管理器普遍采用的机制。
//!
//! ── 参数与失败处理 ──
//!
//! `CRYPTPROTECT_UI_FORBIDDEN`：后台静默调用，不弹任何系统对话框。
//! 解密失败（换机器 / 换用户 / 数据损坏）一律返回错误让前端静默降级，
//! 前端据此当作「没记住密码」，而不是把错误甩给用户。

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// 凭据文件名（放在应用数据目录下，内容为 DPAPI 密文的 base64）。
const CREDENTIAL_FILE: &str = "account-credential.bin";

#[cfg(windows)]
mod dpapi {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB, CryptProtectData, CryptUnprotectData,
    };
    use windows::core::PCWSTR;

    /// DPAPI 的「附加熵」：给本应用单独加一道区分。
    ///
    /// 作用是把密文绑定到本应用语义上——其它程序即便以同一用户身份调用 DPAPI，
    /// 没有这串熵也解不开我们写的数据。它不是秘密（就写在代码里），
    /// 但足以挡住「通用 DPAPI 解密工具一把梭」的情况。
    const ENTROPY_TEXT: &str = "qmai.account.credential.v1";

    fn blob_from(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_ptr() as *mut u8,
        }
    }

    pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
        let entropy = ENTROPY_TEXT.as_bytes();
        let mut out = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptProtectData(
                &blob_from(plain),
                PCWSTR::null(),
                Some(&blob_from(entropy)),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
            .map_err(|error| format!("加密凭据失败：{error}"))?;
        }
        if out.pbData.is_null() || out.cbData == 0 {
            return Err("加密凭据失败：返回空数据".into());
        }
        // 系统分配的输出缓冲必须用 LocalFree 释放，否则这块内存会泄漏。
        let result = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize) }.to_vec();
        unsafe {
            let _ = LocalFree(Some(HLOCAL(out.pbData as *mut core::ffi::c_void)));
        }
        Ok(result)
    }

    pub fn unprotect(cipher: &[u8]) -> Result<Vec<u8>, String> {
        let entropy = ENTROPY_TEXT.as_bytes();
        let mut out = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptUnprotectData(
                &blob_from(cipher),
                None,
                Some(&blob_from(entropy)),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
            .map_err(|error| format!("解密凭据失败：{error}"))?;
        }
        if out.pbData.is_null() || out.cbData == 0 {
            return Err("解密凭据失败：返回空数据".into());
        }
        let result = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize) }.to_vec();
        unsafe {
            let _ = LocalFree(Some(HLOCAL(out.pbData as *mut core::ffi::c_void)));
        }
        Ok(result)
    }
}

/// 非 Windows 平台：明确降级，不做假的「已保存」。
///
/// 前端会拿到错误并当作「未记住密码」处理；这样用户在 macOS 上不会以为
/// 密码被安全保存了，实际却没有。
#[cfg(not(windows))]
mod dpapi {
    pub fn protect(_plain: &[u8]) -> Result<Vec<u8>, String> {
        Err("当前平台暂不支持安全保存密码".into())
    }

    pub fn unprotect(_cipher: &[u8]) -> Result<Vec<u8>, String> {
        Err("当前平台暂不支持安全保存密码".into())
    }
}

fn credential_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    Ok(dir.join(CREDENTIAL_FILE))
}

/// 极简 base64（标准字母表，带 `=` 填充）。
///
/// 不引第三方 crate 只为编码一段二进制：凭据体积很小，这段代码够用且可读。
/// 为什么要转 base64：密文可能含任意字节，直接写进 JSON 会破坏转义。
fn to_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3f) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((triple >> 6) & 0x3f) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(triple & 0x3f) as usize] as char } else { '=' });
    }
    out
}

fn from_base64(text: &str) -> Result<Vec<u8>, String> {
    fn value(c: u8) -> Result<u32, String> {
        match c {
            b'A'..=b'Z' => Ok((c - b'A') as u32),
            b'a'..=b'z' => Ok((c - b'a' + 26) as u32),
            b'0'..=b'9' => Ok((c - b'0' + 52) as u32),
            b'+' => Ok(62),
            b'/' => Ok(63),
            b'=' => Ok(0),
            other => Err(format!("凭据内容损坏（非法字符 {other}）")),
        }
    }
    let bytes = text.trim().as_bytes();
    if bytes.len() % 4 != 0 {
        return Err("凭据内容损坏（长度不是 4 的倍数）".into());
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let v0 = value(chunk[0])?;
        let v1 = value(chunk[1])?;
        let v2 = value(chunk[2])?;
        let v3 = value(chunk[3])?;
        let triple = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
        out.push((triple >> 16) as u8);
        if chunk[2] != b'=' {
            out.push((triple >> 8) as u8);
        }
        if chunk[3] != b'=' {
            out.push(triple as u8);
        }
    }
    Ok(out)
}

/// 凭据读取结果。前端按 snake_case 取字段。
#[derive(serde::Serialize)]
pub struct CredentialPayload {
    pub password: String,
    /// 保存时刻（Unix 秒）。0 = 旧格式或无时间戳，前端按「已过期」处理。
    pub saved_at: i64,
}

/// 保存「记住密码」的凭据。
///
/// 入参是明文密码，函数内部立刻用 DPAPI 加密后落盘，明文不会被写出。
///
/// 文件内容为两行：第一行保存时刻（Unix 秒），第二行密文的 base64。
/// 时间戳与密文一起存放，是为了让前端的「30 天有效期」能独立判断：
/// 即便密文完好，超过有效期也不该再自动填充。
/// 时间戳本身不加密 —— 它只说明「什么时候存的」，泄露它没有价值，
/// 放进密文里反而让读取路径多一次失败可能。
#[tauri::command]
pub async fn account_credential_save(app: AppHandle, password: String, saved_at: i64) -> Result<(), String> {
    let path = credential_path(&app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|error| format!("无法创建凭据目录：{error}"))?;
    }
    let cipher = dpapi::protect(password.as_bytes())?;
    let content = format!("{saved_at}\n{}", to_base64(&cipher));
    fs::write(&path, content.as_bytes()).map_err(|error| format!("写入凭据失败：{error}"))
}

/// 读取「记住密码」的凭据。
///
/// 文件不存在 → 返回空密码（正常状态：用户没勾记住密码）。
/// 解密失败 → 返回错误，前端当作「未记住」并顺手删掉坏文件。
#[tauri::command]
pub async fn account_credential_load(app: AppHandle) -> Result<CredentialPayload, String> {
    let path = credential_path(&app)?;
    if !path.exists() {
        return Ok(CredentialPayload { password: String::new(), saved_at: 0 });
    }
    let text = fs::read_to_string(&path).map_err(|error| format!("读取凭据失败：{error}"))?;
    // 旧版本文件只有密文单独一行，没有时间戳：按 saved_at = 0 处理，
    // 前端会当作已过期让用户重输一次，而不是让它无限期生效。
    let (saved_at, encoded) = match text.split_once('\n') {
        Some((head, tail)) => (head.trim().parse::<i64>().unwrap_or(0), tail.trim()),
        None => (0, text.trim()),
    };
    let cipher = from_base64(encoded)?;
    let plain = dpapi::unprotect(&cipher)?;
    let password = String::from_utf8(plain).map_err(|_| "凭据内容不是有效文本".to_string())?;
    Ok(CredentialPayload { password, saved_at })
}

/// 清除「记住密码」的凭据（用户取消勾选时调用）。
///
/// 注意：**退出登录不调用它**。按产品约定，退出账号只停登录态，
/// 30 天内的「记住密码」依然有效，下次打开仍可免输。
#[tauri::command]
pub async fn account_credential_clear(app: AppHandle) -> Result<(), String> {
    let path = credential_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("删除凭据失败：{error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_roundtrip() {
        for case in [&b""[..], b"a", b"ab", b"abc", b"abcd", b"\x00\xff\x10"] {
            let encoded = to_base64(case);
            let decoded = from_base64(&encoded).expect("应能解回");
            assert_eq!(decoded, case, "base64 往返失败: {case:?}");
        }
    }

    #[test]
    fn base64_rejects_broken_input() {
        assert!(from_base64("abc").is_err(), "长度不是 4 的倍数应当报错");
        assert!(from_base64("!!!!").is_err(), "非法字符应当报错");
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_roundtrip() {
        let secret = "hunter2-密码-🔑";
        let cipher = dpapi::protect(secret.as_bytes()).expect("加密应成功");
        // 密文不能包含明文，否则等于没加密。
        assert!(!cipher.windows(secret.len()).any(|w| w == secret.as_bytes()));
        let plain = dpapi::unprotect(&cipher).expect("解密应成功");
        assert_eq!(String::from_utf8(plain).unwrap(), secret);
    }
}
