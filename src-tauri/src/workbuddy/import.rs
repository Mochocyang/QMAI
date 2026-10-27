//! 两条「不经过网页登录」的取凭证路径：导入凭证文件、导入官方客户端登录态。
//!
//! ── 「导入凭证文件」支持两种形状 ─────────────────────────────
//! ① 官方客户端登录态（嵌套形，也是 wb2api 之类工具的导出格式）：
//!    `{ "auth": {"accessToken": …, "refreshToken": …, "expiresAt": …,
//!                "domain": "www.workbuddy.cn"},
//!       "account": {"uid": …, "nickname": …} }`
//! ② 扁平形（手抄 / 第三方脚本）：
//!    `{ "accessToken": …, "uid": …, "refreshToken": … }`
//! 两种都接受是刻意的：让用户在「从客户端目录里拿到的文件」和「别人给的一段
//! json」之间不用先转换。
//!
//! ── 版本（国内 / 国际）以**文件自己的事实**为准 ──────────────
//! `auth.domain`（或扁平形的顶层 `domain`）里出现 `workbuddy.ai` 就是国际版，
//! 出现 `workbuddy.cn` / `codebuddy.cn` 就是国内版。判不出才用界面上选的那个。
//! 为什么不让界面说了算：拿国内版 token 打国际版端点必然 401，而那种错在界面上
//! 看不出任何异常 —— 文件里写着 `www.workbuddy.ai` 却归到国内版，是最难查的一种。
//!
//! ── 「导入官方客户端登录态」读固定目录 ───────────────────────
//! 官方客户端把会话**明文**落在：
//!   Windows：`%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\`
//!   macOS：  `~/Library/Application Support/CodeBuddyExtension/Data/Public/auth/`
//! 当前文件名 [`Edition::desktop_file`]（`workbuddy-desktop.info` /
//! `workbuddy-desktop-ai.info`）。每次重新登录，上一份会被改名成
//! `workbuddy-desktop.<时间戳>.<pid>.<uuid>.info` 留在原地**不删**，所以
//! 「当前文件缺失」时要退回**时间戳最大**的那份备份（ISO 时间戳零填充，
//! 字典序即时间序）。备份里的 accessToken 多半已过期，refreshToken 通常仍有效，
//! 落库后由续期链接管。
//!
//! 本模块**只读**：不改、不删、不移动客户端目录里的任何文件。

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::accounts::Auth;
use super::endpoints::Edition;

/// 一次导入解析出来的凭证（尚未落库）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Imported {
    pub access_token: String,
    pub refresh_token: String,
    pub uid: String,
    pub nickname: String,
    pub expires_at: i64,
    pub refresh_expires_at: i64,
    pub domain: String,
    /// `"cn"` / `"intl"` / 空串（判不出，由调用方用界面所选版本）
    pub edition: String,
}

impl Imported {
    pub fn auth(&self) -> Auth {
        Auth {
            access_token: self.access_token.clone(),
            refresh_token: self.refresh_token.clone(),
            expires_at: self.expires_at,
            refresh_expires_at: self.refresh_expires_at,
            domain: self.domain.clone(),
        }
    }

    /// 最终归属版本：文件判得出就用文件的，否则用参数。
    pub fn edition_or(&self, fallback: Edition) -> Edition {
        if self.edition.is_empty() {
            fallback
        } else {
            Edition::from_id(Some(self.edition.as_str()))
        }
    }
}

/// 解析一份凭证文件的内容（纯函数，不碰磁盘）。
pub fn parse_credential_file(text: &str) -> Result<Imported, String> {
    let body: Value = serde_json::from_str(text)
        .map_err(|error| format!("不是合法的 JSON：{error}"))?;
    let object = body
        .as_object()
        .ok_or_else(|| "不是有效的凭证文件：内容要是一个 JSON 对象".to_string())?;

    // 嵌套形优先：`auth` 与 `account` 各自是一个对象。
    let auth_object = object.get("auth").and_then(Value::as_object);
    let account_object = object.get("account").and_then(Value::as_object);

    let access_token = field(
        &body,
        auth_object,
        &["accessToken", "access_token", "token"],
    );
    let uid = field(&body, account_object, &["uid", "userId", "user_id"]);

    if access_token.is_empty() {
        return Err("不是有效的凭证文件：缺少 accessToken".to_string());
    }
    if uid.is_empty() {
        return Err("不是有效的凭证文件：缺少 uid".to_string());
    }

    let domain = field(&body, auth_object, &["domain"]);
    let edition = edition_from_domain(&domain);

    Ok(Imported {
        access_token,
        refresh_token: field(&body, auth_object, &["refreshToken", "refresh_token"]),
        uid,
        nickname: field(&body, account_object, &["nickname", "name", "displayName"]),
        expires_at: number_field(&body, auth_object, &["expiresAt", "expires_at"]),
        refresh_expires_at: number_field(
            &body,
            auth_object,
            &["refreshExpiresAt", "refresh_expires_at"],
        ),
        domain,
        edition,
    })
}

/// 从 domain 推断版本（判不出返回空串）。
pub fn edition_from_domain(domain: &str) -> String {
    let lower = domain.to_ascii_lowercase();
    if lower.contains("workbuddy.ai") || lower.contains("codebuddy.ai") {
        return Edition::INTL.id.to_string();
    }
    if lower.contains("workbuddy.cn") || lower.contains("codebuddy.cn") {
        return Edition::CN.id.to_string();
    }
    String::new()
}

/// 在给定目录里定位该版本的登录态文件（当前文件优先，其次最新备份）。
pub fn locate_desktop_auth_file(dir: &Path, edition: Edition) -> Result<PathBuf, String> {
    let current = dir.join(edition.desktop_file);
    if current.is_file() {
        return Ok(current);
    }

    // 备份前缀带结尾的点：`workbuddy-desktop.` 不会匹配 `workbuddy-desktop-ai.…`
    // （反过来也一样），两个版本共用目录也不会串。
    let prefix = edition
        .desktop_file
        .strip_suffix(".info")
        .map(|stem| format!("{stem}."))
        .unwrap_or_else(|| edition.desktop_file.to_string());

    let mut backups: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|error| format!("读取官方客户端目录失败（{}）：{error}", dir.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with(&prefix) && name.ends_with(".info"))
                    .unwrap_or(false)
        })
        .collect();

    // 文件名里的时间戳是零填充 ISO 形态，字典序即时间序；取最大那份。
    backups.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    backups.into_iter().next().ok_or_else(|| {
        format!(
            "未找到官方客户端的登录态文件（{}）。请先在 WorkBuddy 客户端登录一次",
            dir.display()
        )
    })
}

/// 读并解析官方客户端登录态（`dir` 由调用方给，便于测试）。
pub fn read_desktop_credential(dir: &Path, edition: Edition) -> Result<Imported, String> {
    let path = locate_desktop_auth_file(dir, edition)?;
    let text = std::fs::read_to_string(&path)
        .map_err(|error| format!("读取登录态文件失败（{}）：{error}", path.display()))?;
    let mut imported = parse_credential_file(&text)
        .map_err(|error| format!("登录态文件内容异常（{}）：{error}", path.display()))?;
    // 客户端文件里可能没写 domain；用请求的版本兜底，避免落库后无法判断站点。
    if imported.edition.is_empty() {
        imported.edition = edition.id.to_string();
    }
    if imported.domain.is_empty() {
        imported.domain = edition.authority();
    }
    Ok(imported)
}

/// 从（可能嵌套的）对象里取第一个非空字符串字段。
fn field(body: &Value, nested: Option<&serde_json::Map<String, Value>>, keys: &[&str]) -> String {
    for key in keys {
        if let Some(value) = nested.and_then(|object| object.get(*key)).and_then(Value::as_str) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
        if let Some(value) = body.get(*key).and_then(Value::as_str) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    String::new()
}

/// 数字字段：接受数字与数字字符串（上游两种都出现过）。
fn number_field(
    body: &Value,
    nested: Option<&serde_json::Map<String, Value>>,
    keys: &[&str],
) -> i64 {
    let read = |value: Option<&Value>| match value {
        Some(Value::Number(number)) => number.as_i64().unwrap_or(0),
        Some(Value::String(text)) => text.trim().parse::<i64>().unwrap_or(0),
        _ => 0,
    };
    for key in keys {
        let nested_value = nested.and_then(|object| object.get(*key));
        let value = read(nested_value);
        if value > 0 {
            return value;
        }
        let flat = read(body.get(*key));
        if flat > 0 {
            return flat;
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workbuddy::test_support::temp_dir;

    #[test]
    fn parses_nested_official_shape() {
        let text = r#"{
            "auth": {"accessToken": "A", "refreshToken": "R", "domain": "www.workbuddy.cn"},
            "account": {"uid": "u1", "nickname": "小明"}
        }"#;
        let imported = parse_credential_file(text).unwrap();
        assert_eq!(imported.access_token, "A");
        assert_eq!(imported.refresh_token, "R");
        assert_eq!(imported.uid, "u1");
        assert_eq!(imported.nickname, "小明");
        assert_eq!(imported.edition, "cn");
    }

    #[test]
    fn parses_flat_shape() {
        let text = r#"{"accessToken": "A", "uid": "u1"}"#;
        let imported = parse_credential_file(text).unwrap();
        assert_eq!(imported.access_token, "A");
        assert_eq!(imported.uid, "u1");
        assert_eq!(imported.edition, "", "判不出时留空，交给界面所选版本");
    }

    #[test]
    fn rejects_with_actionable_message() {
        assert!(parse_credential_file(r#"{"accessToken":"A"}"#)
            .unwrap_err()
            .contains("uid"));
        assert!(parse_credential_file(r#"{"uid":"u"}"#)
            .unwrap_err()
            .contains("accessToken"));
        assert!(parse_credential_file("not json")
            .unwrap_err()
            .contains("JSON"));
        assert!(parse_credential_file("[]").unwrap_err().contains("JSON 对象"));
    }

    #[test]
    fn edition_comes_from_domain_not_ui() {
        let intl = r#"{"accessToken":"A","uid":"u","auth":{"domain":"www.workbuddy.ai"}}"#;
        assert_eq!(parse_credential_file(intl).unwrap().edition, "intl");
        let cn = r#"{"accessToken":"A","uid":"u","domain":"www.codebuddy.cn"}"#;
        assert_eq!(parse_credential_file(cn).unwrap().edition, "cn");
        assert_eq!(edition_from_domain("example.com"), "");
    }

    #[test]
    fn desktop_file_prefers_current_over_backup() {
        let dir = temp_dir();
        std::fs::write(dir.join("workbuddy-desktop.2026-01-01T00-00-00.1.a.info"), "{}").unwrap();
        std::fs::write(dir.join("workbuddy-desktop.info"), "{}").unwrap();
        let found = locate_desktop_auth_file(&dir, Edition::CN).unwrap();
        assert_eq!(found.file_name().unwrap(), "workbuddy-desktop.info");
    }

    #[test]
    fn desktop_file_falls_back_to_newest_backup() {
        let dir = temp_dir();
        std::fs::write(dir.join("workbuddy-desktop.2026-01-01T00-00-00.info"), "old").unwrap();
        std::fs::write(dir.join("workbuddy-desktop.2026-05-01T00-00-00.info"), "new").unwrap();
        let found = locate_desktop_auth_file(&dir, Edition::CN).unwrap();
        assert!(found.to_string_lossy().contains("2026-05-01"));
    }

    #[test]
    fn desktop_import_ignores_other_editions_file() {
        let dir = temp_dir();
        std::fs::write(dir.join("workbuddy-desktop-ai.info"), "{}").unwrap();
        assert!(locate_desktop_auth_file(&dir, Edition::CN).is_err());
        assert!(locate_desktop_auth_file(&dir, Edition::INTL).is_ok());
    }

    #[test]
    fn missing_directory_reports_the_path() {
        let dir = temp_dir().join("no-such-subdir");
        let error = locate_desktop_auth_file(&dir, Edition::CN).unwrap_err();
        assert!(error.contains("no-such-subdir"), "文案要带上期望路径：{error}");
    }

    #[test]
    fn desktop_read_fills_domain_from_edition() {
        let dir = temp_dir();
        std::fs::write(
            dir.join("workbuddy-desktop.info"),
            r#"{"auth":{"accessToken":"A"},"account":{"uid":"u1"}}"#,
        )
        .unwrap();
        let imported = read_desktop_credential(&dir, Edition::CN).unwrap();
        assert_eq!(imported.edition, "cn");
        assert_eq!(imported.domain, "copilot.tencent.com");
    }
}
