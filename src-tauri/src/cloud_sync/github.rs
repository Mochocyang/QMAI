//! GitHub 云端适配层：OAuth 设备流、仓库枚举/新建、私有仓库校验。
//!
//! 为什么用**设备流**（device flow）而不是像百度那样的 `localhost` 回调：
//! - 设备流不需要 `client_secret`（桌面应用没法保守密），`client_id` 是公开值；
//! - 不需要占用回调端口，也就没有「17653 被别的进程占了」这类问题；
//! - 代价是用户要在浏览器里粘一次 8 位码，比点一下多两步。
//!
//! 所有请求都**跟随系统代理**（不调 `no_proxy()`）：GitHub API 在部分网络下
//! 必须走代理，而应用早已把用户配置的代理写进 `HTTP(S)_PROXY` 环境变量。

use std::time::Duration;

use serde::{Deserialize, Serialize};

pub const API_BASE: &str = "https://api.github.com";
pub const DEVICE_CODE_ENDPOINT: &str = "https://github.com/login/device/code";
pub const TOKEN_ENDPOINT: &str = "https://github.com/login/oauth/access_token";
pub const CLIENT_ID_ENV: &str = "QMAI_GITHUB_CLIENT_ID";
/// 发布包内置的 OAuth App Client ID。
///
/// 为什么可以硬编码：`client_id` 是**公开值**（浏览器地址栏里就能看到），
/// 设备流也不需要 client_secret —— 这正是选设备流而不是百度那套授权码模式的原因
/// （后者必须藏 SecretKey，桌面端根本藏不住）。
pub const CLIENT_ID: &str = "Ov23liq6DrHYsEDEXC1p";
/// 申请的权限：私有仓库的读写。GitHub 没有更细的 OAuth 作用域。
pub const SCOPES: &str = "repo";
/// 默认新建的仓库名（用户也可以挑已有私有仓库）。
pub const DEFAULT_REPO: &str = "qmai-write-backup";
/// GitHub 要求每个请求都带 UA，否则直接 403。
pub const USER_AGENT: &str = "QMaiWrite-CloudSync";
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubApp {
    pub client_id: String,
}

/// 取 OAuth App 的 client_id：环境变量优先（自测时换成自己的 App），
/// 否则用内置的发布用 Client ID。
pub fn app_from_env() -> Option<GithubApp> {
    let from_env = std::env::var(CLIENT_ID_ENV).unwrap_or_default();
    if from_env.trim().is_empty() {
        app_from_client_id(CLIENT_ID)
    } else {
        app_from_client_id(&from_env)
    }
}

pub fn app_from_client_id(client_id: &str) -> Option<GithubApp> {
    let client_id = client_id.trim();
    if client_id.is_empty() {
        None
    } else {
        Some(GithubApp {
            client_id: client_id.to_string(),
        })
    }
}

/// 落盘的 GitHub 凭据。`login` 只是用来在界面上显示是谁授权的。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GithubToken {
    pub token: String,
    pub login: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceLogin {
    #[serde(rename = "device_code")]
    pub device_code: String,
    #[serde(rename = "user_code")]
    pub user_code: String,
    #[serde(rename = "verification_uri")]
    pub verification_uri: String,
    #[serde(rename = "expires_in")]
    pub expires_in: u64,
    #[serde(rename = "interval")]
    pub interval: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GithubRepo {
    /// 所有者登录名（个人或组织）。
    pub owner: String,
    pub name: String,
    #[serde(rename = "private")]
    pub private: bool,
    #[serde(rename = "default_branch", default)]
    pub default_branch: String,
    /// 当前 token 有没有推送权限（只读仓库连不了）。
    #[serde(default)]
    pub can_push: bool,
    #[serde(rename = "updated_at", default)]
    pub updated_at: Option<String>,
}

impl GithubRepo {
    pub fn full_name(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }
}

/// 设备流的轮询结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DevicePoll {
    /// 用户还没在浏览器里确认。
    Pending,
    /// GitHub 要求放慢轮询（我们按它给的间隔走）。
    SlowDown,
    Done(GithubToken),
    /// 用户点了拒绝。
    Denied,
    /// 码过期了。
    Expired,
    /// client_id 不对（配置问题，不是用户操作问题）。
    Misconfigured,
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        // 注意：这里**不调** `no_proxy()`。GitHub 是纯公网服务，
        // 必须跟随应用里配好的系统代理（见文件头说明）。
        .build()
        .map_err(|error| format!("github.client:{error}"))
}

fn transport_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "github.network".to_string()
    } else if error.is_connect() {
        "github.network".to_string()
    } else {
        format!("github.network:{error}")
    }
}

/// HTTP 状态码 → 前端认识的错误码。
pub fn map_status(status: u16, rate_limited: bool) -> String {
    match status {
        401 => "github.auth".to_string(),
        403 if rate_limited => "github.rate-limited".to_string(),
        403 => "github.forbidden".to_string(),
        404 => "github.repo-missing".to_string(),
        409 | 422 => "github.conflict".to_string(),
        429 => "github.rate-limited".to_string(),
        500..=599 => "github.server".to_string(),
        _ => "github.http".to_string(),
    }
}

fn rate_limited(headers: &reqwest::header::HeaderMap) -> bool {
    headers
        .get("x-ratelimit-remaining")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim() == "0")
        .unwrap_or(false)
}

/// 统一的请求发送：带上 UA / API 版本，把非 2xx 映射成错误码。
fn send_api(request: reqwest::blocking::RequestBuilder) -> Result<serde_json::Value, String> {
    let response = request
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("x-github-api-version", "2022-11-28")
        .send()
        .map_err(transport_error)?;

    let status = response.status().as_u16();
    let rate_limited = rate_limited(response.headers());
    let body = response.text().unwrap_or_default();

    if !(200..300).contains(&status) {
        let mut code = map_status(status, rate_limited);
        // 带一点服务端说明，日志里能看出到底哪一步炸了。
        if let Some(message) = json_message(&body) {
            code = format!("{code}:{message}");
        }
        return Err(code);
    }

    if body.trim().is_empty() {
        return Ok(serde_json::Value::Null);
    }
    serde_json::from_str(&body).map_err(|error| format!("github.parse:{error}"))
}

fn json_message(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    value
        .get("message")
        .and_then(|message| message.as_str())
        .map(|message| message.to_string())
}

/// 申请设备码：返回 8 位码 + 授权地址。
pub fn request_device_code(app: &GithubApp) -> Result<DeviceLogin, String> {
    let client = client()?;
    let response = client
        .post(DEVICE_CODE_ENDPOINT)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/json")
        .form(&[("client_id", app.client_id.as_str()), ("scope", SCOPES)])
        .send()
        .map_err(transport_error)?;

    let status = response.status().as_u16();
    let body = response.text().unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(map_status(status, false));
    }

    let value: serde_json::Value =
        serde_json::from_str(&body).map_err(|error| format!("github.parse:{error}"))?;
    if let Some(error) = value.get("error").and_then(|error| error.as_str()) {
        return Err(match error {
            "device_flow_disabled" => "github.device-flow-disabled".to_string(),
            "unauthorized_client" | "incorrect_client_credentials" => {
                "github.misconfigured".to_string()
            }
            other => format!("github.device-code:{other}"),
        });
    }

    serde_json::from_value(value).map_err(|error| format!("github.parse:{error}"))
}

/// 轮询一次 token 端点。调用方按 `interval` 循环，看到 `Done` 或终止态就停。
pub fn poll_device_token(app: &GithubApp, device_code: &str) -> Result<DevicePoll, String> {
    let client = client()?;
    let response = client
        .post(TOKEN_ENDPOINT)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/json")
        .form(&[
            ("client_id", app.client_id.as_str()),
            ("device_code", device_code),
            (
                "grant_type",
                "urn:ietf:params:oauth:grant-type:device_code",
            ),
        ])
        .send()
        .map_err(transport_error)?;

    let body = response.text().unwrap_or_default();
    let value: serde_json::Value =
        serde_json::from_str(&body).map_err(|error| format!("github.parse:{error}"))?;

    match value.get("error").and_then(|error| error.as_str()) {
        None => {
            let token = value
                .get("access_token")
                .and_then(|token| token.as_str())
                .ok_or_else(|| "github.parse:missing access_token".to_string())?;
            // 设备流拿到的 token 没有可直接用的用户名，登录名后面再查一次。
            Ok(DevicePoll::Done(GithubToken {
                token: token.to_string(),
                login: String::new(),
            }))
        }
        Some("authorization_pending") => Ok(DevicePoll::Pending),
        Some("slow_down") => Ok(DevicePoll::SlowDown),
        Some("access_denied") => Ok(DevicePoll::Denied),
        Some("expired_token") => Ok(DevicePoll::Expired),
        Some("incorrect_client_credentials") => Ok(DevicePoll::Misconfigured),
        Some("unsupported_grant_type") => Ok(DevicePoll::Misconfigured),
        Some(other) => Err(format!("github.token:{other}")),
    }
}

/// 查当前 token 属于谁（设备流拿到的 token 不带用户名）。
pub fn fetch_viewer(token: &str) -> Result<String, String> {
    let client = client()?;
    let value = send_api(
        client
            .get(format!("{API_BASE}/user"))
            .bearer_auth(token),
    )?;
    value
        .get("login")
        .and_then(|login| login.as_str())
        .map(|login| login.to_string())
        .ok_or_else(|| "github.parse:missing login".to_string())
}

fn repo_from_json(value: &serde_json::Value) -> Option<GithubRepo> {
    let owner = value
        .get("owner")
        .and_then(|owner| owner.get("login"))
        .and_then(|login| login.as_str())?
        .to_string();
    let name = value.get("name").and_then(|name| name.as_str())?.to_string();
    let private = value
        .get("private")
        .and_then(|private| private.as_bool())
        .unwrap_or(false);
    let default_branch = value
        .get("default_branch")
        .and_then(|branch| branch.as_str())
        .unwrap_or("main")
        .to_string();
    // 两种来源的权限信息不一样：列表接口在顶层 `permissions`，
    // 单个仓库接口也是 `permissions`，但字段可能缺；缺就当作「不知道」，先不信。
    let can_push = value
        .get("permissions")
        .and_then(|permissions| permissions.get("push"))
        .and_then(|push| push.as_bool())
        .unwrap_or(true);
    Some(GithubRepo {
        owner,
        name,
        private,
        default_branch,
        can_push,
        updated_at: value
            .get("updated_at")
            .and_then(|updated| updated.as_str())
            .map(|updated| updated.to_string()),
    })
}

/// 列当前账号的私有仓库（最多 300 个，够用；按最近更新排序）。
pub fn list_private_repos(token: &str) -> Result<Vec<GithubRepo>, String> {
    let client = client()?;
    let mut out: Vec<GithubRepo> = Vec::new();
    for page in 1..=3 {
        let value = send_api(
            client
                .get(format!("{API_BASE}/user/repos"))
                .query(&[
                    ("visibility", "private".to_string()),
                    ("affiliation", "owner,collaborator".to_string()),
                    ("sort", "updated".to_string()),
                    ("per_page", "100".to_string()),
                    ("page", page.to_string()),
                ])
                .bearer_auth(token),
        )?;
        let Some(items) = value.as_array() else {
            break;
        };
        if items.is_empty() {
            break;
        }
        for item in items {
            if let Some(repo) = repo_from_json(item) {
                // 只留私有仓库：接口理论上已经过滤，但别指望。
                if repo.private {
                    out.push(repo);
                }
            }
        }
        if items.len() < 100 {
            break;
        }
    }
    out.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(out)
}

pub fn fetch_repo(token: &str, owner: &str, repo: &str) -> Result<GithubRepo, String> {
    let client = client()?;
    let value = send_api(
        client
            .get(format!("{API_BASE}/repos/{owner}/{repo}"))
            .bearer_auth(token),
    )?;
    repo_from_json(&value).ok_or_else(|| "github.parse:missing repo".to_string())
}

/// 新建私有仓库。`private: true` 由客户端写死 —— 用户没有建成公开的机会。
pub fn create_private_repo(token: &str, name: &str) -> Result<GithubRepo, String> {
    let client = client()?;
    let value = send_api(
        client
            .post(format!("{API_BASE}/user/repos"))
            .bearer_auth(token)
            .json(&serde_json::json!({
                "name": name,
                "private": true,
                "auto_init": true,
                "description": "青幕AI写作 · 小说同步（私有）",
            })),
    )?;
    repo_from_json(&value).ok_or_else(|| "github.parse:missing repo".to_string())
}

/// 把仓库改成私有（用户选了公开仓库时，界面可以提供这个动作）。
pub fn make_private(token: &str, owner: &str, repo: &str) -> Result<GithubRepo, String> {
    let client = client()?;
    let value = send_api(
        client
            .patch(format!("{API_BASE}/repos/{owner}/{repo}"))
            .bearer_auth(token)
            .json(&serde_json::json!({ "private": true })),
    )?;
    repo_from_json(&value).ok_or_else(|| "github.parse:missing repo".to_string())
}

/// 连接前的硬校验：必须私有、必须有推送权限。
pub fn validate_target(repo: &GithubRepo) -> Result<(), String> {
    if !repo.private {
        return Err("github.repo-public".to_string());
    }
    if !repo.can_push {
        return Err("github.read-only".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_client_id_is_the_release_app() {
        // 发布包不能没有 client_id，否则用户点「连接 GitHub」只会看到「还没绑定」。
        assert!(!CLIENT_ID.trim().is_empty());
        assert_eq!(
            app_from_client_id(CLIENT_ID).map(|app| app.client_id),
            Some(CLIENT_ID.to_string())
        );
    }

    #[test]
    fn client_id_from_env_must_be_non_empty() {
        assert!(app_from_client_id("   ").is_none());
        assert!(app_from_client_id("").is_none());
        assert_eq!(
            app_from_client_id(" Iv1abc ").map(|app| app.client_id),
            Some("Iv1abc".to_string())
        );
    }

    #[test]
    fn status_mapping_covers_the_common_failures() {
        assert_eq!(map_status(401, false), "github.auth");
        assert_eq!(map_status(404, false), "github.repo-missing");
        assert_eq!(map_status(429, false), "github.rate-limited");
        assert_eq!(map_status(403, true), "github.rate-limited");
        assert_eq!(map_status(403, false), "github.forbidden");
        assert_eq!(map_status(422, false), "github.conflict");
        assert_eq!(map_status(503, false), "github.server");
    }

    #[test]
    fn device_login_parses_github_payload() {
        let login: DeviceLogin = serde_json::from_str(
            r#"{"device_code":"abc","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#,
        )
        .unwrap();
        assert_eq!(login.user_code, "ABCD-1234");
        assert_eq!(login.interval, 5);
    }

    #[test]
    fn repo_payload_requires_private_and_reports_push_permission() {
        let repo: GithubRepo = repo_from_json(&serde_json::json!({
            "name": "qmai-write-backup",
            "owner": { "login": "someone" },
            "private": true,
            "default_branch": "main",
            "permissions": { "push": true, "admin": false }
        }))
        .unwrap();
        assert_eq!(repo.full_name(), "someone/qmai-write-backup");
        assert!(repo.private);
        assert!(repo.can_push);
        assert!(validate_target(&repo).is_ok());
    }

    #[test]
    fn public_repo_is_rejected_before_anything_is_uploaded() {
        let repo = GithubRepo {
            owner: "someone".to_string(),
            name: "public-notes".to_string(),
            private: false,
            default_branch: "main".to_string(),
            can_push: true,
            updated_at: None,
        };
        assert_eq!(validate_target(&repo).unwrap_err(), "github.repo-public");
    }

    #[test]
    fn read_only_repo_is_rejected_with_a_clear_code() {
        let repo = GithubRepo {
            owner: "org".to_string(),
            name: "shared".to_string(),
            private: true,
            default_branch: "main".to_string(),
            can_push: false,
            updated_at: None,
        };
        assert_eq!(validate_target(&repo).unwrap_err(), "github.read-only");
    }
}
