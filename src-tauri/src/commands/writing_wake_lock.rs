use std::{
    collections::HashSet,
    sync::mpsc,
    thread::{self, JoinHandle},
};

use tauri::State;
use tokio::sync::oneshot;

type WorkerResult<T> = Result<T, String>;

enum WorkerCommand {
    Acquire {
        reply: oneshot::Sender<WorkerResult<String>>,
    },
    Release {
        token: String,
        reply: oneshot::Sender<WorkerResult<()>>,
    },
}

struct WakeLockRegistry<T> {
    tokens: HashSet<String>,
    assertion: Option<T>,
}

impl<T> Default for WakeLockRegistry<T> {
    fn default() -> Self {
        Self {
            tokens: HashSet::new(),
            assertion: None,
        }
    }
}

impl<T> WakeLockRegistry<T> {
    fn acquire<E>(&mut self, create_assertion: impl FnOnce() -> Result<T, E>) -> Result<String, E> {
        if self.assertion.is_none() {
            self.assertion = Some(create_assertion()?);
        }

        let token = uuid::Uuid::new_v4().to_string();
        self.tokens.insert(token.clone());
        Ok(token)
    }

    fn release(&mut self, token: &str) {
        if !self.tokens.remove(token) {
            return;
        }
        if self.tokens.is_empty() {
            self.assertion.take();
        }
    }
}

struct SystemAssertions {
    _keep_awake: keepawake::KeepAwake,
    #[cfg(target_os = "macos")]
    _activity: Option<macos_activity::MacosProcessActivity>,
}

#[cfg(target_os = "macos")]
mod macos_activity {
    use objc2::runtime::{NSObjectProtocol, ProtocolObject};
    use objc2::rc::Retained;
    use objc2_foundation::{ns_string, NSActivityOptions, NSProcessInfo};

    pub struct MacosProcessActivity {
        process: Retained<NSProcessInfo>,
        activity: Retained<ProtocolObject<dyn NSObjectProtocol>>,
    }

    impl MacosProcessActivity {
        pub fn begin() -> Option<Self> {
            let process = NSProcessInfo::processInfo();
            let activity = process.beginActivityWithOptions_reason(
                NSActivityOptions::UserInteractive,
                ns_string!("QMaiWrite 正在执行长任务"),
            );
            Some(Self { process, activity })
        }
    }

    impl Drop for MacosProcessActivity {
        fn drop(&mut self) {
            unsafe { self.process.endActivity(&self.activity) }
        }
    }
}

fn create_system_wake_lock() -> Result<SystemAssertions, String> {
    let keep_awake = keepawake::Builder::default()
        .display(true)
        .idle(true)
        .sleep(false)
        .reason("QMaiWrite 正在生成小说正文")
        .app_name("QMaiWrite")
        .app_reverse_domain("com.qingmuai.writer")
        .create()
        .map_err(|error| format!("无法启用写作防休眠：{error}"))?;

    Ok(SystemAssertions {
        _keep_awake: keep_awake,
        #[cfg(target_os = "macos")]
        _activity: macos_activity::MacosProcessActivity::begin(),
    })
}

fn run_worker(receiver: mpsc::Receiver<WorkerCommand>) {
    // keepawake 在 Windows 上使用线程级 SetThreadExecutionState。
    // 创建、持有和释放必须始终发生在这个专用线程，不能交给 Tauri IPC 线程池。
    let mut registry = WakeLockRegistry::default();

    while let Ok(command) = receiver.recv() {
        match command {
            WorkerCommand::Acquire { reply } => {
                let result = registry.acquire(create_system_wake_lock);
                let _ = reply.send(result);
            }
            WorkerCommand::Release { token, reply } => {
                registry.release(&token);
                let _ = reply.send(Ok(()));
            }
        }
    }
    // receiver 断开时 registry 在此线程销毁，确保系统断言也在原线程释放。
}

pub struct WritingWakeLockManager {
    sender: Option<mpsc::Sender<WorkerCommand>>,
    worker: Option<JoinHandle<()>>,
}

impl Default for WritingWakeLockManager {
    fn default() -> Self {
        let (sender, receiver) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("qmai-writing-wake-lock".to_string())
            .spawn(move || run_worker(receiver));

        match worker {
            Ok(worker) => Self {
                sender: Some(sender),
                worker: Some(worker),
            },
            Err(error) => {
                eprintln!("[writing-wake-lock] 无法启动防休眠线程：{error}");
                Self {
                    sender: None,
                    worker: None,
                }
            }
        }
    }
}

impl WritingWakeLockManager {
    async fn acquire(&self) -> WorkerResult<String> {
        let (reply, response) = oneshot::channel();
        self.sender
            .as_ref()
            .ok_or_else(|| "写作防休眠管理器已关闭".to_string())?
            .send(WorkerCommand::Acquire { reply })
            .map_err(|_| "写作防休眠线程不可用".to_string())?;
        response
            .await
            .map_err(|_| "写作防休眠线程未返回结果".to_string())?
    }

    async fn release(&self, token: String) -> WorkerResult<()> {
        let (reply, response) = oneshot::channel();
        self.sender
            .as_ref()
            .ok_or_else(|| "写作防休眠管理器已关闭".to_string())?
            .send(WorkerCommand::Release { token, reply })
            .map_err(|_| "写作防休眠线程不可用".to_string())?;
        response
            .await
            .map_err(|_| "写作防休眠线程未返回结果".to_string())?
    }
}

impl Drop for WritingWakeLockManager {
    fn drop(&mut self) {
        self.sender.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[tauri::command]
pub async fn acquire_writing_wake_lock(
    state: State<'_, WritingWakeLockManager>,
) -> WorkerResult<String> {
    state.acquire().await
}

#[tauri::command]
pub async fn release_writing_wake_lock(
    token: String,
    state: State<'_, WritingWakeLockManager>,
) -> WorkerResult<()> {
    state.release(token).await
}

#[cfg(test)]
mod tests {
    use super::WakeLockRegistry;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    struct DropProbe(Arc<AtomicUsize>);

    impl Drop for DropProbe {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn concurrent_tokens_share_one_assertion_until_the_last_release() {
        let creates = Arc::new(AtomicUsize::new(0));
        let drops = Arc::new(AtomicUsize::new(0));
        let mut registry = WakeLockRegistry::default();

        let first = registry
            .acquire(|| {
                creates.fetch_add(1, Ordering::SeqCst);
                Ok::<_, ()>(DropProbe(drops.clone()))
            })
            .unwrap();
        let second = registry
            .acquire(|| {
                creates.fetch_add(1, Ordering::SeqCst);
                Ok::<_, ()>(DropProbe(drops.clone()))
            })
            .unwrap();

        assert_eq!(creates.load(Ordering::SeqCst), 1);
        registry.release(&first);
        assert_eq!(drops.load(Ordering::SeqCst), 0);
        registry.release(&second);
        assert_eq!(drops.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn duplicate_or_unknown_release_is_idempotent() {
        let drops = Arc::new(AtomicUsize::new(0));
        let mut registry = WakeLockRegistry::default();
        let token = registry
            .acquire(|| Ok::<_, ()>(DropProbe(drops.clone())))
            .unwrap();

        registry.release("unknown");
        assert_eq!(drops.load(Ordering::SeqCst), 0);
        registry.release(&token);
        registry.release(&token);
        assert_eq!(drops.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn failed_creation_does_not_register_a_token_and_can_retry() {
        let drops = Arc::new(AtomicUsize::new(0));
        let mut registry: WakeLockRegistry<DropProbe> = WakeLockRegistry::default();

        assert!(registry
            .acquire(|| Err::<DropProbe, _>("unavailable"))
            .is_err());
        assert!(registry.tokens.is_empty());

        let token = registry
            .acquire(|| Ok::<_, &str>(DropProbe(drops.clone())))
            .unwrap();
        registry.release(&token);
        assert_eq!(drops.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn dropping_registry_releases_an_active_assertion() {
        let drops = Arc::new(AtomicUsize::new(0));
        {
            let mut registry = WakeLockRegistry::default();
            registry
                .acquire(|| Ok::<_, ()>(DropProbe(drops.clone())))
                .unwrap();
        }
        assert_eq!(drops.load(Ordering::SeqCst), 1);
    }
}
