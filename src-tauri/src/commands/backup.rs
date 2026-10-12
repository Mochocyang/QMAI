use std::fs;
use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_store::StoreExt;
use walkdir::WalkDir;
use zip::write::ZipWriter;
use zip::CompressionMethod;

use crate::app_state;
use crate::panic_guard::run_guarded;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectBackupInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    #[serde(default)]
    pub sections: Vec<ProjectBackupSection>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectBackupSection {
    Content,
    Memory,
    Analysis,
    Indexes,
    Trash,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportParams {
    pub save_path: String,
    pub include_global_config: bool,
    pub include_ui_preferences: bool,
    pub include_credentials: bool,
    pub local_storage_data: serde_json::Value,
    pub projects: Vec<ProjectBackupInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub success: bool,
    pub warnings: Vec<String>,
    pub file_count: usize,
    pub total_size: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ImportStrategy {
    Full,
    GlobalOnly,
    Selective,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRestoreInfo {
    pub id: String,
    pub target_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportParams {
    pub zip_path: String,
    pub strategy: ImportStrategy,
    pub projects: Option<Vec<ProjectRestoreInfo>>,
    pub project_path_overrides: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub success: bool,
    pub app_state: Option<serde_json::Value>,
    pub local_storage_data: Option<serde_json::Value>,
    pub replace_local_storage: bool,
    pub projects: Vec<ProjectRestoreResult>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRestoreResult {
    pub id: String,
    pub path: String,
    pub name: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub backup_version: u32,
    pub created_at: String,
    pub app_version: String,
    #[serde(default)]
    pub contents: Option<BackupContents>,
    pub projects: Vec<ProjectBackupInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupContents {
    pub global_config: bool,
    pub ui_preferences: bool,
    pub credentials: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifestEntry {
    pub id: String,
    pub path: String,
    pub name: String,
    pub path_accessible: bool,
    pub sections: Vec<ProjectBackupSection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifestPreview {
    pub backup_version: u32,
    pub contents: BackupContents,
    pub projects: Vec<ProjectManifestEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupProgressPayload {
    pub operation: String,
    pub stage: String,
    pub current: usize,
    pub total: usize,
    pub message: String,
}

const PROJECT_FILES: &[&str] = &["soul.md", "schema.md", "purpose.md"];

// 知识目录的可能名称（新版用 QM，旧版用 wiki），导出时统一以 wiki 名称存入 zip
const KNOWLEDGE_DIR_CANDIDATES: &[&str] = &["QM", "wiki"];
const KNOWLEDGE_ZIP_NAME: &str = "wiki";

/*
 * `.qmai/` 里**属于项目自身**的文件名（相对 `.qmai/` 的直接子项）。
 *
 * ── 为什么要把它们从「分析」里择出来 ──
 * 原实现只看 `.qmai/` 下一级条目名：`lancedb` 算索引，**其余一律算「分析」**。
 * 于是用户只勾「正文」「记忆」、不勾「拆书、推演与 AI 工作数据」时，
 * 下面这些全都不会进备份 —— 恢复出来的项目少了自己的配置与手工记录，
 * 行为与备份前不一致，而用户在备份对话框里看不到任何提示。
 *
 * 这些文件本质是**项目自身的一部分**（和 soul.md 同级），不属于"分析产物"，
 * 所以判定改成：只要这个项目被备份了，它们就跟上，与勾了哪些 section 无关。
 * 它们的**凭据字段**另受 include_credentials 控制（见 add_project_meta_dir_to_zip）。
 *
 * 逐个说明为什么不能靠"重建"补回来：
 *   · project.json           项目身份（随机 UUID）。丢了它，打开项目会**生成一个新 id**，
 *                            而 projectNovelConfigs / projectRerankConfigs /
 *                            projectLastReadChapters / sourceWatchConfig /
 *                            projectRevisionFeedbackWindowConfigs 全部按这个 id 索引 ——
 *                            也就是说恢复后的书所有按项目保存的设置会一起失联。
 *   · writing-style.json     用户建立的写作风格预设（范文、DNA、章程），纯手工资产。
 *   · project-soul-styles.json 用户建立的灵魂风格预设，同上。
 *   · bindable-characters-ignore.json / foreshadowing-keep.json /
 *     dedup-not-duplicates.json  用户在界面里逐条点出来的"忽略/保留/不是重复"决定。
 *                            这些是**人的判断**，任何扫描都推不出来。
 *   · novel-config.json / source-watch-config.json /
 *     revision-feedback-config.json / rerank-config.json  项目级功能配置。
 *   · style-evolution.json   文风自进化的**用户开关**与「打开日」进度。
 *                            开关是用户显式选的（默认关），任何扫描都推不出来；
 *                            打开日计数则是**只能靠时间积累**的进度 ——
 *                            丢了它不会报错，只会让用户先前攒下的 3~5 个打开日
 *                            无声归零、功能被关回默认，然后以为「它坏了」。
 */
const PROJECT_OWNED_FILES: &[&str] = &[
    "project.json",
    "writing-style.json",
    "project-soul-styles.json",
    "bindable-characters-ignore.json",
    "foreshadowing-keep.json",
    "dedup-not-duplicates.json",
    "novel-config.json",
    "source-watch-config.json",
    "revision-feedback-config.json",
    "rerank-config.json",
    "style-evolution.json",
];

/// 封面是项目的可见资产（书架靠它显示），与"分析/索引"无关，跟正文一起走。
const PROJECT_META_COVERS_DIR: &str = "covers";

/// 判断 `.qmai/` 下的某个相对路径是否是"项目自身"的条目（只看直接子项）。
///
/// 只看直接子项而不是任意层级：`covers/` 下有图片、将来某个子目录里也可能出现
/// 叫 `project.json` 的文件，那些都不该被当成项目身份文件。
/// 注意 `covers` 本身（目录条目，没有斜杠）也要认 —— 遍历会为目录也产生一个条目，
/// 漏掉它就会让封面目录本身被过滤掉。
fn is_project_owned_entry(relative_slash: &str) -> bool {
    if let Some((top_level, _rest)) = relative_slash.split_once('/') {
        return top_level.eq_ignore_ascii_case(PROJECT_META_COVERS_DIR);
    }
    relative_slash.eq_ignore_ascii_case(PROJECT_META_COVERS_DIR)
        || PROJECT_OWNED_FILES
            .iter()
            .any(|name| relative_slash.eq_ignore_ascii_case(name))
}

/*
 * ── app-state.json 里"属于界面/软件偏好"的键 ──
 *
 * `filter_app_state` 用这张表二分：在表里 ⟺ 由「界面与软件偏好」勾选控制；
 * 不在表里 ⟺ 由「模型与 AI 配置」勾选控制。
 *
 * 判定标准必须与导出对话框的承诺一致（「主题、语言、字体、侧栏、图谱显示和布局偏好」）。
 * 因此**正文字体与排版参数必须在这张表里**：它们此前缺失，落进了 "else" 分支，
 * 于是一个勾了界面偏好、没勾全局配置的用户，备份里没有任何字体/排版设置 ——
 * 恢复后字号、行高、边距全丢，而对话框明明写着会备份"字体…布局偏好"。
 * 反向也错：只勾全局配置时这些纯界面设置反而被带走，混进了"模型与 AI 配置"。
 */
const UI_PREFERENCE_KEYS: &[&str] = &[
    "recentProjects",
    "lastProject",
    "language",
    "theme",
    "visualStyle",
    "visualStyleVersion",
    "uiFontSizeScale",
    "uiFontFamily",
    // 正文字体与排版（6 个键 + 1 个只读的旧倍数键，读回时用于一次性迁移）
    "uiBodyFontFamily",
    "uiBodyFontPx",
    "uiBodyLineHeight",
    "uiBodyLetterSpacing",
    "uiBodyMarginX",
    "uiBodySafeBottom",
    "uiBodyFontSizeScale",
    "maxHistoryMessages",
    "lastReadChapter",
    "projectLastReadChapters",
];

fn is_sensitive_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|character| *character != '_' && *character != '-')
        .flat_map(char::to_lowercase)
        .collect();
    normalized.contains("apikey")
        || normalized == "token"
        || normalized.ends_with("token")
        || normalized == "secret"
        || normalized.ends_with("secret")
        || normalized == "password"
        || normalized.ends_with("password")
        || normalized.contains("fingerprint")
}

fn remove_sensitive_fields(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(object) => {
            object.retain(|key, _| !is_sensitive_key(key));
            for child in object.values_mut() {
                remove_sensitive_fields(child);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                remove_sensitive_fields(item);
            }
        }
        _ => {}
    }
}

fn filter_app_state(
    mut value: serde_json::Value,
    include_global_config: bool,
    include_ui_preferences: bool,
    include_credentials: bool,
) -> Result<serde_json::Value, String> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| "app-state.json 格式错误，应为 JSON 对象".to_string())?;
    object.retain(|key, _| {
        if UI_PREFERENCE_KEYS.contains(&key.as_str()) {
            include_ui_preferences
        } else {
            include_global_config
        }
    });
    if !include_credentials {
        remove_sensitive_fields(&mut value);
    }
    Ok(value)
}

fn all_project_sections() -> Vec<ProjectBackupSection> {
    vec![
        ProjectBackupSection::Content,
        ProjectBackupSection::Memory,
        ProjectBackupSection::Analysis,
        ProjectBackupSection::Indexes,
        ProjectBackupSection::Trash,
    ]
}

fn default_legacy_contents() -> BackupContents {
    BackupContents {
        global_config: true,
        ui_preferences: true,
        credentials: true,
    }
}

fn deep_merge_json(target: &mut serde_json::Value, source: serde_json::Value) {
    match (target, source) {
        (serde_json::Value::Object(target_object), serde_json::Value::Object(source_object)) => {
            for (key, source_value) in source_object {
                match target_object.get_mut(&key) {
                    Some(target_value) => deep_merge_json(target_value, source_value),
                    None => {
                        target_object.insert(key, source_value);
                    }
                }
            }
        }
        (target_value, source_value) => *target_value = source_value,
    }
}

fn merge_app_state_file(
    app_state_path: &Path,
    imported: serde_json::Value,
    replace: bool,
) -> Result<serde_json::Value, String> {
    if replace || !app_state_path.exists() {
        return Ok(imported);
    }

    let existing_content = fs::read_to_string(app_state_path)
        .map_err(|error| format!("读取当前 app-state.json 失败: {error}"))?;
    let mut existing: serde_json::Value = serde_json::from_str(&existing_content)
        .map_err(|error| format!("解析当前 app-state.json 失败: {error}"))?;
    deep_merge_json(&mut existing, imported);
    Ok(existing)
}

fn emit_progress(
    app: &tauri::AppHandle,
    operation: &str,
    stage: &str,
    current: usize,
    total: usize,
    message: &str,
) {
    let _ = app.emit(
        "backup-progress",
        BackupProgressPayload {
            operation: operation.to_string(),
            stage: stage.to_string(),
            current,
            total,
            message: message.to_string(),
        },
    );
}

fn restore_app_state_via_store(
    app: &tauri::AppHandle,
    app_state_json: &serde_json::Value,
) -> Result<(), String> {
    let store = app
        .store_builder("app-state.json")
        .disable_auto_save()
        .build()
        .map_err(|e| format!("无法加载应用状态存储: {e}"))?;

    store.clear();

    let obj = app_state_json
        .as_object()
        .ok_or_else(|| "app-state.json 格式错误，应为 JSON 对象".to_string())?;

    for (key, value) in obj {
        store.set(key.clone(), value.clone());
    }

    crate::app_state::persist_plugin_store(app)
        .map_err(|e| format!("保存应用状态存储失败: {e}"))?;

    Ok(())
}

fn add_dir_to_zip(
    zip: &mut ZipWriter<fs::File>,
    base_dir: &Path,
    zip_prefix: &str,
    file_count: &mut usize,
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    let options =
        zip::write::SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for entry in WalkDir::new(base_dir).into_iter() {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                warnings.push(format!("备份遍历跳过: {}", e));
                continue;
            }
        };
        let path = entry.path();
        if path == base_dir {
            continue;
        }
        let relative = path
            .strip_prefix(base_dir)
            .map_err(|e| format!("路径剥离失败: {e}"))?;
        let zip_name = format!(
            "{}/{}",
            zip_prefix,
            relative.to_string_lossy().replace('\\', "/")
        );

        if entry.file_type().is_dir() {
            zip.add_directory(&zip_name, options)
                .map_err(|e| format!("创建 zip 目录失败: {e}"))?;
        } else if entry.file_type().is_file() {
            // 流式写入：逐块读取文件写入 zip，避免大文件全量读入内存
            let file = fs::File::open(path)
                .map_err(|e| format!("打开文件失败 {}: {e}", path.display()))?;
            zip.start_file(&zip_name, options)
                .map_err(|e| format!("创建 zip 文件条目失败: {e}"))?;
            let mut reader = std::io::BufReader::new(file);
            std::io::copy(&mut reader, zip).map_err(|e| format!("写入 zip 失败: {e}"))?;
            *file_count += 1;
        }
    }
    Ok(())
}

fn add_project_meta_dir_to_zip(
    zip: &mut ZipWriter<fs::File>,
    base_dir: &Path,
    zip_prefix: &str,
    include_analysis: bool,
    include_indexes: bool,
    include_credentials: bool,
    file_count: &mut usize,
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    let options =
        zip::write::SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    for entry in WalkDir::new(base_dir).into_iter() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                warnings.push(format!("备份遍历跳过: {error}"));
                continue;
            }
        };
        let path = entry.path();
        if path == base_dir {
            continue;
        }
        let relative = path
            .strip_prefix(base_dir)
            .map_err(|error| format!("路径剥离失败: {error}"))?;
        let relative_slash = relative.to_string_lossy().replace('\\', "/");
        let top_level = relative_slash.split('/').next().unwrap_or("");
        let is_index_entry = top_level.eq_ignore_ascii_case("lancedb");        /*
         * 三分类，取代原来的二分（index / 其余都是 analysis）：
         *   · lancedb 目录下        → 索引，只受 include_indexes 控制
         *   · 项目自身文件 + covers/ → 只要项目被备份就带上，与勾选哪些 section 无关
         *                             （见 PROJECT_OWNED_FILES 的说明）
         *   · 其余                   → 分析/推演工作数据，受 include_analysis 控制
         */
        let project_owned = is_project_owned_entry(&relative_slash);
        if !project_owned
            && ((is_index_entry && !include_indexes) || (!is_index_entry && !include_analysis))
        {
            continue;
        }

        let zip_name = format!("{}/{}", zip_prefix, relative_slash);
        if entry.file_type().is_dir() {
            zip.add_directory(&zip_name, options)
                .map_err(|error| format!("创建 zip 目录失败: {error}"))?;
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }

        /*
         * 不勾「API Key 和其他凭据」时，**每一份项目自身文件**都要剔除敏感字段。
         *
         * 原先只有 rerank-config.json 被清洗，因为目前只有它带密钥。
         * 但这条保护逻辑跟"哪个文件名"没关系，只跟"这是不是项目自身文件"有关系 ——
         * 写死单个文件名，就意味着以后谁往 novel-config.json 里加一个 apiKey，
         * 备份就会悄悄泄露它，而对话框上明明写着不会包含凭据。
         * 现在按 PROJECT_OWNED_FILES 整组清洗：新增文件只要进那张表就自动受保护。
         *
         * 解析失败时**跳过该文件**（而不是原样打包）：把原始字节写进去就可能带着明文密钥，
         * 这与用户取消勾选的意图直接冲突 —— 宁可少一份配置也要给出明确警告，让用户重做备份。
         */
        let is_project_config_file = PROJECT_OWNED_FILES
            .iter()
            .any(|name| relative_slash.eq_ignore_ascii_case(name));
        if is_project_config_file && !include_credentials {
            let content = fs::read_to_string(path)
                .map_err(|error| format!("读取项目配置失败 {}: {error}", path.display()))?;
            let mut json: serde_json::Value = match serde_json::from_str(&content) {
                Ok(json) => json,
                Err(error) => {
                    warnings.push(format!(
                        "项目配置 {} 无法安全移除凭据，已跳过（未写入备份）: {error}",
                        relative_slash
                    ));
                    continue;
                }
            };
            remove_sensitive_fields(&mut json);
            let sanitized = serde_json::to_vec_pretty(&json)
                .map_err(|error| format!("序列化项目配置失败: {error}"))?;
            zip.start_file(&zip_name, options)
                .map_err(|error| format!("创建 zip 文件条目失败: {error}"))?;
            zip.write_all(&sanitized)
                .map_err(|error| format!("写入 zip 失败: {error}"))?;
            *file_count += 1;
            continue;
        }

        let file = fs::File::open(path)
            .map_err(|error| format!("打开文件失败 {}: {error}", path.display()))?;
        zip.start_file(&zip_name, options)
            .map_err(|error| format!("创建 zip 文件条目失败: {error}"))?;
        let mut reader = std::io::BufReader::new(file);
        std::io::copy(&mut reader, zip).map_err(|error| format!("写入 zip 失败: {error}"))?;
        *file_count += 1;
    }

    Ok(())
}

/// `project-registry.json` 的一条项目记录。
///
/// 为什么只留三个字段：导出时写的是数组（元素还带 sections），而 app-state 里的
/// `projectRegistry` 是按 id 索引的对象（值带 lastOpened）。这里统一只取
/// 「id / path / name」——注册书架正好只需要这三个。
#[derive(Debug, Clone)]
struct RegistryProject {
    id: String,
    path: String,
    name: String,
}

/// 解析 `project-registry.json`。
///
/// 兼容两种形状，因为同一个概念在项目里存过两种样子：
///   · `[{id,path,name,sections}]`（导出时写的）
///   · `{"<id>": {id,path,name,lastOpened}}`（app-state 里的 projectRegistry）
///   · `{"projects": [...]}`（数组被包了一层）
/// 认不出来就返回空表 —— 调用方据此走"没有 registry"的旧路径，不会更糟。
fn parse_project_registry(value: &serde_json::Value) -> Vec<RegistryProject> {
    fn entry_of(value: &serde_json::Value) -> Option<RegistryProject> {
        let object = value.as_object()?;
        let id = object.get("id")?.as_str()?.trim().to_string();
        if id.is_empty() {
            return None;
        }
        Some(RegistryProject {
            id,
            path: object
                .get("path")
                .and_then(|p| p.as_str())
                .unwrap_or_default()
                .to_string(),
            name: object
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or_default()
                .to_string(),
        })
    }

    let mut entries = Vec::new();
    match value {
        serde_json::Value::Array(items) => {
            entries.extend(items.iter().filter_map(entry_of));
        }
        serde_json::Value::Object(map) => {
            match map.get("projects").and_then(|value| value.as_array()) {
                Some(items) => entries.extend(items.iter().filter_map(entry_of)),
                None => entries.extend(map.values().filter_map(entry_of)),
            }
        }
        _ => {}
    }
    entries
}

/// zip 里**确实带数据**的项目 id 集合（看 `projects/<id>/...` 条目）。
///
/// 用途与必要性：备份可能只带了某个项目的部分数据，甚至完全没带它的文件。
/// 若照着 registry 去恢复一个 zip 里根本没有的项目，`extract_dir_from_zip`
/// 会"成功恢复 0 个文件"却建出一个空项目目录，书架随后显示一个打不开的书。
/// 所以只有出现在这个集合里的 id 才允许被纳入恢复计划。
fn project_ids_in_archive(
    archive: &zip::ZipArchive<fs::File>,
) -> std::collections::HashSet<String> {
    archive
        .file_names()
        .filter_map(|name| name.strip_prefix("projects/"))
        .filter_map(|rest| rest.split('/').next())
        .filter(|id| !id.is_empty())
        .map(|id| id.to_string())
        .collect()
}

fn extract_file_from_zip(
    archive: &mut zip::ZipArchive<fs::File>,
    name: &str,
) -> Result<Option<Vec<u8>>, String> {
    match archive.by_name(name) {
        Ok(mut file) => {
            let mut buf = Vec::new();
            std::io::Read::read_to_end(&mut file, &mut buf)
                .map_err(|e| format!("读取 zip 内文件 {} 失败: {e}", name))?;
            Ok(Some(buf))
        }
        Err(zip::result::ZipError::FileNotFound) => Ok(None),
        Err(e) => Err(format!("访问 zip 内文件 {} 失败: {e}", name)),
    }
}

fn extract_dir_from_zip(
    archive: &mut zip::ZipArchive<fs::File>,
    zip_prefix: &str,
    target_dir: &Path,
) -> Result<usize, String> {
    let mut count = 0;
    let names: Vec<String> = archive
        .file_names()
        .filter(|n| n.starts_with(zip_prefix))
        .map(|n| n.to_string())
        .collect();

    // Zip Slip 防护：在循环外只调用一次 canonicalize，避免性能开销和 TOCTOU 风险
    let canonical_target = target_dir
        .canonicalize()
        .map_err(|e| format!("无法解析目标目录: {e}"))?;

    for name in names {
        let relative = &name[zip_prefix.len()..];
        let relative = relative.trim_start_matches('/');
        if relative.is_empty() {
            continue;
        }

        let dest_path = target_dir.join(relative);

        // 逐组件规范化路径，检测 .. 是否逃逸出 target_dir（不依赖文件存在性）
        let mut normalized_dest = canonical_target.clone();
        for component in Path::new(relative).components() {
            match component {
                std::path::Component::ParentDir => {
                    normalized_dest.pop();
                    if !normalized_dest.starts_with(&canonical_target) {
                        return Err(format!(
                            "安全拦截：zip 条目 \"{}\" 试图写入目标目录之外的位置",
                            name
                        ));
                    }
                }
                std::path::Component::CurDir => {}
                other => normalized_dest.push(other),
            }
        }

        if !normalized_dest.starts_with(&canonical_target) {
            return Err(format!(
                "安全拦截：zip 条目 \"{}\" 试图写入目标目录之外的位置 {}",
                name,
                normalized_dest.display()
            ));
        }

        if name.ends_with('/') {
            fs::create_dir_all(&dest_path)
                .map_err(|e| format!("创建目录失败 {}: {e}", dest_path.display()))?;
            continue;
        }

        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建父目录失败 {}: {e}", parent.display()))?;
        }

        let mut file = archive
            .by_name(&name)
            .map_err(|e| format!("打开 zip 内文件 {} 失败: {e}", name))?;
        let mut buf = Vec::new();
        std::io::Read::read_to_end(&mut file, &mut buf)
            .map_err(|e| format!("读取 zip 内文件 {} 失败: {e}", name))?;
        fs::write(&dest_path, &buf)
            .map_err(|e| format!("写入文件失败 {}: {e}", dest_path.display()))?;
        count += 1;
    }
    Ok(count)
}

/// 检查项目路径的根（盘符/根目录）是否可达。
/// Windows: 检查盘符是否存在（如 "D:\" 存在）。
/// Unix: 根目录 "/" 始终可达。
fn is_path_root_accessible(path: &str) -> bool {
    let p = Path::new(path);
    match p.components().next() {
        Some(std::path::Component::Prefix(prefix)) => {
            // Windows 驱动器前缀（如 "C:" "D:"）
            let prefix_path = prefix.as_os_str();
            let root = if prefix_path.to_string_lossy().len() == 2 {
                // "D:" → "D:\"
                format!("{}\\", prefix_path.to_string_lossy())
            } else {
                // UNC 路径等，直接检查
                prefix_path.to_string_lossy().to_string()
            };
            Path::new(&root).exists()
        }
        Some(std::path::Component::RootDir) => true,
        _ => true,
    }
}

// ── Core logic (Tauri-agnostic) ──────────────────────────────────

/// 导出时的临时文件后缀：先写 `<目标名>.part`，全部写完并 flush 之后才改名为目标名。
///
/// ── 为什么必须这样（用户拍板要修的缺陷）──
/// 原实现直接 `File::create(save_path)` 往目标路径上写。两个后果：
///   ① 中途任何一步失败（某文件读不出来、磁盘满、进程被杀），目标位置上
///      留着一个**没有中央目录的残缺 zip** —— 它看起来像备份，其实打不开；
///   ② 更糟的是用户选了「覆盖已有备份」：旧的好备份在 `File::create` 那一刻
///      就被截断了，新备份又没写成功 —— 等于把用户唯一的那份备份毁掉。
/// 改名的语义是原子的（同目录同卷），所以「目标路径上要么是旧备份、要么是
/// 完整的新备份」，不存在中间态。
const EXPORT_PARTIAL_SUFFIX: &str = ".part";

fn partial_path_for(save_path: &Path) -> std::path::PathBuf {
    let mut partial = save_path.as_os_str().to_os_string();
    partial.push(EXPORT_PARTIAL_SUFFIX);
    std::path::PathBuf::from(partial)
}

/// Core export backup logic.
/// `app_state_path` is the path to `app-state.json` on disk.
/// `on_progress` is called with progress payloads during the operation.
///
/// 本函数只负责"原子性"这一层：临时文件 → 改名；真正的打包在
/// [`write_backup_zip`] 里。这样拆分是因为失败清理必须**只有一处**，
/// 而打包过程有几十个 `?` 提前返回的分支 —— 让每个分支自己删文件，
/// 迟早会漏掉一个（这正是原实现的问题）。
pub fn do_export_backup<F: Fn(&BackupProgressPayload)>(
    params: ExportParams,
    app_state_path: &Path,
    on_progress: F,
) -> Result<ExportResult, String> {
    let save_path = std::path::PathBuf::from(&params.save_path);
    let partial_path = partial_path_for(&save_path);
    let total_projects = params.projects.len();

    // 上一次异常退出可能留下同名临时文件；先清掉，免得失败清理时删错对象。
    let _ = fs::remove_file(&partial_path);

    let packed = write_backup_zip(&params, app_state_path, &partial_path, &on_progress);
    let (file_count, warnings) = match packed {
        Ok(packed) => packed,
        Err(error) => {
            // 失败路径唯一出口：目标路径保持原样（旧备份若存在则完好如初）。
            let _ = fs::remove_file(&partial_path);
            return Err(error);
        }
    };

    if let Err(error) = fs::rename(&partial_path, &save_path) {
        let _ = fs::remove_file(&partial_path);
        return Err(format!(
            "备份已打包完成，但无法写入目标位置 {}: {error}",
            save_path.display()
        ));
    }

    let total_size = fs::metadata(&save_path).map(|m| m.len()).unwrap_or(0);

    on_progress(&BackupProgressPayload {
        operation: "export".to_string(),
        stage: "done".to_string(),
        current: total_projects + 2,
        total: total_projects + 2,
        message: "导出完成".to_string(),
    });

    Ok(ExportResult {
        success: true,
        warnings,
        file_count,
        total_size,
        error: None,
    })
}

/// 真正打包到 `zip_path`（调用方传的是临时路径）。
/// 返回 (文件数, 警告)。**任何** `Err` 都由 [`do_export_backup`] 统一清理。
fn write_backup_zip<F: Fn(&BackupProgressPayload)>(
    params: &ExportParams,
    app_state_path: &Path,
    zip_path: &Path,
    on_progress: &F,
) -> Result<(usize, Vec<String>), String> {
    let total_projects = params.projects.len();

    on_progress(&BackupProgressPayload {
        operation: "export".to_string(),
        stage: "preparing".to_string(),
        current: 0,
        total: total_projects + 2,
        message: "正在准备导出...".to_string(),
    });

    let file = fs::File::create(zip_path).map_err(|e| {
        format!("无法创建备份临时文件 {}: {e}", zip_path.display())
    })?;
    let mut zip = ZipWriter::new(file);

    let mut file_count: usize = 0;
    let mut warnings: Vec<String> = Vec::new();

    /*
     * ── 含明文凭据的备份必须在"结果"里再提醒一次 ──
     *
     * 「全部内容」模式默认 `includeCredentials = true`，而 zip **不加密**：
     * API Key、代理密码、搜索密钥都以明文躺在里面。导出对话框里确实有一句
     * 静态说明，但用户勾完就走，导出完成后结果区只说"成功"——
     * 最需要被看见的那句话恰好在最容易被忽略的位置。
     * 所以这里把它放进 warnings：结果区会一直显示到用户关掉为止。
     */
    if params.include_credentials {
        warnings.push(
            "此备份包含 API Key 等凭据，且 ZIP 未加密，请勿分享或上传到网盘共享目录".to_string(),
        );
    }

    let options =
        zip::write::SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    // 1. manifest.json
    let manifest = BackupManifest {
        backup_version: 2,
        created_at: chrono::Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        contents: Some(BackupContents {
            global_config: params.include_global_config,
            ui_preferences: params.include_ui_preferences,
            credentials: params.include_credentials,
        }),
        projects: params.projects.clone(),
    };
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("序列化 manifest 失败: {e}"))?;
    zip.start_file("manifest.json", options)
        .map_err(|e| format!("写入 manifest 失败: {e}"))?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| format!("写入 manifest 失败: {e}"))?;
    // manifest.json 与 project-registry.json 也是 zip 里真实存在的条目，
    // 必须计入 file_count —— 否则界面「共 N 个文件」比实际少 2 个（用户会以为丢了文件）。
    file_count += 1;

    on_progress(&BackupProgressPayload {
        operation: "export".to_string(),
        stage: "collecting".to_string(),
        current: 1,
        total: total_projects + 2,
        message: "正在收集全局配置...".to_string(),
    });

    // 2. global/app-state.json
    if params.include_global_config || params.include_ui_preferences {
        zip.start_file("global/app-state.json", options)
            .map_err(|e| format!("创建 app-state zip 条目失败: {e}"))?;

        if app_state_path.exists() {
            let app_state_content = fs::read_to_string(app_state_path)
                .map_err(|e| format!("读取 app-state.json 失败: {e}"))?;
            let app_state_json: serde_json::Value = serde_json::from_str(&app_state_content)
                .map_err(|e| format!("解析 app-state.json 失败: {e}"))?;
            let filtered = filter_app_state(
                app_state_json,
                params.include_global_config,
                params.include_ui_preferences,
                params.include_credentials,
            )?;
            let filtered_json = serde_json::to_vec_pretty(&filtered)
                .map_err(|e| format!("序列化 app-state.json 失败: {e}"))?;
            zip.write_all(&filtered_json)
                .map_err(|e| format!("写入 app-state 到 zip 失败: {e}"))?;
            file_count += 1;
        } else {
            zip.write_all(b"{}")
                .map_err(|e| format!("写入空 app-state 失败: {e}"))?;
            warnings.push("app-state.json 不存在，已写入空对象".to_string());
        }
    }

    // 3. global/local-storage.json
    if params.include_ui_preferences {
        let mut local_storage_data = params.local_storage_data.clone();
        if !params.include_credentials {
            remove_sensitive_fields(&mut local_storage_data);
        }
        zip.start_file("global/local-storage.json", options)
            .map_err(|e| format!("创建 local-storage zip 条目失败: {e}"))?;
        let ls_json = serde_json::to_string_pretty(&local_storage_data)
            .map_err(|e| format!("序列化 localStorage 失败: {e}"))?;
        zip.write_all(ls_json.as_bytes())
            .map_err(|e| format!("写入 local-storage 到 zip 失败: {e}"))?;
        file_count += 1;
    }

    // 4. project-registry.json
    let registry_json = serde_json::json!({
        "projects": params.projects.iter().map(|p| {
            serde_json::json!({
                "id": p.id,
                "path": p.path,
                "name": p.name,
                "sections": p.sections,
            })
        }).collect::<Vec<_>>()
    });
    zip.start_file("project-registry.json", options)
        .map_err(|e| format!("创建 registry zip 条目失败: {e}"))?;
    let registry_str = serde_json::to_string_pretty(&registry_json)
        .map_err(|e| format!("序列化 registry 失败: {e}"))?;
    zip.write_all(registry_str.as_bytes())
        .map_err(|e| format!("写入 registry 到 zip 失败: {e}"))?;
    file_count += 1;

    // 5. 项目数据
    for (idx, project) in params.projects.iter().enumerate() {
        let project_path = Path::new(&project.path);
        if !project_path.exists() {
            warnings.push(format!(
                "项目路径不存在，已跳过: {} ({})",
                project.name, project.path
            ));
            continue;
        }

        on_progress(&BackupProgressPayload {
            operation: "export".to_string(),
            stage: "packing".to_string(),
            current: idx + 2,
            total: total_projects + 2,
            message: format!("正在打包项目: {}", project.name),
        });

        let zip_prefix = format!("projects/{}", project.id);

        let include_content = project.sections.contains(&ProjectBackupSection::Content);
        let include_memory = project.sections.contains(&ProjectBackupSection::Memory);
        let include_analysis = project.sections.contains(&ProjectBackupSection::Analysis);
        let include_indexes = project.sections.contains(&ProjectBackupSection::Indexes);
        let include_trash = project.sections.contains(&ProjectBackupSection::Trash);

        if include_content {
            // 导出知识目录（优先 QM，兼容 wiki），统一以 wiki 名称存入 zip
            for knowledge_dir in KNOWLEDGE_DIR_CANDIDATES {
                let knowledge_path = project_path.join(knowledge_dir);
                if knowledge_path.exists() && knowledge_path.is_dir() {
                    let zip_sub_prefix = format!("{}/{}", zip_prefix, KNOWLEDGE_ZIP_NAME);
                    if let Err(e) = add_dir_to_zip(
                        &mut zip,
                        &knowledge_path,
                        &zip_sub_prefix,
                        &mut file_count,
                        &mut warnings,
                    ) {
                        warnings.push(format!(
                            "复制项目 {} 的知识目录({})失败: {}",
                            project.name, knowledge_dir, e
                        ));
                    }
                    break;
                }
            }

            let raw_path = project_path.join("raw");
            if raw_path.exists() && raw_path.is_dir() {
                let zip_sub_prefix = format!("{}/raw", zip_prefix);
                if let Err(e) = add_dir_to_zip(
                    &mut zip,
                    &raw_path,
                    &zip_sub_prefix,
                    &mut file_count,
                    &mut warnings,
                ) {
                    warnings.push(format!("复制项目 {} 的 raw 目录失败: {}", project.name, e));
                }
            }

            for file_name in PROJECT_FILES {
                let file_path = project_path.join(file_name);
                if !file_path.exists() || !file_path.is_file() {
                    continue;
                }
                /*
                 * 单个项目文件读不出来（被别的程序独占、坏扇区、权限不足）
                 * 只记一条警告，**不能**中断整份备份。
                 *
                 * 原实现这里是 `fs::read(...)?`，与同函数里 add_dir_to_zip 的
                 * "记警告继续" 策略相反：一个不可读的 soul.md 会让整次导出失败，
                 * 用户拿不到任何备份 —— 而其余几十个项目本来都能备份。
                 * 备份工具的取向应当是"尽量多救回来 + 明确告知缺了什么"。
                 */
                let data = match fs::read(&file_path) {
                    Ok(data) => data,
                    Err(error) => {
                        warnings.push(format!(
                            "项目 {} 的 {} 读取失败，已跳过: {error}",
                            project.name,
                            file_name
                        ));
                        continue;
                    }
                };
                let zip_name = format!("{}/{}", zip_prefix, file_name);
                zip.start_file(&zip_name, options)
                    .map_err(|e| format!("创建 zip 文件条目失败: {e}"))?;
                zip.write_all(&data)
                    .map_err(|e| format!("写入 zip 失败: {e}"))?;
                file_count += 1;
            }
        }

        if include_memory {
            if !include_content {
                for knowledge_dir in KNOWLEDGE_DIR_CANDIDATES {
                    let memory_knowledge_path = project_path.join(knowledge_dir).join("memory");
                    if memory_knowledge_path.exists() && memory_knowledge_path.is_dir() {
                        let zip_sub_prefix =
                            format!("{}/{}/memory", zip_prefix, KNOWLEDGE_ZIP_NAME);
                        if let Err(e) = add_dir_to_zip(
                            &mut zip,
                            &memory_knowledge_path,
                            &zip_sub_prefix,
                            &mut file_count,
                            &mut warnings,
                        ) {
                            warnings
                                .push(format!("复制项目 {} 的结构化记忆失败: {}", project.name, e));
                        }
                        break;
                    }
                }
            }

            let memory_path = project_path.join(".novel");
            if memory_path.exists() && memory_path.is_dir() {
                let zip_sub_prefix = format!("{}/.novel", zip_prefix);
                if let Err(e) = add_dir_to_zip(
                    &mut zip,
                    &memory_path,
                    &zip_sub_prefix,
                    &mut file_count,
                    &mut warnings,
                ) {
                    warnings.push(format!(
                        "复制项目 {} 的 .novel 目录失败: {}",
                        project.name, e
                    ));
                }
            }
        }

        if include_analysis {
            let analysis_path = project_path.join("book-analysis");
            if analysis_path.exists() && analysis_path.is_dir() {
                let zip_sub_prefix = format!("{}/book-analysis", zip_prefix);
                if let Err(e) = add_dir_to_zip(
                    &mut zip,
                    &analysis_path,
                    &zip_sub_prefix,
                    &mut file_count,
                    &mut warnings,
                ) {
                    warnings.push(format!("复制项目 {} 的拆书数据失败: {}", project.name, e));
                }
            }
        }

        /*
         * `.qmai/` 一律尝试遍历（不再用 include_analysis || include_indexes 挡在外面）：
         * 里面既有分析/索引数据（由两个 include_* 参数在函数内逐个过滤），
         * 也有项目自己的配置文件与封面（那些必须跟上，见常量说明）。
         * 把整个目录挡在门外会让"只想备份正文"的用户悄悄丢掉 novel-config.json。
         */
        {
            let meta_path = project_path.join(".qmai");
            if meta_path.exists() && meta_path.is_dir() {
                let zip_sub_prefix = format!("{}/.qmai", zip_prefix);
                if let Err(e) = add_project_meta_dir_to_zip(
                    &mut zip,
                    &meta_path,
                    &zip_sub_prefix,
                    include_analysis,
                    include_indexes,
                    params.include_credentials,
                    &mut file_count,
                    &mut warnings,
                ) {
                    warnings.push(format!(
                        "复制项目 {} 的 AI 工作数据失败: {}",
                        project.name, e
                    ));
                }
            }
        }

        if include_indexes {
            let retrieval_path = project_path.join("retrieval");
            if retrieval_path.exists() && retrieval_path.is_dir() {
                let zip_sub_prefix = format!("{}/retrieval", zip_prefix);
                if let Err(e) = add_dir_to_zip(
                    &mut zip,
                    &retrieval_path,
                    &zip_sub_prefix,
                    &mut file_count,
                    &mut warnings,
                ) {
                    warnings.push(format!("复制项目 {} 的检索索引失败: {}", project.name, e));
                }
            }
        }

        if include_trash {
            let trash_path = project_path.join(".trash");
            if trash_path.exists() && trash_path.is_dir() {
                let zip_sub_prefix = format!("{}/.trash", zip_prefix);
                if let Err(e) = add_dir_to_zip(
                    &mut zip,
                    &trash_path,
                    &zip_sub_prefix,
                    &mut file_count,
                    &mut warnings,
                ) {
                    warnings.push(format!("复制项目 {} 的回收站失败: {}", project.name, e));
                }
            }
        }
    }

    on_progress(&BackupProgressPayload {
        operation: "export".to_string(),
        stage: "writing".to_string(),
        current: total_projects + 2,
        total: total_projects + 2,
        message: "正在写入备份文件...".to_string(),
    });

    /*
     * `finish()` 写出中央目录，返回内层 File。
     * 必须 `sync_all()` 之后才让调用方改名：改名是原子的，但"数据已全部落到
     * 磁盘上"不是 —— 少了这一步，断电时可能出现"文件名是新的、内容是空的"。
     * 备份是用户最后的保险，这里多一次 fsync 是值的。
     */
    let finished = zip
        .finish()
        .map_err(|e| format!("完成 zip 写入失败: {e}"))?;
    finished
        .sync_all()
        .map_err(|e| format!("刷新备份数据到磁盘失败: {e}"))?;
    drop(finished);

    Ok((file_count, warnings))
}

/// Core import backup logic.
/// `app_state_dir` is the directory where `app-state.json` should be written to.
/// `on_progress` is called with progress payloads during the operation.
pub fn do_import_backup<F: Fn(&BackupProgressPayload)>(
    params: ImportParams,
    app_state_dir: &Path,
    on_progress: F,
) -> Result<ImportResult, String> {
    let zip_path = Path::new(&params.zip_path);
    if !zip_path.exists() {
        return Ok(ImportResult {
            success: false,
            app_state: None,
            local_storage_data: None,
            replace_local_storage: true,
            projects: vec![],
            warnings: vec![],
            error: Some("备份文件不存在".to_string()),
        });
    }

    on_progress(&BackupProgressPayload {
        operation: "import".to_string(),
        stage: "preparing".to_string(),
        current: 0,
        total: 1,
        message: "正在准备导入...".to_string(),
    });

    let file = fs::File::open(zip_path).map_err(|e| format!("打开备份文件失败: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("读取备份文件失败，可能已损坏: {e}"))?;

    let mut warnings: Vec<String> = Vec::new();
    let mut app_state: Option<serde_json::Value> = None;
    let mut local_storage_data: Option<serde_json::Value> = None;
    let mut project_results: Vec<ProjectRestoreResult> = Vec::new();
    let mut manifest_version = 1;
    let mut manifest_contents = default_legacy_contents();

    let mut manifest_projects: Vec<ProjectBackupInfo> = Vec::new();
    if let Some(manifest_bytes) = extract_file_from_zip(&mut archive, "manifest.json")? {
        let manifest: BackupManifest = serde_json::from_slice(&manifest_bytes)
            .map_err(|e| format!("解析 manifest.json 失败: {e}"))?;
        manifest_version = manifest.backup_version;
        manifest_contents = manifest.contents.unwrap_or_else(default_legacy_contents);
        if manifest.backup_version > 2 {
            warnings.push(format!(
                "备份版本 {} 可能不兼容当前版本",
                manifest.backup_version
            ));
        }
        manifest_projects = manifest
            .projects
            .into_iter()
            .map(|mut project| {
                if manifest_version < 2 && project.sections.is_empty() {
                    project.sections = all_project_sections();
                }
                project
            })
            .collect();
    } else {
        warnings.push("备份文件缺少 manifest.json".to_string());
    }

    /*
     * 读取 `project-registry.json`。
     *
     * 这个文件此前是**只写不读的死数据**：导出时认真写进 zip，导入端却从不打开。
     * 后果是用户可见的数据丢失 ——
     *   「仅项目内容」备份里不含 app-state（projectRegistry 在里面），
     *   localStorage 里那个书架索引（qm-uitest-library）也不会跨机器带过去，
     *   而唯一记录了"这些书都叫什么、原来在哪"的 project-registry.json 又被忽略，
     *   于是文件都恢复到磁盘了，**书架却是空的**。
     * 现在把它读出来，用来补全恢复计划与名称（见下面的 Full 分支）。
     */
    let registry_projects = match extract_file_from_zip(&mut archive, "project-registry.json")? {
        Some(bytes) => match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(value) => parse_project_registry(&value),
            Err(error) => {
                warnings.push(format!(
                    "备份内的 project-registry.json 无法解析，已忽略（不影响其它数据）: {error}"
                ));
                Vec::new()
            }
        },
        None => Vec::new(),
    };

    let need_global = matches!(
        params.strategy,
        ImportStrategy::Full | ImportStrategy::GlobalOnly
    );

    if need_global
        && manifest_version >= 2
        && !manifest_contents.global_config
        && !manifest_contents.ui_preferences
    {
        warnings.push("该备份不包含全局配置或界面偏好，当前设置保持不变".to_string());
    }

    if need_global {
        on_progress(&BackupProgressPayload {
            operation: "import".to_string(),
            stage: "restoring".to_string(),
            current: 0,
            total: 1,
            message: "正在恢复全局配置...".to_string(),
        });

        if let Some(app_state_bytes) = extract_file_from_zip(&mut archive, "global/app-state.json")?
        {
            let app_state_json: serde_json::Value = serde_json::from_slice(&app_state_bytes)
                .map_err(|e| format!("解析 app-state.json 失败: {e}"))?;

            fs::create_dir_all(app_state_dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
            let app_state_path = app_state_dir.join("app-state.json");
            let replace_app_state = manifest_version < 2
                || (manifest_contents.global_config
                    && manifest_contents.ui_preferences
                    && manifest_contents.credentials);
            let merged_app_state =
                merge_app_state_file(&app_state_path, app_state_json, replace_app_state)?;
            crate::app_state::persist_app_state_object(app_state_dir, &merged_app_state)
                .map_err(|e| format!("写入 app-state.json 失败: {e}"))?;

            app_state = Some(merged_app_state);
        }

        if let Some(ls_bytes) = extract_file_from_zip(&mut archive, "global/local-storage.json")? {
            let ls_json: serde_json::Value = serde_json::from_slice(&ls_bytes)
                .map_err(|e| format!("解析 local-storage.json 失败: {e}"))?;
            local_storage_data = Some(ls_json);
        }
    }

    let need_projects = matches!(
        params.strategy,
        ImportStrategy::Full | ImportStrategy::Selective
    );

    if need_projects {
        let projects_to_restore: Vec<(String, String, String)> = match &params.strategy {
            ImportStrategy::Full => {
                let mut planned: Vec<(String, String, String)> = manifest_projects
                    .iter()
                    .map(|p| {
                        let path = params
                            .project_path_overrides
                            .as_ref()
                            .and_then(|m| m.get(&p.id))
                            .cloned()
                            .unwrap_or_else(|| p.path.clone());
                        (p.id.clone(), path, p.name.clone())
                    })
                    .collect();

                /*
                 * 用 registry 补上「清单里没列、但 zip 里确实有数据」的项目。
                 *
                 * 这不是锦上添花：manifest 是导出那一刻的项目清单，而
                 * project-registry.json 记录的是**这台机器上曾经有哪些书**。
                 * 两者不一致时（清单被截断、备份来自更早的版本、
                 * 或用户手改过 zip），只看 manifest 就会漏掉书 ——
                 * 而用户看到的症状正是"我明明备份了三本书，只回来两本"。
                 *
                 * 同时保留 manifest 优先：它带 sections，知道哪些数据该恢复。
                 */
                let archive_ids = project_ids_in_archive(&archive);
                for entry in &registry_projects {
                    if planned.iter().any(|(id, _, _)| id == &entry.id) {
                        continue;
                    }
                    if !archive_ids.contains(&entry.id) {
                        warnings.push(format!(
                            "备份记录里的项目「{}」在备份文件中没有数据，已跳过（{}）",
                            if entry.name.is_empty() {
                                entry.id.as_str()
                            } else {
                                entry.name.as_str()
                            },
                            entry.path
                        ));
                        continue;
                    }
                    let path = params
                        .project_path_overrides
                        .as_ref()
                        .and_then(|m| m.get(&entry.id))
                        .cloned()
                        .unwrap_or_else(|| entry.path.clone());
                    let name = if entry.name.is_empty() {
                        "已恢复项目".to_string()
                    } else {
                        entry.name.clone()
                    };
                    planned.push((entry.id.clone(), path, name));
                }
                planned
            }
            ImportStrategy::Selective => params
                .projects
                .as_ref()
                .map(|ps| {
                    ps.iter()
                        .map(|p| {
                            /*
                             * 名称来源依次是：manifest → project-registry.json → 兜底。
                             * registry 这一层是新增的：只带项目内容的备份里
                             * manifest 仍会列项目，但历史/手改过的 zip 未必，
                             * 那时 registry 就是唯一知道书名的东西。
                             */
                            let name = manifest_projects
                                .iter()
                                .find(|m| m.id == p.id)
                                .map(|m| m.name.clone())
                                .or_else(|| {
                                    registry_projects
                                        .iter()
                                        .find(|r| r.id == p.id)
                                        .map(|r| r.name.clone())
                                        .filter(|name| !name.is_empty())
                                })
                                .unwrap_or_else(|| "已恢复项目".to_string());
                            (p.id.clone(), p.target_path.clone(), name)
                        })
                        .collect()
                })
                .unwrap_or_default(),
            _ => vec![],
        };

        let total = projects_to_restore.len();
        let missing_rebuildable_indexes = manifest_version >= 2
            && projects_to_restore.iter().any(|(project_id, _, _)| {
                manifest_projects
                    .iter()
                    .find(|project| project.id == *project_id)
                    .map(|project| !project.sections.contains(&ProjectBackupSection::Indexes))
                    .unwrap_or(false)
            });

        for (idx, (project_id, target_path, project_name)) in projects_to_restore.iter().enumerate()
        {
            on_progress(&BackupProgressPayload {
                operation: "import".to_string(),
                stage: "restoring".to_string(),
                current: idx + 1,
                total: total.max(1),
                message: format!("正在恢复项目: {}", project_name),
            });

            let zip_prefix = format!("projects/{}/", project_id);
            let target = Path::new(target_path);

            fs::create_dir_all(target)
                .map_err(|e| format!("创建项目目录失败 {}: {e}", target.display()))?;

            match extract_dir_from_zip(&mut archive, &zip_prefix, target) {
                Ok(_count) => {
                    // 导入后自动迁移目录（wiki -> QM，.llm-wiki -> .qmai 等）
                    if let Err(e) = crate::commands::project::migrate_project_dirs(target) {
                        warnings.push(format!("项目 {} 目录迁移失败: {}", project_name, e));
                    }
                    project_results.push(ProjectRestoreResult {
                        id: project_id.clone(),
                        path: target_path.clone(),
                        name: project_name.clone(),
                        success: true,
                        error: None,
                    });
                }
                Err(e) => {
                    project_results.push(ProjectRestoreResult {
                        id: project_id.clone(),
                        path: target_path.clone(),
                        name: project_name.clone(),
                        success: false,
                        error: Some(e),
                    });
                }
            }
        }

        if missing_rebuildable_indexes {
            warnings.push(
                "备份未包含向量与检索索引；模型配置就绪后可在项目中重建索引".to_string(),
            );
        }
    }

    on_progress(&BackupProgressPayload {
        operation: "import".to_string(),
        stage: "done".to_string(),
        current: 1,
        total: 1,
        message: "导入完成".to_string(),
    });

    // 顶层 success：只有在没有任何项目恢复失败且无错误时才为 true
    let any_project_failed = project_results.iter().any(|p| !p.success);
    let overall_success = !any_project_failed;

    Ok(ImportResult {
        success: overall_success,
        app_state,
        local_storage_data,
        /*
         * ── 是否"整体替换"localStorage，只由 ui_preferences 决定 ──
         *
         * 原写法是 `manifest_version < 2 || manifest_contents.credentials`。
         * 用"这份备份里有没有密钥"去决定"要不要清空本机 localStorage"，
         * 这两件事本来没有关系，而且两个方向都会出错：
         *   · 勾了界面偏好、没勾密钥（很常见）→ credentials=false → 走"合并"，
         *     备份里已删除的旧键在本机残留，恢复结果不忠实；
         *   · 没勾界面偏好时 local-storage.json 根本不会被打包，
         *     却仍可能因为 credentials=true 而返回 true → 前端会把
         *     以 qmai 与 lk- 开头的键全部删掉，而**没有任何东西可以填回来**（净丢数据）。
         *
         * 正确的判据只有一个：这份备份是否**承载了** localStorage。
         * 承载了 → 整体替换（包括"备份里就是空的"这种忠实状态）；
         * 没承载 → 一个键都不许动。
         */
        replace_local_storage: manifest_version < 2 || manifest_contents.ui_preferences,
        projects: project_results,
        warnings,
        error: None,
    })
}

/// 读取备份文件中的 manifest.json，返回项目列表及路径可达性。
/// 不做实际解压，供前端在导入前检查路径。
///
/// 预览列表必须与导入时的恢复计划**一致**（同样合并 project-registry.json 里
/// 「清单没列、但 zip 里确实有数据」的项目）。否则会出现这种情况：
/// 导入会去恢复一个路径已失效的项目，而预览里没列出它、用户也就没机会选择新目录，
/// 结果那本书恢复失败 —— 用户看到的失败原因却是"路径不可用"，
/// 而他在上一步的对话框里根本没被问过。
pub fn do_read_backup_manifest(zip_path: &Path) -> Result<BackupManifestPreview, String> {
    if !zip_path.exists() {
        return Err("备份文件不存在".to_string());
    }

    let file = fs::File::open(zip_path).map_err(|e| format!("打开备份文件失败: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("读取备份文件失败，可能已损坏: {e}"))?;

    let manifest_bytes = extract_file_from_zip(&mut archive, "manifest.json")?
        .ok_or_else(|| "备份文件缺少 manifest.json".to_string())?;

    let manifest: BackupManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| format!("解析 manifest.json 失败: {e}"))?;

    let backup_version = manifest.backup_version;
    let contents = manifest.contents.unwrap_or_else(default_legacy_contents);
    let mut projects: Vec<ProjectManifestEntry> = manifest
        .projects
        .into_iter()
        .map(|mut project| {
            if backup_version < 2 && project.sections.is_empty() {
                project.sections = all_project_sections();
            }
            ProjectManifestEntry {
                id: project.id,
                path_accessible: is_path_root_accessible(&project.path),
                path: project.path,
                name: project.name,
                sections: project.sections,
            }
        })
        .collect();

    // 与导入端同源：registry 里记录、zip 里确有数据、但清单未列出的项目要补进来。
    if let Some(bytes) = extract_file_from_zip(&mut archive, "project-registry.json")? {
        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            let archive_ids = project_ids_in_archive(&archive);
            for entry in parse_project_registry(&value) {
                if projects.iter().any(|p| p.id == entry.id) || !archive_ids.contains(&entry.id) {
                    continue;
                }
                projects.push(ProjectManifestEntry {
                    id: entry.id,
                    path_accessible: is_path_root_accessible(&entry.path),
                    path: entry.path,
                    name: if entry.name.is_empty() {
                        "已恢复项目".to_string()
                    } else {
                        entry.name
                    },
                    // registry 不记录 section 粒度（它只回答"有哪些书"），
                    // 按"全部"处理：恢复多余的可重建数据远好过漏掉正文。
                    sections: all_project_sections(),
                });
            }
        }
    }

    Ok(BackupManifestPreview {
        backup_version,
        contents,
        projects,
    })
}

// ── Tauri commands ───────────────────────────────────────────────

#[tauri::command]
pub async fn export_backup(
    app: tauri::AppHandle,
    params: ExportParams,
) -> Result<ExportResult, String> {
    run_guarded("export_backup", || {
        // 先通过 plugin-store 保存，确保磁盘文件是最新内存状态
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|err| format!("无法获取 app_data_dir: {err}"))?;

        let app_state_path = match app_state::persist_plugin_store(&app) {
            Ok(path) => path,
            Err(e) => {
                eprintln!("保存 app-state 存储失败: {e}");
                app_data_dir.join("app-state.json")
            }
        };

        let app_clone = app.clone();
        do_export_backup(params, &app_state_path, move |payload| {
            emit_progress(
                &app_clone,
                &payload.operation,
                &payload.stage,
                payload.current,
                payload.total,
                &payload.message,
            );
        })
    })
}

#[tauri::command]
pub async fn import_backup(
    app: tauri::AppHandle,
    params: ImportParams,
) -> Result<ImportResult, String> {
    run_guarded("import_backup", || {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|err| format!("无法获取 app_data_dir: {err}"))?;

        app_state::persist_plugin_store(&app)
            .map_err(|error| format!("导入前保存当前应用状态失败: {error}"))?;

        let app_clone = app.clone();
        let result = do_import_backup(params, &app_data_dir, move |payload| {
            emit_progress(
                &app_clone,
                &payload.operation,
                &payload.stage,
                payload.current,
                payload.total,
                &payload.message,
            );
        })?;

        // 通过 plugin-store API 恢复，确保内存中的缓存状态也被替换，
        // 避免应用关闭/重启时旧状态覆盖导入的新状态。
        if let Some(ref app_state_json) = result.app_state {
            restore_app_state_via_store(&app, app_state_json)?;
        }

        Ok(result)
    })
}

#[tauri::command]
pub async fn read_backup_manifest(zip_path: String) -> Result<BackupManifestPreview, String> {
    run_guarded("read_backup_manifest", || {
        let path = Path::new(&zip_path);
        do_read_backup_manifest(path)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn unique_test_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("qmai_backup_{name}_{}", uuid::Uuid::new_v4()))
    }

    fn read_zip_entry(zip_path: &Path, entry_name: &str) -> String {
        let file = std::fs::File::open(zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let mut entry = archive.by_name(entry_name).unwrap();
        let mut contents = String::new();
        entry.read_to_string(&mut contents).unwrap();
        contents
    }

    #[test]
    fn export_v2_only_writes_selected_project_sections() {
        let tmp = unique_test_dir("selected_sections");
        let project = tmp.join("project");
        std::fs::create_dir_all(project.join("QM/chapters")).unwrap();
        std::fs::create_dir_all(project.join("raw/sources")).unwrap();
        std::fs::create_dir_all(project.join(".novel/snapshots")).unwrap();
        std::fs::create_dir_all(project.join("book-analysis/book-1")).unwrap();
        std::fs::create_dir_all(project.join(".qmai/lancedb")).unwrap();
        std::fs::create_dir_all(project.join("retrieval")).unwrap();
        std::fs::create_dir_all(project.join(".trash")).unwrap();
        std::fs::write(project.join("QM/chapters/chapter-1.md"), "正文").unwrap();
        std::fs::write(project.join("raw/sources/source.txt"), "资料").unwrap();
        std::fs::write(project.join("soul.md"), "灵魂").unwrap();
        std::fs::write(project.join(".novel/snapshots/001.md"), "快照").unwrap();
        std::fs::write(project.join("book-analysis/book-1/result.json"), "{}").unwrap();
        std::fs::write(project.join(".qmai/chat.json"), "{}").unwrap();
        std::fs::write(project.join(".qmai/lancedb/index.bin"), "index").unwrap();
        std::fs::write(project.join("retrieval/index.md"), "索引").unwrap();
        std::fs::write(project.join(".trash/deleted.md"), "删除").unwrap();

        let app_state = tmp.join("app-state.json");
        std::fs::write(&app_state, "{}").unwrap();
        let zip_path = tmp.join("selected.zip");
        let params = ExportParams {
            save_path: zip_path.to_string_lossy().to_string(),
            include_global_config: false,
            include_ui_preferences: false,
            include_credentials: false,
            local_storage_data: serde_json::json!({}),
            projects: vec![ProjectBackupInfo {
                id: "p1".to_string(),
                path: project.to_string_lossy().to_string(),
                name: "测试项目".to_string(),
                sections: vec![ProjectBackupSection::Content, ProjectBackupSection::Indexes],
            }],
        };

        do_export_backup(params, &app_state, |_| {}).unwrap();

        let file = std::fs::File::open(&zip_path).unwrap();
        let archive = zip::ZipArchive::new(file).unwrap();
        let names: Vec<String> = archive.file_names().map(str::to_string).collect();
        assert!(names
            .iter()
            .any(|name| name == "projects/p1/wiki/chapters/chapter-1.md"));
        assert!(names
            .iter()
            .any(|name| name == "projects/p1/raw/sources/source.txt"));
        assert!(names.iter().any(|name| name == "projects/p1/soul.md"));
        assert!(names
            .iter()
            .any(|name| name == "projects/p1/.qmai/lancedb/index.bin"));
        assert!(names
            .iter()
            .any(|name| name == "projects/p1/retrieval/index.md"));
        assert!(!names.iter().any(|name| name.contains("/.novel/")));
        assert!(!names.iter().any(|name| name.contains("/book-analysis/")));
        assert!(!names.iter().any(|name| name.ends_with("/.qmai/chat.json")));
        assert!(!names.iter().any(|name| name.contains("/.trash/")));
        assert!(!names.iter().any(|name| name == "global/app-state.json"));
        assert!(!names.iter().any(|name| name == "global/local-storage.json"));
    }

    #[test]
    fn export_memory_section_includes_memory_files_and_snapshots_without_chapters() {
        let tmp = unique_test_dir("memory_section");
        let project = tmp.join("project");
        std::fs::create_dir_all(project.join("QM/memory")).unwrap();
        std::fs::create_dir_all(project.join("QM/chapters")).unwrap();
        std::fs::create_dir_all(project.join(".novel/snapshots")).unwrap();
        std::fs::write(project.join("QM/memory/canon-facts.md"), "事实").unwrap();
        std::fs::write(project.join("QM/chapters/chapter-1.md"), "正文").unwrap();
        std::fs::write(project.join(".novel/snapshots/001.md"), "快照").unwrap();
        let app_state = tmp.join("app-state.json");
        std::fs::write(&app_state, "{}").unwrap();
        let zip_path = tmp.join("memory.zip");

        do_export_backup(
            ExportParams {
                save_path: zip_path.to_string_lossy().to_string(),
                include_global_config: false,
                include_ui_preferences: false,
                include_credentials: false,
                local_storage_data: serde_json::json!({}),
                projects: vec![ProjectBackupInfo {
                    id: "p1".to_string(),
                    path: project.to_string_lossy().to_string(),
                    name: "测试项目".to_string(),
                    sections: vec![ProjectBackupSection::Memory],
                }],
            },
            &app_state,
            |_| {},
        )
        .unwrap();

        let file = std::fs::File::open(&zip_path).unwrap();
        let archive = zip::ZipArchive::new(file).unwrap();
        let names: Vec<String> = archive.file_names().map(str::to_string).collect();
        assert!(names
            .iter()
            .any(|name| name == "projects/p1/wiki/memory/canon-facts.md"));
        assert!(names
            .iter()
            .any(|name| name == "projects/p1/.novel/snapshots/001.md"));
        assert!(!names
            .iter()
            .any(|name| name == "projects/p1/wiki/chapters/chapter-1.md"));

        let restore_dir = tmp.join("restore");
        let mut path_overrides = std::collections::HashMap::new();
        path_overrides.insert("p1".to_string(), restore_dir.to_string_lossy().to_string());
        let import_result = do_import_backup(
            ImportParams {
                zip_path: zip_path.to_string_lossy().to_string(),
                strategy: ImportStrategy::Full,
                projects: None,
                project_path_overrides: Some(path_overrides),
            },
            &tmp.join("app-data"),
            |_| {},
        )
        .unwrap();
        assert!(import_result
            .warnings
            .iter()
            .any(|warning| warning.contains("未包含向量与检索索引")));
        assert!(import_result
            .warnings
            .iter()
            .any(|warning| warning.contains("不包含全局配置或界面偏好")));
    }

    #[test]
    fn export_v2_removes_credentials_and_unselected_ui_preferences() {
        let tmp = unique_test_dir("credentials");
        let project = tmp.join("project");
        std::fs::create_dir_all(project.join(".qmai")).unwrap();
        std::fs::write(
            project.join(".qmai/rerank-config.json"),
            r#"{"apiKey":"rerank-secret","model":"rerank-model"}"#,
        )
        .unwrap();
        let app_state = tmp.join("app-state.json");
        std::fs::write(
            &app_state,
            r#"{"llmConfig":{"apiKey":"main-secret","model":"gpt"},"providerConfigs":{"custom":{"api_key":"nested-secret"}},"theme":"dark"}"#,
        )
        .unwrap();
        let zip_path = tmp.join("credentials.zip");
        let params = ExportParams {
            save_path: zip_path.to_string_lossy().to_string(),
            include_global_config: true,
            include_ui_preferences: false,
            include_credentials: false,
            local_storage_data: serde_json::json!({
                "qmai_fallback_fingerprint": "browser-secret",
                "qmai-ui-density": "compact"
            }),
            projects: vec![ProjectBackupInfo {
                id: "p1".to_string(),
                path: project.to_string_lossy().to_string(),
                name: "测试项目".to_string(),
                sections: vec![ProjectBackupSection::Analysis],
            }],
        };

        do_export_backup(params, &app_state, |_| {}).unwrap();

        let global: serde_json::Value =
            serde_json::from_str(&read_zip_entry(&zip_path, "global/app-state.json")).unwrap();
        assert_eq!(global["llmConfig"]["model"], "gpt");
        assert!(global["llmConfig"].get("apiKey").is_none());
        assert!(global["providerConfigs"]["custom"].get("api_key").is_none());
        assert!(global.get("theme").is_none());

        let rerank: serde_json::Value = serde_json::from_str(&read_zip_entry(
            &zip_path,
            "projects/p1/.qmai/rerank-config.json",
        ))
        .unwrap();
        assert_eq!(rerank["model"], "rerank-model");
        assert!(rerank.get("apiKey").is_none());

        let manifest: BackupManifest =
            serde_json::from_str(&read_zip_entry(&zip_path, "manifest.json")).unwrap();
        assert_eq!(manifest.backup_version, 2);
        let contents = manifest.contents.unwrap();
        assert!(contents.global_config);
        assert!(!contents.ui_preferences);
        assert!(!contents.credentials);
    }

    #[test]
    fn import_v2_partial_global_state_preserves_unselected_values_and_credentials() {
        let tmp = unique_test_dir("merge_v2");
        std::fs::create_dir_all(&tmp).unwrap();
        let source_state = tmp.join("source-app-state.json");
        std::fs::write(
            &source_state,
            r#"{"llmConfig":{"apiKey":"source-secret","model":"new-model","maxContextSize":120000},"theme":"light"}"#,
        )
        .unwrap();
        let zip_path = tmp.join("partial-v2.zip");
        do_export_backup(
            ExportParams {
                save_path: zip_path.to_string_lossy().to_string(),
                include_global_config: true,
                include_ui_preferences: false,
                include_credentials: false,
                local_storage_data: serde_json::json!({}),
                projects: vec![],
            },
            &source_state,
            |_| {},
        )
        .unwrap();

        let target_dir = tmp.join("target");
        std::fs::create_dir_all(&target_dir).unwrap();
        std::fs::write(
            target_dir.join("app-state.json"),
            r#"{"llmConfig":{"apiKey":"existing-secret","model":"old-model"},"theme":"dark"}"#,
        )
        .unwrap();

        let result = do_import_backup(
            ImportParams {
                zip_path: zip_path.to_string_lossy().to_string(),
                strategy: ImportStrategy::Full,
                projects: None,
                project_path_overrides: None,
            },
            &target_dir,
            |_| {},
        )
        .unwrap();

        let app_state = result.app_state.unwrap();
        assert_eq!(app_state["llmConfig"]["model"], "new-model");
        assert_eq!(app_state["llmConfig"]["maxContextSize"], 120000);
        assert_eq!(app_state["llmConfig"]["apiKey"], "existing-secret");
        assert_eq!(app_state["theme"], "dark");
        assert!(!result.replace_local_storage);
    }

    #[test]
    fn import_v1_keeps_legacy_replace_semantics_and_manifest_defaults() {
        let tmp = unique_test_dir("legacy_v1");
        std::fs::create_dir_all(&tmp).unwrap();
        let zip_path = tmp.join("legacy-v1.zip");
        let zip_file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(zip_file);
        let options = SimpleFileOptions::default();
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(
            r#"{"backup_version":1,"created_at":"2026-07-18T00:00:00Z","app_version":"2.2.36","projects":[{"id":"p1","path":"C:/Legacy","name":"旧项目"}]}"#
                .as_bytes(),
        )
        .unwrap();
        zip.start_file("global/app-state.json", options).unwrap();
        zip.write_all(br#"{"llmConfig":{"model":"legacy-model"}}"#)
            .unwrap();
        zip.start_file("global/local-storage.json", options)
            .unwrap();
        zip.write_all(br#"{"qmai-ui-density":"legacy"}"#).unwrap();
        zip.finish().unwrap();

        let preview = do_read_backup_manifest(&zip_path).unwrap();
        assert_eq!(preview.backup_version, 1);
        assert!(preview.contents.global_config);
        assert!(preview.contents.ui_preferences);
        assert!(preview.contents.credentials);
        assert_eq!(preview.projects[0].sections.len(), 5);
        let preview_json = serde_json::to_value(&preview).unwrap();
        assert_eq!(preview_json["contents"]["globalConfig"], true);
        assert!(preview_json["contents"].get("global_config").is_none());

        let target_dir = tmp.join("target");
        std::fs::create_dir_all(&target_dir).unwrap();
        std::fs::write(
            target_dir.join("app-state.json"),
            r#"{"theme":"dark","llmConfig":{"model":"current"}}"#,
        )
        .unwrap();
        let result = do_import_backup(
            ImportParams {
                zip_path: zip_path.to_string_lossy().to_string(),
                strategy: ImportStrategy::GlobalOnly,
                projects: None,
                project_path_overrides: None,
            },
            &target_dir,
            |_| {},
        )
        .unwrap();

        let app_state = result.app_state.unwrap();
        assert_eq!(app_state["llmConfig"]["model"], "legacy-model");
        assert!(app_state.get("theme").is_none());
        assert!(result.replace_local_storage);
    }

    /*
     * ── 以下是本轮"导出备份审计"修复的守护用例 ──
     *
     * 每条都对应一个**用户可感知**的故障，而不只是内部实现细节：
     * 覆盖旧备份 / 文件数不对 / 项目配置丢失 / 一本书读不出来就整份失败 /
     * 恢复后书架为空 / 该替换的没替换。改动这些行为前请先读对应用例的注释。
     */

    /// D2：导出必须"要么旧备份完好，要么新备份完整"，失败不得留下残骸。
    ///
    /// 造错手法：把临时文件名做成一个**已存在的目录**，`File::create` 必定失败。
    /// 这样就能在不依赖权限/磁盘满的前提下，稳定地走到失败清理分支。
    #[test]
    fn export_failure_keeps_existing_backup_and_removes_partial_file() {
        let tmp = unique_test_dir("atomic_export");
        let project = tmp.join("project");
        std::fs::create_dir_all(project.join("QM")).unwrap();
        std::fs::write(project.join("QM/chapter.md"), "正文").unwrap();

        let target = tmp.join("backup.zip");
        std::fs::write(&target, "旧备份的内容，必须原样保留").unwrap();
        // 占位目录：让写临时文件这一步失败
        std::fs::create_dir_all(partial_path_for(&target)).unwrap();

        let app_state = tmp.join("app-state.json");
        std::fs::write(&app_state, "{}").unwrap();
        let error = do_export_backup(
            ExportParams {
                save_path: target.to_string_lossy().to_string(),
                include_global_config: false,
                include_ui_preferences: false,
                include_credentials: false,
                local_storage_data: serde_json::json!({}),
                projects: vec![ProjectBackupInfo {
                    id: "p1".to_string(),
                    path: project.to_string_lossy().to_string(),
                    name: "测试项目".to_string(),
                    sections: vec![ProjectBackupSection::Content],
                }],
            },
            &app_state,
            |_| {},
        )
        .unwrap_err();

        assert!(error.contains("临时文件"), "错误信息应指出写临时文件失败：{error}");
        assert_eq!(
            std::fs::read_to_string(&target).unwrap(),
            "旧备份的内容，必须原样保留",
            "导出失败绝不能动到目标路径上已有的备份"
        );
    }

    /// D2 的另一半：成功时临时文件必须消失（否则用户会看到一堆 .part 垃圾）。
    #[test]
    fn successful_export_leaves_no_partial_file() {
        let tmp = unique_test_dir("no_partial_left");
        std::fs::create_dir_all(&tmp).unwrap();
        let app_state = tmp.join("app-state.json");
        std::fs::write(&app_state, "{}").unwrap();
        let target = tmp.join("ok.zip");

        do_export_backup(
            ExportParams {
                save_path: target.to_string_lossy().to_string(),
                include_global_config: false,
                include_ui_preferences: false,
                include_credentials: false,
                local_storage_data: serde_json::json!({}),
                projects: vec![],
            },
            &app_state,
            |_| {},
        )
        .unwrap();

        assert!(target.exists());
        assert!(
            !partial_path_for(&target).exists(),
            "成功导出后不应残留临时文件"
        );
    }

    /// D2 的第三个面：**覆盖**已有备份必须真的生效。
    ///
    /// 这是最常走的路径（用户第二次导出到同一个文件名），也是原子改写最容易
    /// 在 Windows 上出问题的地方：改名到已存在的目标如果失败，
    /// "覆盖备份"就会变成一个永远失败的按钮。用例直接断言旧内容被新 zip 替换。
    #[test]
    fn successful_export_overwrites_existing_backup() {
        let tmp = unique_test_dir("overwrite_existing");
        std::fs::create_dir_all(&tmp).unwrap();
        let app_state = tmp.join("app-state.json");
        std::fs::write(&app_state, "{}").unwrap();
        let target = tmp.join("reused.zip");

        // 先放一个"旧备份"占住目标路径
        std::fs::write(&target, "不是 zip，只是占位").unwrap();

        let result = do_export_backup(
            ExportParams {
                save_path: target.to_string_lossy().to_string(),
                include_global_config: false,
                include_ui_preferences: false,
                include_credentials: false,
                local_storage_data: serde_json::json!({}),
                projects: vec![],
            },
            &app_state,
            |_| {},
        )
        .expect("覆盖已有备份必须成功");

        assert!(result.success);
        assert!(result.total_size > 0);
        // 能作为 zip 打开 = 旧内容确实被完整的新备份替换了
        let file = std::fs::File::open(&target).unwrap();
        let mut archive = zip::ZipArchive::new(file).expect("覆盖后应是有效 zip");
        assert!(archive.by_name("manifest.json").is_ok());
        assert!(!partial_path_for(&target).exists());
    }

    /// D8：file_count 要把 manifest.json 与 project-registry.json 也算进去。
    ///
    /// 这个数字直接显示给用户（「共 N 个文件」），少 2 会让人以为备份缺文件。
    /// 这里刻意选"不含全局配置、不含界面偏好、无项目"的最小组合：
    /// zip 里只有 manifest.json 和 project-registry.json 两个条目。
    #[test]
    fn export_file_count_includes_manifest_and_registry() {
        let tmp = unique_test_dir("file_count");
        std::fs::create_dir_all(&tmp).unwrap();
        let app_state = tmp.join("app-state.json");
        std::fs::write(&app_state, "{}").unwrap();
        let target = tmp.join("count.zip");

        let result = do_export_backup(
            ExportParams {
                save_path: target.to_string_lossy().to_string(),
                include_global_config: false,
                include_ui_preferences: false,
                include_credentials: false,
                local_storage_data: serde_json::json!({}),
                projects: vec![],
            },
            &app_state,
            |_| {},
        )
        .unwrap();

        let file = std::fs::File::open(&target).unwrap();
        let archive = zip::ZipArchive::new(file).unwrap();
        let total_entries = archive
            .file_names()
            .filter(|name| !name.ends_with('/'))
            .count();
        assert_eq!(
            result.file_count, 2,
            "无项目、无全局配置时应只有 manifest.json 与 project-registry.json"
        );
        assert_eq!(
            result.file_count, total_entries,
            "file_count 必须等于 zip 里真实文件条目数"
        );
    }

    /// D6：项目的配置、身份与手工记录属于项目自身，**不**该被"拆书分析"这个勾选决定去留。
    ///
    /// 只勾「正文」时下面这些必须在，而 lancedb（索引）与 chat.json（AI 工作数据）必须不在
    /// —— 后者被顺带带出就违背了用户在对话框里做的选择。
    ///
    /// 逐个都对应真实的丢失场景，尤其 project.json：它是项目身份的随机 UUID，
    /// 丢了它，打开项目会生成新 id，而按项目 id 索引的
    /// projectNovelConfigs / projectRerankConfigs / projectLastReadChapters /
    /// sourceWatchConfig / projectRevisionFeedbackWindowConfigs 会一起失联。
    #[test]
    fn export_project_config_and_covers_follow_project_without_analysis() {
        let tmp = unique_test_dir("meta_config");
        let project = tmp.join("project");
        std::fs::create_dir_all(project.join("QM")).unwrap();
        std::fs::create_dir_all(project.join(".qmai/covers")).unwrap();
        std::fs::create_dir_all(project.join(".qmai/lancedb")).unwrap();
        std::fs::create_dir_all(project.join(".qmai/page-history")).unwrap();
        std::fs::write(project.join("QM/chapter.md"), "正文").unwrap();
        for name in EXPECTED_OWNED_FILES {
            std::fs::write(project.join(format!(".qmai/{name}")), "{}").unwrap();
        }
        std::fs::write(project.join(".qmai/covers/cover.png"), "封面").unwrap();
        std::fs::write(project.join(".qmai/chat.json"), "{}").unwrap();
        std::fs::write(project.join(".qmai/page-history/h1.json"), "{}").unwrap();
        std::fs::write(project.join(".qmai/lancedb/index.bin"), "索引").unwrap();

        let app_state = tmp.join("app-state.json");
        std::fs::write(&app_state, "{}").unwrap();
        let target = tmp.join("meta.zip");
        do_export_backup(
            ExportParams {
                save_path: target.to_string_lossy().to_string(),
                include_global_config: false,
                include_ui_preferences: false,
                // 用 true 避免 JSON 清洗掩盖"文件在不在"的判断
                include_credentials: true,
                local_storage_data: serde_json::json!({}),
                projects: vec![ProjectBackupInfo {
                    id: "p1".to_string(),
                    path: project.to_string_lossy().to_string(),
                    name: "测试项目".to_string(),
                    // 只勾「正文」——没有 analysis、没有 indexes
                    sections: vec![ProjectBackupSection::Content],
                }],
            },
            &app_state,
            |_| {},
        )
        .unwrap();

        let names: Vec<String> = {
            let file = std::fs::File::open(&target).unwrap();
            let archive = zip::ZipArchive::new(file).unwrap();
            archive.file_names().map(str::to_string).collect()
        };
        for name in EXPECTED_OWNED_FILES {
            let expected = format!("projects/p1/.qmai/{name}");
            assert!(
                names.iter().any(|item| item == &expected),
                "项目自身文件必须随项目一起备份：缺 {expected}"
            );
        }
        assert!(
            names.iter().any(|item| item == "projects/p1/.qmai/covers/cover.png"),
            "封面必须随项目一起备份"
        );
        assert!(
            !names.iter().any(|item| item.contains("/.qmai/lancedb/")),
            "没勾索引时不该带出 lancedb"
        );
        assert!(
            !names.iter().any(|item| item.ends_with("/.qmai/chat.json")),
            "没勾分析时不该带出 AI 工作数据"
        );
        assert!(
            !names.iter().any(|item| item.contains("/.qmai/page-history/")),
            "没勾分析时不该带出页面历史这类工作数据"
        );
    }

    /*
     * 这份**字面**清单是刻意的：守护用例的期望值不能从被守护的常量里推导出来，
     * 否则"把 project.json 从常量里删掉"会让用例一起通过 —— 等于没守。
     * 下面每个名字都对应一个具体的丢失后果，删任何一个都必须让用例红。
     */
    const EXPECTED_OWNED_FILES: &[&str] = &[
        // 项目身份 UUID：丢了它，恢复后所有按项目 id 索引的设置会失联
        "project.json",
        // 用户手工建立的写作风格 / 灵魂风格预设
        "writing-style.json",
        "project-soul-styles.json",
        // 用户逐条点出来的判断
        "bindable-characters-ignore.json",
        "foreshadowing-keep.json",
        "dedup-not-duplicates.json",
        // 项目级功能配置
        "novel-config.json",
        "source-watch-config.json",
        "revision-feedback-config.json",
        "rerank-config.json",
        // 文风自进化的开关与「打开日」进度：丢了它，恢复后功能被关回默认、
        // 打开日计数归零，用户先前攒的 3~5 个打开日白等
        "style-evolution.json",
    ];

    #[test]
    fn project_owned_files_cover_every_irreplaceable_project_file() {
        for name in EXPECTED_OWNED_FILES {
            assert!(
                PROJECT_OWNED_FILES.contains(name),
                "{name} 必须列入 PROJECT_OWNED_FILES，否则不勾「拆书分析」时它会丢失"
            );
            assert!(
                is_project_owned_entry(name),
                "{name} 必须被 is_project_owned_entry 认作项目自身文件"
            );
        }
    }

    /// D6 的边界：只在 `.qmai/` **直接子项**里认项目自身文件。
    ///
    /// 子目录里出现同名文件不能被误判成项目身份 —— 否则一个分析产物里的
    /// `project.json` 就会绕过"不勾分析"的选择被带出去。
    #[test]
    fn project_owned_match_only_applies_to_direct_children() {
        assert!(is_project_owned_entry("covers"));
        assert!(is_project_owned_entry("covers/cover.png"));
        assert!(!is_project_owned_entry("nested/project.json"));
        assert!(!is_project_owned_entry("page-history/writing-style.json"));
        assert!(!is_project_owned_entry("lancedb/index.bin"));
        assert!(!is_project_owned_entry("chat.json"));
        // 前缀相近的名字不能被宽松匹配吃掉
        assert!(!is_project_owned_entry("covers-extra/cover.png"));
        assert!(!is_project_owned_entry("project.json.bak"));
    }

    /// D1：`project-registry.json` 必须被导入端真的读掉。
    ///
    /// 场景还原：manifest 只列了 A（例如备份来自更早版本 / 清单被截断），
    /// 而 registry 记得 A 与 B，zip 里两本书的数据都在。
    /// 只信 manifest 就会**少恢复一本书**，用户看到的是"我备份了两本只回来一本"。
    /// registry 里还故意放一个 zip 里没有数据的 C：它必须被跳过并给出警告，
    /// 否则会建出一个空项目目录，书架多一本打不开的书。
    #[test]
    fn import_restores_projects_listed_only_in_registry() {
        let tmp = unique_test_dir("registry_restore");
        std::fs::create_dir_all(&tmp).unwrap();
        let zip_path = tmp.join("registry.zip");
        let zip_file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(zip_file);
        let options = SimpleFileOptions::default();
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(
            r#"{"backup_version":2,"created_at":"2026-10-10T00:00:00Z","app_version":"4.2.0","contents":{"globalConfig":false,"uiPreferences":false,"credentials":false},"projects":[{"id":"A","path":"","name":"第一本"}]}"#
                .as_bytes(),
        )
        .unwrap();
        zip.start_file("project-registry.json", options).unwrap();
        zip.write_all(
            r#"{"projects":[{"id":"A","path":"","name":"第一本"},{"id":"B","path":"","name":"第二本"},{"id":"C","path":"","name":"没有数据的那本"}]}"#
                .as_bytes(),
        )
        .unwrap();
        for (id, file) in [("A", "a.md"), ("B", "b.md")] {
            zip.start_file(format!("projects/{id}/wiki/{file}"), options)
                .unwrap();
            zip.write_all(b"chapter").unwrap();
        }
        zip.finish().unwrap();

        let target_dir = tmp.join("target");
        std::fs::create_dir_all(&target_dir).unwrap();
        let a_dir = tmp.join("books/A");
        let b_dir = tmp.join("books/B");
        let overrides = std::collections::HashMap::from([
            ("A".to_string(), a_dir.to_string_lossy().to_string()),
            ("B".to_string(), b_dir.to_string_lossy().to_string()),
        ]);

        let result = do_import_backup(
            ImportParams {
                zip_path: zip_path.to_string_lossy().to_string(),
                strategy: ImportStrategy::Full,
                projects: None,
                project_path_overrides: Some(overrides),
            },
            &target_dir,
            |_| {},
        )
        .unwrap();

        let ids: Vec<&str> = result.projects.iter().map(|p| p.id.as_str()).collect();
        assert!(ids.contains(&"A"), "manifest 里的项目必须恢复：{ids:?}");
        assert!(
            ids.contains(&"B"),
            "只在 registry 里出现的项目也必须恢复（这正是它此前是死数据的地方）：{ids:?}"
        );
        assert!(
            !ids.contains(&"C"),
            "zip 里没有数据的项目不能被恢复成空目录：{ids:?}"
        );
        assert!(
            result
                .warnings
                .iter()
                .any(|w| w.contains("没有数据的那本")),
            "跳过的项目必须给出警告，不能静默丢：{:?}",
            result.warnings
        );
        let b = result.projects.iter().find(|p| p.id == "B").unwrap();
        assert_eq!(b.name, "第二本", "名称应取自 registry");
        assert_eq!(b.path, b_dir.to_string_lossy(), "路径应应用重映射");
        /*
         * 落盘位置用"递归找文件名"而不是写死 QString 路径：
         * 导入后会自动跑 migrate_project_dirs，知识目录可能从 wiki 被改名成 QM。
         * 钉住具体目录名会让这条用例在无关的目录迁移改动上误报。
         */
        let landed = WalkDir::new(&b_dir)
            .into_iter()
            .filter_map(|entry| entry.ok())
            .any(|entry| entry.file_name() == "b.md");
        assert!(landed, "B 的文件要真的落盘到 {}", b_dir.display());
    }

    /// D7：是否整体替换 localStorage，由「这份备份是否承载了 localStorage」决定。
    ///
    /// 老判据用的是 `credentials`：勾了界面偏好但没勾密钥时（很常见）会走"合并"，
    /// 备份里删掉的旧键在本机残留，恢复结果不忠实。
    #[test]
    fn import_replaces_local_storage_when_backup_carried_ui_preferences() {
        let tmp = unique_test_dir("replace_by_ui_prefs");
        std::fs::create_dir_all(&tmp).unwrap();
        let zip_path = tmp.join("ui-prefs.zip");
        let zip_file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(zip_file);
        let options = SimpleFileOptions::default();
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(
            br#"{"backup_version":2,"created_at":"2026-10-10T00:00:00Z","app_version":"4.2.0","contents":{"globalConfig":false,"uiPreferences":true,"credentials":false},"projects":[]}"#,
        )
        .unwrap();
        zip.start_file("global/local-storage.json", options).unwrap();
        zip.write_all(br#"{"qm-uitest-skin":"zhi"}"#).unwrap();
        zip.finish().unwrap();

        let target_dir = tmp.join("target");
        std::fs::create_dir_all(&target_dir).unwrap();
        let result = do_import_backup(
            ImportParams {
                zip_path: zip_path.to_string_lossy().to_string(),
                strategy: ImportStrategy::GlobalOnly,
                projects: None,
                project_path_overrides: None,
            },
            &target_dir,
            |_| {},
        )
        .unwrap();

        assert!(
            result.replace_local_storage,
            "备份带了界面偏好（含 localStorage）就必须整体替换，哪怕它不含密钥"
        );
    }

    /// D7 的反向：备份**没**承载 localStorage 时，一个键都不许动。
    ///
    /// 这条是防数据丢失的：老判据在这种情况下可能返回 true，
    /// 前端会把本机所有 qmai*/lk- 键删掉，而备份里没有任何东西能填回来。
    #[test]
    fn import_never_replaces_local_storage_when_backup_omitted_ui_preferences() {
        let tmp = unique_test_dir("no_replace_without_ui_prefs");
        std::fs::create_dir_all(&tmp).unwrap();
        let zip_path = tmp.join("no-ui-prefs.zip");
        let zip_file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(zip_file);
        let options = SimpleFileOptions::default();
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(
            br#"{"backup_version":2,"created_at":"2026-10-10T00:00:00Z","app_version":"4.2.0","contents":{"globalConfig":true,"uiPreferences":false,"credentials":true},"projects":[]}"#,
        )
        .unwrap();
        zip.start_file("global/app-state.json", options).unwrap();
        zip.write_all(br#"{"llmConfig":{"model":"restored"}}"#).unwrap();
        zip.finish().unwrap();

        let target_dir = tmp.join("target");
        std::fs::create_dir_all(&target_dir).unwrap();
        let result = do_import_backup(
            ImportParams {
                zip_path: zip_path.to_string_lossy().to_string(),
                strategy: ImportStrategy::GlobalOnly,
                projects: None,
                project_path_overrides: None,
            },
            &target_dir,
            |_| {},
        )
        .unwrap();

        assert!(
            !result.replace_local_storage,
            "备份没有 localStorage 内容时不许整体替换（否则等于清空本机偏好）"
        );
        assert!(
            result.local_storage_data.is_none(),
            "没有 local-storage.json 时不该凭空造出一份空的"
        );
    }

    /// D3：一本书读不出来，不能让整份备份失败。
    ///
    /// Windows 上可以精确制造"读不了"：用 `share_mode(0)` 独占打开目标文件，
    /// 随后 `File::open` 会失败。这样测的是**真实机制**，而不是断言代码长什么样。
    #[cfg(windows)]
    #[test]
    fn export_skips_unreadable_project_file_with_warning() {
        use std::os::windows::fs::OpenOptionsExt;

        let tmp = unique_test_dir("unreadable_file");
        let project = tmp.join("project");
        std::fs::create_dir_all(project.join("QM")).unwrap();
        std::fs::write(project.join("QM/chapter.md"), "正文").unwrap();
        // 让 soul.md 变成"存在但打不开"
        std::fs::write(project.join("soul.md"), "灵魂").unwrap();
        let exclusive = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(project.join("soul.md"))
            .unwrap();

        let app_state = tmp.join("app-state.json");
        std::fs::write(&app_state, "{}").unwrap();
        let target = tmp.join("unreadable.zip");
        let result = do_export_backup(
            ExportParams {
                save_path: target.to_string_lossy().to_string(),
                include_global_config: false,
                include_ui_preferences: false,
                include_credentials: false,
                local_storage_data: serde_json::json!({}),
                projects: vec![ProjectBackupInfo {
                    id: "p1".to_string(),
                    path: project.to_string_lossy().to_string(),
                    name: "测试项目".to_string(),
                    sections: vec![ProjectBackupSection::Content],
                }],
            },
            &app_state,
            |_| {},
        )
        .expect("一个文件读不出来不应导致整份备份失败");

        drop(exclusive);

        assert!(
            result.warnings.iter().any(|w| w.contains("soul.md")),
            "必须明确告知哪个文件被跳过：{:?}",
            result.warnings
        );
        assert!(target.exists(), "备份文件仍然要产出");
        let names: Vec<String> = {
            let file = std::fs::File::open(&target).unwrap();
            let archive = zip::ZipArchive::new(file).unwrap();
            archive.file_names().map(str::to_string).collect()
        };
        assert!(
            names.iter().any(|n| n.ends_with("/chapter.md")),
            "同一本书里能读的文件必须照常备份：{names:?}"
        );
    }

    /// D4：正文字体与排版属于「界面与软件偏好」，不属于「模型与 AI 配置」。
    ///
    /// 这条直接测 `filter_app_state` 的分流结果 —— 也就是用户在导出对话框里
    /// 勾选什么、备份里就有什么。之前 6 个 uiBody* 键不在表里，于是：
    ///   · 勾界面偏好 / 不勾全局配置 → 字号行高边距全丢（对话框却写了会备份"字体…布局偏好"）；
    ///   · 只勾全局配置 → 这些纯界面设置反而被带走。
    /// 两个方向都必须挡住，所以下面同时断言语义的两面。
    #[test]
    fn filter_app_state_routes_body_typography_to_ui_preferences() {
        let body_keys = [
            "uiBodyFontFamily",
            "uiBodyFontPx",
            "uiBodyLineHeight",
            "uiBodyLetterSpacing",
            "uiBodyMarginX",
            "uiBodySafeBottom",
            "uiBodyFontSizeScale",
        ];
        let mut state = serde_json::json!({ "llmConfig": { "model": "m" }, "theme": "dark" });
        for key in body_keys {
            state[key] = serde_json::json!(18);
        }

        // 只勾「界面与软件偏好」
        let ui_only = filter_app_state(state.clone(), false, true, false).unwrap();
        for key in body_keys {
            assert!(
                ui_only.get(key).is_some(),
                "勾了界面偏好就必须备份正文字体/排版设置，缺 {key}"
            );
        }
        assert!(
            ui_only.get("llmConfig").is_none(),
            "没勾全局配置时不该带出模型配置"
        );

        // 只勾「模型与 AI 配置」
        let global_only = filter_app_state(state, true, false, false).unwrap();
        assert!(
            global_only.get("llmConfig").is_some(),
            "勾了全局配置就要有模型配置"
        );
        for key in body_keys {
            assert!(
                global_only.get(key).is_none(),
                "{key} 是界面偏好，不该混进「模型与 AI 配置」"
            );
        }
    }

    /// D9：含凭据的备份必须在导出结果里留一条持久警告。
    #[test]
    fn export_with_credentials_warns_about_plaintext_secrets() {
        let tmp = unique_test_dir("credential_warning");
        std::fs::create_dir_all(&tmp).unwrap();
        let app_state = tmp.join("app-state.json");
        std::fs::write(&app_state, r#"{"llmConfig":{"apiKey":"sk-secret"}}"#).unwrap();
        let target = tmp.join("with-creds.zip");

        let result = do_export_backup(
            ExportParams {
                save_path: target.to_string_lossy().to_string(),
                include_global_config: true,
                include_ui_preferences: true,
                include_credentials: true,
                local_storage_data: serde_json::json!({}),
                projects: vec![],
            },
            &app_state,
            |_| {},
        )
        .unwrap();

        assert!(
            result
                .warnings
                .iter()
                .any(|w| w.contains("未加密") && w.contains("凭据")),
            "含凭据的备份必须给出明文警告：{:?}",
            result.warnings
        );
    }

    /// D9 的反向：不含凭据时不该出现这条警告（否则警告会变成噪声，用户学会忽略它）。
    #[test]
    fn export_without_credentials_has_no_plaintext_warning() {
        let tmp = unique_test_dir("no_credential_warning");
        std::fs::create_dir_all(&tmp).unwrap();
        let app_state = tmp.join("app-state.json");
        std::fs::write(&app_state, "{}").unwrap();
        let target = tmp.join("no-creds.zip");

        let result = do_export_backup(
            ExportParams {
                save_path: target.to_string_lossy().to_string(),
                include_global_config: false,
                include_ui_preferences: false,
                include_credentials: false,
                local_storage_data: serde_json::json!({}),
                projects: vec![],
            },
            &app_state,
            |_| {},
        )
        .unwrap();

        assert!(
            !result.warnings.iter().any(|w| w.contains("未加密")),
            "不含凭据时不该出现明文警告：{:?}",
            result.warnings
        );
    }

    /// D1 的预览面：`read_backup_manifest` 的列表必须与导入计划一致。
    ///
    /// 不一致的后果很具体：导入会去恢复一个路径已失效的项目，
    /// 而预览里没列出它 → 用户没被问到新目录 → 那本书恢复失败。
    #[test]
    fn backup_manifest_preview_includes_registry_only_projects() {
        let tmp = unique_test_dir("preview_registry");
        std::fs::create_dir_all(&tmp).unwrap();
        let zip_path = tmp.join("preview.zip");
        let zip_file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(zip_file);
        let options = SimpleFileOptions::default();
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(
            r#"{"backup_version":2,"created_at":"2026-10-10T00:00:00Z","app_version":"4.2.0","contents":{"globalConfig":false,"uiPreferences":false,"credentials":false},"projects":[{"id":"A","path":"","name":"第一本"}]}"#
                .as_bytes(),
        )
        .unwrap();
        zip.start_file("project-registry.json", options).unwrap();
        zip.write_all(
            r#"{"projects":[{"id":"B","path":"Z:/definitely-missing","name":"第二本"},{"id":"C","path":"","name":"没有数据的那本"}]}"#
                .as_bytes(),
        )
        .unwrap();
        zip.start_file("projects/B/wiki/b.md", options).unwrap();
        zip.write_all(b"chapter").unwrap();
        zip.finish().unwrap();

        let preview = do_read_backup_manifest(&zip_path).unwrap();
        let ids: Vec<&str> = preview.projects.iter().map(|p| p.id.as_str()).collect();
        assert!(ids.contains(&"A"), "manifest 里的项目要在预览里：{ids:?}");
        assert!(
            ids.contains(&"B"),
            "registry 里记录、zip 里有数据的项目也要在预览里：{ids:?}"
        );
        assert!(
            !ids.contains(&"C"),
            "zip 里没有数据的项目不该出现在预览里：{ids:?}"
        );
        // 路径不可达要在预览阶段就暴露，前端才知道要弹"选择新目录"
        let b = preview.projects.iter().find(|p| p.id == "B").unwrap();
        assert!(!b.path_accessible, "失效路径必须标记为不可达");
        assert_eq!(b.name, "第二本");
    }

    /// D6/D9 交叉：不勾凭据时，**每一份**项目配置都要剔除敏感字段。
    ///
    /// 原先只有 rerank-config.json 被清洗，保护逻辑与"哪个文件名"绑死。
    /// 这条用例把密钥同时放进两个配置文件，确认整组都受保护 ——
    /// 否则用户取消了「API Key 和其他凭据」，备份里却仍然带着明文密钥。
    #[test]
    fn export_strips_credentials_from_every_project_config() {
        let tmp = unique_test_dir("config_credentials");
        let project = tmp.join("project");
        std::fs::create_dir_all(project.join("QM")).unwrap();
        std::fs::create_dir_all(project.join(".qmai")).unwrap();
        std::fs::write(project.join("QM/chapter.md"), "正文").unwrap();
        std::fs::write(
            project.join(".qmai/rerank-config.json"),
            r#"{"apiKey":"rerank-secret","model":"bge"}"#,
        )
        .unwrap();
        std::fs::write(
            project.join(".qmai/novel-config.json"),
            r#"{"apiKey":"novel-secret","chapterTargetChars":3000}"#,
        )
        .unwrap();

        let app_state = tmp.join("app-state.json");
        std::fs::write(&app_state, "{}").unwrap();
        let target = tmp.join("stripped.zip");
        do_export_backup(
            ExportParams {
                save_path: target.to_string_lossy().to_string(),
                include_global_config: false,
                include_ui_preferences: false,
                include_credentials: false,
                local_storage_data: serde_json::json!({}),
                projects: vec![ProjectBackupInfo {
                    id: "p1".to_string(),
                    path: project.to_string_lossy().to_string(),
                    name: "测试项目".to_string(),
                    sections: vec![ProjectBackupSection::Content],
                }],
            },
            &app_state,
            |_| {},
        )
        .unwrap();

        for name in ["rerank-config.json", "novel-config.json"] {
            let raw = read_zip_entry(&target, &format!("projects/p1/.qmai/{name}"));
            assert!(
                !raw.contains("secret"),
                "{name} 里的密钥必须被剔除，实际内容: {raw}"
            );
            // 剔除的只是凭据字段，业务配置要保留 —— 否则等于把配置删了
            assert!(
                raw.contains("chapterTargetChars") || raw.contains("model"),
                "{name} 的非敏感字段必须保留: {raw}"
            );
        }
    }

    #[test]
    fn test_extract_dir_rejects_path_traversal() {
        let tmp = std::env::temp_dir().join("qmai_zipslip_test");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let zip_path = tmp.join("evil.zip");
        let zip_file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(zip_file);
        zip.start_file("prefix/../../../../evil.txt", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"malicious").unwrap();
        zip.finish().unwrap();

        let target = tmp.join("target");
        std::fs::create_dir_all(&target).unwrap();
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&zip_path).unwrap()).unwrap();
        let result = extract_dir_from_zip(&mut archive, "prefix/", &target);
        assert!(result.is_err(), "应拒绝路径遍历条目");
        let err = result.unwrap_err();
        assert!(err.contains("安全拦截"), "错误信息应包含安全拦截: {}", err);

        assert!(
            !tmp.join("evil.txt").exists(),
            "evil.txt 不应存在于临时目录"
        );
        assert!(
            !std::env::temp_dir().join("evil.txt").exists(),
            "evil.txt 不应存在于上级目录"
        );

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn test_extract_dir_accepts_normal_paths() {
        let tmp = std::env::temp_dir().join("qmai_zipslip_normal_test");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let zip_path = tmp.join("normal.zip");
        let zip_file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(zip_file);
        zip.start_file("prefix/chapter1.md", SimpleFileOptions::default())
            .unwrap();
        zip.write_all("# 第一章".as_bytes()).unwrap();
        zip.start_file("prefix/sub/chapter2.md", SimpleFileOptions::default())
            .unwrap();
        zip.write_all("# 第二章".as_bytes()).unwrap();
        zip.finish().unwrap();

        let target = tmp.join("target");
        std::fs::create_dir_all(&target).unwrap();
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&zip_path).unwrap()).unwrap();
        let count = extract_dir_from_zip(&mut archive, "prefix/", &target).unwrap();
        assert_eq!(count, 2);
        assert!(target.join("chapter1.md").exists());
        assert!(target.join("sub/chapter2.md").exists());

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn export_trash_section_includes_existing_trash_files() {
        let tmp = unique_test_dir("trash_section");
        let project = tmp.join("project");
        std::fs::create_dir_all(project.join(".trash")).unwrap();
        std::fs::write(project.join(".trash/deleted.md"), "已删除内容").unwrap();
        let app_state = tmp.join("app-state.json");
        std::fs::write(&app_state, "{}").unwrap();
        let zip_path = tmp.join("trash.zip");

        do_export_backup(
            ExportParams {
                save_path: zip_path.to_string_lossy().to_string(),
                include_global_config: false,
                include_ui_preferences: false,
                include_credentials: false,
                local_storage_data: serde_json::json!({}),
                projects: vec![ProjectBackupInfo {
                    id: "p1".to_string(),
                    path: project.to_string_lossy().to_string(),
                    name: "测试项目".to_string(),
                    sections: vec![ProjectBackupSection::Trash],
                }],
            },
            &app_state,
            |_| {},
        )
        .unwrap();

        let file = std::fs::File::open(&zip_path).unwrap();
        let archive = zip::ZipArchive::new(file).unwrap();
        assert!(archive
            .file_names()
            .any(|name| name == "projects/p1/.trash/deleted.md"));
    }

    #[cfg(windows)]
    #[test]
    fn test_is_path_root_accessible_windows_drive() {
        // C 盘在 Windows 上始终存在
        assert!(is_path_root_accessible("C:\\some\\path"));
    }

    #[cfg(unix)]
    #[test]
    fn test_is_path_root_accessible_unix_root() {
        // Unix 根目录始终可达
        assert!(is_path_root_accessible("/home/user/project"));
    }

    #[cfg(windows)]
    #[test]
    fn test_is_path_root_accessible_nonexistent_drive() {
        // Z 盘大概率不存在
        assert!(!is_path_root_accessible("Z:\\nonexistent\\path"));
    }
}
