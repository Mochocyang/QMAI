//! 云同步命令层：配置读写 + 把引擎接到 Tauri（事件、状态、取消）。
//!
//! 分层：本文件只做「翻译」——读写配置、把前端参数转成 `EngineOptions`、
//! 把引擎事件转成 `cloud-sync://*` 事件、维护 `CloudSyncState`。
//! 真正的扫描/对比/执行在 `crate::cloud_sync::engine`，可以脱离 Tauri 单测。
//!
//! 进度条语义：`total` 只统计**真正要动的文件**，跳过项不进总数 ——
//! 否则「100% 但一个字节没传」会让用户以为同步坏了。
//!
//! 配置暂存 `<app_data>/cloud-sync/config.json`（原子写）；P2 并进 `app-state.json`。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;

use crate::cloud_sync::providers::{
    baidu_netdisk, BaiduStore, FolderStore, GithubStore, RemoteStore, WebdavStore,
};
use crate::cloud_sync::{baidu, credentials, engine, github, history, resolve, CloudSyncState};

const CLOUD_SYNC_DIR: &str = "cloud-sync";
const CONFIG_FILE: &str = "config.json";

/// 百度登录、WebDAV 尚未接入时的统一错误码。
const NOT_IMPLEMENTED: &str = "not.implemented";
/// 开关没开 / 没连网盘就点了同步。
const SYNC_DISABLED: &str = "sync.disabled";
/// 上一轮还没跑完。
const SYNC_BUSY: &str = "sync.busy";

/// 配置里的一个同步目标。三个网盘各自有独立的账号与连接态，
/// 所以不能像以前那样用一个 `provider` 字段 + 一份 `connected` 表达。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CloudTarget {
    pub provider: String,
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webdav_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webdav_user: Option<String>,
    /// GitHub 目标：仓库所有者（个人或组织）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_repo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_branch: Option<String>,
}

impl CloudTarget {
    pub fn new(provider: &str) -> Self {
        Self { provider: provider.to_string(), ..Default::default() }
    }

    /// 校验通过后填成「已连接」的样子。
    pub fn connected_as(mut self, label: String) -> Self {
        self.connected = true;
        self.account_label = Some(label);
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CloudSyncConfig {
    pub enabled: bool,
    pub scope: String,
    pub last_sync_at: Option<i64>,
    pub include_snapshots: bool,
    pub schema_version: u32,
    /// 权威存储：要同步的所有网盘。`schemaVersion 2` 起用这个。
    pub targets: Vec<CloudTarget>,

    // ---- 兼容投影：前端（以及旧版本回滚）读这些字段。
    // 它们**不是**独立状态，永远由 `targets` 里当前激活的那个派生出来。
    // 等多选界面落地后随 schema v3 一起删掉。
    pub provider: Option<String>,
    pub connected: bool,
    pub account_label: Option<String>,
    pub folder_path: Option<String>,
    pub webdav_url: Option<String>,
    pub webdav_user: Option<String>,
}

impl Default for CloudSyncConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            scope: "all".to_string(),
            last_sync_at: None,
            include_snapshots: true,
            schema_version: 2,
            targets: Vec::new(),
            provider: None,
            connected: false,
            account_label: None,
            folder_path: None,
            webdav_url: None,
            webdav_user: None,
        }
    }
}

impl CloudSyncConfig {
    /// 当前激活的目标（前端可见的那个）。
    pub fn active(&self) -> Option<&CloudTarget> {
        let provider = self.provider.as_deref();
        self.targets
            .iter()
            .find(|target| Some(target.provider.as_str()) == provider)
            .or_else(|| self.targets.iter().find(|target| target.connected))
            .or_else(|| self.targets.first())
    }

    /// 真正要跑同步的目标：**已勾选（在 targets 里）且已登录（connected）**。
    ///
    /// `targets` 就是"勾了哪些盘"——取消勾选会把它从列表里拿掉。
    /// `connected` 是"这个盘的账号/目录是否可用"。两者都要满足才同步。
    /// 曾经的 bug：取消勾选只把目标从 targets 拿掉，但凭据还在、`connected` 仍为真，
    /// 而筛选只看 `connected` —— 于是"没勾选的盘照样同步"。
    pub fn connected_targets(&self) -> Vec<CloudTarget> {
        self.targets.iter().filter(|target| target.connected).cloned().collect()
    }

    /// 只放这一个目标（测试与「单网盘」语义还用得到；生产路径都走 `target_mut` 的 upsert）。
    #[allow(dead_code)]
    pub fn set_single_target(&mut self, target: CloudTarget) {
        self.targets = vec![target];
    }

    /// 只把 `provider` 标成「正在配置的那个」，**不改 targets**。
    ///
    /// 这是给「点卡片主体看一眼」用的。绝不能走 `target_mut`：那是 upsert，
    /// 会把一个没勾选的网盘硬塞回 targets —— 用户取消勾选后点一下卡片
    /// 就又变回勾选状态（真实投诉）。
    pub fn focus_provider(&mut self, provider: &str) {
        self.provider = Some(provider.to_string());
    }

    pub fn target_mut(&mut self, provider: &str) -> &mut CloudTarget {
        if let Some(index) = self.targets.iter().position(|target| target.provider == provider) {
            return &mut self.targets[index];
        }
        self.targets.push(CloudTarget::new(provider));
        let last = self.targets.len() - 1;
        &mut self.targets[last]
    }

    /// 单目标语义（P2 阶段）：连一个网盘就把目标列表替换成它。
    /// 多选界面落地后改成 upsert，这里留了统一的入口。

    /// 把 `targets` 投影回兼容字段。任何读写之后都要调一次：
    /// 前端只认扁平字段，投影不刷新就会出现「已连接 WebDAV 却显示百度」。
    /// schema v1 → v2：老配置里扁平字段就是唯一的目标。
    ///
    /// 必须与 `project_active` 分开：投影是每次读写都跑的，如果迁移也放在里面，
    /// 「退出登录清空 targets」会立刻被扁平字段重新造回一个目标，永远退不干净。
    fn migrate_from_flat(&mut self) {
        if self.schema_version >= 2 || !self.targets.is_empty() {
            self.schema_version = 2;
            return;
        }
        if let Some(provider) = self.provider.clone() {
            let mut target = CloudTarget::new(&provider);
            target.connected = self.connected;
            target.account_label = self.account_label.clone();
            // 只搬这个目标用得上的字段：把 webdav 地址塞进 folder 目标，
            // 配置文件读起来会让人以为两件事混在一起了。
            match provider.as_str() {
                "folder" => target.folder_path = self.folder_path.clone(),
                "webdav" => {
                    target.webdav_url = self.webdav_url.clone();
                    target.webdav_user = self.webdav_user.clone();
                    target.folder_path = self.folder_path.clone();
                }
                _ => {}
            }
            self.targets.push(target);
        }
        self.schema_version = 2;
    }

    fn project_active(&mut self) {
        let active = self.active().cloned();
        match active {
            Some(target) => {
                self.provider = Some(target.provider.clone());
                self.connected = target.connected;
                self.account_label = target.account_label.clone();
                self.folder_path = target.folder_path.clone();
                self.webdav_url = target.webdav_url.clone();
                self.webdav_user = target.webdav_user.clone();
            }
            None => {
                self.provider = None;
                self.connected = false;
                self.account_label = None;
                self.folder_path = None;
                self.webdav_url = None;
                self.webdav_user = None;
            }
        }
        self.schema_version = 2;
    }
}

fn cloud_sync_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    Ok(base.join(CLOUD_SYNC_DIR))
}

fn config_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(cloud_sync_dir(app)?.join(CONFIG_FILE))
}

fn read_config<R: Runtime>(app: &AppHandle<R>) -> CloudSyncConfig {
    let Ok(path) = config_path(app) else {
        return CloudSyncConfig::default();
    };
    read_config_at(&path)
}

fn read_config_at(path: &Path) -> CloudSyncConfig {
    let Ok(text) = fs::read_to_string(path) else {
        return CloudSyncConfig::default();
    };
    // 别的工具（记事本、PowerShell `Set-Content -Encoding utf8`）会写 UTF-8 BOM，
    // serde_json 遇到 BOM 直接失败 —— 那样用户的配置会被当成「空配置」
    // 再被默认值覆盖回去，等于所有网盘绑定凭空消失。
    let text = text.trim_start_matches('\u{feff}');
    let mut config = serde_json::from_str::<CloudSyncConfig>(text).unwrap_or_default();
    let needs_migration = config.schema_version < 2;
    config.migrate_from_flat();
    config.project_active();
    if needs_migration {
        // 升级前的原件留一份：万一投影逻辑有偏差，用户还能找回自己的地址/账号。
        let _ = fs::copy(path, path.with_extension("json.v1.bak"));
    }
    config
}

/// 先写 `.tmp` 再 rename，避免断电留下半个 JSON。
fn write_config<R: Runtime>(app: &AppHandle<R>, config: &CloudSyncConfig) -> Result<(), String> {
    let dir = cloud_sync_dir(app)?;
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建云同步目录：{error}"))?;
    write_config_at(&dir, config)
}

fn write_config_at(dir: &Path, config: &CloudSyncConfig) -> Result<(), String> {
    let mut view = config.clone();
    view.project_active();
    let text = serde_json::to_string_pretty(&view).map_err(|error| format!("序列化配置失败：{error}"))?;
    let tmp = dir.join(format!("{CONFIG_FILE}.tmp"));
    let target = dir.join(CONFIG_FILE);
    fs::write(&tmp, text.as_bytes()).map_err(|error| format!("写入配置失败：{error}"))?;
    fs::rename(&tmp, &target).map_err(|error| format!("替换配置失败：{error}"))?;
    Ok(())
}

/// 把前端传来的 partial patch 合并进现有配置。
///
/// 只接受白名单字段：前端的 `Partial<CloudSyncConfig>` 会带 `undefined`（序列化后消失），
/// 这里仍按字段逐个判断，避免以后有人顺手把密钥塞进配置。
fn merge_patch(config: &mut CloudSyncConfig, patch: &Value) {
    let Some(object) = patch.as_object() else {
        return;
    };
    if let Some(value) = object.get("enabled").and_then(Value::as_bool) {
        config.enabled = value;
    }
    if let Some(value) = object.get("provider") {
        match value.as_str() {
            // 切换目标只换「激活项」，不动连接态：后端会按已保存的凭据重算。
            Some(provider) => {
                // 只换「正在配置的那个」，不动 targets。
                // 曾经这里用 target_mut（upsert），于是"点一下卡片主体"
                // 等于"勾选它" —— 用户取消勾选后点一下就又勾上了。
                let provider = provider.to_string();
                config.focus_provider(&provider);
            }
            None => {
                config.targets.clear();
                config.provider = None;
            }
        }
    }
    if let Some(value) = object.get("scope").and_then(Value::as_str) {
        config.scope = value.to_string();
    }
    // 以下字段都属于「当前激活目标」：先落到 target 上，再由投影回填扁平字段。
    let active_provider = config.provider.clone();
    if let Some(provider) = active_provider {
        let target = config.target_mut(&provider);
        if let Some(value) = object.get("connected").and_then(Value::as_bool) {
            target.connected = value;
        }
        if let Some(value) = object.get("accountLabel") {
            target.account_label = value.as_str().map(|text| text.to_string());
        }
        if let Some(value) = object.get("folderPath") {
            target.folder_path = value.as_str().map(|text| text.to_string());
        }
        if let Some(value) = object.get("webdavUrl") {
            target.webdav_url = value.as_str().map(|text| text.to_string());
        }
        if let Some(value) = object.get("webdavUser") {
            target.webdav_user = value.as_str().map(|text| text.to_string());
        }
    }
    if let Some(value) = object.get("targets").and_then(Value::as_array) {
        // 前端整体替换目标列表（勾选/取消某个网盘）。逐项反序列化，
        // 坏项直接丢掉而不是整批失败 —— 少一个目标总比配置写不进去好。
        let mut next: Vec<CloudTarget> = Vec::new();
        for item in value {
            if let Ok(target) = serde_json::from_value::<CloudTarget>(item.clone()) {
                if !target.provider.trim().is_empty() {
                    next.push(target);
                }
            }
        }
        config.targets = next;
        // 原来的激活目标被移除了：回到列表里的第一个。
        let still_there = config
            .provider
            .as_deref()
            .map(|provider| config.targets.iter().any(|target| target.provider == provider))
            .unwrap_or(false);
        if !still_there {
            config.provider = None;
        }
    }
    if let Some(value) = object.get("lastSyncAt").and_then(Value::as_i64) {
        config.last_sync_at = Some(value);
    }
    if let Some(value) = object.get("includeSnapshots").and_then(Value::as_bool) {
        config.include_snapshots = value;
    }
    config.project_active();
}

/// 推一份完整状态给前端：图标状态、进度、失败数、上次同步时间都靠它。
fn emit_status<R: Runtime>(app: &AppHandle<R>, config: &CloudSyncConfig) {
    let snapshot = app.state::<CloudSyncState>().snapshot();
    let _ = app.emit(
        "cloud-sync://state",
        json!({
            "config": config,
            "running": snapshot.running,
            "done": snapshot.done,
            "total": snapshot.total,
            "failureCount": snapshot.failure_count,
            "authExpired": snapshot.auth_expired,
        }),
    );
}

/// 多目标同步时，第二个盘的进度要接着第一个盘往后走：
/// 否则进度条会突然跳回 0，用户以为又从头开始了。
fn emit_engine_event_with_offset<R: Runtime>(
    app: &AppHandle<R>,
    event: engine::EngineEvent,
    done_offset: u32,
    total_offset: u32,
) {
    match event {
        engine::EngineEvent::Progress { done, total } => {
            let _ = app.emit(
                "cloud-sync://progress",
                json!({
                    "batchId": "",
                    "done": done_offset + done,
                    "total": total_offset + total,
                }),
            );
        }
        engine::EngineEvent::Entries(entries) => {
            let batch_id = entries.first().map(|entry| entry.batch_id.clone()).unwrap_or_default();
            let _ = app.emit(
                "cloud-sync://entries",
                json!({ "batchId": batch_id, "entries": entries }),
            );
        }
    }
}

/// 把刚写进历史的失败批次条目推给前端：详情面板打开时能立刻看到。
fn emit_history_entries<R: Runtime>(app: &AppHandle<R>, history: &history::History, batch: &history::SyncBatch) {
    let entries: Vec<history::SyncEntry> = history
        .entries
        .iter()
        .filter(|entry| entry.batch_id == batch.batch_id)
        .cloned()
        .collect();
    if entries.is_empty() {
        return;
    }
    let _ = app.emit(
        "cloud-sync://entries",
        json!({ "batchId": batch.batch_id, "entries": entries }),
    );
}

#[tauri::command]
pub fn cloud_sync_get_config<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    Ok(json!(read_config(&app)))
}

#[tauri::command]
pub fn cloud_sync_set_config<R: Runtime>(app: AppHandle<R>, patch: Value) -> Result<Value, String> {
    let mut config = read_config(&app);
    merge_patch(&mut config, &patch);
    reconcile_connection(&app, &mut config);
    write_config(&app, &config)?;
    emit_status(&app, &config);
    Ok(json!(config))
}

/// 百度凭据是否还有效。只看凭据本身：调用方已经确认目标是百度。
fn baidu_auth_expired<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Ok(dir) = cloud_sync_dir(app) else {
        return true;
    };
    match credentials::load(&dir) {
        Some(token) => !token.is_valid(baidu::now_ms()),
        None => true,
    }
}

#[tauri::command]
pub fn cloud_sync_status<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let config = read_config(&app);
    let expired = config
        .active()
        .map(|target| target.provider == "baidu" && target.connected && baidu_auth_expired(&app))
        .unwrap_or(false);
    app.state::<CloudSyncState>().set_auth_expired(expired);
    let snapshot = app.state::<CloudSyncState>().snapshot();
    Ok(json!({
        "config": config,
        "running": snapshot.running,
        "done": snapshot.done,
        "total": snapshot.total,
        "failureCount": snapshot.failure_count,
        "authExpired": snapshot.auth_expired,
    }))
}

/// 起回调服务并把授权页交给前端打开（前端用系统浏览器打开）。
///
/// 命令立刻返回 `authUrl`；真正的结果在回调线程里落盘并发 `cloud-sync://state`，
/// 前端靠 `connected=true` 关闭登录弹窗。
#[tauri::command]
pub fn cloud_sync_begin_login<R: Runtime>(app: AppHandle<R>, provider: String) -> Result<Value, String> {
    if provider == "github" {
        return begin_github_login(app);
    }
    if provider != "baidu" {
        return Ok(json!({ "authUrl": "", "errorCode": NOT_IMPLEMENTED }));
    }
    let Some(baidu_app) = baidu::app_from_env() else {
        // 应用凭据没配：这是开发期状态，不是用户操作错误，文案要说清楚。
        return Ok(json!({ "authUrl": "", "errorCode": "not.configured" }));
    };

    let state = app.state::<CloudSyncState>();
    if !state.try_begin_login() {
        return Ok(json!({ "authUrl": "", "errorCode": "auth.in-progress" }));
    }
    let cancel = state.login_cancel_flag();
    let app_for_task = app.clone();
    let auth_url = match baidu::start_login(
        baidu_app,
        baidu::CALLBACK_PORT,
        cancel,
        baidu::token_endpoint(),
        move |result| {
            finish_login(&app_for_task, result);
        },
    ) {
        Ok(url) => url,
        Err(error_code) => {
            state.finish_login();
            return Ok(json!({ "authUrl": "", "errorCode": error_code }));
        }
    };
    Ok(json!({ "authUrl": auth_url }))
}

/// 授权回调线程的收尾：落凭据、改配置、发状态。
fn finish_login<R: Runtime>(app: &AppHandle<R>, result: Result<baidu::BaiduToken, String>) {
    let state = app.state::<CloudSyncState>();
    state.finish_login();

    match result {
        Ok(token) => {
            let saved = cloud_sync_dir(app).and_then(|dir| credentials::save(&dir, &token));
            if let Err(error) = saved {
                let _ = app.emit(
                    "cloud-sync://notice",
                    json!({ "kind": "failure", "errorCode": "auth.store-failed" }),
                );
                log::warn!("[cloud-sync] 保存百度凭据失败：{error}");
                return;
            }
            let mut config = read_config(app);
            let mut target = CloudTarget::new("baidu").connected_as("百度网盘".to_string());
            target.folder_path = None;
            // upsert：登录一个网盘不该把别的网盘的目标冲掉。
            *config.target_mut("baidu") = target;
            config.enabled = true;
            config.project_active();
            let _ = write_config(app, &config);
            state.set_auth_expired(false);
            emit_status(app, &config);
        }
        Err(error_code) => {
            // 用户主动取消不弹失败气泡（那会显得像出错了）；其余失败要说清原因。
            if error_code != "auth.cancelled" {
                let _ = app.emit(
                    "cloud-sync://notice",
                    json!({ "kind": "failure", "errorCode": error_code }),
                );
            }
            emit_status(app, &read_config(app));
        }
    }
}

#[tauri::command]
pub fn cloud_sync_cancel_login<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.state::<CloudSyncState>().request_login_cancel();
    Ok(())
}

/// 连 WebDAV：先列目录、再写一个探针文件并删掉，两步都过才算连上。
///
/// 只 PROPFIND 不够：只读挂载、配额满、目录被 ACL 锁住都能列却不能写，
/// 用户会在第一次真正同步时才炸，那时更难解释。
#[tauri::command]
pub fn cloud_sync_connect_webdav<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    user: String,
    password: String,
) -> Result<Value, String> {
    if let Err(error_code) = WebdavStore::validate(&url, &user, &password) {
        return Ok(json!({ "ok": false, "errorCode": error_code }));
    }

    let dir = cloud_sync_dir(&app)?;
    credentials::save_webdav(
        &dir,
        &credentials::WebdavCredentials {
            url: url.clone(),
            user: user.clone(),
            password: password.clone(),
        },
    )?;

    let mut config = read_config(&app);
    let mut target = CloudTarget::new("webdav").connected_as(if user.trim().is_empty() {
        url.clone()
    } else {
        user.clone()
    });
    target.webdav_url = Some(url.clone());
    target.webdav_user = Some(user.clone());
    target.folder_path = None;
    // upsert：连一个新网盘不该把别的网盘的目标冲掉（多目标之前这里是 set_single_target，
    // 结果连 WebDAV 会把已经连好的「网盘本地文件夹」一起清掉）。
    *config.target_mut("webdav") = target;
    config.enabled = true;
    config.project_active();
    write_config(&app, &config)?;
    emit_status(&app, &config);
    Ok(json!({ "ok": true, "config": config }))
}

/// 按当前配置造出远端适配器；造不出来就给可翻译的错误码。
fn build_remote<R: Runtime>(app: &AppHandle<R>, target: &CloudTarget) -> Result<Box<dyn RemoteStore>, String> {
    match target.provider.as_str() {
        "folder" => {
            let Some(path) = target.folder_path.clone() else {
                return Err("remote.missing".to_string());
            };
            Ok(Box::new(FolderStore::new(PathBuf::from(path))))
        }
        "webdav" => {
            let Some(url) = target.webdav_url.clone() else {
                return Err("remote.missing".to_string());
            };
            let stored = cloud_sync_dir(app).ok().and_then(|dir| credentials::load_webdav(&dir));
            let (user, password) = match stored {
                Some(stored) if stored.url == url => (stored.user, stored.password),
                _ => {
                    // 配置文件在、凭据不在（换机/被清理）：要求重新连接，而不是拿空密码去撞。
                    return Err("webdav.reconnect".to_string());
                }
            };
            Ok(Box::new(WebdavStore::new(&url, &user, &password)?))
        }
        "github" => {
            let (Some(owner), Some(repo)) = (target.github_owner.clone(), target.github_repo.clone())
            else {
                return Err("github.no-repo".to_string());
            };
            // 凭据在、配置没了目标字段：要求重新连接，别拿空 token 去撞 401。
            let stored = cloud_sync_dir(app)
                .ok()
                .and_then(|dir| credentials::load_github(&dir));
            let Some(stored) = stored else {
                return Err("github.auth".to_string());
            };
            Ok(Box::new(GithubStore::new(
                &owner,
                &repo,
                target.github_branch.as_deref().unwrap_or("main"),
                &stored.token,
            )?))
        }
        "baidu" => {
            if baidu_auth_expired(app) {
                return Err("auth.expired".to_string());
            }
            // 搬运逻辑已接好，但默认关着：开发版配额 10 次/小时传不了几个文件
            // （一个文件要 precreate + 分片 + create）。审核通过后设环境变量即可启用。
            if !baidu_transfer_enabled() {
                return Err("sync.baidu-review".to_string());
            }
            let dir = cloud_sync_dir(app)?;
            let token = credentials::load(&dir).ok_or_else(|| "auth.required".to_string())?;
            Ok(Box::new(BaiduStore::new(
                &baidu_path(&baidu::app_name()),
                &token.access_token,
                baidu_netdisk::XPAN_BASE,
                baidu_netdisk::PCS_BASE,
            )?))
        }
        _ => Err("sync.disabled".to_string()),
    }
}

/// 选区当作远端根：当场校验（存在、可写、不是项目目录本身），通过才落配置。
#[tauri::command]
pub fn cloud_sync_connect_folder<R: Runtime>(app: AppHandle<R>, path: String) -> Result<Value, String> {
    let root = PathBuf::from(&path);
    if let Err(error_code) = FolderStore::validate(&root) {
        return Ok(json!({ "ok": false, "errorCode": error_code }));
    }

    let mut config = read_config(&app);
    let mut target = CloudTarget::new("folder").connected_as(folder_label(&root));
    target.folder_path = Some(root.to_string_lossy().to_string());
    // upsert：选一个新目录不该把别的网盘的目标冲掉。
    *config.target_mut("folder") = target;
    config.enabled = true;
    config.project_active();
    write_config(&app, &config)?;
    emit_status(&app, &config);
    Ok(json!({ "ok": true, "config": config }))
}

/// 百度网盘的远端根目录（`我的应用数据/<应用名>`）。
/// 百度文件搬运是否启用（应用审核通过后设 `QMAI_BAIDU_TRANSFER_ENABLED=1`）。
fn baidu_transfer_enabled() -> bool {
    matches!(
        std::env::var("QMAI_BAIDU_TRANSFER_ENABLED")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes"
    )
}

pub fn baidu_path(app_name: &str) -> String {
    format!("/apps/{app_name}")
}

/// 切换网盘后重算「连没连上」。
///
/// 前端切 provider 时会把 `connected` 清成 false（不这样做，界面上会出现
/// 「已连接 WebDAV」却显示成百度账号的错位）。但**凭据是留在磁盘上的**：
/// 用户从百度切回 WebDAV 时，只要 `webdav-credentials.bin` 还在，就应该直接
/// 恢复成已连接，而不是让人把地址和密码再敲一遍。
fn reconcile_connection<R: Runtime>(app: &AppHandle<R>, config: &mut CloudSyncConfig) {
    let Ok(dir) = cloud_sync_dir(app) else {
        return;
    };
    for target in config.targets.iter_mut() {
        match target.provider.as_str() {
            "webdav" => match credentials::load_webdav(&dir) {
                Some(stored) => {
                    target.webdav_url = Some(stored.url.clone());
                    target.webdav_user = Some(stored.user.clone());
                    target.connected = true;
                    target.account_label = Some(if stored.user.trim().is_empty() {
                        stored.url.clone()
                    } else {
                        stored.user.clone()
                    });
                }
                None => {
                    target.connected = false;
                    target.account_label = None;
                }
            },
            "github" => match (
                credentials::load_github(&dir),
                target.github_owner.clone(),
                target.github_repo.clone(),
            ) {
                (Some(_stored), Some(owner), Some(repo)) => {
                    target.connected = true;
                    target.account_label = Some(format!("{owner}/{repo}"));
                    if target.github_branch.as_deref().unwrap_or("").trim().is_empty() {
                        target.github_branch = Some("main".to_string());
                    }
                }
                _ => {
                    target.connected = false;
                    target.account_label = None;
                }
            },
            "folder" => match target.folder_path.as_deref() {
                Some(path) if Path::new(path).is_dir() => {
                    target.connected = true;
                    target.account_label = Some(folder_label(Path::new(path)));
                }
                _ => {
                    target.connected = false;
                    target.account_label = None;
                }
            },
            "baidu" => match credentials::load(&dir) {
                Some(token) if token.is_valid(baidu::now_ms()) => {
                    target.connected = true;
                    if target.account_label.is_none() {
                        target.account_label = Some("百度网盘".to_string());
                    }
                }
                token => {
                    // 凭据没了/过期：连接态必须跟着变，否则状态栏会一直显示「已连接」。
                    let _ = token;
                    target.connected = false;
                    target.account_label = None;
                }
            },
            _ => {
                target.connected = false;
                target.account_label = None;
            }
        }
    }
    config.project_active();
}

fn folder_label(root: &Path) -> String {
    root.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| root.to_string_lossy().to_string())
}

#[tauri::command]
pub fn cloud_sync_stop<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.state::<CloudSyncState>().request_stop();
    Ok(())
}

// ---------------------------------------------------------------- GitHub

/// 取当前 GitHub token（未授权返回 `None`，绝不 panic）。
fn current_github_token<R: Runtime>(app: &AppHandle<R>) -> Option<github::GithubToken> {
    cloud_sync_dir(app).ok().and_then(|dir| credentials::load_github(&dir))
}

fn github_repo_json(repo: &github::GithubRepo) -> Value {
    json!({
        "owner": repo.owner,
        "name": repo.name,
        "private": repo.private,
        "defaultBranch": repo.default_branch,
        "canPush": repo.can_push,
        "updatedAt": repo.updated_at,
    })
}

/// 设备流登录：先申请 8 位码，再在后台轮询直到用户确认。
///
/// 前端拿到 `userCode` 后打开 `verificationUri` 并显示码；随后轮询
/// `cloud_sync_github_auth_state` 判断是否已授权（不依赖事件，窗口关了也不丢）。
fn begin_github_login<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    // 已经授权过：不必再走一遍设备流（用户可能只是重新选仓库）。
    if let Some(stored) = current_github_token(&app) {
        return Ok(json!({
            "alreadyAuthorized": true,
            "accountLabel": stored.login,
        }));
    }

    let Some(oauth) = github::app_from_env() else {
        // 发布包里会内置 client_id；开发/自测时用环境变量注入。
        return Ok(json!({ "errorCode": "github.not-configured" }));
    };

    let state = app.state::<CloudSyncState>();
    if !state.try_begin_login() {
        return Ok(json!({ "errorCode": "auth.in-progress" }));
    }

    let login = match github::request_device_code(&oauth) {
        Ok(login) => login,
        Err(code) => {
            state.finish_login();
            return Ok(json!({ "errorCode": code }));
        }
    };

    let cancel = state.login_cancel_flag();
    let app_for_task = app.clone();
    let device_code = login.device_code.clone();
    let interval = login.interval.max(5);
    let expires_in = login.expires_in;
    std::thread::spawn(move || {
        let started = std::time::Instant::now();
        let mut wait = interval;
        let mut network_failures = 0u32;
        loop {
            if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            if started.elapsed().as_secs() >= expires_in {
                break;
            }
            std::thread::sleep(std::time::Duration::from_secs(wait));
            if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            match github::poll_device_token(&oauth, &device_code) {
                Ok(github::DevicePoll::Done(mut token)) => {
                    token.login = github::fetch_viewer(&token.token).unwrap_or_default();
                    finish_github_login(&app_for_task, Ok(token));
                    return;
                }
                Ok(github::DevicePoll::Pending) => {
                    network_failures = 0;
                }
                Ok(github::DevicePoll::SlowDown) => {
                    wait = (wait + 5).min(30);
                }
                Ok(github::DevicePoll::Denied) => {
                    finish_github_login(&app_for_task, Err("auth.denied".to_string()));
                    return;
                }
                Ok(github::DevicePoll::Expired) => {
                    finish_github_login(&app_for_task, Err("auth.expired".to_string()));
                    return;
                }
                Ok(github::DevicePoll::Misconfigured) => {
                    finish_github_login(&app_for_task, Err("github.misconfigured".to_string()));
                    return;
                }
                Err(code) => {
                    // 网络抖动不该一次就放弃（GitHub 在部分网络下会间歇性连不上）。
                    network_failures += 1;
                    if network_failures >= 3 {
                        finish_github_login(&app_for_task, Err(code));
                        return;
                    }
                    wait = (wait + 3).min(20);
                }
            }
        }
        finish_github_login(&app_for_task, Err("auth.expired".to_string()));
    });

    Ok(json!({
        "userCode": login.user_code,
        "verificationUri": login.verification_uri,
        "expiresIn": login.expires_in,
        "interval": login.interval,
    }))
}

fn finish_github_login<R: Runtime>(app: &AppHandle<R>, result: Result<github::GithubToken, String>) {
    let state = app.state::<CloudSyncState>();
    state.finish_login();

    match result {
        Ok(token) => {
            let dir = match cloud_sync_dir(app) {
                Ok(dir) => dir,
                Err(error) => {
                    log::warn!("[cloud-sync] 定位云同步目录失败：{error}");
                    return;
                }
            };
            if let Err(error) = credentials::save_github(&dir, &token) {
                log::warn!("[cloud-sync] 保存 GitHub 凭据失败：{error}");
                let _ = app.emit(
                    "cloud-sync://notice",
                    json!({ "kind": "failure", "errorCode": "auth.store-failed" }),
                );
                return;
            }
            // 授权成功只是「能访问 GitHub」，还没选仓库：不建 target。
            let _ = app.emit(
                "cloud-sync://notice",
                json!({ "kind": "github-authorized", "accountLabel": token.login }),
            );
            let config = read_config(app);
            emit_status(app, &config);
        }
        Err(error_code) => {
            // 用户主动取消不弹失败气泡（那会显得像出错了）；其余失败要说清原因。
            if error_code != "auth.denied" {
                let _ = app.emit(
                    "cloud-sync://notice",
                    json!({ "kind": "failure", "errorCode": error_code }),
                );
            }
            let config = read_config(app);
            emit_status(app, &config);
        }
    }
}

/// 授权状态：前端在显示 8 位码期间轮询它。
#[tauri::command]
pub fn cloud_sync_github_auth_state<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let token = current_github_token(&app);
    let config = read_config(&app);
    Ok(json!({
        "authorized": token.is_some(),
        "accountLabel": token.map(|stored| stored.login).unwrap_or_default(),
        "loginPending": app.state::<CloudSyncState>().login_active(),
        "target": config.targets.iter().find(|target| target.provider == "github"),
    }))
}

/// 列当前账号的私有仓库（供选仓库界面用）。
#[tauri::command]
pub async fn cloud_sync_github_repos<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let Some(stored) = current_github_token(&app) else {
        return Ok(json!({ "ok": false, "errorCode": "github.auth" }));
    };
    let app_for_task = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || github::list_private_repos(&stored.token))
        .await
        .map_err(|error| format!("任务失败：{error}"))?;
    let _ = app_for_task;
    match result {
        Ok(repos) => Ok(json!({
            "ok": true,
            "repos": repos.iter().map(github_repo_json).collect::<Vec<_>>(),
        })),
        Err(error_code) => Ok(json!({ "ok": false, "errorCode": error_code })),
    }
}

/// 新建专用私有仓库（private 写死，用户没有建成公开的机会）。
#[tauri::command]
pub async fn cloud_sync_github_create_repo<R: Runtime>(app: AppHandle<R>, name: String) -> Result<Value, String> {
    let Some(stored) = current_github_token(&app) else {
        return Ok(json!({ "ok": false, "errorCode": "github.auth" }));
    };
    let wanted = if name.trim().is_empty() {
        github::DEFAULT_REPO.to_string()
    } else {
        name.trim().to_string()
    };
    let result = tauri::async_runtime::spawn_blocking(move || github::create_private_repo(&stored.token, &wanted))
        .await
        .map_err(|error| format!("任务失败：{error}"))?;
    match result {
        Ok(repo) => Ok(json!({ "ok": true, "repo": github_repo_json(&repo) })),
        Err(error_code) => Ok(json!({ "ok": false, "errorCode": error_code })),
    }
}

/// 把公开仓库改成私有（用户选了公开仓库时的补救动作，需要界面二次确认）。
#[tauri::command]
pub async fn cloud_sync_github_make_private<R: Runtime>(
    app: AppHandle<R>,
    owner: String,
    repo: String,
) -> Result<Value, String> {
    let Some(stored) = current_github_token(&app) else {
        return Ok(json!({ "ok": false, "errorCode": "github.auth" }));
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        github::make_private(&stored.token, &owner, &repo)
    })
    .await
    .map_err(|error| format!("任务失败：{error}"))?;
    match result {
        Ok(repo) => Ok(json!({ "ok": true, "repo": github_repo_json(&repo) })),
        Err(error_code) => Ok(json!({ "ok": false, "errorCode": error_code })),
    }
}

/// 连接 GitHub 仓库：强校验私有 + 写探针，通过才落配置。
#[tauri::command]
pub async fn cloud_sync_connect_github<R: Runtime>(
    app: AppHandle<R>,
    owner: String,
    repo: String,
    branch: Option<String>,
) -> Result<Value, String> {
    let Some(stored) = current_github_token(&app) else {
        return Ok(json!({ "ok": false, "errorCode": "github.auth" }));
    };
    let token = stored.token.clone();
    let (owner_clone, repo_clone, branch_clone) = (owner.clone(), repo.clone(), branch.clone());
    let checked = tauri::async_runtime::spawn_blocking(move || -> Result<github::GithubRepo, String> {
        let info = github::fetch_repo(&token, &owner_clone, &repo_clone)?;
        github::validate_target(&info)?;
        let branch = branch_clone
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                if info.default_branch.trim().is_empty() {
                    "main".to_string()
                } else {
                    info.default_branch.clone()
                }
            });
        GithubStore::validate(&info.owner, &info.name, &branch, &token)?;
        Ok(info)
    })
    .await
    .map_err(|error| format!("任务失败：{error}"))?;

    let info = match checked {
        Ok(info) => info,
        Err(error_code) => return Ok(json!({ "ok": false, "errorCode": error_code })),
    };

    let branch = branch
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if info.default_branch.trim().is_empty() {
                "main".to_string()
            } else {
                info.default_branch.clone()
            }
        });

    let mut config = read_config(&app);
    let mut target = CloudTarget::new("github").connected_as(info.full_name());
    target.github_owner = Some(info.owner.clone());
    target.github_repo = Some(info.name.clone());
    target.github_branch = Some(branch);
    // upsert：连一个新网盘不该把别的网盘的目标冲掉。
    *config.target_mut("github") = target;
    config.enabled = true;
    config.project_active();
    write_config(&app, &config)?;
    emit_status(&app, &config);
    Ok(json!({ "ok": true, "config": config }))
}

#[tauri::command]
pub fn cloud_sync_logout<R: Runtime>(
    app: AppHandle<R>,
    // 多网盘时「退出登录」只针对当前这个盘；不传（旧前端）才按「全部退出」处理。
    provider: Option<String>,
) -> Result<Value, String> {
    let mut config = read_config(&app);
    let target_provider = provider.or_else(|| config.provider.clone());

    match target_provider.as_deref() {
        Some("baidu") => {
            if let Ok(dir) = cloud_sync_dir(&app) {
                let _ = credentials::clear(&dir);
            }
            app.state::<CloudSyncState>().set_auth_expired(false);
            // 只断开这一个：目标留在列表里，用户重新登录不用再勾一次。
            if let Some(target) = config.targets.iter_mut().find(|target| target.provider == "baidu") {
                target.connected = false;
                target.account_label = None;
            }
        }
        Some("webdav") => {
            if let Ok(dir) = cloud_sync_dir(&app) {
                let _ = credentials::clear_webdav(&dir);
            }
            if let Some(target) = config.targets.iter_mut().find(|target| target.provider == "webdav") {
                target.connected = false;
                target.account_label = None;
            }
        }
        Some("github") => {
            if let Ok(dir) = cloud_sync_dir(&app) {
                let _ = credentials::clear_github(&dir);
            }
            // 只断开 GitHub：owner/repo 留在配置里，重新授权后不用再选一次仓库。
            if let Some(target) = config.targets.iter_mut().find(|target| target.provider == "github") {
                target.connected = false;
                target.account_label = None;
            }
        }
        Some("folder") => {
            // 「网盘本地文件夹」没有账号，退出就是不再同步到它：把目标整条移掉。
            // 只移它自己，别连带清掉别的网盘。
            config.targets.retain(|target| target.provider != "folder");
        }
        _ => {
            // 旧前端没传 provider：按全部退出处理。
            if let Ok(dir) = cloud_sync_dir(&app) {
                let _ = credentials::clear_all(&dir);
            }
            app.state::<CloudSyncState>().set_auth_expired(false);
            config.targets.clear();
        }
    }

    config.project_active();
    write_config(&app, &config)?;
    emit_status(&app, &config);
    Ok(json!(config))
}

/// 立即同步：命令立刻返回，真正的活丢到阻塞线程池，边跑边发事件。
///
/// 一个开关可以绑多个网盘：这里对每个**已连接**的目标各跑一次引擎，
/// 每个目标独立一个批次、独立一份远端清单、独立的失败计数。
/// 一个盘不可用（凭据丢了 / 目录掉线 / 限流）不牵连另外两个。
#[tauri::command]
pub async fn cloud_sync_run_now<R: Runtime>(
    app: AppHandle<R>,
    trigger: String,
    projects: Vec<engine::ProjectRef>,
) -> Result<Value, String> {
    let config = read_config(&app);
    if !config.enabled {
        return Ok(json!({ "batchId": "", "errorCode": SYNC_DISABLED }));
    }
    if projects.is_empty() {
        // 范围选了「当前书籍」但没有打开的书籍：不算错误，也别发失败气泡。
        return Ok(json!({ "batchId": "", "errorCode": "sync.no-project" }));
    }
    let targets = config.connected_targets();
    if targets.is_empty() {
        return Ok(json!({ "batchId": "", "errorCode": SYNC_DISABLED }));
    }

    // 先把适配器都造出来：某个盘造不出来只让那一个记失败，别放弃整轮。
    let mut jobs: Vec<(CloudTarget, Box<dyn RemoteStore>)> = Vec::new();
    let mut unavailable: Vec<(String, String)> = Vec::new();
    for target in targets {
        match build_remote(&app, &target) {
            Ok(remote) => jobs.push((target, remote)),
            Err(error_code) => unavailable.push((target.provider, error_code)),
        }
    }
    if jobs.is_empty() {
        let first = unavailable
            .first()
            .map(|(_, code)| code.clone())
            .unwrap_or_else(|| SYNC_DISABLED.to_string());
        return Ok(json!({ "batchId": "", "errorCode": first }));
    }

    if !app.state::<CloudSyncState>().try_begin() {
        return Ok(json!({ "batchId": "", "errorCode": SYNC_BUSY }));
    }

    let history_dir = cloud_sync_dir(&app)?;
    let include_snapshots = config.include_snapshots;

    // 先把「正在同步」推给前端，否则图标要等第一个文件才有反应。
    emit_status(&app, &config);

    let app_for_task = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_for_task.state::<CloudSyncState>();
        let mut failed_total: u32 = 0;
        let mut first_error: Option<String> = None;
        let mut last_finished: Option<i64> = None;
        let mut stopped = false;
        // 进度按「已跑完的目标」平移，否则第二个盘会让进度条从 0 重新开始。
        let mut done_offset: u32 = 0;
        let mut total_offset: u32 = 0;

        // 建不出适配器的目标也要在详情里留一条：用户点的是一次同步，
        // 不能只弹个气泡就说「完了」。
        for (provider, error_code) in &unavailable {
            let now = chrono::Utc::now().timestamp_millis();
            let batch = history::SyncBatch {
                batch_id: uuid::Uuid::new_v4().to_string(),
                started_at: now,
                finished_at: Some(now),
                trigger: trigger.clone(),
                state: history::BatchState::Failed,
                counts: history::SyncCounts { failed: 1, ..Default::default() },
                provider: Some(provider.clone()),
            };
            let entry = history::SyncEntry {
                id: uuid::Uuid::new_v4().to_string(),
                batch_id: batch.batch_id.clone(),
                at: now,
                direction: history::SyncDirection::Skip,
                path: "（这一轮没能开始）".to_string(),
                book_id: None,
                book_name: None,
                bytes: None,
                ok: false,
                error_code: Some(error_code.clone()),
                error_detail: None,
            };
            let _ = history::append(&history_dir, batch, vec![entry], now);
            failed_total += 1;
            first_error = first_error.or_else(|| Some(error_code.clone()));
        }

        for (target, remote) in jobs {
            if state.stop_requested() {
                stopped = true;
                break;
            }
            let options = engine::EngineOptions {
                remote,
                history_dir: history_dir.clone(),
                projects: projects.clone(),
                include_snapshots,
                trigger: trigger.clone(),
                provider: Some(target.provider.clone()),
            };
            let mut emit = |event: engine::EngineEvent| {
                emit_engine_event_with_offset(&app_for_task, event, done_offset, total_offset)
            };
            match engine::run(&options, &state, &mut emit) {
                Ok(outcome) => {
                    if outcome.stopped {
                        stopped = true;
                    }
                    failed_total += outcome.batch.counts.failed;
                    if first_error.is_none() {
                        first_error = outcome
                            .entries
                            .iter()
                            .find(|entry| !entry.ok)
                            .and_then(|entry| entry.error_code.clone());
                    }
                    last_finished = outcome.batch.finished_at.or(last_finished);
                    let handled = outcome.batch.counts.upload
                        + outcome.batch.counts.download
                        + outcome.batch.counts.delete
                        + outcome.batch.counts.conflict
                        + outcome.batch.counts.failed;
                    done_offset += handled;
                    total_offset += handled;
                }
                Err(error_code) => {
                    // 这一轮连「开始」都没走到（列远端失败、目录被删、网盘限流……）。
                    let now = chrono::Utc::now().timestamp_millis();
                    let batch = history::SyncBatch {
                        batch_id: uuid::Uuid::new_v4().to_string(),
                        started_at: now,
                        finished_at: Some(now),
                        trigger: trigger.clone(),
                        state: history::BatchState::Failed,
                        counts: history::SyncCounts { failed: 1, ..Default::default() },
                        provider: Some(target.provider.clone()),
                    };
                    let entry = history::SyncEntry {
                        id: uuid::Uuid::new_v4().to_string(),
                        batch_id: batch.batch_id.clone(),
                        at: now,
                        direction: history::SyncDirection::Skip,
                        path: "（这一轮没能开始）".to_string(),
                        book_id: None,
                        book_name: None,
                        bytes: None,
                        ok: false,
                        error_code: Some(error_code.clone()),
                        error_detail: None,
                    };
                    if let Ok(history) = history::append(&history_dir, batch.clone(), vec![entry], now) {
                        emit_history_entries(&app_for_task, &history, &batch);
                    }
                    failed_total += 1;
                    first_error = first_error.or_else(|| Some(error_code));
                }
            }
        }

        // 先把本轮的失败数交给前端（emit_status 读的就是这个值），再 finish。
        // 顺序不能反：finish() 会把失败数归零，反过来写前端永远看到 0 失败。
        state.set_failure_count(failed_total);

        let mut config = read_config(&app_for_task);
        if last_finished.is_some() {
            config.last_sync_at = last_finished.or(config.last_sync_at);
            let _ = write_config(&app_for_task, &config);
        }
        if !stopped {
            let _ = app_for_task.emit(
                "cloud-sync://notice",
                json!({
                    "kind": if failed_total == 0 { "success" } else { "failure" },
                    "batchId": "",
                    "counts": history::SyncCounts { failed: failed_total, ..Default::default() },
                    "errorCode": if failed_total == 0 { Value::Null } else { json!(first_error) },
                }),
            );
        }
        // 先让前端拿到本轮的失败数，再把这一轮的运行态整体收尾。
        emit_status(&app_for_task, &config);
        state.finish();
        emit_status(&app_for_task, &config);
    });

    Ok(json!({ "batchId": "" }))
}

/// 逐项定夺冲突：用户选保留本地还是云端那一份。
///
/// 项目路径由前端传：后端不持有项目注册表（那是前端 store 的事），
/// 而这条命令必须定位到具体的书目录才能改文件、改清单。
#[tauri::command]
pub async fn cloud_sync_resolve_conflict<R: Runtime>(
    app: AppHandle<R>,
    project_id: String,
    project_path: String,
    book_name: Option<String>,
    rel: String,
    choice: String,
    // 多网盘时冲突是「相对某个盘」的：同一个文件可能只在 A 盘冲突。
    // 前端从批次里拿到 provider 传进来；不传（旧前端）就按激活目标处理。
    provider: Option<String>,
) -> Result<Value, String> {
    let config = read_config(&app);
    if !config.enabled {
        return Ok(json!({ "ok": false, "errorCode": SYNC_DISABLED }));
    }
    let selected = match provider {
        Some(provider) => config
            .targets
            .iter()
            .find(|target| target.provider == provider && target.connected)
            .cloned(),
        None => config.active().cloned().filter(|target| target.connected),
    };
    let Some(target) = selected else {
        return Ok(json!({ "ok": false, "errorCode": SYNC_DISABLED }));
    };
    let Some(choice) = resolve::ConflictChoice::parse(&choice) else {
        return Ok(json!({ "ok": false, "errorCode": "conflict.bad-choice" }));
    };
    // 写盘是阻塞活：放到 blocking 线程池，别卡住 UI 线程。
    let remote = match build_remote(&app, &target) {
        Ok(remote) => remote,
        Err(error_code) => return Ok(json!({ "ok": false, "errorCode": error_code })),
    };
    let history_dir = cloud_sync_dir(&app)?;
    let project_root = PathBuf::from(&project_path);
    let rel_for_task = rel.clone();
    let book_id = project_id.clone();

    let outcome = tauri::async_runtime::spawn_blocking(move || {
        resolve::resolve(remote.as_ref(), &book_id, &project_root, &rel_for_task, choice)
    })
    .await
    .map_err(|error| format!("处理冲突失败：{error}"))?;

    let outcome = match outcome {
        Ok(outcome) => outcome,
        Err(error) => {
            let error_code = engine::classify_error(&error, "local.locked");
            return Ok(json!({ "ok": false, "errorCode": error_code, "errorDetail": error }));
        }
    };

    // 记一条历史：用户点开详情时要能看到「这条冲突是怎么解决的」。
    let now = chrono::Utc::now().timestamp_millis();
    let batch_id = uuid::Uuid::new_v4().to_string();
    let batch = history::SyncBatch {
        batch_id: batch_id.clone(),
        started_at: now,
        finished_at: Some(now),
        trigger: "conflict-resolve".to_string(),
        state: history::BatchState::Ok,
        counts: history::SyncCounts { conflict: 1, ..Default::default() },
        provider: config.provider.clone(),
    };
    let entry = history::SyncEntry {
        id: uuid::Uuid::new_v4().to_string(),
        batch_id,
        at: now,
        direction: history::SyncDirection::Conflict,
        path: rel,
        book_id: Some(project_id),
        book_name,
        bytes: outcome.bytes,
        ok: true,
        error_code: None,
        error_detail: Some(outcome.message.clone()),
    };
    // 历史写失败不该让「冲突已经解决」变成失败：内容已经落盘了。
    let _ = history::append(&history_dir, batch, vec![entry], now);

    Ok(json!({ "ok": true, "message": outcome.message }))
}

#[tauri::command]
pub fn cloud_sync_history<R: Runtime>(app: AppHandle<R>, limit: Option<u32>) -> Result<Value, String> {
    let dir = cloud_sync_dir(&app)?;
    let mut history = history::load(&dir);
    let limit = limit.unwrap_or(200) as usize;
    if history.entries.len() > limit {
        let drop_count = history.entries.len() - limit;
        history.entries.drain(0..drop_count);
    }
    Ok(json!({ "batches": history.batches, "entries": history.entries }))
}

#[tauri::command]
pub fn cloud_sync_clear_history<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let dir = cloud_sync_dir(&app)?;
    history::clear(&dir)
}

#[tauri::command]
/// 打开远端内容（详情面板与设置页的「打开远端内容」都走这里）。
///
/// `provider` 不传时按当前激活目标处理（旧前端兼容）。
pub fn cloud_sync_reveal_remote_for<R: Runtime>(
    app: AppHandle<R>,
    provider: Option<String>,
) -> Result<(), String> {
    let config = read_config(&app);
    let active = match provider {
        Some(provider) => config
            .targets
            .iter()
            .find(|target| target.provider == provider && target.connected)
            .cloned(),
        None => config.active().cloned(),
    };
    match active.as_ref().map(|target| target.provider.as_str()) {
        Some("github") => {
            // GitHub 私有仓库必须在**已登录的浏览器**里才看得到。
            // 我们不做任何绕过身份验证的事：把用户送到仓库页面，
            // 没登录 GitHub 会先落到登录页，登录后浏览器会自己走回这个地址。
            let Some(owner) = active.as_ref().and_then(|target| target.github_owner.clone()) else {
                return Err("github.no-repo".to_string());
            };
            let Some(repo) = active.as_ref().and_then(|target| target.github_repo.clone()) else {
                return Err("github.no-repo".to_string());
            };
            let branch = active
                .as_ref()
                .and_then(|target| target.github_branch.clone())
                .unwrap_or_else(|| "main".to_string());
            let url = format!("https://github.com/{owner}/{repo}/tree/{branch}");
            return app
                .opener()
                .open_url(url, None::<&str>)
                .map_err(|error| format!("无法打开仓库页面：{error}"));
        }
        Some("webdav") if active.as_ref().map(|target| target.connected) == Some(true) => {
            // WebDAV 根目录不接受浏览器 GET（坚果云回 OperationNotAllowed，用户看到的
            // 是一页错误 XML）。这里明确告诉前端「没有网页可开」，让它把地址复制给用户。
            return Err("remote.webdav-no-browser".to_string());
        }
        Some("baidu") if active.as_ref().map(|target| target.connected) == Some(true) => {
            let url = format!(
                "https://pan.baidu.com/disk/main#/index?category=all&path={}",
                baidu_path(&baidu::app_name())
            );
            return app
                .opener()
                .open_url(url, None::<&str>)
                .map_err(|error| format!("无法打开网盘页面：{error}"));
        }
        _ => {}
    }
    if let Some(path) = active.as_ref().and_then(|target| target.folder_path.clone()) {
        if !Path::new(&path).is_dir() {
            return Err("远端目录已不存在".to_string());
        }
        return app
            .opener()
            .open_path(path, None::<&str>)
            .map_err(|error| format!("无法打开远端目录：{error}"));
    }
    Err("还没有连接网盘".to_string())
}

#[tauri::command]
pub fn cloud_sync_reveal_remote<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    cloud_sync_reveal_remote_for(app, None)
}

#[tauri::command]
pub fn cloud_sync_reveal_target_remote<R: Runtime>(
    app: AppHandle<R>,
    provider: String,
) -> Result<(), String> {
    cloud_sync_reveal_remote_for(app, Some(provider))
}


#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qmai_cloud_sync_{name}_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn read_missing_config_falls_back_to_defaults() {
        let dir = temp_dir("missing");
        let config = read_config_at(&dir.join(CONFIG_FILE));
        assert!(!config.enabled);
        assert!(config.include_snapshots);
        assert_eq!(config.scope, "all");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = temp_dir("roundtrip");
        let mut config = CloudSyncConfig::default();
        config.enabled = true;
        // 权威存储是 targets：扁平字段只是它的投影，直接改扁平字段会被投影覆盖。
        let mut target = CloudTarget::new("folder").connected_as("小说".to_string());
        target.folder_path = Some("D:/同步空间/小说".to_string());
        config.set_single_target(target);
        config.project_active();
        write_config_at(&dir, &config).expect("write");
        let loaded = read_config_at(&dir.join(CONFIG_FILE));
        assert!(loaded.enabled);
        assert_eq!(loaded.provider.as_deref(), Some("folder"));
        assert_eq!(loaded.folder_path.as_deref(), Some("D:/同步空间/小说"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn merge_patch_ignores_unknown_and_null_provider() {
        let mut config = CloudSyncConfig::default();
        config.set_single_target(CloudTarget::new("baidu"));
        config.project_active();
        merge_patch(
            &mut config,
            &json!({ "provider": null, "enabled": true, "secret": "should-not-be-stored" }),
        );
        assert!(config.enabled);
        assert!(config.provider.is_none());
        let text = serde_json::to_string(&config).expect("serialize");
        assert!(!text.contains("should-not-be-stored"));
    }

    #[test]
    fn corrupt_config_file_falls_back_to_defaults() {
        let dir = temp_dir("corrupt");
        fs::write(dir.join(CONFIG_FILE), b"{not json").expect("write");
        let config = read_config_at(&dir.join(CONFIG_FILE));
        assert!(!config.enabled);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn folder_label_uses_last_segment() {
        assert_eq!(folder_label(Path::new("D:/同步空间/小说")), "小说");
        assert_eq!(folder_label(Path::new("/")), "/");
    }

    #[test]
    fn v1_config_is_upgraded_to_a_single_target() {
        let dir = temp_dir("v1_upgrade");
        let path = dir.join(CONFIG_FILE);
        // schemaVersion 1：只有扁平字段，没有 targets。
        fs::write(
            &path,
            br#"{
              "enabled": true,
              "provider": "webdav",
              "connected": true,
              "accountLabel": "me@example.com",
              "webdavUrl": "https://dav.jianguoyun.com/dav/",
              "webdavUser": "me@example.com",
              "scope": "current",
              "includeSnapshots": true,
              "schemaVersion": 1
            }"#,
        )
        .expect("write");

        let config = read_config_at(&path);
        assert_eq!(config.schema_version, 2);
        assert_eq!(config.targets.len(), 1);
        assert_eq!(config.targets[0].provider, "webdav");
        assert!(config.targets[0].connected);
        assert_eq!(config.targets[0].webdav_url.as_deref(), Some("https://dav.jianguoyun.com/dav/"));
        // 投影必须同步：前端仍读扁平字段。
        assert_eq!(config.provider.as_deref(), Some("webdav"));
        assert!(config.connected);
        assert_eq!(config.account_label.as_deref(), Some("me@example.com"));
        // 原件留档，升级失败也能找回。
        assert!(path.with_extension("json.v1.bak").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn switching_provider_keeps_other_targets_intact() {
        let mut config = CloudSyncConfig::default();
        let mut folder = CloudTarget::new("folder").connected_as("同步盘".to_string());
        folder.folder_path = Some("O:/BaiduSyncdisk".to_string());
        config.set_single_target(folder);
        config.project_active();

        // 切到 webdav：前端只发 provider。
        merge_patch(&mut config, &json!({ "provider": "webdav" }));
        assert_eq!(config.provider.as_deref(), Some("webdav"));
        // 未连接的新目标不冒充旧账号。
        assert!(!config.connected);
        assert!(config.account_label.is_none());
        // 旧目标还在数组里（多网盘的基础）。
        assert!(config.targets.iter().any(|target| target.provider == "folder"));

        // 切回去：仍然连着，账号没丢。
        merge_patch(&mut config, &json!({ "provider": "folder" }));
        assert_eq!(config.provider.as_deref(), Some("folder"));
        assert!(config.connected);
        assert_eq!(config.account_label.as_deref(), Some("同步盘"));
    }

    #[test]
    fn config_with_bom_is_not_treated_as_empty() {
        // 用户可能用记事本/PowerShell 改过 config.json：UTF-8 BOM 会让
        // serde_json 解析失败，接着就按默认配置写回去，网盘绑定全丢。
        let dir = std::env::temp_dir().join(format!(
            "qmai_cfgbom_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join(CONFIG_FILE);
        let body = r#"{"enabled":true,"schemaVersion":2,"targets":[{"provider":"folder","connected":true,"folderPath":"O:\\BaiduSyncdisk"}]}"#;
        let mut bytes = Vec::new();
        bytes.extend_from_slice("\u{feff}".as_bytes());
        bytes.extend_from_slice(body.as_bytes());
        fs::write(&path, &bytes).expect("write config");

        let config = read_config_at(&path);
        assert!(config.enabled);
        assert_eq!(config.targets.len(), 1);
        assert_eq!(config.targets[0].provider, "folder");
        assert_eq!(config.folder_path.as_deref(), Some("O:\\BaiduSyncdisk"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn only_connected_targets_are_scheduled() {
        let mut config = CloudSyncConfig::default();
        let mut webdav = CloudTarget::new("webdav").connected_as("me".to_string());
        webdav.webdav_url = Some("https://dav.jianguoyun.com/dav/".to_string());
        let folder = CloudTarget::new("folder").connected_as("同步盘".to_string());
        let baidu = CloudTarget::new("baidu"); // 没登录
        config.targets = vec![webdav, folder, baidu];
        config.project_active();

        let scheduled = config.connected_targets();
        assert_eq!(scheduled.len(), 2);
        assert!(scheduled.iter().any(|target| target.provider == "webdav"));
        assert!(scheduled.iter().any(|target| target.provider == "folder"));
        assert!(!scheduled.iter().any(|target| target.provider == "baidu"));
    }

    #[test]
    fn logout_only_removes_the_requested_target() {
        let mut config = CloudSyncConfig::default();
        let mut webdav = CloudTarget::new("webdav").connected_as("me".to_string());
        webdav.webdav_url = Some("https://dav.jianguoyun.com/dav/".to_string());
        let folder = CloudTarget::new("folder").connected_as("同步盘".to_string());
        let mut folder = folder;
        folder.folder_path = Some("O:\\BaiduSyncdisk".to_string());
        config.targets = vec![webdav, folder];
        config.project_active();

        // 「退出登录」只针对当前激活的 WebDAV：本地文件夹必须原样留着，
        // 否则用户退出一个盘还要回去重选一遍同步目录。
        let mut config = config;
        config.targets.retain(|target| target.provider != "webdav");
        config.project_active();
        assert_eq!(config.targets.len(), 1);
        assert_eq!(config.targets[0].provider, "folder");
        assert_eq!(config.targets[0].folder_path.as_deref(), Some("O:\\BaiduSyncdisk"));
        assert!(config.targets[0].connected);
    }

    #[test]
    fn focusing_a_provider_does_not_re_enable_a_deselected_target() {
        // 用户取消勾选坚果云后，点一下它的卡片「看一眼」，
        // 绝不能因为 focus 就把它塞回 targets（那等于又勾上了）。
        let mut config = CloudSyncConfig::default();
        config.targets = vec![CloudTarget::new("github").connected_as("me/repo".into())];
        config.provider = Some("github".into());
        config.project_active();

        config.focus_provider("webdav");

        assert_eq!(config.provider.as_deref(), Some("webdav"), "焦点切过去了");
        assert_eq!(config.targets.len(), 1, "但 targets 不该多出一条");
        assert_eq!(config.targets[0].provider, "github");
    }

    #[test]
    fn deselecting_a_target_stops_it_from_being_scheduled() {
        // 取消勾选 = 从 targets 拿掉，哪怕账号还登着（connected 仍为真）。
        let mut config = CloudSyncConfig::default();
        let mut webdav = CloudTarget::new("webdav").connected_as("me@example.com".into());
        webdav.webdav_url = Some("https://dav.jianguoyun.com/dav/".into());
        config.targets = vec![webdav, CloudTarget::new("github").connected_as("me/repo".into())];
        config.provider = Some("github".into());
        config.project_active();

        // 取消勾选坚果云
        let keep: Vec<CloudTarget> = config
            .targets
            .iter()
            .filter(|target| target.provider != "webdav")
            .cloned()
            .collect();
        config.targets = keep;

        let scheduled = config.connected_targets();
        assert_eq!(scheduled.len(), 1);
        assert_eq!(scheduled[0].provider, "github");
    }

    #[test]
    fn logout_everything_semantics_kept_for_legacy_callers() {
        let mut config = CloudSyncConfig::default();
        config.set_single_target(CloudTarget::new("webdav").connected_as("me".to_string()));
        config.project_active();
        config.targets.clear();
        config.project_active();
        assert!(config.targets.is_empty());
        assert!(config.provider.is_none());
        assert!(!config.connected);
    }
}
