use std::fs;
use std::io::{self, Write};
use std::net::IpAddr;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

pub const IDENTIFIER: &str = "com.qingmuai.writer";

pub fn app_data_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        home_dir().join("Library/Application Support").join(IDENTIFIER)
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir().join("AppData").join("Roaming"))
            .join(IDENTIFIER)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir().join(".local/share"))
            .join(IDENTIFIER)
    }
}

pub fn endpoint_file() -> PathBuf {
    app_data_dir().join("mcp-endpoint.json")
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn ensure_loopback(ip: IpAddr) -> Result<(), String> {
    if ip.is_loopback() {
        Ok(())
    } else {
        Err("只允许本机连接 MCP".to_string())
    }
}

pub fn write_private_file(path: &Path, contents: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
        }
    }
    let mut options = fs::OpenOptions::new();
    options.create(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(contents.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

pub fn write_endpoint(port: u16, token: &str) -> Result<(), String> {
    let payload = json!({ "port": port, "token": token });
    write_private_file(&endpoint_file(), &payload.to_string())
        .map_err(|error| format!("无法写入 MCP 连接信息：{error}"))
}

pub fn read_endpoint(path: &Path) -> Result<(u16, String), String> {
    let text = fs::read_to_string(path).map_err(|_| "青幕写作未启动，或尚未打开 MCP 开关。".to_string())?;
    let value: Value = serde_json::from_str(&text).map_err(|_| "MCP 连接信息损坏。".to_string())?;
    let port = value
        .get("port")
        .and_then(|item| item.as_u64())
        .ok_or_else(|| "MCP 连接信息损坏。".to_string())? as u16;
    let token = value
        .get("token")
        .and_then(|item| item.as_str())
        .filter(|item| !item.is_empty())
        .ok_or_else(|| "MCP 连接信息损坏。".to_string())?;
    Ok((port, token.to_string()))
}

pub fn find_skill_dir(starts: &[PathBuf]) -> Option<PathBuf> {
    for start in starts {
        let mut cursor = Some(start.clone());
        for _ in 0..8 {
            let Some(dir) = cursor else { break };
            for candidate in [dir.join("skills/qmai-mcp"), dir.join("_up_").join("skills/qmai-mcp")] {
                if candidate.join("SKILL.md").is_file() {
                    return Some(candidate);
                }
            }
            cursor = dir.parent().map(Path::to_path_buf);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn rejects_non_loopback_peers() {
        assert!(ensure_loopback(IpAddr::V4(Ipv4Addr::LOCALHOST)).is_ok());
        assert!(ensure_loopback(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))).is_err());
    }

    #[test]
    fn finds_skill_by_walking_up_from_a_nested_directory() {
        let root = std::env::temp_dir().join(format!("qmai-skill-{}", std::process::id()));
        let nested = root.join("src-tauri/target/debug");
        let skill = root.join("skills/qmai-mcp");
        fs::create_dir_all(&nested).unwrap();
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "---\nmetadata:\n  version: 1.0.0\n---\n").unwrap();
        let found = find_skill_dir(&[nested]).unwrap();
        assert_eq!(found, skill);
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn endpoint_file_is_only_readable_by_the_user() {
        let dir = std::env::temp_dir().join(format!("qmai-endpoint-{}", std::process::id()));
        let path = dir.join("mcp-endpoint.json");
        write_private_file(&path, "{}").unwrap();
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = fs::remove_dir_all(&dir);
    }
}
