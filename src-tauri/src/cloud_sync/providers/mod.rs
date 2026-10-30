//! 远端适配器接口。
//!
//! P1 只有「本地文件夹」（把网盘的同步目录当作远端）。P3 会加 WebDAV，
//! P2 的百度网盘也实现同一个 trait，引擎因此不需要知道远端到底是哪种存储。
//!
//! 所有 `rel` 都是**远端根内的相对路径**，用 `/` 分隔；实现方必须拒绝
//! 任何试图跳出根目录的路径（`..`、绝对路径、Windows 盘符）。

pub mod baidu_netdisk;
pub mod folder;
pub mod github;
pub mod webdav;

pub use baidu_netdisk::BaiduStore;
pub use folder::FolderStore;
pub use github::GithubStore;
pub use webdav::WebdavStore;

use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFile {
    pub rel: String,
    pub size: u64,
    /// 远端版本标识：WebDAV 的 ETag、百度网盘的 md5、本地文件夹的「大小+修改时间」。
    ///
    /// 有了它就不用为了算哈希把每个远端文件都下载一遍 —— 一个五百篇的工程，
    /// 每轮同步要读 500 次全文，坚果云会直接按限流把人挡在门外。
    /// 拿不到时保持 `None`（例如服务端不返回 ETag），引擎退化成「读全文算哈希」。
    pub etag: Option<String>,
}

/// `Send`：引擎跑在阻塞线程池里，远端适配器要能跨线程搬过去。
pub trait RemoteStore: Send {
    /// 递归列出所有文件。只列文件，不列目录。
    fn list(&self) -> Result<Vec<RemoteFile>, String>;

    fn read(&self, rel: &str) -> Result<Vec<u8>, String>;

    fn write(&self, rel: &str, data: &[u8]) -> Result<(), String>;

    fn remove(&self, rel: &str) -> Result<(), String>;

    fn rename(&self, from: &str, to: &str) -> Result<(), String>;

    /// 一轮同步开始。远端如果是「攒批提交」型（GitHub），这里清掉上一轮残留。
    ///
    /// 默认空实现：像本地文件夹、WebDAV 这种写完就落盘的远端不需要它。
    fn begin(&self) -> Result<(), String> {
        Ok(())
    }

    /// 一轮同步结束：把攒下的变更真正落盘。
    ///
    /// GitHub 用它把几十上百个文件合成**一个 commit**；其它远端是空操作，
    /// 所以引擎可以无条件调用，不用按 provider 分支。
    fn commit(&self, _message: &str) -> Result<(), String> {
        Ok(())
    }
}

/// 把相对路径解析成根目录下的真实路径，并确保没有越界。
///
/// 这是所有远端实现的**安全前置**：远端路径来自同步清单（可能被手工改坏）
/// 或冲突改名逻辑，一旦允许 `..` 就会写到用户选定的目录之外。
pub fn resolve_within_root(root: &Path, rel: &str) -> Result<std::path::PathBuf, String> {
    if rel.is_empty() {
        return Err("远端路径为空".to_string());
    }
    if rel.starts_with('/') || rel.starts_with('\\') {
        return Err(format!("远端路径不能是绝对路径：{rel}"));
    }
    if rel.contains(':') {
        return Err(format!("远端路径不能包含盘符：{rel}"));
    }
    let mut out = root.to_path_buf();
    for part in rel.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err(format!("远端路径不能跳出根目录：{rel}"));
        }
        out.push(part);
    }
    if !out.starts_with(root) {
        return Err(format!("远端路径越界：{rel}"));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn root() -> PathBuf {
        PathBuf::from("D:/sync-root")
    }

    #[test]
    fn joins_plain_relative_paths() {
        let resolved = resolve_within_root(&root(), "长夜/QM/entities/林照.md").unwrap();
        assert!(resolved.ends_with("长夜/QM/entities/林照.md") || resolved.ends_with("长夜\\QM\\entities\\林照.md"));
    }

    #[test]
    fn rejects_traversal_absolute_and_drive_letters() {
        assert!(resolve_within_root(&root(), "../escape.md").is_err());
        assert!(resolve_within_root(&root(), "长夜/../../escape.md").is_err());
        assert!(resolve_within_root(&root(), "/etc/passwd").is_err());
        assert!(resolve_within_root(&root(), "C:/Windows/win.ini").is_err());
        assert!(resolve_within_root(&root(), "").is_err());
    }
}
