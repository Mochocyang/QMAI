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
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportParams {
    pub save_path: String,
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub success: bool,
    pub app_state: Option<serde_json::Value>,
    pub local_storage_data: Option<serde_json::Value>,
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
    pub projects: Vec<ProjectBackupInfo>,
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

const PROJECT_SUBDIRS: &[&str] = &[".qmai", ".novel", "book-analysis", "raw"];
const PROJECT_FILES: &[&str] = &["soul.md", "schema.md", "purpose.md"];

// 知识目录的可能名称（新版用 QM，旧版用 wiki），导出时统一以 wiki 名称存入 zip
const KNOWLEDGE_DIR_CANDIDATES: &[&str] = &["QM", "wiki"];
const KNOWLEDGE_ZIP_NAME: &str = "wiki";

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
) -> Result<(), String> {
    let options =
        zip::write::SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for entry in WalkDir::new(base_dir).into_iter().filter_map(|e| e.ok()) {
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
            let data =
                fs::read(path).map_err(|e| format!("读取文件失败 {}: {e}", path.display()))?;
            zip.start_file(&zip_name, options)
                .map_err(|e| format!("创建 zip 文件条目失败: {e}"))?;
            zip.write_all(&data)
                .map_err(|e| format!("写入 zip 失败: {e}"))?;
            *file_count += 1;
        }
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

    for name in names {
        let relative = &name[zip_prefix.len()..];
        let relative = relative.trim_start_matches('/');
        if relative.is_empty() {
            continue;
        }

        let dest_path = target_dir.join(relative);

        // Zip Slip 防护：校验解压目标路径未逃逸出 target_dir
        let canonical_target = target_dir.canonicalize()
            .map_err(|e| format!("无法解析目标目录: {e}"))?;

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
                name, normalized_dest.display()
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

    let file = fs::File::create(save_path)
        .map_err(|e| format!("无法创建备份文件: {e}"))?;
    let mut zip = ZipWriter::new(file);

    let mut file_count: usize = 0;
    let mut warnings: Vec<String> = Vec::new();

    let options =
        zip::write::SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    // 1. manifest.json
    let manifest = BackupManifest {
        backup_version: 1,
        created_at: chrono::Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
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
    zip.start_file("global/app-state.json", options)
        .map_err(|e| format!("创建 app-state zip 条目失败: {e}"))?;

    if app_state_path.exists() {
        let app_state_content = fs::read_to_string(app_state_path)
            .map_err(|e| format!("读取 app-state.json 失败: {e}"))?;
        zip.write_all(app_state_content.as_bytes())
            .map_err(|e| format!("写入 app-state 到 zip 失败: {e}"))?;
        file_count += 1;
    } else {
        zip.write_all(b"{}")
            .map_err(|e| format!("写入空 app-state 失败: {e}"))?;
        warnings.push("app-state.json 不存在，已写入空对象".to_string());
    }

    // 3. global/local-storage.json
    zip.start_file("global/local-storage.json", options)
        .map_err(|e| format!("创建 local-storage zip 条目失败: {e}"))?;
    let ls_json = serde_json::to_string_pretty(&params.local_storage_data)
        .map_err(|e| format!("序列化 localStorage 失败: {e}"))?;
    zip.write_all(ls_json.as_bytes())
        .map_err(|e| format!("写入 local-storage 到 zip 失败: {e}"))?;
    file_count += 1;

    // 4. project-registry.json
    let registry_json = serde_json::json!({
        "projects": params.projects.iter().map(|p| {
            serde_json::json!({
                "id": p.id,
                "path": p.path,
                "name": p.name,
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

        // 导出知识目录（优先 QM，兼容 wiki），统一以 wiki 名称存入 zip
        for knowledge_dir in KNOWLEDGE_DIR_CANDIDATES {
            let knowledge_path = project_path.join(knowledge_dir);
            if knowledge_path.exists() && knowledge_path.is_dir() {
                let zip_sub_prefix = format!("{}/{}", zip_prefix, KNOWLEDGE_ZIP_NAME);
                if let Err(e) =
                    add_dir_to_zip(&mut zip, &knowledge_path, &zip_sub_prefix, &mut file_count)
                {
                    warnings.push(format!(
                        "复制项目 {} 的知识目录({})失败: {}",
                        project.name, knowledge_dir, e
                    ));
                }
                break; // 只导出第一个找到的知识目录
            }
        }

        for subdir in PROJECT_SUBDIRS {
            let subdir_path = project_path.join(subdir);
            if subdir_path.exists() && subdir_path.is_dir() {
                let zip_sub_prefix = format!("{}/{}", zip_prefix, subdir);
                if let Err(e) =
                    add_dir_to_zip(&mut zip, &subdir_path, &zip_sub_prefix, &mut file_count)
                {
                    warnings.push(format!(
                        "复制项目 {} 的 {} 目录失败: {}",
                        project.name, subdir, e
                    ));
                }
            }
        }

        for file_name in PROJECT_FILES {
            let file_path = project_path.join(file_name);
            if file_path.exists() && file_path.is_file() {
                let data = fs::read(&file_path).map_err(|e| {
                    format!("读取文件失败 {}: {e}", file_path.display())
                })?;
                let zip_name = format!("{}/{}", zip_prefix, file_name);
                zip.start_file(&zip_name, options)
                    .map_err(|e| format!("创建 zip 文件条目失败: {e}"))?;
                zip.write_all(&data)
                    .map_err(|e| format!("写入 zip 失败: {e}"))?;
                file_count += 1;
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

    let file = fs::File::open(zip_path)
        .map_err(|e| format!("打开备份文件失败: {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("读取备份文件失败，可能已损坏: {e}"))?;

    let mut warnings: Vec<String> = Vec::new();
    let mut app_state: Option<serde_json::Value> = None;
    let mut local_storage_data: Option<serde_json::Value> = None;
    let mut project_results: Vec<ProjectRestoreResult> = Vec::new();

    let mut manifest_projects: Vec<ProjectBackupInfo> = Vec::new();
    if let Some(manifest_bytes) = extract_file_from_zip(&mut archive, "manifest.json")? {
        let manifest: BackupManifest = serde_json::from_slice(&manifest_bytes)
            .map_err(|e| format!("解析 manifest.json 失败: {e}"))?;
        if manifest.backup_version > 1 {
            warnings.push(format!(
                "备份版本 {} 可能不兼容当前版本",
                manifest.backup_version
            ));
        }
        manifest_projects = manifest.projects;
    } else {
        warnings.push("备份文件缺少 manifest.json".to_string());
    }

    let need_global = matches!(
        params.strategy,
        ImportStrategy::Full | ImportStrategy::GlobalOnly
    );

    if need_global {
        on_progress(&BackupProgressPayload {
            operation: "import".to_string(),
            stage: "restoring".to_string(),
            current: 0,
            total: 1,
            message: "正在恢复全局配置...".to_string(),
        });

        if let Some(app_state_bytes) =
            extract_file_from_zip(&mut archive, "global/app-state.json")?
        {
            let app_state_json: serde_json::Value = serde_json::from_slice(&app_state_bytes)
                .map_err(|e| format!("解析 app-state.json 失败: {e}"))?;

            // 直接写入磁盘文件
            fs::create_dir_all(app_state_dir)
                .map_err(|e| format!("创建数据目录失败: {e}"))?;
            let app_state_path = app_state_dir.join("app-state.json");
            let app_state_str = serde_json::to_string_pretty(&app_state_json)
                .map_err(|e| format!("序列化 app-state 失败: {e}"))?;
            fs::write(&app_state_path, app_state_str.as_bytes())
                .map_err(|e| format!("写入 app-state.json 失败: {e}"))?;

            app_state = Some(app_state_json);
        }

        if let Some(ls_bytes) =
            extract_file_from_zip(&mut archive, "global/local-storage.json")?
        {
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
                manifest_projects
                    .iter()
                    .map(|p| (p.id.clone(), p.path.clone(), p.name.clone()))
                    .collect()
            }
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

        for (idx, (project_id, target_path, project_name)) in projects_to_restore.iter().enumerate() {
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
                        warnings.push(format!(
                            "项目 {} 目录迁移失败: {}",
                            project_name, e
                        ));
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
    }

    on_progress(&BackupProgressPayload {
        operation: "import".to_string(),
        stage: "done".to_string(),
        current: 1,
        total: 1,
        message: "导入完成".to_string(),
    });

    Ok(ImportResult {
        success: true,
        app_state,
        local_storage_data,
        projects: project_results,
        warnings,
        error: None,
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
            emit_progress(&app_clone, &payload.operation, &payload.stage, payload.current, payload.total, &payload.message);
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

        let app_clone = app.clone();
        let result = do_import_backup(params, &app_data_dir, move |payload| {
            emit_progress(&app_clone, &payload.operation, &payload.stage, payload.current, payload.total, &payload.message);
        })?;

        // 通过 plugin-store API 恢复，确保内存中的缓存状态也被替换，
        // 避免应用关闭/重启时旧状态覆盖导入的新状态。
        if let Some(ref app_state_json) = result.app_state {
            restore_app_state_via_store(&app, app_state_json)?;
        }

        Ok(result)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::ZipWriter;
    use zip::write::SimpleFileOptions;

    #[test]
    fn test_extract_dir_rejects_path_traversal() {
        let tmp = std::env::temp_dir().join("qmai_zipslip_test");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let zip_path = tmp.join("evil.zip");
        let zip_file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(zip_file);
        zip.start_file("prefix/../../../../evil.txt", SimpleFileOptions::default()).unwrap();
        zip.write_all(b"malicious").unwrap();
        zip.finish().unwrap();

        let target = tmp.join("target");
        std::fs::create_dir_all(&target).unwrap();
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&zip_path).unwrap()).unwrap();
        let result = extract_dir_from_zip(&mut archive, "prefix/", &target);
        assert!(result.is_err(), "应拒绝路径遍历条目");
        let err = result.unwrap_err();
        assert!(err.contains("安全拦截"), "错误信息应包含安全拦截: {}", err);

        assert!(!tmp.join("evil.txt").exists(), "evil.txt 不应存在于临时目录");
        assert!(!std::env::temp_dir().join("evil.txt").exists(), "evil.txt 不应存在于上级目录");

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
        zip.start_file("prefix/chapter1.md", SimpleFileOptions::default()).unwrap();
        zip.write_all("# 第一章".as_bytes()).unwrap();
        zip.start_file("prefix/sub/chapter2.md", SimpleFileOptions::default()).unwrap();
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
}
