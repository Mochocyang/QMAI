//! GitHub 私有仓库作为远端。
//!
//! 与 WebDAV / 本地文件夹最大的不同：Git 是**整树提交 + 分支指针**，没有
//! "单文件上传"这种操作。如果每个文件都提交一次，一次同步会产生上百个 commit
//! （历史脏、API 配额也吃不住）。所以这里把写入攒成一批，在一轮结束时用
//! Git Data API 一次性提交：**一轮同步 = 一个 commit**。
//!
//! 这也顺带白送一个好处：用户可以在 GitHub 网页上看到"这次改了哪几章"。

use std::collections::BTreeMap;
use std::sync::Mutex;

use base64::Engine;
use serde_json::{json, Value};

use super::{RemoteFile, RemoteStore};
use crate::cloud_sync::github::{self, API_BASE, REQUEST_TIMEOUT, USER_AGENT};

/// 单个 commit 最多带多少文件变更：超大的首轮同步（几千个快照文件）
/// 拆成多个 commit，避免单个 tree 请求过大。
const MAX_CHANGES_PER_COMMIT: usize = 200;
/// 分支指针被别人抢先更新时的重试次数。
const REF_RETRY: usize = 2;

/// 仓库里不属于书稿、绝对不该同步到本地的东西。
///
/// 只看**仓库根级**：我们的书都放在 `<书名>/` 下，所以根级的 README/LICENSE
/// 一定是用户自己放的（新建仓库时 GitHub 会塞一个 README），同步进书目录是灾难。
pub fn should_ignore(path: &str) -> bool {
    let Some(first) = path.split('/').next() else {
        return false;
    };
    if first != path {
        // 有目录前缀：只看它是不是 `.github/`（工作流/模板，不属于稿件）。
        return first.eq_ignore_ascii_case(".github");
    }
    let lower = first.to_ascii_lowercase();
    lower == "readme.md"
        || lower.starts_with("readme.")
        || lower == "license"
        || lower == "license.md"
        || lower == "license.txt"
        || lower == ".gitignore"
        || lower == ".gitattributes"
        || lower == ".gitmodules"
        || lower == "contributing.md"
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Head {
    commit: String,
    tree: String,
}

#[derive(Debug)]
struct Pending {
    /// `None` 表示删除。
    changes: BTreeMap<String, Option<Vec<u8>>>,
}

#[derive(Debug)]
pub struct GithubStore {
    owner: String,
    repo: String,
    branch: String,
    token: String,
    client: reqwest::blocking::Client,
    pending: Mutex<Pending>,
    /// 缓存当前分支头，commit 成功后更新，省掉一轮同步里重复的 GET。
    head: Mutex<Option<Head>>,
}

impl GithubStore {
    pub fn new(owner: &str, repo: &str, branch: &str, token: &str) -> Result<Self, String> {
        if owner.trim().is_empty() || repo.trim().is_empty() {
            return Err("github.no-repo".to_string());
        }
        let client = reqwest::blocking::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            // 跟随应用配置的系统代理（不是 no_proxy）。
            .build()
            .map_err(|error| format!("github.client:{error}"))?;
        Ok(Self {
            owner: owner.trim().to_string(),
            repo: repo.trim().to_string(),
            branch: if branch.trim().is_empty() {
                "main".to_string()
            } else {
                branch.trim().to_string()
            },
            token: token.trim().to_string(),
            client,
            pending: Mutex::new(Pending {
                changes: BTreeMap::new(),
            }),
            head: Mutex::new(None),
        })
    }

    #[allow(dead_code)]
    pub fn full_name(&self) -> String {
        format!("{}/{}", self.owner, self.repo)
    }

    fn url(&self, path: &str) -> String {
        format!("{API_BASE}/repos/{}/{}{path}", self.owner, self.repo)
    }

    fn request(&self, builder: reqwest::blocking::RequestBuilder) -> Result<reqwest::blocking::Response, String> {
        let response = builder
            .header(reqwest::header::USER_AGENT, USER_AGENT)
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .header("x-github-api-version", "2022-11-28")
            .bearer_auth(&self.token)
            .send()
            .map_err(|error| {
                if error.is_timeout() || error.is_connect() {
                    "github.network".to_string()
                } else {
                    format!("github.network:{error}")
                }
            })?;

        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            let rate_limited = response
                .headers()
                .get("x-ratelimit-remaining")
                .and_then(|value| value.to_str().ok())
                .map(|value| value.trim() == "0")
                .unwrap_or(false);
            let body = response.text().unwrap_or_default();
            let mut code = github::map_status(status, rate_limited);
            if let Some(message) = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|value| value.get("message").and_then(|m| m.as_str()).map(|m| m.to_string()))
            {
                code = format!("{code}:{message}");
            }
            return Err(code);
        }
        Ok(response)
    }

    fn json(&self, builder: reqwest::blocking::RequestBuilder) -> Result<Value, String> {
        let response = self.request(builder)?;
        let body = response.text().unwrap_or_default();
        if body.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&body).map_err(|error| format!("github.parse:{error}"))
    }

    /// 当前分支头；空仓库返回 `None`。
    fn current_head(&self) -> Result<Option<Head>, String> {
        if let Some(head) = self.head.lock().unwrap().clone() {
            return Ok(Some(head));
        }
        let value = match self.json(self.client.get(self.url(&format!(
            "/git/ref/heads/{}",
            self.branch
        )))) {
            Ok(value) => value,
            // 空仓库：GitHub 对不存在的 ref 返回 404（有时候是 409）。
            Err(code) if code.starts_with("github.repo-missing") => return Ok(None),
            Err(code) if code.starts_with("github.conflict") => return Ok(None),
            Err(code) => return Err(code),
        };
        let commit = value
            .get("object")
            .and_then(|object| object.get("sha"))
            .and_then(|sha| sha.as_str())
            .ok_or_else(|| "github.parse:missing ref sha".to_string())?
            .to_string();
        let tree = self
            .json(self.client.get(self.url(&format!("/git/commits/{commit}"))))?
            .get("tree")
            .and_then(|tree| tree.get("sha"))
            .and_then(|sha| sha.as_str())
            .ok_or_else(|| "github.parse:missing tree sha".to_string())?
            .to_string();
        let head = Head { commit, tree };
        *self.head.lock().unwrap() = Some(head.clone());
        Ok(Some(head))
    }

    /// 列出整棵树（一次请求，递归）。空仓库返回空列表。
    pub fn list_tree(&self) -> Result<Vec<RemoteFile>, String> {
        let Some(head) = self.current_head()? else {
            return Ok(Vec::new());
        };
        let value = self.json(self.client.get(format!(
            "{}{}?recursive=1",
            self.url("/git/trees/"),
            head.tree
        )))?;
        let mut out = Vec::new();
        for entry in value
            .get("tree")
            .and_then(|tree| tree.as_array())
            .map(|items| items.as_slice())
            .unwrap_or(&[])
        {
            if entry.get("type").and_then(|kind| kind.as_str()) != Some("blob") {
                continue;
            }
            let Some(rel) = entry.get("path").and_then(|path| path.as_str()) else {
                continue;
            };
            if should_ignore(rel) {
                continue;
            }
            let sha = entry
                .get("sha")
                .and_then(|sha| sha.as_str())
                .map(|sha| sha.to_string());
            out.push(RemoteFile {
                rel: rel.to_string(),
                size: entry
                    .get("size")
                    .and_then(|size| size.as_u64())
                    .unwrap_or(0),
                // blob sha 就是最强的版本标识：内容一样 sha 一定一样，
                // 引擎看到 sha 没变就不会去下载全文。
                etag: sha,
            });
        }
        out.sort_by(|left, right| left.rel.cmp(&right.rel));
        Ok(out)
    }

    /// 连接探针：能列树、能读、能提交、能删。
    ///
    /// 只做 `GET` 不够 —— 只读 token、仓库被保护、分支保护规则都能列却不能写，
    /// 用户会在第一次真正同步时才发现，那时候更难解释。
    pub fn validate(owner: &str, repo: &str, branch: &str, token: &str) -> Result<(), String> {
        let store = Self::new(owner, repo, branch, token)?;
        store.list_tree()?;
        let probe = ".qmai-cloud/ping".to_string();
        let payload = format!("qmai-write probe {}", crate::cloud_sync::baidu::now_ms());
        store.write(&probe, payload.as_bytes())?;
        store.commit("QMaiWrite：连接校验")?;
        let read_back = store.read(&probe)?;
        if read_back != payload.as_bytes() {
            return Err("github.probe-mismatch".to_string());
        }
        store.remove(&probe)?;
        store.commit("QMaiWrite：连接校验（清理）")?;
        Ok(())
    }
}

impl RemoteStore for GithubStore {
    fn list(&self) -> Result<Vec<RemoteFile>, String> {
        let mut files = self.list_tree()?;
        // 同一轮里刚写、还没提交的文件也要出现在列表里（引擎会用它做二次判断）。
        let pending = self.pending.lock().unwrap();
        for (rel, change) in pending.changes.iter() {
            match change {
                Some(bytes) => {
                    if let Some(existing) = files.iter_mut().find(|file| &file.rel == rel) {
                        existing.size = bytes.len() as u64;
                        // 内容变了，etag 必须失效，否则引擎会以为没改。
                        existing.etag = None;
                    } else if !should_ignore(rel) {
                        files.push(RemoteFile {
                            rel: rel.clone(),
                            size: bytes.len() as u64,
                            etag: None,
                        });
                    }
                }
                None => files.retain(|file| &file.rel != rel),
            }
        }
        Ok(files)
    }

    fn read(&self, rel: &str) -> Result<Vec<u8>, String> {
        {
            let pending = self.pending.lock().unwrap();
            if let Some(change) = pending.changes.get(rel) {
                return match change {
                    Some(bytes) => Ok(bytes.clone()),
                    None => Err("remote.missing".to_string()),
                };
            }
        }
        let response = self.request(
            self.client
                .get(self.url(&format!("/contents/{rel}")))
                .query(&[("ref", self.branch.as_str())])
                .header(reqwest::header::ACCEPT, "application/vnd.github.raw"),
        )?;
        response.bytes().map(|bytes| bytes.to_vec()).map_err(|error| {
            format!("github.network:{error}")
        })
    }

    fn write(&self, rel: &str, data: &[u8]) -> Result<(), String> {
        if rel.trim().is_empty() {
            return Err("远端路径为空".to_string());
        }
        self.pending
            .lock()
            .unwrap()
            .changes
            .insert(rel.to_string(), Some(data.to_vec()));
        Ok(())
    }

    fn remove(&self, rel: &str) -> Result<(), String> {
        self.pending
            .lock()
            .unwrap()
            .changes
            .insert(rel.to_string(), None);
        Ok(())
    }

    fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        let bytes = self.read(from)?;
        {
            let mut pending = self.pending.lock().unwrap();
            pending.changes.insert(to.to_string(), Some(bytes));
            pending.changes.insert(from.to_string(), None);
        }
        Ok(())
    }

    /// 一轮同步开始：清空上一轮没提交成功的残留。
    fn begin(&self) -> Result<(), String> {
        self.pending.lock().unwrap().changes.clear();
        Ok(())
    }

    /// 一轮同步结束：把攒下的变更一次提交。
    fn commit(&self, message: &str) -> Result<(), String> {
        loop {
            let changes: BTreeMap<String, Option<Vec<u8>>> = {
                let mut pending = self.pending.lock().unwrap();
                if pending.changes.is_empty() {
                    return Ok(());
                }
                std::mem::take(&mut pending.changes)
            };
            let total = changes.len();
            let mut remaining = changes;
            while !remaining.is_empty() {
                let take = remaining.len().min(MAX_CHANGES_PER_COMMIT);
                let batch: BTreeMap<String, Option<Vec<u8>>> = remaining
                    .iter()
                    .take(take)
                    .map(|(path, change)| (path.clone(), change.clone()))
                    .collect();
                for path in batch.keys() {
                    remaining.remove(path);
                }
                let suffix = if total > MAX_CHANGES_PER_COMMIT {
                    format!("（{take}/{total}）")
                } else {
                    String::new()
                };
                match self.commit_batch(&format!("{message}{suffix}"), &batch) {
                    Ok(()) => {}
                    Err(code) if code.starts_with("github.conflict") => {
                        // 分支被别人抢先推了：重读 head 后重放这一批，最多两次。
                        *self.head.lock().unwrap() = None;
                        let mut retried = 0;
                        let mut attempt = self.commit_batch(&format!("{message}{suffix}"), &batch);
                        while matches!(&attempt, Err(code) if code.starts_with("github.conflict"))
                            && retried < REF_RETRY
                        {
                            retried += 1;
                            std::thread::sleep(std::time::Duration::from_millis(300 * retried as u64));
                            *self.head.lock().unwrap() = None;
                            attempt = self.commit_batch(&format!("{message}{suffix}"), &batch);
                        }
                        if let Err(code) = attempt {
                            // 没提交成功的变更放回 pending，下一轮会重来。
                            let mut pending = self.pending.lock().unwrap();
                            for (path, change) in batch.iter() {
                                pending.changes.insert(path.clone(), change.clone());
                            }
                            return Err(code);
                        }
                    }
                    Err(code) => {
                        let mut pending = self.pending.lock().unwrap();
                        for (path, change) in batch.iter() {
                            pending.changes.insert(path.clone(), change.clone());
                        }
                        return Err(code);
                    }
                }
            }
            return Ok(());
        }
    }
}

impl GithubStore {
    fn commit_batch(
        &self,
        message: &str,
        batch: &BTreeMap<String, Option<Vec<u8>>>,
    ) -> Result<(), String> {
        let head = self.current_head()?;

        let mut entries: Vec<Value> = Vec::with_capacity(batch.len());
        for (path, change) in batch {
            match change {
                Some(bytes) => {
                    let sha = self
                        .json(
                            self.client
                                .post(self.url("/git/blobs"))
                                .json(&json!({
                                    "content": base64::engine::general_purpose::STANDARD.encode(bytes),
                                    "encoding": "base64",
                                })),
                        )?
                        .get("sha")
                        .and_then(|sha| sha.as_str())
                        .ok_or_else(|| "github.parse:missing blob sha".to_string())?
                        .to_string();
                    entries.push(json!({
                        "path": path,
                        "mode": "100644",
                        "type": "blob",
                        "sha": sha,
                    }));
                }
                None => entries.push(json!({
                    "path": path,
                    "mode": "100644",
                    "type": "blob",
                    "sha": Value::Null,
                })),
            }
        }

        let mut tree_body = json!({ "tree": entries });
        if let Some(head) = &head {
            tree_body["base_tree"] = json!(head.tree);
        }
        let tree = self
            .json(self.client.post(self.url("/git/trees")).json(&tree_body))?
            .get("sha")
            .and_then(|sha| sha.as_str())
            .ok_or_else(|| "github.parse:missing tree sha".to_string())?
            .to_string();

        let mut commit_body = json!({ "message": message, "tree": tree });
        if let Some(head) = &head {
            commit_body["parents"] = json!([head.commit]);
        }
        let commit = self
            .json(self.client.post(self.url("/git/commits")).json(&commit_body))?
            .get("sha")
            .and_then(|sha| sha.as_str())
            .ok_or_else(|| "github.parse:missing commit sha".to_string())?
            .to_string();

        match &head {
            Some(_) => {
                self.json(
                    self.client
                        .patch(self.url(&format!("/git/refs/heads/{}", self.branch)))
                        .json(&json!({ "sha": commit, "force": false })),
                )?;
            }
            None => {
                self.json(self.client.post(self.url("/git/refs")).json(&json!({
                    "ref": format!("refs/heads/{}", self.branch),
                    "sha": commit,
                })))?;
            }
        }

        *self.head.lock().unwrap() = Some(Head {
            commit,
            tree,
        });
        Ok(())
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_basics_are_never_synced_into_the_book_folder() {
        // 新建仓库时 GitHub 会塞一个 README；它要是被同步进书目录就完蛋了。
        assert!(should_ignore("README.md"));
        assert!(should_ignore("readme.md"));
        assert!(should_ignore("LICENSE"));
        assert!(should_ignore(".gitignore"));
        assert!(should_ignore(".github/workflows/build.yml"));
        // 书稿与我们的元数据都要留着。
        assert!(!should_ignore(".qmai-cloud/manifest.json"));
        assert!(!should_ignore("books.index.json"));
        assert!(!should_ignore("黑雨之下/QM/entities/林照.md"));
        // 书目录里的 README 是稿件的一部分，不能因为名字相同就丢掉。
        assert!(!should_ignore("黑雨之下/README.md"));
    }

    #[test]
    fn empty_repo_is_reported_as_no_remote() {
        let store = GithubStore::new("someone", "empty", "main", "token");
        assert!(store.is_ok());
        // 真正的空仓库判断要走网络，这里只确认缓存初始为空（不发起请求）。
        let store = store.unwrap();
        assert_eq!(store.full_name(), "someone/empty");
        assert!(store.head.lock().unwrap().is_none());
    }

    #[test]
    fn writes_are_buffered_until_commit() {
        let store = GithubStore::new("someone", "repo", "main", "token").unwrap();
        store.write("长夜/QM/entities/林照.md", b"hello").unwrap();
        // 未提交前也算在这个远端的列表里，但 etag 必须失效（内容已变）。
        let pending = store.pending.lock().unwrap();
        assert_eq!(
            pending.changes.get("长夜/QM/entities/林照.md"),
            Some(&Some(b"hello".to_vec()))
        );
        assert!(pending.changes.contains_key("长夜/QM/entities/林照.md"));
        drop(pending);
        // read 命中 pending，不发网络请求。
        assert_eq!(store.read("长夜/QM/entities/林照.md").unwrap(), b"hello");
        store.remove("长夜/QM/entities/林照.md").unwrap();
        assert_eq!(
            store.read("长夜/QM/entities/林照.md").unwrap_err(),
            "remote.missing"
        );
    }

    #[test]
    fn missing_owner_or_repo_is_rejected_up_front() {
        assert_eq!(
            GithubStore::new("", "repo", "main", "token").unwrap_err(),
            "github.no-repo"
        );
        assert_eq!(
            GithubStore::new("owner", "  ", "main", "token").unwrap_err(),
            "github.no-repo"
        );
    }
}
