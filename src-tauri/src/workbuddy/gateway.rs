//! 进程内的最小 OpenAI 兼容网关：把 WorkBuddy 伪装成一个普通供应方。
//!
//! ── 为什么要有这一层（而不是再加一个前端 transport）────────────
//! WorkBuddy 是标准 OpenAI 协议的上游，只是鉴权与请求头是它私有的。做成
//! 「本地 OpenAI 端点」之后，QMAI 前端的模型列表、连通性测试、流式对话、中断、
//! 上下文超限裁剪、`max_tokens` 降级、用量统计**全部复用既有代码**，一行不改。
//! 如果改成一个新的 transport，这些行为要么重写一遍，要么从此只有 WorkBuddy
//! 用不上它们 —— 对长篇写作这种「动辄几十万 token」的场景，裁剪与降级不是可选项。
//!
//! ── 安全边界（就三条）───────────────────────────────────────
//!   1. 只绑 `127.0.0.1`，端口取 `0`（内核分配），**不固定 3065** ——
//!      用户可能自己装着一个 Agent2API，抢端口会让两边都莫名其妙。
//!   2. 每个进程一份随机令牌，随启动生成、只存在内存与主窗口的 IPC 返回值里。
//!      端口是随机的、令牌是随机的，本机其它进程要同时猜中两者才能用。
//!   3. 不开 CORS：QMAI 走 `@tauri-apps/plugin-http`（不是浏览器 fetch），
//!      不开也能通；开了反而让任意网页能借这个端点花用户的额度。
//!
//! ── 只实现对话需要的三条路由 ─────────────────────────────────
//!   `GET /health`（壳侧探活）、`GET /v1/models`、`POST /v1/chat/completions`
//! `/v1/responses` 与 `/v1/messages` 不做：QMAI 只走 chat 一条线，多实现两条
//! 就等于多两套要跟着上游变的协议。
//!
//! ── 上游 SSE 原样透传 ───────────────────────────────────────
//! WorkBuddy 的响应本身就是 OpenAI chat SSE，所以这里**不解析、不重组**，
//! 直接 `Body::from_stream` 把字节流转出去 —— 少一层改写就少一处会吃掉
//! `[DONE]`、吃掉空行保活帧、或把 usage 帧弄丢的地方。

use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use super::accounts::{now_ms, AccountStore};
use super::chat::{self, ChatError};
use super::endpoints::Edition;
use super::models::ModelCache;
use super::refresh;

/// 网关共享状态。
#[derive(Clone)]
pub struct GatewayState {
    /// 本次进程的访问令牌（随机 32 字节的十六进制）。
    pub token: String,
    /// 账号仓库（与设置页共用同一份内存状态）。
    pub store: Arc<Mutex<AccountStore>>,
    /// 模型目录（与设置页共用同一份内存状态）。
    pub cache: Arc<Mutex<ModelCache>>,
}

/// 已经起来的网关。
pub struct GatewayHandle {
    pub base_url: String,
    pub token: String,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

impl GatewayHandle {
    /// 前端拿去拼 `customEndpoint` 的值（`http://127.0.0.1:<port>/v1`）。
    pub fn v1_base(&self) -> String {
        format!("{}/v1", self.base_url)
    }

    /// 停掉网关（测试与退出时用）。
    pub fn shutdown(mut self) {
        if let Some(sender) = self.shutdown.take() {
            let _ = sender.send(());
        }
    }
}

impl Drop for GatewayHandle {
    fn drop(&mut self) {
        if let Some(sender) = self.shutdown.take() {
            let _ = sender.send(());
        }
    }
}

/// 起一个网关，绑 `127.0.0.1:0`。
pub async fn start(state: GatewayState) -> Result<GatewayHandle, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("WorkBuddy 网关无法监听本机端口：{error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("读取网关端口失败：{error}"))?;

    let app = router(state.clone());
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        let served = axum::serve(listener, app).with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        });
        if let Err(error) = served.await {
            super::logging::warn(&format!("WorkBuddy 网关退出：{error}"));
        }
    });

    Ok(GatewayHandle {
        base_url: format!("http://127.0.0.1:{}", address.port()),
        token: state.token,
        shutdown: Some(shutdown_tx),
    })
}

pub fn router(state: GatewayState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/models", get(models))
        .route("/v1/chat/completions", post(chat_completions))
        .with_state(state)
}

async fn health() -> Response {
    Json(json!({ "ok": true, "provider": "workbuddy" })).into_response()
}

async fn models(State(state): State<GatewayState>, headers: HeaderMap) -> Response {
    if let Err(response) = guard(&state, &headers) {
        return response;
    }
    let (models, provider) = {
        let cache = match state.cache.lock() {
            Ok(cache) => cache,
            Err(_) => return internal("模型目录状态不可用"),
        };
        (
            cache.models().to_vec(),
            cache.edition_provider().to_string(),
        )
    };
    Json(super::models::to_openai_list(&models, &provider)).into_response()
}

async fn chat_completions(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    if let Err(response) = guard(&state, &headers) {
        return response;
    }

    let mut payload: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(error) => return bad_request(format!("请求体不是合法 JSON：{error}")),
    };
    let model = payload
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if model.is_empty() {
        return bad_request("请求体缺少 model".to_string());
    }
    let wants_stream = payload
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    // 模型必须先出现在广告目录里：这条与其它 provider 的口径一致
    // （列表里看不到的模型不允许点名），也让「卡片里选了什么就能用什么」成立。
    let known = {
        let cache = match state.cache.lock() {
            Ok(cache) => cache,
            Err(_) => return internal("模型目录状态不可用"),
        };
        cache.contains(&model)
    };
    if !known {
        let error = ChatError::ModelNotFound {
            message: format!("模型 {model} 不在 WorkBuddy 的可用清单里，请在模型设置里重新拉取"),
        };
        return error_response(&error);
    }

    // 取账号 + 必要时先续期（续期是网络动作，**不在锁内**做）。
    let account = match current_account(&state) {
        Ok(Some(account)) => account,
        Ok(None) => {
            return json_response(
                StatusCode::CONFLICT,
                json!({"error": {"message": "还没有登录 WorkBuddy 账号，请先在模型设置里添加账号", "type": "no_account", "code": 409}}),
            )
        }
        Err(message) => return internal(&message),
    };

    let account = if refresh::should_refresh(&account.auth, now_ms()) {
        match super::refresh::refresh(&account).await {
            Ok(auth) => match replace_auth(&state, &account.id, auth) {
                Ok(updated) => updated,
                Err(message) => return internal(&message),
            },
            Err(error) => {
                return error_response(&ChatError::TokenExpired {
                    message: format!("刷新登录态失败：{error}"),
                })
            }
        }
    } else {
        account
    };

    let mut attempts = 0;
    let mut account = account;
    loop {
        attempts += 1;
        let response = send_upstream(&account, &mut payload, wants_stream).await;
        match response {
            Ok(response) => return response,
            Err(error) => {
                // 凭证过期：刷新一次再试一遍（第二次失败才报错，避免死循环）
                if error.retry_after_refresh() && attempts == 1 {
                    match super::refresh::refresh(&account).await {
                        Ok(auth) => match replace_auth(&state, &account.id, auth) {
                            Ok(updated) => {
                                account = updated;
                                continue;
                            }
                            Err(message) => return internal(&message),
                        },
                        Err(refresh_error) => {
                            return error_response(&ChatError::TokenExpired {
                                message: format!("登录态失效且续期失败：{refresh_error}"),
                            })
                        }
                    }
                }
                return error_response(&error);
            }
        }
    }
}

/// 发一次上游请求，按 `wants_stream` 决定透传还是聚合。
async fn send_upstream(
    account: &super::accounts::Account,
    payload: &mut Value,
    wants_stream: bool,
) -> Result<Response, ChatError> {
    // 首条不是 system 时补一条（上游硬要求，见 `chat::ensure_leading_system`）。
    chat::ensure_leading_system(payload);
    // 上游不支持非流式（业务码 11101），一律按流式请求，需要 JSON 时自己聚合。
    if let Some(object) = payload.as_object_mut() {
        object.insert("stream".to_string(), json!(true));
    }

    let endpoint = if account.endpoint.trim().is_empty() {
        account.edition().endpoint.to_string()
    } else {
        account.endpoint.trim_end_matches('/').to_string()
    };
    let url = format!("{endpoint}/v2/chat/completions");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|error| ChatError::Passthrough {
            status: 500,
            message: format!("初始化 HTTP 客户端失败：{error}"),
        })?;

    let trace = chat::Trace::new();
    let mut request = client.post(&url);
    for (name, value) in chat::build_headers(account, &trace) {
        if let (Ok(header_name), Ok(header_value)) = (
            reqwest::header::HeaderName::from_bytes(name.as_bytes()),
            reqwest::header::HeaderValue::from_str(&value),
        ) {
            request = request.header(header_name, header_value);
        }
    }
    let response = request
        .json(payload)
        .send()
        .await
        .map_err(|error| ChatError::Passthrough {
            status: 502,
            message: format!("连接 WorkBuddy 上游失败：{error}"),
        })?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let parsed: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({ "message": text }));
        return Err(chat::classify(status.as_u16(), &parsed));
    }

    if wants_stream {
        let stream = response.bytes_stream();
        let body = Body::from_stream(stream);
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/event-stream")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(body)
            .map_err(|error| ChatError::Passthrough {
                status: 500,
                message: format!("构造流式响应失败：{error}"),
            });
    }

    let text = response.text().await.unwrap_or_default();
    Ok(Json(aggregate(&text)).into_response())
}

/// 把一段 OpenAI chat SSE 聚合成一条完整回复（`stream:false` 的退路）。
///
/// 只拼接 `choices[0].delta.content` 与工具调用，忽略其它帧 —— 这个函数存在的
/// 意义是「用 curl 调网关做排障」，不是给前端用的路径。
pub fn aggregate(sse: &str) -> Value {
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut finish_reason: Option<String> = None;
    let mut usage = Value::Null;
    let mut id = String::from("chatcmpl-workbuddy");
    let mut model = String::new();

    for line in sse.lines() {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(chunk) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        if let Some(value) = chunk.get("id").and_then(Value::as_str) {
            id = value.to_string();
        }
        if let Some(value) = chunk.get("model").and_then(Value::as_str) {
            model = value.to_string();
        }
        if !chunk.get("usage").map(Value::is_null).unwrap_or(true) {
            usage = chunk.get("usage").cloned().unwrap_or(Value::Null);
        }
        let Some(choice) = chunk.get("choices").and_then(|c| c.get(0)) else {
            continue;
        };
        if let Some(delta) = choice.get("delta") {
            if let Some(text) = delta.get("content").and_then(Value::as_str) {
                content.push_str(text);
            }
            if let Some(text) = delta.get("reasoning_content").and_then(Value::as_str) {
                reasoning.push_str(text);
            }
        }
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            finish_reason = Some(reason.to_string());
        }
    }

    let mut message = json!({ "role": "assistant", "content": content });
    if !reasoning.is_empty() {
        if let Some(object) = message.as_object_mut() {
            object.insert("reasoning_content".to_string(), json!(reasoning));
        }
    }
    let mut response = json!({
        "id": id,
        "object": "chat.completion",
        "created": now_ms() / 1000,
        "model": model,
        "choices": [{ "index": 0, "message": message, "finish_reason": finish_reason }],
    });
    if !usage.is_null() {
        if let Some(object) = response.as_object_mut() {
            object.insert("usage".to_string(), usage);
        }
    }
    response
}

fn current_account(state: &GatewayState) -> Result<Option<super::accounts::Account>, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "账号状态锁失效".to_string())?;
    Ok(store.current())
}

fn replace_auth(
    state: &GatewayState,
    id: &str,
    auth: super::accounts::Auth,
) -> Result<super::accounts::Account, String> {
    let mut store = state
        .store
        .lock()
        .map_err(|_| "账号状态锁失效".to_string())?;
    store.update_auth(id, auth)?;
    store
        .get(id)
        .ok_or_else(|| format!("账号不存在：{id}"))
}

/// 令牌校验：只比 `Authorization: Bearer <token>`。
fn guard(state: &GatewayState, headers: &HeaderMap) -> Result<(), Response> {
    let provided = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim_start_matches("Bearer ").trim().to_string())
        .or_else(|| {
            headers
                .get("x-api-key")
                .and_then(|value| value.to_str().ok())
                .map(|value| value.trim().to_string())
        })
        .unwrap_or_default();
    if provided == state.token {
        return Ok(());
    }
    Err(json_response(
        StatusCode::UNAUTHORIZED,
        json!({"error": {"message": "invalid gateway token", "type": "unauthorized", "code": 401}}),
    ))
}

fn error_response(error: &ChatError) -> Response {
    let status = StatusCode::from_u16(error.status()).unwrap_or(StatusCode::BAD_GATEWAY);
    json_response(status, chat::error_body(error))
}

fn bad_request(message: String) -> Response {
    json_response(
        StatusCode::BAD_REQUEST,
        json!({"error": {"message": message, "type": "invalid_request", "code": 400}}),
    )
}

fn internal(message: &str) -> Response {
    json_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({"error": {"message": message, "type": "internal", "code": 500}}),
    )
}

fn json_response(status: StatusCode, body: Value) -> Response {
    (status, Json(body)).into_response()
}

/// 供命令层构造一个默认版本目录（缓存为空时也要能回 list）。
pub fn fallback_cache(edition: Edition) -> Vec<super::models::ModelInfo> {
    super::models::builtin_for(edition)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workbuddy::accounts::{Account, Auth};
    use crate::workbuddy::test_support::{temp_dir, StubServer};

    const SSE: &str = "data: {\"id\":\"c1\",\"model\":\"deepseek-v4.1-flash\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"你\"}}]}\n\n\
data: {\"id\":\"c1\",\"model\":\"deepseek-v4.1-flash\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"好\"},\"finish_reason\":\"stop\"}]}\n\n\
data: [DONE]\n\n";

    struct Fixture {
        gateway: GatewayHandle,
        _stub: StubServer,
        _dir: std::path::PathBuf,
    }

    async fn fixture(responses: Vec<(u16, String)>, with_account: bool) -> Fixture {
        let stub = StubServer::spawn(responses);
        let dir = temp_dir();
        let mut store = AccountStore::load(&dir).unwrap();
        if with_account {
            let auth = Auth {
                access_token: "AT".to_string(),
                refresh_token: "RT".to_string(),
                expires_at: now_ms() + 3_600_000,
                refresh_expires_at: 0,
                domain: "www.workbuddy.cn".to_string(),
            };
            let mut account = Account::from_login(Edition::CN, "uid-1", "小明", auth);
            account.endpoint = stub.base.clone();
            store.upsert(account).unwrap();
        }
        let mut cache = ModelCache::load(&dir, "workbuddy");
        cache.store(vec![super::super::models::ModelInfo {
            id: "deepseek-v4.1-flash".to_string(),
            name: "Flash".to_string(),
            max_input: 262_144,
            max_output: 65_536,
            supports_tool_call: true,
            supports_reasoning: true,
            is_default: true,
        }]);
        let gateway = start(GatewayState {
            token: "test-token".to_string(),
            store: Arc::new(Mutex::new(store)),
            cache: Arc::new(Mutex::new(cache)),
        })
        .await
        .unwrap();
        Fixture {
            gateway,
            _stub: stub,
            _dir: dir,
        }
    }

    #[tokio::test]
    async fn rejects_without_token_and_serves_models_with_token() {
        let fixture = fixture(vec![], true).await;
        let client = reqwest::Client::new();

        let unauthorized = client
            .get(format!("{}/v1/models", fixture.gateway.base_url))
            .send()
            .await
            .unwrap();
        assert_eq!(unauthorized.status(), 401);

        let ok = client
            .get(format!("{}/v1/models", fixture.gateway.base_url))
            .bearer_auth("test-token")
            .send()
            .await
            .unwrap();
        assert_eq!(ok.status(), 200);
        let body: Value = ok.json().await.unwrap();
        assert_eq!(body["object"], "list");
        assert_eq!(body["data"][0]["owned_by"], "workbuddy");
    }

    #[tokio::test]
    async fn health_needs_no_token() {
        let fixture = fixture(vec![], false).await;
        let response = reqwest::Client::new()
            .get(format!("{}/health", fixture.gateway.base_url))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
    }

    #[tokio::test]
    async fn unknown_model_is_rejected_before_hitting_upstream() {
        let fixture = fixture(vec![], true).await;
        let response = reqwest::Client::new()
            .post(format!("{}/v1/chat/completions", fixture.gateway.base_url))
            .bearer_auth("test-token")
            .json(&json!({"model":"nope","messages":[{"role":"user","content":"hi"}]}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 400);
        let body: Value = response.json().await.unwrap();
        assert_eq!(body["error"]["type"], "model_not_found");
    }

    #[tokio::test]
    async fn no_account_yields_conflict() {
        let fixture = fixture(vec![], false).await;
        let response = reqwest::Client::new()
            .post(format!("{}/v1/chat/completions", fixture.gateway.base_url))
            .bearer_auth("test-token")
            .json(&json!({"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hi"}]}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 409);
    }

    #[tokio::test]
    async fn streams_upstream_sse_through() {
        let fixture = fixture(vec![(200, SSE.to_string())], true).await;
        let response = reqwest::Client::new()
            .post(format!("{}/v1/chat/completions", fixture.gateway.base_url))
            .bearer_auth("test-token")
            .json(&json!({
                "model": "deepseek-v4.1-flash",
                "stream": true,
                "messages": [{"role": "user", "content": "hi"}]
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(
            response.headers()[header::CONTENT_TYPE].to_str().unwrap(),
            "text/event-stream"
        );
        let body = response.text().await.unwrap();
        assert!(body.contains("data: [DONE]"));
        assert!(body.contains("你"));
    }

    #[tokio::test]
    async fn non_stream_request_is_aggregated() {
        let fixture = fixture(vec![(200, SSE.to_string())], true).await;
        let response = reqwest::Client::new()
            .post(format!("{}/v1/chat/completions", fixture.gateway.base_url))
            .bearer_auth("test-token")
            .json(&json!({
                "model": "deepseek-v4.1-flash",
                "stream": false,
                "messages": [{"role": "user", "content": "hi"}]
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let body: Value = response.json().await.unwrap();
        assert_eq!(body["choices"][0]["message"]["content"], "你好");
        assert_eq!(body["choices"][0]["finish_reason"], "stop");
    }

    #[tokio::test]
    async fn upstream_quota_is_mapped_to_429() {
        let fixture = fixture(vec![(429, json!({"code":6004,"message":"limit"}).to_string())], true).await;
        let response = reqwest::Client::new()
            .post(format!("{}/v1/chat/completions", fixture.gateway.base_url))
            .bearer_auth("test-token")
            .json(&json!({"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"hi"}]}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 429);
        let body: Value = response.json().await.unwrap();
        assert_eq!(body["error"]["type"], "quota");
    }

    #[test]
    fn aggregate_concatenates_deltas() {
        let value = aggregate(SSE);
        assert_eq!(value["choices"][0]["message"]["content"], "你好");
        assert_eq!(value["choices"][0]["finish_reason"], "stop");
        assert_eq!(value["object"], "chat.completion");
    }
}
