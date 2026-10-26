//! 给前端用的更新通道命令：返回「按推荐顺序排好的通道列表」。

use serde::Serialize;
use tauri::Runtime;

use crate::updater::{self, channels::ChannelTable, probe};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPlanItem {
    pub channel_id: String,
    pub label: String,
    pub manifest_url: Option<String>,
    pub rtt_ms: Option<u64>,
}

impl ChannelPlanItem {
    fn new(channel_id: String, label: String, manifest_url: Option<String>, rtt_ms: Option<u64>) -> Self {
        Self {
            channel_id,
            label,
            manifest_url,
            rtt_ms,
        }
    }
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
    let table = ChannelTable::builtin();
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
        let client = match probe::client() {
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
            let label = table
                .channels
                .iter()
                .find(|channel| channel.id == item.channel_id)
                .map(|channel| channel.label.clone())
                .unwrap_or_else(|| item.label.clone());
            let rtt = probed
                .iter()
                .find(|result| result.channel_id == item.channel_id)
                .and_then(|result| result.rtt_ms);
            ChannelPlanItem::new(item.channel_id, label, item.manifest_url, rtt)
        })
        .collect())
}
