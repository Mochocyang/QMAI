//! 更新通道表：有哪些通道、每个通道怎么把 GitHub 地址拼成它自己的地址。
//!
//! **只服务软件更新**（公开的 latest.json 与 release 安装包）。
//! 用户的小说同步永远走 api.github.com 直连或用户自己的代理 —— 见 `ChannelScope`。

use serde::{Deserialize, Serialize};

/// 通道用途。现在只有一种，写成枚举是为了让「以后有人想拿它加速云同步」
/// 在类型层面就无法通过——云同步模块的入参只接受 `ChannelScope::UpdateOnly`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChannelScope {
    UpdateOnly,
}

/// URL 拼接方式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Rewrite {
    /// 原样使用 GitHub 地址（直连）。
    Identity,
    /// 前缀型反代：`{base}{原始地址}`。
    Prefix,
    /// jsDelivr：只能代理**仓库文件**，不能代理 release 资产。
    Jsdelivr,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub label: String,
    pub rewrite: Rewrite,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    pub scope: ChannelScope,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelTable {
    pub version: u32,
    pub channels: Vec<Channel>,
}

impl ChannelTable {
    /// 内置默认表。远程表能覆盖它，但永远保留 `direct` 作为兜底。
    pub fn builtin() -> Self {
        Self {
            version: 1,
            channels: vec![
                Channel {
                    id: "direct".to_string(),
                    label: "直连".to_string(),
                    rewrite: Rewrite::Identity,
                    base: None,
                    scope: ChannelScope::UpdateOnly,
                },
                Channel {
                    id: "ghproxy-net".to_string(),
                    label: "加速通道 A".to_string(),
                    rewrite: Rewrite::Prefix,
                    base: Some("https://ghproxy.net/".to_string()),
                    scope: ChannelScope::UpdateOnly,
                },
                Channel {
                    id: "gh-proxy-com".to_string(),
                    label: "加速通道 B".to_string(),
                    rewrite: Rewrite::Prefix,
                    base: Some("https://gh-proxy.com/".to_string()),
                    scope: ChannelScope::UpdateOnly,
                },
                Channel {
                    id: "jsdelivr".to_string(),
                    label: "加速通道 C".to_string(),
                    rewrite: Rewrite::Jsdelivr,
                    base: None,
                    scope: ChannelScope::UpdateOnly,
                },
            ],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_channels_start_with_direct_and_are_unique() {
        let table = ChannelTable::builtin();
        assert_eq!(table.channels[0].id, "direct");
        let mut ids: Vec<&str> = table.channels.iter().map(|c| c.id.as_str()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), table.channels.len(), "通道 id 不能重复");
        assert!(table.channels.iter().all(|c| c.scope == ChannelScope::UpdateOnly));
    }

    #[test]
    fn builtin_table_has_at_least_one_mirror() {
        let table = ChannelTable::builtin();
        assert!(
            table.channels.iter().any(|c| c.rewrite != Rewrite::Identity),
            "内置表里至少要有一条镜像，否则自动择优没有意义"
        );
    }
}
