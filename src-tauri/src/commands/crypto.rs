use sha2::{Digest, Sha256};

/// 获取设备指纹（基于机器名 + 用户名 + OS）
/// 用于派生加密密钥，绑定到当前设备
fn get_device_fingerprint() -> String {
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown-host".to_string());

    let username = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "unknown-user".to_string());

    let os = std::env::consts::OS;

    let raw = format!("qmai::{}::{}::{}::device-key-v1", hostname, username, os);
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    let hash = hasher.finalize();
    // 返回 32 字节 hex 编码（64 字符），用作 AES-256 密钥材料
    hash.iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

// ── Tauri 命令 ──────────────────────────────────────────────────────

/// 获取设备指纹（64字符十六进制字符串）
/// 前端用这个指纹派生 AES-256 密钥来加密 API 密钥
#[tauri::command]
pub async fn get_device_fingerprint_cmd() -> Result<String, String> {
    Ok(get_device_fingerprint())
}

// ── 测试 ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_is_consistent() {
        let fp1 = get_device_fingerprint();
        let fp2 = get_device_fingerprint();
        assert_eq!(fp1, fp2, "设备指纹应该稳定一致");
        assert_eq!(fp1.len(), 64, "指纹应该是 64 字符（32 字节 hex）");
    }

    #[test]
    fn fingerprint_is_hex() {
        let fp = get_device_fingerprint();
        assert!(fp.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
