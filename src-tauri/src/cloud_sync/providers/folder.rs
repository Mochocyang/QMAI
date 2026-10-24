//! 「本地文件夹」远端：直接读写用户选的目录（通常是网盘客户端的同步空间）。
//!
//! 为什么把它做成远端适配器而不是特例：三个网盘在引擎眼里应该一模一样，
//! 这样 P3 接 WebDAV 时引擎一行都不用改。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use super::{resolve_within_root, RemoteFile, RemoteStore};
use crate::cloud_sync::scan::to_relative_string;

pub struct FolderStore {
    root: PathBuf,
}

impl FolderStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// 选目录时的校验：存在、是目录、能写、不是一本项目目录本身。
    ///
    /// 最后一条很重要：把远端选成某一本书自己的目录，会在同一批文件上
    /// 反复互相覆盖（本地是远端、远端也是本地），必须当场拒绝。
    pub fn validate(root: &Path) -> Result<(), String> {
        if !root.exists() {
            return Err("folder.missing".to_string());
        }
        if !root.is_dir() {
            return Err("folder.not-directory".to_string());
        }

        // 看起来像项目根：同时有 QM/ 与 .qmai/。
        if root.join("QM").is_dir() && root.join(".qmai").is_dir() {
            return Err("folder.is-project".to_string());
        }

        // 试探写：权限、只读盘、被安全软件锁住都会在这里暴露。
        let probe = root.join(".qmai-cloud-probe");
        let write_result = fs::write(&probe, b"qmai");
        let _ = fs::remove_file(&probe);
        write_result.map_err(|_| "folder.not-writable".to_string())?;

        Ok(())
    }

    /// 远端根目录（「打开远端目录」等界面动作要用；P3 起 WebDAV 也提供同名方法）。
    #[allow(dead_code)]
    pub fn root_dir(&self) -> &Path {
        &self.root
    }

    fn path_of(&self, rel: &str) -> Result<PathBuf, String> {
        resolve_within_root(&self.root, rel)
    }
}

impl RemoteStore for FolderStore {
    fn list(&self) -> Result<Vec<RemoteFile>, String> {
        if !self.root.is_dir() {
            return Err("remote.missing".to_string());
        }
        let mut files = Vec::new();
        for entry in WalkDir::new(&self.root).follow_links(false).into_iter().flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(rel) = to_relative_string(entry.path(), &self.root) else {
                continue;
            };
            // 远端就是网盘客户端的同步目录：临时文件、回收站、我们的元数据都在里面，
            // 不做过滤会被当成书稿同步。
            if crate::cloud_sync::scan::should_ignore(&rel) {
                continue;
            }
            let metadata = entry.metadata().ok();
            let size = metadata.as_ref().map(|meta| meta.len()).unwrap_or(0);
            // 本地文件夹没有 ETag，用「大小 + 修改时间（纳秒）」当版本标识。
            // 必须到纳秒：秒级精度下「同一秒内同样长度的改写」会被判成没变，
            // 用户改了两个字（字数不变）却发现没同步，比多读一次文件糟糕得多。
            let etag = metadata
                .and_then(|meta| meta.modified().ok())
                .and_then(|time| {
                    time.duration_since(std::time::UNIX_EPOCH)
                        .ok()
                        .map(|elapsed| format!("{size}:{}", elapsed.as_nanos()))
                });
            files.push(RemoteFile { rel, size, etag });
        }
        files.sort_by(|left, right| left.rel.cmp(&right.rel));
        Ok(files)
    }

    fn read(&self, rel: &str) -> Result<Vec<u8>, String> {
        let path = self.path_of(rel)?;
        fs::read(&path).map_err(|error| format!("读取远端文件失败 {rel}：{error}"))
    }

    fn write(&self, rel: &str, data: &[u8]) -> Result<(), String> {
        let path = self.path_of(rel)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("创建远端目录失败：{error}"))?;
        }
        // 先写同目录临时文件再改名：网盘客户端可能正在观察这个目录，
        // 半个文件被它抢走比报错更糟。
        let tmp = path.with_extension(format!(
            "{}.qmai-tmp",
            path.extension().and_then(|ext| ext.to_str()).unwrap_or("")
        ));
        {
            let mut file = fs::File::create(&tmp).map_err(|error| format!("写入远端文件失败 {rel}：{error}"))?;
            file.write_all(data)
                .map_err(|error| format!("写入远端文件失败 {rel}：{error}"))?;
        }
        // 目标文件可能正被网盘客户端读取/上传（Windows 上 rename 会报
        // 「拒绝访问 os error 5」）。等一会儿再试，别让一次瞬时占用
        // 把整轮同步判死。
        let mut attempt = 0u32;
        loop {
            attempt += 1;
            match fs::rename(&tmp, &path) {
                Ok(()) => return Ok(()),
                Err(error) if attempt < 4 => {
                    log::debug!("[cloud-sync] 替换远端文件被占用，重试 {attempt}：{rel} ({error})");
                    std::thread::sleep(std::time::Duration::from_millis(120 * u64::from(attempt)));
                }
                Err(error) => {
                    let _ = fs::remove_file(&tmp);
                    return Err(format!("替换远端文件失败 {rel}：{error}"));
                }
            }
        }
    }

    fn remove(&self, rel: &str) -> Result<(), String> {
        let path = self.path_of(rel)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            // 已经不在了就当删成功：清单修正比报错更有用。
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("删除远端文件失败 {rel}：{error}")),
        }
    }

    fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        let source = self.path_of(from)?;
        let target = self.path_of(to)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("创建远端目录失败：{error}"))?;
        }
        fs::rename(&source, &target).map_err(|error| format!("重命名远端文件失败 {from} → {to}：{error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qmai_folder_{name}_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn validate_accepts_a_plain_writable_directory() {
        let dir = temp_dir("ok");
        assert!(FolderStore::validate(&dir).is_ok());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn validate_rejects_a_project_directory() {
        let dir = temp_dir("project");
        fs::create_dir_all(dir.join("QM")).unwrap();
        fs::create_dir_all(dir.join(".qmai")).unwrap();
        assert_eq!(FolderStore::validate(&dir).unwrap_err(), "folder.is-project");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn validate_rejects_missing_directory() {
        let dir = temp_dir("missing");
        let missing = dir.join("nope");
        assert_eq!(FolderStore::validate(&missing).unwrap_err(), "folder.missing");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_then_list_round_trip_supports_chinese_paths() {
        let dir = temp_dir("roundtrip");
        let store = FolderStore::new(&dir);
        store.write("长夜/QM/entities/林照.md", "内容".as_bytes()).unwrap();

        let files = store.list().unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].rel, "长夜/QM/entities/林照.md");
        assert_eq!(store.read("长夜/QM/entities/林照.md").unwrap(), "内容".as_bytes());

        store.remove("长夜/QM/entities/林照.md").unwrap();
        assert!(store.list().unwrap().is_empty());
        // 重复删除不算失败。
        store.remove("长夜/QM/entities/林照.md").unwrap();
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rename_moves_file_and_creates_target_dir() {
        let dir = temp_dir("rename");
        let store = FolderStore::new(&dir);
        store.write("book/a.md", b"v1").unwrap();
        store.rename("book/a.md", "book2/b.md").unwrap();
        assert!(store.read("book2/b.md").is_ok());
        assert!(store.read("book/a.md").is_err());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_rejects_escaping_paths() {
        let dir = temp_dir("escape");
        let store = FolderStore::new(&dir);
        assert!(store.write("../outside.md", b"x").is_err());
        fs::remove_dir_all(&dir).ok();
    }
}
