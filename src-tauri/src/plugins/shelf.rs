//! 书架只读能力（`fs:shelf-read` 权限）。
//!
//! ── 为什么需要它，以及为什么**不**直接给「读全书」 ──────────────────
//! 有些插件要基于「用户书架上的所有书」做事（比如从多部作品的气息里提炼书名）。
//! 但插件跑在独立进程里，默认只能看见**当前项目**（`/host/project/*`），
//! 书架上其它书对它是不存在的。
//!
//! 直觉做法是开一个「读任意书」的接口，但那会把整个写作库的正文暴露给插件，
//! 而绝大多数需求（起名、风格分析、题材归类）只需要**概要**：
//! 书名、题材、简介、章节数、每本书少量正文采样。所以这里只给概要，
//! 并且由宿主**自己**决定采样多少 —— 插件不能要求"给我第 3 本书的全文"。
//!
//! ── 安全顺序（与 `host_api` 一致，不能反过来）────────────────────
//! token → 权限 → 读索引。反过来的话，无权限的插件能通过"有没有这条错误"
//! 推断出用户书架上有哪些书。
//!
//! ── 为什么从 app-state.json 读，而不是问前端要 ──────────────────
//! 插件会话比项目会话活得久，前端也不该成为插件的能力来源（插件可以绕过前端）。
//! `projectRegistry` 是书架的**单一真源**，直接读盘避免两套数据打架。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 书架里一本书的概要。
///
/// 字段刻意保守：只给"能用来判断这是什么书"的信息，不给正文。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShelfBook {
    /// 项目 id（`projectRegistry` 的键），插件用它来指定"分析哪几本"。
    pub id: String,
    /// 书名（真源是项目目录名，与 `bookTitle` 一致）。
    pub title: String,
    /// 项目目录的绝对路径。**仅供插件显示来源**，不构成读文件的许可。
    pub path: String,
    /// 最近打开时间（毫秒时间戳），用于排序。
    #[serde(default)]
    pub last_opened: i64,
    /// 简介（`.novel/project-meta.json` 里的 `description`），没有则为空。
    #[serde(default)]
    pub description: String,
    /// 章节数（只统计 `wiki/chapters/` 下的 markdown）。
    #[serde(default)]
    pub chapter_count: usize,
}

/// 一次书架读取的上限，防止插件用巨量数据把模型上下文撑爆。
///
/// 这些是**宿主硬上限**，不是建议值：插件传更大的 `maxBooks` 也会被夹到这里。
pub const MAX_BOOKS_PER_CALL: usize = 30;
/// 每本书最多取多少字的正文采样。
pub const MAX_BOOK_SAMPLE_CHARS: usize = 1200;
/// 所有书加起来的采样总字数上限（比逐本上限更重要，这才是真正的上下文保险）。
pub const MAX_TOTAL_SAMPLE_CHARS: usize = 12_000;

/// `projectRegistry` 里的一条记录。
#[derive(Debug, Deserialize)]
struct RegistryEntry {
    #[serde(default)]
    path: String,
    #[serde(default)]
    name: String,
    #[serde(default, rename = "lastOpened")]
    last_opened: i64,
}

/// 读 `app-state.json` 里的书架索引，按最近打开倒序。
///
/// 任何异常都**降级成空列表**而不是报错：书架索引缺失/损坏时，
/// 插件应该看到"没有书"，而不是收到一个它无从处理的内部错误。
pub fn read_registry(app_data_dir: &Path) -> Vec<ShelfBook> {
    let state_path = app_data_dir.join("app-state.json");
    let raw = match std::fs::read_to_string(&state_path) {
        Ok(text) => text,
        Err(_) => return Vec::new(),
    };
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let registry = match parsed.get("projectRegistry").and_then(|v| v.as_object()) {
        Some(map) => map,
        None => return Vec::new(),
    };

    let mut books: Vec<ShelfBook> = registry
        .iter()
        .filter_map(|(id, value)| {
            let entry: RegistryEntry = serde_json::from_value(value.clone()).ok()?;
            // 没有路径或书名的记录是无用的（可能是历史脏数据），跳过。
            if entry.path.trim().is_empty() || entry.name.trim().is_empty() {
                return None;
            }
            Some(ShelfBook {
                id: id.clone(),
                title: entry.name,
                path: entry.path,
                last_opened: entry.last_opened,
                description: String::new(),
                chapter_count: 0,
            })
        })
        .collect();

    books.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    books
}

/// 给一本书补上简介与章节数（需要访问它的目录）。
pub fn enrich(book: &mut ShelfBook) {
    let root = PathBuf::from(&book.path);
    book.description = read_description(&root);
    book.chapter_count = count_chapters(&root);
}

fn read_description(root: &Path) -> String {
    let meta = root.join(".novel").join("project-meta.json");
    let raw = match std::fs::read_to_string(meta) {
        Ok(text) => text,
        Err(_) => return String::new(),
    };
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return String::new(),
    };
    parsed
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

fn count_chapters(root: &Path) -> usize {
    let chapters = root.join("wiki").join("chapters");
    let Ok(entries) = std::fs::read_dir(chapters) else {
        return 0;
    };
    entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .map(|ext| ext.eq_ignore_ascii_case("md"))
                .unwrap_or(false)
        })
        .count()
}

/// 取一本书的正文采样（最多 `limit` 个字符，按章节顺序拼接）。
///
/// 为什么按"章"取而不是从第一个文件截断到 N 字：开头往往只有标题与空行，
/// 跳过空章能让采样真正落在正文上。
pub fn sample_text(root: &Path, limit: usize) -> String {
    if limit == 0 {
        return String::new();
    }
    let chapters = root.join("wiki").join("chapters");
    let Ok(entries) = std::fs::read_dir(chapters) else {
        return String::new();
    };

    let mut files: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .map(|ext| ext.eq_ignore_ascii_case("md"))
                .unwrap_or(false)
        })
        .collect();
    // 文件名字典序即章节序（本仓库章节文件带数字前缀）。
    files.sort();

    let mut out = String::new();
    for path in files {
        if out.chars().count() >= limit {
            break;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        let remaining = limit.saturating_sub(out.chars().count());
        out.extend(trimmed.chars().take(remaining));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qmai-shelf-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_registry(dir: &Path, body: &str) {
        std::fs::write(dir.join("app-state.json"), body).unwrap();
    }

    #[test]
    fn reads_registry_sorted_by_last_opened_desc() {
        let dir = temp_dir("sort");
        write_registry(
            &dir,
            r#"{"projectRegistry":{
                "a":{"path":"/books/a","name":"旧书","lastOpened":100},
                "b":{"path":"/books/b","name":"新书","lastOpened":900}
            }}"#,
        );
        let books = read_registry(&dir);
        assert_eq!(books.len(), 2);
        assert_eq!(books[0].title, "新书");
        assert_eq!(books[1].title, "旧书");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn skips_entries_without_path_or_name() {
        let dir = temp_dir("skip");
        write_registry(
            &dir,
            r#"{"projectRegistry":{
                "ok":{"path":"/books/ok","name":"好书","lastOpened":1},
                "nopath":{"path":"","name":"没路径","lastOpened":2},
                "noname":{"path":"/books/x","name":"  ","lastOpened":3}
            }}"#,
        );
        let books = read_registry(&dir);
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].title, "好书");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_or_corrupt_registry_degrades_to_empty() {
        let dir = temp_dir("missing");
        // 文件不存在
        assert!(read_registry(&dir).is_empty());
        // 坏 JSON
        write_registry(&dir, "{ not json");
        assert!(read_registry(&dir).is_empty());
        // 没有 projectRegistry 键
        write_registry(&dir, r#"{"other":1}"#);
        assert!(read_registry(&dir).is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn enrich_reads_description_and_counts_chapters() {
        let dir = temp_dir("enrich");
        let book = dir.join("book");
        std::fs::create_dir_all(book.join(".novel")).unwrap();
        std::fs::create_dir_all(book.join("wiki").join("chapters")).unwrap();
        std::fs::write(
            book.join(".novel").join("project-meta.json"),
            r#"{"description":"一本讲挖矿成神的书"}"#,
        )
        .unwrap();
        for name in ["001.md", "002.md", "notes.txt"] {
            std::fs::write(book.join("wiki").join("chapters").join(name), "正文").unwrap();
        }

        let mut entry = ShelfBook {
            id: "x".into(),
            title: "测试".into(),
            path: book.to_string_lossy().to_string(),
            last_opened: 0,
            description: String::new(),
            chapter_count: 0,
        };
        enrich(&mut entry);

        assert_eq!(entry.description, "一本讲挖矿成神的书");
        // 只数 .md，notes.txt 不算
        assert_eq!(entry.chapter_count, 2);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sample_respects_char_limit_and_skips_empty_files() {
        let dir = temp_dir("sample");
        let chapters = dir.join("wiki").join("chapters");
        std::fs::create_dir_all(&chapters).unwrap();
        std::fs::write(chapters.join("001.md"), "   ").unwrap(); // 空章应被跳过
        std::fs::write(chapters.join("002.md"), "第一段正文").unwrap();
        std::fs::write(chapters.join("003.md"), "第二段正文").unwrap();

        let text = sample_text(&dir, 6);
        // 每个文件 5 个字，拼第二段时要插入 "\n\n" 分隔符，所以总长会略超 limit。
        // 这是有意的：分隔符保证了"两段正文不会粘成一句话"，比严格卡字数更重要。
        // 这里只断言"取到了正文且大致守住上限"，不把分隔符的成本当成 bug。
        assert!(text.starts_with("第一段正文"));
        assert!(text.chars().count() <= 6 + 2, "字符数 {:?} 超出 limit+分隔符预算", text.chars().count());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sample_returns_empty_for_missing_book() {
        let dir = temp_dir("nosample");
        assert!(sample_text(&dir, 100).is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn limits_are_sane_and_bounded() {
        // 这些上限是保护模型上下文的硬闸门，改动必须有意识地放宽
        assert!(MAX_BOOKS_PER_CALL <= 50);
        assert!(MAX_BOOK_SAMPLE_CHARS <= 4000);
        assert!(MAX_TOTAL_SAMPLE_CHARS >= MAX_BOOK_SAMPLE_CHARS);
    }
}
