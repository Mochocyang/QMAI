//! 「导入凭证文件」：不经过网页登录的取凭证路径。
//!
//! ── 支持两种形状 ───────────────────────────────────────────
//! ① 嵌套形（wb2api 之类工具的导出格式，或旧版客户端 `.info`）：
//!    `{ "auth": {"accessToken": …, "refreshToken": …, "expiresAt": …,
//!                "domain": "www.workbuddy.cn"},
//!       "account": {"uid": …, "nickname": …} }`
//! ② 扁平形（手抄 / 第三方脚本）：
//!    `{ "accessToken": …, "uid": …, "refreshToken": … }`
//! 两种都接受是刻意的：让用户在「别人给的一段 json」和「手上的导出文件」之间
//! 不用先转换。
//!
//! ── 版本（国内 / 国际）以**文件自己的事实**为准 ──────────────
//! `auth.domain`（或扁平形的顶层 `domain`）里出现 `workbuddy.ai` 就是国际版，
//! 出现 `workbuddy.cn` / `codebuddy.cn` 就是国内版。判不出才用界面上选的那个。
//! 为什么不让界面说了算：拿国内版 token 打国际版端点必然 401，而那种错在界面上
//! 看不出任何异常 —— 文件里写着 `www.workbuddy.ai` 却归到国内版，是最难查的一种。
//!
//! ── 为什么没有「从本机客户端导入」 ───────────────────────────
//! 曾经有过：读 `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop.info`。
//! 2026-10 的新版客户端把 `accessToken` / `refreshToken` / `nickname` 全部改成
//! `{"$wbEncrypted":1,"envelope":"…"}`（它自己的 at-rest 密钥保护，密钥由客户端
//! 原生模块持有、不落盘、不可导出），任何外部程序都读不出来 —— 那条路径对当前
//! 客户端**结构性不可用**，因此整条链路（含只读探测）已删除，不留在界面上误导用户。
//! 用户想用客户端里那个账号，就走「网页登录」：同一个账号登录一次即可。

use serde_json::Value;

use super::accounts::Auth;
use super::endpoints::Edition;

/// 新版客户端把凭证字段存成 at-rest 加密时的统一结论。
///
/// 这不是「文件坏了」，而是「这种方式读不出来」：密钥在客户端自己的原生模块里
/// （不落盘、不可导出），任何外部程序都拿不到。所以文案必须指向**能走通的那条路**。
pub const ENCRYPTED_CREDENTIAL: &str = "这个登录态文件被 WorkBuddy 客户端加密保护了（新版客户端会把 \
     accessToken / refreshToken 存成 $wbEncrypted 密文，密钥由客户端自己保管、不落盘也不可导出），\
     无法直接读取。请改用「网页登录」—— 同一个账号登录一次即可。";

/// 这个值是不是 at-rest 加密信封（`{ "$wbEncrypted": 1, "envelope": "…" }`）。
pub fn is_encrypted_field(value: &Value) -> bool {
    value
        .as_object()
        .and_then(|object| object.get("$wbEncrypted"))
        .map(|marker| marker.as_i64() == Some(1))
        .unwrap_or(false)
}

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

    // 新版客户端的 at-rest 保护：token 不再是字符串，而是
    // `{ "$wbEncrypted": 1, "envelope": "…" }`。密钥由客户端自己的原生模块
    // 持有（不落盘、不可导出），所以这里**结构性**读不出来 —— 必须给出
    // 「改用网页登录」这个可执行结论，而不是让用户对着 `缺少 accessToken` 猜。
    for key in ["accessToken", "access_token", "token"] {
        let candidate = auth_object
            .and_then(|object| object.get(key))
            .or_else(|| body.get(key));
        if candidate.map(is_encrypted_field).unwrap_or(false) {
            return Err(ENCRYPTED_CREDENTIAL.to_string());
        }
    }

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

    // ── 新版客户端的 at-rest 加密凭证（2026-10 实测形态）──────────
    // 真机上 workbuddy-desktop.info 的 auth.accessToken 是
    //   {"$wbEncrypted":1,"envelope":"base64({suite,keyId,nonce,authTag,ciphertext})"}
    // 密钥由客户端原生模块持有、不落盘。虽然「从本机导入」整条链路已删除，
    // 但用户仍可能把这份 .info 拿去走「导入凭证文件」—— 此时必须给出
    // 「改用网页登录」这个可执行结论，而不是「缺少 accessToken」。
    const ENCRYPTED_INFO: &str = r#"{
        "account": {"uid": "u1", "nickname": "小明"},
        "auth": {
            "accessToken": {"$wbEncrypted": 1, "envelope": "eyJzdWl0ZSI6MX0="},
            "refreshToken": {"$wbEncrypted": 1, "envelope": "eyJzdWl0ZSI6MX0="},
            "expiresAt": 1795496662000
        }
    }"#;

    #[test]
    fn encrypted_token_reports_encrypted_instead_of_missing_token() {
        let error = parse_credential_file(ENCRYPTED_INFO).unwrap_err();
        assert_eq!(error, ENCRYPTED_CREDENTIAL);
        assert!(error.contains("网页登录"), "文案要指向可执行的那条路：{error}");
        assert!(!error.contains("缺少 accessToken"), "不能退化成「缺少字段」");
    }

    #[test]
    fn encrypted_field_detection_is_exact() {
        let encrypted = serde_json::json!({"$wbEncrypted": 1, "envelope": "x"});
        let plain = serde_json::json!("token-string");
        let other = serde_json::json!({"$wbEncrypted": 2, "envelope": "x"});
        assert!(is_encrypted_field(&encrypted));
        assert!(!is_encrypted_field(&plain));
        assert!(!is_encrypted_field(&other));
    }
}
