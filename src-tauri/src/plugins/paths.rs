use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// 环境变量覆盖（开发调试用，对应设计文档 8.1）
pub const HOME_ENV: &str = "QMAI_PLUGIN_HOME";

/// 插件根目录：`QMAI_PLUGIN_HOME` 优先，否则 `<app_data>/plugins`。
pub fn plugins_root() -> PathBuf {
    let env = std::env::var_os(HOME_ENV);
    let base = crate::mcp::paths::app_data_dir();
    plugins_root_with(env, Some(base))
}

fn plugins_root_with(env: Option<OsString>, app_data: Option<PathBuf>) -> PathBuf {
    if let Some(v) = env {
        let s = v.to_string_lossy().trim().to_string();
        if !s.is_empty() {
            return PathBuf::from(s);
        }
    }
    app_data
        .unwrap_or_else(|| PathBuf::from(".qmai-plugins"))
        .join("plugins")
}

pub fn plugin_dir(root: &Path, id: &str) -> PathBuf { root.join(id) }
pub fn plugin_data_dir(root: &Path, id: &str) -> PathBuf { root.join(format!("{id}-data")) }
pub fn staging_dir(root: &Path) -> PathBuf { root.join(".staging") }
pub fn registry_file(root: &Path) -> PathBuf { root.join(".registry.json") }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugins_root_honours_env_override() {
        let root = plugins_root_with(Some(std::ffi::OsString::from("/tmp/qmai-plugins")), None);
        assert_eq!(root, PathBuf::from("/tmp/qmai-plugins"));
    }

    #[test]
    fn plugins_root_falls_back_to_app_data() {
        let root = plugins_root_with(None, Some(PathBuf::from("/app/data")));
        assert_eq!(root, PathBuf::from("/app/data/plugins"));
    }

    #[test]
    fn plugin_dirs_are_derived_from_root() {
        let root = PathBuf::from("/r");
        assert_eq!(plugin_dir(&root, "abc"), PathBuf::from("/r/abc"));
        assert_eq!(plugin_data_dir(&root, "abc"), PathBuf::from("/r/abc-data"));
        assert_eq!(staging_dir(&root), PathBuf::from("/r/.staging"));
        assert_eq!(registry_file(&root), PathBuf::from("/r/.registry.json"));
    }
}
