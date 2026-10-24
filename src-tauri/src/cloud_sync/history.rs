//! 同步历史：`<app_data>/cloud-sync/history.json`。
//!
//! 为什么不放进项目目录：项目里任何文件都会被同步，把历史写在里面
//! 等于每轮同步都给自己造一条新记录 → 永远同步不完（自激）。
//!
//! 读取失败一律按「空历史」处理，并把手上的坏文件改名留档：
//! 历史只是展示用的，不该阻塞启动，也不该静默丢掉用户可反馈的证据。

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const HISTORY_FILE: &str = "history.json";

/// 最多保留的条目数。
pub const MAX_ENTRIES: usize = 200;
/// 最多保留的批次壳数。
pub const MAX_BATCHES: usize = 20;
/// 条目最长保留天数。
pub const MAX_AGE_DAYS: i64 = 30;

const MS_PER_DAY: i64 = 86_400_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncCounts {
    pub upload: u32,
    pub download: u32,
    pub delete: u32,
    pub conflict: u32,
    pub skip: u32,
    pub failed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SyncDirection {
    Upload,
    Download,
    Delete,
    Conflict,
    Skip,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BatchState {
    Running,
    Ok,
    Partial,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncEntry {
    pub id: String,
    pub batch_id: String,
    pub at: i64,
    pub direction: SyncDirection,
    /// 项目内相对路径（不含项目根）。
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncBatch {
    pub batch_id: String,
    pub started_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
    pub trigger: String,
    pub state: BatchState,
    pub counts: SyncCounts,
    /// 这一批同步到的网盘（`baidu` / `webdav` / `folder`）。
    ///
    /// 一轮同步可能同时写多个网盘：每个网盘一个批次，详情面板按它分组，
    /// 用户才能看出「这份文件进了哪个盘」。旧历史没有这个字段，按未知处理。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct History {
    #[serde(default)]
    pub batches: Vec<SyncBatch>,
    #[serde(default)]
    pub entries: Vec<SyncEntry>,
}

pub fn history_path(dir: &Path) -> PathBuf {
    dir.join(HISTORY_FILE)
}

pub fn load(dir: &Path) -> History {
    let path = history_path(dir);
    let Ok(text) = fs::read_to_string(&path) else {
        return History::default();
    };
    match serde_json::from_str::<History>(&text) {
        Ok(history) => history,
        Err(_) => {
            // 留档坏文件，别静默覆盖：用户反馈「历史乱了」时还能查。
            let stamp = chrono::Utc::now().format("%Y%m%d%H%M%S");
            let _ = fs::rename(&path, dir.join(format!("{HISTORY_FILE}.corrupt-{stamp}")));
            History::default()
        }
    }
}

pub fn save(dir: &Path, history: &History) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|error| format!("创建云同步目录失败：{error}"))?;
    let text = serde_json::to_string(history).map_err(|error| format!("序列化历史失败：{error}"))?;
    let target = history_path(dir);
    let tmp = dir.join(format!("{HISTORY_FILE}.tmp"));
    fs::write(&tmp, text.as_bytes()).map_err(|error| format!("写历史失败：{error}"))?;
    fs::rename(&tmp, &target).map_err(|error| format!("替换历史失败：{error}"))?;
    Ok(())
}

/// 追加一轮结果并裁剪。裁剪规则只看「新」与「量」：用户关心的是最近发生了什么。
pub fn append(dir: &Path, batch: SyncBatch, mut entries: Vec<SyncEntry>, now: i64) -> Result<History, String> {
    let mut history = load(dir);
    history.batches.push(batch);
    history.entries.append(&mut entries);
    trim(&mut history, now);
    save(dir, &history)?;
    Ok(history)
}

pub fn trim(history: &mut History, now: i64) {
    // 按时间排序后再裁：只保证「留下的是最新的」，不依赖调用方的追加顺序。
    history.entries.sort_by_key(|entry| entry.at);
    let cutoff = now - MAX_AGE_DAYS * MS_PER_DAY;
    history.entries.retain(|entry| entry.at >= cutoff);
    if history.entries.len() > MAX_ENTRIES {
        let drop_count = history.entries.len() - MAX_ENTRIES;
        history.entries.drain(0..drop_count);
    }

    history.batches.sort_by(|left, right| left.started_at.cmp(&right.started_at));
    if history.batches.len() > MAX_BATCHES {
        let drop_count = history.batches.len() - MAX_BATCHES;
        history.batches.drain(0..drop_count);
    }

    // 批次壳保留最近 MAX_BATCHES 个：「本轮没有变更」的批次也要能看到，
    // 否则用户点开详情会以为应用根本没同步过。
}

pub fn clear(dir: &Path) -> Result<(), String> {
    let path = history_path(dir);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("清空历史失败：{error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qmai_history_{name}_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn entry(batch_id: &str, at: i64, name: &str) -> SyncEntry {
        SyncEntry {
            id: uuid::Uuid::new_v4().to_string(),
            batch_id: batch_id.to_string(),
            at,
            direction: SyncDirection::Upload,
            path: name.to_string(),
            book_id: Some("b1".to_string()),
            book_name: Some("长夜".to_string()),
            bytes: Some(12),
            ok: true,
            error_code: None,
            error_detail: None,
        }
    }

    fn batch(id: &str, at: i64) -> SyncBatch {
        SyncBatch {
            batch_id: id.to_string(),
            started_at: at,
            finished_at: Some(at + 10),
            trigger: "manual".to_string(),
            state: BatchState::Ok,
            counts: SyncCounts { upload: 1, ..Default::default() },
            provider: Some("folder".to_string()),
        }
    }

    #[test]
    fn missing_history_is_empty_not_an_error() {
        let dir = temp_dir("missing");
        let history = load(&dir);
        assert!(history.entries.is_empty());
        assert!(history.batches.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn append_then_load_round_trips() {
        let dir = temp_dir("roundtrip");
        let now = 1_800_000_000_000;
        append(&dir, batch("b1", now), vec![entry("b1", now, "QM/entities/林照.md")], now).unwrap();
        let history = load(&dir);
        assert_eq!(history.batches.len(), 1);
        assert_eq!(history.entries.len(), 1);
        assert_eq!(history.entries[0].path, "QM/entities/林照.md");
        assert_eq!(history.entries[0].direction, SyncDirection::Upload);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn corrupt_history_is_quarantined_and_treated_as_empty() {
        let dir = temp_dir("corrupt");
        fs::write(history_path(&dir), b"{broken").unwrap();
        let history = load(&dir);
        assert!(history.entries.is_empty());
        let quarantined = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"));
        assert!(quarantined, "坏文件应改名留档");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn trim_drops_old_entries_and_caps_count() {
        let now = 1_800_000_000_000;
        let mut history = History::default();
        history.entries.push(entry("old", now - (MAX_AGE_DAYS + 1) * MS_PER_DAY, "old.md"));
        for index in 0..(MAX_ENTRIES + 15) {
            history.entries.push(entry("fresh", now - index as i64, &format!("f{index}.md")));
        }
        trim(&mut history, now);
        assert_eq!(history.entries.len(), MAX_ENTRIES);
        assert!(!history.entries.iter().any(|entry| entry.path == "old.md"));
        // 保留的是最新的那批：f0 一定还在。
        assert!(history.entries.iter().any(|entry| entry.path == "f0.md"));
    }

    #[test]
    fn trim_caps_batches_to_most_recent() {
        let now = 1_800_000_000_000;
        let mut history = History::default();
        for index in 0..(MAX_BATCHES + 5) {
            history.batches.push(batch(&format!("b{index}"), now - (index as i64) * 1000));
        }
        trim(&mut history, now);
        assert_eq!(history.batches.len(), MAX_BATCHES);
        // 最新的批次留下（b0 的 started_at 最大），最老的 b{MAX_BATCHES+4} 被裁掉。
        assert!(history.batches.iter().any(|item| item.batch_id == "b0"));
        assert!(!history.batches.iter().any(|item| item.batch_id == format!("b{}", MAX_BATCHES + 4)));
    }

    #[test]
    fn clear_removes_file_and_is_idempotent() {
        let dir = temp_dir("clear");
        let now = 1_800_000_000_000;
        append(&dir, batch("b1", now), vec![entry("b1", now, "a.md")], now).unwrap();
        clear(&dir).unwrap();
        assert!(load(&dir).entries.is_empty());
        clear(&dir).unwrap();
        fs::remove_dir_all(&dir).ok();
    }
}
