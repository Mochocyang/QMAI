//! 给前端用的更新通道命令：返回「按推荐顺序排好的通道列表」，以及按通道下载。

use serde::Serialize;
use tauri::Runtime;

use crate::updater::{self, channels::ChannelTable, probe};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPlanItem {
    pub channel_id: String,
    pub label: String,
    pub manifest_url: Option<String>,
    /// 前端要拼在原始 release 地址前面的前缀。
    ///
    /// 三态语义（与 `Channel::release_prefix` 一一对应）：
    /// - `""`：直连，原样使用；
    /// - `"https://mirror/"`：镜像前缀，拼 `${prefix}${url}`；
    /// - `null`：该通道不支持 release 资产（jsDelivr），前端应退回插件自己的下载。
    ///
    /// 为什么由 Rust 给出而不是让前端自己按 `channelId` 判断：改写规则必须只有
    /// 一份（`map_release_url`），两处各写一遍迟早漂移，且漂移只表现为"某通道静默 404"。
    pub manifest_prefix: Option<String>,
    pub rtt_ms: Option<u64>,
}

impl ChannelPlanItem {
    fn new(
        channel_id: String,
        label: String,
        manifest_url: Option<String>,
        manifest_prefix: Option<String>,
        rtt_ms: Option<u64>,
    ) -> Self {
        Self {
            channel_id,
            label,
            manifest_url,
            manifest_prefix,
            rtt_ms,
        }
    }
}

/// 从 app-state.json 读代理，供按需发起的请求显式使用。
///
/// 为什么每个命令自己读：`reqwest` 只在建 client 时读一次环境变量，
/// 而用户可以在软件运行中才打开代理 —— 这时 env 是旧值，必须直接读文件。
fn proxy_url_from_store() -> Option<String> {
    let path = crate::proxy::app_state_path()?;
    let config = crate::proxy::read_proxy_config_from_store(&path)?;
    crate::proxy::current_proxy_url(&config)
}

/// 探活并返回下载顺序。前端拿第一项带 `manifestUrl` 的去检查更新。
///
/// 整个探活在阻塞线程里跑（`reqwest::blocking` 不能在 tokio runtime 里直接调），
/// 前端最多等 PROBE_TOTAL_TIMEOUT 秒就会拿到结果 —— 这是「检查更新不再
/// 20 秒无响应」的关键：探测有硬上限，不会无限等。
///
/// 为什么参数里要有个用不上的 `app`：命令是泛型 `R: Runtime`，而
/// `generate_handler!` 在注册时要推断出具体的 runtime 类型。只有
/// `AppHandle<R>` 这样的参数能让落地的 future 带上 `Send` 约束，编译器才推得
/// 出 `R`；纯泛型无参命令会在 `generate_handler!` 处报 `E0283`（与本项目
/// `cloud_sync.rs` 里所有泛型命令的写法一致）。`_app` 因此不参与逻辑。
#[tauri::command]
pub async fn updater_channel_plan<R: Runtime>(
    _app: tauri::AppHandle<R>,
) -> Result<Vec<ChannelPlanItem>, String> {
    // 远程通道表在这里按需拉取：失败/版本不更新都会静默回落到内置表，
    // 所以这个命令永远不会因为 CDN 不可用而失败。
    let table = ChannelTable::effective();
    let targets: Vec<(String, String, String)> = table
        .channels
        .iter()
        .filter_map(|channel| {
            channel
                .map_release_url(updater::MANIFEST_URL)
                .map(|url| (channel.id.clone(), channel.label.clone(), url))
        })
        .collect();

    let probed = tauri::async_runtime::spawn_blocking(move || {
        // 代理在阻塞线程里读，和探活用同一份判定 —— 探活走代理了，
        // 记录下来的"可用/不可用"才代表真实网络状况。
        let proxy_url = proxy_url_from_store();
        let client = match probe::client_with_proxy(proxy_url.as_deref()) {
            Ok(client) => client,
            Err(_) => return Vec::new(),
        };
        let mut out = Vec::with_capacity(targets.len());
        for (id, _label, url) in targets {
            let mut result = probe::probe_url(&client, &url);
            // probe_url 不知道自己探的是哪条通道，由调用方回填。
            result.channel_id = id;
            out.push(result);
        }
        out
    })
    .await
    .map_err(|error| format!("探活失败：{error}"))?;

    let plan = updater::build_plan(&table, probed.clone());
    Ok(plan
        .into_iter()
        .map(|item| {
            let channel = table
                .channels
                .iter()
                .find(|channel| channel.id == item.channel_id);
            let label = channel
                .map(|channel| channel.label.clone())
                .unwrap_or_else(|| item.label.clone());
            // 前缀只对"这条通道确实能映射该地址"的才给出，避免前端拿一个
            // 前缀去拼一条本来就不该走该通道的地址。
            let prefix = channel.and_then(|channel| {
                if item.manifest_url.is_some() {
                    channel.release_prefix()
                } else {
                    None
                }
            });
            let rtt = probed
                .iter()
                .find(|result| result.channel_id == item.channel_id)
                .and_then(|result| result.rtt_ms);
            ChannelPlanItem::new(item.channel_id, label, item.manifest_url, prefix, rtt)
        })
        .collect())
}

/// 走我们选出的通道下载一个更新包，返回原始字节。
///
/// **安全边界**：这个命令前端可任意调用，所以 URL 必须过白名单（只允许 https
/// 且属于 GitHub 发布域或当前通道表里配置过的镜像域名）。不加这道检查，
/// 它就等于"从任意地址往内存里拉任意内容"的通用下载器。
#[tauri::command]
pub async fn updater_download_bytes<R: Runtime>(
    _app: tauri::AppHandle<R>,
    url: String,
) -> Result<Vec<u8>, String> {
    let table = ChannelTable::effective();
    if !crate::updater::channels::is_allowed_download_url(&url, &table) {
        return Err(format!("不允许的下载地址：{url}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let proxy_url = proxy_url_from_store();
        // expected_len 传 None：长度由 fetch_url 内部按 Content-Length 与
        // 256 MiB 硬上限兜底，这里多传一个数字只会多一处可能写错的地方。
        crate::updater::download::fetch_url(&url, proxy_url.as_deref(), None)
    })
    .await
    .map_err(|error| format!("下载失败：{error}"))?
}

// ---------------------------------------------------------------- 自建检查 / 下载 / 安装

use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    /// 新版本号；`None` 表示已经是最新。
    pub version: Option<String>,
    pub notes: Option<String>,
    /// 安装包的原始（GitHub 直连）地址，前端据此拼镜像前缀。
    pub download_url: Option<String>,
}

/// 检查更新：走我们自己的多通道，而不是插件内置的单一端点。
///
/// 为什么自建：`updater_channel_plan` 已经能选出最快通道，但插件命令层的
/// `check` **不接受运行时 endpoints**（只能用编译期配置）。`UpdaterExt::updater_builder()`
/// 可以覆盖 endpoints，所以在这里自己拼一次，把「远程可更新的镜像表」真正用起来。
///
/// 返回的 `version` 为 `None` 表示没有新版本 —— 这不是错误。
#[tauri::command]
pub async fn updater_check<R: Runtime>(app: tauri::AppHandle<R>) -> Result<AppUpdateInfo, String> {
    let table = crate::updater::channels::ChannelTable::effective();
    let proxy = proxy_url_from_store();
    let plan: Vec<String> = table
        .channels
        .iter()
        .filter_map(|channel| channel.map_release_url(crate::updater::MANIFEST_URL))
        .collect();
    if plan.is_empty() {
        return Err("没有可用的更新通道".to_string());
    }

    // 诊断：把实际要试的端点打进日志。国内网络环境下"到底试了哪条"必须能查，
    // 否则只会看到一句"检查更新失败"，无从判断是镜像没生效还是网络问题。
    for (index, url) in plan.iter().enumerate() {
        log::warn!("[updater] endpoint[{index}] = {url}");
    }

    let app_for_task = app.clone();
    let checked = tauri::async_runtime::spawn_blocking(move || -> Result<Option<AppUpdateInfo>, String> {
        let endpoints: Vec<tauri::Url> = plan
            .iter()
            .filter_map(|url| tauri::Url::parse(url).ok())
            .collect();
        if endpoints.is_empty() {
            return Err("更新通道地址非法".to_string());
        }
        // 逐个尝试：插件 builder 接受多个 endpoints，它内部会按顺序试、失败换下一个。
        let mut builder = app_for_task
            .updater_builder()
            .endpoints(endpoints)
            .map_err(|error| format!("更新通道无效：{error}"))?;
        builder = builder.timeout(std::time::Duration::from_secs(10));
        if let Some(proxy) = proxy {
            if let Ok(url) = tauri::Url::parse(&proxy) {
                builder = builder.proxy(url);
            }
        }
        let updater = builder.build().map_err(|error| format!("初始化更新器失败：{error}"))?;
        let runtime = tauri::async_runtime::block_on(updater.check())
            .map_err(|error| format!("检查更新失败：{error}"))?;
        Ok(runtime.map(|update| AppUpdateInfo {
            version: Some(update.version.clone()),
            notes: update.body.clone(),
            download_url: Some(update.download_url.to_string()),
        }))
    })
    .await
    .map_err(|error| format!("检查更新任务失败：{error}"))?;

    log::warn!("[updater] result = {:?}", checked.is_ok());
    checked.map(|info| info.unwrap_or(AppUpdateInfo { version: None, notes: None, download_url: None }))
}
