//! 凭证加密：AES-256-GCM + `enc1:` 信封，密钥文件与数据文件分离。
//!
//! ── 挡的是什么 ─────────────────────────────────────────────
//! 账号表会被用户导出、备份、拷机迁移。明文 token 躺在里面等于「拷走一个
//! json 就带走全部账号」。密钥文件与数据文件同目录但**不同文件**，挡的是
//! 「只拿走数据文件」这一类泄露；拿到整台机器的人当然能一起拿走 —— 这是
//! 本地单机应用的强度上限，不假装有平台密钥库。
//!
//! ── 信封格式 ──────────────────────────────────────────────
//! `enc1:` + base64(nonce ‖ 密文 ‖ tag)，nonce 12 字节、tag 16 字节（GCM 标准值）。
//! 前缀存在的意义是「将来换算法时能认出旧格式」；判断口径只在 [`is_envelope`]
//! 一处，别处不要各自 `starts_with("enc1:")`。
//!
//! ── 解密失败只有一种文案 ────────────────────────────────────
//! 密钥文件被删/被换之后，旧密文**永远解不开**（能解开就等于有明文）。这不是
//! 缺陷：桌面形态下用户重新登录一次即可自愈，所以文案要指向那个动作。
//!
//! ── 为什么非 Windows 也要设 0600 ───────────────────────────
//! macOS/Linux 上同目录其他用户默认可读；密钥文件是本模块唯一的秘密，
//! 落盘即收窄权限。

use std::io::Write;
use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use rand::RngCore;

/// 密文信封前缀（换算法时靠它识别旧格式）。
pub const ENVELOPE_PREFIX: &str = "enc1:";

/// 密钥长度（AES-256）与 nonce 长度（GCM 标准 96 bit）。
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

/// GCM 认证标签长度，只用于长度下限校验。
const TAG_LEN: usize = 16;

/// 解密失败的统一文案：指向「重新登录」这个用户真能做的动作。
pub const DECRYPT_FAILED: &str = "凭证解密失败（密钥文件可能已更换），请重新登录 WorkBuddy";

/// 这段文本是不是本模块产出的密文。
pub fn is_envelope(text: &str) -> bool {
    text.starts_with(ENVELOPE_PREFIX)
}

/// 加密一段明文，返回 `enc1:…` 信封。密钥不存在时会自动生成。
pub fn seal(key_path: &Path, plaintext: &[u8]) -> Result<String, String> {
    let key = load_or_create_key(key_path)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "凭证加密初始化失败".to_string())?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| "凭证加密失败".to_string())?;

    let mut buffer = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    buffer.extend_from_slice(&nonce_bytes);
    buffer.extend_from_slice(&ciphertext);
    Ok(format!("{ENVELOPE_PREFIX}{}", BASE64.encode(buffer)))
}

/// 解开一个信封。密钥文件不存在时会**生成一把新钥**，因此旧密文必然解不开 ——
/// 这是设计（见模块头最后一段）。
pub fn open(key_path: &Path, envelope: &str) -> Result<Vec<u8>, String> {
    let payload = envelope
        .strip_prefix(ENVELOPE_PREFIX)
        .ok_or_else(|| DECRYPT_FAILED.to_string())?;
    let raw = BASE64
        .decode(payload)
        .map_err(|_| DECRYPT_FAILED.to_string())?;
    if raw.len() < NONCE_LEN + TAG_LEN {
        return Err(DECRYPT_FAILED.to_string());
    }
    let (nonce_bytes, ciphertext) = raw.split_at(NONCE_LEN);
    let key = load_or_create_key(key_path)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| DECRYPT_FAILED.to_string())?;
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|_| DECRYPT_FAILED.to_string())
}

/// 读密钥；不存在就生成一把并落盘（32 字节随机，unix 上 0600）。
fn load_or_create_key(key_path: &Path) -> Result<Vec<u8>, String> {
    if let Ok(existing) = std::fs::read(key_path) {
        if existing.len() == KEY_LEN {
            return Ok(existing);
        }
        // 长度不对说明文件被改坏了。此时**不能**悄悄覆盖：覆盖会让所有旧密文
        // 变成永久死数据，而用户还没机会知道发生了什么。
        return Err(format!(
            "密钥文件长度异常（{} 字节），请删除后重新登录 WorkBuddy",
            existing.len()
        ));
    }

    if let Some(parent) = key_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建密钥目录失败：{error}"))?;
    }

    let mut key = vec![0u8; KEY_LEN];
    rand::rngs::OsRng.fill_bytes(&mut key);

    // 先用 `create_new` 独占创建：两个进程同时首次启动时，后到的那个会失败，
    // 然后**改读先到者写好的那把**，而不是各自生成一把互相解不开的钥。
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(key_path)
    {
        Ok(mut file) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = file.set_permissions(std::fs::Permissions::from_mode(0o600));
            }
            file.write_all(&key)
                .map_err(|error| format!("写入密钥文件失败：{error}"))?;
            Ok(key)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let existing = std::fs::read(key_path).map_err(|error| format!("读取密钥文件失败：{error}"))?;
            if existing.len() == KEY_LEN {
                Ok(existing)
            } else {
                Err("密钥文件长度异常，请删除后重新登录 WorkBuddy".to_string())
            }
        }
        Err(error) => Err(format!("创建密钥文件失败：{error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workbuddy::test_support::temp_dir;

    #[test]
    fn roundtrip_keeps_prefix_and_payload() {
        let dir = temp_dir();
        let key = dir.join("k.key");
        let envelope = seal(&key, b"hello").unwrap();
        assert!(envelope.starts_with(ENVELOPE_PREFIX));
        assert!(is_envelope(&envelope));
        assert_eq!(open(&key, &envelope).unwrap(), b"hello");
    }

    #[test]
    fn two_seals_of_the_same_plaintext_differ() {
        // nonce 每次随机：相同明文不能产出相同密文，否则能看出「两个账号 token 一样」。
        let dir = temp_dir();
        let key = dir.join("k.key");
        let a = seal(&key, b"same").unwrap();
        let b = seal(&key, b"same").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn wrong_key_fails_with_actionable_message() {
        let a = temp_dir();
        let b = temp_dir();
        let envelope = seal(&a.join("k.key"), b"x").unwrap();
        let error = open(&b.join("k.key"), &envelope).unwrap_err();
        assert!(error.contains("重新登录"), "文案要指向可操作动作：{error}");
    }

    #[test]
    fn key_file_is_32_bytes_and_reused() {
        let dir = temp_dir();
        let key = dir.join("k.key");
        seal(&key, b"a").unwrap();
        let first = std::fs::read(&key).unwrap();
        seal(&key, b"b").unwrap();
        assert_eq!(first, std::fs::read(&key).unwrap());
        assert_eq!(first.len(), 32);
    }

    #[test]
    fn garbage_is_rejected_without_panicking() {
        let dir = temp_dir();
        let key = dir.join("k.key");
        assert!(open(&key, "plain text").is_err());
        assert!(open(&key, "enc1:not-base64!!").is_err());
        assert!(open(&key, "enc1:").is_err());
    }

    #[test]
    fn corrupted_key_file_is_not_silently_overwritten() {
        let dir = temp_dir();
        let key = dir.join("k.key");
        std::fs::write(&key, b"short").unwrap();
        assert!(seal(&key, b"x").is_err());
        // 原文件必须原样保留，否则旧密文会永久失效而用户毫不知情。
        assert_eq!(std::fs::read(&key).unwrap(), b"short");
    }
}
