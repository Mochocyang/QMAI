//! 软件更新加速：多通道探活择优。
//!
//! 边界：**只服务更新**。云同步（用户的小说）不走任何第三方中转。

pub mod channels;
pub mod download;
pub mod segmented;
pub mod probe;

use crate::updater::channels::{Channel, ChannelTable};
use crate::updater::download::ChannelAttempt;

/// 本次更新的官方清单地址（GitHub Release 上的 latest.json）。
pub const MANIFEST_URL: &str =
    "https://github.com/Mochocyang/QMAI/releases/latest/download/latest.json";

/// 把「通道表 + 探活结果」变成「下载尝试顺序」。
///
/// 每条通道自己决定能不能映射这个清单地址：jsDelivr 映射不了 release 资产，
/// 于是它的 `manifest_url` 是 `None`，下载阶段会直接跳过 —— 绝不会拿它去撞 404。
///
/// 探活结果里没提到的通道**不会**凭空补进来（除了 direct 兜底）：
/// 探活结果可能来自缓存，凭空补会让"缓存过期的通道"绕过探活直接参与下载。
pub fn build_plan(table: &ChannelTable, probed: Vec<probe::ProbeResult>) -> Vec<ChannelAttempt> {
    let ordered = probe::order_for_download(probed);
    let mut plan: Vec<ChannelAttempt> = Vec::new();
    for result in &ordered {
        if let Some(channel) = table.channels.iter().find(|item| item.id == result.channel_id) {
            plan.push(attempt_for(channel));
        }
    }
    if !plan
        .iter()
        .any(|item| item.channel_id == channels::DIRECT_CHANNEL_ID)
    {
        if let Some(direct) = table
            .channels
            .iter()
            .find(|channel| channel.id == channels::DIRECT_CHANNEL_ID)
        {
            plan.push(attempt_for(direct));
        }
    }
    plan
}

fn attempt_for(channel: &Channel) -> ChannelAttempt {
    ChannelAttempt {
        channel_id: channel.id.clone(),
        label: channel.label.clone(),
        manifest_url: channel.map_release_url(MANIFEST_URL),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_keeps_direct_as_the_last_resort() {
        let table = channels::ChannelTable::builtin();
        let probed = vec![
            probe::ProbeResult {
                channel_id: "ghproxy-net".into(),
                available: true,
                rtt_ms: Some(210),
            },
            probe::ProbeResult {
                channel_id: channels::DIRECT_CHANNEL_ID.into(),
                available: false,
                rtt_ms: None,
            },
        ];
        let plan = build_plan(&table, probed);
        assert_eq!(
            plan.last().map(|item| item.channel_id.as_str()),
            Some(channels::DIRECT_CHANNEL_ID)
        );
    }

    #[test]
    fn plan_carries_a_manifest_url_per_channel() {
        let table = channels::ChannelTable::builtin();
        let probed = table
            .channels
            .iter()
            .map(|channel| probe::ProbeResult {
                channel_id: channel.id.clone(),
                available: true,
                rtt_ms: Some(100),
            })
            .collect();
        let plan = build_plan(&table, probed);
        let direct = plan
            .iter()
            .find(|item| item.channel_id == channels::DIRECT_CHANNEL_ID)
            .expect("必须有 direct");
        assert!(direct.manifest_url.is_some());
        let jsdelivr = plan
            .iter()
            .find(|item| item.channel_id == "jsdelivr")
            .expect("jsdelivr 在表里");
        assert!(
            jsdelivr.manifest_url.is_none(),
            "jsDelivr 不能用来下 release 资产，必须标成不支持"
        );
    }

    #[test]
    fn channels_missing_from_probe_results_are_not_invented() {
        // 探活结果里没有的通道不该凭空出现在计划里（除了 direct 兜底）。
        let table = channels::ChannelTable::builtin();
        let plan = build_plan(&table, Vec::new());
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].channel_id, channels::DIRECT_CHANNEL_ID);
    }
}
