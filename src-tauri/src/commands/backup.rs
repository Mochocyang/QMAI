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

const UI_PREFERENCE_KEYS: &[&str] = &[
    "recentProjects",
    "lastProject",
    "language",
    "theme",
    "visualStyle",
    "visualStyleVersion",
    "uiFontSizeScale",
    "uiFontFamily",
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
        .store("app-state.json")
        .map_err(|e| format!("无法加载应用状态存储: {e}"))?;

    store.clear();

    let obj = app_state_json
        .as_object()
        .ok_or_else(|| "app-state.json 格式错误，应为 JSON 对象".to_string())?;

    for (key, value) in obj {
        store.set(key.clone(), value.clone());
    }

    store
        .save()
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
        let is_index_entry = relative
            .components()
            .next()
            .map(|component| {
                component
                    .as_os_str()
                    .to_string_lossy()
                    .eq_ignore_ascii_case("lancedb")
            })
            .unwrap_or(false);
        if (is_index_entry && !include_indexes) || (!is_index_entry && !include_analysis) {
            continue;
        }

        let zip_name = format!(
            "{}/{}",
            zip_prefix,
            relative.to_string_lossy().replace('\\', "/")
        );
        if entry.file_type().is_dir() {
            zip.add_directory(&zip_name, options)
                .map_err(|error| format!("创建 zip 目录失败: {error}"))?;
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }

        let is_rerank_config = relative
            .to_string_lossy()
            .replace('\\', "/")
            .eq_ignore_ascii_case("rerank-config.json");
        if is_rerank_config && !include_credentials {
            let content = fs::read_to_string(path)
                .map_err(|error| format!("读取 Rerank 配置失败 {}: {error}", path.display()))?;
            let mut json: serde_json::Value = match serde_json::from_str(&content) {
                Ok(json) => json,
                Err(error) => {
                    warnings.push(format!(
                        "Rerank 配置无法安全移除凭据，已跳过 {}: {error}",
                        path.display()
                    ));
                    continue;
                }
            };
            remove_sensitive_fields(&mut json);
            let sanitized = serde_json::to_vec_pretty(&json)
                .map_err(|error| format!("序列化 Rerank 配置失败: {error}"))?;
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

/// Core export backup logic.
/// `app_state_path` is the path to `app-state.json` on disk.
/// `on_progress` is called with progress payloads during the operation.
pub fn do_export_backup<F: Fn(&BackupProgressPayload)>(
    params: ExportParams,
    app_state_path: &Path,
    on_progress: F,
) -> Result<ExportResult, String> {
    let save_path = Path::new(&params.save_path);
    let total_projects = params.projects.len();

    on_progress(&BackupProgressPayload {
        operation: "export".to_string(),
        stage: "preparing".to_string(),
        current: 0,
        total: total_projects + 2,
        message: "正在准备导出...".to_string(),
    });

    let file = fs::File::create(save_path).map_err(|e| format!("无法创建备份文件: {e}"))?;
    let mut zip = ZipWriter::new(file);

    let mut file_count: usize = 0;
    let mut warnings: Vec<String> = Vec::new();

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
                if file_path.exists() && file_path.is_file() {
                    let data = fs::read(&file_path)
                        .map_err(|e| format!("读取文件失败 {}: {e}", file_path.display()))?;
                    let zip_name = format!("{}/{}", zip_prefix, file_name);
                    zip.start_file(&zip_name, options)
                        .map_err(|e| format!("创建 zip 文件条目失败: {e}"))?;
                    zip.write_all(&data)
                        .map_err(|e| format!("写入 zip 失败: {e}"))?;
                    file_count += 1;
                }
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

        if include_analysis || include_indexes {
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

    zip.finish()
        .map_err(|e| format!("完成 zip 写入失败: {e}"))?;

    let total_size = fs::metadata(save_path).map(|m| m.len()).unwrap_or(0);

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
            let app_state_str = serde_json::to_string_pretty(&merged_app_state)
                .map_err(|e| format!("序列化 app-state 失败: {e}"))?;
            fs::write(&app_state_path, app_state_str.as_bytes())
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
            ImportStrategy::Full => manifest_projects
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
                .collect(),
            ImportStrategy::Selective => params
                .projects
                .as_ref()
                .map(|ps| {
                    ps.iter()
                        .map(|p| {
                            let name = manifest_projects
                                .iter()
                                .find(|m| m.id == p.id)
                                .map(|m| m.name.clone())
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
        replace_local_storage: manifest_version < 2 || manifest_contents.credentials,
        projects: project_results,
        warnings,
        error: None,
    })
}

/// 读取备份文件中的 manifest.json，返回项目列表及路径可达性。
/// 不做实际解压，供前端在导入前检查路径。
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
    let projects = manifest
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

        let app_state_path = match app.store("app-state.json") {
            Ok(store) => {
                if let Err(e) = store.save() {
                    eprintln!("保存 app-state 存储失败: {e}");
                }
                app_data_dir.join("app-state.json")
            }
            Err(e) => {
                eprintln!("无法获取 app-state 存储句柄: {e}");
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

        if let Ok(store) = app.store("app-state.json") {
            store
                .save()
                .map_err(|error| format!("导入前保存当前应用状态失败: {error}"))?;
        }

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

    #[test]
    fn test_is_path_root_accessible_windows_drive() {
        // C 盘在 Windows 上始终存在
        assert!(is_path_root_accessible("C:\\some\\path"));
    }

    #[test]
    fn test_is_path_root_accessible_unix_root() {
        // Unix 根目录始终可达
        assert!(is_path_root_accessible("/home/user/project"));
    }

    #[test]
    fn test_is_path_root_accessible_nonexistent_drive() {
        // Z 盘大概率不存在
        assert!(!is_path_root_accessible("Z:\\nonexistent\\path"));
    }
}
