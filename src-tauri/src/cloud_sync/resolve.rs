//! 冲突的「逐项定夺」：用户选保留哪一边。
//!
//! 引擎的默认策略是**两边都留**：本地这份留在原路径，云端旧版本改名成
//! `<名字>.remote-<时间戳>.<扩展名>`。这样不会丢内容，但用户面对的是两个文件 ——
//! 这个模块就是「选一个，另一个删掉」的实现。
//!
//! 两个方向都收敛到同一个状态：原路径上的内容 = 用户选中的那份，
//! 冲突副本全部清除，清单里的基准同步更新。所以下一次同步不会再判成冲突。
//!
//! 路径有两套，别混：
//! - **本地**：`project_path / rel`，`rel` 不含书目录（如 `QM/entities/林照.md`）。
//! - **远端**：`<书目录>/rel`，书目录来自清单里这本书的 `dir`（如 `书/QM/entities/林照.md`）。

use std::fs;
use std::path::{Path, PathBuf};

use super::compare::FileFingerprint;
use super::engine::{
    conflict_copy_pattern, path_from_rel, record_manifest, remove_manifest, sha256_bytes,
    write_local_file, Manifest,
};
use super::providers::RemoteStore;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictChoice {
    /// 保留本地当前版本（远端改成它；若本地已删除则按删除传播）。
    Local,
    /// 改用云端那一份（本地改成它；云端也写成它）。
    Cloud,
}

impl ConflictChoice {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "local" => Some(Self::Local),
            "cloud" | "remote" => Some(Self::Cloud),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolveOutcome {
    /// 给用户看的结果说明（同时写进同步历史）。
    pub message: String,
    pub bytes: Option<u64>,
}

/// 解决一条冲突。
pub fn resolve(
    store: &dyn RemoteStore,
    book_id: &str,
    project_path: &Path,
    rel: &str,
    choice: ConflictChoice,
) -> Result<ResolveOutcome, String> {
    let mut manifest = Manifest::load(store).unwrap_or_default();
    // 书目录以清单为准：引擎每轮都会把 `dir` 写回去。清单缺失时本来就没有基准，
    // 也就不会有冲突，不用在这里猜一个目录名。
    let book_dir = manifest.book_dir(book_id).unwrap_or_default();
    let remote_rel = join_rel(&book_dir, rel);

    // 远端副本挂在书目录下，本地副本挂在项目根下 —— 两套前缀分别算。
    let (remote_dir, remote_prefix, remote_suffix) = conflict_copy_pattern(&remote_rel);
    let (local_dir, local_prefix, local_suffix) = conflict_copy_pattern(rel);

    let remote_files = store.list()?;
    let remote_copies: Vec<String> = remote_files
        .iter()
        .map(|file| file.rel.clone())
        .filter(|path| is_conflict_copy(path, &remote_dir, &remote_prefix, &remote_suffix))
        .collect();
    let local_copies = list_local_copies(project_path, &local_dir, &local_prefix, &local_suffix);
    let local_original = project_path.join(path_from_rel(rel));

    let outcome = match choice {
        ConflictChoice::Cloud => {
            // 云端那一份可能在远端副本里（本地改过），也可能已经在本地副本里（本地删过）。
            let bytes = if let Some(remote_copy) = remote_copies.first() {
                store.read(remote_copy)?
            } else if let Some(local_copy) = local_copies.first() {
                fs::read(local_copy).map_err(|error| format!("读取本地冲突副本失败：{error}"))?
            } else {
                // 副本都没有：只能以远端原路径为准。
                store.read(&remote_rel)?
            };
            let size = bytes.len() as u64;
            write_local_file(&local_original, &bytes)?;
            // 远端原路径也写成同一份：否则下一轮同步会把它当成本地新改动再传一次。
            store.write(&remote_rel, &bytes)?;
            delete_copies(store, &remote_copies, &local_copies);
            record_manifest(&mut manifest, book_id, &book_dir, rel, &sha256_fingerprint(&bytes));
            ResolveOutcome { message: format!("已改用云端版本：{rel}"), bytes: Some(size) }
        }
        ConflictChoice::Local => {
            if local_original.is_file() {
                let bytes = fs::read(&local_original)
                    .map_err(|error| format!("读取本地文件失败：{error}"))?;
                let size = bytes.len() as u64;
                store.write(&remote_rel, &bytes)?;
                delete_copies(store, &remote_copies, &local_copies);
                record_manifest(&mut manifest, book_id, &book_dir, rel, &sha256_fingerprint(&bytes));
                ResolveOutcome { message: format!("已保留本地版本：{rel}"), bytes: Some(size) }
            } else {
                // 本地删了、云端改过：用户选「本地」就是确认这次删除，按删除传播。
                store.remove(&remote_rel)?;
                delete_copies(store, &remote_copies, &local_copies);
                remove_manifest(&mut manifest, book_id, rel);
                ResolveOutcome { message: format!("已按本地删除处理：{rel}"), bytes: None }
            }
        }
    };

    // 冲突定夺是用户手动点的，清单必须落盘（否则下次还要他再点一遍），
    // 所以这里是硬失败而不是只记日志；但内容没变时不重写。
    manifest.save_if_changed(store)?;
    Ok(outcome)
}

fn join_rel(dir: &str, rel: &str) -> String {
    let dir = dir.trim_matches('/');
    let rel = rel.trim_matches('/');
    if dir.is_empty() {
        rel.to_string()
    } else {
        format!("{dir}/{rel}")
    }
}

fn sha256_fingerprint(bytes: &[u8]) -> FileFingerprint {
    FileFingerprint::new(sha256_bytes(bytes), bytes.len() as u64)
}

fn is_conflict_copy(path: &str, dir: &str, prefix: &str, suffix: &str) -> bool {
    let (path_dir, name) = split_dir_and_name(path);
    path_dir == dir && name.starts_with(prefix) && name.ends_with(suffix) && name.len() > prefix.len()
}

fn list_local_copies(project_path: &Path, dir: &str, prefix: &str, suffix: &str) -> Vec<PathBuf> {
    let directory = if dir.is_empty() {
        project_path.to_path_buf()
    } else {
        project_path.join(path_from_rel(dir))
    };
    let Ok(entries) = fs::read_dir(&directory) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| entry.file_type().map(|kind| kind.is_file()).unwrap_or(false))
        .map(|entry| entry.path())
        .filter(|path| {
            let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
            name.starts_with(prefix) && name.ends_with(suffix) && name.len() > prefix.len()
        })
        .collect();
    out.sort();
    out
}

fn delete_copies(store: &dyn RemoteStore, remote_copies: &[String], local_copies: &[PathBuf]) {
    for copy in remote_copies {
        // 删不掉也继续：留一份副本比让「定夺」失败好。
        let _ = store.remove(copy);
    }
    for copy in local_copies {
        let _ = fs::remove_file(copy);
    }
}

fn split_dir_and_name(path: &str) -> (String, String) {
    match path.rsplit_once('/') {
        Some((dir, name)) => (dir.to_string(), name.to_string()),
        None => (String::new(), path.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_sync::providers::FolderStore;

    const BOOK_DIR: &str = "书";

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qmai_resolve_{name}_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    /// 造一个「清单里这本书的目录是 `书`」的远端，模拟引擎跑过一轮的状态。
    fn write_manifest(remote_root: &Path) {
        fs::create_dir_all(remote_root.join(".qmai-cloud")).unwrap();
        fs::write(
            remote_root.join(".qmai-cloud/manifest.json"),
            format!(r#"{{"version":1,"books":{{"book-1":{{"dir":"{BOOK_DIR}","files":{{}}}}}}}}"#),
        )
        .unwrap();
    }

    fn setup(
        rel: &str,
        local: &[u8],
        remote: &[u8],
        remote_copy: Option<&[u8]>,
    ) -> (PathBuf, PathBuf, FolderStore) {
        let project = temp_dir("project");
        let remote_root = temp_dir("remote");
        let local_path = project.join(path_from_rel(rel));
        fs::create_dir_all(local_path.parent().unwrap()).unwrap();
        if !local.is_empty() {
            fs::write(&local_path, local).unwrap();
        }
        let store = FolderStore::new(&remote_root);
        write_manifest(&remote_root);
        let remote_path = remote_root.join(path_from_rel(&join_rel(BOOK_DIR, rel)));
        fs::create_dir_all(remote_path.parent().unwrap()).unwrap();
        fs::write(&remote_path, remote).unwrap();
        if let Some(copy) = remote_copy {
            let (dir, prefix, suffix) = conflict_copy_pattern(&join_rel(BOOK_DIR, rel));
            let name = format!("{prefix}20261024-1200{suffix}");
            let copy_path = remote_root.join(path_from_rel(&format!("{dir}/{name}")));
            fs::create_dir_all(copy_path.parent().unwrap()).unwrap();
            fs::write(&copy_path, copy).unwrap();
        }
        (project, remote_root, store)
    }

    fn write_local_copy(project: &Path, rel: &str, bytes: &[u8]) -> PathBuf {
        let (dir, prefix, suffix) = conflict_copy_pattern(rel);
        let copy = project.join(path_from_rel(&format!("{dir}/{prefix}20261024-1200{suffix}")));
        fs::create_dir_all(copy.parent().unwrap()).unwrap();
        fs::write(&copy, bytes).unwrap();
        copy
    }

    fn remote_path(rel: &str) -> String {
        join_rel(BOOK_DIR, rel)
    }

    #[test]
    fn choosing_cloud_overwrites_both_sides_and_drops_the_copies() {
        let rel = "QM/entities/林照.md";
        let (project, remote_root, store) =
            setup(rel, "本地版本".as_bytes(), "云端版本".as_bytes(), Some("云端版本".as_bytes()));
        let outcome = resolve(&store, "book-1", &project, rel, ConflictChoice::Cloud).unwrap();
        assert!(outcome.message.contains("云端"), "{}", outcome.message);

        assert_eq!(fs::read(project.join(path_from_rel(rel))).unwrap(), "云端版本".as_bytes());
        assert_eq!(
            fs::read(remote_root.join(path_from_rel(&remote_path(rel)))).unwrap(),
            "云端版本".as_bytes()
        );

        let remaining: Vec<String> = store.list().unwrap().into_iter().map(|file| file.rel).collect();
        assert!(remaining.iter().all(|path| !path.contains(".remote-")), "{remaining:?}");
    }

    #[test]
    fn choosing_local_pushes_it_to_the_remote_and_removes_copies() {
        let rel = "QM/entities/林照.md";
        let (project, remote_root, store) =
            setup(rel, "本地版本".as_bytes(), "云端版本".as_bytes(), Some("云端版本".as_bytes()));
        resolve(&store, "book-1", &project, rel, ConflictChoice::Local).unwrap();
        assert_eq!(
            fs::read(remote_root.join(path_from_rel(&remote_path(rel)))).unwrap(),
            "本地版本".as_bytes()
        );
        assert_eq!(fs::read(project.join(path_from_rel(rel))).unwrap(), "本地版本".as_bytes());
        let remaining: Vec<String> = store.list().unwrap().into_iter().map(|file| file.rel).collect();
        assert!(remaining.iter().all(|path| !path.contains(".remote-")), "{remaining:?}");
    }

    #[test]
    fn choosing_local_after_deleting_propagates_the_deletion() {
        let rel = "QM/entities/林照.md";
        let (project, remote_root, store) = setup(rel, b"", "云端版本".as_bytes(), None);
        let copy = write_local_copy(&project, rel, "云端版本".as_bytes());

        let outcome = resolve(&store, "book-1", &project, rel, ConflictChoice::Local).unwrap();
        assert!(outcome.message.contains("删除"), "{}", outcome.message);
        assert!(
            !remote_root.join(path_from_rel(&remote_path(rel))).exists(),
            "远端原路径应被删除"
        );
        assert!(!copy.exists(), "本地冲突副本应被清除");
    }

    #[test]
    fn choosing_cloud_falls_back_to_the_local_copy_when_the_remote_one_is_gone() {
        let rel = "QM/entities/林照.md";
        let (project, remote_root, store) = setup(rel, b"", "云端旧版本".as_bytes(), None);
        let copy = write_local_copy(&project, rel, "云端新版本".as_bytes());

        resolve(&store, "book-1", &project, rel, ConflictChoice::Cloud).unwrap();
        assert_eq!(fs::read(project.join(path_from_rel(rel))).unwrap(), "云端新版本".as_bytes());
        assert_eq!(
            fs::read(remote_root.join(path_from_rel(&remote_path(rel)))).unwrap(),
            "云端新版本".as_bytes()
        );
        assert!(!copy.exists());
    }

    #[test]
    fn resolution_updates_the_manifest_so_the_next_sync_is_not_a_conflict() {
        let rel = "QM/entities/林照.md";
        let (project, _remote_root, store) =
            setup(rel, "本地版本".as_bytes(), "云端版本".as_bytes(), Some("云端版本".as_bytes()));
        resolve(&store, "book-1", &project, rel, ConflictChoice::Cloud).unwrap();

        let manifest = Manifest::load(&store).expect("清单应已写出");
        let base = manifest.base_for_test("book-1", rel).expect("清单应记录这个文件");
        let bytes = fs::read(project.join(path_from_rel(rel))).unwrap();
        assert_eq!(base.hash, sha256_bytes(&bytes));
        assert_eq!(base.size, bytes.len() as u64);
    }

    #[test]
    fn choice_parsing_accepts_the_wire_values() {
        assert_eq!(ConflictChoice::parse("cloud"), Some(ConflictChoice::Cloud));
        assert_eq!(ConflictChoice::parse("remote"), Some(ConflictChoice::Cloud));
        assert_eq!(ConflictChoice::parse("LOCAL"), Some(ConflictChoice::Local));
        assert_eq!(ConflictChoice::parse("nonsense"), None);
    }
}
