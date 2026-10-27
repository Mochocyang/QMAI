//! 网页登录：`auth/state` → 轮询 `auth/token` → `login/account` → 一条 [`Credential`]。
//!
//! ── 这一家的登录为什么不需要回调 ─────────────────────────────
//! 官方链路是「服务端记 state，浏览器只在官方页面里登录」。于是：
//!   ① 网关匿名 `POST {endpoint}/v2/plugin/auth/state?platform=…` 拿到 `{state, authUrl}`；
//!   ② 用户在内嵌窗口或系统浏览器里打开 `authUrl` 完成登录（这一步我们完全不参与）；
//!   ③ 网关每 3 秒 `GET …/auth/token?state=`；未完成时上游回业务码 `11217`；
//!   ④ 拿到 accessToken 后 `GET …/login/account?state=` 取昵称/uid。
//! 因为凭证由**我们自己轮询回来**，所以「内嵌窗口」与「系统浏览器」两种打开方式
//! 共用同一段等待逻辑，壳侧没有任何回调要处理 —— 也就不需要注册自定义协议。
//!
//! ── 身份的三层兜底 ─────────────────────────────────────────
//! `login/account` 是网络调用，可能挂/超时。实测过「浏览器授权成功、token 也拿到了，
//! 只因为紧接着的资料接口连不上，用户看到『登录成功但获取账号信息失败』」。
//! 身份本来就在 token 里（Keycloak 风格 JWT 的 `sub` 就是账号主键），所以：
//!   ① `login/account` 的 `uid`
//!   ② `/accounts` 里最近登录过的那条
//!   ③ accessToken 的 JWT 声明（`sub` / `preferred_username`）
//! 资料接口全挂只会少一个昵称，不会让一次成功登录作废。
//!
//! ── 取消语义 ──────────────────────────────────────────────
//! 取消**不**中断 HTTP 请求，只在每拍轮询前检查 `canceled` 标记 —— 与「用户关掉
//! 窗口」这个真实动作语义等价，且不需要处理 reqwest 的中断错误分类。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde_json::{json, Value};

use super::accounts::{now_ms, Account, Auth};
use super::endpoints::{Edition, ANONYMOUS_HEADERS, CODE_RETRY_FETCH_TOKEN};

/// 轮询间隔（上游 side 的推荐节拍，官方客户端同款）。
pub const POLL_INTERVAL: Duration = Duration::from_secs(3);

/// 整轮登录的超时（用户去扫码/输密码/开二次验证，5 分钟够用）。
pub const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// 一次登录的开始信息（前端拿它去开窗口）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoginStart {
    pub state: String,
    pub auth_url: String,
    pub edition: String,
    pub provider: String,
}

/// 登录成功后交出来的东西（**内含凭证，不许跨 IPC**）。
#[derive(Clone, Debug)]
pub struct Credential {
    pub uid: String,
    pub nickname: String,
    pub auth: Auth,
}

/// 单次轮询的结果。
pub enum Poll {
    /// 用户还没登录完。
    Pending,
    /// 拿到了凭证。
    Ready(Credential),
}

/// 一条登录流程。`endpoint` 可覆盖（staging、自建反代、测试替身）。
pub struct LoginFlow {
    edition: Edition,
    endpoint: String,
    client: reqwest::Client,
}

impl LoginFlow {
    pub fn new(edition: Edition) -> LoginFlow {
        LoginFlow::with_endpoint(edition, edition.endpoint)
    }

    /// 用自定义端点（测试替身 / staging）。
    pub fn with_endpoint(edition: Edition, endpoint: &str) -> LoginFlow {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        LoginFlow {
            edition,
            endpoint: endpoint.trim_end_matches('/').to_string(),
            client,
        }
    }

    fn auth_url(&self, path: &str) -> String {
        format!(
            "{}/v2{}{}",
            self.endpoint, self.edition.prefix_path, path
        )
    }

    /// 第 ①步：要一个 state 与登录地址。
    pub async fn start(&self) -> Result<LoginStart, String> {
        let url = self.auth_url(&format!("/auth/state?platform={}", self.edition.platform));
        let response = self
            .client
            .post(&url)
            .headers(anonymous_header_map()?)
            .json(&json!({}))
            .send()
            .await
            .map_err(|error| format!("请求登录地址失败：{error}"))?;
        let body = read_json(response).await?;
        let data = unwrap_envelope(&body, "auth/state")?;

        let state = data
            .get("state")
            .or_else(|| data.get("authState"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let auth_url = data
            .get("authUrl")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if state.is_empty() || auth_url.is_empty() {
            return Err("上游没有返回登录地址（state/authUrl 缺失），请稍后重试".to_string());
        }
        Ok(LoginStart {
            state,
            auth_url,
            edition: self.edition.id.to_string(),
            provider: self.edition.provider_id().to_string(),
        })
    }

    /// 第 ③④步：轮询一次。
    ///
    /// 返回 `Pending` 表示「用户还没登录完」（含上游 11217、网络错误、5xx —— 这些
    /// 都只是这一拍没成，不该让整轮登录失败，超时由调用方控制）。
    pub async fn poll_once(&self, state: &str) -> Result<Poll, String> {
        let url = self.auth_url(&format!("/auth/token?state={state}"));
        let response = match self
            .client
            .get(&url)
            .headers(anonymous_header_map()?)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                super::logging::warn(&format!("登录轮询网络错误（继续等待）：{error}"));
                return Ok(Poll::Pending);
            }
        };

        let body = match read_json(response).await {
            Ok(body) => body,
            Err(error) => {
                super::logging::warn(&format!("登录轮询响应异常（继续等待）：{error}"));
                return Ok(Poll::Pending);
            }
        };

        let code = body.get("code").and_then(Value::as_i64).unwrap_or(0);
        if code == CODE_RETRY_FETCH_TOKEN {
            return Ok(Poll::Pending);
        }
        let data = match unwrap_envelope(&body, "auth/token") {
            Ok(data) => data,
            Err(error) => {
                // 上游的其它业务码在这一步通常是「还没授权完」，按 pending 处理；
                // 真正的失败（401/账号被禁）由外层超时兜底，且用户在窗口里能看到。
                super::logging::warn(&format!("登录轮询业务码异常（继续等待）：{error}"));
                return Ok(Poll::Pending);
            }
        };

        let access_token = data
            .get("accessToken")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if access_token.is_empty() {
            return Ok(Poll::Pending);
        }

        let auth = Auth {
            access_token: access_token.clone(),
            refresh_token: data
                .get("refreshToken")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            expires_at: expires_at_of(&data),
            refresh_expires_at: expires_at_of_field(&data, "refreshExpiresIn"),
            domain: data
                .get("domain")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        };

        // ④ 取资料（昵称）。失败不致命 —— 身份还有两层兜底。
        let (mut uid, mut nickname) = (String::new(), String::new());
        match self.fetch_login_account(&access_token, state).await {
            Ok(account) => {
                uid = account
                    .get("uid")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                nickname = account
                    .get("nickname")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
            }
            Err(error) => {
                super::logging::warn(&format!("取登录账号资料失败（不影响登录）：{error}"));
            }
        }

        if uid.is_empty() {
            if let Some(account) = self.fetch_first_account(&access_token).await {
                uid = account
                    .get("uid")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                if nickname.is_empty() {
                    nickname = account
                        .get("nickname")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                }
            }
        }

        if uid.is_empty() {
            if let Some((sub, name)) = claims_of(&access_token) {
                super::logging::info("资料接口没给出 uid，已回退用 access token 的 JWT 声明");
                uid = sub;
                if nickname.is_empty() {
                    nickname = name;
                }
            }
        }

        if uid.is_empty() {
            return Err("登录成功但拿不到账号标识（uid），请重试".to_string());
        }

        Ok(Poll::Ready(Credential {
            uid,
            nickname,
            auth,
        }))
    }

    /// 完整等待：按 [`POLL_INTERVAL`] 轮询，直到成功、取消或超时。
    ///
    /// `is_canceled` 每拍被问一次；返回 `Err` 时前端按「取消 / 失败」分别提示。
    pub async fn wait(
        &self,
        state: &str,
        is_canceled: impl Fn() -> bool,
    ) -> Result<Credential, WaitError> {
        let deadline = tokio::time::Instant::now() + LOGIN_TIMEOUT;
        while tokio::time::Instant::now() < deadline {
            if is_canceled() {
                return Err(WaitError::Canceled);
            }
            tokio::time::sleep(POLL_INTERVAL).await;
            if is_canceled() {
                return Err(WaitError::Canceled);
            }
            match self.poll_once(state).await {
                Ok(Poll::Ready(credential)) => return Ok(credential),
                Ok(Poll::Pending) => continue,
                Err(error) => return Err(WaitError::Failed(error)),
            }
        }
        Err(WaitError::Timeout)
    }

    async fn fetch_login_account(&self, token: &str, state: &str) -> Result<Value, String> {
        let url = self.auth_url(&format!("/login/account?state={state}"));
        let response = self
            .client
            .get(&url)
            .headers(bearer_headers(token)?)
            .send()
            .await
            .map_err(|error| format!("{error}"))?;
        let body = read_json(response).await?;
        unwrap_envelope(&body, "login/account")
    }

    async fn fetch_first_account(&self, token: &str) -> Option<Value> {
        let url = self.auth_url("/accounts");
        let response = self
            .client
            .get(&url)
            .headers(bearer_headers(token).ok()?)
            .send()
            .await
            .ok()?;
        let body = read_json(response).await.ok()?;
        let data = unwrap_envelope(&body, "accounts").ok()?;
        let accounts = data
            .get("accounts")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        accounts
            .iter()
            .find(|item| item.get("lastLogin").map(|v| !v.is_null()).unwrap_or(false))
            .or_else(|| accounts.first())
            .cloned()
    }
}

/// 等待失败的三种原因（前端文案不同：超时 ≠ 取消 ≠ 真错）。
#[derive(Debug)]
pub enum WaitError {
    Timeout,
    Canceled,
    Failed(String),
}

impl WaitError {
    pub fn message(&self) -> String {
        match self {
            WaitError::Timeout => "登录等待超时（5 分钟），请重新发起".to_string(),
            WaitError::Canceled => "登录已取消".to_string(),
            WaitError::Failed(message) => message.clone(),
        }
    }

    pub fn canceled(&self) -> bool {
        matches!(self, WaitError::Canceled)
    }
}

fn anonymous_header_map() -> Result<reqwest::header::HeaderMap, String> {
    let mut map = reqwest::header::HeaderMap::new();
    for (name, value) in ANONYMOUS_HEADERS {
        let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("请求头名非法：{error}"))?;
        let header_value = reqwest::header::HeaderValue::from_str(value)
            .map_err(|error| format!("请求头值非法：{error}"))?;
        map.insert(header_name, header_value);
    }
    Ok(map)
}

fn bearer_headers(token: &str) -> Result<reqwest::header::HeaderMap, String> {
    let mut map = anonymous_header_map()?;
    let value = reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|error| format!("请求头值非法：{error}"))?;
    map.insert(reqwest::header::AUTHORIZATION, value);
    Ok(map)
}

async fn read_json(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取响应失败：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "上游返回 {status}：{}",
            super::accounts::tail(&text, 200)
        ));
    }
    serde_json::from_str(&text).map_err(|_| "上游返回的不是 JSON".to_string())
}

/// 拆 `{code, message, data}` 信封；`code != 0` 视为业务错误。
fn unwrap_envelope(body: &Value, label: &str) -> Result<Value, String> {
    let code = body.get("code").and_then(Value::as_i64);
    match code {
        Some(0) | None => Ok(body
            .get("data")
            .cloned()
            .unwrap_or_else(|| Value::Object(Default::default()))),
        Some(code) => {
            let message = body
                .get("message")
                .or_else(|| body.get("msg"))
                .and_then(Value::as_str)
                .unwrap_or("");
            Err(format!("{label} 返回业务码 {code}：{message}"))
        }
    }
}

/// `expiresIn`（秒）→ 毫秒时间戳；上游已给 `expiresAt` 时用它。
fn expires_at_of(data: &Value) -> i64 {
    if let Some(existing) = data.get("expiresAt").and_then(Value::as_i64) {
        if existing > 0 {
            return normalize_timestamp(existing);
        }
    }
    expires_at_of_field(data, "expiresIn")
}

fn expires_at_of_field(data: &Value, field: &str) -> i64 {
    let seconds = data.get(field).and_then(Value::as_i64).unwrap_or(0);
    if seconds <= 0 {
        return 0;
    }
    now_ms() + seconds * 1000
}

/// 上游有的链路给秒、有的给毫秒；小于 10^11 的当秒处理（2026 年的毫秒值约 1.7e12）。
fn normalize_timestamp(value: i64) -> i64 {
    if value > 0 && value < 100_000_000_000 {
        value * 1000
    } else {
        value
    }
}

/// 解 JWT 的 payload（**不验签**：能不能用由上游说了算，我们只取身份）。
///
/// 返回 `(sub, preferred_username|nickname|email)`。
pub fn claims_of(token: &str) -> Option<(String, String)> {
    let mut parts = token.split('.');
    let _header = parts.next()?;
    let payload = parts.next()?;
    let raw = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let claims: Value = serde_json::from_slice(&raw).ok()?;
    let sub = claims.get("sub").and_then(Value::as_str)?.trim().to_string();
    if sub.is_empty() {
        return None;
    }
    let name = ["preferred_username", "nickname", "email"]
        .iter()
        .find_map(|key| claims.get(*key).and_then(Value::as_str))
        .unwrap_or("")
        .to_string();
    Some((sub, name))
}

/// 一次登录的任务表：`state → 状态`。
///
/// 命令层用它把「后台在轮询」与「前端来问结果」解耦：`start` 起一个 tokio 任务，
/// `wait` 只读状态。取消是给任务置标记（见模块头）。
#[derive(Default)]
pub struct LoginTasks {
    inner: Mutex<HashMap<String, Arc<Mutex<TaskState>>>>,
}

pub struct TaskState {
    /// 这一轮登录的起始信息（state / authUrl / 版本）。
    ///
    /// 命令层只按 state 查询、不读它；留着是为了排障时能从任务表复原「这一轮
    /// 是哪家、打开的是哪个地址」，以及将来加「登录历史」时不必再补一次结构。
    #[allow(dead_code)]
    pub start: LoginStart,
    pub status: TaskStatus,
    pub canceled: bool,
    pub finished_at: Option<i64>,
}

#[derive(Clone, Debug)]
pub enum TaskStatus {
    Pending,
    Ready { uid: String, nickname: String },
    Failed(String),
}

impl LoginTasks {
    pub fn register(&self, start: LoginStart) -> Arc<Mutex<TaskState>> {
        let handle = Arc::new(Mutex::new(TaskState {
            start: start.clone(),
            status: TaskStatus::Pending,
            canceled: false,
            finished_at: None,
        }));
        if let Ok(mut table) = self.inner.lock() {
            // 顺手清掉 10 分钟前结束的任务，避免长时间运行后表无限增长。
            let cutoff = now_ms() - 10 * 60 * 1000;
            table.retain(|_, item| match item.lock() {
                Ok(state) => state.finished_at.map(|at| at > cutoff).unwrap_or(true),
                Err(_) => true,
            });
            table.insert(start.state.clone(), handle.clone());
        }
        handle
    }

    pub fn get(&self, state: &str) -> Option<Arc<Mutex<TaskState>>> {
        self.inner.lock().ok()?.get(state).cloned()
    }

    /// 取消：返回 false 表示没有这个 state（已过期或从未存在）。
    pub fn cancel(&self, state: &str) -> bool {
        let Some(handle) = self.get(state) else {
            return false;
        };
        if let Ok(mut task) = handle.lock() {
            task.canceled = true;
            task.finished_at = Some(now_ms());
            return true;
        }
        false
    }

    pub fn set_ready(&self, state: &str, credential: &Credential) {
        if let Some(handle) = self.get(state) {
            if let Ok(mut task) = handle.lock() {
                task.status = TaskStatus::Ready {
                    uid: credential.uid.clone(),
                    nickname: credential.nickname.clone(),
                };
                task.finished_at = Some(now_ms());
            }
        }
    }

    pub fn set_failed(&self, state: &str, message: &str) {
        if let Some(handle) = self.get(state) {
            if let Ok(mut task) = handle.lock() {
                task.status = TaskStatus::Failed(message.to_string());
                task.finished_at = Some(now_ms());
            }
        }
    }
}

/// 把一次成功的登录变成账号记录。
pub fn account_from_credential(edition: Edition, credential: &Credential) -> Account {
    Account::from_login(
        edition,
        &credential.uid,
        &credential.nickname,
        credential.auth.clone(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workbuddy::test_support::StubServer;

    fn state_body() -> String {
        json!({"code": 0, "data": {
            "state": "state-1",
            "authUrl": "https://copilot.tencent.com/login?state=state-1"
        }})
        .to_string()
    }

    fn pending_body() -> String {
        json!({"code": 11217, "message": "登录中"}).to_string()
    }

    fn token_body() -> String {
        json!({"code": 0, "data": {
            "accessToken": "AT-1",
            "refreshToken": "RT-1",
            "expiresIn": 7200,
            "refreshExpiresIn": 86400,
            "domain": "www.workbuddy.cn"
        }})
        .to_string()
    }

    fn account_body() -> String {
        json!({"code": 0, "data": {"uid": "uid-1", "nickname": "小明"}}).to_string()
    }

    #[tokio::test]
    async fn start_returns_state_and_url() {
        let stub = StubServer::spawn(vec![(200, state_body())]);
        let flow = LoginFlow::with_endpoint(Edition::CN, &stub.base);
        let start = flow.start().await.unwrap();
        assert_eq!(start.state, "state-1");
        assert!(start.auth_url.contains("state-1"));
        assert_eq!(start.provider, "workbuddy");
        assert_eq!(start.edition, "cn");
    }

    #[tokio::test]
    async fn start_fails_when_upstream_omits_fields() {
        let stub = StubServer::spawn(vec![(200, json!({"code":0,"data":{}}).to_string())]);
        let flow = LoginFlow::with_endpoint(Edition::CN, &stub.base);
        assert!(flow.start().await.unwrap_err().contains("登录地址"));
    }

    #[tokio::test]
    async fn pending_then_ready() {
        let stub = StubServer::spawn(vec![
            (200, pending_body()),
            (200, token_body()),
            (200, account_body()),
        ]);
        let flow = LoginFlow::with_endpoint(Edition::CN, &stub.base);
        assert!(matches!(flow.poll_once("state-1").await.unwrap(), Poll::Pending));
        match flow.poll_once("state-1").await.unwrap() {
            Poll::Ready(credential) => {
                assert_eq!(credential.uid, "uid-1");
                assert_eq!(credential.nickname, "小明");
                assert_eq!(credential.auth.access_token, "AT-1");
                assert!(credential.auth.expires_at > now_ms());
                assert_eq!(credential.auth.domain, "www.workbuddy.cn");
            }
            Poll::Pending => panic!("第二次轮询应当拿到凭证"),
        }
    }

    #[tokio::test]
    async fn uid_falls_back_to_jwt_subject_when_profile_endpoint_dies() {
        // token 里带 sub，login/account 与 /accounts 都失败（替身只够回两次）
        let stub = StubServer::spawn(vec![(200, token_body_with_jwt()), (500, "{}".to_string())]);
        let flow = LoginFlow::with_endpoint(Edition::CN, &stub.base);
        match flow.poll_once("state-1").await.unwrap() {
            Poll::Ready(credential) => {
                assert_eq!(credential.uid, "sub-from-token");
                assert_eq!(credential.nickname, "token-user");
            }
            Poll::Pending => panic!("应当靠 JWT 兜底成功"),
        }
    }

    #[tokio::test]
    async fn network_error_is_pending_not_failure() {
        // 没有替身：端口上没人听 → 连接失败应视为 pending
        let flow = LoginFlow::with_endpoint(Edition::CN, "http://127.0.0.1:9");
        assert!(matches!(flow.poll_once("s").await.unwrap(), Poll::Pending));
    }

    #[tokio::test]
    async fn wait_reports_cancel_immediately() {
        // 不排替身：取消判定发生在任何网络请求之前，这条路径必须是瞬时的。
        let flow = LoginFlow::with_endpoint(Edition::CN, "http://127.0.0.1:9");
        let error = flow.wait("state-1", || true).await.unwrap_err();
        assert!(error.canceled());
        assert_eq!(error.message(), "登录已取消");
    }

    #[test]
    fn claims_are_decoded_without_verification() {
        let token = make_jwt(json!({"sub": "sub-1", "preferred_username": "名字"}));
        assert_eq!(
            claims_of(&token),
            Some(("sub-1".to_string(), "名字".to_string()))
        );
        assert_eq!(claims_of("not-a-jwt"), None);
    }

    #[test]
    fn task_table_tracks_ready_and_cancel() {
        let tasks = LoginTasks::default();
        let start = LoginStart {
            state: "s".to_string(),
            auth_url: "u".to_string(),
            edition: "cn".to_string(),
            provider: "workbuddy".to_string(),
        };
        let handle = tasks.register(start);
        assert!(matches!(handle.lock().unwrap().status, TaskStatus::Pending));
        tasks.set_ready(
            "s",
            &Credential {
                uid: "u1".to_string(),
                nickname: "n".to_string(),
                auth: Auth {
                    access_token: "a".to_string(),
                    refresh_token: String::new(),
                    expires_at: 0,
                    refresh_expires_at: 0,
                    domain: String::new(),
                },
            },
        );
        assert!(matches!(
            handle.lock().unwrap().status,
            TaskStatus::Ready { .. }
        ));
        assert!(tasks.cancel("s"));
        assert!(handle.lock().unwrap().canceled);
        assert!(!tasks.cancel("missing"));
    }

    fn make_jwt(claims: Value) -> String {
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"none"}"#);
        let payload = URL_SAFE_NO_PAD.encode(claims.to_string().as_bytes());
        format!("{header}.{payload}.sig")
    }

    fn token_body_with_jwt() -> String {
        json!({"code": 0, "data": {
            "accessToken": make_jwt(json!({"sub": "sub-from-token", "preferred_username": "token-user"})),
            "refreshToken": "RT-2",
            "expiresIn": 3600
        }})
        .to_string()
    }
}
