use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Atomically replace `destination` with a sibling temporary file.
#[cfg(windows)]
pub fn replace_file_atomically(temp: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let existing: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let new: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        MoveFileExW(
            existing.as_ptr(),
            new.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(format!(
            "原子替换文件失败: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
pub fn replace_file_atomically(temp: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temp, destination).map_err(|e| format!("原子替换文件失败: {e}"))
}

pub fn write_bytes_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    write_bytes_atomically_with_replace(path, bytes, replace_file_atomically)
}

pub fn write_bytes_atomically_with_replace<F>(
    path: &Path,
    bytes: &[u8],
    replace: F,
) -> Result<(), String>
where
    F: FnOnce(&Path, &Path) -> Result<(), String>,
{
    let parent = path
        .parent()
        .ok_or_else(|| "路径缺少父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建目录失败 '{}': {e}", parent.display()))?;
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "app-state.json".to_string());
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp = parent.join(format!(".{file_name}.{stamp}.tmp"));
    let write_result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| format!("创建临时文件失败 '{}': {e}", temp.display()))?;
        file.write_all(bytes)
            .map_err(|e| format!("写入临时文件失败 '{}': {e}", temp.display()))?;
        file.sync_all()
            .map_err(|e| format!("同步临时文件失败 '{}': {e}", temp.display()))?;
        drop(file);
        replace(&temp, path)
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    write_result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn unique_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qmai_atomic_file_{name}_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn failed_replace_leaves_the_original_file() {
        let dir = unique_test_dir("replace_fail");
        let path = dir.join("app-state.json");
        fs::write(&path, r#"{"llmConfig":{"model":"keep"}}"#).unwrap();

        let result = write_bytes_atomically_with_replace(
            &path,
            br#"{"llmConfig":{"model":"new"}}"#,
            |_temp, _dest| Err("injected replace failure".to_string()),
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            r#"{"llmConfig":{"model":"keep"}}"#
        );
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files leftover: {leftovers:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_replaces_existing_content() {
        let dir = unique_test_dir("replace_ok");
        let path = dir.join("app-state.json");
        fs::write(&path, "{}").unwrap();
        write_bytes_atomically(&path, br#"{"ok":true}"#).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), r#"{"ok":true}"#);
        let _ = fs::remove_dir_all(&dir);
    }
}
