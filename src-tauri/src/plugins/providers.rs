//! 插件 provider 的运行期注册表：端口分配、`/health` 探活、`/v1/models` 抓取。
//!
//! 这里只回答一个问题：**宿主怎么确认插件真的能当模型供应商**。
//! 端点路径是固定契约（`/health`、`/v1/models`、`/v1/chat/completions`），
//! 清单里没有「自定义路径」字段 —— 可配置路径会把「OpenAI 兼容」变成 N 套私有协议
//! （设计 3.1 / 4.1）。
//!
//! **token 只活在内存**：`PluginProvider.token` 从不落盘，给前端的 `ProviderView`
//! 里根本没有这个字段（v2.0 实施计划第 0 节）。请求前由前端调
//! `plugins_provider_auth` 现取。

use serde::{Deserialize, Serialize};

use super::manifest;

/// 插件提供的模型（来自运行期 `GET /v1/models`，不是清单）。
///
/// 真源是运行期端点而不是 `plugin.json` 里的 `models`：两份真源必然漂移
/// （设计 D2，与 v1「工具真源是 tools/list」同一取舍）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub id: String,
    pub name: String,
    /// 上下文窗口。**必需**：剪裁依赖它，缺了会导致长篇静默截断或 400（设计 3.4）。
    pub max_input_tokens: i64,
    pub max_output_tokens: i64,
    pub supports_tool_call: bool,
    pub supports_vision: bool,
    /// 只用于界面显示上游倍率，QMAI 不参与计费。
    pub credit_multiplier: Option<f64>,
    /// 上游成本（每百万 token）。只用于界面展示与「贵不贵」的判断，QMAI **不参与计费**。
    ///
    /// 与 `credit_multiplier` 并存是刻意的：倍率是「相对上游套餐的折扣」，成本是「绝对
    /// 单价」，两者的口径完全不同（有的插件只知道倍率，有的只知道单价）。缺省即「作者
    /// 没声明」，界面不显示这一格 —— 不猜、不填 0（0 会被读成「免费」）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<ModelCost>,
    /// 支持的输入模态（`"text"` / `"image"` / `"audio"`）。缺省视为 `["text"]`。
    ///
    /// 前端按空 vec 处理成「只有文本」，所以这里不替作者补 `"text"`：补了会掩盖
    /// 「作者声明了 `["audio"]` 却漏了 text」这类错误声明。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub input_modalities: Vec<String>,
}

/// 上游成本（每百万 token 的单价，币种由插件自己决定，QMAI 只负责显示）。
///
/// 四个字段全可选：多数上游只公布 input/output，缓存命中价常常缺。用可空而不是 0，
/// 是为了让界面区分「免费」与「没公布」（0 会显示成「免费」，那是在替上游撒谎）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelCost {
    pub input: Option<f64>,
    pub output: Option<f64>,
    pub cache_read: Option<f64>,
    pub cache_write: Option<f64>,
}

impl ModelCost {
    /// 是否至少声明了一项。
    ///
    /// 全空的 `cost: {}` 等于没声明：留成 `Some(ModelCost::default())` 会让界面渲染出一个
    /// 四格全是「—」的成本区，看上去像是「这项功能坏了」。
    fn is_declared(&self) -> bool {
        self.input.is_some()
            || self.output.is_some()
            || self.cache_read.is_some()
            || self.cache_write.is_some()
    }
}

/// 一个已就绪（或探测中/失败）的插件 provider。token 只活在内存。
// 手写 Debug 而不是 derive：token 是插件凭证（能凭它白嫖用户账号额度），
// 绝不能出现在任何日志里。将来有人 `tracing::debug!("{:?}", provider)` 时，
// derive 会把 token 一起带出去，而这条路径没人会去 review。
#[derive(Clone)]
pub struct PluginProvider {
    pub plugin_id: String,
    pub provider_id: String,
    pub name: String,
    /// `http://127.0.0.1:<port>` —— 端口由宿主分配（设计 D4），插件只绑回环。
    pub base_url: String,
    /// 宿主生成的随机令牌，插件必须校验它（否则本机任何进程都能白嫖用户额度）。
    pub token: String,
    pub capabilities: Vec<String>,
    pub settings_page: Option<String>,
    /// 受控登录窗口的导航白名单（清单 `authDomains`，主机后缀）。
    ///
    /// 只在宿主侧用：它决定那个窗口能去哪些域名，**不进** `ProviderView`（前端不需要，
    /// 少一份数据就少一次「前端以为自己能做白名单判断」的误用）。
    pub auth_domains: Vec<String>,
    pub auth_kind: String,
    /// 运行期 `GET /v1/models` 的结果；探活/抓取失败时为空。
    pub models: Vec<ProviderModel>,
    pub ready: bool,
    pub last_error: Option<String>,
}

impl std::fmt::Debug for PluginProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // token 是插件凭证（能凭它白嫖用户账号额度），绝不能出现在任何日志里。
        // 手写 Debug 而不是 derive：将来有人 tracing::debug!("{:?}", provider) 时，
        // derive 会把 token 一起带出去，而这条路径没人会去 review。
        f.debug_struct("PluginProvider")
            .field("plugin_id", &self.plugin_id)
            .field("provider_id", &self.provider_id)
            .field("name", &self.name)
            .field("base_url", &self.base_url)
            .field("token", &"<redacted>")
            .field("capabilities", &self.capabilities)
            .field("settings_page", &self.settings_page)
            .field("auth_domains", &self.auth_domains)
            .field("auth_kind", &self.auth_kind)
            .field("models", &self.models)
            .field("ready", &self.ready)
            .field("last_error", &self.last_error)
            .finish()
    }
}

/// 给前端看的视图：**没有 token**。
///
/// 与 `PluginProvider` 分开定义而不是给 token 加 `#[serde(skip)]`：加 skip 时
/// 一旦有人把 `PluginProvider` 整个塞进某个返回值，token 就跟着出去了。
/// 两个类型、逐字段搬，漏搬 token 是编译期看不出来、但序列化结果里绝不存在的。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    pub plugin_id: String,
    pub provider_id: String,
    pub name: String,
    pub base_url: String,
    pub auth_kind: String,
    pub capabilities: Vec<String>,
    pub settings_page: Option<String>,
    pub models: Vec<ProviderModel>,
    pub ready: bool,
    pub last_error: Option<String>,
}

impl PluginProvider {
    pub fn view(&self) -> ProviderView {
        ProviderView {
            plugin_id: self.plugin_id.clone(),
            provider_id: self.provider_id.clone(),
            name: self.name.clone(),
            base_url: self.base_url.clone(),
            auth_kind: self.auth_kind.clone(),
            capabilities: self.capabilities.clone(),
            settings_page: self.settings_page.clone(),
            models: self.models.clone(),
            ready: self.ready,
            last_error: self.last_error.clone(),
        }
    }
}

/// 清单里的 `authKind` 转成前端契约字符串。与 `manifest::AuthKind` 的 serde
/// 命名（kebab-case）保持一致 —— 两处写法必须能对上，否则前端按 authKind 分支会落空。
pub fn auth_kind_name(kind: manifest::AuthKind) -> &'static str {
    match kind {
        manifest::AuthKind::None => "none",
        manifest::AuthKind::BrowserLogin => "browser-login",
        manifest::AuthKind::PasteToken => "paste-token",
        manifest::AuthKind::ImportFile => "import-file",
    }
}

/// 让内核分配一个空闲端口，然后**立刻释放**交给插件去绑。
///
/// 这个小窗口存在竞争（别的进程可能抢占），所以调用方必须靠后续 `/health` 探活确认；
/// 探活失败就报错，而不是假定绑成功。为什么不固定端口：见设计 D4 ——
/// 用户本机可能已装 Agent2API 之类的服务，抢端口会让两边都莫名其妙。
pub fn allocate_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| format!("无法分配插件端口：{e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);
    Ok(port)
}

/// 轮询 `/health` 直到通过或超时。
///
/// 插件刚 spawn 完还没开始监听是正常的，所以是轮询而不是一次性请求。
pub async fn wait_until_healthy(
    client: &reqwest::Client,
    base_url: &str,
    timeout: std::time::Duration,
) -> Result<(), String> {
    const INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);

    let url = format!("{}/health", base_url.trim_end_matches('/'));
    let started = std::time::Instant::now();
    // 超时时要把最后一次失败原因带出去：只说「超时」的话，用户分不清是插件没监听、
    // 还是插件起了但返回 500 —— 两种是完全不同的作者问题。
    let mut last_error = String::from("尚未收到任何响应");
    // 一旦拿到过 HTTP 状态码，就不再让后续的传输层错误把它盖掉：状态码是插件作者
    // 能直接修的信息（我的 /health 返回了 500），而预算末尾那次 1ms 超时只是我们的
    // 计时到了，拿它当「最后一次错误」会把真正的原因藏起来。
    let mut saw_http_status = false;
    loop {
        let remaining = timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            break;
        }
        // 单次尝试的预算 = 剩余总预算。插件若接受了连接却不回包，不能被 client 的
        // 60s 总超时拖住整个启动流程（探活预算是 startTimeoutMs，通常 10s）。
        let attempt = client.get(&url).timeout(remaining).send().await;
        match attempt {
            Ok(response) if response.status().is_success() => return Ok(()),
            Ok(response) => {
                last_error = format!("{url} 返回 {}", response.status().as_u16());
                saw_http_status = true;
            }
            Err(error) => {
                if !saw_http_status {
                    last_error = format!("请求 {url} 失败：{error}");
                }
            }
        }
        if started.elapsed() >= timeout {
            break;
        }
        tokio::time::sleep(INTERVAL).await;
    }
    Err(format!(
        "插件在 {} ms 内未通过 /health 探活（最后一次：{last_error}）",
        timeout.as_millis()
    ))
}

/// `GET /v1/models` 并解析。缺 `maxInputTokens` / `maxOutputTokens` 的模型被丢弃并记 warning。
pub async fn fetch_models(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
) -> Result<Vec<ProviderModel>, String> {
    let url = format!("{}/v1/models", base_url.trim_end_matches('/'));
    let response = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("请求 {url} 失败：{e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{url} 返回 {}", status.as_u16()));
    }
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析 {url} 响应失败：{e}"))?;
    Ok(models_from_payload(&payload, base_url))
}

/// `_qmai.cost` 的解析：要么四项至少有一项，要么算「没声明」。
///
/// 解析失败（字段类型写错，如 `"input": "0.5"`）也归入「没声明」而不是丢掉整个模型：
/// 成本只影响显示，而模型本身还能用 —— 为了一个展示字段把用户的模型砍掉是更坏的取舍。
fn cost_from(extended: Option<&serde_json::Value>) -> Option<ModelCost> {
    let raw = extended.and_then(|value| value.get("cost"))?;
    let cost = serde_json::from_value::<ModelCost>(raw.clone()).ok()?;
    cost.is_declared().then_some(cost)
}

/// `_qmai.inputModalities` 的解析：只收非空字符串，统一小写去空白。
///
/// 归一化是必要的：`"Image"` 与 `"image"` 若被当成两个值，`supportsVision` 的推导就会
/// 因作者的大小写习惯而随机失效。
fn input_modalities_from(extended: Option<&serde_json::Value>) -> Vec<String> {
    extended
        .and_then(|value| value.get("inputModalities"))
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(|item| item.trim().to_ascii_lowercase())
                .filter(|item| !item.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// `/v1/models` 响应体的解析（纯函数，便于不起网络就覆盖丢弃规则）。
///
/// `provider` 只用于 warning 文案 —— 丢弃模型是有代价的（用户会觉得「插件少给了模型」），
/// 日志里必须能看出是哪一家、哪个模型。
fn models_from_payload(payload: &serde_json::Value, provider: &str) -> Vec<ProviderModel> {
    let Some(items) = payload.get("data").and_then(serde_json::Value::as_array) else {
        // 不是 OpenAI 兼容形状：返回空列表而不是报错，界面上该 provider 只是没有模型，
        // 而探活结果（ready）与原因仍能显示出来，比整条命令失败更好排障。
        return Vec::new();
    };

    let mut models = Vec::new();
    for item in items {
        let Some(id) = item
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty())
        else {
            // 没有 id 的条目无法构成复合键 providerId/modelId，跳过。
            continue;
        };
        let extended = item.get("_qmai");
        let max_input_tokens = extended
            .and_then(|value| value.get("maxInputTokens"))
            .and_then(serde_json::Value::as_i64);
        let max_output_tokens = extended
            .and_then(|value| value.get("maxOutputTokens"))
            .and_then(serde_json::Value::as_i64);
        let (Some(max_input_tokens), Some(max_output_tokens)) =
            (max_input_tokens, max_output_tokens)
        else {
            // 设计 3.4 契约硬要求：上下文裁剪依赖窗口大小，缺失时报错的位置离作者
            // 写清单的地方很远（表现为长篇被静默截断或 400），所以只能丢弃 + 记日志。
            eprintln!(
                "[plugins] provider {provider} 的模型 {id} 未同时声明 maxInputTokens 与 maxOutputTokens，已丢弃（上下文裁剪依赖它，缺失会导致长篇静默截断或请求超限 400）"
            );
            continue;
        };
        let name = extended
            .and_then(|value| value.get("displayName"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(id)
            .to_string();
        let input_modalities = input_modalities_from(extended);
        let declared_vision = extended
            .and_then(|value| value.get("supportsVision"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        models.push(ProviderModel {
            id: id.to_string(),
            name,
            max_input_tokens,
            max_output_tokens,
            // 能力位缺省 false：没声明就不该给用户「这个模型能工具调用」的错觉。
            supports_tool_call: extended
                .and_then(|value| value.get("supportsToolCall"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false),
            // 两者冲突时**以 `inputModalities` 为准**：它更细粒度，含 `"image"` 就是作者在
            // 明说「这个模型能读图」。反过来若只认 `supportsVision`，一个写了模态却忘开
            // 开关的模型会被界面判成「不能读图」，用户贴图后请求直接被上游拒（400），
            // 而错误发生在离清单很远的地方。放宽方向是安全的：多报一项能力只是多给一个
            // 按钮，漏报则会让可用功能静默消失。
            supports_vision: declared_vision || input_modalities.iter().any(|m| m == "image"),
            credit_multiplier: extended
                .and_then(|value| value.get("creditMultiplier"))
                .and_then(serde_json::Value::as_f64),
            cost: cost_from(extended),
            input_modalities,
        });
    }
    models
}

/// 允许宿主代转的能力端点（设计 4.4）。**白名单，不是任意 URL**。
///
/// 为什么必须写死这两个：这条命令的入参来自前端（而前端可能被插件页面/内容包影响），
/// 一旦允许任意 `endpoint` 字符串，宿主的 token 就会被送到 `base_url` 之外的任何路径上，
/// 甚至用 `../` 之类的拼接逃出 provider 的命名空间 —— 那就是一个「通用本机请求器」。
pub const CAPABILITY_ENDPOINTS: &[&str] = &["/v1/_qmai/balance", "/v1/_qmai/checkin"];

/// `endpoint` 是否在白名单内（纯函数，便于不起进程就覆盖）。
pub fn capability_endpoint_allowed(endpoint: &str) -> bool {
    CAPABILITY_ENDPOINTS.contains(&endpoint)
}

/// 转发一个能力端点，返回插件给的 JSON（QMAI 只渲染，不理解语义）。
///
/// `body` 原样转发：设计 4.4 里两个端点都是 POST，但插件可能想收上下文（如账号标识），
/// 宿主不解释它 —— 解释就要跟着每个插件的语义跑，那就不是契约了。
pub async fn call_capability(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    endpoint: &str,
    body: Option<&serde_json::Value>,
) -> Result<serde_json::Value, String> {
    if !capability_endpoint_allowed(endpoint) {
        return Err(format!("不支持的能力端点：{endpoint}"));
    }
    let url = format!("{}{}", base_url.trim_end_matches('/'), endpoint);
    let mut request = client.post(&url).bearer_auth(token);
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("请求 {url} 失败：{e}"))?;
    let status = response.status();
    if !status.is_success() {
        // 带状态码 + 响应体前 200 字：插件作者排查「能力没实现」时，状态码区分
        // 「没这个端点（404）」与「实现崩了（500）」，body 里通常有插件自己的错误文案。
        let text = response.text().await.unwrap_or_default();
        let preview: String = text.chars().take(200).collect();
        return Err(format!("{url} 返回 {}：{preview}", status.as_u16()));
    }
    response
        .json()
        .await
        .map_err(|e| format!("解析 {url} 响应失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex as StdMutex};
    use std::time::Duration;

    /// 极简本机 HTTP 桩：固定状态码 + 固定 body，并记录收到的请求头。
    ///
    /// 用真实 TCP 而不是 mock 客户端：`wait_until_healthy` / `fetch_models` 走的是
    /// 真实 reqwest 路径（连接、头、状态码），trait mock 会把最容易坏的那部分绕过去。
    struct StubHttp {
        base: String,
        requests: Arc<StdMutex<Vec<String>>>,
        handle: Option<std::thread::JoinHandle<()>>,
    }

    impl StubHttp {
        fn spawn(status: u16, body: &str) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("绑定桩端口失败");
            let port = listener.local_addr().expect("读取桩端口").port();
            let requests = Arc::new(StdMutex::new(Vec::new()));
            let captured = Arc::clone(&requests);
            let body = body.to_string();
            let handle = std::thread::spawn(move || {
                // 一直服务：探活会反复请求同一个端点，桩不能只回一次。
                for stream in listener.incoming() {
                    let Ok(mut stream) = stream else { return };
                    let mut buffer = [0u8; 8192];
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    captured
                        .lock()
                        .expect("请求记录锁")
                        .push(String::from_utf8_lossy(&buffer[..read]).to_string());
                    let response = format!(
                        "HTTP/1.1 {status} Stub\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.as_bytes().len()
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                }
            });
            Self {
                base: format!("http://127.0.0.1:{port}"),
                requests,
                handle: Some(handle),
            }
        }

        fn requests(&self) -> Vec<String> {
            self.requests.lock().expect("请求记录锁").clone()
        }
    }

    impl Drop for StubHttp {
        fn drop(&mut self) {
            // 不 join：桩线程阻塞在 accept() 上，join 会把「用例已跑完」变成
            // 「测试框架超时」。线程随测试进程退出即可（与本仓 workbuddy::test_support 同理）。
            let _ = self.handle.take();
        }
    }

    fn http_client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("构造 reqwest client")
    }

    fn sample_provider() -> PluginProvider {
        PluginProvider {
            plugin_id: "wb-connect".to_string(),
            provider_id: "wb-connect".to_string(),
            name: "WorkBuddy 插件".to_string(),
            base_url: "http://127.0.0.1:51235".to_string(),
            token: "super-secret-provider-token".to_string(),
            capabilities: vec!["models.refresh".to_string()],
            settings_page: Some("/login".to_string()),
            auth_domains: vec!["workbuddy.cn".to_string()],
            auth_kind: "none".to_string(),
            models: vec![ProviderModel {
                id: "glm-5.3".to_string(),
                name: "GLM-5.3".to_string(),
                max_input_tokens: 200_000,
                max_output_tokens: 8_192,
                supports_tool_call: true,
                supports_vision: false,
                credit_multiplier: Some(0.79),
                cost: None,
                input_modalities: Vec::new(),
            }],
            ready: true,
            last_error: None,
        }
    }

    #[test]
    fn parses_models_and_drops_those_without_context_window() {
        let payload = json!({
            "data": [
                {
                    "id": "glm-5.3",
                    "_qmai": {
                        "displayName": "GLM-5.3",
                        "maxInputTokens": 200000,
                        "maxOutputTokens": 8192,
                        "creditMultiplier": 0.79
                    }
                },
                // 缺 maxInputTokens：剪裁算不出窗口，必须丢
                { "id": "no-input", "_qmai": { "maxOutputTokens": 8192 } },
                // 缺 maxOutputTokens：同上
                { "id": "no-output", "_qmai": { "maxInputTokens": 200000 } }
            ]
        });

        let models = models_from_payload(&payload, "wb-connect");
        assert_eq!(models.len(), 1, "只有声明了完整上下文窗口的模型能留下");
        assert_eq!(models[0].id, "glm-5.3");
        assert_eq!(models[0].name, "GLM-5.3");
        assert_eq!(models[0].max_input_tokens, 200_000);
        assert_eq!(models[0].max_output_tokens, 8_192);
        assert_eq!(models[0].credit_multiplier, Some(0.79));
    }

    #[test]
    fn model_parsing_defaults_capabilities_to_false() {
        let payload = json!({
            "data": [{
                "id": "plain-model",
                "_qmai": { "maxInputTokens": 4096, "maxOutputTokens": 1024 }
            }]
        });

        let models = models_from_payload(&payload, "local-llm");
        assert_eq!(models.len(), 1);
        // 没有 displayName 时退回 id：界面至少还能显示一个可读的名字
        assert_eq!(models[0].name, "plain-model");
        assert!(!models[0].supports_tool_call);
        assert!(!models[0].supports_vision);
        assert_eq!(models[0].credit_multiplier, None);
    }

    #[test]
    fn fetch_models_parses_cost_and_modalities() {
        // 设计 3.4 / OpenClaw 的 modelCatalog 借鉴：成本与模态都要能从 `_qmai` 里读出来。
        let payload = json!({
            "data": [{
                "id": "qwen-vl",
                "_qmai": {
                    "maxInputTokens": 131072,
                    "maxOutputTokens": 8_192,
                    "cost": { "input": 0.5, "output": 1.5, "cacheRead": 0.05 },
                    "inputModalities": ["text", "image"]
                }
            }]
        });

        let models = models_from_payload(&payload, "qwen-plugin");
        assert_eq!(models.len(), 1);
        let cost = models[0].cost.as_ref().expect("声明了 cost 就该解析出来");
        assert_eq!(cost.input, Some(0.5));
        assert_eq!(cost.output, Some(1.5));
        assert_eq!(cost.cache_read, Some(0.05));
        assert_eq!(
            cost.cache_write, None,
            "未声明的项留 None，不填 0（0 会被读成免费）"
        );
        assert_eq!(
            models[0].input_modalities,
            vec!["text".to_string(), "image".to_string()]
        );
        // 序列化面：前端按 camelCase 读
        let value = serde_json::to_value(&models[0]).expect("模型可序列化");
        assert_eq!(value["inputModalities"][1], "image");
        assert_eq!(value["cost"]["cacheRead"], 0.05);
    }

    #[test]
    fn fetch_models_treats_image_modality_as_vision() {
        // 作者写了 inputModalities 却忘开 supportsVision：冲突时以模态为准。
        let payload = json!({
            "data": [{
                "id": "vl-model",
                "_qmai": {
                    "maxInputTokens": 32_000,
                    "maxOutputTokens": 4_096,
                    "supportsVision": false,
                    "inputModalities": ["Text", "IMage"]
                }
            }]
        });

        let models = models_from_payload(&payload, "vl-plugin");
        assert_eq!(models.len(), 1);
        assert!(
            models[0].supports_vision,
            "inputModalities 含 image 时必须视为支持视觉"
        );
        // 大小写归一化：否则 "IMage" 推导不出 vision
        assert_eq!(
            models[0].input_modalities,
            vec!["text".to_string(), "image".to_string()]
        );
    }

    #[test]
    fn fetch_models_without_cost_leaves_none() {
        // 回归：老插件（只声明了上下文窗口）必须照旧可用，不因为新字段变成解析失败。
        let payload = json!({
            "data": [{
                "id": "glm-5.3",
                "_qmai": { "maxInputTokens": 200_000, "maxOutputTokens": 8_192 }
            }]
        });

        let models = models_from_payload(&payload, "old-plugin");
        assert_eq!(models.len(), 1);
        assert!(models[0].cost.is_none(), "没声明 cost 必须是 None");
        assert!(
            models[0].input_modalities.is_empty(),
            "没声明模态时留空 vec，由前端当作文本模型"
        );
        // 空对象等于没声明：不渲染一个四格全「—」的成本区
        let empty_cost = json!({
            "data": [{
                "id": "x",
                "_qmai": { "maxInputTokens": 1, "maxOutputTokens": 1, "cost": {} }
            }]
        });
        assert!(models_from_payload(&empty_cost, "old-plugin")[0]
            .cost
            .is_none());
        // 序列化面：没有值的字段不出现，老前端读到的是原来的形状
        let value = serde_json::to_value(&models[0]).expect("模型可序列化");
        assert!(value.get("cost").is_none());
        assert!(value.get("inputModalities").is_none());
    }

    #[tokio::test]
    async fn provider_call_rejects_unknown_endpoint() {
        // 白名单生效：任意路径都不能借宿主的 token 去请求（否则就是本机通用请求器）。
        for endpoint in [
            "/v1/chat/completions",
            "/v1/_qmai/balance/../models",
            "http://127.0.0.1:1/steal",
            "",
        ] {
            assert!(
                !capability_endpoint_allowed(endpoint),
                "{endpoint} 不该在白名单里"
            );
        }
        assert!(capability_endpoint_allowed("/v1/_qmai/balance"));
        assert!(capability_endpoint_allowed("/v1/_qmai/checkin"));

        // 走真实函数路径（同一份判定）也必须是 Err，而不是发出去
        let error = call_capability(
            &http_client(),
            "http://127.0.0.1:1",
            "token",
            "/v1/chat/completions",
            None,
        )
        .await
        .expect_err("白名单外的端点必须被拒绝");
        assert!(
            error.contains("不支持的能力端点"),
            "错误应说明原因：{error}"
        );
    }

    #[tokio::test]
    async fn provider_call_returns_501_when_capability_missing() {
        // 插件声明了 capability 却没实现端点时的真实形态：起一个真 HTTP 桩回 501，
        // 断言命令层把「状态码 + 响应体」原样带出来 —— 只说「调用失败」的话，
        // 插件作者分不清是没实现（501/404）还是实现崩了（500）。
        let stub = StubHttp::spawn(501, r#"{"error":"not implemented"}"#);
        let error = call_capability(
            &http_client(),
            &stub.base,
            "stub-token-123",
            "/v1/_qmai/balance",
            None,
        )
        .await
        .expect_err("非 2xx 必须报错");

        assert!(error.contains("501"), "错误里必须有状态码：{error}");
        assert!(
            error.contains("not implemented"),
            "错误里要带响应体片段，否则排查全靠猜：{error}"
        );
        let head = stub.requests()[0].to_ascii_lowercase();
        assert!(
            head.starts_with("post /v1/_qmai/balance "),
            "能力端点用 POST（设计 4.4）：{head}"
        );
        assert!(
            head.contains("authorization: bearer stub-token-123"),
            "转发时必须带 provider token：{head}"
        );
    }

    #[test]
    fn provider_view_never_contains_token() {
        // 安全断言：token 一旦漏进前端可见的视图，就会被前端持久化到 providerConfigs
        // （计划第 0 节的验收方式就是「在设置文件里 grep 该 token 必须搜不到」）。
        let provider = sample_provider();
        let token = provider.token.clone();
        assert!(
            !token.is_empty(),
            "样例必须真的带 token，否则这条断言毫无意义"
        );

        let json = serde_json::to_string(&provider.view()).expect("视图可序列化");
        assert!(
            !json.contains(&token),
            "视图里出现了 provider token：{json}"
        );
        let value = serde_json::to_value(provider.view()).expect("视图可序列化");
        assert!(value.get("token").is_none(), "视图不应有 token 字段");
        // 元数据该有的仍然要有，别为了去掉 token 把整车人赶下车
        assert_eq!(value["providerId"], "wb-connect");
        assert_eq!(value["baseUrl"], "http://127.0.0.1:51235");
        assert_eq!(value["models"][0]["maxInputTokens"], 200_000);
        assert_eq!(value["ready"], true);
    }

    #[test]
    fn provider_debug_output_redacts_the_token() {
        // 防的是「将来把 provider 打进日志」这条路径：`derive(Debug)` 会把 token
        // 原样带出去，而这条路径不会有人专门 review。token 是插件凭证，
        // 能凭它白嫖用户账号额度，任何日志里都不该出现。
        let provider = PluginProvider {
            token: "super-secret-token-xyz".to_string(),
            ..sample_provider()
        };

        let rendered = format!("{provider:?}");
        assert!(
            !rendered.contains("super-secret-token-xyz"),
            "Debug 输出不得包含 token：{rendered}"
        );
        assert!(
            rendered.contains("<redacted>"),
            "应当明确标注已打码，否则排障时分不清「没有 token」还是「打了码」：{rendered}"
        );
        // 其余字段要照常可读：打码 token 不等于把整个结构变成黑盒
        assert!(
            rendered.contains("wb-connect"),
            "其余字段应保留：{rendered}"
        );
        assert!(
            rendered.contains("http://127.0.0.1:51235"),
            "baseUrl 应保留：{rendered}"
        );
    }

    #[test]
    fn allocate_port_returns_nonzero() {
        // 只断言「拿到一个号」：端口是否仍然空闲取决于别的进程，测了就是 flaky。
        let port = allocate_port().expect("端口分配应成功");
        assert_ne!(port, 0, "内核不应返回 0 号端口");
    }

    #[test]
    fn auth_kinds_map_to_the_documented_strings() {
        assert_eq!(auth_kind_name(manifest::AuthKind::None), "none");
        assert_eq!(
            auth_kind_name(manifest::AuthKind::BrowserLogin),
            "browser-login"
        );
        assert_eq!(
            auth_kind_name(manifest::AuthKind::PasteToken),
            "paste-token"
        );
        assert_eq!(
            auth_kind_name(manifest::AuthKind::ImportFile),
            "import-file"
        );
    }

    #[tokio::test]
    async fn health_probe_passes_when_stub_returns_200() {
        let stub = StubHttp::spawn(200, "{}");
        wait_until_healthy(&http_client(), &stub.base, Duration::from_millis(2_000))
            .await
            .expect("200 应当通过探活");

        let requests = stub.requests();
        assert!(
            requests[0].starts_with("GET /health "),
            "探活必须打 /health：{}",
            requests[0]
        );
    }

    #[tokio::test]
    async fn health_probe_times_out_when_stub_returns_500() {
        let stub = StubHttp::spawn(500, "{}");
        let error = wait_until_healthy(&http_client(), &stub.base, Duration::from_millis(400))
            .await
            .expect_err("一直 500 时不能判成功");

        assert!(
            error.contains("未通过 /health 探活"),
            "错误应说明是探活超时：{error}"
        );
        assert!(
            error.contains("500"),
            "超时错误要带最后一次失败原因，否则用户只看到「超时」无从排查：{error}"
        );
    }

    #[tokio::test]
    async fn fetch_models_sends_bearer_token() {
        let stub = StubHttp::spawn(
            200,
            r#"{"data":[{"id":"glm-5.3","_qmai":{"maxInputTokens":200000,"maxOutputTokens":8192}}]}"#,
        );
        let models = fetch_models(&http_client(), &stub.base, "stub-token-123")
            .await
            .expect("抓取模型应成功");
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "glm-5.3");

        // 插件必须能校验 Bearer，宿主就必须真的带上它（设计 3.3）。
        let head = stub.requests()[0].to_ascii_lowercase();
        assert!(
            head.starts_with("get /v1/models "),
            "模型列表必须打 /v1/models：{head}"
        );
        assert!(
            head.contains("authorization: bearer stub-token-123"),
            "请求必须带 Authorization: Bearer <token>：{head}"
        );
    }
}
