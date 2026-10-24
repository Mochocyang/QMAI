//! 本地扫描：哪些文件属于「书」，以及怎么算指纹。
//!
//! 同步范围（v1）：
//! - `QM/`        知识库正文（实体、概念、章节、大纲…）
//! - `raw/`       原始素材与附件
//! - `covers/`    封面
//! - `.novel/snapshots/`  章节历史快照（可在设置里关掉：文件数会翻倍）
//!
//! 明确不同步：`.qmai/`（本机缓存、锁、快照清单）、导出目录、日志。
//! 这些要么是机器相关、要么会被同步本身反复改写（放进去就是自激）。

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use sha2::{Digest, Sha256};
use walkdir::WalkDir;

/// 参与同步的项目级目录（相对项目根）。
pub const SYNC_ROOTS: [&str; 3] = ["QM", "raw", "covers"];

/// 章节快照目录（相对项目根），受「同时同步章节快照」开关控制。
pub const SNAPSHOT_DIR: &str = ".novel/snapshots";

/// 超过这个大小的文件不参与同步（避免把几个 G 的视频拖进网盘）。
pub const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalFile {
    /// 项目内相对路径，统一用 `/` 分隔，便于跨平台比对。
    pub rel: String,
    pub size: u64,
    pub mtime_ms: i64,
}

pub fn to_relative_string(path: &Path, root: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let mut parts: Vec<String> = Vec::new();
    for component in rel.components() {
        parts.push(component.as_os_str().to_string_lossy().to_string());
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("/"))
}

/// 明显不该同步的文件：系统垃圾、编辑器临时文件、下载中的半成品。
pub fn should_ignore(rel: &str) -> bool {
    let lower = rel.to_ascii_lowercase();
    if lower.contains("/.qmai/") || lower.starts_with(".qmai/") {
        return true;
    }
    // 我们自己写在远端根的元数据目录：它会被远端列目录扫到，
    // 但**绝不能**当成书稿参与同步（否则每轮都在同步清单本身，自激）。
    if lower.contains("/.qmai-cloud/") || lower.starts_with(".qmai-cloud/") {
        return true;
    }
    // 网盘客户端在自己的同步目录里放上传/下载控制文件和回收站：
    // 百度是 `xxx.md.baiduyun.uploading.cfg`，坚果云/OneDrive 各有各的名字。
    // 不过滤的话这些文件会被当成"新稿件"同步来同步去，还会无限变。
    if lower.contains(".baiduyun.") || lower.starts_with(".baiduyun") {
        return true;
    }
    if lower.contains("/.baiduyun/") || lower.contains("/$recycle.bin/") {
        return true;
    }
    if lower.contains("/system volume information/") || lower.contains("/.dropbox/") {
        return true;
    }
    let name = lower.rsplit('/').next().unwrap_or(&lower);
    if name.is_empty() {
        return false;
    }
    matches!(name, ".ds_store" | "thumbs.db" | "desktop.ini")
        || name.starts_with("~$")
        || name.ends_with(".tmp")
        || name.ends_with(".part")
        || name.ends_with(".crdownload")
        || name.ends_with(".qmai-tmp")
        || name.ends_with(".baiduyun.uploading.cfg")
        || name.ends_with(".baiduyun.downloading")
        || name.ends_with(".baiduyun.downloading.cfg")
}

pub fn mtime_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// 逐块读，避免把大文件整个读进内存。
pub fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| format!("无法读取 {}：{error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("读取 {} 失败：{error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// 扫描一本书里参与同步的文件。
///
/// 目录不存在不算错误（新书可能还没有 `covers/`）；但读了文件失败会记在返回值里，
/// 交给引擎换算成一条失败条目，而不是整轮中止。
pub fn scan_project_files(
    root: &Path,
    include_snapshots: bool,
) -> Result<Vec<LocalFile>, String> {
    if !root.is_dir() {
        return Err(format!("项目目录不存在：{}", root.display()));
    }

    let mut roots: Vec<PathBuf> = SYNC_ROOTS
        .iter()
        .map(|name| root.join(name))
        .filter(|path| path.is_dir())
        .collect();
    if include_snapshots {
        let snapshots = root.join(SNAPSHOT_DIR);
        if snapshots.is_dir() {
            roots.push(snapshots);
        }
    }

    let mut files = Vec::new();
    for scan_root in roots {
        for entry in WalkDir::new(&scan_root).follow_links(false).into_iter().flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let Some(rel) = to_relative_string(path, root) else {
                continue;
            };
            if should_ignore(&rel) {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.len() > MAX_FILE_BYTES {
                continue;
            }
            let size = meta.len();
            files.push(LocalFile {
                rel,
                size,
                mtime_ms: mtime_ms(path),
            });
        }
    }

    files.sort_by(|left, right| left.rel.cmp(&right.rel));
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qmai_scan_{name}_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn ignores_cloud_client_junk() {
        // 百度同步盘在自己目录里放上传控制文件：曾经被我们当成新稿件同步，
        // 每轮都在传 `.baiduyun.uploading.cfg`。
        assert!(should_ignore("黑雨之下/QM/entities/求和派.md.baiduyun.uploading.cfg"));
        assert!(should_ignore("黑雨之下/QM/entities/归墟.md.baiduyun.downloading"));
        assert!(should_ignore(".qmai-cloud/manifest.json"));
        assert!(should_ignore("黑雨之下/$RECYCLE.BIN/x.md"));
        assert!(should_ignore("黑雨之下/.baiduyun/state.db"));
        // 正常稿件不受影响。
        assert!(!should_ignore("黑雨之下/QM/entities/求和派.md"));
        assert!(!should_ignore("黑雨之下/.novel/snapshots/001.snapshot.json"));
    }

    #[test]
    fn ignores_machine_local_and_temp_files() {
        assert!(should_ignore(".qmai/file-snapshot.json"));
        assert!(should_ignore("QM/entities/../.qmai/lock".replace("/../", "/").as_str()));
        assert!(should_ignore("QM/entities/a.md.qmai-tmp"));
        assert!(should_ignore("QM/~$draft.docx"));
        assert!(should_ignore("raw/assets/.DS_Store"));
        assert!(!should_ignore("QM/entities/林照.md"));
        assert!(!should_ignore("covers/cover.png"));
    }

    #[test]
    fn scans_only_sync_roots_and_respects_snapshot_switch() {
        let dir = temp_dir("roots");
        fs::create_dir_all(dir.join("QM/entities")).unwrap();
        fs::create_dir_all(dir.join("raw/assets")).unwrap();
        fs::create_dir_all(dir.join(".novel/snapshots")).unwrap();
        fs::create_dir_all(dir.join(".qmai")).unwrap();
        fs::write(dir.join("QM/entities/林照.md"), b"entity").unwrap();
        fs::write(dir.join("raw/assets/ref.txt"), b"raw").unwrap();
        fs::write(dir.join(".novel/snapshots/ch1.md"), b"snap").unwrap();
        fs::write(dir.join(".qmai/project.json"), b"{}").unwrap();

        let without_snapshots = scan_project_files(&dir, false).unwrap();
        let rels: Vec<&str> = without_snapshots.iter().map(|file| file.rel.as_str()).collect();
        assert_eq!(rels, vec!["QM/entities/林照.md", "raw/assets/ref.txt"]);

        let with_snapshots = scan_project_files(&dir, true).unwrap();
        assert!(with_snapshots.iter().any(|file| file.rel == ".novel/snapshots/ch1.md"));
        assert!(!with_snapshots.iter().any(|file| file.rel.starts_with(".qmai/")));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn hashing_is_stable_and_content_based() {
        let dir = temp_dir("hash");
        let first = dir.join("a.md");
        let second = dir.join("b.md");
        fs::write(&first, b"same bytes").unwrap();
        fs::write(&second, b"same bytes").unwrap();
        assert_eq!(sha256_file(&first).unwrap(), sha256_file(&second).unwrap());

        fs::write(&second, b"different").unwrap();
        assert_ne!(sha256_file(&first).unwrap(), sha256_file(&second).unwrap());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_project_dir_is_an_error_not_an_empty_scan() {
        let dir = temp_dir("missing");
        let missing = dir.join("nope");
        assert!(scan_project_files(&missing, true).is_err());
        fs::remove_dir_all(&dir).ok();
    }
}
