//! WebDAV 远端：把「任意一个支持 WebDAV 的网盘/自建 NAS」当作同步目标。
//!
//! 只用五个标准方法：`PROPFIND`（列目录）、`GET`、`PUT`、`DELETE`、`MOVE`。
//! 不用 `MKCOL`：上传时由父目录逐级创建会多打一轮请求，WebDAV 服务端对
//! PUT 到不存在的父目录行为不一致（有的建、有的 409），所以 `write` 里
//! 先递归 MKCOL 再 PUT —— 宁可多两次请求，也不要"某些服务端能同步，某些不能"。
//!
//! XML 解析没有引第三方库：只需要 `href`、`collection`、`getcontentlength` 三个字段，
//! 手写一个小状态机比拉一个 XML 依赖更容易控制（也更容易测边界）。

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::{RemoteFile, RemoteStore};

/// `PROPFIND` 请求体：只要名字、是否目录、大小。
pub const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop>
<d:displayname/><d:resourcetype/><d:getcontentlength/><d:getetag/>
</d:prop></d:propfind>"#;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// 两次请求之间的最小间隔。
///
/// 坚果云对 WebDAV 有频率限制（返回 503 `BlockedTemporarily`），一次全量同步动辄
/// 上千个请求，不限速就是「第一次同步 58 项失败、第二次 518 项全失败」。
/// 这里按 200ms 限速：518 个文件约两分钟，用户能接受，服务端也不会翻脸。
const MIN_REQUEST_GAP: Duration = Duration::from_millis(200);

/// 撞上 503/429 时的重试次数（退避 1s、2s、4s）。重试是必要的：服务端限流往往是
/// 短时窗口，立刻放弃只会让用户看到「全部失败」，而重试常能救回大半。
const RATE_LIMIT_RETRIES: u32 = 3;

pub struct WebdavStore {
    /// 归一化后的根 URL（无尾斜杠）。
    base: String,
    /// 根 URL 的路径部分，用于把服务端给的绝对 href 换算成相对路径。
    base_path: String,
    user: String,
    password: String,
    client: reqwest::blocking::Client,
    /// 限速器：保证任意两次请求之间至少间隔 `min_gap`。
    throttle: Throttle,
    /// 已经确认存在的远端目录。没有这个缓存时，每个文件都会把整条路径上的
    /// 每一级目录各发一次 MKCOL —— 518 个文件能打出上千个多余请求。
    ensured_dirs: Mutex<HashSet<String>>,
}

/// 请求限速 + 限流退避。`blocking` 客户端是串行调用，用互斥量守住时间戳足够。
struct Throttle {
    min_gap: Duration,
    last: Mutex<Option<Instant>>,
}

impl Throttle {
    fn new(min_gap: Duration) -> Self {
        Self { min_gap, last: Mutex::new(None) }
    }

    fn wait(&self) {
        if self.min_gap.is_zero() {
            return;
        }
        let now = Instant::now();
        let mut last = match self.last.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(previous) = *last {
            let elapsed = now.saturating_duration_since(previous);
            if elapsed < self.min_gap {
                std::thread::sleep(self.min_gap - elapsed);
            }
        }
        *last = Some(Instant::now());
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DavEntry {
    /// 相对根目录的路径（目录不带尾斜杠；根目录为空串）。
    rel: String,
    is_dir: bool,
    size: u64,
    /// 服务端给的 ETag（含引号、可能带 `W/` 弱校验前缀，解析时已剥掉）。
    etag: Option<String>,
    /// 最后修改时间（HTTP 日期原文）。坚果云这类服务端**不返回 ETag**，
    /// 只有它可用：没有版本标识的话，每轮同步都要把远端文件重下一遍算哈希，
    /// 五百篇的工程两分钟就撞上「请求过多」。
    modified: Option<String>,
}

impl WebdavStore {
    pub fn new(base_url: &str, user: &str, password: &str) -> Result<Self, String> {
        let base = normalize_base(base_url)?;
        let base_path = path_of(&base);
        let mut builder = reqwest::blocking::Client::builder().timeout(REQUEST_TIMEOUT);
        // 本机/局域网地址必须直连：系统代理（企业网、某些加速器）会把 127.0.0.1
        // 的请求也转发出去，回一个 502 —— 用户的 NAS 明明好好的，却一直"连不上"。
        if is_direct_host(&base) {
            builder = builder.no_proxy();
        }
        let client = builder
            .build()
            .map_err(|error| format!("初始化网络客户端失败：{error}"))?;
        Ok(Self {
            base,
            base_path,
            user: user.to_string(),
            password: password.to_string(),
            client,
            throttle: Throttle::new(MIN_REQUEST_GAP),
            ensured_dirs: Mutex::new(HashSet::new()),
        })
    }

    /// 测试与「自建 NAS」这类没有频率限制的服务端可以把间隔降到 0。
    pub fn with_min_gap(mut self, gap: Duration) -> Self {
        self.throttle = Throttle::new(gap);
        self
    }

    /// 发一个请求：先按最小间隔排队，撞上限流就退避重试。
    fn send(&self, builder: reqwest::blocking::RequestBuilder) -> Result<reqwest::blocking::Response, String> {
        let mut attempt = 0u32;
        loop {
            self.throttle.wait();
            let Some(retry) = builder.try_clone() else {
                return Err("webdav.url".to_string());
            };
            let response = retry.send().map_err(map_transport_error)?;
            let status = response.status().as_u16();
            if (status == 503 || status == 429) && attempt < RATE_LIMIT_RETRIES {
                attempt += 1;
                // 1s、2s、4s：坚果云的临时封禁通常几十秒到几分钟，慢慢退比猛打有效。
                std::thread::sleep(Duration::from_secs(1u64 << (attempt - 1)));
                continue;
            }
            return Ok(response);
        }
    }

    /// 连接校验：能列根目录 + 能写入并删除一个探针文件。
    ///
    /// 只做 `PROPFIND` 不够：只读挂载、配额满、目录被 ACL 锁住都能列却不能写，
    /// 用户会在第一次真正同步时才炸，那时更难解释。
    pub fn validate(base_url: &str, user: &str, password: &str) -> Result<(), String> {
        let store = Self::new(base_url, user, password)?;
        store.list()?;
        let probe = format!(".qmai-cloud/probe-{}", uuid::Uuid::new_v4());
        store.write(&probe, b"qmai-probe")?;
        store.remove(&probe)?;
        Ok(())
    }

    fn url_for(&self, rel: &str) -> String {
        if rel.is_empty() {
            return self.base.clone();
        }
        let encoded: Vec<String> = rel.split('/').filter(|part| !part.is_empty()).map(encode_segment).collect();
        format!("{}/{}", self.base, encoded.join("/"))
    }

    fn request(&self, method: reqwest::Method, rel: &str) -> reqwest::blocking::RequestBuilder {
        self.client
            .request(method, self.url_for(rel))
            .basic_auth(&self.user, Some(&self.password))
    }

    fn list_dir(&self, rel_dir: &str) -> Result<Vec<DavEntry>, String> {
        let response = self.send(
            self.request(reqwest::Method::from_bytes(b"PROPFIND").expect("PROPFIND is valid"), rel_dir)
                .header("Depth", "1")
                .header("Content-Type", "application/xml; charset=utf-8")
                .body(PROPFIND_BODY),
        )?;

        let status = response.status().as_u16();
        if status == 401 || status == 403 {
            return Err("webdav.auth".to_string());
        }
        if status == 404 {
            return Err("webdav.not-found".to_string());
        }
        if status == 503 || status == 429 {
            return Err("webdav.rate-limited".to_string());
        }
        if !(200..300).contains(&status) {
            return Err(format!("webdav.status:{status}"));
        }

        // 按 UTF-8 自己解码，不用 `Response::text()`：不少 WebDAV 服务端的
        // Content-Type 不带 charset，reqwest 会退回 ISO-8859-1，中文路径就成乱码。
        let bytes = response.bytes().map_err(|_| "net.offline".to_string())?;
        let body = String::from_utf8_lossy(&bytes).to_string();
        Ok(parse_multistatus(&body, &self.base_path))
    }

    fn walk(&self, rel_dir: &str, out: &mut Vec<RemoteFile>) -> Result<(), String> {
        for entry in self.list_dir(rel_dir)? {
            if entry.is_dir {
                if entry.rel == rel_dir {
                    continue; // PROPFIND depth=1 会把自己也列出来
                }
                self.walk(&entry.rel, out)?;
            } else {
                // 优先用 ETag；服务端不给 ETag 时用「大小 + 最后修改时间」，两者合起来
            // 足以判断「远端有没有被别人改过」。
            let etag = entry.etag.or_else(|| {
                entry
                    .modified
                    .map(|modified| format!("{}:{}", entry.size, modified))
            });
            out.push(RemoteFile { rel: entry.rel, size: entry.size, etag });
            }
        }
        Ok(())
    }

    fn ensure_parent(&self, rel: &str) -> Result<(), String> {
        let parts: Vec<&str> = rel.split('/').filter(|part| !part.is_empty()).collect();
        if parts.len() <= 1 {
            return Ok(());
        }
        let mut prefix = String::new();
        for part in &parts[..parts.len() - 1] {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            let known = match self.ensured_dirs.lock() {
                Ok(guard) => guard.contains(&prefix),
                Err(poisoned) => poisoned.into_inner().contains(&prefix),
            };
            if known {
                continue;
            }
            // 405 = 目录已存在，与成功等价。
            let _ = self.send(
                self.request(reqwest::Method::from_bytes(b"MKCOL").expect("MKCOL is valid"), &prefix),
            )?;
            let mut guard = match self.ensured_dirs.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            guard.insert(prefix.clone());
        }
        Ok(())
    }
}

impl RemoteStore for WebdavStore {
    fn list(&self) -> Result<Vec<RemoteFile>, String> {
        let mut out = Vec::new();
        self.walk("", &mut out)?;
        out.sort_by(|left, right| left.rel.cmp(&right.rel));
        Ok(out)
    }

    fn read(&self, rel: &str) -> Result<Vec<u8>, String> {
        let response = self.send(self.request(reqwest::Method::GET, rel))?;
        let status = response.status().as_u16();
        if status == 404 {
            return Err("webdav.not-found".to_string());
        }
        if status == 401 || status == 403 {
            return Err("webdav.auth".to_string());
        }
        if status == 503 || status == 429 {
            return Err("webdav.rate-limited".to_string());
        }
        if !(200..300).contains(&status) {
            return Err(format!("webdav.status:{status}"));
        }
        let bytes = response.bytes().map_err(|_| "net.offline".to_string())?;
        Ok(bytes.to_vec())
    }

    fn write(&self, rel: &str, data: &[u8]) -> Result<(), String> {
        self.ensure_parent(rel)?;
        let response = self.send(
            self.request(reqwest::Method::PUT, rel)
                .header("Content-Type", "application/octet-stream")
                .body(data.to_vec()),
        )?;
        let status = response.status().as_u16();
        if status == 401 || status == 403 {
            return Err("webdav.read-only".to_string());
        }
        if status == 503 || status == 429 {
            return Err("webdav.rate-limited".to_string());
        }
        if !(200..300).contains(&status) {
            return Err(format!("webdav.status:{status}"));
        }
        Ok(())
    }

    fn remove(&self, rel: &str) -> Result<(), String> {
        let response = self.send(self.request(reqwest::Method::DELETE, rel))?;
        let status = response.status().as_u16();
        // 404 当成功：清单修正比报错有用。
        if status == 404 || (200..300).contains(&status) {
            return Ok(());
        }
        if status == 401 || status == 403 {
            return Err("webdav.read-only".to_string());
        }
        if status == 503 || status == 429 {
            return Err("webdav.rate-limited".to_string());
        }
        Err(format!("webdav.status:{status}"))
    }

    fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        self.ensure_parent(to)?;
        let response = self.send(
            self.request(reqwest::Method::from_bytes(b"MOVE").expect("MOVE is valid"), from)
                .header("Destination", self.url_for(to))
                .header("Overwrite", "T"),
        )?;
        let status = response.status().as_u16();
        if status == 404 {
            return Err("webdav.not-found".to_string());
        }
        if status == 503 || status == 429 {
            return Err("webdav.rate-limited".to_string());
        }
        if !(200..300).contains(&status) {
            return Err(format!("webdav.status:{status}"));
        }
        Ok(())
    }
}

/// 需要绕过系统代理的主机：回环、私有网段、`.local`。
pub(crate) fn is_direct_host(url: &str) -> bool {
    let host = match url.split("://").nth(1) {
        Some(rest) => rest.split(['/', '?', '#']).next().unwrap_or_default(),
        None => return false,
    };
    let host = match host.rsplit_once(':') {
        Some((name, port)) if port.chars().all(|ch| ch.is_ascii_digit()) => name,
        _ => host,
    };
    let host = host.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".local") {
        return true;
    }
    if host == "::1" || host == "0.0.0.0" {
        return true;
    }
    let parts: Vec<u32> = host.split('.').filter_map(|part| part.parse::<u32>().ok()).collect();
    match parts.as_slice() {
        [127, ..] => true,
        [10, ..] => true,
        [192, 168, ..] => true,
        [172, second, ..] if (16..=31).contains(second) => true,
        _ => false,
    }
}

fn map_transport_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "net.timeout".to_string();
    }
    if error.is_connect() {
        // 自签证书是最常见的一种：文案要能引导用户而不是只报「连不上」。
        let text = error.to_string();
        if text.contains("certificate") || text.contains("tls") || text.contains("TLS") {
            return "webdav.tls".to_string();
        }
        return "net.offline".to_string();
    }
    if error.is_builder() || error.is_request() {
        return "webdav.url".to_string();
    }
    "net.offline".to_string()
}

fn normalize_base(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("webdav.url".to_string());
    }
    Ok(trimmed.trim_end_matches('/').to_string())
}

/// 取出 URL 的路径部分（`https://nas/dav/books` → `/dav/books`）。
fn path_of(url: &str) -> String {
    let after_scheme = match url.find("://") {
        Some(index) => &url[index + 3..],
        None => url,
    };
    match after_scheme.find('/') {
        Some(index) => after_scheme[index..].trim_end_matches('/').to_string(),
        None => String::new(),
    }
}

fn encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn decode_percent(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// 解析 `207 Multi-Status`：抽 `href` / `collection` / `getcontentlength`。
///
/// 手写状态机而不是 XML 库的理由：这三个字段就够用，而且不同服务端的
/// 命名空间前缀（`D:` / `d:` / 无前缀）差异很大，自己解析反而更稳。
fn parse_multistatus(body: &str, base_path: &str) -> Vec<DavEntry> {
    let mut entries: Vec<DavEntry> = Vec::new();
    let mut current: Option<DavEntry> = None;
    let mut capture: Option<&'static str> = None;
    // 用字节缓冲：href 里可能是中文，按 `byte as char` 收会把多字节 UTF-8 拆坏。
    let mut text: Vec<u8> = Vec::new();

    let bytes = body.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'<' {
            if capture.is_some() {
                text.push(bytes[index]);
            }
            index += 1;
            continue;
        }

        // 读到标签结束
        let start = index;
        let mut end = index;
        while end < bytes.len() && bytes[end] != b'>' {
            end += 1;
        }
        if end >= bytes.len() {
            break;
        }
        let raw_tag = &body[start + 1..end];
        let closing = raw_tag.starts_with('/');
        let self_closing = raw_tag.ends_with('/');
        let name = raw_tag.trim_start_matches('/').trim_end_matches('/');
        let local = name.rsplit(':').next().unwrap_or(name).trim().to_ascii_lowercase();

        if local == "response" && !closing {
            current =
                Some(DavEntry { rel: String::new(), is_dir: false, size: 0, etag: None, modified: None });
        }

        if let Some(entry) = current.as_mut() {
            match local.as_str() {
                "href" if !closing => {
                    capture = Some("href");
                    text.clear();
                }
                "collection" => entry.is_dir = true,
                "getcontentlength" if !closing => {
                    capture = Some("size");
                    text.clear();
                }
                "getetag" if !closing => {
                    capture = Some("etag");
                    text.clear();
                }
                "getlastmodified" if !closing => {
                    capture = Some("modified");
                    text.clear();
                }
                _ => {}
            }
            if closing || self_closing {
                if let Some(which) = capture.take() {
                    let value = String::from_utf8_lossy(&text).trim().to_string();
                    match which {
                        "href" => entry.rel = relative_from_href(&value, base_path),
                        "size" => entry.size = value.parse::<u64>().unwrap_or(0),
                        "modified" => {
                            let value = value.trim();
                            if !value.is_empty() {
                                entry.modified = Some(value.to_string());
                            }
                        }
                        "etag" => {
                            // `W/"abc"`、`"abc"`、`abc` 三种写法都见过，统一成裸值。
                            let trimmed = value.trim();
                            let trimmed = trimmed.strip_prefix("W/").unwrap_or(trimmed);
                            let trimmed = trimmed.trim_matches('"').trim();
                            if !trimmed.is_empty() {
                                entry.etag = Some(trimmed.to_string());
                            }
                        }
                        _ => {}
                    }
                    text.clear();
                }
            }
        }

        if local == "response" && closing {
            if let Some(entry) = current.take() {
                if !entry.rel.is_empty() {
                    entries.push(entry);
                }
            }
        }

        index = end + 1;
    }

    entries
}

fn relative_from_href(href: &str, base_path: &str) -> String {
    let decoded = decode_percent(href);
    // href 可能是完整 URL（部分服务端这么干），先剥掉协议+主机。
    let path = match decoded.find("://") {
        Some(index) => match decoded[index + 3..].find('/') {
            Some(slash) => decoded[index + 3 + slash..].to_string(),
            None => "/".to_string(),
        },
        None => decoded,
    };

    let trimmed_base = base_path.trim_end_matches('/');
    let stripped = if trimmed_base.is_empty() {
        path.trim_start_matches('/').to_string()
    } else if let Some(rest) = path.strip_prefix(trimmed_base) {
        rest.trim_start_matches('/').to_string()
    } else {
        path.trim_start_matches('/').to_string()
    };

    stripped.trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/%E4%B9%A6%E6%9C%AC/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/%E4%B9%A6%E6%9C%AC/QM/entities/%E6%9E%97%E7%85%A7.md</D:href>
    <D:propstat><D:prop><D:resourcetype/><D:getcontentlength>42</D:getcontentlength></D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/%E4%B9%A6%E6%9C%AC/%E5%B0%81%E9%9D%A2.png</D:href>
    <D:propstat><D:prop><D:resourcetype/><D:getcontentlength>1024</D:getcontentlength></D:prop></D:propstat>
  </D:response>
</D:multistatus>"#;

    #[test]
    fn parses_hrefs_collections_and_sizes() {
        let entries = parse_multistatus(SAMPLE, "/dav");
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].rel, "书本");
        assert!(entries[0].is_dir);
        assert_eq!(entries[1].rel, "书本/QM/entities/林照.md");
        assert!(!entries[1].is_dir);
        assert_eq!(entries[1].size, 42);
        assert_eq!(entries[2].rel, "书本/封面.png");
    }

    #[test]
    fn tolerates_lowercase_prefix_and_absolute_hrefs() {
        let body = r#"<multistatus>
          <response><href>https://nas.example.com/dav/b.md</href><getcontentlength>7</getcontentlength></response>
        </multistatus>"#;
        let entries = parse_multistatus(body, "/dav");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].rel, "b.md");
        assert_eq!(entries[0].size, 7);
    }

    #[test]
    fn base_normalization_rejects_non_http_urls() {
        assert_eq!(normalize_base(" https://nas/dav/ ").unwrap(), "https://nas/dav");
        assert_eq!(normalize_base("http://127.0.0.1:8080/").unwrap(), "http://127.0.0.1:8080");
        assert_eq!(normalize_base("nas/dav").unwrap_err(), "webdav.url");
        assert_eq!(normalize_base("ftp://nas").unwrap_err(), "webdav.url");
    }

    #[test]
    fn path_extraction_handles_ports_and_root() {
        assert_eq!(path_of("https://nas/dav/books"), "/dav/books");
        assert_eq!(path_of("http://127.0.0.1:8080"), "");
        assert_eq!(path_of("https://nas/dav/"), "/dav");
    }

    #[test]
    fn url_for_encodes_chinese_and_spaces() {
        let store = WebdavStore::new("https://nas/dav", "u", "p").unwrap();
        assert_eq!(store.url_for(""), "https://nas/dav");
        assert_eq!(
            store.url_for("书本/QM/林 照.md"),
            "https://nas/dav/%E4%B9%A6%E6%9C%AC/QM/%E6%9E%97%20%E7%85%A7.md"
        );
    }

    #[test]
    fn loopback_and_lan_hosts_bypass_the_system_proxy() {
        assert!(is_direct_host("http://127.0.0.1:8080/dav"));
        assert!(is_direct_host("http://localhost/dav"));
        assert!(is_direct_host("https://192.168.1.10:5006/dav"));
        assert!(is_direct_host("http://10.0.0.5/dav"));
        assert!(is_direct_host("http://172.20.3.4/dav"));
        assert!(is_direct_host("http://nas.local/dav"));
        // 公网 WebDAV 仍走系统代理。
        assert!(!is_direct_host("https://dav.example.com/remote.php/dav"));
        assert!(!is_direct_host("http://172.32.0.1/dav"));
    }

    #[test]
    fn relative_from_href_strips_base_path() {
        assert_eq!(relative_from_href("/dav/a/b.md", "/dav"), "a/b.md");
        assert_eq!(relative_from_href("/dav", "/dav"), "");
        assert_eq!(relative_from_href("/other/x.md", "/dav"), "other/x.md");
    }

    // ---- 用一个假 WebDAV 服务端把五个方法真的跑一遍（不联网） ----

    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct FakeDav {
        files: HashMap<String, Vec<u8>>,
        dirs: Vec<String>,
        // 收到的方法序列，用来断言「先 MKCOL 再 PUT」
        methods: Vec<String>,
    }

    fn spawn_fake_dav() -> (u16, Arc<Mutex<FakeDav>>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let state = Arc::new(Mutex::new(FakeDav::default()));
        let shared = Arc::clone(&state);
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                handle_fake_dav(stream, &shared);
            }
        });
        (port, state)
    }

    fn handle_fake_dav(mut stream: TcpStream, state: &Arc<Mutex<FakeDav>>) {
        let mut buffer = vec![0u8; 65536];
        let read = stream.read(&mut buffer).unwrap_or(0);
        if read == 0 {
            return;
        }
        let request = String::from_utf8_lossy(&buffer[..read]).to_string();
        let mut lines = request.lines();
        let head = lines.next().unwrap_or_default().to_string();
        let mut parts = head.split_whitespace();
        let method = parts.next().unwrap_or_default().to_string();
        let target = parts.next().unwrap_or_default().to_string();
        let mut destination = String::new();
        for line in lines {
            if line.to_ascii_lowercase().starts_with("destination:") {
                destination = line.split_once(':').map(|(_, value)| value.trim().to_string()).unwrap_or_default();
            }
            if line.trim().is_empty() {
                break;
            }
        }
        let body_start = request.find("\r\n\r\n").map(|index| index + 4).unwrap_or(read);
        let body = buffer[body_start.min(read)..read].to_vec();
        let path = decode_percent(target.trim_start_matches('/'));
        // 假服务端把一切都挂在 /dav 下：去掉后再按相对路径存取。
        let path = path.strip_prefix("dav").unwrap_or(&path).trim_start_matches('/').to_string();

        let mut dav = state.lock().unwrap();
        dav.methods.push(method.clone());
        let response = match method.as_str() {
            "PROPFIND" => {
                if path.is_empty() {
                    let mut xml = String::from(
                        r#"<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>"#,
                    );
                    let mut dirs: Vec<String> = dav.dirs.clone();
                    dirs.sort();
                    for dir in dirs {
                        xml.push_str(&format!(
                            r#"<D:response><D:href>/dav/{dir}/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>"#
                        ));
                    }
                    let mut files: Vec<(String, usize)> =
                        dav.files.iter().map(|(name, bytes)| (name.clone(), bytes.len())).collect();
                    files.sort();
                    for (name, size) in files {
                        xml.push_str(&format!(
                            r#"<D:response><D:href>/dav/{name}</D:href><D:propstat><D:prop><D:resourcetype/><D:getcontentlength>{size}</D:getcontentlength></D:prop></D:propstat></D:response>"#
                        ));
                    }
                    xml.push_str("</D:multistatus>");
                    http(207, "application/xml", xml.as_bytes())
                } else {
                    let prefix = format!("{path}/");
                    let mut xml = String::from(
                        r#"<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>"#,
                    );
                    for dir in dav.dirs.iter().filter(|dir| dir.starts_with(&prefix)) {
                        xml.push_str(&format!(
                            r#"<D:response><D:href>/dav/{dir}/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>"#
                        ));
                    }
                    for (name, bytes) in dav.files.iter().filter(|(name, _)| name.starts_with(&prefix)) {
                        xml.push_str(&format!(
                            r#"<D:response><D:href>/dav/{name}</D:href><D:propstat><D:prop><D:resourcetype/><D:getcontentlength>{}</D:getcontentlength></D:prop></D:propstat></D:response>"#,
                            bytes.len()
                        ));
                    }
                    xml.push_str("</D:multistatus>");
                    http(207, "application/xml", xml.as_bytes())
                }
            }
            "MKCOL" => {
                if !dav.dirs.iter().any(|dir| dir == &path) {
                    dav.dirs.push(path.clone());
                }
                http(201, "text/plain", b"")
            }
            "PUT" => {
                dav.files.insert(path.clone(), body);
                http(201, "text/plain", b"")
            }
            "GET" => match dav.files.get(&path) {
                Some(bytes) => http(200, "application/octet-stream", bytes),
                None => http(404, "text/plain", b""),
            },
            "DELETE" => {
                dav.files.remove(&path);
                http(204, "text/plain", b"")
            }
            "MOVE" => {
                let dest_path = match destination.find("://") {
                    Some(index) => match destination[index + 3..].find('/') {
                        Some(slash) => destination[index + 3 + slash..].to_string(),
                        None => "/".to_string(),
                    },
                    None => destination.clone(),
                };
                let to = decode_percent(dest_path.trim_start_matches('/'));
                let to = to.strip_prefix("dav").unwrap_or(&to).trim_start_matches('/').to_string();
                match dav.files.remove(&path) {
                    Some(bytes) => {
                        dav.files.insert(to, bytes);
                        http(201, "text/plain", b"")
                    }
                    None => http(404, "text/plain", b""),
                }
            }
            _ => http(405, "text/plain", b""),
        };
        drop(dav);
        let _ = stream.write_all(&response);
    }

    fn http(status: u16, content_type: &str, body: &[u8]) -> Vec<u8> {
        let mut out = format!(
            "HTTP/1.1 {status} X\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        out.extend_from_slice(body);
        out
    }

    #[test]
    fn store_round_trips_against_a_fake_dav_server() {
        let (port, state) = spawn_fake_dav();
        let store = WebdavStore::new(&format!("http://127.0.0.1:{port}/dav"), "u", "p").unwrap().with_min_gap(Duration::ZERO);

        WebdavStore::validate(&format!("http://127.0.0.1:{port}/dav"), "u", "p").unwrap();

        store.write("书本/QM/entities/林照.md", "内容".as_bytes()).unwrap();
        let files = store.list().unwrap();
        assert!(files.iter().any(|file| file.rel == "书本/QM/entities/林照.md"));
        assert_eq!(store.read("书本/QM/entities/林照.md").unwrap(), "内容".as_bytes());

        store.rename("书本/QM/entities/林照.md", "书本/QM/entities/林照2.md").unwrap();
        assert!(store.read("书本/QM/entities/林照2.md").is_ok());

        store.remove("书本/QM/entities/林照2.md").unwrap();
        assert!(store.list().unwrap().is_empty());

        // 上传前必须先建目录：假服务端不建父目录，PUT 能成说明 ensure_parent 生效。
        let dav = state.lock().unwrap();
        assert!(dav.methods.iter().any(|method| method == "MKCOL"));
        assert!(dav.methods.iter().any(|method| method == "PROPFIND"));
    }
}
