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
    /// 字重（400 = Regular，700 = Bold）。
    ///
    /// 参与拼注册表值名，见 `registry_value_name`：同一族的 Regular 与 Bold
    /// 必须有**不同**的值名，否则会互相覆盖、丢掉一档字重。
    /// 这个值不是猜的：`fonts.rs` 里有一条测试用 DirectWrite 读文件自报的字重
    /// 与它比对，写错会直接失败。
    #[serde(default = "default_weight")]
    pub weight: u32,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
    pub sha256: String,
    #[serde(rename = "licenseFile", default)]
    pub license_file: Option<String>,
}

/// 省略 `weight` 时按 Regular 处理（老清单没有这个字段）。
fn default_weight() -> u32 {
    400
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
///
/// ── 为什么必须带上字重（这是一个真实缺陷的修复）──
/// 值名是系统字体表里**每一项的唯一键**。只用族名的话，同一族的多个字重会
/// 撞在同一个键上：后写的覆盖先写的，于是**磁盘上有那个文件、系统里却没有
/// 那一档字重**。实测（`诊断_列出某族实际可用的字重`）：
/// 两个文件都在用户字体目录、只写一个值名时，该族可用字重只有 `[700]`；
/// 写成两个不同值名后变成 `[400, 700]`。也就是说，加一个字重而值名不变，
/// 等于白装一个文件 —— 而用户只会看到"加粗没变化"，几乎不可能归因到注册表键。
///
/// ── 命名规则对齐 Windows 自身 ──
/// 机器上 Windows 自己装出来的值名可佐证：
/// `Noto Sans SC (TrueType)` / `Noto Sans SC Bold (TrueType)` /
/// `Noto Sans SC Medium (TrueType)`、`Source Han Serif SC Heavy (TrueType)`。
/// 即 Regular（400）**不带**字重后缀，其余带上。遵循这个规则还有一个好处：
/// 已有单字重字体的值名保持不变，升级时不会留下一批指向旧名字的孤儿键。
fn registry_value_name(family: &str, weight: u32) -> String {
    match weight_style_suffix(weight) {
        Some(style) => format!("{family} {style} (TrueType)"),
        None => format!("{family} (TrueType)"),
    }
}

/// 字重对应的后缀名；Regular（400）没有后缀（对齐 Windows 的命名习惯）。
///
/// 名称取自 DirectWrite 的 `DWRITE_FONT_WEIGHT` 取值表。用不到的名字也一并列出，
/// 免得日后加字重的人以为"这里只支持 400/700"而去另写一份映射。
fn weight_style_suffix(weight: u32) -> Option<String> {
    let name = match weight {
        100 => "Thin",
        200 => "ExtraLight",
        300 => "Light",
        350 => "SemiLight",
        400 => return None, // Regular 不带后缀
        500 => "Medium",
        600 => "SemiBold",
        700 => "Bold",
        800 => "ExtraBold",
        900 => "Black",
        // 非标准字重：用数值本身，保证仍然唯一（宁可名字不好看，也不能重名）
        other => return Some(format!("W{other}")),
    };
    Some(name.to_string())
}

/// 供 `fonts.rs` 的清单级不变式测试复用拼名规则。
///
/// 为什么暴露而不是让测试自己再写一份映射：这个映射一旦在两处存在，
/// 加字重时就一定会有一处忘了改，而失败方式恰好是"值名重复"这种
/// 肉眼看不出来的问题。让两边共用同一个实现，漂移就不可能发生。
#[cfg(test)]
pub fn registry_value_name_for_test(family: &str, weight: u32) -> String {
    registry_value_name(family, weight)
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
    /*
     * 这里**故意不**引 `registry_value_name`：
     * 值名由上一层算好后作为参数传进来（`register_font(value_name, dest)`），
     * 这样"值名如何保证唯一"这件事只有一个地方需要想清楚。
     * 早先这一层自己从族名拼值名，加入字重时就成了同族字重互相覆盖的根源。
     */
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
    /// `value_name` 是**完整的注册表值名**（由 `registry_value_name` 算好），
    /// 不是族名 —— 值名里已经含了字重，这一层不该再关心字重怎么拼。
    /// 分开的理由：值名的唯一性是这个模块的职责，
    /// 而这里只负责"把名字写到指向这个路径"。
    ///
    /// 返回 `Ok(true)` 表示确实写入了（用于决定要不要广播 `WM_FONTCHANGE`）。
    pub fn register_font(value_name: &str, dest: &Path) -> Result<bool, String> {
        // 必须是绝对路径：裸文件名只对 HKLM/%windir%\Fonts 成立（已实测）
        let abs = std::fs::canonicalize(dest).unwrap_or_else(|_| dest.to_path_buf());
        let abs_str = abs.to_string_lossy().to_string();
        let key = open_font_key()?;
        let result = (|| -> Result<bool, String> {
            if let Some(current) = read_value(key, value_name)? {
                if current.eq_ignore_ascii_case(&abs_str) {
                    return Ok(false);
                }
            }
            write_value(key, value_name, &abs_str)?;
            Ok(true)
        })();
        unsafe {
            let _ = RegCloseKey(key);
        }
        result
    }

    /// 注销一个字体（卸载清理用）。入参是完整注册表值名，同 `register_font`。
    pub fn unregister_font(value_name: &str) -> Result<(), String> {
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
            let name_h = HSTRING::from(value_name);
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

/// 取路径的最后一段（同时按 `\` 与 `/` 切分，与 NSIS 的处理一致）。
///
/// 刻意**不用** `std::path::Path::file_name()`：它在非 Windows 上不把 `\` 当
/// 分隔符，而这些记录里存的永远是 Windows 路径，而单元测试可能在别的平台上跑；
/// 那样同一份记录在不同平台上会被解释成不同的文件名。
fn last_component(p: &str) -> &str {
    p.rsplit(['\\', '/']).next().unwrap_or("")
}

/// 算出卸载记录第 2 行要写的**纯文件名**（不含目录）。
///
/// 抽成独立函数是因为兜底链有三层，塞进 `write_uninstall_record` 的循环里会让
/// "第 2 行绝不能为空"这条不变量淹没在缩进里 —— 而它一旦被破坏（写出空行），
/// NSIS 侧的 `StrCmp $R3 "" qmai_fonts_close` 就会**提前结束整个清理循环**，
/// 后面所有字体都不会被清理，且没有任何报错。
fn record_file_name(f: &RecordedFont) -> String {
    let sanitize = |s: &str| s.replace(['\t', '\r', '\n'], " ");
    // `.` / `..` / 空串拼出去会指向目录而不是文件，一律不接受
    let usable = |s: String| match s.trim() {
        "" | "." | ".." => None,
        _ => Some(s),
    };
    /*
     * 优先取 `dest` 的最后一段，而不是直接信任 `f.file`：
     * `dest` 才是"实际装到哪里"的唯一凭据，Rust 侧的 `remove_installed_fonts`
     * 也是按它删的。两边同源，就不会出现"Rust 删 A、NSIS 删 B"这种
     * 只在用户卸载时才暴露的分歧。
     * 取"最后一段"同时也消掉了目录穿越（`..\..\x` → `x`）。
     */
    for cand in [
        sanitize(last_component(&f.dest)),
        sanitize(last_component(&f.file)),
    ] {
        if let Some(ok) = usable(cand) {
            return ok;
        }
    }
    let from_id = sanitize(&f.id);
    if !from_id.trim().is_empty() {
        return from_id;
    }
    // 记录整条都坏了。给一个删不掉任何真实文件的名字，但**必须非空**。
    "qmai-unknown-font".to_string()
}

/// 写卸载器要读的纯文本记录：**每两项一组，交替两行** ——
/// 第 1 行**注册表值名**（含 `(TrueType)` 后缀与字重），第 2 行**纯文件名**。
///
/// ── 为什么第 1 行是值名而不是族名 ──
/// NSIS 那边执行的是 `DeleteRegValue HKCU <字体键> "$R2"`，需要一个**完整的**
/// 值名。早先这里写族名、由 NSIS 自己拼 `" (TrueType)"`；加入字重后值名变成
/// `"<族名> Bold (TrueType)"`，拼接逻辑分散在两处就一定会有一处忘了改。
/// 现在记录里直接写完整值名，NSIS 原样使用，规则只存在于
/// `registry_value_name` 一个地方。
///
/// ── 为什么第 2 行是**文件名**而不是绝对路径（实测出来的坑）──
/// NSIS 的 `FileRead` 按**系统 ANSI 代码页**解码，而且**不认 BOM**。
/// 在 `verify-nsis-font-cleanup.mjs --e2e` 的编码矩阵上实测：
///   · UTF-8 无 BOM：只有内容全是 ASCII 时才对（ASCII 与 ANSI 字节相同）
///   · UTF-8 带 BOM：多出一个 `U+FEFF`（BOM 被当成正文，不剥离）
///   · UTF-16LE（带/不带 BOM）：直接读断（`0x00` 被当成字符串结束）
/// 而本文件由 Rust 以 UTF-8 写出。真实清单里的族名与文件名**全是 ASCII**
/// （由 `清单里的族名与文件名必须全是ASCII` 钉住），所以唯一可能带非 ASCII 的
/// 就是路径前缀 `%LOCALAPPDATA%` —— 中文 Windows 用户名会让它变成
/// `C:\Users\张三\AppData\Local`。那种机器上卸载器拿到的是乱码路径，
/// 而 `Delete` 对不存在的路径**静默成功**：字体永久残留，且没有任何报错。
///
/// 只写文件名之后，文件内容就是**纯 ASCII**，编码差异不再有任何影响；
/// 绝对路径改由 NSIS 用 `$LOCALAPPDATA\Microsoft\Windows\Fonts` 现场拼出，
/// 那一侧是原生 Unicode，中文用户名完全没问题。
/// 前提是 `dest` 恒等于 `<字体目录>\<文件名>` —— 由 `install_into` 的
/// `dest_dir.join(&entry.file)` 保证，并有测试钉住。
///
/// ── 为什么不用 `值名<TAB>文件名` 一行一项 ──
/// NSIS 核心指令里没有"查找子串"，一行两项就必须引 `StrFunc.nsh` 的 `${StrLoc}`
/// 做下标运算（先找 TAB 位置、再 `IntOp` 加一、再按偏移取子串）。
/// 交替两行只需要 `FileRead` 两次，全是核心指令。
/// 卸载器是**装完就再也不会被测试**的那类代码，减少它对语法细节的依赖比
/// 让文件好看一点重要得多。
///
/// ── 因此这个文件**不能有注释行** ──
/// 一行注释就会让后面所有行错位（值名位置读到文件名）。格式说明放在此处与
/// `docs/font-scaling-fix-20261007/` 里，不放在数据文件里。
fn write_uninstall_record(app_data_dir: &Path, record: &InstallRecord) -> Result<(), String> {
    let mut text = String::new();
    for f in &record.installed {
        // 值名/路径都来自字体文件与文件系统，理论上是不可信输入：
        // 一个换行就能让后续所有行错位，从而删错文件、删错注册表值。必须剥掉。
        let value_name = match f.reg_value_name.clone() {
            Some(n) => n,
            None => {
                /*
                 * 老记录没有值名字段：按当时的规则（族名 + Regular）重拼。
                 * 族名是空白的就退回 id，而不是拼出 `" (TrueType)"` —— 那种名字
                 * 删不掉任何真实存在的键，却会让结构看起来正常，
                 * 从而把"这条记录已损坏"这件事掩盖过去。
                 */
                if f.family.trim().is_empty() {
                    f.id.clone()
                } else {
                    registry_value_name(&f.family, 400)
                }
            }
        };
        let value_name = value_name.replace(['\t', '\r', '\n'], " ");
        // 值名不能为空：空行会被卸载器当成"读完了"而提前结束
        let value_name = if value_name.trim().is_empty() {
            f.id.clone()
        } else {
            value_name
        };
        // 第 2 行只写文件名（见上方关于编码的说明），且保证非空
        let file_name = record_file_name(f);
        text.push_str(&value_name);
        text.push_str("\r\n");
        text.push_str(&file_name);
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

/// 把一个族名注册到系统字体表；返回是否**确实写入**（用于决定要不要广播
/// `WM_FONTCHANGE`）。幂等：值已指向同一路径时应返回 `Ok(false)`。
///
/// 抽成类型别名是为了让 `install_into` 可以在测试里注入一个不碰真实注册表的
/// 实现 —— 见 `install_into` 的注释。
type RegisterFn = dyn Fn(&str, &Path) -> Result<bool, String>;

/// 真实的注册动作（Windows 写 HKCU 注册表；其他平台无此概念）。
#[cfg(windows)]
fn system_register(family: &str, dest: &Path) -> Result<bool, String> {
    win::register_font(family, dest)
}

/// 非 Windows 平台没有 HKCU 字体注册表，等价于"无需注册"。
#[cfg(not(windows))]
fn system_register(_family: &str, _dest: &Path) -> Result<bool, String> {
    Ok(false)
}

/// 确保随包字体已安装到本用户。
///
/// `fonts_dir`：资源目录下的 `fonts/`（含 `fonts-manifest.json` 与字体文件）。
/// `app_data_dir`：用于持久化安装记录与卸载记录。
pub fn ensure_fonts_installed(fonts_dir: &Path, app_data_dir: &Path) -> InstallReport {
    let dest_dir = match user_font_dir() {
        Ok(d) => d,
        Err(e) => {
            let mut report = InstallReport::default();
            report.error = Some(e);
            return report;
        }
    };
    install_into(fonts_dir, app_data_dir, &dest_dir, &system_register)
}

/// `ensure_fonts_installed` 的可测试内核。
///
/// ── 为什么要把目标目录与注册动作做成参数 ──
/// 这条逻辑真正危险的部分是它的**副作用**：往用户字体目录写文件、写注册表。
/// 若测试直接调 `ensure_fonts_installed`，就会在开发机上留下真实的字体文件与
/// 注册表值 —— 本仓库的测试确实这么干过，结果是把一个 8 字节的假字体
/// `a.ttf` 留在真实用户字体目录里，并写进 `AFont (TrueType)` 注册表值；
/// 那个假族名会一直存在于系统的字体表里。
/// 把两者变成参数后，测试用临时目录 + 假的注册函数，既能覆盖全部分支，
/// 又不动开发机一根毫毛。
fn install_into(
    fonts_dir: &Path,
    app_data_dir: &Path,
    dest_dir: &Path,
    register: &RegisterFn,
) -> InstallReport {
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

    /*
     * ── 为什么不拿"上一次的安装记录"当作可以跳过的依据 ──
     *
     * 记录文件只是一份**缓存**，而"字体到底能不能用"取决于两件外部事实：
     * ① 目标字体文件在、且大小对；② 注册表值在、且指向它。两者都可能被外部
     * 单方面改动（杀毒、注册表清理工具、用户手改），而缓存不会知道。
     *
     * 曾经这里有过一条快速路径："记录里有同 id 且大小一致、目标文件也在"
     * 就直接记为 already 并 `continue`。那条路径**不看注册表**，于是：
     * 文件在、注册表值被清掉 → 每次启动都判 already → 注册表永远补不回来
     * → 字体永远不出现在任何字体列表里，而记录显示一切正常。
     * 这正是本次要根除的"选了没反应"，而且是**永久性**的、不会自愈。
     *
     * 现在的做法：拷不拷由 `copy_if_needed` 按大小判断（那才是真正贵的操作，
     * 168MB 不该每次重拷）；注册**每次都调** —— `register_font` 本身幂等，
     * 值已正确时返回 false 且不写。代价是每次启动 10 次注册表读，微秒级。
     * 以事实为准，比以缓存为准多花的那点开销远远值得。
     */
    let previous = read_install_record(app_data_dir);
    let mut record = InstallRecord {
        manifest_version: manifest.manifest_version,
        installed: Vec::new(),
    };
    let mut any_change = false;

    for entry in &manifest.fonts {
        let src = fonts_dir.join(&entry.file);
        let dest = dest_dir.join(&entry.file);
        let reg_name = registry_value_name(&entry.family, entry.weight);

        // 拷贝是真正贵的操作（单个 5–35MB），由大小一致来跳过
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

        /*
         * 注册**每次都调**，不看"上次的记录说已经装过了"。
         * 理由见上方那段长注释：注册表值可能被外部清掉，而记录不会知道；
         * 漏掉这一次注册，字体就会永久消失且不会自愈。
         * `register` 是注入的，生产环境即 `win::register_font`（幂等）。
         * 传入的是**值名**（含字重），不是族名 —— 否则同族字重会互相覆盖。
         */
        let registered = match register(&reg_name, &dest) {
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

        if copied || registered {
            any_change = true;
        }
        report.outcomes.push(FontInstallOutcome {
            id: entry.id.clone(),
            display: entry.display.clone(),
            family: entry.family.clone(),
            // 报了 failed 的项在上面已 continue，能走到这里就是真的装好了
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

    /*
     * ── 本次构建不再随包的字体：保留在记录里，但不主动删除 ──
     *
     * 若某个 id 出现在上一次记录里、却不在本次清单里（例如以后把清单从 10 款
     * 精简到 7 款），那个字体已经在用户机器上了。这里**不做**运行时删除，两个原因：
     *   ① 记录文件是可被外部改写的（磁盘损坏、用户手改）。拿它里面的路径去
     *      `remove_file`，等于让一个数据文件决定删哪个文件。风险与收益不成比例。
     *   ② 一次性安装/卸载不该在"启动应用"这条路径上发生 —— 用户下次开机、
     *      或文件被占用时，行为都难以预测。
     *
     * 但也不能直接丢掉：那样它就**永远不会被清理**了。所以把它原样带进新记录，
     * 卸载器（NSIS 段与 `remove_installed_fonts`）仍会照单清理，同时如实记进
     * `problems`，让"有一款旧字体还留在机器上"这件事在日志里可见 ——
     * 静默保留正是"看得见但没人管"的来源。
     *
     * ⚠️ 这段**必须写在下面两个 write_* 之前**。写在后面的话，
     * 补进 `record.installed` 的条目根本不会被持久化 —— 表现就是
     * "上报了有一款旧字体，但记录里没有它"，于是它照样永远不会被清理。
     * （这条顺序曾经写反过，是测试 `清单缩小后旧字体仍留在记录里以便日后清理`
     * 抓出来的。）
     */
    if let Some(prev) = &previous {
        if prev.manifest_version == manifest.manifest_version {
            for old in &prev.installed {
                if manifest.fonts.iter().any(|e| e.id == old.id) {
                    continue; // 本次仍随包，已在上面处理
                }
                report.problems.push(format!(
                    "随包清单已不再包含 {id}（{family}），但用户机器上仍有该字体；\
                     已保留在卸载记录中，将在卸载时清理：{dest}",
                    id = old.id,
                    family = old.family,
                    dest = old.dest
                ));
                record.installed.push(old.clone());
            }
        }
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
        /*
         * 用记录里存下的**值名**注销，而不是用族名重新拼一个。
         * 记录是"我们当初写了什么"的唯一凭据：万一命名规则以后再变，
         * 按规则重拼会去删一个不存在的名字，同时把真正写下的那个名字留成孤儿。
         * 老记录没有这个字段，退回按族名 + Regular 规则拼（当时的规则）。
         */
        let value_name = font
            .reg_value_name
            .clone()
            .unwrap_or_else(|| registry_value_name(&font.family, 400));

        // 1) 注销注册表值
        #[cfg(windows)]
        match win::unregister_font(&value_name) {
            Ok(()) => report.unregistered.push(value_name.clone()),
            Err(e) => report.problems.push(format!("注销 {value_name} 失败：{e}")),
        }
        #[cfg(not(windows))]
        report.unregistered.push(value_name.clone());

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
    ///
    /// 元组是 `(id, display, family, weight, size)`。`weight` 是显式参数而不是
    /// 默认 400：本文件最要紧的一条不变式就是"同族不同字重必须有不同值名"，
    /// 而那条不变式只有能造出**同族两个字重**才测得出来。
    fn fake_bundle(tag: &str, fonts: &[(&str, &str, &str, u32, usize)]) -> (PathBuf, FontManifest) {
        let root = temp_dir(tag);
        let fonts_dir = root.join("fonts");
        fs::create_dir_all(&fonts_dir).unwrap();
        let mut entries = Vec::new();
        for (id, display, family, weight, size) in fonts {
            let file = format!("{id}.ttf");
            fs::write(fonts_dir.join(&file), vec![0u8; *size]).unwrap();
            entries.push(ManifestEntry {
                id: (*id).to_string(),
                display: (*display).to_string(),
                family: (*family).to_string(),
                file,
                weight: *weight,
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
        let (root, manifest) = fake_bundle("size", &[("a", "甲", "AFont", 400, 128)]);
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
        let (root, manifest) = fake_bundle("missing", &[("a", "甲", "AFont", 400, 8)]);
        fs::remove_file(root.join("fonts").join("a.ttf")).unwrap();
        let problems = verify_manifest_files(&root.join("fonts"), &manifest);
        assert_eq!(problems.len(), 1);
        assert!(problems[0].contains("不可读"), "{problems:?}");
    }

    #[test]
    fn 注册表值名用英文族名并带真类型后缀() {
        // Windows 对 .otf 也用 (TrueType)，不是 (OpenType) —— 写错会让字体不生效
        assert_eq!(
            registry_value_name("LXGW WenKai", 400),
            "LXGW WenKai (TrueType)"
        );
        assert_eq!(
            registry_value_name("Source Han Serif SC", 400),
            "Source Han Serif SC (TrueType)"
        );
    }

    /// Regular 不带字重后缀、其余带上 —— 对齐 Windows 自身的命名习惯
    /// （`Noto Sans SC (TrueType)` / `Noto Sans SC Bold (TrueType)`）。
    /// 让 Regular 不带后缀还有一个实际好处：已有单字重字体的值名保持不变，
    /// 升级时不会留下一批指向旧名字的孤儿键。
    #[test]
    fn 注册表值名_常规字重不带后缀_其他字重带后缀() {
        assert_eq!(
            registry_value_name("Source Han Serif SC", 400),
            "Source Han Serif SC (TrueType)"
        );
        assert_eq!(
            registry_value_name("Source Han Serif SC", 700),
            "Source Han Serif SC Bold (TrueType)"
        );
        assert_eq!(
            registry_value_name("X", 300),
            "X Light (TrueType)"
        );
        assert_eq!(registry_value_name("X", 500), "X Medium (TrueType)");
        assert_eq!(registry_value_name("X", 900), "X Black (TrueType)");
    }

    /// 非标准字重也必须得到**唯一**的名字。
    ///
    /// 这里刻意不写 `_ => panic!()`：真遇到 250 这种字重时，崩掉不如给出
    /// 一个唯一且可读的名字。要守住的是唯一性，不是"只允许标准字重"。
    #[test]
    fn 非标准字重的值名仍然唯一且非空() {
        let a = registry_value_name("X", 250);
        let b = registry_value_name("X", 260);
        assert_ne!(a, b, "不同非标准字重必须得到不同值名");
        assert!(a.contains("250"), "应能看出是哪个字重：{a}");
        assert!(a.ends_with("(TrueType)"), "{a}");
    }

    /// **同族多字重不得撞在同一个值名上** —— 这条是本轮真实缺陷的回归测试。
    ///
    /// 症状与根因：值名是系统字体表里的唯一键，只用族名拼的话，同族的
    /// Regular 与 Bold 会互相覆盖 —— 磁盘上多一个文件、系统里少一档字重。
    /// 实测该族可用字重会只剩 `[700]`（见 `fonts.rs` 的
    /// `诊断_列出某族实际可用的字重`）。用户看到的是"加粗没变化"。
    #[test]
    fn 同一族的两个字重必须得到不同的值名() {
        let regular = registry_value_name("Source Han Serif SC", 400);
        let bold = registry_value_name("Source Han Serif SC", 700);
        assert_ne!(
            regular, bold,
            "同族 Regular 与 Bold 的值名相同，后者会覆盖前者、丢掉一档字重"
        );
    }

    /// 走完整安装流程，断言写下的两个值名不同、且都被记进记录。
    ///
    /// 只测 `registry_value_name` 是不够的：真正要守住的是"安装时**确实**
    /// 用了不同的名字"。这里用一个会记录自己被调用参数列表的假注册函数，
    /// 直接检查实际传入的值名，而不是复算一遍期望值。
    #[test]
    fn 安装同族两个字重时_实际传入的值名互不相同() {
        use std::cell::RefCell;
        use std::rc::Rc;
        let (root, _m) = fake_bundle(
            "two-weights",
            &[
                ("serif", "思源宋体", "Source Han Serif SC", 400, 32),
                ("serif-bold", "思源宋体 Bold", "Source Han Serif SC", 700, 48),
            ],
        );
        let fonts_dir = root.join("fonts");
        let data_dir = root.join("data");
        let dest_dir = root.join("dest");
        fs::create_dir_all(&dest_dir).unwrap();

        /*
         * 用 `Rc<RefCell<..>>` 而不是借用 `seen`：
         * `install_into` 收的是 `&RegisterFn`，而 `RegisterFn` 这个类型别名会
         * 擦成 `dyn Fn + 'static`，所以闭包必须 `move` 且不能借外部栈变量。
         * 用共享所有权既满足 'static，又能在调用后读回记录。
         */
        let seen = Rc::new(RefCell::new(Vec::<String>::new()));
        let seen_in_closure = Rc::clone(&seen);
        let record_register = move |name: &str, _dest: &Path| -> Result<bool, String> {
            seen_in_closure.borrow_mut().push(name.to_string());
            Ok(true)
        };

        let report = install_into(&fonts_dir, &data_dir, &dest_dir, &record_register);
        assert_eq!(report.outcomes.len(), 2, "{:?}", report.outcomes);
        assert_eq!(report.failed(), 0, "{:?}", report.outcomes);

        let names = seen.borrow().clone();
        assert_eq!(names.len(), 2, "两个字重都应被注册：{names:?}");
        assert_ne!(
            names[0], names[1],
            "两个字重被注册到同一个值名，其中一个会被覆盖：{names:?}"
        );
        assert!(names.iter().any(|n| n.contains("Bold")), "{names:?}");

        // 记录里也必须保留各自的值名，否则卸载时会漏删一个
        let rec = read_install_record(&data_dir).expect("记录应存在");
        let recorded: Vec<String> = rec
            .installed
            .iter()
            .filter_map(|f| f.reg_value_name.clone())
            .collect();
        assert_eq!(recorded.len(), 2, "{recorded:?}");
        assert_ne!(recorded[0], recorded[1], "{recorded:?}");
    }

    #[test]
    fn 安装是幂等的_第二次不重复拷贝() {
        let (root, _m) = fake_bundle("idem", &[("a", "甲", "AFont", 400, 64)]);
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
        let (root, _m) = fake_bundle("tmp", &[("a", "甲", "AFont", 400, 64)]);
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
    fn 卸载记录是交替两行且第二行是纯文件名() {
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

        // 必须 CRLF：NSIS 的 FileRead 按行读，LF-only 会把 \r 读进值名
        assert!(text.contains("\r\n"), "应为 CRLF 换行");
        // **不得有注释行**：一行注释就会让后面全部错位
        assert!(
            !text.lines().any(|l| l.trim_start().starts_with('#')),
            "记录文件不能有注释行（会让值名/路径错位）：{text:?}"
        );
        // 行数必须是偶数（每款字体两行）
        assert_eq!(text.split("\r\n").filter(|l| !l.is_empty()).count(), 4);

        /*
         * 第 1 行是**完整注册表值名**（含 `(TrueType)`），不是族名 ——
         * NSIS 直接拿它 `DeleteRegValue`，值名规则只存在于一处。
         * 加入字重后值名会变成 `"<族名> Bold (TrueType)"`，
         * 若这里写族名、由 NSIS 拼后缀，两处规则必然有一天对不上。
         */
        let parsed = parse_uninstall_record(&text);
        assert_eq!(
            parsed,
            vec![
                ("AFont (TrueType)".to_string(), "a.ttf".to_string()),
                ("BFont (TrueType)".to_string(), "b.ttf".to_string()),
            ]
        );
        /*
         * 记录里**不得出现绝对路径**，也不得出现任何非 ASCII。
         *
         * 原因见 `write_uninstall_record` 的文档：NSIS 的 `FileRead` 按系统 ANSI
         * 代码页解码、且不认 BOM，而本文件由 Rust 以 UTF-8 写出。内容全 ASCII 时
         * 两者字节相同才"碰巧"能跑；一旦路径里出现非 ASCII（中文 Windows 用户名
         * → `C:\Users\张三\AppData\Local`），卸载器拿到的是乱码路径，
         * 而 `Delete` 对不存在的路径**静默成功** —— 字体永久残留、没有任何报错。
         */
        assert!(
            text.is_ascii(),
            "记录必须是纯 ASCII，否则中文用户名下 NSIS 会读成乱码：{text:?}"
        );
        for p in [dest_a, dest_b] {
            assert!(
                !text.contains(p),
                "记录里不该出现绝对路径 {p}（目录由 NSIS 用 $LOCALAPPDATA 现场拼）：{text:?}"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// **回归**：路径含非 ASCII（中文 Windows 用户名）时，记录仍必须是纯 ASCII。
    ///
    /// 这是实测出来的真实缺陷，不是假想：`%LOCALAPPDATA%` 在中文用户名下会变成
    /// `C:\Users\张三\AppData\Local`。修好之前，卸载器会拿这个路径按 ANSI 解码，
    /// 得到乱码后 `Delete` 一个不存在的路径并**静默成功** ——
    /// 用户卸载完，字体库里永久留下 11 个字体，且没有任何提示。
    #[test]
    fn 路径含中文时记录仍必须是纯ASCII() {
        let dir = temp_dir("uninstall-cjk");
        let record = InstallRecord {
            manifest_version: 1,
            installed: vec![RecordedFont {
                id: "cjk".into(),
                file: "SourceHanSerifSC-Bold.otf".into(),
                family: "Source Han Serif SC".into(),
                dest: r"C:\Users\张三\AppData\Local\Microsoft\Windows\Fonts\SourceHanSerifSC-Bold.otf"
                    .into(),
                reg_value_name: Some("Source Han Serif SC Bold (TrueType)".into()),
                size_bytes: 1,
            }],
        };
        write_uninstall_record(&dir, &record).unwrap();
        let text = fs::read_to_string(dir.join(UNINSTALL_RECORD_FILE)).unwrap();
        assert!(
            text.is_ascii(),
            "路径含非 ASCII 时记录仍必须全 ASCII（否则 NSIS 读成乱码、字体清不掉）：{text:?}"
        );
        assert_eq!(
            parse_uninstall_record(&text),
            vec![(
                "Source Han Serif SC Bold (TrueType)".to_string(),
                "SourceHanSerifSC-Bold.otf".to_string()
            )],
            "第 2 行必须是纯文件名，这样记录里才不可能出现非 ASCII"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// 第 2 行**在任何损坏输入下都不得为空**。
    ///
    /// NSIS 侧用 `StrCmp $R3 "" qmai_fonts_close` 判断"读完了"，
    /// 所以一个空文件名会让它**提前结束整个清理循环**：后面所有字体都不会被清理，
    /// 而且不会有任何报错。同时文件名里不能残留路径分隔符，
    /// 否则 `"${QMAIFONTDIR}\$R3"` 会拼到字体目录**之外**去删东西。
    #[test]
    fn 记录第二行在任何损坏输入下都不得为空或含分隔符() {
        let cases: Vec<(&str, &str, &str)> = vec![
            ("", "", ""),                        // 整条都空
            (r"C:\a\b.ttf", "", ""),             // 只有 dest
            ("", "b.ttf", ""),                   // 只有 file
            ("", "", "only-id"),                 // 只有 id
            (r"C:\dir\", "x", ""),               // dest 以分隔符结尾 → 取不到文件名
            (r"C:\dir\..\..\evil.exe", "x", ""), // 目录穿越必须被消掉
            (".", "..", ""),                     // 退化成纯分隔符
            ("///", "///", ""),                  // 非 Windows 分隔符
        ];
        for (dest, file, id) in cases {
            let f = RecordedFont {
                id: id.into(),
                file: file.into(),
                family: "F".into(),
                dest: dest.into(),
                reg_value_name: Some("F (TrueType)".into()),
                size_bytes: 1,
            };
            let name = record_file_name(&f);
            assert!(
                !name.trim().is_empty(),
                "dest={dest:?} file={file:?} id={id:?} 算出了空文件名（NSIS 会提前结束清理）"
            );
            assert!(
                !name.contains(['\\', '/']),
                "dest={dest:?} 算出的文件名仍含分隔符：{name:?}（会删到字体目录之外）"
            );
        }
    }

    /// 卸载记录里必须写**带字重的完整值名**，否则卸载时删不掉那个键。
    ///
    /// 这条是加字重时的关键回归点：若记录里只写族名、或写了错的字重后缀，
    /// NSIS 会去删一个不存在的值名 —— 而 `DeleteRegValue` 对不存在的值
    /// **静默成功**，于是卸载后 HKCU 里留下指向已删文件的悬空值，
    /// 没有任何报错。
    #[test]
    fn 卸载记录写的是带字重的完整值名() {
        let dir = temp_dir("uninstall-bold");
        let record = InstallRecord {
            manifest_version: 1,
            installed: vec![RecordedFont {
                id: "serif-bold".into(),
                file: "serif-bold.otf".into(),
                family: "Source Han Serif SC".into(),
                dest: "/tmp/serif-bold.otf".into(),
                reg_value_name: Some("Source Han Serif SC Bold (TrueType)".into()),
                size_bytes: 1,
            }],
        };
        write_uninstall_record(&dir, &record).unwrap();
        let text = fs::read_to_string(dir.join(UNINSTALL_RECORD_FILE)).unwrap();
        let parsed = parse_uninstall_record(&text);
        assert_eq!(
            parsed[0].0, "Source Han Serif SC Bold (TrueType)",
            "必须写完整值名（含字重），而不是族名：{parsed:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 值名含制表符换行或为空时不会破坏交替行结构() {
        // 族名（以及由它拼出的值名）来自字体文件，理论上是不可信输入；
        // 一个换行就能让后续行错位，从而使卸载器删错文件。
        // 空值名会被当成"读完了"而提前结束清理。
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
        // 第 2 行现在是纯文件名（目录由 NSIS 用 $LOCALAPPDATA 现场拼）
        assert_eq!(parsed[0].1, "a.ttf");
        assert_eq!(parsed[1].1, "b.ttf");
        // 空白族名拼不出可用值名，回退到 id，绝不能是空行
        assert_eq!(parsed[1].0, "empty", "空白族名应回退到 id");
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
        let (root, _m) = fake_bundle("report-problems", &[("a", "甲", "AFont", 400, 128)]);
        fs::write(root.join("fonts").join("a.ttf"), vec![0u8; 8]).unwrap();
        let dest = root.join("dest");
        let report = install_into(&root.join("fonts"), &root.join("data"), &dest, &noop_register);
        assert_eq!(report.problems.len(), 1, "{:?}", report.problems);
        assert!(report.summary().contains("文件异常 1 处"), "{}", report.summary());
        let _ = fs::remove_dir_all(&root);
    }

    /// 不碰真实注册表的注册动作，返回"无需写入"。测试里用它隔离副作用。
    fn noop_register(_family: &str, _dest: &Path) -> Result<bool, String> {
        Ok(false)
    }

    /*
     * ── 下面这组测试针对一个真实修掉过的缺陷 ──
     *
     * 旧实现有一条"记录里有同 id、大小一致、目标文件也在 → already 并跳过
     * 注册"的快速路径，它**不看注册表**。于是当文件在、注册表值被清掉时
     * （杀毒软件、注册表清理工具、用户手改都会造成），每次启动都判 already，
     * 注册表永远补不回来 —— 字体永远不出现在字体列表里，而记录一切正常。
     * 这是永久性的、不会自愈的"选了没反应"。
     *
     * 现在的判据是"以事实为准"：拷贝按大小跳过，注册每次都调。
     */
    #[test]
    fn 目标文件已在但注册表缺失时必须重新注册而不是判为已就位() {
        let (root, _m) = fake_bundle("heal-register", &[("a", "甲", "AFont", 400, 16)]);
        let fonts_dir = root.join("fonts");
        let data_dir = root.join("data");
        let dest_dir = root.join("dest");

        // 第一次：正常安装。假注册函数模拟"写入了"。
        let first = install_into(&fonts_dir, &data_dir, &dest_dir, &|_, _| Ok(true));
        assert_eq!(first.installed(), 1, "{:?}", first.outcomes);
        assert!(dest_dir.join("a.ttf").exists(), "应被拷到目标目录");

        // 第二次：文件都还在（会被按大小跳过拷贝），注册函数仍报"写入了"
        // ——模拟"注册表值被外部清掉，必须重写"。
        let second = install_into(&fonts_dir, &data_dir, &dest_dir, &|_, _| Ok(true));
        assert_eq!(
            second.installed(),
            1,
            "注册表缺失时必须重新注册，不能因为文件在就判 already：{:?}",
            second.outcomes
        );
        assert_eq!(second.already(), 0);

        // 第三次：一切正常，注册函数报"无需写入" → 才是真的 already
        let third = install_into(&fonts_dir, &data_dir, &dest_dir, &noop_register);
        assert_eq!(third.already(), 1, "{:?}", third.outcomes);
        assert_eq!(third.installed(), 0, "无变化时不应谎报为已安装");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn 注册失败时如实记为失败并说明已拷贝() {
        let (root, _m) = fake_bundle("register-fail", &[("a", "甲", "AFont", 400, 16)]);
        let dest_dir = root.join("dest");
        let report = install_into(
            &root.join("fonts"),
            &root.join("data"),
            &dest_dir,
            &|_, _| Err("注册表只读".to_string()),
        );
        assert_eq!(report.failed(), 1, "{:?}", report.outcomes);
        let err = report.outcomes[0].error.as_deref().unwrap_or("");
        // 文件确实已经拷过去了，失败原因必须把这一点讲清楚，
        // 否则人会误以为"什么都没做成"而重复排查
        assert!(err.contains("已拷贝"), "错误信息应说明已拷贝：{err}");
        assert!(err.contains("注册表只读"), "应保留原始原因：{err}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn 清单缩小后旧字体仍留在记录里以便日后清理() {
        let (root, _m) = fake_bundle("shrink", &[("a", "甲", "AFont", 400, 16), ("b", "乙", "BFont", 400, 16)]);
        let fonts_dir = root.join("fonts");
        let data_dir = root.join("data");
        let dest_dir = root.join("dest");
        install_into(&fonts_dir, &data_dir, &dest_dir, &noop_register);

        // 模拟新版本只随包 a：重写清单
        let manifest: FontManifest =
            serde_json::from_str(&fs::read_to_string(fonts_dir.join("fonts-manifest.json")).unwrap())
                .unwrap();
        let trimmed = FontManifest {
            manifest_version: manifest.manifest_version,
            fonts: manifest.fonts.iter().filter(|e| e.id == "a").cloned().collect(),
        };
        fs::write(
            fonts_dir.join("fonts-manifest.json"),
            serde_json::to_string_pretty(&trimmed).unwrap(),
        )
        .unwrap();

        let report = install_into(&fonts_dir, &data_dir, &dest_dir, &noop_register);
        // 必须**如实上报**有一款旧字体还在机器上，不能静默保留
        assert_eq!(report.problems.len(), 1, "{:?}", report.problems);
        assert!(report.problems[0].contains("b"), "{:?}", report.problems);
        // 且必须仍在记录里，否则就永远不会被清理
        let record = read_install_record(&data_dir).expect("记录应存在");
        let ids: Vec<&str> = record.installed.iter().map(|f| f.id.as_str()).collect();
        assert!(ids.contains(&"b"), "旧字体应保留在记录中：{ids:?}");
        // 只有 a 出现在本次结果里（b 不再随包，不参与本次安装）
        assert_eq!(report.outcomes.len(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    /*
     * ── 在**真实**机器上跑一次清理（手动触发的诊断工具）──
     *
     * `remove_installed_fonts` 的语义已在上面用临时目录覆盖，但它真正的风险
     * 只有在真实机器上才暴露：注册表删不干净、文件被占用删不掉、
     * 记录文件删不掉导致下次"确保安装"误判。这些都不是临时目录能验证的。
     *
     * 默认 `#[ignore]`：它会**真的删掉本机已安装的随包字体**，
     * 不能作为常规测试自动执行。需要时手动跑：
     *
     *   cargo test --offline --lib 手动_在真实机器上清理随包字体 -- --ignored --nocapture
     *
     * 跑完再次启动应用即可重新安装（启动时的"确保安装"是幂等的）。
     */
    #[cfg(windows)]
    #[test]
    #[ignore = "会真的删除本机已安装的随包字体，仅手动执行"]
    fn 手动_在真实机器上清理随包字体() {
        let app_data = std::env::var("APPDATA")
            .map(|p| PathBuf::from(p).join("com.qingmuai.writer"))
            .expect("需要 APPDATA 环境变量");
        let record = read_install_record(&app_data);
        match &record {
            None => {
                println!("ⓘ {} 没有安装记录，无需清理", app_data.display());
                return;
            }
            Some(r) => println!("  记录里有 {} 款", r.installed.len()),
        }
        let report = remove_installed_fonts(&app_data);
        println!("  已注销注册表值 {} 个", report.unregistered.len());
        println!("  已删除文件 {} 个", report.deleted.len());
        for p in &report.problems {
            println!("  ⚠ {p}");
        }
        // 清理后记录必须消失，否则下次启动会读到陈旧记录
        assert!(!app_data.join(INSTALL_RECORD_FILE).exists(), "安装记录应被删除");
        assert!(!app_data.join(UNINSTALL_RECORD_FILE).exists(), "卸载记录应被删除");
        // 文件必须真的不在了（记录里列出的每一个）
        if let Some(r) = record {
            for f in &r.installed {
                assert!(
                    !PathBuf::from(&f.dest).exists(),
                    "{} 的文件仍在：{}",
                    f.family,
                    f.dest
                );
            }
        }
        println!("  ✓ 清理完成且无残留");
    }

    /*
     * ── 为 NSIS 端到端验证写出一份**真实**的卸载记录（手动触发的诊断工具）──
     *
     * 卸载清理在 NSIS 侧要读 `installed-fonts.txt`，而写下这个文件的是本模块的
     * `write_uninstall_record`。**这条跨语言的约定原本只被"编译通过"验证过** ——
     * 编译通过证明不了 FileRead 读得对、StrTrimNewLines 剥得对、
     * DeleteRegValue 删得掉。
     *
     * 所以这里由**生产代码**（而不是测试里另写一份）写出记录，并附一张
     * `expected.json` 说明预期结果，交给
     * docs/font-scaling-fix-20261007/verify-nsis-font-cleanup.mjs 去真跑一遍 NSIS。
     *
     * 关键点：记录内容绝不能在验收脚本里"照着格式再写一遍" ——
     * 那样测的是"我以为的格式"，而不是"实际写出的格式"，正是要避免的假绿。
     *
     * 由验收脚本调用，需要 `QMAI_FONT_E2E_DIR` 指向一个已经建好的工作目录。
     */
    #[test]
    #[ignore = "诊断工具，由 verify-nsis-font-cleanup.mjs 调用"]
    fn 诊断_写出卸载记录供NSIS端到端验证() {
        /*
         * 两个环境变量把这次运行完全圈在临时目录里：
         *   · QMAI_FONT_E2E_DIR       —— 冒充应用数据目录（写 installed-fonts.txt）
         *   · QMAI_FONT_E2E_FONTS_DIR —— 冒充用户字体目录（记录里写的 dest）
         * 这样验收脚本能真跑一遍 NSIS 清理，而不碰用户真实的 %APPDATA%
         * 与真实字体注册表。
         */
        let app_data = PathBuf::from(
            std::env::var("QMAI_FONT_E2E_DIR")
                .expect("需要 QMAI_FONT_E2E_DIR 环境变量指向工作目录"),
        );
        let fonts_dir = PathBuf::from(
            std::env::var("QMAI_FONT_E2E_FONTS_DIR")
                .expect("需要 QMAI_FONT_E2E_FONTS_DIR 环境变量指向字体目录"),
        );
        fs::create_dir_all(&app_data).expect("建数据目录");
        fs::create_dir_all(&fonts_dir).expect("建字体目录");

        /*
         * 值名与文件名都只用 ASCII —— 这不是偷懒，而是要**忠实复现生产形状**：
         * 真实清单里的族名（`Source Han Serif SC`）与文件名
         * （`SourceHanSerifSC-Bold.otf`）全是 ASCII，见
         * `清单里的族名与文件名必须全是ASCII` 这个测试。
         * 唯一可能带非 ASCII 的是**路径前缀** `%LOCALAPPDATA%` ——
         * 中文 Windows 用户名会让它变成 `C:\Users\张三\AppData\Local`。
         * 所以验收脚本要把字体目录指向一个**含中文的目录**，
         * 否则测的就不是真实缺陷。
         */
        let entries = vec![
            RecordedFont {
                id: "e2e-plain".into(),
                file: "E2EPlain-Regular.ttf".into(),
                family: "QMAI E2E Plain".into(),
                dest: fonts_dir.join("E2EPlain-Regular.ttf").to_string_lossy().to_string(),
                reg_value_name: Some("QMAI E2E Plain (TrueType)".into()),
                size_bytes: 11,
            },
            RecordedFont {
                id: "e2e-bold".into(),
                file: "E2EBold-Regular.otf".into(),
                family: "QMAI E2E Bold".into(),
                dest: fonts_dir.join("E2EBold-Regular.otf").to_string_lossy().to_string(),
                reg_value_name: Some("QMAI E2E Bold (TrueType)".into()),
                size_bytes: 22,
            },
        ];
        let record = InstallRecord { manifest_version: 1, installed: entries };
        write_uninstall_record(&app_data, &record).expect("写卸载记录");

        /*
         * 真的把两个文件建出来。
         * 不建的话 NSIS 的 `Delete` 会对着不存在的路径"成功"，
         * 于是"文件被删掉了"这个断言无论清理段写得多错都会通过 —— 典型的假绿。
         */
        for f in &record.installed {
            fs::write(&f.dest, vec![b'x'; f.size_bytes as usize]).expect("建假字体文件");
        }

        // 供验收脚本建注册表值/断言用；记录文件本身才是被测对象
        let expected: Vec<String> = record
            .installed
            .iter()
            .map(|f| {
                format!(
                    "{{\"valueName\":{},\"dest\":{}}}",
                    json_string(f.reg_value_name.as_deref().unwrap_or("")),
                    json_string(&f.dest)
                )
            })
            .collect();
        let sidecar = format!("{{\"expected\":[{}]}}", expected.join(","));
        fs::write(app_data.join("expected.json"), sidecar).expect("写 expected.json");

        let record_path = app_data.join(UNINSTALL_RECORD_FILE);
        println!("  记录文件：{}", record_path.display());
        println!("  字节数：{}", fs::metadata(&record_path).map(|m| m.len()).unwrap_or(0));
        println!("  条目数：{}", record.installed.len());
    }

    /// 把一个字符串编码成 JSON 字符串字面量（含转义）。
    ///
    /// 只用于上面的诊断工具写 `expected.json`：路径里可能有反斜杠、
    /// 值名里可能有引号，手工拼 JSON 会写出非法文件，
    /// 而验收脚本读不动它时会报"格式错"而不是"预期内容错"，很难定位。
    #[cfg(test)]
    fn json_string(s: &str) -> String {
        let mut out = String::with_capacity(s.len() + 2);
        out.push('"');
        for c in s.chars() {
            match c {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
                c => out.push(c),
            }
        }
        out.push('"');
        out
    }
}
