//! 阶段 4：把随包分发的字体**按用户**安装到系统。
//!
//! ── 为什么由应用在启动时幂等「确保」安装，而不是只靠安装器 ──
//! 覆盖全部发布形态（NSIS 安装版 / 便携版 / 更新后自愈）、不踩 NSIS 的
//! `$UpdateMode` 陷阱、可测试、且能在界面里如实反映可用状态。
//! 安装器侧的 `POSTINSTALL`/`POSTUNINSTALL` 是**无条件执行**的，更新时旧卸载器
//! 会带 `/UPDATE` 运行 —— 字体清理若不保护就会在更新过程中把字体删掉。
//!
//! ── 为什么免管理员 ──
//! 走用户级位置（Windows: `%LOCALAPPDATA%\Microsoft\Windows\Fonts` + HKCU），
//! 中完整性级别下即可完成，不弹 UAC（已实测）。HKLM 同位置写入会被拒。
//!
//! ── 四条已实测的坑（勿按"想当然"实现）──
//! 1. **HKCU 的值数据必须是绝对路径**。裸文件名只对 HKLM/`%windir%\Fonts` 成立；
//!    同一文件同一目录下，裸名 → 新进程看不到，绝对路径 → 可见。
//! 2. **拷贝文件 + 写 HKCU 值即可立即生效**，无需注销/重启，也无需
//!    `AddFontResourceExW`。后者只用于 `FR_PRIVATE` 进程内专用字体，
//!    或强制**已在运行**的进程刷新字体缓存。
//! 3. 注册表**值名用英文族名**，形如 `"<EnglishFamily> (TrueType)"`。
//!    Windows 对 `.otf` 也用 `(TrueType)` 这个后缀（不是 `(OpenType)`）。
//! 4. **绝不能就地注册应用目录内的字体**：会有文件锁定风险，且 Tauri 更新器
//!    替换应用文件时可能失败。必须先拷到用户字体目录再注册。
//!
//! ── 幂等性与开销 ──
//! 启动时若每次都对 200MB 字体算 SHA-256，会明显拖慢启动。故：
//!   · 先在 app_data 里读一份安装记录；记录与当前清单一致时只 stat 文件大小；
//!   · 只有需要写入时才拷贝，且拷到 `.tmp` 再原子改名（避免半截文件被当成好文件）。
//! [Windows] ── 本进程内的可见性 ──
//! 本进程若已经创建过 DirectWrite 系统字体集合，新装的字体在当前会话可能不可见。
//! 因此调用方必须**先安装、后枚举**（见 `lib.rs` 的 setup 顺序），
//! 否则会出现"字体装上了，但本次启动的下拉里没有它"。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 随包字体的清单（`fonts/fonts-manifest.json`）。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FontManifest {
    #[serde(rename = "manifestVersion")]
    pub manifest_version: u32,
    #[serde(default)]
    pub fonts: Vec<ManifestEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ManifestEntry {
    pub id: String,
    pub display: String,
    /// name 表里的英文族名。用于组成注册表值名，**不是**给人看的。
    pub family: String,
    /// 相对 `fonts/` 的文件名。
    pub file: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
    pub sha256: String,
    #[serde(rename = "licenseFile", default)]
    pub license_file: Option<String>,
}

/// 每个字体的安装结果，供界面/日志如实反映状态。
#[derive(Debug, Clone, Serialize)]
pub struct FontInstallOutcome {
    pub id: String,
    pub display: String,
    pub family: String,
    /// `already` | `installed` | `failed`
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct InstallReport {
    pub outcomes: Vec<FontInstallOutcome>,
    /// 清单里一条都没有，或清单文件本身读不到。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 随包字体文件的完整性异常（缺失/被截断）。
    ///
    /// **必须如实上报**：截断的字体文件被系统加载后会变成"坏族"，
    /// 而界面上只是"这个字体不好看"，几乎不可能被归因到文件损坏。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<String>,
}

impl InstallReport {
    pub fn installed(&self) -> usize {
        self.outcomes.iter().filter(|o| o.status == "installed").count()
    }
    pub fn already(&self) -> usize {
        self.outcomes.iter().filter(|o| o.status == "already").count()
    }
    pub fn failed(&self) -> usize {
        self.outcomes.iter().filter(|o| o.status == "failed").count()
    }
    /// 一行摘要，供 eprintln 记录。
    pub fn summary(&self) -> String {
        if let Some(e) = &self.error {
            return format!("随包字体：未安装（{e}）");
        }
        let mut s = format!(
            "随包字体：共 {} 款，新装 {} / 已就位 {} / 失败 {}",
            self.outcomes.len(),
            self.installed(),
            self.already(),
            self.failed()
        );
        if !self.problems.is_empty() {
            s.push_str(&format!("；文件异常 {} 处", self.problems.len()));
        }
        s
    }
}

/// 安装记录：`app_data_dir/qmai-installed-fonts.json`。
///
/// 存下来是为了两件事：
///   · 启动时快速判断"要不要干活"（记录一致 → 只 stat 大小）；
///   · **卸载时能精确清理**（要知道写过哪些注册表值、拷过哪些文件）。
/// 卸载器读的是另一个纯文本副本（`installed-fonts.txt`），因为 NSIS 解析 JSON
/// 不现实 —— 见 `write_uninstall_record`。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct InstallRecord {
    #[serde(rename = "manifestVersion", default)]
    manifest_version: u32,
    #[serde(default)]
    installed: Vec<RecordedFont>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecordedFont {
    id: String,
    file: String,
    family: String,
    /// 落盘后的绝对路径。
    dest: String,
    #[serde(rename = "regValueName", default)]
    reg_value_name: Option<String>,
    #[serde(rename = "sizeBytes")]
    size_bytes: u64,
}

/// 读清单。找不到清单时返回 `Ok(None)` —— 那不是错误，
/// 只是这次构建没有随包字体（例如开发环境只跑了 `npm run dev`）。
pub fn read_manifest(fonts_dir: &Path) -> Result<Option<FontManifest>, String> {
    let path = fonts_dir.join("fonts-manifest.json");
    if !path.is_file() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取字体清单失败 {}: {e}", path.display()))?;
    let manifest: FontManifest =
        serde_json::from_str(&text).map_err(|e| format!("解析字体清单失败 {}: {e}", path.display()))?;
    if manifest.manifest_version != 1 {
        return Err(format!(
            "字体清单版本不受支持：{}（本程序支持 1）",
            manifest.manifest_version
        ));
    }
    Ok(Some(manifest))
}

/// 校验清单里所有文件的**大小**是否与清单一致。
///
/// 为什么只校验大小而不是 SHA-256：这要在**每次启动**跑，200MB 的哈希不可接受。
/// 完整性由构建期的 `verify-bundled-fonts.mjs` 用 SHA-256 守住（那是发布门禁），
/// 运行期只需发现"文件缺失/被截断"这种真正的异常。
pub fn verify_manifest_files(fonts_dir: &Path, manifest: &FontManifest) -> Vec<String> {
    let mut problems = Vec::new();
    for entry in &manifest.fonts {
        let path = fonts_dir.join(&entry.file);
        match std::fs::metadata(&path) {
            Ok(meta) if meta.len() == entry.size_bytes => {}
            Ok(meta) => problems.push(format!(
                "{} 大小不符：清单 {} 字节，实际 {} 字节",
                entry.file,
                entry.size_bytes,
                meta.len()
            )),
            Err(e) => problems.push(format!("{} 不可读：{e}", entry.file)),
        }
    }
    problems
}

/// 注册表值名。Windows 对 `.otf` 也用 `(TrueType)` 后缀。
fn registry_value_name(family: &str) -> String {
    format!("{family} (TrueType)")
}

/// 用户级字体目录。
pub fn user_font_dir() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let base = std::env::var_os("LOCALAPPDATA")
            .ok_or_else(|| "环境变量 LOCALAPPDATA 未设置，无法定位用户字体目录".to_string())?;
        Ok(PathBuf::from(base).join("Microsoft").join("Windows").join("Fonts"))
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")
            .ok_or_else(|| "环境变量 HOME 未设置".to_string())?;
        Ok(PathBuf::from(home).join("Library").join("Fonts"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
            return Ok(PathBuf::from(xdg).join("fonts"));
        }
        let home = std::env::var_os("HOME")
            .ok_or_else(|| "环境变量 HOME 未设置".to_string())?;
        Ok(PathBuf::from(home).join(".local").join("share").join("fonts"))
    }
}

/// 拷贝到用户字体目录（幂等）。
///
/// `size_bytes` 相符就认为已就位 —— 与 `verify_manifest_files` 同一条理由。
/// 拷贝走 `.tmp` + 改名：半截文件被系统当成好字体会让字体库出现"坏族"，
/// 比"没装上"更难排查。
fn copy_if_needed(src: &Path, dest: &Path, size_bytes: u64) -> Result<bool, String> {
    if let Ok(meta) = std::fs::metadata(dest) {
        if meta.len() == size_bytes {
            return Ok(false);
        }
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建字体目录失败 {}: {e}", parent.display()))?;
    }
    // 临时名带进程号，避免两个实例同时启动时互相踩
    let tmp = dest.with_extension(format!("tmp{}", std::process::id()));
    std::fs::copy(src, &tmp).map_err(|e| {
        format!(
            "拷贝字体失败 {} → {}: {e}",
            src.display(),
            tmp.display()
        )
    })?;
    // 目标已存在时 Windows 的 rename 会失败，先删再改名
    if dest.exists() {
        let _ = std::fs::remove_file(dest);
    }
    std::fs::rename(&tmp, dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("字体改名失败 {} → {}: {e}", tmp.display(), dest.display())
    })?;
    Ok(true)
}

#[cfg(windows)]
mod win {
    use super::registry_value_name;
    use std::path::Path;
    use windows::core::HSTRING;
    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW,
        RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_SZ,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_FONTCHANGE,
    };

    /// 用户字体注册表键（HKCU，免管理员）。
    const FONT_KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts";

    /// 打开（不存在则创建）HKCU 字体键。
    ///
    /// 用 `RegCreateKeyW` 而不是 `RegCreateKeyExW`：后者因为要传
    /// `SECURITY_ATTRIBUTES`，在 `windows` crate 里被 `Win32_Security`
    /// 特性门控着；而这里根本不需要自定义安全属性（默认继承父键 ACL，
    /// 正是我们要的"当前用户可写"）。少一个特性依赖。
    fn open_font_key() -> Result<HKEY, String> {
        unsafe {
            let mut key = HKEY::default();
            let sub = HSTRING::from(FONT_KEY);
            let status = RegCreateKeyW(HKEY_CURRENT_USER, &sub, &mut key);
            if status != ERROR_SUCCESS {
                return Err(format!("打开 HKCU 字体键失败：{status:?}"));
            }
            Ok(key)
        }
    }

    /// 读一个值的当前内容（字符串）。值不存在返回 `Ok(None)`。
    fn read_value(key: HKEY, name: &str) -> Result<Option<String>, String> {
        unsafe {
            let name_h = HSTRING::from(name);
            let mut buf = vec![0u8; 2048];
            let mut len = buf.len() as u32;
            let mut ty = REG_SZ;
            let status = RegQueryValueExW(
                key,
                &name_h,
                None,
                Some(&mut ty),
                Some(buf.as_mut_ptr()),
                Some(&mut len),
            );
            if status == ERROR_FILE_NOT_FOUND {
                return Ok(None);
            }
            if status != ERROR_SUCCESS {
                return Err(format!("读取注册表值 {name} 失败：{status:?}"));
            }
            // REG_SZ 是 UTF-16LE，含结尾 NUL
            let units: Vec<u16> = buf[..len as usize]
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            let end = units.iter().position(|&c| c == 0).unwrap_or(units.len());
            Ok(Some(String::from_utf16_lossy(&units[..end])))
        }
    }

    /// 写一个 REG_SZ 值（UTF-16LE + NUL 结尾）。
    fn write_value(key: HKEY, name: &str, value: &str) -> Result<(), String> {
        unsafe {
            let name_h = HSTRING::from(name);
            // 手工拼 UTF-16LE 字节：REG_SZ 必须带结尾 NUL
            let mut bytes: Vec<u8> = Vec::with_capacity((value.len() + 1) * 2);
            for unit in value.encode_utf16() {
                bytes.extend_from_slice(&unit.to_le_bytes());
            }
            bytes.extend_from_slice(&[0, 0]);
            let status = RegSetValueExW(key, &name_h, None, REG_SZ, Some(&bytes));
            if status != ERROR_SUCCESS {
                return Err(format!("写入注册表值 {name} 失败：{status:?}"));
            }
            Ok(())
        }
    }

    /// 幂等注册：值已指向同一绝对路径则不动。
    ///
    /// 返回 `Ok(true)` 表示确实写入了（用于决定要不要广播 `WM_FONTCHANGE`）。
    pub fn register_font(family: &str, dest: &Path) -> Result<bool, String> {
        let value_name = registry_value_name(family);
        // 必须是绝对路径：裸文件名只对 HKLM/%windir%\Fonts 成立（已实测）
        let abs = std::fs::canonicalize(dest).unwrap_or_else(|_| dest.to_path_buf());
        let abs_str = abs.to_string_lossy().to_string();
        let key = open_font_key()?;
        let result = (|| -> Result<bool, String> {
            if let Some(current) = read_value(key, &value_name)? {
                if current.eq_ignore_ascii_case(&abs_str) {
                    return Ok(false);
                }
            }
            write_value(key, &value_name, &abs_str)?;
            Ok(true)
        })();
        unsafe {
            let _ = RegCloseKey(key);
        }
        result
    }

    /// 注销一个字体（卸载清理用）。
    pub fn unregister_font(family: &str) -> Result<(), String> {
        let value_name = registry_value_name(family);
        unsafe {
            let mut key = HKEY::default();
            let sub = HSTRING::from(FONT_KEY);
            let status = RegOpenKeyExW(HKEY_CURRENT_USER, &sub, None, KEY_SET_VALUE, &mut key);
            if status == ERROR_FILE_NOT_FOUND {
                return Ok(()); // 键都没有，无从清理
            }
            if status != ERROR_SUCCESS {
                return Err(format!("打开 HKCU 字体键失败：{status:?}"));
            }
            let name_h = HSTRING::from(value_name.as_str());
            let del = RegDeleteValueW(key, &name_h);
            let _ = RegCloseKey(key);
            // 值不存在不算失败（幂等）
            if del != ERROR_SUCCESS && del != ERROR_FILE_NOT_FOUND {
                return Err(format!("删除注册表值 {value_name} 失败：{del:?}"));
            }
            Ok(())
        }
    }

    /// 通知已在运行的进程字体已变化。
    ///
    /// 只对**已经运行**的进程有意义：新进程本来就会读到新注册表值。
    /// 失败不视为错误（例如超时），字体本身已经装好了。
    pub fn broadcast_font_change() {
        unsafe {
            let mut result: usize = 0;
            let _ = SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_FONTCHANGE,
                Default::default(),
                Default::default(),
                SMTO_ABORTIFHUNG,
                1000,
                Some(&mut result as *mut usize as *mut _),
            );
        }
    }
}

/// 卸载记录文件的文件名（放在 app_data_dir）。
pub const UNINSTALL_RECORD_FILE: &str = "installed-fonts.txt";
/// 安装记录的 JSON 文件名。
pub const INSTALL_RECORD_FILE: &str = "qmai-installed-fonts.json";

/// 写卸载器要读的纯文本记录：**每两项一组，交替两行** ——
/// 第 1 行族名，第 2 行目标绝对路径。
///
/// ── 为什么不用 `族名<TAB>路径` 一行一项 ──
/// NSIS 核心指令里没有"查找子串"，一行两项就必须引 `StrFunc.nsh` 的 `${StrLoc}`
/// 做下标运算（先找 TAB 位置、再 `IntOp` 加一、再按偏移取子串）。
/// 交替两行只需要 `FileRead` 两次，全是核心指令。
/// 卸载器是**装完就再也不会被测试**的那类代码，减少它对语法细节的依赖比
/// 让文件好看一点重要得多。
///
/// ── 因此这个文件**不能有注释行** ──
/// 一行注释就会让后面所有行错位（族名位置读到路径）。格式说明放在此处与
/// `docs/font-scaling-fix-20261007/` 里，不放在数据文件里。
fn write_uninstall_record(app_data_dir: &Path, record: &InstallRecord) -> Result<(), String> {
    let mut text = String::new();
    for f in &record.installed {
        // 族名/路径都来自字体文件与文件系统，理论上是不可信输入：
        // 一个换行就能让后续所有行错位，从而删错文件。必须剥掉。
        let family = f.family.replace(['\t', '\r', '\n'], " ");
        let dest = f.dest.replace(['\t', '\r', '\n'], " ");
        // 族名不能为空：空行会被卸载器当成"读完了"而提前结束
        let family = if family.trim().is_empty() { f.id.clone() } else { family };
        text.push_str(&family);
        text.push_str("\r\n");
        text.push_str(&dest);
        text.push_str("\r\n");
    }
    let path = app_data_dir.join(UNINSTALL_RECORD_FILE);
    std::fs::create_dir_all(app_data_dir)
        .map_err(|e| format!("创建数据目录失败 {}: {e}", app_data_dir.display()))?;
    std::fs::write(&path, text.as_bytes())
        .map_err(|e| format!("写入卸载记录失败 {}: {e}", path.display()))?;
    Ok(())
}

/// 读安装记录；不存在或损坏时返回 `None`（损坏不该阻塞启动，会重装一遍）。
fn read_install_record(app_data_dir: &Path) -> Option<InstallRecord> {
    let path = app_data_dir.join(INSTALL_RECORD_FILE);
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_install_record(app_data_dir: &Path, record: &InstallRecord) -> Result<(), String> {
    let path = app_data_dir.join(INSTALL_RECORD_FILE);
    std::fs::create_dir_all(app_data_dir)
        .map_err(|e| format!("创建数据目录失败 {}: {e}", app_data_dir.display()))?;
    let text = serde_json::to_string_pretty(record)
        .map_err(|e| format!("序列化安装记录失败：{e}"))?;
    std::fs::write(&path, text.as_bytes())
        .map_err(|e| format!("写入安装记录失败 {}: {e}", path.display()))?;
    Ok(())
}

/// 确保随包字体已安装到本用户。
///
/// `fonts_dir`：资源目录下的 `fonts/`（含 `fonts-manifest.json` 与字体文件）。
/// `app_data_dir`：用于持久化安装记录与卸载记录。
pub fn ensure_fonts_installed(fonts_dir: &Path, app_data_dir: &Path) -> InstallReport {
    let mut report = InstallReport::default();

    let manifest = match read_manifest(fonts_dir) {
        Ok(Some(m)) => m,
        Ok(None) => return report, // 没有清单：本次构建不带字体，不是错误
        Err(e) => {
            report.error = Some(e);
            return report;
        }
    };
    if manifest.fonts.is_empty() {
        return report;
    }

    // 先清点随包文件本身的完整性：文件坏了就没必要往下装，
    // 装了也只会得到一个"能选中但不好看"的坏族
    report.problems = verify_manifest_files(fonts_dir, &manifest);

    let dest_dir = match user_font_dir() {
        Ok(d) => d,
        Err(e) => {
            report.error = Some(e);
            return report;
        }
    };

    // 快速路径：记录与清单一致且每个目标文件大小相符 → 全部 already
    let previous = read_install_record(app_data_dir);
    let mut record = InstallRecord {
        manifest_version: manifest.manifest_version,
        installed: Vec::new(),
    };
    let mut any_change = false;

    for entry in &manifest.fonts {
        let src = fonts_dir.join(&entry.file);
        let dest = dest_dir.join(&entry.file);
        let reg_name = registry_value_name(&entry.family);

        // 记录里已有同 id 且大小一致、目标文件也在 → 走快速路径
        let recorded_ok = previous
            .as_ref()
            .filter(|p| p.manifest_version == manifest.manifest_version)
            .and_then(|p| p.installed.iter().find(|f| f.id == entry.id))
            .filter(|f| f.size_bytes == entry.size_bytes)
            .is_some()
            && std::fs::metadata(&dest).map(|m| m.len() == entry.size_bytes).unwrap_or(false);

        if recorded_ok {
            report.outcomes.push(FontInstallOutcome {
                id: entry.id.clone(),
                display: entry.display.clone(),
                family: entry.family.clone(),
                status: "already".to_string(),
                error: None,
            });
            record.installed.push(RecordedFont {
                id: entry.id.clone(),
                file: entry.file.clone(),
                family: entry.family.clone(),
                dest: dest.to_string_lossy().to_string(),
                reg_value_name: Some(reg_name),
                size_bytes: entry.size_bytes,
            });
            continue;
        }

        // 需要干活：拷贝
        let copied = match copy_if_needed(&src, &dest, entry.size_bytes) {
            Ok(c) => c,
            Err(e) => {
                report.outcomes.push(FontInstallOutcome {
                    id: entry.id.clone(),
                    display: entry.display.clone(),
                    family: entry.family.clone(),
                    status: "failed".to_string(),
                    error: Some(e),
                });
                continue;
            }
        };

        // 注册（仅 Windows 有注册表步骤）
        #[cfg(windows)]
        let registered = match win::register_font(&entry.family, &dest) {
            Ok(changed) => changed,
            Err(e) => {
                report.outcomes.push(FontInstallOutcome {
                    id: entry.id.clone(),
                    display: entry.display.clone(),
                    family: entry.family.clone(),
                    status: "failed".to_string(),
                    error: Some(format!("已拷贝但注册失败：{e}")),
                });
                continue;
            }
        };
        #[cfg(not(windows))]
        let registered = false;

        if copied || registered {
            any_change = true;
        }
        report.outcomes.push(FontInstallOutcome {
            id: entry.id.clone(),
            display: entry.display.clone(),
            family: entry.family.clone(),
            status: if copied || registered { "installed" } else { "already" }.to_string(),
            error: None,
        });
        record.installed.push(RecordedFont {
            id: entry.id.clone(),
            file: entry.file.clone(),
            family: entry.family.clone(),
            dest: dest.to_string_lossy().to_string(),
            reg_value_name: Some(reg_name),
            size_bytes: entry.size_bytes,
        });
    }

    // 记录写失败不该让"字体已装好"这个事实丢失，但必须如实报告
    if let Err(e) = write_install_record(app_data_dir, &record) {
        if report.error.is_none() {
            report.error = Some(e);
        }
    }
    if let Err(e) = write_uninstall_record(app_data_dir, &record) {
        if report.error.is_none() {
            report.error = Some(e);
        }
    }

    #[cfg(windows)]
    if any_change {
        win::broadcast_font_change();
    }
    #[cfg(not(windows))]
    let _ = any_change;

    report
}

/// 清理随包字体的结果。
#[derive(Debug, Clone, Default, Serialize)]
pub struct RemovalReport {
    /// 已删除注册表值的族名。
    pub unregistered: Vec<String>,
    /// 已删除文件的绝对路径。
    pub deleted: Vec<String>,
    /// 未能清理的项及原因。**非空不一定是失败** —— 文件被占用时
    /// Windows 会拒绝删除，此时已登记 `MOVEFILE_DELAY_UNTIL_REBOOT` 之类的
    /// 后续处理由调用方决定；这里如实上报，绝不静默吞掉。
    pub problems: Vec<String>,
}

/// 按安装记录清理本用户的随包字体（注销注册表值 + 删除文件）。
///
/// ── 为什么 Rust 侧也需要这条路径 ──
/// NSIS 卸载器只覆盖安装版。**便携版没有卸载器**，用户删目录就完事，
/// 若只靠 NSIS 清理，便携版用户机器上会永久残留这些字体。
/// 另外这条路径是可测试的，而 NSIS 脚本不可测试。
///
/// ── 顺序（不能颠倒）──
/// 先 `RemoveFontResource` 式的注销（这里等价于删注册表值），再删文件。
/// 反过来的话，注册表里会留下指向不存在文件的悬空值。
pub fn remove_installed_fonts(app_data_dir: &Path) -> RemovalReport {
    let mut report = RemovalReport::default();
    let record = match read_install_record(app_data_dir) {
        Some(r) => r,
        None => return report, // 没有记录 = 没装过，不是错误
    };

    for font in &record.installed {
        // 1) 注销注册表值
        #[cfg(windows)]
        match win::unregister_font(&font.family) {
            Ok(()) => report.unregistered.push(font.family.clone()),
            Err(e) => report.problems.push(format!("注销 {} 失败：{e}", font.family)),
        }
        #[cfg(not(windows))]
        report.unregistered.push(font.family.clone());

        // 2) 删除文件
        let path = PathBuf::from(&font.dest);
        if !path.exists() {
            continue; // 已经不在了，幂等
        }
        match std::fs::remove_file(&path) {
            Ok(()) => report.deleted.push(font.dest.clone()),
            Err(e) => report
                .problems
                .push(format!("删除字体文件失败 {}：{e}", font.dest)),
        }
    }

    #[cfg(windows)]
    if !report.unregistered.is_empty() {
        win::broadcast_font_change();
    }

    // 记录本身要删掉：留着会让下次"确保安装"误以为字体还在
    let record_path = app_data_dir.join(INSTALL_RECORD_FILE);
    if record_path.exists() {
        if let Err(e) = std::fs::remove_file(&record_path) {
            report.problems.push(format!("删除安装记录失败：{e}"));
        }
    }
    let uninstall_path = app_data_dir.join(UNINSTALL_RECORD_FILE);
    if uninstall_path.exists() {
        if let Err(e) = std::fs::remove_file(&uninstall_path) {
            report.problems.push(format!("删除卸载记录失败：{e}"));
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qmai-font-test-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 造一个清单 + 对应大小的假字体文件（内容随便，运行时只看大小）。
    fn fake_bundle(tag: &str, fonts: &[(&str, &str, &str, usize)]) -> (PathBuf, FontManifest) {
        let root = temp_dir(tag);
        let fonts_dir = root.join("fonts");
        fs::create_dir_all(&fonts_dir).unwrap();
        let mut entries = Vec::new();
        for (id, display, family, size) in fonts {
            let file = format!("{id}.ttf");
            fs::write(fonts_dir.join(&file), vec![0u8; *size]).unwrap();
            entries.push(ManifestEntry {
                id: (*id).to_string(),
                display: (*display).to_string(),
                family: (*family).to_string(),
                file,
                size_bytes: *size as u64,
                sha256: "0".repeat(64),
                license_file: Some(format!("licenses/{id}-OFL.txt")),
            });
        }
        let manifest = FontManifest { manifest_version: 1, fonts: entries };
        fs::write(
            fonts_dir.join("fonts-manifest.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();
        (root, manifest)
    }

    #[test]
    fn 没有清单时返回空报告且不算错误() {
        let root = temp_dir("nomanifest");
        let report = ensure_fonts_installed(&root.join("fonts"), &root.join("data"));
        assert!(report.error.is_none(), "没有清单不是错误：{:?}", report.error);
        assert!(report.outcomes.is_empty());
    }

    #[test]
    fn 清单版本不符时报错而不是静默跳过() {
        let root = temp_dir("badversion");
        let fonts_dir = root.join("fonts");
        fs::create_dir_all(&fonts_dir).unwrap();
        fs::write(
            fonts_dir.join("fonts-manifest.json"),
            r#"{"manifestVersion":99,"fonts":[]}"#,
        )
        .unwrap();
        let err = read_manifest(&fonts_dir).unwrap_err();
        assert!(err.contains("99"), "错误信息应含实际版本号：{err}");
    }

    #[test]
    fn 损坏的清单必须报错而不是当成没有清单() {
        // 区分"这次的构建不带字体"与"清单坏了" —— 后者静默跳过会让
        // 随包字体永远装不上，而用户看不到任何提示
        let root = temp_dir("corrupt");
        let fonts_dir = root.join("fonts");
        fs::create_dir_all(&fonts_dir).unwrap();
        fs::write(fonts_dir.join("fonts-manifest.json"), "{ not json").unwrap();
        assert!(read_manifest(&fonts_dir).is_err());
    }

    #[test]
    fn 文件大小不符会被清点出来() {
        let (root, manifest) = fake_bundle("size", &[("a", "甲", "AFont", 128)]);
        let fonts_dir = root.join("fonts");
        // 先确认干净
        assert!(verify_manifest_files(&fonts_dir, &manifest).is_empty());
        // 截断一个字节
        fs::write(fonts_dir.join("a.ttf"), vec![0u8; 127]).unwrap();
        let problems = verify_manifest_files(&fonts_dir, &manifest);
        assert_eq!(problems.len(), 1);
        assert!(problems[0].contains("大小不符"), "{problems:?}");
    }

    #[test]
    fn 缺失文件会被清点出来() {
        let (root, manifest) = fake_bundle("missing", &[("a", "甲", "AFont", 8)]);
        fs::remove_file(root.join("fonts").join("a.ttf")).unwrap();
        let problems = verify_manifest_files(&root.join("fonts"), &manifest);
        assert_eq!(problems.len(), 1);
        assert!(problems[0].contains("不可读"), "{problems:?}");
    }

    #[test]
    fn 注册表值名用英文族名并带真类型后缀() {
        // Windows 对 .otf 也用 (TrueType)，不是 (OpenType) —— 写错会让字体不生效
        assert_eq!(registry_value_name("LXGW WenKai"), "LXGW WenKai (TrueType)");
        assert_eq!(registry_value_name("Source Han Serif SC"), "Source Han Serif SC (TrueType)");
    }

    #[test]
    fn 安装是幂等的_第二次不重复拷贝() {
        let (root, _m) = fake_bundle("idem", &[("a", "甲", "AFont", 64)]);
        let fonts_dir = root.join("fonts");
        let data = root.join("data");

        let src = fonts_dir.join("a.ttf");
        let dest_dir = temp_dir("idem-dest");
        let dest = dest_dir.join("a.ttf");

        assert!(copy_if_needed(&src, &dest, 64).unwrap(), "首次应拷贝");
        assert!(!copy_if_needed(&src, &dest, 64).unwrap(), "第二次应跳过");
        assert_eq!(fs::metadata(&dest).unwrap().len(), 64);

        // 大小不符（模拟被截断）时要重新拷贝
        fs::write(&dest, vec![0u8; 32]).unwrap();
        assert!(copy_if_needed(&src, &dest, 64).unwrap(), "大小不符应重拷");
        assert_eq!(fs::metadata(&dest).unwrap().len(), 64);

        let _ = data;
        let _ = fs::remove_dir_all(&dest_dir);
    }

    #[test]
    fn 半截临时文件不会残留() {
        let (root, _m) = fake_bundle("tmp", &[("a", "甲", "AFont", 64)]);
        let dest_dir = temp_dir("tmp-dest");
        let dest = dest_dir.join("a.ttf");
        copy_if_needed(&root.join("fonts").join("a.ttf"), &dest, 64).unwrap();
        let leftovers: Vec<_> = fs::read_dir(&dest_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "不应残留临时文件：{leftovers:?}");
        let _ = fs::remove_dir_all(&dest_dir);
    }

    /// 把卸载记录按"交替两行"解析回 `(族名, 路径)` 列表。
    /// 这里刻意用与 NSIS 卸载器**相同**的读法（顺序读两行一组），
    /// 于是这个解析函数就是卸载器逻辑的可执行规格：
    /// 它若能正确还原，NSIS 那边的 `FileRead` 两次也就同样能。
    fn parse_uninstall_record(text: &str) -> Vec<(String, String)> {
        let mut out = Vec::new();
        let mut lines = text.split("\r\n").filter(|l| !l.is_empty());
        while let (Some(family), Some(path)) = (lines.next(), lines.next()) {
            out.push((family.to_string(), path.to_string()));
        }
        out
    }

    #[test]
    fn 卸载记录是交替两行且能按卸载器的读法还原() {
        let dir = temp_dir("uninstall");
        let dest_a = r"C:\Users\x\AppData\Local\Microsoft\Windows\Fonts\a.ttf";
        let dest_b = r"C:\Users\x\AppData\Local\Microsoft\Windows\Fonts\b.ttf";
        let record = InstallRecord {
            manifest_version: 1,
            installed: vec![
                RecordedFont {
                    id: "a".into(),
                    file: "a.ttf".into(),
                    family: "AFont".into(),
                    dest: dest_a.into(),
                    reg_value_name: Some("AFont (TrueType)".into()),
                    size_bytes: 64,
                },
                RecordedFont {
                    id: "b".into(),
                    file: "b.ttf".into(),
                    family: "BFont".into(),
                    dest: dest_b.into(),
                    reg_value_name: Some("BFont (TrueType)".into()),
                    size_bytes: 32,
                },
            ],
        };
        write_uninstall_record(&dir, &record).unwrap();
        let text = fs::read_to_string(dir.join(UNINSTALL_RECORD_FILE)).unwrap();

        // 必须 CRLF：NSIS 的 FileRead 按行读，LF-only 会把 \r 读进族名
        assert!(text.contains("\r\n"), "应为 CRLF 换行");
        // **不得有注释行**：一行注释就会让后面全部错位
        assert!(
            !text.lines().any(|l| l.trim_start().starts_with('#')),
            "记录文件不能有注释行（会让族名/路径错位）：{text:?}"
        );
        // 行数必须是偶数（每款字体两行）
        assert_eq!(text.split("\r\n").filter(|l| !l.is_empty()).count(), 4);

        let parsed = parse_uninstall_record(&text);
        assert_eq!(
            parsed,
            vec![
                ("AFont".to_string(), dest_a.to_string()),
                ("BFont".to_string(), dest_b.to_string()),
            ]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 族名含制表符换行或为空时不会破坏交替行结构() {
        // 族名来自字体文件，理论上是不可信输入；一个换行就能让后续行错位，
        // 从而使卸载器删错文件。空族名会被当成"读完了"而提前结束清理。
        let dir = temp_dir("evilname");
        let record = InstallRecord {
            manifest_version: 1,
            installed: vec![
                RecordedFont {
                    id: "evil".into(),
                    file: "a.ttf".into(),
                    family: "Evil\tName\nX\r\nY".into(),
                    dest: "/tmp/a.ttf".into(),
                    reg_value_name: None,
                    size_bytes: 1,
                },
                RecordedFont {
                    id: "empty".into(),
                    file: "b.ttf".into(),
                    family: "   ".into(),
                    dest: "/tmp/b.ttf".into(),
                    reg_value_name: None,
                    size_bytes: 1,
                },
            ],
        };
        write_uninstall_record(&dir, &record).unwrap();
        let text = fs::read_to_string(dir.join(UNINSTALL_RECORD_FILE)).unwrap();
        let parsed = parse_uninstall_record(&text);
        assert_eq!(parsed.len(), 2, "必须仍然是两组：{parsed:?}");
        assert_eq!(parsed[0].1, "/tmp/a.ttf");
        assert_eq!(parsed[1].1, "/tmp/b.ttf");
        // 空族名回退到 id，绝不能是空行
        assert_eq!(parsed[1].0, "empty", "空族名应回退到 id");
        assert!(!parsed[0].0.contains('\n'), "换行必须被剥掉");
        assert!(!parsed[0].0.contains('\t'), "制表符必须被剥掉");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 安装记录可往返() {
        let dir = temp_dir("record");
        let record = InstallRecord {
            manifest_version: 1,
            installed: vec![RecordedFont {
                id: "a".into(),
                file: "a.ttf".into(),
                family: "AFont".into(),
                dest: "/tmp/a.ttf".into(),
                reg_value_name: Some("AFont (TrueType)".into()),
                size_bytes: 7,
            }],
        };
        write_install_record(&dir, &record).unwrap();
        let back = read_install_record(&dir).expect("应能读回");
        assert_eq!(back.installed.len(), 1);
        assert_eq!(back.installed[0].family, "AFont");
        assert_eq!(back.installed[0].size_bytes, 7);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 损坏的安装记录返回空而不是崩溃() {
        let dir = temp_dir("badrecord");
        fs::write(dir.join(INSTALL_RECORD_FILE), "{{{").unwrap();
        assert!(read_install_record(&dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 摘要如实反映各类计数() {
        let mut report = InstallReport::default();
        for (status, n) in [("installed", 2), ("already", 3), ("failed", 1)] {
            for _ in 0..n {
                report.outcomes.push(FontInstallOutcome {
                    id: "x".into(),
                    display: "某字体".into(),
                    family: "X".into(),
                    status: status.into(),
                    error: None,
                });
            }
        }
        assert_eq!(report.installed(), 2);
        assert_eq!(report.already(), 3);
        assert_eq!(report.failed(), 1);
        let s = report.summary();
        assert!(s.contains("新装 2"), "{s}");
        assert!(s.contains("已就位 3"), "{s}");
        assert!(s.contains("失败 1"), "{s}");
    }

    #[test]
    fn 带错误的摘要不谎称已安装() {
        let report = InstallReport {
            outcomes: Vec::new(),
            error: Some("清单坏了".into()),
            problems: Vec::new(),
        };
        let s = report.summary();
        assert!(s.contains("未安装"), "{s}");
        assert!(s.contains("清单坏了"), "{s}");
    }

    #[test]
    fn 摘要会带上文件异常处数() {
        let report = InstallReport {
            outcomes: Vec::new(),
            error: None,
            problems: vec!["a.ttf 大小不符".into(), "b.ttf 不可读".into()],
        };
        let s = report.summary();
        assert!(s.contains("文件异常 2 处"), "{s}");
    }

    #[test]
    fn 没有安装记录时清理是空操作而不是报错() {
        let dir = temp_dir("norecord");
        let report = remove_installed_fonts(&dir);
        assert!(report.problems.is_empty(), "{:?}", report.problems);
        assert!(report.deleted.is_empty());
        assert!(report.unregistered.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 清理会删除已记录的文件并移除记录本身() {
        let dir = temp_dir("cleanup");
        // 造两个"已安装"的文件
        let f1 = dir.join("installed-a.ttf");
        let f2 = dir.join("installed-b.ttf");
        fs::write(&f1, b"x").unwrap();
        fs::write(&f2, b"y").unwrap();
        let record = InstallRecord {
            manifest_version: 1,
            installed: vec![
                RecordedFont {
                    id: "a".into(),
                    file: "a.ttf".into(),
                    family: "AFont".into(),
                    dest: f1.to_string_lossy().to_string(),
                    reg_value_name: None,
                    size_bytes: 1,
                },
                RecordedFont {
                    id: "b".into(),
                    file: "b.ttf".into(),
                    family: "BFont".into(),
                    dest: f2.to_string_lossy().to_string(),
                    reg_value_name: None,
                    size_bytes: 1,
                },
            ],
        };
        write_install_record(&dir, &record).unwrap();
        write_uninstall_record(&dir, &record).unwrap();

        let report = remove_installed_fonts(&dir);
        assert!(report.problems.is_empty(), "{:?}", report.problems);
        assert_eq!(report.deleted.len(), 2);
        assert_eq!(report.unregistered.len(), 2);
        assert!(!f1.exists(), "文件 a 应被删除");
        assert!(!f2.exists(), "文件 b 应被删除");
        // 记录必须一起删掉，否则下次"确保安装"会误判为已就位
        assert!(!dir.join(INSTALL_RECORD_FILE).exists(), "安装记录应被删除");
        assert!(!dir.join(UNINSTALL_RECORD_FILE).exists(), "卸载记录应被删除");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 清理对已经消失的文件是幂等的() {
        let dir = temp_dir("cleanup-missing");
        let record = InstallRecord {
            manifest_version: 1,
            installed: vec![RecordedFont {
                id: "a".into(),
                file: "a.ttf".into(),
                family: "AFont".into(),
                dest: dir.join("never-existed.ttf").to_string_lossy().to_string(),
                reg_value_name: None,
                size_bytes: 1,
            }],
        };
        write_install_record(&dir, &record).unwrap();
        let report = remove_installed_fonts(&dir);
        // 文件本就不在 → 不算 problem（幂等），也不记为已删除
        assert!(report.problems.is_empty(), "{:?}", report.problems);
        assert!(report.deleted.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 文件大小与清单不符时会在报告里出现() {
        // 端到端：清单说 128 字节，实际写 8 字节
        let (root, _m) = fake_bundle("report-problems", &[("a", "甲", "AFont", 128)]);
        fs::write(root.join("fonts").join("a.ttf"), vec![0u8; 8]).unwrap();
        let report = ensure_fonts_installed(&root.join("fonts"), &root.join("data"));
        assert_eq!(report.problems.len(), 1, "{:?}", report.problems);
        assert!(report.summary().contains("文件异常 1 处"), "{}", report.summary());
        let _ = fs::remove_dir_all(&root);
    }
}
