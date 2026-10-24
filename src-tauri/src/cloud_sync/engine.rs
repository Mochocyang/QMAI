//! 一轮同步的编排。
//!
//! 流程：读清单（base）→ 逐书扫描本地 + 列远端 → 三方对比出计划 → 执行 →
//! 写回清单与书籍索引（提交点）→ 追加历史。
//!
//! 设计要点：
//! - **计划与执行分离**：先把所有动作算出来（总项数因此可知，进度条不是猜的），
//!   再逐个执行。执行中途被要求停止时，已完成的动作仍然有效、清单仍然写回，
//!   下一轮从真实状态继续，不做「回滚」——回滚文件比继续同步更危险。
//! - **提交点在最后**：清单与索引一起写，写完才算这一轮成功。半途中断时清单
//!   还是上一轮的，下一轮会把中途的改动重新判一次（可能重复上传，但不会丢数据）。
//! - 引擎不认识 Tauri：事件用回调交出去，所以 `cargo test` 能直接跑。

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::compare::{decide, FileFingerprint, SyncDecision};
use super::history::{self, BatchState, SyncBatch, SyncCounts, SyncDirection, SyncEntry};
use super::providers::RemoteStore;
use super::scan::{scan_project_files, sha256_file};
use super::CloudSyncState;

const MANIFEST_FILE: &str = ".qmai-cloud/manifest.json";
const BOOKS_INDEX_FILE: &str = "books.index.json";
const ENTRY_CHUNK: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRef {
    pub id: String,
    pub name: String,
    pub path: String,
}

/// 一轮同步的入参。
///
/// `remote` 是 trait 对象而不是具体类型：文件夹、WebDAV（以后的百度）在引擎眼里
/// 必须是同一个东西，否则每接一个网盘就要复制一遍对比与执行逻辑。
pub struct EngineOptions {
    pub remote: Box<dyn RemoteStore>,
    pub history_dir: PathBuf,
    pub projects: Vec<ProjectRef>,
    pub include_snapshots: bool,
    pub trigger: String,
    /// 这一轮写到哪个网盘：批次要记下来，详情面板按它分组。
    pub provider: Option<String>,
}

#[derive(Debug)]
pub enum EngineEvent {
    Progress { done: u32, total: u32 },
    Entries(Vec<SyncEntry>),
}

#[derive(Debug, Clone)]
pub struct Outcome {
    pub batch: SyncBatch,
    pub entries: Vec<SyncEntry>,
    pub stopped: bool,
}

// ---------------------------------------------------------------- manifest

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ManifestBook {
    dir: String,
    #[serde(default)]
    files: BTreeMap<String, FingerprintRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FingerprintRecord {
    hash: String,
    size: u64,
    /// 上次同步时远端给的版本标识。下一轮如果远端 ETag 没变，就不必下载全文重算哈希。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    etag: Option<String>,
}

impl From<&FileFingerprint> for FingerprintRecord {
    fn from(value: &FileFingerprint) -> Self {
        Self { hash: value.hash.clone(), size: value.size, etag: None }
    }
}

impl From<&FingerprintRecord> for FileFingerprint {
    fn from(value: &FingerprintRecord) -> Self {
        Self::new(value.hash.clone(), value.size)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Manifest {
    version: u32,
    #[serde(default)]
    books: BTreeMap<String, ManifestBook>,
}

impl Manifest {
    /// 读不到清单（首次同步 / 远端被清空 / 文件损坏）时返回 `None`。
    ///
    /// 这个区分很关键：把「没有清单」当成「清单是空」会让引擎认为
    /// 「远端所有文件都被删了」，然后照着删本地 —— 一次误清空网盘就能毁掉书稿。
    /// 没有清单时 base 全空，引擎只会新增/覆盖，绝不会删除任何文件。
    pub(crate) fn load(store: &dyn RemoteStore) -> Option<Self> {
        let bytes = store.read(MANIFEST_FILE).ok()?;
        serde_json::from_slice::<Manifest>(&bytes).ok()
    }

    /// 只在内容真的变了才写。
    ///
    /// 远端常常就是网盘客户端的同步目录：客户端刚把 `manifest.json` 传上去，
    /// 我们下一轮又原样重写一遍，两边抢同一个文件句柄，
    /// 在 Windows 上就是「拒绝访问 (os error 5)」。没有变更的轮次干脆别碰它。
    pub(crate) fn save_if_changed(&self, store: &dyn RemoteStore) -> Result<(), String> {
        let text = serde_json::to_vec_pretty(self).map_err(|error| format!("序列化清单失败：{error}"))?;
        if let Ok(existing) = store.read(MANIFEST_FILE) {
            if existing == text {
                return Ok(());
            }
        }
        store.write(MANIFEST_FILE, &text)
    }

    /// 清单里这本书的远端目录名（`书`）。定夺冲突时要靠它拼远端路径。
    pub(crate) fn book_dir(&self, book_id: &str) -> Option<String> {
        self.books.get(book_id).map(|book| book.dir.clone())
    }

    fn base_for(&self, book_id: &str, rel: &str) -> Option<FileFingerprint> {
        self.books
            .get(book_id)
            .and_then(|book| book.files.get(rel))
            .map(FileFingerprint::from)
    }

    /// 完整记录（含 etag）：判断远端是否变化时只看 etag，比读全文便宜得多。
    fn record_for(&self, book_id: &str, rel: &str) -> Option<&FingerprintRecord> {
        self.books.get(book_id).and_then(|book| book.files.get(rel))
    }
}

// ------------------------------------------------------------- books index

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct BookIndexEntry {
    id: String,
    name: String,
    dir: String,
    #[serde(default)]
    last_sync_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct BooksIndex {
    version: u32,
    #[serde(default)]
    books: Vec<BookIndexEntry>,
}

impl BooksIndex {
    fn load(store: &dyn RemoteStore) -> Self {
        match store.read(BOOKS_INDEX_FILE) {
            Ok(bytes) => serde_json::from_slice::<BooksIndex>(&bytes).unwrap_or(BooksIndex { version: 1, books: Vec::new() }),
            Err(_) => BooksIndex { version: 1, books: Vec::new() },
        }
    }

    fn save_if_changed(&self, store: &dyn RemoteStore) -> Result<(), String> {
        let text = serde_json::to_vec_pretty(self).map_err(|error| format!("序列化书籍索引失败：{error}"))?;
        if let Ok(existing) = store.read(BOOKS_INDEX_FILE) {
            if existing == text {
                return Ok(());
            }
        }
        store.write(BOOKS_INDEX_FILE, &text)
    }

    /// 给一本书分配远端目录名：优先沿用上次的；没有就按书名生成，重名加序号。
    fn dir_for(&self, project: &ProjectRef) -> String {
        if let Some(existing) = self.books.iter().find(|book| book.id == project.id) {
            if !existing.dir.is_empty() {
                return existing.dir.clone();
            }
        }
        let base = sanitize_dir_name(&project.name, &project.id);
        let mut candidate = base.clone();
        let mut suffix = 2;
        while self
            .books
            .iter()
            .any(|book| book.dir == candidate && book.id != project.id)
        {
            candidate = format!("{base}-{suffix}");
            suffix += 1;
        }
        candidate
    }

    fn touch(&mut self, project: &ProjectRef, dir: &str, at: i64) {
        if let Some(existing) = self.books.iter_mut().find(|book| book.id == project.id) {
            existing.name = project.name.clone();
            existing.dir = dir.to_string();
            existing.last_sync_at = Some(at);
            return;
        }
        self.books.push(BookIndexEntry {
            id: project.id.clone(),
            name: project.name.clone(),
            dir: dir.to_string(),
            last_sync_at: Some(at),
        });
    }
}

/// 远端目录名：去掉路径分隔符与 Windows 保留字符，避免生成无法创建的目录。
pub fn sanitize_dir_name(name: &str, book_id: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        if matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || ch.is_control() {
            out.push('_');
        } else {
            out.push(ch);
        }
    }
    let trimmed = out.trim().trim_matches('.').trim().to_string();
    if trimmed.is_empty() {
        let short: String = book_id.chars().take(8).collect();
        return format!("book-{short}");
    }
    // 目录名过长会让部分网盘客户端报错。
    trimmed.chars().take(60).collect()
}

// ------------------------------------------------------------------- plan

#[derive(Debug)]
struct PlannedAction {
    book_index: usize,
    rel: String,
    decision: SyncDecision,
    local_path: Option<PathBuf>,
    remote_rel: String,
}

/// 远端实现返回的错误可能是「可翻译错误码」（`webdav.auth`、`net.timeout`），
/// 也可能是底层原文。前者必须透传，否则用户只会看到笼统的「文件被占用」。
pub(crate) fn classify_error(error: &str, fallback: &str) -> String {
    let looks_like_code = error.contains('.')
        && !error.contains(' ')
        && error.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'));
    if looks_like_code {
        error.to_string()
    } else {
        fallback.to_string()
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn new_entry(
    batch_id: &str,
    project: &ProjectRef,
    direction: SyncDirection,
    rel: &str,
    bytes: Option<u64>,
    ok: bool,
    error_code: Option<&str>,
    error_detail: Option<String>,
) -> SyncEntry {
    SyncEntry {
        id: uuid::Uuid::new_v4().to_string(),
        batch_id: batch_id.to_string(),
        at: now_ms(),
        direction,
        path: rel.to_string(),
        book_id: Some(project.id.clone()),
        book_name: Some(project.name.clone()),
        bytes,
        ok,
        error_code: error_code.map(|code| code.to_string()),
        error_detail,
    }
}

/// 冲突副本名：`林照.md` → `林照.remote-20261024T101500.md`（保留扩展名，编辑器仍能打开）。
fn conflict_name(rel: &str, stamp: &str) -> String {
    let (stem, ext) = match rel.rfind('.') {
        Some(index) if index > rel.rfind('/').unwrap_or(0) => (&rel[..index], &rel[index..]),
        _ => (rel, ""),
    };
    format!("{stem}.remote-{stamp}{ext}")
}

/// 冲突副本的命名规律：`<目录>/<文件名主干>.remote-<时间戳><扩展名>`。
///
/// 引擎与「逐项定夺」必须用同一套规则，否则定夺时找不到要删的那份副本。
pub(crate) fn conflict_copy_pattern(rel: &str) -> (String, String, String) {
    let (dir, name) = match rel.rsplit_once('/') {
        Some((dir, name)) => (dir.to_string(), name.to_string()),
        None => (String::new(), rel.to_string()),
    };
    let (stem, ext) = match name.rfind('.') {
        Some(index) if index > 0 => (&name[..index], &name[index..]),
        _ => (name.as_str(), ""),
    };
    (dir, format!("{stem}.remote-"), ext.to_string())
}

#[cfg(test)]
impl Manifest {
    pub(crate) fn base_for_test(&self, book_id: &str, rel: &str) -> Option<FileFingerprint> {
        self.base_for(book_id, rel)
    }
}
pub fn run(
    options: &EngineOptions,
    state: &CloudSyncState,
    emit: &mut impl FnMut(EngineEvent),
) -> Result<Outcome, String> {
    let started_at = now_ms();
    let batch_id = uuid::Uuid::new_v4().to_string();
    let store: &dyn RemoteStore = options.remote.as_ref();

    let manifest = Manifest::load(store);
    let mut index = BooksIndex::load(store);

    // 远端所有文件先列一次，后面按书目录前缀取用，避免每本书各走一遍磁盘。
    // 列表失败本身就是「连不上/没授权/目录没了」，直接把错误码交给命令层翻译。
    let remote_files = store.list()?;
    let mut remote_by_rel: HashMap<String, (u64, Option<String>)> = HashMap::new();
    let mut remote_etags: HashMap<String, String> = HashMap::new();
    for file in &remote_files {
        remote_by_rel.insert(file.rel.clone(), (file.size, file.etag.clone()));
        if let Some(etag) = &file.etag {
            remote_etags.insert(file.rel.clone(), etag.clone());
        }
    }
    let mut remote_hash_cache: HashMap<String, FileFingerprint> = HashMap::new();
    // 拉远端内容时失败的文件（限流、断网、文件被服务端加密……）。这里不能静默当成
    // 「远端没有这个文件」——那会被判成「要上传」，于是下一轮 PUT 再失败一次，
    // 用户看到的是「五百项失败」而不是「网盘限流了」。
    let mut prefetch_errors: HashMap<String, String> = HashMap::new();

    // ---- 计划
    let mut actions: Vec<PlannedAction> = Vec::new();
    let mut book_dirs: Vec<String> = Vec::with_capacity(options.projects.len());
    for (book_index, project) in options.projects.iter().enumerate() {
        let dir = index.dir_for(project);
        let prefix = format!("{dir}/");
        let local_files = match scan_project_files(Path::new(&project.path), options.include_snapshots) {
            Ok(files) => files,
            Err(_) => {
                book_dirs.push(dir);
                continue;
            }
        };

        let mut rels: Vec<String> = local_files.iter().map(|file| file.rel.clone()).collect();
        rels.extend(
            remote_by_rel
                .keys()
                .filter_map(|rel| rel.strip_prefix(&prefix).map(|tail| tail.to_string())),
        );
        rels.sort();
        rels.dedup();

        let local_by_rel: HashMap<&str, (u64, &Path)> = local_files
            .iter()
            .map(|file| (file.rel.as_str(), (file.size, Path::new(&project.path))))
            .collect();

        for rel in rels {
            let remote_rel = format!("{prefix}{rel}");
            let local_meta = local_by_rel.get(rel.as_str());
            let remote_meta = remote_by_rel.get(&remote_rel);
            let remote_size = remote_meta.map(|(size, _)| *size);

            let local_fp = match local_meta {
                Some((_, root)) => match local_path_of(root, &rel) {
                    Some(path) => sha256_file(&path).ok().map(|hash| {
                        let size = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
                        (FileFingerprint::new(hash, size), path)
                    }),
                    None => None,
                },
                None => None,
            };

            let base_record = manifest.as_ref().and_then(|manifest| manifest.record_for(&project.id, &rel));
            let base_fp = base_record.map(FileFingerprint::from);
            let base_etag = base_record.and_then(|record| record.etag.as_ref());
            let remote_fp = match remote_size {
                Some(_size) => {
                    if let Some(cached) = remote_hash_cache.get(&remote_rel) {
                        Some(cached.clone())
                    } else if let (Some(remote_etag), Some(base_etag)) = (
                        remote_meta.and_then(|(_, etag)| etag.as_ref()),
                        base_etag,
                    ) {
                        if remote_etag == base_etag {
                            // 远端 ETag 没变 → 内容没变，直接复用基线指纹。
                            // 这一步省掉的是全量同步里最贵的一类请求（每个远端文件一次 GET），
                            // 也是坚果云「请求过多」限流的直接原因。
                            base_fp.clone()
                        } else {
                            read_and_hash(store, &remote_rel, &mut remote_hash_cache, &mut prefetch_errors)
                        }
                    } else {
                        read_and_hash(store, &remote_rel, &mut remote_hash_cache, &mut prefetch_errors)
                    }
                }
                None => None,
            };

            // 首次同步（远端还没有清单）时，两边都有的文件如果大小一致，就是同一份：
            // 直接认领，不再下载比对、也不上传覆盖。这一步把「第一次连接」的请求量
            // 从「每个文件 GET+PUT」降到「真正需要传的那几个」，是能不能一次同步
            // 完成的关键（坚果云按 30 分钟 600 次限流）。
            let first_contact_same_size = manifest.is_none()
                && local_fp.is_some()
                && remote_size == local_fp.as_ref().map(|(fp, _)| fp.size);
            let decision = if first_contact_same_size {
                SyncDecision::NoChange
            } else {
                decide(
                    local_fp.as_ref().map(|(fp, _)| fp),
                    remote_fp.as_ref(),
                    base_fp.as_ref(),
                )
            };

            actions.push(PlannedAction {
                book_index,
                rel,
                decision,
                local_path: local_fp.map(|(_, path)| path),
                remote_rel,
            });
        }
        book_dirs.push(dir);
    }

    // 目标计数只算真正要动的，跳过项不计入进度总数（否则进度条长得莫名其妙）。
    let total = actions
        .iter()
        .filter(|action| action.decision != SyncDecision::NoChange)
        .count() as u32;
    state.set_total(total);
    if total > 0 {
        emit(EngineEvent::Progress { done: 0, total });
    }

    // ---- 执行
    let mut counts = SyncCounts::default();
    let mut entries: Vec<SyncEntry> = Vec::new();
    let mut pending_entries: Vec<SyncEntry> = Vec::new();
    let mut done = 0u32;
    let mut stopped = false;
    let mut updated_manifest = Manifest {
        version: 1,
        books: manifest
            .as_ref()
            .map(|manifest| manifest.books.clone())
            .unwrap_or_default(),
    };
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S").to_string();

    for action in &actions {
        if state.stop_requested() {
            stopped = true;
            break;
        }
        let project = &options.projects[action.book_index];
        let book_dir = &book_dirs[action.book_index];

        if let Some(code) = prefetch_errors.get(&action.remote_rel) {
            counts.failed += 1;
            entries.push(SyncEntry {
                id: uuid::Uuid::new_v4().to_string(),
                batch_id: batch_id.clone(),
                at: now_ms(),
                direction: SyncDirection::Download,
                path: action.rel.clone(),
                book_id: Some(project.id.clone()),
                book_name: Some(project.name.clone()),
                bytes: None,
                ok: false,
                error_code: Some(code.clone()),
                error_detail: None,
            });
            done += 1;
            state.set_progress(done);
            emit(EngineEvent::Progress { done, total });
            continue;
        }

        if action.decision == SyncDecision::NoChange {
            // 清单照旧记录：远端与本地一致时优先用远端指纹（已在缓存/基线里），
            // 首次认领的文件没有远端指纹，用本地算出来的那个即可（大小已确认相同）。
            let fingerprint = remote_hash_cache
                .get(&action.remote_rel)
                .cloned()
                .or_else(|| {
                    updated_manifest
                        .record_for(&project.id, &action.rel)
                        .map(FileFingerprint::from)
                })
                .or_else(|| {
                    action.local_path.as_ref().and_then(|path| {
                        let hash = sha256_file(path).ok()?;
                        let size = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
                        Some(FileFingerprint::new(hash, size))
                    })
                });
            if let Some(fingerprint) = fingerprint {
                record_manifest(&mut updated_manifest, &project.id, book_dir, &action.rel, &fingerprint);
            }
            continue;
        }

        done += 1;
        let outcome = execute_action(
            store,
            action,
            project,
            book_dir,
            &batch_id,
            &stamp,
            &mut counts,
        );
        match outcome.base {
            BaseUpdate::Set(fingerprint) => {
                record_manifest(&mut updated_manifest, &project.id, book_dir, &action.rel, &fingerprint);
                // 写过的文件远端 ETag 变了，以本轮 list 快照为准是错的；
                // 收尾时会用一次新的 list 统一刷新（见下面的 refresh_etags）。
            }
            BaseUpdate::Remove => remove_manifest(&mut updated_manifest, &project.id, &action.rel),
            BaseUpdate::Keep => {}
        }
        pending_entries.extend(outcome.entries.iter().cloned());
        entries.extend(outcome.entries);
        state.set_progress(done);
        emit(EngineEvent::Progress { done, total });
        if pending_entries.len() >= ENTRY_CHUNK {
            emit(EngineEvent::Entries(std::mem::take(&mut pending_entries)));
        }
    }

    if !pending_entries.is_empty() {
        emit(EngineEvent::Entries(std::mem::take(&mut pending_entries)));
    }

    // 提交：先写清单与索引，再写历史。清单写失败算整轮失败（下一轮会重判）。
    for (project_index, project) in options.projects.iter().enumerate() {
        let dir = &book_dirs[project_index];
        if let Some(book) = updated_manifest.books.get_mut(&project.id) {
            book.dir = dir.clone();
        } else {
            updated_manifest.books.insert(
                project.id.clone(),
                ManifestBook { dir: dir.clone(), files: BTreeMap::new() },
            );
        }
        index.touch(project, dir, started_at);
    }
    // 清单落盘前再列一次远端：这一轮写过的文件只有最新 list 里有正确 ETag，
    // 不补的话下一轮全部退化成「下载全文算哈希」，限流又会找上门。
    // 一次遍历（按目录数计请求）远便宜于每个文件一次 GET。
    if let Ok(fresh) = store.list() {
        for book in updated_manifest.books.values_mut() {
            for (rel, record) in book.files.iter_mut() {
                let remote_rel = format!("{}/{}", book.dir, rel);
                if let Some(file) = fresh.iter().find(|file| file.rel == remote_rel) {
                    record.etag = file.etag.clone();
                }
            }
        }
    }
    // 这两个文件是「元数据」，不是同步内容本身：
    // - 内容没变就完全不碰（见 save_if_changed）；
    // - 真写不进去（网盘客户端占用）也只记日志 —— 本轮的动作都已完成，
    //   旧清单继续用是安全的，下一轮会自然收敛。
    // 曾经这里用 `?` 往上抛，用户看到的是一行「整轮未开始：替换远端文件失败」，
    // 既看不懂，又让他以为同步坏了。
    if let Err(error) = updated_manifest.save_if_changed(store) {
        log::warn!("[cloud-sync] 远端清单没能写回，下一轮按旧清单重算：{error}");
    }
    if let Err(error) = index.save_if_changed(store) {
        log::warn!("[cloud-sync] books.index.json 没能写回：{error}");
    }

    let failed = counts.failed;
    let changed = counts.upload + counts.download + counts.delete + counts.conflict;
    let batch_state = if stopped {
        BatchState::Partial
    } else if failed == 0 {
        BatchState::Ok
    } else if changed == 0 {
        BatchState::Failed
    } else {
        BatchState::Partial
    };
    let batch = SyncBatch {
        batch_id: batch_id.clone(),
        started_at,
        finished_at: Some(now_ms()),
        trigger: options.trigger.clone(),
        state: batch_state,
        counts,
        provider: options.provider.clone(),
    };

    state.set_failure_count(failed);
    let _ = history::append(&options.history_dir, batch.clone(), entries.clone(), now_ms());

    Ok(Outcome { batch, entries, stopped })
}

/// 一次动作结束后，这一条相对路径在清单里的「新基准」应该是什么。
///
/// 必须由**动作自身**给出：用旧的远端指纹当基准是错的（上传后远端已经变了），
/// 下一轮会把「本地和远端各自相对旧基准都变了」误判成冲突。
enum BaseUpdate {
    Set(FileFingerprint),
    Remove,
    Keep,
}

struct ActionOutcome {
    entries: Vec<SyncEntry>,
    base: BaseUpdate,
}

fn execute_action(
    store: &dyn RemoteStore,
    action: &PlannedAction,
    project: &ProjectRef,
    book_dir: &str,
    batch_id: &str,
    stamp: &str,
    counts: &mut SyncCounts,
) -> ActionOutcome {
    let mut entries = Vec::new();
    let mut base = BaseUpdate::Keep;

    match action.decision {
        SyncDecision::NoChange => {}
        SyncDecision::Upload => match action.local_path.as_ref() {
            Some(path) => match fs::read(path) {
                Ok(bytes) => {
                    let size = bytes.len() as u64;
                    match store.write(&action.remote_rel, &bytes) {
                        Ok(()) => {
                            counts.upload += 1;
                            base = BaseUpdate::Set(FileFingerprint::new(sha256_bytes(&bytes), size));
                            entries.push(new_entry(
                                batch_id,
                                project,
                                SyncDirection::Upload,
                                &action.rel,
                                Some(size),
                                true,
                                None,
                                None,
                            ));
                        }
                        Err(error) => {
                            counts.failed += 1;
                            let code = classify_error(&error, "local.locked");
                            entries.push(new_entry(
                                batch_id,
                                project,
                                SyncDirection::Upload,
                                &action.rel,
                                Some(size),
                                false,
                                Some(&code),
                                Some(error),
                            ));
                        }
                    }
                }
                Err(error) => {
                    counts.failed += 1;
                    entries.push(new_entry(
                        batch_id,
                        project,
                        SyncDirection::Upload,
                        &action.rel,
                        None,
                        false,
                        Some("local.locked"),
                        Some(error.to_string()),
                    ));
                }
            },
            None => {
                counts.skip += 1;
                entries.push(new_entry(
                    batch_id,
                    project,
                    SyncDirection::Skip,
                    &action.rel,
                    None,
                    true,
                    None,
                    Some("本地文件在计划后被移除".to_string()),
                ));
            }
        },
        SyncDecision::Download => match store.read(&action.remote_rel) {
            Ok(bytes) => {
                let size = bytes.len() as u64;
                let target = Path::new(&project.path).join(path_from_rel(&action.rel));
                match write_local_file(&target, &bytes) {
                    Ok(()) => {
                        counts.download += 1;
                        base = BaseUpdate::Set(FileFingerprint::new(sha256_bytes(&bytes), size));
                        entries.push(new_entry(
                            batch_id,
                            project,
                            SyncDirection::Download,
                            &action.rel,
                            Some(size),
                            true,
                            None,
                            None,
                        ));
                    }
                    Err(error) => {
                        counts.failed += 1;
                        entries.push(new_entry(
                            batch_id,
                            project,
                            SyncDirection::Download,
                            &action.rel,
                            Some(size),
                            false,
                            Some("local.locked"),
                            Some(error),
                        ));
                    }
                }
            }
            Err(error) => {
                counts.failed += 1;
                let code = classify_error(&error, "net.offline");
                entries.push(new_entry(
                    batch_id,
                    project,
                    SyncDirection::Download,
                    &action.rel,
                    None,
                    false,
                    Some(&code),
                    Some(error),
                ));
            }
        },
        SyncDecision::DeleteRemote => match store.remove(&action.remote_rel) {
            Ok(()) => {
                counts.delete += 1;
                base = BaseUpdate::Remove;
                entries.push(new_entry(
                    batch_id,
                    project,
                    SyncDirection::Delete,
                    &action.rel,
                    None,
                    true,
                    None,
                    Some("远端文件已在云端删除".to_string()),
                ));
            }
            Err(error) => {
                counts.failed += 1;
                let code = classify_error(&error, "local.locked");
                entries.push(new_entry(
                    batch_id,
                    project,
                    SyncDirection::Delete,
                    &action.rel,
                    None,
                    false,
                    Some(&code),
                    Some(error),
                ));
            }
        },
        SyncDecision::DeleteLocal => {
            let target = Path::new(&project.path).join(path_from_rel(&action.rel));
            match fs::remove_file(&target) {
                Ok(()) => {
                    counts.delete += 1;
                    base = BaseUpdate::Remove;
                    entries.push(new_entry(
                        batch_id,
                        project,
                        SyncDirection::Delete,
                        &action.rel,
                        None,
                        true,
                        None,
                        Some("云端已删除，本地这份未改过，随之一并删除".to_string()),
                    ));
                }
                Err(error) => {
                    counts.failed += 1;
                    entries.push(new_entry(
                        batch_id,
                        project,
                        SyncDirection::Delete,
                        &action.rel,
                        None,
                        false,
                        Some("local.locked"),
                        Some(error.to_string()),
                    ));
                }
            }
        }
        SyncDecision::Conflict => {
            // 本地在：远端那份改名留档，再把本地这份传上去（用户的本地版本是「当前」）。
            // 本地不在（本地删了但远端改过）：把远端那份取回成本地冲突副本，不覆盖任何东西。
            match action.local_path.as_ref() {
                Some(local_path) => {
                    let keep_name = format!("{book_dir}/{}", conflict_name(&action.rel, stamp));
                    let renamed = store.rename(&action.remote_rel, &keep_name);
                    let upload = match (renamed, fs::read(local_path)) {
                        (Ok(()), Ok(bytes)) => {
                            let size = bytes.len() as u64;
                            store.write(&action.remote_rel, &bytes).map(|()| {
                                (FileFingerprint::new(sha256_bytes(&bytes), size), size)
                            })
                        }
                        (Err(error), _) => Err(error),
                        (_, Err(error)) => Err(error.to_string()),
                    };
                    match upload {
                        Ok((fingerprint, size)) => {
                            counts.conflict += 1;
                            base = BaseUpdate::Set(fingerprint);
                            entries.push(new_entry(
                                batch_id,
                                project,
                                SyncDirection::Conflict,
                                &action.rel,
                                Some(size),
                                true,
                                None,
                                Some(format!("云端旧版本已保留为 {}", conflict_name(&action.rel, stamp))),
                            ));
                        }
                        Err(error) => {
                            counts.failed += 1;
                            entries.push(new_entry(
                                batch_id,
                                project,
                                SyncDirection::Conflict,
                                &action.rel,
                                None,
                                false,
                                Some("local.locked"),
                                Some(error),
                            ));
                        }
                    }
                }
                None => match store.read(&action.remote_rel) {
                    Ok(bytes) => {
                        let size = bytes.len() as u64;
                        let target = Path::new(&project.path)
                            .join(path_from_rel(&conflict_name(&action.rel, stamp)));
                        match write_local_file(&target, &bytes) {
                            Ok(()) => {
                                counts.conflict += 1;
                                // 基准记成远端指纹：下一轮「本地没有 + 远端没动」会被判成
                                // DeleteRemote，即用户的删除照常传播，而内容已经存在冲突副本里。
                                base = BaseUpdate::Set(FileFingerprint::new(sha256_bytes(&bytes), size));
                                entries.push(new_entry(
                                    batch_id,
                                    project,
                                    SyncDirection::Conflict,
                                    &action.rel,
                                    Some(size),
                                    true,
                                    None,
                                    Some(format!(
                                        "云端有更新版本，已保存为本地副本 {}",
                                        conflict_name(&action.rel, stamp)
                                    )),
                                ));
                            }
                            Err(error) => {
                                counts.failed += 1;
                                entries.push(new_entry(
                                    batch_id,
                                    project,
                                    SyncDirection::Conflict,
                                    &action.rel,
                                    None,
                                    false,
                                    Some("local.locked"),
                                    Some(error),
                                ));
                            }
                        }
                    }
                    Err(error) => {
                        counts.failed += 1;
                        entries.push(new_entry(
                            batch_id,
                            project,
                            SyncDirection::Conflict,
                            &action.rel,
                            None,
                            false,
                            Some("net.offline"),
                            Some(error),
                        ));
                    }
                },
            }
        }
    }

    ActionOutcome { entries, base }
}

pub(crate) fn remove_manifest(manifest: &mut Manifest, book_id: &str, rel: &str) {
    if let Some(book) = manifest.books.get_mut(book_id) {
        book.files.remove(rel);
    }
}

/// 下载远端文件并算哈希；失败时把错误码记进 `prefetch_errors`，不静默当作「远端没有」。
fn read_and_hash(
    store: &dyn RemoteStore,
    remote_rel: &str,
    cache: &mut HashMap<String, FileFingerprint>,
    prefetch_errors: &mut HashMap<String, String>,
) -> Option<FileFingerprint> {
    match store.read(remote_rel) {
        Ok(bytes) => {
            let fingerprint = FileFingerprint::new(sha256_bytes(&bytes), bytes.len() as u64);
            cache.insert(remote_rel.to_string(), fingerprint.clone());
            Some(fingerprint)
        }
        Err(code) => {
            prefetch_errors.insert(remote_rel.to_string(), code);
            None
        }
    }
}

pub(crate) fn record_manifest(
    manifest: &mut Manifest,
    book_id: &str,
    dir: &str,
    rel: &str,
    fingerprint: &FileFingerprint,
) {
    let book = manifest
        .books
        .entry(book_id.to_string())
        .or_insert_with(|| ManifestBook { dir: dir.to_string(), files: BTreeMap::new() });
    book.dir = dir.to_string();
    book.files.insert(rel.to_string(), FingerprintRecord::from(fingerprint));
}

pub(crate) fn sha256_bytes(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn local_path_of(root: &Path, rel: &str) -> Option<PathBuf> {
    Some(root.join(path_from_rel(rel)))
}

pub(crate) fn path_from_rel(rel: &str) -> PathBuf {
    let mut out = PathBuf::new();
    for part in rel.split('/') {
        if !part.is_empty() {
            out.push(part);
        }
    }
    out
}

pub(crate) fn write_local_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建目录失败：{error}"))?;
    }
    let tmp = path.with_extension(format!(
        "{}.qmai-tmp",
        path.extension().and_then(|ext| ext.to_str()).unwrap_or("")
    ));
    fs::write(&tmp, bytes).map_err(|error| format!("写入本地文件失败：{error}"))?;
    fs::rename(&tmp, path).map_err(|error| {
        let _ = fs::remove_file(&tmp);
        format!("替换本地文件失败：{error}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_sync::history::History;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qmai_engine_{name}_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn make_book(root: &Path, name: &str, files: &[(&str, &str)]) -> ProjectRef {
        let book_root = root.join(name);
        for (rel, body) in files {
            let path = book_root.join(path_from_rel(rel));
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, body.as_bytes()).unwrap();
        }
        ProjectRef {
            id: format!("id-{name}"),
            name: name.to_string(),
            path: book_root.to_string_lossy().to_string(),
        }
    }

    fn options(remote: &Path, history_dir: &Path, projects: Vec<ProjectRef>) -> EngineOptions {
        EngineOptions {
            remote: Box::new(crate::cloud_sync::providers::FolderStore::new(remote)),
            history_dir: history_dir.to_path_buf(),
            projects,
            include_snapshots: false,
            trigger: "manual".to_string(),
            provider: Some("folder".to_string()),
        }
    }

    #[test]
    fn first_run_uploads_then_second_run_is_noop() {
        let book_root = temp_dir("book");
        let remote = temp_dir("remote");
        let history_dir = temp_dir("history");
        let projects = vec![make_book(&book_root, "长夜", &[
            ("QM/entities/林照.md", "entity"),
            ("raw/assets/ref.txt", "raw"),
        ])];
        let state = CloudSyncState::default();
        state.try_begin();
        let mut events: Vec<EngineEvent> = Vec::new();
        let outcome = run(&options(&remote, &history_dir, projects.clone()), &state, &mut |event| {
            events.push(event)
        })
        .unwrap();

        assert_eq!(outcome.batch.counts.upload, 2);
        assert_eq!(outcome.batch.counts.failed, 0);
        assert!(!outcome.stopped);
        assert!(remote.join("长夜/QM/entities/林照.md").is_file());
        assert!(remote.join("books.index.json").is_file());
        assert!(remote.join(".qmai-cloud/manifest.json").is_file());
        let history = history::load(&history_dir);
        assert_eq!(history.batches.len(), 1);
        assert_eq!(history.entries.len(), 2);

        // 第二轮：什么都没改 → 0 次上传，批次仍是 ok。
        let mut second = Vec::new();
        let outcome = run(&options(&remote, &history_dir, projects), &state, &mut |event| {
            second.push(event)
        })
        .unwrap();
        assert_eq!(outcome.batch.counts.upload, 0);
        assert_eq!(outcome.batch.counts.failed, 0);
        assert!(matches!(outcome.batch.state, BatchState::Ok));
        assert!(second.is_empty(), "没有变更时不该发进度/条目事件");

        for dir in [book_root, remote, history_dir] {
            fs::remove_dir_all(&dir).ok();
        }
    }

    #[test]
    fn local_edit_uploads_and_remote_edit_downloads() {
        let book_root = temp_dir("two-way");
        let remote = temp_dir("remote");
        let history_dir = temp_dir("history");
        let projects = vec![make_book(&book_root, "长夜", &[("QM/entities/林照.md", "v1")])];
        let state = CloudSyncState::default();
        state.try_begin();
        let mut sink = |_event: EngineEvent| {};
        run(&options(&remote, &history_dir, projects.clone()), &state, &mut sink).unwrap();

        // 本地改 → 上传。
        fs::write(book_root.join("长夜/QM/entities/林照.md"), "v2").unwrap();
        let outcome = run(&options(&remote, &history_dir, projects.clone()), &state, &mut sink).unwrap();
        assert_eq!(outcome.batch.counts.upload, 1);
        assert_eq!(
            fs::read_to_string(remote.join("长夜/QM/entities/林照.md")).unwrap(),
            "v2"
        );

        // 远端改（模拟另一台机器）→ 下载。
        fs::write(remote.join("长夜/QM/entities/林照.md"), "v3").unwrap();
        let outcome = run(&options(&remote, &history_dir, projects), &state, &mut sink).unwrap();
        assert_eq!(outcome.batch.counts.download, 1);
        assert_eq!(
            fs::read_to_string(book_root.join("长夜/QM/entities/林照.md")).unwrap(),
            "v3"
        );

        for dir in [book_root, remote, history_dir] {
            fs::remove_dir_all(&dir).ok();
        }
    }

    #[test]
    fn local_delete_propagates_to_remote() {
        let book_root = temp_dir("delete");
        let remote = temp_dir("remote");
        let history_dir = temp_dir("history");
        let projects = vec![make_book(&book_root, "长夜", &[("QM/entities/旧角色.md", "old")])];
        let state = CloudSyncState::default();
        state.try_begin();
        let mut sink = |_event: EngineEvent| {};
        run(&options(&remote, &history_dir, projects.clone()), &state, &mut sink).unwrap();
        assert!(remote.join("长夜/QM/entities/旧角色.md").is_file());

        fs::remove_file(book_root.join("长夜/QM/entities/旧角色.md")).unwrap();
        let outcome = run(&options(&remote, &history_dir, projects), &state, &mut sink).unwrap();
        assert_eq!(outcome.batch.counts.delete, 1);
        assert!(!remote.join("长夜/QM/entities/旧角色.md").exists());

        for dir in [book_root, remote, history_dir] {
            fs::remove_dir_all(&dir).ok();
        }
    }

    #[test]
    fn both_sides_edited_keeps_remote_copy_and_uploads_local() {
        let book_root = temp_dir("conflict");
        let remote = temp_dir("remote");
        let history_dir = temp_dir("history");
        let projects = vec![make_book(&book_root, "长夜", &[("QM/entities/林照.md", "base")])];
        let state = CloudSyncState::default();
        state.try_begin();
        let mut sink = |_event: EngineEvent| {};
        run(&options(&remote, &history_dir, projects.clone()), &state, &mut sink).unwrap();

        fs::write(book_root.join("长夜/QM/entities/林照.md"), "local").unwrap();
        fs::write(remote.join("长夜/QM/entities/林照.md"), "remote").unwrap();
        let outcome = run(&options(&remote, &history_dir, projects), &state, &mut sink).unwrap();
        assert_eq!(outcome.batch.counts.conflict, 1);
        assert_eq!(outcome.batch.counts.failed, 0);

        let entity_dir = remote.join("长夜/QM/entities");
        let names: Vec<String> = fs::read_dir(&entity_dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        assert!(names.iter().any(|name| name.contains(".remote-")), "云端旧版本要留档");
        assert_eq!(
            fs::read_to_string(entity_dir.join("林照.md")).unwrap(),
            "local"
        );

        for dir in [book_root, remote, history_dir] {
            fs::remove_dir_all(&dir).ok();
        }
    }

    #[test]
    fn unchanged_manifest_is_not_rewritten() {
        // 远端可能就是网盘客户端的同步目录：没有变更还重写一遍，
        // 就是跟客户端抢同一个文件句柄（Windows 上报 os error 5）。
        let dir = temp_dir("manifest_nochange");
        let store = crate::cloud_sync::providers::FolderStore::new(&dir);
        let manifest = Manifest::default();
        manifest.save_if_changed(&store).unwrap();
        let path = dir.join(MANIFEST_FILE);
        let first = fs::metadata(&path).unwrap().modified().unwrap();

        std::thread::sleep(std::time::Duration::from_millis(30));
        manifest.save_if_changed(&store).unwrap();
        let second = fs::metadata(&path).unwrap().modified().unwrap();
        assert_eq!(first, second, "内容没变就不该重写");

        // 内容变了就必须写进去。
        let mut changed = Manifest::default();
        changed.books.insert(
            "id-a".to_string(),
            ManifestBook { dir: "书".to_string(), files: BTreeMap::new() },
        );
        changed.save_if_changed(&store).unwrap();
        let third = fs::metadata(&path).unwrap().modified().unwrap();
        assert!(third > second, "内容变了要写");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stop_request_mid_run_keeps_completed_work_and_writes_manifest() {
        let book_root = temp_dir("stop");
        let remote = temp_dir("remote");
        let history_dir = temp_dir("history");
        let files: Vec<(&str, &str)> = vec![
            ("QM/entities/a.md", "a"),
            ("QM/entities/b.md", "b"),
            ("QM/entities/c.md", "c"),
        ];
        let projects = vec![make_book(&book_root, "长夜", &files)];
        let state = CloudSyncState::default();
        state.try_begin();
        let mut sink = |event: EngineEvent| {
            if let EngineEvent::Progress { done, .. } = event {
                if done >= 1 {
                    // 处理完第一项就要求停止。
                    state.request_stop();
                }
            }
        };
        let outcome = run(&options(&remote, &history_dir, projects), &state, &mut sink).unwrap();
        assert!(outcome.stopped);
        assert!(matches!(outcome.batch.state, BatchState::Partial));
        assert!(remote.join(".qmai-cloud/manifest.json").is_file());
        // 已完成的文件必须真的落到远端。
        assert!(remote.join("长夜/QM/entities/a.md").is_file());

        for dir in [book_root, remote, history_dir] {
            fs::remove_dir_all(&dir).ok();
        }
    }

    #[test]
    fn missing_remote_root_reports_a_translatable_error_code() {
        let book_root = temp_dir("missing-remote");
        let history_dir = temp_dir("history");
        let projects = vec![make_book(&book_root, "长夜", &[("QM/entities/a.md", "a")])];
        let state = CloudSyncState::default();
        state.try_begin();
        let mut sink = |_event: EngineEvent| {};
        let missing = book_root.join("nope");
        let error = run(&options(&missing, &history_dir, projects), &state, &mut sink).unwrap_err();
        assert_eq!(error, "remote.missing");

        for dir in [book_root, history_dir] {
            fs::remove_dir_all(&dir).ok();
        }
    }

    #[test]
    fn book_dir_names_are_sanitized_and_deduplicated() {
        assert_eq!(sanitize_dir_name("长夜", "id-1"), "长夜");
        assert_eq!(sanitize_dir_name("a/b:c", "id-1"), "a_b_c");
        assert_eq!(sanitize_dir_name("   ", "abcdef12345"), "book-abcdef12");

        let mut index = BooksIndex::default();
        let first = ProjectRef { id: "i1".into(), name: "同名".into(), path: "/a".into() };
        let second = ProjectRef { id: "i2".into(), name: "同名".into(), path: "/b".into() };
        let dir1 = index.dir_for(&first);
        index.touch(&first, &dir1, 0);
        let dir2 = index.dir_for(&second);
        assert_eq!(dir1, "同名");
        assert_eq!(dir2, "同名-2");
    }

    #[test]
    fn conflict_name_keeps_extension_for_editors() {
        assert_eq!(conflict_name("QM/entities/林照.md", "S"), "QM/entities/林照.remote-S.md");
        assert_eq!(conflict_name("raw/无扩展名", "S"), "raw/无扩展名.remote-S");
    }

    #[test]
    fn history_is_written_even_when_nothing_changed() {
        let book_root = temp_dir("history-noop");
        let remote = temp_dir("remote");
        let history_dir = temp_dir("history");
        let projects = vec![make_book(&book_root, "长夜", &[("QM/entities/a.md", "a")])];
        let state = CloudSyncState::default();
        state.try_begin();
        let mut sink = |_event: EngineEvent| {};
        run(&options(&remote, &history_dir, projects.clone()), &state, &mut sink).unwrap();
        run(&options(&remote, &history_dir, projects), &state, &mut sink).unwrap();
        let history: History = history::load(&history_dir);
        assert_eq!(history.batches.len(), 2);

        for dir in [book_root, remote, history_dir] {
            fs::remove_dir_all(&dir).ok();
        }
    }
}
