//! token 续期：`POST {endpoint}/v2/auth/token/refresh`。
//!
//! ── 为什么必须用「账号自己的」端点 ───────────────────────────
//! 国内版的 refreshToken 拿到国际版站点去换必然 401。所以续期请求的 URL 一律
//! 取自账号记录里的 `endpoint`（导入链路会写死文件自带的站点），而不是当前
//! 会话的版本常量。
//!
//! ── 单飞（single-flight）─────────────────────────────────────
//! 同一账号同时只允许一次真实刷新：并发两次刷新会让上游依次作废前一个
//! refreshToken（部分上游一次一换），后到的那个把账号刷成死状态。这里用一张
//! 进程级占位表，重复请求直接返回「正在刷新」，由调用方决定是等待还是放弃 ——
//! 报错比静默复用结果更容易定位问题，且刷新本身很快。
//!
//! ── 刷新结果的合并口径 ──────────────────────────────────────
//! 上游可能只回 `accessToken`（refreshToken 不变），也可能连 refreshToken 一起
//! 换新。因此：新值优先，缺失则保留旧值；到期时间按 `expiresIn` 秒换算。

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};

use super::accounts::{now_ms, Account, Auth};

/// 刷新提前量：到期前 5 分钟就换新。
pub const REFRESH_MARGIN_MS: i64 = 5 * 60 * 1000;

/// 进程级占位表：正在刷新的账号 id。
fn inflight() -> &'static Mutex<HashSet<String>> {
    static INFLIGHT: std::sync::OnceLock<Mutex<HashSet<String>>> = std::sync::OnceLock::new();
    INFLIGHT.get_or_init(|| Mutex::new(HashSet::new()))
}

/// 这个账号现在该不该刷新（到期前 5 分钟内，或根本没有到期时间但 token 为空）。
pub fn should_refresh(auth: &Auth, now: i64) -> bool {
    if auth.access_token.trim().is_empty() {
        return true;
    }
    auth.is_expiring(now, REFRESH_MARGIN_MS)
}

/// 用账号自己的 refreshToken 换一组新凭证。
pub async fn refresh(account: &Account) -> Result<Auth, String> {
    if account.auth.refresh_token.trim().is_empty() {
        return Err("这个账号没有 refreshToken，无法自动续期，请重新登录".to_string());
    }

    {
        let mut table = inflight()
            .lock()
            .map_err(|_| "刷新状态锁失效，请重试".to_string())?;
        if !table.insert(account.id.clone()) {
            return Err(format!(
                "账号 {} 的凭证正在刷新中，请稍后重试",
                account.display_name()
            ));
        }
    }

    let result = refresh_inner(account).await;

    if let Ok(mut table) = inflight().lock() {
        table.remove(&account.id);
    }
    result
}

async fn refresh_inner(account: &Account) -> Result<Auth, String> {
    let endpoint = if account.endpoint.trim().is_empty() {
        account.edition().endpoint.to_string()
    } else {
        account.endpoint.trim_end_matches('/').to_string()
    };
    let url = format!("{endpoint}/v2/auth/token/refresh");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("初始化 HTTP 客户端失败：{error}"))?;

    let mut request = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("X-Refresh-Token", account.auth.refresh_token.clone())
        .header("X-Auth-Refresh-Source", "plugin")
        .header("X-Domain", domain_for(account))
        .json(&json!({}));

    if let Ok(ua) = reqwest::header::HeaderValue::from_str(account.edition().ua) {
        request = request.header(reqwest::header::USER_AGENT, ua);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("刷新登录态失败：{error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取刷新响应失败：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "刷新登录态失败：上游返回 {status}（{}）",
            super::accounts::tail(&text, 200)
        ));
    }
    let body: Value =
        serde_json::from_str(&text).map_err(|_| "刷新登录态的响应不是 JSON".to_string())?;

    let code = body.get("code").and_then(Value::as_i64).unwrap_or(0);
    if code != 0 {
        let message = body
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("刷新被上游拒绝");
        return Err(format!("刷新登录态失败：{message}（业务码 {code}）"));
    }
    let data = body
        .get("data")
        .cloned()
        .unwrap_or_else(|| Value::Object(Default::default()));

    let access_token = data
        .get("accessToken")
        .and_then(Value::as_str)
        .unwrap_or("");
    if access_token.is_empty() {
        return Err("刷新登录态的响应缺少 accessToken".to_string());
    }

    Ok(merge(account, &data, access_token))
}

fn merge(account: &Account, data: &Value, access_token: &str) -> Auth {
    let refresh_token = data
        .get("refreshToken")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|token| !token.is_empty())
        .unwrap_or_else(|| account.auth.refresh_token.clone());

    let expires_in = data.get("expiresIn").and_then(Value::as_i64).unwrap_or(0);
    let expires_at = data
        .get("expiresAt")
        .and_then(Value::as_i64)
        .filter(|value| *value > 0)
        .map(normalize)
        .unwrap_or_else(|| {
            if expires_in > 0 {
                now_ms() + expires_in * 1000
            } else {
                // 上游没给有效期：按 2 小时估（官方客户端的实际形态），
                // 宁可多刷一次也不要「用着一个不知道该不该刷的 token」。
                now_ms() + 2 * 3600 * 1000
            }
        });

    let refresh_expires_in = data
        .get("refreshExpiresIn")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let refresh_expires_at = if refresh_expires_in > 0 {
        now_ms() + refresh_expires_in * 1000
    } else {
        account.auth.refresh_expires_at
    };

    Auth {
        access_token: access_token.to_string(),
        refresh_token,
        expires_at,
        refresh_expires_at,
        domain: data
            .get("domain")
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| account.auth.domain.clone()),
    }
}

fn normalize(value: i64) -> i64 {
    if value > 0 && value < 100_000_000_000 {
        value * 1000
    } else {
        value
    }
}

fn domain_for(account: &Account) -> String {
    if !account.auth.domain.is_empty() {
        return account.auth.domain.clone();
    }
    let endpoint = if account.endpoint.trim().is_empty() {
        account.edition().endpoint
    } else {
        account.endpoint.as_str()
    };
    endpoint
        .split_once("://")
        .map(|(_, rest)| rest.to_string())
        .unwrap_or_else(|| endpoint.to_string())
        .split('/')
        .next()
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workbuddy::endpoints::Edition;
    use crate::workbuddy::test_support::StubServer;

    /// 每个用例用不同的 uid：单飞占位表按账号 id 记，共用一个 id 会让并行跑的
    /// 用例互相看到「正在刷新中」—— 那是测试并行化的假象，不是产品缺陷。
    fn account_with(endpoint: &str, uid: &str) -> Account {
        let auth = Auth {
            access_token: "OLD".to_string(),
            refresh_token: "RT".to_string(),
            expires_at: now_ms() - 1000,
            refresh_expires_at: 0,
            domain: "www.workbuddy.cn".to_string(),
        };
        let mut account = Account::from_login(Edition::CN, uid, "小明", auth);
        account.endpoint = endpoint.to_string();
        account
    }

    #[test]
    fn should_refresh_uses_margin() {
        let now = now_ms();
        let mut auth = Auth {
            access_token: "a".to_string(),
            refresh_token: "r".to_string(),
            expires_at: now + 60_000,
            refresh_expires_at: 0,
            domain: String::new(),
        };
        assert!(should_refresh(&auth, now), "距到期 1 分钟应当刷新");
        auth.expires_at = now + 3600_000;
        assert!(!should_refresh(&auth, now));
        auth.expires_at = 0;
        assert!(!should_refresh(&auth, now), "上游没给到期时间时不要盲目刷新");
        auth.access_token = String::new();
        assert!(should_refresh(&auth, now));
    }

    #[tokio::test]
    async fn refresh_returns_new_tokens() {
        let stub = StubServer::spawn(vec![(
            200,
            json!({"code":0,"data":{
                "accessToken":"NEW-AT","refreshToken":"NEW-RT","expiresIn":7200
            }})
            .to_string(),
        )]);
        let account = account_with(&stub.base, "uid-refresh-a");
        let auth = refresh(&account).await.unwrap();
        assert_eq!(auth.access_token, "NEW-AT");
        assert_eq!(auth.refresh_token, "NEW-RT");
        assert!(auth.expires_at > now_ms());
    }

    #[tokio::test]
    async fn refresh_keeps_old_refresh_token_when_absent() {
        let stub = StubServer::spawn(vec![(
            200,
            json!({"code":0,"data":{"accessToken":"NEW-AT","expiresIn":60}}).to_string(),
        )]);
        let account = account_with(&stub.base, "uid-refresh-b");
        let auth = refresh(&account).await.unwrap();
        assert_eq!(auth.refresh_token, "RT", "上游没换 refreshToken 时要保留旧的");
    }

    #[tokio::test]
    async fn refresh_reports_business_error() {
        let stub = StubServer::spawn(vec![(
            200,
            json!({"code":11212,"message":"登录态已过期"}).to_string(),
        )]);
        let account = account_with(&stub.base, "uid-refresh-c");
        let error = refresh(&account).await.unwrap_err();
        assert!(error.contains("登录态已过期"), "{error}");
    }

    #[tokio::test]
    async fn refresh_requires_refresh_token() {
        let mut account = account_with("http://127.0.0.1:9", "uid-refresh-d");
        account.auth.refresh_token.clear();
        let error = refresh(&account).await.unwrap_err();
        assert!(error.contains("重新登录"));
    }
}
