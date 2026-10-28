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

use serde::Serialize;

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
}

/// 一个已就绪（或探测中/失败）的插件 provider。token 只活在内存。
#[derive(Debug, Clone)]
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
    pub auth_kind: String,
    /// 运行期 `GET /v1/models` 的结果；探活/抓取失败时为空。
    pub models: Vec<ProviderModel>,
    pub ready: bool,
    pub last_error: Option<String>,
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
            supports_vision: extended
                .and_then(|value| value.get("supportsVision"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false),
            credit_multiplier: extended
                .and_then(|value| value.get("creditMultiplier"))
                .and_then(serde_json::Value::as_f64),
        });
    }
    models
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
            auth_kind: "none".to_string(),
            models: vec![ProviderModel {
                id: "glm-5.3".to_string(),
                name: "GLM-5.3".to_string(),
                max_input_tokens: 200_000,
                max_output_tokens: 8_192,
                supports_tool_call: true,
                supports_vision: false,
                credit_multiplier: Some(0.79),
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
