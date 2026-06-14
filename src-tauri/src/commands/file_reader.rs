use std::fs;
use std::path::Path;

#[tauri::command]
pub fn read_file_content(path: String) -> Result<String, String> {
    fs::read_to_string(&path)
        .map_err(|e| format!("无法读取文件 {}: {}", path, e))
}

#[tauri::command]
pub fn list_directory_files(path: String) -> Result<Vec<String>, String> {
    let dir = Path::new(&path);

    if !dir.exists() {
        return Ok(Vec::new());
    }

    if !dir.is_dir() {
        return Err(format!("{} 不是一个目录", path));
    }

    let mut files = Vec::new();

    match fs::read_dir(dir) {
        Ok(entries) => {
            for entry in entries {
                if let Ok(entry) = entry {
                    if let Ok(file_type) = entry.file_type() {
                        if file_type.is_file() {
                            if let Some(file_name) = entry.file_name().to_str() {
                                files.push(file_name.to_string());
                            }
                        }
                    }
                }
            }
            Ok(files)
        }
        Err(e) => Err(format!("无法读取目录 {}: {}", path, e))
    }
}
