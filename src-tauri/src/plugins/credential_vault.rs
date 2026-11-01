//! 插件凭证保险箱（`net:credential-vault` 权限）。
//!
//! ── 它是干什么的 ────────────────────────────────────────────
//! 账号类插件（WorkBuddy 等）登录后拿到 accessToken / refreshToken，需要一个
//! **跨重启仍然存在**的地方存放。放在插件自己目录里有两个问题：
//!   1. 明文落插件盘 —— 用户备份/拷机时 token 跟着走；
//!   2. 插件的安装/卸载会连带凭证一起删。
//!
//! 所以放在宿主这边：`<app_data>/plugin-credentials/<pluginId>/` 下，**加密**后落盘，
//! 密钥与数据文件分离（复用 `secret_box`）。插件通过宿主 HTTP 存取自己的那一份，
//! 拿不到别人的（路径由 `pluginId` 决定，不信插件传来的 id）。
//!
//! ── 为什么凭证是"覆盖式"而不是"键值表" ─────────────────────────
//! 一个插件的账号凭证通常只有一份（一个登录态）。做成键值表会让 API 变复杂，
//! 而收益（多账号并存）现在没有需求。真需要时再扩，`put` 加个 name 参数即可。
//!
//! ── 权限 ────────────────────────────────────────────────────
//! `net:credential-vault`。它必须由用户**逐项勾选**：能读到凭证 = 能冒充用户
//! 打上游接口，这是本模块里最敏感的一档。

use std::path::{Path, PathBuf};

use super::secret_box;

/// 凭证文件在插件凭据目录下的文件名。
const CREDENTIAL_FILE: &str = "credential.enc";

/// 允许写入的最大长度。凭据是几百字的 token，1 MB 已经极端宽松 ——
/// 设上限是为了挡住"把整个聊天记录写进保险箱"这种用法。
pub const MAX_CREDENTIAL_BYTES: usize = 1024 * 1024;

/// 一个插件的凭证保险箱。
pub struct CredentialVault {
    root: PathBuf,
}

impl CredentialVault {
    /// `app_data_dir` 通常是 `app_data_dir()`；每个插件各用一个子目录。
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            root: app_data_dir.join("plugin-credentials"),
        }
    }

    /// 某个插件的目录。`plugin_id` 已由调用方按 `is_valid_id` 校验过
    /// （小写字母数字连字符），这里仍然只做拼接，不再二次清洗。
    fn plugin_dir(&self, plugin_id: &str) -> PathBuf {
        self.root.join(plugin_id)
    }

    fn credential_path(&self, plugin_id: &str) -> PathBuf {
        self.plugin_dir(plugin_id).join(CREDENTIAL_FILE)
    }

    fn key_path(&self, plugin_id: &str) -> PathBuf {
        self.plugin_dir(plugin_id).join("key.bin")
    }

    /// 写入（覆盖）凭证。返回写入的明文字节数，便于调用方记日志时**不**打印内容。
    pub fn put(&self, plugin_id: &str, secret: &str) -> Result<usize, String> {
        let bytes = secret.as_bytes();
        if bytes.is_empty() {
            return Err("凭证内容为空".to_string());
        }
        if bytes.len() > MAX_CREDENTIAL_BYTES {
            return Err(format!(
                "凭证过大（{} 字节，上限 {MAX_CREDENTIAL_BYTES}）",
                bytes.len()
            ));
        }

        let dir = self.plugin_dir(plugin_id);
        std::fs::create_dir_all(&dir)
            .map_err(|error| format!("创建插件凭证目录失败：{error}"))?;

        let envelope = secret_box::seal(&self.key_path(plugin_id), bytes)?;
        // 原子替换：写临时文件再 rename，避免写一半断电留下半个信封。
        let target = self.credential_path(plugin_id);
        let temporary = dir.join("credential.enc.tmp");
        std::fs::write(&temporary, envelope.as_bytes())
            .map_err(|error| format!("写入插件凭证失败：{error}"))?;
        std::fs::rename(&temporary, &target)
            .map_err(|error| format!("提交插件凭证失败：{error}"))?;

        Ok(bytes.len())
    }

    /// 读回凭证。没有存过 → `Ok(None)`（不是错误：插件据此判断"还没登录"）。
    ///
    /// 解密失败 → `Err`：密钥文件被换过，旧密文永远解不开。这是设计
    /// （见 `secret_box` 模块头），文案让用户去重新登录。
    pub fn get(&self, plugin_id: &str) -> Result<Option<String>, String> {
        let path = self.credential_path(plugin_id);
        let envelope = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("读取插件凭证失败：{error}")),
        };
        let bytes = secret_box::open(&self.key_path(plugin_id), &envelope)?;
        String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| "凭证不是合法文本".to_string())
    }

    /// 删除凭证（用户登出 / 卸载插件时调用）。
    ///
    /// 目录整个删掉：里面只有两份文件（密文 + 密钥），留着密钥没有意义。
    pub fn clear(&self, plugin_id: &str) -> Result<(), String> {
        let dir = self.plugin_dir(plugin_id);
        match std::fs::remove_dir_all(&dir) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("删除插件凭证失败：{error}")),
        }
    }

    /// 这个插件有没有存过凭证（不解密，只判断文件在不在）。
    pub fn has(&self, plugin_id: &str) -> bool {
        self.credential_path(plugin_id).is_file()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qmai-vault-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn roundtrip_stores_and_reads_back() {
        let root = temp_root("roundtrip");
        let vault = CredentialVault::new(&root);

        assert_eq!(vault.get("demo-plugin").unwrap(), None);
        vault.put("demo-plugin", r#"{"accessToken":"abc"}"#).unwrap();
        assert_eq!(
            vault.get("demo-plugin").unwrap().as_deref(),
            Some(r#"{"accessToken":"abc"}"#)
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn file_on_disk_is_encrypted_not_plaintext() {
        let root = temp_root("encrypted");
        let vault = CredentialVault::new(&root);
        vault.put("demo-plugin", "super-secret-token-123456").unwrap();

        let raw = std::fs::read_to_string(vault.credential_path("demo-plugin")).unwrap();
        assert!(raw.starts_with(secret_box::ENVELOPE_PREFIX), "应为 enc1: 信封");
        assert!(
            !raw.contains("super-secret-token-123456"),
            "明文绝不能落盘：{raw}"
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn plugins_are_isolated_from_each_other() {
        let root = temp_root("isolated");
        let vault = CredentialVault::new(&root);
        vault.put("plugin-a", "token-a").unwrap();
        vault.put("plugin-b", "token-b").unwrap();

        assert_eq!(vault.get("plugin-a").unwrap().as_deref(), Some("token-a"));
        assert_eq!(vault.get("plugin-b").unwrap().as_deref(), Some("token-b"));
        // 各自有独立的密钥文件
        assert_ne!(vault.key_path("plugin-a"), vault.key_path("plugin-b"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn put_overwrites_previous_credential() {
        let root = temp_root("overwrite");
        let vault = CredentialVault::new(&root);
        vault.put("demo", "old").unwrap();
        vault.put("demo", "new").unwrap();
        assert_eq!(vault.get("demo").unwrap().as_deref(), Some("new"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn clear_removes_credential_and_reports_missing_as_ok() {
        let root = temp_root("clear");
        let vault = CredentialVault::new(&root);
        vault.put("demo", "token").unwrap();
        assert!(vault.has("demo"));

        vault.clear("demo").unwrap();
        assert!(!vault.has("demo"));
        assert_eq!(vault.get("demo").unwrap(), None);
        // 再删一次不该报错（幂等）
        vault.clear("demo").unwrap();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn empty_and_oversized_credentials_are_rejected() {
        let root = temp_root("limits");
        let vault = CredentialVault::new(&root);
        assert!(vault.put("demo", "").is_err());

        let huge = "x".repeat(MAX_CREDENTIAL_BYTES + 1);
        let error = vault.put("demo", &huge).unwrap_err();
        assert!(error.contains("上限"), "{error}");
        // 拒绝时不该留下半份文件
        assert!(!vault.has("demo"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn replacing_the_key_makes_old_credential_unreadable() {
        let root = temp_root("key-rotated");
        let vault = CredentialVault::new(&root);
        vault.put("demo", "token").unwrap();

        // 模拟密钥文件被换掉
        std::fs::remove_file(vault.key_path("demo")).unwrap();
        let error = vault.get("demo").unwrap_err();
        assert!(error.contains("重新登录"), "文案要指向用户能做的动作：{error}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn has_reports_false_before_any_login() {
        let root = temp_root("has");
        let vault = CredentialVault::new(&root);
        assert!(!vault.has("never-logged-in"));
        std::fs::remove_dir_all(&root).ok();
    }
}
