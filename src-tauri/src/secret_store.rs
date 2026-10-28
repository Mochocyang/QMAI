//! 通用本地小仓库：保存「不该明文落盘」的内容。
//!
//! 三个用途：
//! 1. **同步密码**（模型配置云同步的密钥来源）；
//! 2. **模型配置本体**（含 API Key）的本地密文；
//! 3. app-state.json 里敏感字段（API Key / WebDAV 密码）的透明加解密。
//!
//! 安全边界：
//! - Windows：走 DPAPI（`CryptProtectData`），密文绑定当前用户账户；
//!   换机器 / 换用户都解不开——换设备时重新输入一次同步密码即可。
//! - macOS / Linux：没有系统密钥环时退化为 0600 明文（与云同步凭据同一套取舍），
//!   这一点必须诚实：它只保证「同机其它用户读不到」，挡不住拿盘的人。
//!
//! 文件名只允许 `[a-z0-9_-]`，避免调用方传路径穿越。

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

use crate::cloud_sync::credentials;

const SECRET_DIR: &str = "secrets";
const MAX_NAME_CHARS: usize = 64;
const MAX_VALUE_BYTES: usize = 8 * 1024;
/// app-state 单字段加密上限：模型/搜索/网盘配置整块加密，256KB 足够。
const MAX_STATE_SECRET_BYTES: usize = 256 * 1024;

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > MAX_NAME_CHARS {
        return Err("密钥名称长度不合法。".to_string());
    }
    if !name
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || ch == '_')
    {
        return Err("密钥名称只能包含小写字母、数字、- 和 _。".to_string());
    }
    Ok(())
}

fn secret_path<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<PathBuf, String> {
    validate_name(name)?;
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    Ok(base.join(SECRET_DIR).join(format!("{name}.bin")))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建密钥目录失败：{error}"))?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|error| format!("写入密钥失败：{error}"))?;
    credentials::restrict_permissions(&tmp);
    fs::rename(&tmp, path).map_err(|error| format!("保存密钥失败：{error}"))?;
    Ok(())
}

/// 保存一个密钥（覆盖写）。
#[tauri::command]
pub fn secret_set<R: Runtime>(app: AppHandle<R>, name: String, value: String) -> Result<(), String> {
    if value.len() > MAX_VALUE_BYTES {
        return Err("要保存的内容过长。".to_string());
    }
    let path = secret_path(&app, &name)?;
    let protected = credentials::protect(value.as_bytes())?;
    write_atomic(&path, &protected)
}

/// 读取密钥；不存在返回 `None`（不要当成错误，换设备时就是这种情况）。
#[tauri::command]
pub fn secret_get<R: Runtime>(app: AppHandle<R>, name: String) -> Result<Option<String>, String> {
    let path = secret_path(&app, &name)?;
    let payload = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(None),
    };
    let plain = match credentials::unprotect(&payload) {
        Ok(plain) => plain,
        Err(error) => {
            // 解不开（换用户 / 换机器 / 文件损坏）：当成「没有」，并留档排查。
            let stamp = chrono::Utc::now().format("%Y%m%d%H%M%S");
            let _ = fs::rename(&path, path.with_extension(format!("corrupt-{stamp}")));
            log::warn!("[secret] 无法解密 {name}：{error}");
            return Ok(None);
        }
    };
    String::from_utf8(plain)
        .map(Some)
        .map_err(|_| "密钥内容不是合法文本。".to_string())
}

/// 删除密钥（不存在也算成功）。
#[tauri::command]
pub fn secret_clear<R: Runtime>(app: AppHandle<R>, name: String) -> Result<(), String> {
    let path = secret_path(&app, &name)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("删除密钥失败：{error}")),
    }
}

// ---------------------------------------------------------------- 模型配置的本地加密存储

/// 模型配置的本地密文文件名（固定，不走 `secret_set` 的名称白名单）。
const MODEL_CONFIGS_FILE: &str = "model-configs.bin";
/// 单份模型配置上限：10 个 provider 约 10KB，256KB 足够并且能兜住异常膨胀。
const MAX_MODEL_CONFIGS_BYTES: usize = 256 * 1024;

fn model_configs_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    Ok(base.join(SECRET_DIR).join(MODEL_CONFIGS_FILE))
}

/// 保存模型配置的密文（Windows 走 DPAPI；其它平台是 0600 文件）。
#[tauri::command]
pub fn model_configs_save<R: Runtime>(app: AppHandle<R>, contents: String) -> Result<(), String> {
    if contents.len() > MAX_MODEL_CONFIGS_BYTES {
        return Err("模型配置内容过大。".to_string());
    }
    let path = model_configs_path(&app)?;
    let protected = credentials::protect(contents.as_bytes())?;
    write_atomic(&path, &protected)
}

/// 读取模型配置密文；不存在或解不开都返回 `None`（换机器后就是这种情况）。
#[tauri::command]
pub fn model_configs_load<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let path = model_configs_path(&app)?;
    let payload = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(None),
    };
    let plain = match credentials::unprotect(&payload) {
        Ok(plain) => plain,
        Err(error) => {
            let stamp = chrono::Utc::now().format("%Y%m%d%H%M%S");
            let _ = fs::rename(&path, path.with_extension(format!("corrupt-{stamp}")));
            log::warn!("[secret] 无法解密本地模型配置：{error}");
            return Ok(None);
        }
    };
    String::from_utf8(plain)
        .map(Some)
        .map_err(|_| "模型配置内容不是合法文本。".to_string())
}

/// 删除模型配置密文（不存在也算成功）。
#[tauri::command]
pub fn model_configs_clear<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let path = model_configs_path(&app)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("删除本地模型配置失败：{error}")),
    }
}

// ---------------------------------------------------------------- app-state 敏感字段的透明加密

/// 把一段 JSON 文本加密成 base64 密文（Windows 走 DPAPI）。
///
/// 用于 app-state.json 里的 API Key / WebDAV 密码：前端在写盘前调用、读回时解密，
/// 因此磁盘上不再出现明文凭据。
#[tauri::command]
pub fn state_secret_encrypt(plaintext: String) -> Result<String, String> {
    if plaintext.len() > MAX_STATE_SECRET_BYTES {
        return Err("要加密的内容过长。".to_string());
    }
    let protected = credentials::protect(plaintext.as_bytes())?;
    use base64::Engine as _;
    Ok(base64::engine::general_purpose::STANDARD.encode(protected))
}

/// 解密 `state_secret_encrypt` 的产物；解不开返回 `None`（换机器/换用户就是这样）。
#[tauri::command]
pub fn state_secret_decrypt(payload: String) -> Result<Option<String>, String> {
    use base64::Engine as _;
    let bytes = match base64::engine::general_purpose::STANDARD.decode(payload) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(None),
    };
    let plain = match credentials::unprotect(&bytes) {
        Ok(plain) => plain,
        Err(error) => {
            log::warn!("[secret] 无法解密 state secret：{error}");
            return Ok(None);
        }
    };
    String::from_utf8(plain)
        .map(Some)
        .map_err(|_| "解密内容不是合法文本。".to_string())
}
