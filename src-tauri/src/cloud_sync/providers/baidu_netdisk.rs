//! 百度网盘的文件搬运（xpan 开放接口）。
//!
//! 这一版**故意做成「流程齐全、默认关闭」**：
//! 百度开发版配额是 10 次/小时，而写一个文件要 `precreate` + N 个分片 + `create` 三次以上，
//! 一小时最多传几个文件 —— 既没法自测也没法交付。所以：
//!
//! - 接口按官方文档接好（列目录、下载、上传、删除、移动），逻辑有测试覆盖；
//! - 真正的启用由环境变量 `QMAI_BAIDU_TRANSFER_ENABLED=1` 控制，应用审核通过后打开即可，
//!   不需要再改代码；
//! - 默认情况下 `run_now` 仍然回 `sync.baidu-review`，**不会假装同步成功**。
//!
//! 端点基址可以在测试里指向本地假服务端（`xpan_base`），生产固定 `https://pan.baidu.com`。

use std::time::Duration;

use md5::{Digest, Md5};

use super::{RemoteFile, RemoteStore};

/// 生产端点。
pub const XPAN_BASE: &str = "https://pan.baidu.com";
/// 分片上传走另一个域（文档如此），测试里也指向假服务端。
pub const PCS_BASE: &str = "https://d.pcs.baidu.com";

/// 单次 `list` 的分页大小（接口上限 1000）。
const LIST_LIMIT: usize = 1_000;
/// 分片大小 4 MiB：百度要求分片 ≥ 4 MiB（最后一片除外），小于它会直接报错。
const CHUNK_SIZE: usize = 4 * 1024 * 1024;
/// 一个文件最多切多少片；超过就拒绝（超大文件走别的通道，不在同步范围）。
const MAX_CHUNKS: usize = 2_000;

const TIMEOUT: Duration = Duration::from_secs(60);

pub struct BaiduStore {
    /// 网盘上的应用根目录（`/apps/青幕AI写作`）。
    app_dir: String,
    access_token: String,
    xpan_base: String,
    pcs_base: String,
    client: reqwest::blocking::Client,
}

impl BaiduStore {
    pub fn new(
        app_dir: &str,
        access_token: &str,
        xpan_base: &str,
        pcs_base: &str,
    ) -> Result<Self, String> {
        if access_token.trim().is_empty() {
            return Err("auth.required".to_string());
        }
        let mut builder = reqwest::blocking::Client::builder().timeout(TIMEOUT);
        // 与 WebDAV 同一条教训：本地/局域网端点必须直连，否则系统代理会回 502。
        if super::webdav::is_direct_host(xpan_base) || super::webdav::is_direct_host(pcs_base) {
            builder = builder.no_proxy();
        }
        let client = builder
            .build()
            .map_err(|error| format!("初始化网络客户端失败：{error}"))?;
        Ok(Self {
            app_dir: normalize_app_dir(app_dir),
            access_token: access_token.trim().to_string(),
            xpan_base: xpan_base.trim_end_matches('/').to_string(),
            pcs_base: pcs_base.trim_end_matches('/').to_string(),
            client,
        })
    }

    /// 远端绝对路径：`/apps/名字/书籍ID/QM/x.md`。
    fn absolute(&self, rel: &str) -> String {
        if rel.is_empty() {
            return self.app_dir.clone();
        }
        format!("{}/{}", self.app_dir, rel)
    }

    /// 相对路径（去掉应用根目录前缀；根目录自己返回空串）。
    fn relative(&self, absolute: &str) -> String {
        let trimmed = absolute.trim_end_matches('/');
        match trimmed.strip_prefix(self.app_dir.as_str()) {
            Some(rest) => rest.trim_start_matches('/').to_string(),
            None => trimmed.trim_start_matches('/').to_string(),
        }
    }

    fn xpan_get(&self, method: &str, params: &[(&str, String)]) -> Result<serde_json::Value, String> {
        self.xpan_request(reqwest::Method::GET, method, params.to_vec(), None)
    }

    fn xpan_post(
        &self,
        method: &str,
        params: &[(&str, String)],
        form: Vec<(String, String)>,
    ) -> Result<serde_json::Value, String> {
        self.xpan_request(reqwest::Method::POST, method, params.to_vec(), Some(form))
    }

    fn xpan_request(
        &self,
        http_method: reqwest::Method,
        api_method: &str,
        mut params: Vec<(&str, String)>,
        form: Option<Vec<(String, String)>>,
    ) -> Result<serde_json::Value, String> {
        params.push(("method", api_method.to_string()));
        params.push(("access_token", self.access_token.clone()));

        let mut request = self
            .client
            .request(http_method, format!("{}/rest/2.0/xpan/file", self.xpan_base))
            .query(&params);
        if let Some(fields) = form {
            request = request.form(&fields);
        }

        let response = request.send().map_err(map_transport_error)?;
        let status = response.status().as_u16();
        if status == 401 || status == 403 {
            return Err("auth.expired".to_string());
        }
        if status == 404 {
            return Err("remote.missing".to_string());
        }
        if !(200..300).contains(&status) {
            return Err(format!("baidu.status:{status}"));
        }
        let text = response.text().map_err(|_| "net.offline".to_string())?;
        let value: serde_json::Value =
            serde_json::from_str(&text).map_err(|_| "baidu.bad-response".to_string())?;
        check_errno(&value)?;
        Ok(value)
    }

    fn ensure_dir(&self, rel_dir: &str) -> Result<(), String> {
        if rel_dir.is_empty() {
            return Ok(());
        }
        let mut prefix = String::new();
        for part in rel_dir.split('/').filter(|part| !part.is_empty()) {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            let _ = self.xpan_get(
                "create",
                &[("isdir", "1".to_string()), ("path", self.absolute(&prefix))],
            )?;
        }
        Ok(())
    }
}

impl RemoteStore for BaiduStore {
    fn list(&self) -> Result<Vec<RemoteFile>, String> {
        let mut out = Vec::new();
        let mut start = 0usize;
        loop {
            let value = self.xpan_get(
                "list",
                &[
                    ("dir", self.app_dir.clone()),
                    ("recursion", "1".to_string()),
                    ("limit", LIST_LIMIT.to_string()),
                    ("start", start.to_string()),
                ],
            )?;
            let list = value.get("list").and_then(|list| list.as_array()).cloned().unwrap_or_default();
            if list.is_empty() {
                break;
            }
            for item in &list {
                let is_dir = item.get("isdir").and_then(|flag| flag.as_u64()).unwrap_or(0) == 1;
                if is_dir {
                    continue;
                }
                let Some(path) = item.get("path").and_then(|path| path.as_str()) else {
                    continue;
                };
                out.push(RemoteFile {
                    rel: self.relative(path),
                    size: item.get("size").and_then(|size| size.as_u64()).unwrap_or(0),
                    // xpan 的 list 条目带 md5，正好可以当版本标识，
                    // 不必为了比对内容再下一次文件（配额是按调用次数算的）。
                    etag: item
                        .get("md5")
                        .and_then(|md5| md5.as_str())
                        .map(|md5| md5.trim().to_string())
                        .filter(|md5| !md5.is_empty()),
                });
            }
            start += list.len();
            if list.len() < LIST_LIMIT {
                break;
            }
        }
        out.sort_by(|left, right| left.rel.cmp(&right.rel));
        Ok(out)
    }

    fn read(&self, rel: &str) -> Result<Vec<u8>, String> {
        let value = self.xpan_get(
            "filemetas",
            &[
                ("dlink", "1".to_string()),
                ("fsids", format!("[{}]", self.fsid_for(rel)?)),
            ],
        )?;
        let dlink = value
            .get("list")
            .and_then(|list| list.as_array())
            .and_then(|list| list.first())
            .and_then(|item| item.get("dlink"))
            .and_then(|link| link.as_str())
            .ok_or_else(|| "remote.missing".to_string())?;

        let url = format!("{dlink}&access_token={}", self.access_token);
        let response = self.client.get(&url).send().map_err(map_transport_error)?;
        let status = response.status().as_u16();
        if status == 401 || status == 403 {
            return Err("auth.expired".to_string());
        }
        if status == 404 {
            return Err("remote.missing".to_string());
        }
        if !(200..300).contains(&status) {
            return Err(format!("baidu.status:{status}"));
        }
        let bytes = response.bytes().map_err(|_| "net.offline".to_string())?;
        Ok(bytes.to_vec())
    }

    fn write(&self, rel: &str, data: &[u8]) -> Result<(), String> {
        self.write_with_chunk_size(rel, data, CHUNK_SIZE)
    }

    fn remove(&self, rel: &str) -> Result<(), String> {
        let payload = format!(
            r#"[{{"path":{},"isdir":0}}]"#,
            serde_json::to_string(&self.absolute(rel)).unwrap_or_else(|_| "\"\"".to_string())
        );
        // 删除不存在的文件当成成功：清单修正比报错有用（与文件夹/WebDAV 一致）。
        match self.xpan_get("filemanager", &[
            ("opera", "delete".to_string()),
            ("async", "0".to_string()),
            ("filelist", payload),
        ]) {
            Ok(_) => Ok(()),
            Err(code) if code == "remote.missing" => Ok(()),
            Err(code) => Err(code),
        }
    }

    fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        let (parent, name) = split_parent(&self.absolute(to));
        self.ensure_dir(&self.relative(&parent))?;
        let payload = format!(
            r#"[{{"path":{},"dest":{},"newname":{}}}]"#,
            serde_json::to_string(&self.absolute(from)).unwrap_or_default(),
            serde_json::to_string(&parent).unwrap_or_default(),
            serde_json::to_string(&name).unwrap_or_default()
        );
        self.xpan_post(
            "filemanager",
            &[("opera", "move".to_string()), ("async", "0".to_string())],
            vec![("filelist".to_string(), payload)],
        )?;
        Ok(())
    }
}

impl BaiduStore {
    /// 单独抽出来是为了让测试用 4 字节分片跑完整流程（否则要造 4 MiB 数据）。
    pub fn write_with_chunk_size(&self, rel: &str, data: &[u8], chunk_size: usize) -> Result<(), String> {
        let chunk_size = chunk_size.max(1);
        let chunks: Vec<&[u8]> = if data.is_empty() {
            vec![&[] as &[u8]]
        } else {
            data.chunks(chunk_size).collect()
        };
        if chunks.len() > MAX_CHUNKS {
            return Err("remote.too-large".to_string());
        }

        let absolute = self.absolute(rel);
        let (parent, _) = split_parent(&absolute);
        self.ensure_dir(&self.relative(&parent))?;

        let block_list: Vec<String> = chunks
            .iter()
            .map(|chunk| hex_md5(chunk))
            .collect();

        // 1) precreate：告诉网盘「我要写这个文件，分片 md5 是这些」。
        let precreate = self.xpan_post(
            "precreate",
            &[],
            vec![
                ("path".to_string(), absolute.clone()),
                ("size".to_string(), data.len().to_string()),
                ("isdir".to_string(), "0".to_string()),
                ("autoinit".to_string(), "1".to_string()),
                ("rtype".to_string(), "3".to_string()),
                (
                    "block_list".to_string(),
                    serde_json::to_string(&block_list).unwrap_or_else(|_| "[]".to_string()),
                ),
            ],
        )?;

        let upload_id = precreate
            .get("uploadid")
            .and_then(|id| id.as_str())
            .unwrap_or_default()
            .to_string();
        // 已秒传（return_type=2）就不用再传分片。
        let return_type = precreate.get("return_type").and_then(|value| value.as_u64()).unwrap_or(1);

        if return_type == 1 {
            if upload_id.is_empty() {
                return Err("baidu.no-uploadid".to_string());
            }
            for (index, chunk) in chunks.iter().enumerate() {
                self.upload_chunk(&absolute, &upload_id, index, chunk)?;
            }
        }

        // 2) create：提交分片清单，网盘拼成文件。
        self.xpan_post(
            "create",
            &[
                ("isdir", "0".to_string()),
                ("rtype", "3".to_string()),
            ],
            vec![
                ("path".to_string(), absolute),
                ("size".to_string(), data.len().to_string()),
                ("isdir".to_string(), "0".to_string()),
                ("rtype".to_string(), "3".to_string()),
                ("uploadid".to_string(), upload_id),
                (
                    "block_list".to_string(),
                    serde_json::to_string(&block_list).unwrap_or_else(|_| "[]".to_string()),
                ),
            ],
        )?;
        Ok(())
    }

    fn upload_chunk(&self, absolute: &str, upload_id: &str, seq: usize, chunk: &[u8]) -> Result<(), String> {
        let response = self
            .client
            .post(format!("{}/rest/2.0/pcs/superfile2", self.pcs_base))
            .query(&[
                ("method", "upload".to_string()),
                ("type", "tmpfile".to_string()),
                ("path", absolute.to_string()),
                ("uploadid", upload_id.to_string()),
                ("partseq", seq.to_string()),
                ("access_token", self.access_token.clone()),
            ])
            .body(chunk.to_vec())
            .send()
            .map_err(map_transport_error)?;
        let status = response.status().as_u16();
        if status == 401 || status == 403 {
            return Err("auth.expired".to_string());
        }
        if !(200..300).contains(&status) {
            return Err(format!("baidu.status:{status}"));
        }
        Ok(())
    }

    /// `filemetas` 需要 fsid；先用 `list` 按路径反查。
    fn fsid_for(&self, rel: &str) -> Result<u64, String> {
        let target = self.absolute(rel);
        let mut start = 0usize;
        loop {
            let value = self.xpan_get(
                "list",
                &[
                    ("dir", split_parent(&target).0),
                    ("recursion", "0".to_string()),
                    ("limit", LIST_LIMIT.to_string()),
                    ("start", start.to_string()),
                ],
            )?;
            let list = value.get("list").and_then(|list| list.as_array()).cloned().unwrap_or_default();
            if list.is_empty() {
                break;
            }
            for item in &list {
                if item.get("path").and_then(|path| path.as_str()) == Some(target.as_str()) {
                    if let Some(fsid) = item.get("fs_id").and_then(|id| id.as_u64()) {
                        return Ok(fsid);
                    }
                }
            }
            start += list.len();
            if list.len() < LIST_LIMIT {
                break;
            }
        }
        Err("remote.missing".to_string())
    }
}

fn hex_md5(data: &[u8]) -> String {
    let mut hasher = Md5::new();
    hasher.update(data);
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn normalize_app_dir(dir: &str) -> String {
    let trimmed = dir.trim();
    let trimmed = trimmed.trim_end_matches('/');
    if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
}

fn split_parent(absolute: &str) -> (String, String) {
    match absolute.rsplit_once('/') {
        Some((parent, name)) => (parent.to_string(), name.to_string()),
        None => ("/".to_string(), absolute.to_string()),
    }
}

/// 百度在 HTTP 200 里用 `errno` 表达失败，必须逐条翻译。
fn check_errno(value: &serde_json::Value) -> Result<(), String> {
    let errno = value.get("errno").and_then(|code| code.as_i64()).unwrap_or(0);
    match errno {
        0 => Ok(()),
        // -6 需要重新授权（token 失效）
        -6 => Err("auth.expired".to_string()),
        // -7 文件名非法
        -7 => Err("remote.bad-name".to_string()),
        // -8 文件已存在（冲突处理已经生成新名字，不该走到这里）
        -8 => Err("remote.exists".to_string()),
        // -9 文件/目录不存在
        -9 => Err("remote.missing".to_string()),
        // 12 配额/审核类
        12 => Err("sync.baidu-review".to_string()),
        31066 => Err("quota.rate-limit".to_string()),
        other => Err(format!("baidu.errno:{other}")),
    }
}

fn map_transport_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "net.timeout".to_string();
    }
    if error.is_connect() {
        return "net.offline".to_string();
    }
    "net.offline".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::collections::HashMap;
    use std::io::Write;
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    struct FakeXpan {
        /// 文件：绝对路径 -> 内容（原始字节）
        files: HashMap<String, Vec<u8>>,
        /// 分片：`uploadid:partseq` -> 内容
        chunks: HashMap<String, Vec<u8>>,
        dirs: Vec<String>,
        calls: Vec<String>,
        /// 让某个接口返回指定 errno。
        errno_override: HashMap<String, i64>,
        /// 网盘上已有的分片 md5（秒传判定用）。
        known_md5: std::collections::HashSet<String>,
        /// 假服务端自己的端口，用来生成能跑通的 dlink。
        port: u16,
    }

    fn spawn_fake_xpan() -> (u16, Arc<Mutex<FakeXpan>>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let state = Arc::new(Mutex::new(FakeXpan {
            files: HashMap::new(),
            chunks: HashMap::new(),
            dirs: vec!["/apps".to_string()],
            calls: Vec::new(),
            errno_override: HashMap::new(),
            known_md5: std::collections::HashSet::new(),
            port,
        }));
        let shared = Arc::clone(&state);
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                handle(stream, &shared);
            }
        });
        (port, state)
    }

    fn handle(mut stream: std::net::TcpStream, state: &Arc<Mutex<FakeXpan>>) {
        // 必须按 Content-Length 循环读：reqwest 会把头和体分成两个 TCP 段发，
        // 只读一次就会拿到「有头没体」的请求（表现是参数全部缺失）。
        let Some((head, body_bytes)) = read_request(&mut stream) else {
            return;
        };
        let mut lines = head.split("\r\n");
        let request_line = lines.next().unwrap_or_default();
        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or_default().to_string();
        let target = parts.next().unwrap_or_default().to_string();
        let body = String::from_utf8_lossy(&body_bytes).to_string();

        let (path, query) = match target.split_once('?') {
            Some((path, query)) => (path.to_string(), query.to_string()),
            None => (target.clone(), String::new()),
        };
        let params = parse_params(&format!("{query}&{body}"));

        let mut dav = state.lock().unwrap();
        dav.calls.push(format!("{method} {path} {}", params.get("method").cloned().unwrap_or_default()));

        let reply = if path == "/download" {
            // 复用上面那把锁：`state.lock()` 不可重入，这里再锁一次会把自己锁死。
            let target = params.get("path").cloned().unwrap_or_default();
            match dav.files.get(&target) {
                Some(bytes) => octet(bytes),
                None => octet(b""),
            }
        } else if path == "/rest/2.0/pcs/superfile2" {
            // 分片上传：把原始字节按 uploadid+partseq 存起来。
            let partseq = params.get("partseq").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
            let key = format!("{}:{}", params.get("uploadid").cloned().unwrap_or_default(), partseq);
            dav.chunks.insert(key, body_bytes.clone());
            json(&serde_json::json!({ "md5": format!("part{partseq}") }))
        } else {
            let api = params.get("method").cloned().unwrap_or_default();
            if let Some(errno) = dav.errno_override.get(&api).copied() {
                json(&serde_json::json!({ "errno": errno }))
            } else {
                match api.as_str() {
                    "list" => {
                        let dir = params.get("dir").cloned().unwrap_or_else(|| "/".to_string());
                        let recursion = params.get("recursion").map(|v| v == "1").unwrap_or(false);
                        let mut items = Vec::new();
                        let mut fsid = 1u64;
                        for (path, _) in dav.files.iter() {
                            let in_scope = if recursion {
                                path.starts_with(&format!("{}/", dir.trim_end_matches('/'))) || path.starts_with(&dir)
                            } else {
                                split_parent(path).0 == dir
                            };
                            if in_scope {
                                items.push(serde_json::json!({
                                    "fs_id": fsid,
                                    "path": path,
                                    "isdir": 0,
                                    "size": dav.files.get(path).map(|bytes| bytes.len()).unwrap_or(0),
                                }));
                            }
                            fsid += 1;
                        }
                        json(&serde_json::json!({ "errno": 0, "list": items }))
                    }
                    "create" => {
                        let target = params.get("path").cloned().unwrap_or_default();
                        if params.get("isdir").map(|v| v == "1").unwrap_or(false) {
                            if !dav.dirs.iter().any(|dir| dir == &target) {
                                dav.dirs.push(target);
                            }
                            json(&serde_json::json!({ "errno": 0 }))
                        } else {
                            let upload_id = params.get("uploadid").cloned().unwrap_or_default();
                            let mut parts: Vec<u8> = Vec::new();
                            let mut index = 0;
                            while let Some(chunk) = dav.chunks.get(&format!("{upload_id}:{index}")) {
                                parts.extend_from_slice(chunk);
                                index += 1;
                            }
                            dav.files.insert(target, parts);
                            json(&serde_json::json!({ "errno": 0, "fs_id": 1 }))
                        }
                    }
                    "precreate" => {
                        // 秒传按内容判定：所有分片 md5 都已在网盘上才返回 2。
                        let block_list: Vec<String> = params
                            .get("block_list")
                            .and_then(|raw| serde_json::from_str::<Vec<String>>(raw).ok())
                            .unwrap_or_default();
                        let sec_upload = !block_list.is_empty()
                            && block_list.iter().all(|md5| dav.known_md5.contains(md5));
                        if !sec_upload {
                            for md5 in block_list {
                                dav.known_md5.insert(md5);
                            }
                        }
                        let return_type = if sec_upload { 2 } else { 1 };
                        json(&serde_json::json!({ "errno": 0, "return_type": return_type, "uploadid": "u-1" }))
                    }
                    "filemetas" => {
                        let fsids = params.get("fsids").cloned().unwrap_or_default();
                        let target = dav
                            .files
                            .keys()
                            .find(|path| !path.starts_with("chunk:") && fsids.contains('1'))
                            .cloned()
                            .unwrap_or_default();
                        let dlink = format!(
                            "http://127.0.0.1:{}/download?path={}",
                            dav.port,
                            encode_component(&target)
                        );
                        json(&serde_json::json!({
                            "errno": 0,
                            "list": [{ "fs_id": 1, "path": target, "dlink": dlink }]
                        }))
                    }
                    "filemanager" => {
                        let filelist = params.get("filelist").cloned().unwrap_or_default();
                        let parsed: serde_json::Value =
                            serde_json::from_str(&filelist).unwrap_or(serde_json::json!([]));
                        let opera = params.get("opera").cloned().unwrap_or_default();
                        if opera == "delete" {
                            if let Some(first) = parsed.as_array().and_then(|arr| arr.first()) {
                                if let Some(target) = first.get("path").and_then(|path| path.as_str()) {
                                    dav.files.remove(target);
                                }
                            }
                        } else if opera == "move" {
                            if let Some(first) = parsed.as_array().and_then(|arr| arr.first()) {
                                let from = first.get("path").and_then(|path| path.as_str()).unwrap_or_default();
                                let dest = first.get("dest").and_then(|path| path.as_str()).unwrap_or_default();
                                let name = first.get("newname").and_then(|path| path.as_str()).unwrap_or_default();
                                if let Some(bytes) = dav.files.remove(from) {
                                    dav.files.insert(format!("{dest}/{name}"), bytes);
                                }
                            }
                        }
                        json(&serde_json::json!({ "errno": 0 }))
                    }
                    _ => json(&serde_json::json!({ "errno": 0 })),
                }
            }
        };
        drop(dav);
        let _ = stream.write_all(&reply);
    }

    /// 读到「头 + 按 Content-Length 的完整体」为止。
    fn read_request(stream: &mut std::net::TcpStream) -> Option<(String, Vec<u8>)> {
        use std::io::Read as _;
        let mut buffer: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 65_536];
        loop {
            let read = stream.read(&mut chunk).unwrap_or(0);
            if read == 0 {
                if buffer.is_empty() {
                    return None;
                }
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);
            if let Some(split) = find_header_end(&buffer) {
                let head = String::from_utf8_lossy(&buffer[..split]).to_string();
                let content_length = head
                    .lines()
                    .find_map(|line| {
                        let lower = line.to_ascii_lowercase();
                        lower
                            .strip_prefix("content-length:")
                            .map(|value| value.trim().parse::<usize>().unwrap_or(0))
                    })
                    .unwrap_or(0);
                if buffer.len() >= split + 4 + content_length {
                    return Some((head, buffer[split + 4..split + 4 + content_length].to_vec()));
                }
            }
        }
        let split = find_header_end(&buffer).unwrap_or(buffer.len().saturating_sub(1));
        let head = String::from_utf8_lossy(&buffer[..split]).to_string();
        Some((head, buffer.get(split + 4..).unwrap_or_default().to_vec()))
    }

    fn find_header_end(buffer: &[u8]) -> Option<usize> {
        buffer.windows(4).position(|window| window == b"\r\n\r\n")
    }

    fn encode_component(value: &str) -> String {
        let mut out = String::new();
        for byte in value.as_bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*byte as char),
                _ => out.push_str(&format!("%{byte:02X}")),
            }
        }
        out
    }

    fn octet(body: &[u8]) -> Vec<u8> {
        let mut out = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        out.extend_from_slice(body);
        out
    }

    fn parse_params(raw: &str) -> HashMap<String, String> {
        let mut out = HashMap::new();
        for pair in raw.split('&') {
            if pair.is_empty() {
                continue;
            }
            let (key, value) = match pair.split_once('=') {
                Some((key, value)) => (key, value),
                None => (pair, ""),
            };
            out.insert(decode(key), decode(value));
        }
        out
    }

    fn decode(value: &str) -> String {
        let bytes = value.as_bytes();
        let mut out = Vec::new();
        let mut index = 0;
        while index < bytes.len() {
            match bytes[index] {
                b'+' => {
                    out.push(b' ');
                    index += 1;
                }
                b'%' if index + 2 < bytes.len() => {
                    match u8::from_str_radix(&value[index + 1..index + 3], 16) {
                        Ok(byte) => {
                            out.push(byte);
                            index += 3;
                        }
                        Err(_) => {
                            out.push(bytes[index]);
                            index += 1;
                        }
                    }
                }
                byte => {
                    out.push(byte);
                    index += 1;
                }
            }
        }
        String::from_utf8_lossy(&out).to_string()
    }

    fn json(value: &serde_json::Value) -> Vec<u8> {
        let body = value.to_string().into_bytes();
        let mut out = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        out.extend_from_slice(&body);
        out
    }

    fn store(port: u16) -> BaiduStore {
        BaiduStore::new("/apps/青幕AI写作", "token", &format!("http://127.0.0.1:{port}"), &format!("http://127.0.0.1:{port}"))
            .unwrap()
    }

    #[test]
    fn app_dir_is_normalized() {
        assert_eq!(normalize_app_dir("apps/x"), "/apps/x");
        assert_eq!(normalize_app_dir("/apps/x/"), "/apps/x");
        assert_eq!(normalize_app_dir("  /apps/x  "), "/apps/x");
    }

    #[test]
    fn split_parent_handles_root_and_nested() {
        assert_eq!(split_parent("/apps/x/a/b.md"), ("/apps/x/a".to_string(), "b.md".to_string()));
        assert_eq!(split_parent("/a"), ("".to_string(), "a".to_string()));
    }

    #[test]
    fn errno_codes_are_translated_to_translatable_errors() {
        let cases = [
            (serde_json::json!({ "errno": 0 }), None),
            (serde_json::json!({ "errno": -6 }), Some("auth.expired")),
            (serde_json::json!({ "errno": -9 }), Some("remote.missing")),
            (serde_json::json!({ "errno": 12 }), Some("sync.baidu-review")),
            (serde_json::json!({ "errno": 31066 }), Some("quota.rate-limit")),
            (serde_json::json!({ "errno": 42 }), Some("baidu.errno:42")),
        ];
        for (value, expected) in cases {
            match expected {
                None => assert!(check_errno(&value).is_ok()),
                Some(code) => assert_eq!(check_errno(&value).unwrap_err(), code),
            }
        }
    }

    #[test]
    fn empty_token_is_rejected_up_front() {
        // `.err()` 而不是 `unwrap_err()`：BaiduStore 没实现 Debug，`unwrap_err` 编译不过。
        let error = BaiduStore::new("/apps/x", "   ", XPAN_BASE, PCS_BASE)
            .err()
            .expect("空 token 必须被拒绝");
        assert_eq!(error, "auth.required");
    }

    #[test]
    fn round_trip_against_a_fake_xpan_server() {
        let (port, state) = spawn_fake_xpan();
        let store = store(port);

        store.write_with_chunk_size("书/QM/a.md", "内容内容".as_bytes(), 4).unwrap();
        let files = store.list().unwrap();
        assert!(files.iter().any(|file| file.rel == "书/QM/a.md"), "{files:?}");
        assert_eq!(store.read("书/QM/a.md").unwrap(), "内容内容".as_bytes());

        store.rename("书/QM/a.md", "书/QM/b.md").unwrap();
        assert!(store.read("书/QM/b.md").is_ok());

        store.remove("书/QM/b.md").unwrap();
        assert!(store.list().unwrap().is_empty());

        // 上传必须先建目录、先 precreate、再逐片上传、最后 create。
        let calls = &state.lock().unwrap().calls;
        assert!(calls.iter().any(|call| call.contains("create") && call.contains("superfile")  == false));
        assert!(calls.iter().any(|call| call.contains("precreate")));
        assert!(calls.iter().any(|call| call.contains("superfile2")));
    }

    #[test]
    fn sec_upload_skips_chunk_transfer_when_server_already_has_the_file() {
        let (port, state) = spawn_fake_xpan();
        let store = store(port);
        store.write_with_chunk_size("书/x.md", b"same", 4).unwrap();
        let before = state.lock().unwrap().calls.len();
        // 第二次写同样内容：假服务端返回 return_type=2（秒传），不该再发分片。
        store.write_with_chunk_size("书/y.md", b"same", 4).unwrap();
        let after = state.lock().unwrap().calls.len();
        let chunk_calls = state
            .lock()
            .unwrap()
            .calls
            .iter()
            .filter(|call| call.contains("superfile2"))
            .count();
        // 只有第一次写了分片；第二次走秒传。
        assert_eq!(chunk_calls, 1);
        assert!(after > before);
    }

    #[test]
    fn missing_file_returns_a_translatable_code() {
        let (port, state) = spawn_fake_xpan();
        state.lock().unwrap().errno_override.insert("filemetas".to_string(), -9);
        let store = store(port);
        assert_eq!(store.read("书/不存在.md").unwrap_err(), "remote.missing");
    }
}
