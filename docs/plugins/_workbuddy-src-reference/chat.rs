//! 对话请求的构造：私有头集合、首条 system 注入、上游错误分类。
//!
//! ── 为什么需要这么多头 ─────────────────────────────────────
//! WorkBuddy 的对话网关按「客户端身份 + 会话头 + 链路头」判请求来源。少给一组
//! 的症状不是 400，而是**更隐蔽的东西**：模型回一段与上下文无关的回答，或者
//! 计入「网页应用」的额度池。所以这里逐字照官方客户端的一次真实请求补齐：
//!   · 客户端身份：`X-IDE-Type` / `X-IDE-Name` / `X-IDE-Version` / `X-Product`
//!   · 会话族：`X-Conversation-ID` / `X-Conversation-Message-ID` / `X-Request-ID`
//!     / `X-Root-Request-ID` / `X-Conversation-Request-ID`（同一轮共用一个 request id）
//!   · 链路族：`X-Trace-ID` / `traceparent` / `b3` / `X-B3-*`
//!   · 站点族：`Origin` / `Referer` / `X-Domain` / `X-Requested-With` / `X-CodeBuddy-Request`
//! 不发 `X-Session-ID`：官方对话请求不带它，恒定派生值本身就是一种网关特征。
//!
//! ── 首条必须是 system ──────────────────────────────────────
//! 上游要求 messages[0].role === "system"，否则 400（first message is not
//! system prompt）。QMAI 的写作链路**总是**带 system 提示词，所以正常路径不会
//! 触发；但「连通性测试」「标题生成」这类短调用可能只发一条 user。此时补一条
//! 兜底系统消息，比让用户看到一句英文 400 好。
//! `developer` 角色要先归一成 `system` 再判断，否则会多插一条。
//!
//! ── 错误分类为什么在网关里做 ─────────────────────────────────
//! 「429 还是额度用尽」「6004 和 11-128 是两码事」这些是**上游知识**。分类好之
//! 后前端只需要按 `error.kind` 给文案，不必认识业务码。分类结果也决定要不要
//! 刷新 token 重试（`TokenExpired`）。

use serde_json::{json, Value};
use uuid::Uuid;

use super::accounts::Account;
use super::endpoints::{CODE_QUOTA_LIMIT, CODE_WAF_BLOCK};

/// 上游要求的兜底系统消息。措辞与官方客户端一致（中性、无指令）。
pub const DEFAULT_SYSTEM_PROMPT: &str = "你是一个得力助手";

/// 一轮对话的链路 id。每轮新建一次，轮内所有请求复用。
#[derive(Clone, Debug)]
pub struct Trace {
    pub conversation_id: String,
    pub message_id: String,
    pub conversation_request_id: String,
    pub trace_id: String,
    pub span_id: String,
}

impl Trace {
    pub fn new() -> Trace {
        Trace {
            conversation_id: new_id(),
            message_id: new_id(),
            conversation_request_id: new_id(),
            trace_id: new_id(),
            span_id: new_span(),
        }
    }
}

impl Default for Trace {
    fn default() -> Self {
        Trace::new()
    }
}

fn new_id() -> String {
    Uuid::new_v4().simple().to_string()
}

/// 链路 span：16 个十六进制字符（W3C traceparent 的要求）。
fn new_span() -> String {
    Uuid::new_v4().simple().to_string()[..16].to_string()
}

/// 构造一次对话请求的全部头。
pub fn build_headers(account: &Account, trace: &Trace) -> Vec<(String, String)> {
    let edition = account.edition();
    let origin = if account.endpoint.trim().is_empty() {
        edition.endpoint.to_string()
    } else {
        account.endpoint.trim_end_matches('/').to_string()
    };
    let authority = origin
        .split_once("://")
        .map(|(_, rest)| rest.to_string())
        .unwrap_or_else(|| origin.clone());

    let mut headers: Vec<(String, String)> = vec![
        ("Content-Type".to_string(), "application/json".to_string()),
        ("User-Agent".to_string(), edition.ua.to_string()),
        ("X-IDE-Type".to_string(), "WorkBuddy".to_string()),
        ("X-IDE-Name".to_string(), "WorkBuddy".to_string()),
        ("X-IDE-Version".to_string(), edition.ide_version.to_string()),
        ("X-Product".to_string(), "SaaS".to_string()),
        ("X-Agent-Intent".to_string(), "craft".to_string()),
        ("X-Agent-Purpose".to_string(), "conversation".to_string()),
        ("X-Agent-Type".to_string(), "main".to_string()),
        ("X-Private-Data".to_string(), "true".to_string()),
        (
            "X-Conversation-ID".to_string(),
            trace.conversation_id.clone(),
        ),
        (
            "X-Conversation-Request-ID".to_string(),
            trace.conversation_request_id.clone(),
        ),
        (
            "X-Root-Request-ID".to_string(),
            trace.conversation_request_id.clone(),
        ),
        (
            "X-Conversation-Message-ID".to_string(),
            trace.message_id.clone(),
        ),
        ("X-Request-ID".to_string(), trace.message_id.clone()),
        ("X-Trace-ID".to_string(), trace.trace_id.clone()),
        (
            "traceparent".to_string(),
            format!("00-{}-{}-01", trace.trace_id, trace.span_id),
        ),
        (
            "b3".to_string(),
            format!("{}-{}-1", trace.trace_id, trace.span_id),
        ),
        ("X-B3-TraceId".to_string(), trace.trace_id.clone()),
        ("X-B3-SpanId".to_string(), trace.span_id.clone()),
        ("X-B3-Sampled".to_string(), "1".to_string()),
        ("Accept-Language".to_string(), "zh-CN".to_string()),
        ("X-Requested-With".to_string(), "XMLHttpRequest".to_string()),
        ("X-CodeBuddy-Request".to_string(), "1".to_string()),
        ("Origin".to_string(), origin.clone()),
        ("Referer".to_string(), format!("{origin}/")),
    ];

    // 鉴权族：只带有值的（个人账号没有 enterprise / department）。
    //
    // 企业账号还需要 `X-Enterprise-Id` / `X-Tenant-Id` / `X-Department-Info`，
    // 但本期只面向个人 WorkBuddy 账号（导入链路也不落这两个字段），因此这里
    // 不猜。真要支持企业账号时，落库要一起加字段，而不是在这里凭空补头 ——
    // 缺一个头时上游的拒绝是 401，看起来像「token 坏了」，极难查。
    if !account.uid.is_empty() {
        headers.push(("X-User-Id".to_string(), account.uid.clone()));
    }
    headers.push((
        "Authorization".to_string(),
        format!("Bearer {}", account.auth.access_token),
    ));
    if !account.auth.domain.is_empty() {
        headers.push(("X-Domain".to_string(), account.auth.domain.clone()));
    } else {
        headers.push(("X-Domain".to_string(), authority));
    }

    headers
}

/// 首条消息不是 system 时补一条（返回是否真的插入了）。
///
/// `developer` 会先被归一成 `system`（上游不认 `developer`，且先归一才判得准
/// 「首条已经是 system」）。
pub fn ensure_leading_system(body: &mut Value) -> bool {
    let Some(messages) = body.get_mut("messages").and_then(Value::as_array_mut) else {
        return false;
    };
    let Some(first) = messages.first_mut() else {
        return false;
    };
    let role = first
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if role == "developer" {
        if let Some(object) = first.as_object_mut() {
            object.insert("role".to_string(), json!("system"));
        }
        return false;
    }
    if role == "system" {
        return false;
    }
    messages.insert(
        0,
        json!({ "role": "system", "content": DEFAULT_SYSTEM_PROMPT }),
    );
    true
}

/// 上游错误分类。前端按 `kind` 决定文案与「要不要重试」。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChatError {
    /// 额度 / 并发用尽：不重试，提示稍后或换模型。
    Quota { message: String },
    /// 凭证失效：刷新后同账号重试一次。
    TokenExpired { message: String },
    /// 提示词命中风控：不换账号（同一份 body 换谁发都会被拦），提示改提示词。
    Waf { message: String },
    /// 模型名上游不认：刷新目录后重试一次。
    ModelNotFound { message: String },
    /// 其它：原样透传。
    Passthrough { status: u16, message: String },
}

impl ChatError {
    /// 稳定的机器可读标识（前端的 `error.kind`）。
    pub fn kind(&self) -> &'static str {
        match self {
            ChatError::Quota { .. } => "quota",
            ChatError::TokenExpired { .. } => "token_expired",
            ChatError::Waf { .. } => "waf",
            ChatError::ModelNotFound { .. } => "model_not_found",
            ChatError::Passthrough { .. } => "upstream",
        }
    }

    pub fn message(&self) -> &str {
        match self {
            ChatError::Quota { message }
            | ChatError::TokenExpired { message }
            | ChatError::Waf { message }
            | ChatError::ModelNotFound { message }
            | ChatError::Passthrough { message, .. } => message,
        }
    }

    pub fn status(&self) -> u16 {
        match self {
            ChatError::Quota { .. } => 429,
            ChatError::TokenExpired { .. } => 401,
            ChatError::Waf { .. } => 400,
            ChatError::ModelNotFound { .. } => 400,
            ChatError::Passthrough { status, .. } => *status,
        }
    }

    /// 要不要刷新 token 后重试（只有过期这一种）。
    pub fn retry_after_refresh(&self) -> bool {
        matches!(self, ChatError::TokenExpired { .. })
    }
}

/// 按 HTTP 状态 + 响应体分类。
pub fn classify(status: u16, body: &Value) -> ChatError {
    let code = body
        .get("code")
        .and_then(Value::as_i64)
        .or_else(|| body.get("error").and_then(|error| error.get("code")).and_then(Value::as_i64));
    let upstream_message = body
        .get("message")
        .or_else(|| body.get("msg"))
        .or_else(|| body.get("error").and_then(|error| error.get("message")))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let message = if upstream_message.is_empty() {
        format!("上游返回 {status}")
    } else {
        format!("上游返回 {status}: {upstream_message}")
    };

    if code == Some(CODE_QUOTA_LIMIT) {
        return ChatError::Quota {
            message: format!("{message}（额度或并发已用尽，请稍后再试或换模型）"),
        };
    }
    if code == Some(CODE_WAF_BLOCK) || message.contains("敏感词") {
        return ChatError::Waf {
            message: format!("{message}；提示词可能命中上游敏感词，请检查提示词"),
        };
    }
    if status == 401 || status == 403 {
        return ChatError::TokenExpired {
            message: format!("{message}（登录态可能已失效）"),
        };
    }
    if status == 429 {
        return ChatError::Quota {
            message: format!("{message}（请求过于频繁或额度受限）"),
        };
    }
    let lower = message.to_ascii_lowercase();
    if status == 400 && (lower.contains("model") || code == Some(404)) {
        return ChatError::ModelNotFound {
            message: format!("{message}（模型不可用，可能已下线或改名）"),
        };
    }
    ChatError::Passthrough { status, message }
}

/// 错误 → 给前端的 OpenAI 形状错误体。
pub fn error_body(error: &ChatError) -> Value {
    json!({
        "error": {
            "message": error.message(),
            "type": error.kind(),
            "code": error.status(),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workbuddy::accounts::{Account, Auth};
    use crate::workbuddy::endpoints::Edition;
    fn account() -> Account {
        let auth = Auth {
            access_token: "AT".to_string(),
            refresh_token: "RT".to_string(),
            expires_at: 0,
            refresh_expires_at: 0,
            domain: "www.workbuddy.cn".to_string(),
        };
        Account::from_login(Edition::CN, "uid-1", "小明", auth)
    }

    fn header<'a>(headers: &'a [(String, String)], name: &str) -> &'a str {
        headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
            .unwrap_or_else(|| panic!("缺少请求头 {name}"))
    }

    #[test]
    fn injects_system_only_when_missing() {
        let mut body = json!({"messages":[{"role":"user","content":"hi"}]});
        assert!(ensure_leading_system(&mut body));
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][0]["content"], DEFAULT_SYSTEM_PROMPT);
        assert_eq!(body["messages"].as_array().unwrap().len(), 2);

        let mut already = json!({"messages":[
            {"role":"system","content":"s"},{"role":"user","content":"u"}]});
        assert!(!ensure_leading_system(&mut already));
        assert_eq!(already["messages"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn developer_role_is_normalized_without_inserting() {
        let mut body = json!({"messages":[{"role":"developer","content":"d"}]});
        assert!(!ensure_leading_system(&mut body));
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn empty_or_missing_messages_is_left_alone() {
        let mut empty = json!({"messages":[]});
        assert!(!ensure_leading_system(&mut empty));
        let mut missing = json!({});
        assert!(!ensure_leading_system(&mut missing));
    }

    #[test]
    fn headers_carry_identity_and_auth() {
        let headers = build_headers(&account(), &Trace::new());
        assert_eq!(header(&headers, "X-IDE-Type"), "WorkBuddy");
        assert_eq!(header(&headers, "X-IDE-Version"), "5.5.4");
        assert_eq!(header(&headers, "X-Product"), "SaaS");
        assert_eq!(header(&headers, "Origin"), "https://copilot.tencent.com");
        assert_eq!(header(&headers, "Referer"), "https://copilot.tencent.com/");
        assert_eq!(header(&headers, "Authorization"), "Bearer AT");
        assert_eq!(header(&headers, "X-User-Id"), "uid-1");
        assert_eq!(header(&headers, "X-Domain"), "www.workbuddy.cn");
        assert!(header(&headers, "User-Agent").contains("CLI/2.137.1"));
    }

    #[test]
    fn trace_headers_are_consistent_within_one_round() {
        let trace = Trace::new();
        let headers = build_headers(&account(), &trace);
        let traceparent = header(&headers, "traceparent");
        assert!(traceparent.starts_with(&format!("00-{}-", trace.trace_id)));
        assert_eq!(header(&headers, "X-Trace-ID"), trace.trace_id);
        assert_eq!(header(&headers, "X-Request-ID"), trace.message_id);
        assert_eq!(
            header(&headers, "X-Root-Request-ID"),
            header(&headers, "X-Conversation-Request-ID")
        );
        assert_eq!(trace.span_id.len(), 16);
    }

    #[test]
    fn domain_falls_back_to_authority() {
        let mut account = account();
        account.auth.domain.clear();
        let headers = build_headers(&account, &Trace::new());
        assert_eq!(header(&headers, "X-Domain"), "copilot.tencent.com");
    }

    #[test]
    fn classifies_quota_waf_and_passthrough() {
        assert!(matches!(
            classify(429, &json!({})),
            ChatError::Quota { .. }
        ));
        assert!(matches!(
            classify(400, &json!({"code": 6004})),
            ChatError::Quota { .. }
        ));
        assert!(matches!(
            classify(400, &json!({"code": -117})),
            ChatError::Waf { .. }
        ));
        assert!(matches!(
            classify(401, &json!({})),
            ChatError::TokenExpired { .. }
        ));
        assert!(matches!(
            classify(500, &json!({})),
            ChatError::Passthrough { status: 500, .. }
        ));
        assert!(matches!(
            classify(400, &json!({"message": "model not found"})),
            ChatError::ModelNotFound { .. }
        ));
    }

    #[test]
    fn only_token_expiry_asks_for_refresh_retry() {
        assert!(classify(401, &json!({})).retry_after_refresh());
        assert!(!classify(429, &json!({})).retry_after_refresh());
    }

    #[test]
    fn error_body_is_openai_shaped() {
        let body = error_body(&ChatError::Quota {
            message: "额度用尽".to_string(),
        });
        assert_eq!(body["error"]["type"], "quota");
        assert_eq!(body["error"]["code"], 429);
        assert_eq!(body["error"]["message"], "额度用尽");
    }
}
