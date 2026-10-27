use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// 环境变量覆盖（开发调试用，对应设计文档 8.1）
pub const HOME_ENV: &str = "QMAI_PLUGIN_HOME";

/// 插件根目录：`QMAI_PLUGIN_HOME` 优先，否则 `<app_data>/plugins`。
pub fn plugins_root() -> PathBuf {
    let env = std::env::var_os(HOME_ENV);
    let base = crate::mcp::paths::app_data_dir();
    plugins_root_with(env, base)
}

fn plugins_root_with(env: Option<OsString>, app_data: PathBuf) -> PathBuf {
    if let Some(v) = env {
        // 只借用 lossy 结果判空：非 UTF-8 路径若被有损转换再重建，会指向一个不存在的目录
        if !v.to_string_lossy().trim().is_empty() {
            return PathBuf::from(v);
        }
    }
    app_data.join("plugins")
}

pub fn plugin_dir(root: &Path, id: &str) -> PathBuf { root.join(id) }
// 用 `.` 而不是 `-` 分隔：id 正则允许 `-`，`{id}-data` 会与另一个插件的本体目录撞路径
// （如插件 `my-data` 的本体目录 == 插件 `my` 的私有数据目录，卸载/安装会互相踩）。
pub fn plugin_data_dir(root: &Path, id: &str) -> PathBuf { root.join(format!("{id}.data")) }
pub fn staging_dir(root: &Path) -> PathBuf { root.join(".staging") }
pub fn registry_file(root: &Path) -> PathBuf { root.join(".registry.json") }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugins_root_honours_env_override() {
        let root = plugins_root_with(Some(std::ffi::OsString::from("/tmp/qmai-plugins")), PathBuf::from("/unused"));
        assert_eq!(root, PathBuf::from("/tmp/qmai-plugins"));
    }

    #[test]
    fn plugins_root_falls_back_to_app_data() {
        let root = plugins_root_with(None, PathBuf::from("/app/data"));
        assert_eq!(root, PathBuf::from("/app/data/plugins"));
    }

    #[test]
    fn blank_env_falls_back_to_app_data() {
        let root = plugins_root_with(Some(std::ffi::OsString::from("   ")), PathBuf::from("/app/data"));
        assert_eq!(root, PathBuf::from("/app/data/plugins"));
    }

    #[test]
    fn plugin_dirs_are_derived_from_root() {
        let root = PathBuf::from("/r");
        assert_eq!(plugin_dir(&root, "abc"), PathBuf::from("/r/abc"));
        assert_eq!(plugin_data_dir(&root, "abc"), PathBuf::from("/r/abc.data"));
        assert_eq!(staging_dir(&root), PathBuf::from("/r/.staging"));
        assert_eq!(registry_file(&root), PathBuf::from("/r/.registry.json"));
    }

    #[test]
    fn data_dir_does_not_collide_with_another_plugin_dir() {
        let root = PathBuf::from("/r");
        // id 允许连字符：若不改约定，my-data 这个插件目录会与插件 my 的数据目录同路径
        assert_ne!(plugin_dir(&root, "my-data"), plugin_data_dir(&root, "my"));
    }
}
