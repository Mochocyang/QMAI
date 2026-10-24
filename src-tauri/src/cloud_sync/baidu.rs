//! 百度网盘 OAuth（授权码模式 + 固定回环回调端口）。
//!
//! 为什么端口写死 17653：授权回调地址是在百度应用后台登记过的，不能每次随机，
//! 否则用户每次登录都要改后台配置。代价是端口被占用时要给出明确文案
//! （`callback.port-in-use`），而不是偷偷换端口（换了必然回调失败，更难排查）。
//!
//! 为什么用系统浏览器而不是内嵌窗口：百度登录页要求用户输账号密码，
//! 内嵌 WebView 里做这件事会被当成钓鱼，且无法保证 Cookie/2FA 行为一致。
//!
//! 应用凭据（AppKey/SecretKey）不写死在代码里：开发期用环境变量注入，
//! 避免"某天发现仓库里躺着一个真实密钥"。未配置时登录直接回 `not.configured`。

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// 固定回调端口（百度应用后台登记的 redirect_uri 必须与它一致）。
pub const CALLBACK_PORT: u16 = 17653;
/// 等待用户在浏览器里完成授权的上限。
pub const LOGIN_TIMEOUT: Duration = Duration::from_secs(180);
/// 等浏览器把回调打过来的单次读超时。
const STREAM_TIMEOUT: Duration = Duration::from_secs(10);

pub const AUTH_ENDPOINT: &str = "https://openapi.baidu.com/oauth/2.0/authorize";
pub const TOKEN_ENDPOINT: &str = "https://openapi.baidu.com/oauth/2.0/token";
/// 远端根：百度网盘「我的应用数据」下以应用名建目录。
pub const DEFAULT_APP_NAME: &str = "青幕AI写作";
pub const APP_KEY_ENV: &str = "QMAI_BAIDU_APP_KEY";
pub const APP_SECRET_ENV: &str = "QMAI_BAIDU_SECRET_KEY";
pub const APP_NAME_ENV: &str = "QMAI_BAIDU_APP_NAME";

/// 百度开放平台里登记的完整回调地址（必须逐字一致，否则授权后百度会拒绝重定向）。
pub const CALLBACK_PATH: &str = "/callback";

/// 兼容早期本地约定：老配置里写的是 `/oauth/callback`，两个都收。
const COMPAT_CALLBACK_PATH: &str = "/oauth/callback";

pub fn redirect_uri(port: u16) -> String {
    format!("http://127.0.0.1:{port}{CALLBACK_PATH}")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaiduApp {
    pub app_key: String,
    pub secret_key: String,
}

/// 从环境变量读取应用凭据；缺一个就当作没配置。
pub fn app_from_env() -> Option<BaiduApp> {
    let app_key = std::env::var(APP_KEY_ENV).ok()?.trim().to_string();
    let secret_key = std::env::var(APP_SECRET_ENV).ok()?.trim().to_string();
    if app_key.is_empty() || secret_key.is_empty() {
        return None;
    }
    Some(BaiduApp { app_key, secret_key })
}

/// 远端根路径名称（`/apps/{name}`）。允许用环境变量覆盖，方便联调时换目录。
pub fn app_name() -> String {
    std::env::var(APP_NAME_ENV)
        .ok()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| DEFAULT_APP_NAME.to_string())
}

pub fn authorize_url(app: &BaiduApp, port: u16) -> String {
    format!(
        "{AUTH_ENDPOINT}?response_type=code&client_id={}&redirect_uri={}&scope={}&display=page",
        url_encode(&app.app_key),
        url_encode(&redirect_uri(port)),
        url_encode("basic,netdisk"),
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallbackOutcome {
    Code(String),
    Denied(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BaiduToken {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    pub expires_at_ms: i64,
    #[serde(default)]
    pub scope: Option<String>,
}

impl BaiduToken {
    pub fn is_valid(&self, now_ms: i64) -> bool {
        // 提前 60 秒判过期：刚好卡在边界上时，一次 API 调用可能已经失效。
        self.expires_at_ms - 60_000 > now_ms
    }
}

/// 解析回调请求行里的查询串。纯函数，测试覆盖 `code` / 拒绝授权 / 其他路径。
pub fn parse_callback(request_line: &str) -> Result<CallbackOutcome, String> {
    let path = request_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "回调请求格式不对".to_string())?;
    let (route, query) = match path.split_once('?') {
        Some((route, query)) => (route, query),
        None => (path, ""),
    };
    if route != CALLBACK_PATH && route != COMPAT_CALLBACK_PATH {
        return Err("不是登录回调路径".to_string());
    }

    let mut code: Option<String> = None;
    let mut error: Option<String> = None;
    for pair in query.split('&') {
        let (key, value) = match pair.split_once('=') {
            Some(parts) => parts,
            None => continue,
        };
        let value = url_decode(value);
        match key {
            "code" => code = Some(value),
            "error" | "error_code" => error = Some(value),
            _ => {}
        }
    }

    if let Some(error) = error {
        return Ok(CallbackOutcome::Denied(error));
    }
    match code.filter(|value| !value.is_empty()) {
        Some(code) => Ok(CallbackOutcome::Code(code)),
        None => Err("回调里没有授权码".to_string()),
    }
}

/// token 端点允许用环境变量覆盖：联调时指向 mock 服务，测试不打真实网络。
pub fn token_endpoint() -> String {
    std::env::var("QMAI_BAIDU_TOKEN_ENDPOINT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| TOKEN_ENDPOINT.to_string())
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// 起回调服务并等待授权。
///
/// 返回授权页 URL（命令层会把它交给系统浏览器打开）；真正的结果通过 `on_result`
/// 回调交出去（成功=已换到 token，失败=错误码字符串）。
pub fn start_login<F>(
    app: BaiduApp,
    port: u16,
    cancel: Arc<AtomicBool>,
    endpoint: String,
    on_result: F,
) -> Result<String, String>
where
    F: FnOnce(Result<BaiduToken, String>) + Send + 'static,
{
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|_| "callback.port-in-use".to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("回调服务启动失败：{error}"))?;
    let auth_url = authorize_url(&app, port);

    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + LOGIN_TIMEOUT;
        let mut outcome: Option<Result<BaiduToken, String>> = None;

        while std::time::Instant::now() < deadline {
            if cancel.load(Ordering::SeqCst) {
                outcome = Some(Err("auth.cancelled".to_string()));
                break;
            }
            match listener.accept() {
                Ok((stream, _)) => {
                    outcome = Some(handle_connection(stream, &app, port, &endpoint));
                    break;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(150));
                }
                Err(error) => {
                    outcome = Some(Err(format!("回调服务异常：{error}")));
                    break;
                }
            }
        }

        let result = outcome.unwrap_or_else(|| Err("auth.timeout".to_string()));
        on_result(result);
    });

    Ok(auth_url)
}

fn handle_connection(
    mut stream: TcpStream,
    app: &BaiduApp,
    port: u16,
    endpoint: &str,
) -> Result<BaiduToken, String> {
    let _ = stream.set_read_timeout(Some(STREAM_TIMEOUT));
    let mut buffer = [0u8; 4096];
    let read = stream.read(&mut buffer).map_err(|error| format!("读取回调失败：{error}"))?;
    let request = String::from_utf8_lossy(&buffer[..read]).to_string();
    let request_line = request.lines().next().unwrap_or_default().to_string();

    let parsed = parse_callback(&request_line);
    // 先给浏览器一个能看的页面，再去换 token：用户不该盯着一个转圈的白页等网络请求。
    let (status, body) = match &parsed {
        Ok(CallbackOutcome::Code(_)) => ("200 OK", page_success()),
        Ok(CallbackOutcome::Denied(_)) => ("200 OK", page_denied()),
        Err(_) => ("400 Bad Request", page_invalid()),
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
    drop(stream);

    match parsed? {
        CallbackOutcome::Code(code) => exchange_code_at(app, &code, port, endpoint),
        CallbackOutcome::Denied(error) => Err(map_denied(&error)),
    }
}

fn map_denied(error: &str) -> String {
    match error {
        "access_denied" => "auth.cancelled".to_string(),
        other => format!("auth.denied:{other}"),
    }
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

pub fn exchange_code_at(
    app: &BaiduApp,
    code: &str,
    port: u16,
    endpoint: &str,
) -> Result<BaiduToken, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("初始化网络客户端失败：{error}"))?;

    let response = client
        .post(endpoint)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", app.app_key.as_str()),
            ("client_secret", app.secret_key.as_str()),
            ("redirect_uri", redirect_uri(port).as_str()),
        ])
        .send()
        .map_err(|_| "net.offline".to_string())?;

    let payload = response
        .json::<TokenResponse>()
        .map_err(|error| format!("解析授权响应失败：{error}"))?;

    if let Some(error) = payload.error {
        let detail = payload.error_description.unwrap_or_default();
        return Err(match error.as_str() {
            "invalid_grant" => "auth.revoked".to_string(),
            "invalid_client" => "auth.invalid-app".to_string(),
            other => format!("auth.denied:{other}({detail})"),
        });
    }

    let access_token = payload.access_token.ok_or_else(|| "授权响应里没有 access_token".to_string())?;
    let expires_in = payload.expires_in.unwrap_or(0).max(0);
    Ok(BaiduToken {
        access_token,
        refresh_token: payload.refresh_token.filter(|value| !value.is_empty()),
        expires_at_ms: now_ms() + expires_in * 1000,
        scope: payload.scope,
    })
}

fn url_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn url_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                let hex = &value[index + 1..index + 3];
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    index += 3;
                    continue;
                }
                out.push(b'%');
                index += 1;
            }
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn page_success() -> String {
    page(
        "授权成功",
        "青幕 AI 写作已拿到百度网盘授权，可以关闭这个页面回到应用继续设置了。",
    )
}

fn page_denied() -> String {
    page("已取消授权", "你可以关闭这个页面，回到应用里重新登录。")
}

fn page_invalid() -> String {
    page("回调地址无效", "这个地址不是登录回调，请回到应用里重新点「登录百度网盘」。")
}

fn page(title: &str, message: &str) -> String {
    format!(
        r#"<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>青幕 AI 写作 · {title}</title>
<style>body{{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:#faf9f6;color:#2b2b2b;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}
.card{{background:#fff;border:1px solid #e6e2da;border-radius:14px;padding:32px 36px;max-width:420px;box-shadow:0 8px 24px rgba(0,0,0,.05)}}
h1{{font-size:18px;margin:0 0 12px}}p{{font-size:14px;line-height:1.7;margin:0;color:#555}}</style></head>
<body><div class="card"><h1>{title}</h1><p>{message}</p></div></body></html>"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app() -> BaiduApp {
        BaiduApp { app_key: "KEY123".to_string(), secret_key: "SECRET".to_string() }
    }

    #[test]
    fn callback_parses_code() {
        let outcome = parse_callback("GET /oauth/callback?code=abc123&state=xyz HTTP/1.1").unwrap();
        assert_eq!(outcome, CallbackOutcome::Code("abc123".to_string()));
    }

    #[test]
    fn callback_parses_denied() {
        let outcome = parse_callback("GET /oauth/callback?error=access_denied HTTP/1.1").unwrap();
        assert_eq!(outcome, CallbackOutcome::Denied("access_denied".to_string()));
    }

    #[test]
    fn callback_rejects_other_paths_and_missing_code() {
        assert!(parse_callback("GET /favicon.ico HTTP/1.1").is_err());
        assert!(parse_callback("GET /oauth/callback?state=xyz HTTP/1.1").is_err());
    // 百度开放平台里登记的就是 `/callback`，必须能解析；旧路径继续兼容。
    assert_eq!(
        parse_callback("GET /callback?code=abc123&state=xyz HTTP/1.1").unwrap(),
        CallbackOutcome::Code("abc123".to_string())
    );
    assert!(parse_callback("GET /elsewhere?code=abc HTTP/1.1").is_err());
        assert!(parse_callback("garbage").is_err());
    }

    #[test]
    fn authorize_url_encodes_redirect_uri() {
        let url = authorize_url(&app(), CALLBACK_PORT);
        assert!(url.starts_with(AUTH_ENDPOINT));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("client_id=KEY123"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A17653%2Fcallback"), "{url}");
        assert!(url.contains("scope=basic%2Cnetdisk"));
    }

    #[test]
    fn token_validity_uses_a_one_minute_margin() {
        let token = BaiduToken {
            access_token: "t".to_string(),
            refresh_token: None,
            expires_at_ms: 1_000_000,
            scope: None,
        };
        assert!(token.is_valid(900_000));
        assert!(!token.is_valid(950_000));
        assert!(!token.is_valid(1_000_001));
    }

    #[test]
    fn url_helpers_round_trip() {
        assert_eq!(url_encode("a b/c:d"), "a%20b%2Fc%3Ad");
        assert_eq!(url_decode("a+b%2Fc"), "a b/c");
        assert_eq!(url_decode("%E4%B8%AD%E6%96%87"), "中文");
    }

    /// 一个只回固定 JSON 的假 token 端点（不联网，跑得快）。
    fn spawn_fake_token_server(body: &'static str) -> u16 {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0u8; 4096];
                let _ = stream.read(&mut buffer);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.as_bytes().len()
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        port
    }

    #[test]
    fn loopback_receives_the_callback_and_returns_a_web_page() {
        // 用临时端口，避免和真实登录抢 17653。
        let probe = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);

        let token_port = spawn_fake_token_server(
            r#"{"access_token":"token-from-fake","expires_in":3600,"refresh_token":"r1","scope":"basic netdisk"}"#,
        );
        let endpoint = format!("http://127.0.0.1:{token_port}/oauth/2.0/token");

        let cancel = Arc::new(AtomicBool::new(false));
        let (sender, receiver) = std::sync::mpsc::channel();
        let auth_url = start_login(app(), port, cancel, endpoint, move |result| {
            let _ = sender.send(result);
        })
        .expect("listener should bind");
        assert!(auth_url.contains(&format!("{port}%2Fcallback")), "{auth_url}");

        // 模拟浏览器把回调打过来（这里故意用无效 code，验证的是「收到并解析」，
        // 不是真的去百度换 token —— 那需要网络和应用凭据）。
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .write_all(b"GET /oauth/callback?code=fake HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        let _ = stream.read_to_string(&mut response);
        assert!(response.starts_with("HTTP/1.1 200"), "应返回可读页面：{response}");
        assert!(response.contains("授权成功"));

        let token = receiver
            .recv_timeout(Duration::from_secs(30))
            .unwrap()
            .expect("假端点回了 token，整条链路应成功");
        assert_eq!(token.access_token, "token-from-fake");
        assert_eq!(token.refresh_token.as_deref(), Some("r1"));
        assert!(token.is_valid(now_ms()));
    }

    #[test]
    fn cancel_flag_stops_the_waiting_thread() {
        let probe = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);

        let cancel = Arc::new(AtomicBool::new(true));
        let (sender, receiver) = std::sync::mpsc::channel();
        start_login(app(), port, cancel, "http://127.0.0.1:1/token".to_string(), move |result| {
            let _ = sender.send(result);
        })
        .unwrap();
        let result = receiver.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(result.unwrap_err(), "auth.cancelled");
    }

    #[test]
    fn token_endpoint_errors_are_mapped_to_codes() {
        let port = spawn_fake_token_server(r#"{"error":"invalid_grant","error_description":"expired"}"#);
        let endpoint = format!("http://127.0.0.1:{port}/oauth/2.0/token");
        let error = exchange_code_at(&app(), "code", CALLBACK_PORT, &endpoint).unwrap_err();
        assert_eq!(error, "auth.revoked");
    }

    #[test]
    fn port_is_reported_when_already_in_use() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let cancel = Arc::new(AtomicBool::new(false));
        let error = start_login(app(), port, cancel, String::new(), |_result| {}).unwrap_err();
        assert_eq!(error, "callback.port-in-use");
    }
}
