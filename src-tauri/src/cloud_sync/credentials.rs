//! 凭据落盘：`<app_data>/cloud-sync/credentials.bin`（百度 token）与
//! `webdav-credentials.bin`（WebDAV 地址/账号/密码）。
//!
//! 安全取舍：
//! - Windows：DPAPI（`CryptProtectData`），密文绑定**当前用户账户**。别人拿走这个文件
//!   也解不开，换账户/换机器同样解不开 —— 这正是我们想要的（凭据不该跟着备份走）。
//! - macOS / Linux：退化成 0600 权限的明文 JSON，并在文档里写明限制。
//!   为什么不自己造一层 AES：没有系统密钥环时，密钥只能和密文放一起，属于自我安慰。
//!
//! 读取失败一律当成「没有凭据」，并把坏文件改名留档：凭据坏掉只该导致重新登录，
//! 不该让应用启动失败。

use std::fs;
use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::baidu::BaiduToken;

pub const CREDENTIALS_FILE: &str = "credentials.bin";
pub const WEBDAV_CREDENTIALS_FILE: &str = "webdav-credentials.bin";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WebdavCredentials {
    pub url: String,
    pub user: String,
    pub password: String,
}

/// 给测试用的路径解析（生产代码直接用 <dir>/<file_name>）。
#[cfg(test)]
pub fn credentials_path(dir: &Path) -> PathBuf {
    dir.join(CREDENTIALS_FILE)
}

#[cfg(test)]
pub fn webdav_credentials_path(dir: &Path) -> PathBuf {
    dir.join(WEBDAV_CREDENTIALS_FILE)
}

pub fn save(dir: &Path, token: &BaiduToken) -> Result<(), String> {
    save_typed(dir, CREDENTIALS_FILE, token)
}

pub fn load(dir: &Path) -> Option<BaiduToken> {
    load_typed(dir, CREDENTIALS_FILE)
}

pub fn clear(dir: &Path) -> Result<(), String> {
    clear_file(dir, CREDENTIALS_FILE)
}

pub fn save_webdav(dir: &Path, credentials: &WebdavCredentials) -> Result<(), String> {
    save_typed(dir, WEBDAV_CREDENTIALS_FILE, credentials)
}

pub fn load_webdav(dir: &Path) -> Option<WebdavCredentials> {
    load_typed(dir, WEBDAV_CREDENTIALS_FILE)
}

pub fn clear_webdav(dir: &Path) -> Result<(), String> {
    clear_file(dir, WEBDAV_CREDENTIALS_FILE)
}

/// 清掉所有网盘的凭据（登出时调用）。
pub fn clear_all(dir: &Path) -> Result<(), String> {
    clear(dir)?;
    clear_webdav(dir)
}

fn save_typed<T: Serialize>(dir: &Path, file_name: &str, value: &T) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|error| format!("创建云同步目录失败：{error}"))?;
    let plain = serde_json::to_vec(value).map_err(|error| format!("序列化凭据失败：{error}"))?;
    let payload = protect(&plain)?;
    let target = dir.join(file_name);
    let tmp = dir.join(format!("{file_name}.tmp"));
    fs::write(&tmp, &payload).map_err(|error| format!("写入凭据失败：{error}"))?;
    restrict_permissions(&tmp);
    fs::rename(&tmp, &target).map_err(|error| format!("替换凭据失败：{error}"))?;
    Ok(())
}

fn load_typed<T: for<'de> Deserialize<'de>>(dir: &Path, file_name: &str) -> Option<T> {
    let path = dir.join(file_name);
    let payload = fs::read(&path).ok()?;
    let plain = match unprotect(&payload) {
        Ok(plain) => plain,
        Err(_) => {
            quarantine(dir, &path, file_name);
            return None;
        }
    };
    match serde_json::from_slice::<T>(&plain) {
        Ok(value) => Some(value),
        Err(_) => {
            quarantine(dir, &path, file_name);
            None
        }
    }
}

fn clear_file(dir: &Path, file_name: &str) -> Result<(), String> {
    let path = dir.join(file_name);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("删除凭据失败：{error}")),
    }
}

fn quarantine(dir: &Path, path: &Path, file_name: &str) {
    let stamp = chrono::Utc::now().format("%Y%m%d%H%M%S");
    let _ = fs::rename(path, dir.join(format!("{file_name}.corrupt-{stamp}")));
}

#[cfg(windows)]
fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: plain.len() as u32,
        pbData: plain.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(&mut input, None, None, None, None, 0, &mut output)
            .map_err(|error| format!("系统加密失败：{error}"))?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(output.pbData as _)));
        Ok(bytes)
    }
}

#[cfg(windows)]
fn unprotect(payload: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: payload.len() as u32,
        pbData: payload.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(&mut input, None, None, None, None, 0, &mut output)
            .map_err(|error| format!("系统解密失败：{error}"))?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(output.pbData as _)));
        Ok(bytes)
    }
}

#[cfg(not(windows))]
fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    Ok(plain.to_vec())
}

#[cfg(not(windows))]
fn unprotect(payload: &[u8]) -> Result<Vec<u8>, String> {
    Ok(payload.to_vec())
}

#[cfg(not(windows))]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(windows)]
fn restrict_permissions(_path: &Path) {
    // Windows 侧靠 DPAPI 保护内容，不需要额外 ACL（文件已在应用数据目录内）。
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qmai_credentials_{name}_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn sample_token() -> BaiduToken {
        BaiduToken {
            access_token: "access-token-value".to_string(),
            refresh_token: Some("refresh-token-value".to_string()),
            expires_at_ms: 1_800_000_000_000,
            scope: Some("basic netdisk".to_string()),
        }
    }

    fn sample_webdav() -> WebdavCredentials {
        WebdavCredentials {
            url: "https://nas.example.com/dav".to_string(),
            user: "reader".to_string(),
            password: "super-secret".to_string(),
        }
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = temp_dir("roundtrip");
        save(&dir, &sample_token()).unwrap();
        assert_eq!(load(&dir).expect("credentials should load"), sample_token());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn webdav_credentials_round_trip_in_their_own_file() {
        let dir = temp_dir("webdav");
        save_webdav(&dir, &sample_webdav()).unwrap();
        assert_eq!(load_webdav(&dir), Some(sample_webdav()));
        assert!(load(&dir).is_none(), "两个网盘的凭据不能互相串台");

        clear_webdav(&dir).unwrap();
        assert!(load_webdav(&dir).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_credentials_are_none_not_an_error() {
        let dir = temp_dir("missing");
        assert!(load(&dir).is_none());
        assert!(load_webdav(&dir).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn corrupt_credentials_are_quarantined() {
        let dir = temp_dir("corrupt");
        fs::write(credentials_path(&dir), b"not a real blob").unwrap();
        assert!(load(&dir).is_none());
        let has_backup = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"));
        assert!(has_backup, "坏凭据应改名留档");
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(windows)]
    #[test]
    fn windows_payloads_are_not_plaintext_on_disk() {
        let dir = temp_dir("dpapi");
        save(&dir, &sample_token()).unwrap();
        save_webdav(&dir, &sample_webdav()).unwrap();
        for file in [credentials_path(&dir), webdav_credentials_path(&dir)] {
            let text = String::from_utf8_lossy(&fs::read(&file).unwrap()).to_string();
            assert!(!text.contains("access-token-value"), "DPAPI 密文里不该出现明文 token");
            assert!(!text.contains("super-secret"), "DPAPI 密文里不该出现明文密码");
        }
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn clear_all_is_idempotent() {
        let dir = temp_dir("clear");
        save(&dir, &sample_token()).unwrap();
        save_webdav(&dir, &sample_webdav()).unwrap();
        clear_all(&dir).unwrap();
        assert!(load(&dir).is_none());
        assert!(load_webdav(&dir).is_none());
        clear_all(&dir).unwrap();
        fs::remove_dir_all(&dir).ok();
    }
}
