//! 云同步引擎的共享状态与模块入口。
//!
//! 分工：
//! - `compare` 纯函数：三方对比（本地 / 远端 / 上次清单）
//! - `scan`    本地扫描与哈希
//! - `providers` 远端适配器（P1 只有本地文件夹）
//! - `history` 同步历史（原子写 + 裁剪）
//! - `engine`  一轮同步的编排（扫描 → 对比 → 执行 → 记录 → 发事件）
//!
//! 约定：**引擎不碰 UI、不碰 Tauri 事件**，通过 `Sink` 回调把进度与条目交出去，
//! 这样纯逻辑可以在 `cargo test` 里跑，不需要启动应用。

pub mod baidu;
pub mod compare;
pub mod credentials;
pub mod engine;
pub mod github;
pub mod history;
pub mod providers;
pub mod resolve;
pub mod scan;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

/// 全局同步状态：谁在跑、跑到哪、有多少失败项、token 是否过期。
///
/// 用原子量而不是 `Mutex<Struct>`：这些字段每处理一个文件就要更新，
/// 读的一方（`cloud_sync_status`）只关心当前值，丢失一次中间值无所谓。
pub struct CloudSyncState {
    running: AtomicBool,
    stop_requested: AtomicBool,
    done: AtomicU32,
    total: AtomicU32,
    failure_count: AtomicU32,
    auth_expired: AtomicBool,
    /// 登录回调服务是否正等着浏览器回来（防止连点两次起两个监听）。
    login_active: AtomicBool,
    /// 用户点了取消：等待线程看到它就退出。用 Arc 是因为等待线程要比
    /// 这次命令活得更久，不能借用状态对象。
    login_cancel: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StateSnapshot {
    pub running: bool,
    pub done: u32,
    pub total: u32,
    pub failure_count: u32,
    pub auth_expired: bool,
}

impl Default for CloudSyncState {
    fn default() -> Self {
        Self {
            running: AtomicBool::new(false),
            stop_requested: AtomicBool::new(false),
            done: AtomicU32::new(0),
            total: AtomicU32::new(0),
            failure_count: AtomicU32::new(0),
            auth_expired: AtomicBool::new(false),
            login_active: AtomicBool::new(false),
            login_cancel: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl CloudSyncState {
    pub fn snapshot(&self) -> StateSnapshot {
        StateSnapshot {
            running: self.running.load(Ordering::SeqCst),
            done: self.done.load(Ordering::SeqCst),
            total: self.total.load(Ordering::SeqCst),
            failure_count: self.failure_count.load(Ordering::SeqCst),
            auth_expired: self.auth_expired.load(Ordering::SeqCst),
        }
    }

    /// 抢占「开始一轮」。已经有一轮在跑时返回 false，调用方直接复用现有批次。
    pub fn try_begin(&self) -> bool {
        if self.running.swap(true, Ordering::SeqCst) {
            return false;
        }
        self.stop_requested.store(false, Ordering::SeqCst);
        self.done.store(0, Ordering::SeqCst);
        self.total.store(0, Ordering::SeqCst);
        true
    }

    pub fn finish(&self) {
        self.running.store(false, Ordering::SeqCst);
        self.stop_requested.store(false, Ordering::SeqCst);
        self.done.store(0, Ordering::SeqCst);
        self.total.store(0, Ordering::SeqCst);
        // 失败数必须跟着一轮结束一起归零。
        // 曾经这里不清：某个盘失败了一次之后，failure_count 就一直挂在状态里，
        // 前端重启后 hydrate 读到它，于是界面永远显示「有 N 项同步失败」——
        // 而历史里早就没有失败条目了，用户点进去一无所获（真实投诉）。
        // 一轮的真实失败数由 run_now 在结束前用 set_failure_count 写一次，
        // 这里是「这一轮已经翻篇」的最终清零。
        self.failure_count.store(0, Ordering::SeqCst);
    }

    pub fn request_stop(&self) {
        self.stop_requested.store(true, Ordering::SeqCst);
    }

    pub fn stop_requested(&self) -> bool {
        self.stop_requested.load(Ordering::SeqCst)
    }

    pub fn set_total(&self, total: u32) {
        self.total.store(total, Ordering::SeqCst);
    }

    pub fn set_progress(&self, done: u32) {
        self.done.store(done, Ordering::SeqCst);
    }

    pub fn set_failure_count(&self, count: u32) {
        self.failure_count.store(count, Ordering::SeqCst);
    }

    /// 登录结果变化时更新；`cloud_sync_status` 据此让图标显示「授权过期」。
    pub fn set_auth_expired(&self, expired: bool) {
        self.auth_expired.store(expired, Ordering::SeqCst);
    }

    /// 抢占一次登录。已经有一次在等浏览器回调时返回 false。
    pub fn try_begin_login(&self) -> bool {
        if self.login_active.swap(true, Ordering::SeqCst) {
            return false;
        }
        self.login_cancel.store(false, Ordering::SeqCst);
        true
    }

    pub fn finish_login(&self) {
        self.login_active.store(false, Ordering::SeqCst);
        self.login_cancel.store(false, Ordering::SeqCst);
    }

    pub fn request_login_cancel(&self) {
        self.login_cancel.store(true, Ordering::SeqCst);
    }

    /// 交给登录等待线程的取消标志（Arc 克隆，线程独立持有）。
    /// 登录是不是还挂在后台等着（前端用它决定要不要继续显示 8 位码）。
    pub fn login_active(&self) -> bool {
        self.login_active.load(Ordering::SeqCst)
    }

    pub fn login_cancel_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.login_cancel)
    }
}

#[cfg(test)]
mod state_tests {
    use super::*;

    #[test]
    fn only_one_round_can_start_at_a_time() {
        let state = CloudSyncState::default();
        assert!(state.try_begin());
        assert!(!state.try_begin());
        state.finish();
        assert!(state.try_begin());
    }

    #[test]
    fn begin_clears_stop_flag_so_a_new_round_is_not_aborted_immediately() {
        let state = CloudSyncState::default();
        state.request_stop();
        assert!(state.try_begin());
        assert!(!state.stop_requested());
    }

    #[test]
    fn finish_resets_progress() {
        let state = CloudSyncState::default();
        state.try_begin();
        state.set_total(10);
        state.set_progress(4);
        state.finish();
        let snapshot = state.snapshot();
        assert!(!snapshot.running);
        assert_eq!(snapshot.done, 0);
        assert_eq!(snapshot.total, 0);
    }
}
