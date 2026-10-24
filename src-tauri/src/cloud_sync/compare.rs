//! 三方对比：本地（L）/ 远端（R）/ 上次同步清单（S = base）。
//!
//! 纯函数，不碰文件系统 —— 所有「谁变了」的判断都在这里，方便把边界情况
//! 一条条钉死在测试里。执行动作（真正拷文件）在 `engine`。

/// 一个文件的指纹：内容哈希 + 字节数。
///
/// 不用 mtime 做相等判断：网盘客户端、备份还原、跨设备都会改写 mtime，
/// 用 mtime 会把「内容没变」判成「改了」，于是每次同步都在无意义地上传。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileFingerprint {
    pub hash: String,
    pub size: u64,
}

impl FileFingerprint {
    pub fn new(hash: impl Into<String>, size: u64) -> Self {
        Self { hash: hash.into(), size }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncDecision {
    /// 三方一致或差异可自愈，什么都不做。
    NoChange,
    /// 本地新/改 → 传到远端。
    Upload,
    /// 远端新/改 → 取回本地。
    Download,
    /// 本地已删 → 远端也删。
    DeleteRemote,
    /// 远端已删、本地未改 → 本地也删（删除要双向传播，否则删掉的文件会一直复活）。
    DeleteLocal,
    /// 两边都改过 → 各自保留一份，由引擎决定冲突文件名。
    Conflict,
}

/// 三方对比判定。
///
/// 关键取舍（都写在测试里）：
/// 1. **远端缺失不等于本地该删**：远端文件丢了（用户清理网盘、同步目录换机器）
///    时重新上传，而不是把本地删掉 —— 数据丢失不可逆，重复上传可逆。
/// 2. **本地缺失才传播删除**：本地没了且远端还是上次那份 → 删远端。
/// 3. 本地缺失但远端也改过 → 冲突，不贸然删远端。
pub fn decide(
    local: Option<&FileFingerprint>,
    remote: Option<&FileFingerprint>,
    base: Option<&FileFingerprint>,
) -> SyncDecision {
    match (local, remote, base) {
        // 两边都没有：没什么可做（base 有也只剩清单修正）。
        (None, None, _) => SyncDecision::NoChange,

        // 首次同步：本地有、远端没有 → 上传。
        (Some(_), None, None) => SyncDecision::Upload,
        // 首次同步：远端有、本地没有 → 下载。
        (None, Some(_), None) => SyncDecision::Download,
        // 首次同步：两边都有 → 内容一样就跳过，不一样算冲突。
        (Some(local), Some(remote), None) => {
            if local.hash == remote.hash {
                SyncDecision::NoChange
            } else {
                SyncDecision::Conflict
            }
        }

        // 本地有、远端没了（说明别处删了远端）：
        // - 本地没动过：跟着删本地，删除才能双向传播。
        // - 本地改过：不能删用户刚写的东西，算冲突（本地这份随后会重新上传）。
        //
        // 注意「远端被误清空」不靠这里兜底，而是靠清单缺席：清单也没了时
        // base 全空，`Manifest::load` 返回 None，走的是「全部上传」分支。
        (Some(local), None, Some(base)) => {
            if local.hash == base.hash {
                SyncDecision::DeleteLocal
            } else {
                SyncDecision::Conflict
            }
        }

        // 本地没了、远端在：
        // - 远端也没动过：本地删除要传播到远端。
        // - 远端改过：两边都有改动，冲突，别删远端。
        (None, Some(remote), Some(base)) => {
            if remote.hash == base.hash {
                SyncDecision::DeleteRemote
            } else {
                SyncDecision::Conflict
            }
        }

        // 三方都在。
        (Some(local), Some(remote), Some(base)) => {
            if local.hash == remote.hash {
                SyncDecision::NoChange
            } else if local.hash == base.hash {
                // 本地没动 → 远端变了。
                SyncDecision::Download
            } else if remote.hash == base.hash {
                // 远端没动 → 本地变了。
                SyncDecision::Upload
            } else {
                SyncDecision::Conflict
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fp(hash: &str) -> FileFingerprint {
        FileFingerprint::new(hash, hash.len() as u64)
    }

    #[test]
    fn first_sync_uploads_new_local_file() {
        let local = fp("l1");
        assert_eq!(decide(Some(&local), None, None), SyncDecision::Upload);
    }

    #[test]
    fn first_sync_downloads_new_remote_file() {
        let remote = fp("r1");
        assert_eq!(decide(None, Some(&remote), None), SyncDecision::Download);
    }

    #[test]
    fn first_sync_with_identical_content_is_noop() {
        let local = fp("same");
        let remote = fp("same");
        assert_eq!(decide(Some(&local), Some(&remote), None), SyncDecision::NoChange);
    }

    #[test]
    fn first_sync_with_diverged_content_conflicts() {
        let local = fp("l1");
        let remote = fp("r1");
        assert_eq!(decide(Some(&local), Some(&remote), None), SyncDecision::Conflict);
    }

    #[test]
    fn local_edit_uploads_when_remote_untouched() {
        let base = fp("v1");
        let local = fp("v2");
        let remote = fp("v1");
        assert_eq!(decide(Some(&local), Some(&remote), Some(&base)), SyncDecision::Upload);
    }

    #[test]
    fn remote_edit_downloads_when_local_untouched() {
        let base = fp("v1");
        let local = fp("v1");
        let remote = fp("v2");
        assert_eq!(
            decide(Some(&local), Some(&remote), Some(&base)),
            SyncDecision::Download
        );
    }

    #[test]
    fn both_edited_is_conflict() {
        let base = fp("v1");
        let local = fp("v2");
        let remote = fp("v3");
        assert_eq!(decide(Some(&local), Some(&remote), Some(&base)), SyncDecision::Conflict);
    }

    #[test]
    fn identical_converged_content_is_noop() {
        let base = fp("v1");
        let local = fp("v2");
        let remote = fp("v2");
        assert_eq!(decide(Some(&local), Some(&remote), Some(&base)), SyncDecision::NoChange);
    }

    #[test]
    fn local_deletion_propagates_when_remote_untouched() {
        let base = fp("v1");
        let remote = fp("v1");
        assert_eq!(decide(None, Some(&remote), Some(&base)), SyncDecision::DeleteRemote);
    }

    #[test]
    fn local_deletion_does_not_clobber_a_remote_edit() {
        let base = fp("v1");
        let remote = fp("v2");
        assert_eq!(decide(None, Some(&remote), Some(&base)), SyncDecision::Conflict);
    }

    #[test]
    fn remote_deletion_propagates_when_local_untouched() {
        let base = fp("v1");
        let local = fp("v1");
        assert_eq!(decide(Some(&local), None, Some(&base)), SyncDecision::DeleteLocal);
    }

    #[test]
    fn remote_deletion_spares_a_locally_edited_file() {
        let base = fp("v1");
        let local = fp("v2");
        assert_eq!(decide(Some(&local), None, Some(&base)), SyncDecision::Conflict);
    }

    #[test]
    fn both_missing_needs_nothing() {
        let base = fp("v1");
        assert_eq!(decide(None, None, Some(&base)), SyncDecision::NoChange);
        assert_eq!(decide(None, None, None), SyncDecision::NoChange);
    }
}
