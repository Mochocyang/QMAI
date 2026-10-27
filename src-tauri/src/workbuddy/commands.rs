//! 对前端暴露的 Tauri 命令：登录、账号、导入、模型目录、网关地址。
//!
//! ── 唯一的硬约束 ───────────────────────────────────────────
//! **任何返回值里都不许出现 accessToken / refreshToken**。命令层能拿到完整
//! [`super::accounts::Account`]，但只能交出 `public_view` 的形状（昵称、uid 尾号、
//! 到期时间）。凭证留在 Rust 侧的唯一去处是网关发请求时拼头。
//!
//! ── 登录为什么是「开始 / 等 / 取消」三条命令 ─────────────────
//! 登录本身是分钟级的（用户要扫码、输密码、过验证码），不能占住一条 IPC。
//! 所以：`start` 立刻返回 `{state, authUrl}` 并在后台起轮询；前端每 2 秒
//! `wait` 一次拿状态；`cancel` 置取消标记。这三条与 Agent2API 的
//! `/api/session/login/{start,wait,cancel}` 同构，但走 IPC 而不是 HTTP ——
//! 少一个本机端口就少一处能被别的进程摸到的地方。
//!
//! ── 网关按需启动 ────────────────────────────────────────────
//! `gateway_ensure` 第一次调用时起网关（绑 127.0.0.1:0），之后返回同一个地址与
//! 令牌。前端拿它拼 `customEndpoint` 与 `apiKey`（见 `workbuddy-gateway.ts`）。
//! 网关起不来不致命：模型列表与账号管理照常可用，只有对话不可用，错误文案会
//! 说明原因。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use super::accounts::{now_ms, AccountStore, Auth};
use super::endpoints::Edition;
use super::gateway::{self, GatewayHandle, GatewayState};
use super::login::{account_from_credential, LoginFlow, LoginStart, LoginTasks, TaskStatus};
use super::models::ModelCache;
use super::{import, logging, login_window, refresh};

/// 命令层共享状态（`lib.rs` 的 setup 里 `manage` 进来）。
pub struct WorkbuddyState {
    pub store: Arc<Mutex<AccountStore>>,
    pub cache: Arc<Mutex<ModelCache>>,
    pub tasks: Arc<LoginTasks>,
    gateway: Mutex<Option<GatewayHandle>>,
    gateway_error: Mutex<Option<String>>,
}

impl WorkbuddyState {
    /// 从应用配置目录加载（账号 + 目录缓存）。
    pub fn load(dir: PathBuf) -> Result<WorkbuddyState, String> {
        std::fs::create_dir_all(&dir)
            .map_err(|error| format!("创建 WorkBuddy 数据目录失败：{error}"))?;
        let store = AccountStore::load(&dir)?;
        let cache = ModelCache::load(&dir, Edition::CN.provider_id());
        Ok(WorkbuddyState {
            store: Arc::new(Mutex::new(store)),
            cache: Arc::new(Mutex::new(cache)),
            tasks: Arc::new(LoginTasks::default()),
            gateway: Mutex::new(None),
            gateway_error: Mutex::new(None),
        })
    }

    /// 永远不会失败的加载：账号文件坏掉时退化成「空仓库」，而不是让整个应用
    /// 起不来（设置页仍能打开，用户至少看得到「还没有登录账号」）。
    ///
    /// `tauri::State` 要求 setup 阶段一定 manage 一个值；这里失败即 panic 的
    /// 路径必须堵死 —— 一次磁盘异常不该让用户连不上小说编辑器。
    pub fn load_or_default(dir: PathBuf) -> WorkbuddyState {
        match WorkbuddyState::load(dir.clone()) {
            Ok(state) => state,
            Err(error) => {
                logging::warn(&format!("初始化 WorkBuddy 账号存储失败：{error}"));
                WorkbuddyState {
                    store: Arc::new(Mutex::new(AccountStore::empty(&dir))),
                    cache: Arc::new(Mutex::new(ModelCache::load(
                        &dir,
                        Edition::CN.provider_id(),
                    ))),
                    tasks: Arc::new(LoginTasks::default()),
                    gateway: Mutex::new(None),
                    gateway_error: Mutex::new(Some(error)),
                }
            }
        }
    }

    /// 确保网关在跑；返回 `(base_url, token)`。
    pub async fn ensure_gateway(&self) -> Result<(String, String), String> {
        if let Ok(guard) = self.gateway.lock() {
            if let Some(handle) = guard.as_ref() {
                return Ok((handle.base_url.clone(), handle.token.clone()));
            }
        }

        let token = random_token();
        let state = GatewayState {
            token: token.clone(),
            store: self.store.clone(),
            cache: self.cache.clone(),
        };
        match gateway::start(state).await {
            Ok(handle) => {
                let base_url = handle.base_url.clone();
                logging::info(&format!("本地网关已启动：{base_url}"));
                if let Ok(mut guard) = self.gateway.lock() {
                    *guard = Some(handle);
                }
                if let Ok(mut error) = self.gateway_error.lock() {
                    *error = None;
                }
                Ok((base_url, token))
            }
            Err(error) => {
                if let Ok(mut slot) = self.gateway_error.lock() {
                    *slot = Some(error.clone());
                }
                Err(error)
            }
        }
    }

    /// 按 provider id 取版本（未知则国内版）。
    pub fn edition_of(provider: Option<&str>) -> Edition {
        provider
            .and_then(Edition::from_provider_id)
            .unwrap_or(Edition::CN)
    }

    fn require_edition(provider: Option<&str>) -> Result<Edition, String> {
        match provider {
            None | Some("") => Ok(Edition::CN),
            Some(id) => Edition::from_provider_id(id).ok_or_else(|| {
                format!("未知的 WorkBuddy 版本：{id}（本期只支持 workbuddy 国内版）")
            }),
        }
    }

    fn current_account(&self) -> Result<Option<super::accounts::Account>, String> {
        let store = self
            .store
            .lock()
            .map_err(|_| "账号状态锁失效".to_string())?;
        Ok(store.current())
    }

    fn public_view(&self) -> Result<Value, String> {
        let store = self
            .store
            .lock()
            .map_err(|_| "账号状态锁失效".to_string())?;
        Ok(store.public_view())
    }

    fn upsert(&self, account: super::accounts::Account) -> Result<Value, String> {
        let mut store = self
            .store
            .lock()
            .map_err(|_| "账号状态锁失效".to_string())?;
        store.upsert(account)?;
        Ok(store.public_view())
    }
}

fn random_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

// ─── 登录 ────────────────────────────────────────────────────

/// 开始一次网页登录：拿 `{state, authUrl}`，内嵌模式顺手开窗，后台开始轮询。
#[tauri::command]
pub async fn workbuddy_login_start(
    app: AppHandle,
    state: State<'_, WorkbuddyState>,
    provider: Option<String>,
    mode: Option<String>,
) -> Result<Value, String> {
    let edition = WorkbuddyState::require_edition(provider.as_deref())?;
    let embedded = mode.as_deref() != Some("external");

    let flow = LoginFlow::new(edition);
    let start = flow.start().await?;
    let handle = state.tasks.register(start.clone());

    if embedded {
        login_window::open_embedded(
            &app,
            edition,
            &start.auth_url,
            &start.state,
            state.tasks.clone(),
        )?;
    }

    spawn_login_waiter(app.clone(), state.tasks.clone(), flow, start.clone(), handle);
    Ok(json!({
        "state": start.state,
        "authUrl": start.auth_url,
        "provider": start.provider,
        "edition": start.edition,
        "mode": if embedded { "embedded" } else { "external" },
    }))
}

fn spawn_login_waiter(
    app: AppHandle,
    tasks: Arc<LoginTasks>,
    flow: LoginFlow,
    start: LoginStart,
    handle: Arc<Mutex<super::login::TaskState>>,
) {
    let store_handle = handle.clone();
    tauri::async_runtime::spawn(async move {
        let is_canceled = || match handle.lock() {
            Ok(task) => task.canceled,
            Err(_) => true,
        };
        let result = flow.wait(&start.state, is_canceled).await;

        match result {
            Ok(credential) => {
                // 落库要用应用状态里的 store，避免和设置页拿到两份内存副本。
                let state_ref = app.state::<WorkbuddyState>();
                let edition = WorkbuddyState::edition_of(Some(&start.provider));
                let account = account_from_credential(edition, &credential);
                let saved = {
                    let mut store = match state_ref.store.lock() {
                        Ok(store) => store,
                        Err(_) => {
                            tasks.set_failed(&start.state, "账号状态锁失效");
                            return;
                        }
                    };
                    store.upsert(account)
                };
                match saved {
                    Ok(account) => {
                        logging::info(&format!(
                            "登录成功：{}（{}）",
                            account.display_name(),
                            account.provider
                        ));
                        tasks.set_ready(&start.state, &credential);
                        login_window::close(&app, &start.state);
                        // 登录后立刻拉一次目录：卡片要立刻能填模型。
                        let _ = refresh_models_inner(&state_ref).await;
                    }
                    Err(error) => tasks.set_failed(&start.state, &error),
                }
            }
            Err(error) => {
                if error.canceled() {
                    // 用户主动关窗/取消：不写"失败"，前端按取消收尾。
                    logging::info("登录已取消");
                } else {
                    let message = error.message();
                    logging::warn(&format!("登录失败：{message}"));
                    tasks.set_failed(&start.state, &message);
                }
                login_window::close(&app, &start.state);
            }
        }
        drop(store_handle);
    });
}

/// 问一次登录状态。
#[tauri::command]
pub fn workbuddy_login_wait(
    state: State<'_, WorkbuddyState>,
    login_state: String,
) -> Result<Value, String> {
    let Some(handle) = state.tasks.get(&login_state) else {
        return Ok(json!({ "status": "expired" }));
    };
    let task = handle.lock().map_err(|_| "登录任务状态锁失效".to_string())?;
    if task.canceled {
        return Ok(json!({ "status": "canceled" }));
    }
    match &task.status {
        TaskStatus::Pending => Ok(json!({ "status": "pending" })),
        TaskStatus::Ready { uid, nickname } => Ok(json!({
            "status": "ready",
            "account": { "uidTail": super::accounts::tail(uid, 6), "nickname": nickname },
            "accounts": state.public_view()?,
        })),
        TaskStatus::Failed(message) => Ok(json!({ "status": "failed", "error": message })),
    }
}

/// 取消一次登录（前端点「取消等待」时）。
#[tauri::command]
pub fn workbuddy_login_cancel(
    app: AppHandle,
    state: State<'_, WorkbuddyState>,
    login_state: String,
) -> Result<bool, String> {
    let canceled = state.tasks.cancel(&login_state);
    login_window::close(&app, &login_state);
    Ok(canceled)
}

// ─── 账号 ────────────────────────────────────────────────────

#[tauri::command]
pub fn workbuddy_accounts_list(state: State<'_, WorkbuddyState>) -> Result<Value, String> {
    state.public_view()
}

#[tauri::command]
pub fn workbuddy_account_remove(
    state: State<'_, WorkbuddyState>,
    id: String,
) -> Result<Value, String> {
    {
        let mut store = state
            .store
            .lock()
            .map_err(|_| "账号状态锁失效".to_string())?;
        store.remove(&id)?;
    }
    state.public_view()
}

/// 手动续期一次（界面上「刷新」按钮）。
#[tauri::command]
pub async fn workbuddy_account_refresh(
    state: State<'_, WorkbuddyState>,
    id: String,
) -> Result<Value, String> {
    let account = {
        let store = state
            .store
            .lock()
            .map_err(|_| "账号状态锁失效".to_string())?;
        store
            .get(&id)
            .ok_or_else(|| format!("账号不存在：{id}"))?
    };
    let auth: Auth = refresh::refresh(&account).await?;
    {
        let mut store = state
            .store
            .lock()
            .map_err(|_| "账号状态锁失效".to_string())?;
        store.update_auth(&id, auth)?;
    }
    state.public_view()
}

// ─── 导入 ────────────────────────────────────────────────────

/// 导入一份凭证文件（内容由前端读取后传文本进来）。
#[tauri::command]
pub fn workbuddy_import_file(
    state: State<'_, WorkbuddyState>,
    content: String,
    provider: Option<String>,
) -> Result<Value, String> {
    let fallback = WorkbuddyState::edition_of(provider.as_deref());
    let imported = import::parse_credential_file(&content)?;
    let edition = imported.edition_or(fallback);
    if edition != fallback {
        logging::info(&format!(
            "凭证文件里的站点属于{}，已按文件归属导入",
            edition.label
        ));
    }
    let account = super::accounts::Account::from_login(
        edition,
        &imported.uid,
        &imported.nickname,
        imported.auth(),
    );
    state.upsert(account.clone())?;
    Ok(json!({
        "account": {
            "id": account.id,
            "nickname": account.display_name(),
            "uidTail": super::accounts::tail(&account.uid, 6),
            "edition": edition.id,
            "editionLabel": edition.label,
        },
        "accounts": state.public_view()?,
    }))
}

// ─── 模型目录 ────────────────────────────────────────────────

async fn refresh_models_inner(state: &WorkbuddyState) -> Result<Vec<Value>, String> {
    let account = state
        .current_account()?
        .ok_or_else(|| "还没有登录 WorkBuddy 账号".to_string())?;
    let models = super::models::fetch_remote(&account).await?;
    {
        let mut cache = state
            .cache
            .lock()
            .map_err(|_| "模型目录状态锁失效".to_string())?;
        cache.store(models);
    }
    let cache = state
        .cache
        .lock()
        .map_err(|_| "模型目录状态锁失效".to_string())?;
    Ok(cache
        .models()
        .iter()
        .map(|model| {
            json!({
                "id": model.id,
                "name": if model.name.is_empty() { model.id.clone() } else { model.name.clone() },
                "maxInputTokens": model.max_input,
                "maxOutputTokens": model.max_output,
                "supportsToolCall": model.supports_tool_call,
                "supportsReasoning": model.supports_reasoning,
                "isDefault": model.is_default,
            })
        })
        .collect())
}

/// 重新拉一次模型目录（登录后、用户点刷新时）。
#[tauri::command]
pub async fn workbuddy_models_refresh(
    state: State<'_, WorkbuddyState>,
) -> Result<Value, String> {
    let models = refresh_models_inner(state.inner()).await?;
    let cached_at = {
        let cache = state
            .cache
            .lock()
            .map_err(|_| "模型目录状态锁失效".to_string())?;
        cache.fetched_at()
    };
    Ok(json!({ "models": models, "count": models.len(), "fetchedAt": cached_at }))
}

/// 读当前缓存的目录（不联网；界面首屏用）。
#[tauri::command]
pub fn workbuddy_models_cached(state: State<'_, WorkbuddyState>) -> Result<Value, String> {
    let cache = state
        .cache
        .lock()
        .map_err(|_| "模型目录状态锁失效".to_string())?;
    let models: Vec<Value> = cache
        .models()
        .iter()
        .map(|model| json!({ "id": model.id, "name": model.name }))
        .collect();
    Ok(json!({
        "models": models,
        "fetchedAt": cache.fetched_at(),
        "isRemote": cache.is_remote(),
    }))
}

// ─── 网关 ────────────────────────────────────────────────────

/// 确保网关在跑，返回 `{ready, baseUrl, token, v1BaseUrl}`。
#[tauri::command]
pub async fn workbuddy_gateway_ensure(
    state: State<'_, WorkbuddyState>,
) -> Result<Value, String> {
    match state.ensure_gateway().await {
        Ok((base_url, token)) => Ok(json!({
            "ready": true,
            "baseUrl": base_url,
            "v1BaseUrl": format!("{base_url}/v1"),
            "token": token,
        })),
        Err(error) => {
            let _ = now_ms();
            Ok(json!({ "ready": false, "error": error }))
        }
    }
}
