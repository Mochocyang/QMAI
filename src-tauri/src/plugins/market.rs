//! 插件市场索引：远端清单 + 本地缓存 + 离线降级。
//!
//! 市场本身**不负责安装**：索引里的 `repo` 就是一个普通的 GitHub 安装地址，
//! `plugins_market_install` 把它原样交给 `installer::install`。这样「市场」
//! 只是一份可浏览、可 PR 维护的清单，下载/校验/发布那套安全边界只存在一份。
//!
//! 为什么不直接把索引放在 `plugins/index.json` 里读：插件根目录是用户数据目录，
//! 软件升级不会动它；清单要跟着版本走，所以远端拉、本地缓存。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use super::installer;

/// 索引的默认地址（随软件发布）。可用环境变量覆盖，方便自建市场/本地调试。
pub const DEFAULT_INDEX_URL: &str =
    "https://raw.githubusercontent.com/Mochocyang/QMAI/main/plugins/index.json";
pub const INDEX_URL_ENV: &str = "QMAI_PLUGIN_INDEX_URL";

/// 缓存有效期：6 小时。过期才自动重拉；手动刷新总是重拉。
///
/// 索引由多人 PR 维护，变化是以「天」计的；把 TTL 设小了只是让首屏多等几次网络，
/// 换不来任何时效性。
pub const CACHE_TTL_SECS: i64 = 6 * 60 * 60;

/// 缓存文件名（放在插件根里，与 `.registry.json` / `.staging` 同级）。
///
/// 用 `.` 开头是为了跟插件本体目录区分开：插件 id 正则不允许以 `.` 开头，
/// 所以这个名字永远不会跟一个合法插件撞车。
const CACHE_FILE_NAME: &str = ".market.json";

/// 索引格式版本。格式不兼容时 +1：旧客户端会明确报「版本不支持」，
/// 而不是把一份它看不懂的清单解析成半个市场。
const INDEX_VERSION: u32 = 1;

/// 索引响应体积上限。清单是纯 JSON，1 MB 足够几千条；超过说明这个地址打到的
/// 不是索引（比如被中间层换成了错误页），早拒早省内存。
const MAX_INDEX_BYTES: usize = 1024 * 1024;

/// 一条市场条目。字段与 `plugins/index.json` 里的一条对象一一对应。
///
/// 除 `id` / `name` / `repo` 外全部带 `#[serde(default)]`：索引是多人 PR 维护的，
/// 作者没写 `tags` 是常态，不该因此让条目消失。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketEntry {
    pub id: String,
    pub name: String,
    /// GitHub 仓库地址，原样喂给 `installer::install`
    pub repo: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub kind: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub version: Option<String>,
}

/// 命令返回给前端的市场视图。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketIndex {
    pub plugins: Vec<MarketEntry>,
    /// true = 网络失败降级到缓存，前端应提示「可能不是最新」。
    ///
    /// 注意语义边界：命中**新鲜**缓存（TTL 内）时这里是 `false` —— 这个字段描述的是
    /// 「降级」，不是「这次没走网络」。新鲜缓存仍在承诺的时效内，前端不该弹提示；
    /// 想显示「更新于几小时前」请用 `fetchedAt` 自己算。
    pub from_cache: bool,
    /// 缓存写入时间（unix 秒）
    pub fetched_at: Option<i64>,
    pub source_url: String,
}

/// 磁盘缓存的内容（`<插件根>/.market.json`）。
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketCache {
    version: u32,
    fetched_at: i64,
    plugins: Vec<MarketEntry>,
}

/// 本客户端标识。GitHub 的 CDN 对裸 reqwest UA 常常直接 403，
/// 而带上版本号也让索引维护者能从日志里认出是谁在拉。
fn user_agent() -> String {
    format!("qmai/{}", env!("CARGO_PKG_VERSION"))
}

/// 拉索引用的 HTTP 客户端：5s 连接超时 / 20s 总超时。
///
/// 超时必须由客户端给：`load_index` 拿到的是调用方的 client，命令层是唯一的
/// 构造点。不设总超时的话，一次卡住的连接会让「打开插件中心」永久转圈。
pub fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(user_agent())
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("构造插件市场客户端失败：{e}"))
}

/// 本次要用的索引地址：环境变量优先（自建市场/本地调试），否则随软件发布的默认地址。
pub fn index_url() -> String {
    match std::env::var(INDEX_URL_ENV) {
        // 空串等于没配：否则一个手滑的 `set X=` 会让市场静默变成「永远拉不到」
        Ok(value) if !value.trim().is_empty() => value.trim().to_string(),
        _ => DEFAULT_INDEX_URL.to_string(),
    }
}

/// 拉取索引；`refresh=false` 且缓存新鲜时直接返回缓存。
///
/// 降级策略（重要）：网络失败**不要**直接报错——用户可能离线/被墙。
/// 有缓存就返回缓存并标 `from_cache=true`；连缓存都没有才报错。
pub async fn load_index(
    client: &reqwest::Client,
    root: &Path,
    refresh: bool,
) -> Result<MarketIndex, String> {
    let url = index_url();
    let cache_file = cache_path(root);
    let cached = read_cache(&cache_file);

    if !refresh {
        if let Some(cache) = &cached {
            if is_fresh(cache.fetched_at, now_unix()) {
                return Ok(cached_index(cache, &url, false));
            }
        }
    }

    match fetch_index(client, &url).await {
        Ok(plugins) => {
            let fetched_at = now_unix();
            let cache = MarketCache {
                version: INDEX_VERSION,
                fetched_at,
                plugins: plugins.clone(),
            };
            // 缓存写失败不该把「已经拉到的清单」变成一次失败：用户至少还能浏览和安装，
            // 代价只是下次要重新联网。所以只 warn。
            if let Err(error) = write_cache(&cache_file, &cache) {
                eprintln!("插件市场缓存写入失败（不影响本次结果）：{error}");
            }
            Ok(MarketIndex {
                plugins,
                from_cache: false,
                fetched_at: Some(fetched_at),
                source_url: url,
            })
        }
        Err(error) => {
            // 网络失败不直接报错：用户可能离线、可能在墙内，而「上次拉到的清单」对
            // 浏览与安装依然完全可用（repo 地址是长期的，不随索引版本失效）。
            // 有缓存就降级，让插件中心至少打得开。
            match cached {
                Some(cache) => {
                    eprintln!(
                        "插件市场索引拉取失败（{error}），降级到本地缓存（fetchedAt={}）",
                        cache.fetched_at
                    );
                    Ok(cached_index(&cache, &url, true))
                }
                None => Err(format!("插件市场索引拉取失败，且本地没有可用缓存：{error}")),
            }
        }
    }
}

/// 解析并过滤索引。**单条坏数据只跳过，不拖垮整份索引** ——
/// 索引是多人 PR 维护的，一条写错不该让整个市场打不开。
///
/// 反过来，`version` / `plugins` 这种**整份**结构错了必须硬失败：那说明拿到的
/// 不是一份 QMAI 市场索引（或者客户端太旧），跳过几条也修不好。
pub fn parse_index(raw: &[u8]) -> Result<Vec<MarketEntry>, String> {
    let doc: serde_json::Value =
        serde_json::from_slice(raw).map_err(|e| format!("索引不是有效 JSON：{e}"))?;
    let version_value = doc
        .get("version")
        .ok_or_else(|| "索引缺少 version 字段".to_string())?;
    let version = version_value
        .as_u64()
        .ok_or_else(|| format!("索引 version 必须是整数，实际是 {version_value}"))?;
    if version != INDEX_VERSION as u64 {
        return Err(format!(
            "不支持的索引版本 {version}（本版本只认 {INDEX_VERSION}）"
        ));
    }
    let items = doc
        .get("plugins")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "索引缺少 plugins 数组".to_string())?;
    Ok(collect_entries(items, "索引"))
}

/// 缓存文件路径。
fn cache_path(root: &Path) -> PathBuf {
    root.join(CACHE_FILE_NAME)
}

fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

/// 缓存是否还在 TTL 内。
///
/// 未来时间戳（用户改过系统时间、缓存从别处拷来）也算新鲜：当作过期只会让每次
/// 打开插件中心都白拉一遍网络，而等待网络恰恰是这个功能最不可靠的一环。
fn is_fresh(fetched_at: i64, now: i64) -> bool {
    now - fetched_at < CACHE_TTL_SECS
}

async fn fetch_index(client: &reqwest::Client, url: &str) -> Result<Vec<MarketEntry>, String> {
    let response = client
        .get(url)
        // UA 显式塞进这一次请求，而不是只依赖客户端默认头：`load_index` 可以被
        // 任意 client 调用（测试、未来别的入口），这一层自己保证请求可被辨识。
        .header(reqwest::header::USER_AGENT, user_agent())
        .send()
        .await
        .map_err(|e| format!("请求 {url} 失败：{e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("{url} 返回 HTTP {status}"));
    }
    if let Some(length) = response.content_length() {
        if length > MAX_INDEX_BYTES as u64 {
            return Err(format!(
                "{url} 响应体积 {length} 字节，超过 {} KB 上限",
                MAX_INDEX_BYTES / 1024
            ));
        }
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取 {url} 响应失败：{e}"))?;
    if bytes.len() > MAX_INDEX_BYTES {
        return Err(format!(
            "{url} 响应体积 {} 字节，超过 {} KB 上限",
            bytes.len(),
            MAX_INDEX_BYTES / 1024
        ));
    }
    parse_index(&bytes)
}

fn read_cache(path: &Path) -> Option<MarketCache> {
    let raw = std::fs::read(path).ok()?;
    let doc: serde_json::Value = match serde_json::from_slice(&raw) {
        Ok(doc) => doc,
        Err(error) => {
            // 缓存损坏是「本地状态坏了」，不是「市场坏了」：当成没有缓存，
            // 下次成功拉取会覆盖它，用户不该为此看到一句报错。
            eprintln!("插件市场缓存已损坏，按无缓存处理：{error}");
            return None;
        }
    };
    if doc.get("version").and_then(serde_json::Value::as_u64) != Some(INDEX_VERSION as u64) {
        eprintln!("插件市场缓存版本不匹配，按无缓存处理");
        return None;
    }
    let fetched_at = doc.get("fetchedAt").and_then(serde_json::Value::as_i64)?;
    let items = doc.get("plugins").and_then(serde_json::Value::as_array)?;
    // 缓存里的条目再过滤一遍：文件可能被手工编辑过，脏数据不该从缓存漏进界面。
    Some(MarketCache {
        version: INDEX_VERSION,
        fetched_at,
        plugins: collect_entries(items, "缓存"),
    })
}

fn write_cache(path: &Path, cache: &MarketCache) -> Result<(), String> {
    let body =
        serde_json::to_vec_pretty(cache).map_err(|e| format!("序列化插件市场缓存失败：{e}"))?;
    crate::atomic_file::write_bytes_atomically(path, &body)
}

fn cached_index(cache: &MarketCache, url: &str, degraded: bool) -> MarketIndex {
    MarketIndex {
        plugins: cache.plugins.clone(),
        from_cache: degraded,
        fetched_at: Some(cache.fetched_at),
        source_url: url.to_string(),
    }
}

/// 逐条解析 + 校验 + 去重。
///
/// 为什么坏条目只跳过：索引是**多人 PR 维护的共享文件**。一条 id 写错、一个 repo
/// 填成 GitLab，如果让整份索引失败，受伤的是所有用户（整个市场打不开），而写错的
/// 只是那一个人。跳过 + stderr 留痕，让维护者能从日志里找到该修的那条。
fn collect_entries(items: &[serde_json::Value], origin: &str) -> Vec<MarketEntry> {
    let mut entries: Vec<MarketEntry> = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let entry = match serde_json::from_value::<MarketEntry>(item.clone()) {
            Ok(entry) => entry,
            Err(error) => {
                eprintln!(
                    "插件市场{origin}第 {} 条字段不合法，已跳过：{error}",
                    index + 1
                );
                continue;
            }
        };
        if let Err(reason) = validate_entry(&entry) {
            eprintln!(
                "插件市场{origin}第 {} 条（id={:?}）已跳过：{reason}",
                index + 1,
                entry.id
            );
            continue;
        }
        // 同一个 id 出现两次时保留第一条：越靠前的条目通常是维护者先审过的，
        // 而且「保留第一条」让结果与文件顺序一致，可解释、可复现。
        if entries.iter().any(|existing| existing.id == entry.id) {
            eprintln!(
                "插件市场{origin}里 id={} 重复，保留第一条，忽略第 {} 条",
                entry.id,
                index + 1
            );
            continue;
        }
        entries.push(entry);
    }
    entries
}

fn validate_entry(entry: &MarketEntry) -> Result<(), String> {
    if !is_valid_plugin_id(&entry.id) {
        return Err("id 不匹配 ^[a-z0-9][a-z0-9-]{1,63}$".to_string());
    }
    if entry.name.trim().is_empty() {
        return Err("name 为空".to_string());
    }
    // repo 的判定直接交给安装器，**不自己写一份正则**：市场条目最终就是要喂给
    // `installer::install` 的，两处规则一旦漂移（比如以后允许 `@ref`），市场里
    // 能点「安装」的条目就会在安装器那边失败 —— 那才是最糟的错配。
    installer::parse_source(&entry.repo)
        .map_err(|e| format!("repo 不是可安装的 GitHub 仓库：{e}"))?;
    Ok(())
}

/// `^[a-z0-9][a-z0-9-]{1,63}$` 的手写实现（不引入 regex 依赖）。
///
/// 长度区间 2..=64 来自正则本身：首字符 + 至少一个后续字符。
fn is_valid_plugin_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    if !(2..=64).contains(&bytes.len()) {
        return false;
    }
    let first = bytes[0];
    if !(first.is_ascii_lowercase() || first.is_ascii_digit()) {
        return false;
    }
    bytes[1..]
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{Arc, Mutex as StdMutex, MutexGuard};
    use std::time::Duration;

    /// 极简本机 HTTP 桩：固定状态码 + 固定 body，并记录收到的原始请求头。
    ///
    /// 用真实 TCP 而不是 mock 客户端：`load_index` 走的是真实 reqwest 路径
    /// （连接、头、状态码），把那一层绕过去就等于没测。
    struct StubHttp {
        base: String,
        requests: Arc<StdMutex<Vec<String>>>,
        handle: Option<std::thread::JoinHandle<()>>,
    }

    fn read_request(stream: &mut TcpStream) -> String {
        // 读超时兜底：客户端把连接挂着不发完时，桩不能永远阻塞（会把用例拖成超时）
        let _ = stream.set_read_timeout(Some(Duration::from_millis(2_000)));
        let mut buffer: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => buffer.extend_from_slice(&chunk[..read]),
                Err(_) => break,
            }
            // GET 没有 body，读到请求头结束就够了
            if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        String::from_utf8_lossy(&buffer).to_string()
    }

    impl StubHttp {
        fn spawn(status: u16, body: &str) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("绑定桩端口失败");
            let port = listener.local_addr().expect("读取桩端口").port();
            let requests = Arc::new(StdMutex::new(Vec::new()));
            let captured = Arc::clone(&requests);
            let body = body.to_string();
            let handle = std::thread::spawn(move || {
                for stream in listener.incoming() {
                    let Ok(mut stream) = stream else { return };
                    let request = read_request(&mut stream);
                    captured.lock().expect("请求记录锁").push(request);
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
            // 「测试框架超时」。线程随测试进程退出即可。
            let _ = self.handle.take();
        }
    }

    /// 临时插件根目录；Drop 时清掉，避免在 %TEMP% 下越积越多。
    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("qmai-plugin-market-{tag}-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).expect("创建临时插件根目录");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// 环境变量是进程级全局状态，而 `cargo test` 默认多线程并行：
    /// 所有改写 `QMAI_PLUGIN_INDEX_URL` 的用例必须串在这把锁上，
    /// 否则彼此会看到对方写的地址（用例随机红/绿）。Drop 时恢复。
    static ENV_LOCK: StdMutex<()> = StdMutex::new(());

    struct EnvOverride {
        _guard: MutexGuard<'static, ()>,
    }

    impl EnvOverride {
        fn set(url: &str) -> Self {
            // 前一条用例 panic 过会让锁中毒，但值本身已经恢复不了 —— 取回内部值继续，
            // 否则一条失败会连带后面所有用例 panic 在 lock().unwrap() 上。
            let guard = ENV_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
            std::env::set_var(INDEX_URL_ENV, url);
            Self { _guard: guard }
        }
    }

    impl Drop for EnvOverride {
        fn drop(&mut self) {
            std::env::remove_var(INDEX_URL_ENV);
        }
    }

    /// 测试客户端：短超时 + 关代理。
    ///
    /// 关代理与 `providers` 的用例同口径：本仓 `proxy` 的用例会临时改
    /// `HTTP_PROXY`/`ALL_PROXY`，桩在回环上，走代理必错 —— 不关代理会 flaky。
    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .no_proxy()
            .build()
            .expect("构造测试客户端")
    }

    /// 绑一个端口再立刻释放：得到一个「必然拒连」的地址，用来模拟网络挂掉。
    fn closed_port() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").expect("绑定临时端口");
        let port = listener.local_addr().expect("读取端口").port();
        drop(listener);
        port
    }

    const GOOD_ENTRY: &str = r#"{
      "id": "chapter-metrics",
      "name": "章节体检",
      "repo": "https://github.com/someone/qmai-plugin-chapter-metrics",
      "description": "统计章节字数、对话占比、句长分布与重复句",
      "author": "someone",
      "categories": ["写作工具"],
      "tags": ["字数", "统计"],
      "kind": ["tools"],
      "permissions": [],
      "version": "1.0.0"
    }"#;

    fn index_json(entries: &[&str]) -> String {
        format!(
            r#"{{"version":1,"updatedAt":"2026-10-29","plugins":[{}]}}"#,
            entries.join(",")
        )
    }

    fn write_cache_file(root: &Path, fetched_at: i64, plugins: &str) {
        let body = format!(r#"{{"version":1,"fetchedAt":{fetched_at},"plugins":{plugins}}}"#);
        std::fs::write(cache_path(root), body).expect("写测试缓存");
    }

    #[test]
    fn parse_index_accepts_a_valid_entry() {
        let entries =
            parse_index(index_json(&[GOOD_ENTRY]).as_bytes()).expect("合法索引必须解析成功");
        assert_eq!(entries.len(), 1);
        let entry = &entries[0];
        assert_eq!(entry.id, "chapter-metrics");
        assert_eq!(entry.name, "章节体检");
        assert_eq!(
            entry.repo,
            "https://github.com/someone/qmai-plugin-chapter-metrics"
        );
        assert_eq!(
            entry.description,
            "统计章节字数、对话占比、句长分布与重复句"
        );
        assert_eq!(entry.author, "someone");
        assert_eq!(entry.categories, vec!["写作工具".to_string()]);
        assert_eq!(entry.tags, vec!["字数".to_string(), "统计".to_string()]);
        assert_eq!(entry.kind, vec!["tools".to_string()]);
        assert!(entry.permissions.is_empty());
        assert_eq!(entry.version.as_deref(), Some("1.0.0"));
    }

    #[test]
    fn parse_index_rejects_wrong_version() {
        let error = parse_index(br#"{"version":2,"plugins":[]}"#).expect_err("版本 2 必须被拒绝");
        assert!(
            error.contains("2") && error.contains("版本"),
            "报错要说清是哪个版本不支持：{error}"
        );
        // 缺 version / 类型不对同样是「整份索引不可信」，不能当成空市场
        assert!(
            parse_index(br#"{"plugins":[]}"#).is_err(),
            "缺 version 必须报错"
        );
        assert!(
            parse_index(br#"{"version":"1","plugins":[]}"#).is_err(),
            "version 是字符串也必须报错"
        );
        assert!(
            parse_index(br#"{"version":1,"plugins":{}}"#).is_err(),
            "plugins 不是数组必须报错"
        );
    }

    #[test]
    fn parse_index_skips_entry_with_bad_id() {
        let uppercase = GOOD_ENTRY.replace("\"chapter-metrics\"", "\"Chapter-Metrics\"");
        let underscore = GOOD_ENTRY.replace("\"chapter-metrics\"", "\"chapter_metrics\"");
        let too_short = GOOD_ENTRY.replace("\"chapter-metrics\"", "\"a\"");
        let leading_dash = GOOD_ENTRY.replace("\"chapter-metrics\"", "\"-chapter\"");
        let entries = parse_index(
            index_json(&[
                &uppercase,
                &underscore,
                &too_short,
                &leading_dash,
                GOOD_ENTRY,
            ])
            .as_bytes(),
        )
        .expect("坏条目不该拖垮整份索引");

        assert_eq!(entries.len(), 1, "只应剩下那条合法的");
        assert_eq!(entries[0].id, "chapter-metrics");
    }

    #[test]
    fn parse_index_skips_non_github_repo() {
        let gitlab = GOOD_ENTRY.replace(
            "https://github.com/someone/qmai-plugin-chapter-metrics",
            "https://gitlab.com/x/y",
        );
        let ftp = GOOD_ENTRY.replace(
            "https://github.com/someone/qmai-plugin-chapter-metrics",
            "ftp://github.com/x/y",
        );
        let plain_http = GOOD_ENTRY.replace("https://github.com/", "http://github.com/");
        let no_repo = GOOD_ENTRY.replace(
            "https://github.com/someone/qmai-plugin-chapter-metrics",
            "someone/qmai-plugin-chapter-metrics",
        );
        let entries =
            parse_index(index_json(&[&gitlab, &ftp, &plain_http, &no_repo, GOOD_ENTRY]).as_bytes())
                .expect("repo 不合法只跳过该条");

        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].repo,
            "https://github.com/someone/qmai-plugin-chapter-metrics"
        );
    }

    #[test]
    fn parse_index_dedupes_by_id_keeping_first() {
        let first = GOOD_ENTRY.replace("\"name\": \"章节体检\"", "\"name\": \"第一条\"");
        let second = GOOD_ENTRY.replace("\"name\": \"章节体检\"", "\"name\": \"第二条\"");
        let entries = parse_index(index_json(&[&first, &second]).as_bytes())
            .expect("重复 id 只该去重，不该失败");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "第一条", "重复 id 必须保留第一条");
    }

    #[tokio::test]
    async fn load_index_uses_cache_when_fresh() {
        let root = TempRoot::new("fresh-cache");
        let stub = StubHttp::spawn(200, &index_json(&[GOOD_ENTRY]));
        let _env = EnvOverride::set(&stub.base);
        let now = now_unix();
        write_cache_file(root.path(), now, &format!("[{GOOD_ENTRY}]"));

        let index = load_index(&client(), root.path(), false)
            .await
            .expect("新鲜缓存必须直接命中");

        assert_eq!(index.plugins.len(), 1);
        assert_eq!(index.plugins[0].id, "chapter-metrics");
        assert_eq!(index.fetched_at, Some(now));
        assert_eq!(index.source_url, stub.base, "命令要回报实际使用的索引地址");
        assert!(
            !index.from_cache,
            "新鲜缓存仍在承诺的时效内，不该被标成降级"
        );
        assert!(
            stub.requests().is_empty(),
            "新鲜缓存命中时不应发起任何网络请求"
        );
    }

    #[tokio::test]
    async fn load_index_falls_back_to_cache_on_network_failure() {
        let root = TempRoot::new("stale-cache");
        // 500 而不是拒连：走完「请求发出去了、服务端回了错」这条真实分支
        let stub = StubHttp::spawn(500, "boom");
        let _env = EnvOverride::set(&stub.base);
        let stale = now_unix() - CACHE_TTL_SECS - 60;
        write_cache_file(root.path(), stale, &format!("[{GOOD_ENTRY}]"));

        let index = load_index(&client(), root.path(), false)
            .await
            .expect("网络挂了也要返回缓存");

        assert!(index.from_cache, "降级时必须标 fromCache=true");
        assert_eq!(index.fetched_at, Some(stale), "降级时回报的是缓存写入时间");
        assert_eq!(index.plugins.len(), 1);
        assert_eq!(index.plugins[0].id, "chapter-metrics");
        assert_eq!(index.source_url, stub.base);
        assert_eq!(stub.requests().len(), 1, "缓存过期后必须真的去拉一次");

        // 手动刷新总是重拉：即使缓存还在 TTL 内也不复用
        let refreshed = load_index(&client(), root.path(), true)
            .await
            .expect("手动刷新失败时同样降级到缓存");
        assert!(refreshed.from_cache);
        assert_eq!(stub.requests().len(), 2, "refresh=true 必须再拉一次");
    }

    #[tokio::test]
    async fn load_index_errors_when_no_cache_and_network_fails() {
        let root = TempRoot::new("no-cache");
        let _env = EnvOverride::set(&format!("http://127.0.0.1:{}", closed_port()));

        let error = load_index(&client(), root.path(), false)
            .await
            .expect_err("没有缓存时网络失败必须报错");

        assert!(error.contains("缓存"), "报错要说清是「没有缓存」：{error}");
        assert!(!cache_path(root.path()).exists(), "失败不该留下缓存文件");
    }

    #[tokio::test]
    async fn load_index_writes_cache_after_successful_fetch() {
        let root = TempRoot::new("cache-write");
        let stub = StubHttp::spawn(200, &index_json(&[GOOD_ENTRY]));
        let _env = EnvOverride::set(&stub.base);

        let index = load_index(&client(), root.path(), false)
            .await
            .expect("首次拉取必须成功");

        assert!(!index.from_cache);
        assert!(index.fetched_at.is_some());

        let raw = std::fs::read_to_string(cache_path(root.path())).expect("成功后必须落盘缓存");
        let doc: serde_json::Value = serde_json::from_str(&raw).expect("缓存必须是合法 JSON");
        assert_eq!(doc["version"].as_u64(), Some(1));
        assert_eq!(doc["fetchedAt"].as_i64(), index.fetched_at);
        let plugins = doc["plugins"].as_array().expect("缓存里要有 plugins 数组");
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0]["id"], "chapter-metrics");
        assert_eq!(
            plugins[0]["repo"],
            "https://github.com/someone/qmai-plugin-chapter-metrics"
        );
    }

    #[tokio::test]
    async fn index_url_env_override_is_respected() {
        let root = TempRoot::new("env-override");
        let stub = StubHttp::spawn(200, &index_json(&[]));
        let url = format!("{}/mirror/index.json", stub.base);
        let _env = EnvOverride::set(&url);

        assert_eq!(index_url(), url, "环境变量必须优先于默认地址");

        let index = load_index(&client(), root.path(), false)
            .await
            .expect("自建市场地址必须可用");

        assert_eq!(index.source_url, url);
        assert!(
            index.plugins.is_empty(),
            "空索引是合法索引（首版市场就是空的）"
        );

        let requests = stub.requests();
        assert_eq!(requests.len(), 1);
        let first = requests[0].to_ascii_lowercase();
        assert!(
            first.contains("get /mirror/index.json"),
            "必须请求环境变量给的路径：{first}"
        );
        assert!(
            first.contains(
                &format!("user-agent: qmai/{}", env!("CARGO_PKG_VERSION")).to_ascii_lowercase()
            ),
            "请求必须带可辨识的 UA：{first}"
        );
    }
}
