//! 项目读写地基（设计 §7）：进程级「当前项目」+ 项目信息读取 + 受控写入。
//!
//! 这一层解决的是 `mod.rs` 里 `project_root: None` 写死导致的死结：
//! 插件会话是在**插件启动时**注册的，而用户可以在插件跑着的时候切换项目。
//! 所以项目根不能固化进会话，必须是进程级、可变的单一真源。
//!
//! 写侧刻意只做**枚举字段**（设计 D9 / §7.3）：不存在任何「写任意路径」的通道。
//! 而读到的元数据里能安全写回的字段，本仓库目前**一个都没有** —— 见
//! [`write_project_field`] 与 [`append_chapter_note`] 的说明，宁可明确不支持，
//! 也不猜一个文件去写。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 当前打开的项目根。
///
/// 为什么是进程级：宿主同一时刻只有一个打开的项目，而插件的会话是在
/// 插件启动时注册的 —— 项目切换时插件不会重启，所以不能把 root 固化进会话。
///
/// 用 `std::sync::Mutex` 而不是 `tokio::sync::Mutex`：只有「读一个 Option<PathBuf>」
/// 这种微秒级操作，没有跨 await 的临界区，异步锁反而会把 `get()` 变成 async。
pub struct ProjectContext {
    root: Mutex<Option<PathBuf>>,
}

impl ProjectContext {
    pub fn new() -> Self {
        Self {
            root: Mutex::new(None),
        }
    }

    /// 设置当前项目根；`None` 表示「没有打开的项目」（关闭项目）。
    ///
    /// 锁中毒时**不 panic、也不静默吞掉**：写入失败只影响「当前项目」这一条状态，
    /// 让插件读到 `None`（等价于没打开项目）比让整个命令层崩掉好得多。
    pub fn set(&self, root: Option<PathBuf>) {
        match self.root.lock() {
            Ok(mut guard) => *guard = root,
            Err(poisoned) => {
                // 中毒说明此前有 panic 发生在 set/get 内部（实际不可能，它们只做拷贝），
                // 这里仍然按「尽力恢复」处理：into_inner 拿到被污染但可用的值。
                *poisoned.into_inner() = root;
            }
        }
    }

    pub fn get(&self) -> Option<PathBuf> {
        match self.root.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }
}

impl Default for ProjectContext {
    fn default() -> Self {
        Self::new()
    }
}

/// 把前端传来的项目根规范成可存的绝对路径。
///
/// - `None` / 空串 / 全空白 → `Ok(None)`（关闭项目；前端「关闭」时给空值比给 null 省事）
/// - 路径存在且是目录 → canonicalize 后返回（后续所有读写都拿这个真实路径比前缀，
///   Windows 上 `\\?\C:\…` 与 `C:\…` 两种写法才不会一半匹配一半不匹配）
/// - 路径不存在 / 不是目录 → Err（不猜、不创建：一个笔误的路径会静默变成「没有项目」）
pub fn resolve_project_root(raw: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let path = Path::new(trimmed);
    let real = std::fs::canonicalize(path)
        .map_err(|error| format!("项目路径不存在或不可访问：{trimmed}（{error}）"))?;
    if !real.is_dir() {
        return Err(format!("项目路径不是目录：{trimmed}"));
    }
    Ok(Some(real))
}

// ── 可写字段枚举（设计 §7.3 / D9）─────────────────────

/// `/host/project/field` 与声明式 target 共用的可写字段白名单。
///
/// 新增字段必须改宿主并 bump [`PROJECT_FIELD_API_VERSION`]：枚举外一律拒绝，
/// 老插件不认识新字段是安全的（设计 §11 风险 6）。
pub const PROJECT_FIELDS: &[&str] = &[
    "bookTitle",
    "bookTags",
    "bookIntro",
    "protagonist",
    "setting",
];

/// 可写字段枚举的版本。字段集合变了就要 +1，插件据此判断宿主支持哪些字段。
pub const PROJECT_FIELD_API_VERSION: u32 = 1;

/// 字段名是否在枚举内（区分大小写：`booktitle` 不算）。
pub fn is_writable_field(field: &str) -> bool {
    PROJECT_FIELDS.contains(&field)
}

// ── 项目信息读取 ─────────────────────────────────────

/// 小说项目元数据文件，与前端 `src/lib/novel/project-meta.ts` 读的是同一份。
const NOVEL_META_FILE: &str = ".novel/project-meta.json";
/// 知识库目录（与 `commands/project.rs` 的 `KNOWLEDGE_DIR` 一致）。
const KNOWLEDGE_DIR: &str = "QM";
/// 旧版知识库目录名（`commands/project.rs` 里的 `LEGACY_KNOWLEDGE_DIR`）。
const LEGACY_KNOWLEDGE_DIR: &str = "wiki";
const CHAPTERS_DIR: &str = "chapters";
/// 统计章节时允许的最大目录深度：正文按卷分子目录很常见，但再深就是在挖别的东西了。
const MAX_CHAPTER_DEPTH: usize = 3;

/// `GET /host/project/info` 的响应（设计 §7.2）。
///
/// `field_api_version` 是给插件判断「宿主认不认得我要写的字段」用的
/// （设计 §7.3：新增字段要 bump）。它不在 §7.2 那五行里，但多带一个字段
/// 对老插件是安全的（它们只读自己认识的键）。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub root: String,
    pub book_title: String,
    pub tags: Vec<String>,
    pub intro: String,
    pub chapter_count: usize,
    pub field_api_version: u32,
}

/// 读项目信息。
///
/// **永不失败、永不 panic**：插件侧把这里当成「项目快照」，任何一个文件读不出来
/// 都只让对应字段降级成空值 —— 一个坏掉的 `project-meta.json` 不该让插件连
/// 书名都拿不到（书名还有目录名这个兜底真源）。
pub fn read_project_info(root: &Path) -> ProjectInfo {
    let meta = read_novel_meta(root);
    let book_title = meta
        .as_ref()
        .and_then(|meta| non_empty_string(meta.get("title")))
        // 没有元数据就退回目录名：宿主打开项目时（`commands/project.rs::open_project`）
        // 正是用目录名当 `WikiProject.name`，这是没有第二份真源时的唯一兜底。
        .unwrap_or_else(|| dir_name(root));
    let intro = meta
        .as_ref()
        .and_then(|meta| non_empty_string(meta.get("description")))
        .unwrap_or_default();
    let tags = meta
        .as_ref()
        .and_then(|meta| meta.get("tags"))
        .and_then(|tags| tags.as_array())
        .map(|tags| {
            tags.iter()
                .filter_map(|tag| tag.as_str())
                .map(|tag| tag.trim().to_string())
                .filter(|tag| !tag.is_empty())
                .collect()
        })
        .unwrap_or_default();

    ProjectInfo {
        root: root.to_string_lossy().to_string(),
        book_title,
        tags,
        intro,
        chapter_count: count_chapters(root),
        field_api_version: PROJECT_FIELD_API_VERSION,
    }
}

fn read_novel_meta(root: &Path) -> Option<serde_json::Value> {
    let raw = std::fs::read_to_string(root.join(NOVEL_META_FILE)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn non_empty_string(value: Option<&serde_json::Value>) -> Option<String> {
    let text = value?.as_str()?.trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

/// 项目目录名。取不到（根目录是文件系统根、路径以 `..` 结尾等）就是空串。
fn dir_name(root: &Path) -> String {
    root.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// 数一数当前项目有多少章。
///
/// 为什么数文件而不是读元数据里的 `totalChapters`：`project-meta.json` 是可选文件，
/// 而且没有任何代码在写它（见 [`write_project_field`] 的说明），磁盘上的正文才是真的。
fn count_chapters(root: &Path) -> usize {
    let mut base = root.join(KNOWLEDGE_DIR).join(CHAPTERS_DIR);
    if !base.is_dir() {
        base = root.join(LEGACY_KNOWLEDGE_DIR).join(CHAPTERS_DIR);
    }
    count_markdown_files(&base, MAX_CHAPTER_DEPTH)
}

fn count_markdown_files(dir: &Path, depth_left: usize) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut count = 0;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if file_type.is_dir() {
            // 隐藏目录（`.trash`、`.git`…）不是正文；深度用完也不再往下走。
            let hidden = path
                .file_name()
                .map(|name| name.to_string_lossy().starts_with('.'))
                .unwrap_or(true);
            if !hidden && depth_left > 0 {
                count += count_markdown_files(&path, depth_left - 1);
            }
        } else if path
            .extension()
            .map(|ext| ext.eq_ignore_ascii_case("md"))
            .unwrap_or(false)
        {
            count += 1;
        }
    }
    count
}

// ── 受控写入（当前一律「明确不支持」）──────────────────

/// 写一个项目字段。
///
/// **现在一律返回 `E_FIELD_WRITE_UNSUPPORTED`，这是查证后的结论，不是偷懒。**
/// 结论来自这三条事实（截至本次改动）：
///
/// 1. **书名的真源是项目目录名**：`commands/project.rs::open_project` 用目录名构造
///    `WikiProject.name`，`rename_project` 改书名的方式是重命名目录。要「把书名改掉」
///    等于重命名用户的项目目录 —— 那不是插件该触发的高危动作。
/// 2. `.novel/project-meta.json` 里虽然有 `title` / `description` / `genre`，但全仓
///    **只读不写**（唯一消费点是 `project-store.ts:627` 读它的 `novelMode`）。往里面
///    写东西界面上不会有任何变化 —— 静默无效比明确报错更糟，用户会以为已生效。
/// 3. `bookTags` / `protagonist` / `setting` 没有项目级单值存储：它们分别散在
///    wiki 页面（`QM/entities/*.md`、`QM/concepts/*.md`）的 frontmatter 与正文里。
///    写这些等于让插件改用户的 wiki 页面，需要按知识库的写入规则（frontmatter、
///    索引、双向链接）走宿主已有链路，而不是由这里拼一个 JSON 回写。
///
/// 所以：**读通了，写按 D9 保留枚举并明确回不支持**。等宿主接入项目元数据写入
/// （或把书名正式搬进 `.novel/project-meta.json`）后，这里换掉实现即可，
/// HTTP 契约与前端都不用动。
pub fn write_project_field(
    _root: &Path,
    field: &str,
    _value: &serde_json::Value,
) -> Result<(), &'static str> {
    if !is_writable_field(field) {
        return Err("E_FIELD_NOT_ALLOWED");
    }
    Err("E_FIELD_WRITE_UNSUPPORTED")
}

/// 向当前章节追加一条备注（设计 D2 的 `chapter-note` target）。
///
/// **同样一律返回 `E_NOTE_WRITE_UNSUPPORTED`**：查证结果是「章节备注没有独立存储」——
/// 章节只有 `QM/chapters/*.md` 正文与 `.novel/snapshots/` 快照两种落点，前者是用户
/// 最珍贵的资产（设计 D9：一次 bug 就毁一本书），后者是备份快照（往里写等于污染备份）。
/// 没有第三种「只追加、不改正文」的位置之前，写正文或写快照都不能接受。
pub fn append_chapter_note(
    _root: &Path,
    chapter_id: &str,
    _note: &str,
) -> Result<(), &'static str> {
    if chapter_id.trim().is_empty() {
        return Err("E_CHAPTER_ID_INVALID");
    }
    Err("E_NOTE_WRITE_UNSUPPORTED")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "qmai-project-ctx-{tag}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("创建临时项目目录");
        path
    }

    #[test]
    fn project_context_starts_empty_and_round_trips() {
        let context = ProjectContext::new();
        assert!(context.get().is_none(), "新建的项目上下文不该有项目");

        let root = temp_dir("roundtrip");
        context.set(Some(root.clone()));
        assert_eq!(context.get(), Some(root));

        // 关闭项目 = 置 None，不能留着上一个项目
        context.set(None);
        assert!(context.get().is_none());
    }

    #[test]
    fn resolve_project_root_canonicalizes_and_rejects_missing() {
        let root = temp_dir("resolve");
        let resolved = resolve_project_root(Some(root.to_str().expect("UTF-8 临时路径")))
            .expect("存在的目录应被接受")
            .expect("应返回 Some");
        assert!(resolved.is_dir());
        // canonicalize 之后的路径不一定与入参字面相同（Windows 上带 \\?\ 前缀），
        // 但一定指向同一处：用 file_name 断言即可。
        assert_eq!(resolved.file_name(), root.file_name());

        // 不存在 → Err（不猜、不创建）
        let missing = root.join("nope");
        let error = resolve_project_root(Some(missing.to_str().expect("UTF-8")))
            .expect_err("不存在的路径必须报错");
        assert!(error.contains("不存在"), "错误要说清原因：{error}");

        // 关闭项目：None 与空串都等价
        assert_eq!(resolve_project_root(None).expect("None 合法"), None);
        assert_eq!(resolve_project_root(Some("   ")).expect("空白合法"), None);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_project_root_rejects_a_file() {
        let root = temp_dir("resolve-file");
        let file = root.join("chapter.md");
        std::fs::write(&file, "正文").expect("写文件");
        let error = resolve_project_root(Some(file.to_str().expect("UTF-8")))
            .expect_err("文件不是项目根");
        assert!(error.contains("不是目录"), "错误要说清原因：{error}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn info_falls_back_to_directory_name_and_counts_chapters() {
        let root = temp_dir("info-fallback");
        // 没有 .novel/project-meta.json 的老项目：书名退回目录名，其余为空
        let chapters = root.join("QM").join("chapters");
        std::fs::create_dir_all(&chapters).expect("建章节目录");
        std::fs::write(chapters.join("第1章.md"), "正文").expect("写第一章");
        std::fs::write(chapters.join("第2章.md"), "正文").expect("写第二章");
        std::fs::write(chapters.join("notes.txt"), "不是章节").expect("写无关文件");
        // 隐藏目录不计入
        std::fs::create_dir_all(chapters.join(".trash")).expect("建隐藏目录");
        std::fs::write(chapters.join(".trash/备份.md"), "x").expect("写隐藏目录文件");

        let info = read_project_info(&root);
        assert_eq!(info.book_title, dir_name(&root));
        assert_eq!(info.intro, "");
        assert!(info.tags.is_empty());
        assert_eq!(info.chapter_count, 2, "只数 .md，且不算隐藏目录");
        assert_eq!(info.field_api_version, PROJECT_FIELD_API_VERSION);
        assert!(info.root.contains("qmai-project-ctx-info-fallback"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn info_reads_novel_meta_when_present() {
        let root = temp_dir("info-meta");
        std::fs::create_dir_all(root.join(".novel")).expect("建 .novel");
        std::fs::write(
            root.join(NOVEL_META_FILE),
            r#"{"title":"长夜将至","description":"一句话简介","tags":["悬疑","都市"]}"#,
        )
        .expect("写元数据");

        let info = read_project_info(&root);
        assert_eq!(info.book_title, "长夜将至");
        assert_eq!(info.intro, "一句话简介");
        assert_eq!(info.tags, vec!["悬疑".to_string(), "都市".to_string()]);
        // 没有 chapters 目录就是 0，不 panic
        assert_eq!(info.chapter_count, 0);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn info_survives_a_broken_meta_file() {
        let root = temp_dir("info-broken");
        std::fs::create_dir_all(root.join(".novel")).expect("建 .novel");
        std::fs::write(root.join(NOVEL_META_FILE), "{not json").expect("写坏元数据");

        let info = read_project_info(&root);
        // 坏文件只让字段降级，不能让整条接口失败
        assert_eq!(info.book_title, dir_name(&root));
        assert_eq!(info.chapter_count, 0);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn field_whitelist_rejects_everything_else() {
        for field in PROJECT_FIELDS {
            assert!(is_writable_field(field), "{field} 应在白名单里");
        }
        assert!(!is_writable_field("booktitle"), "大小写不同不算同一字段");
        assert!(!is_writable_field("path"));
        assert!(!is_writable_field(""));
        assert!(!is_writable_field("../purpose.md"));
    }

    #[test]
    fn unknown_field_is_rejected_before_any_write_attempt() {
        let root = temp_dir("field-unknown");
        let error = write_project_field(&root, "chapterText", &serde_json::json!("x"))
            .expect_err("枚举外字段必须拒绝");
        assert_eq!(error, "E_FIELD_NOT_ALLOWED");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 当前实现的诚实契约：白名单内的字段也明确回「宿主尚未接入写入」，
    /// 而不是静默写一个不影响界面的文件。
    #[test]
    fn known_fields_report_write_unsupported() {
        let root = temp_dir("field-unsupported");
        for field in PROJECT_FIELDS {
            let error = write_project_field(&root, field, &serde_json::json!("值"))
                .expect_err("当前宿主不支持写项目字段");
            assert_eq!(error, "E_FIELD_WRITE_UNSUPPORTED", "字段 {field}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn chapter_note_is_unsupported_and_empty_id_is_invalid() {
        let root = temp_dir("note");
        assert_eq!(
            append_chapter_note(&root, "ch-1", "备注").expect_err("当前不支持"),
            "E_NOTE_WRITE_UNSUPPORTED"
        );
        assert_eq!(
            append_chapter_note(&root, "  ", "备注").expect_err("空章节 id 非法"),
            "E_CHAPTER_ID_INVALID"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
