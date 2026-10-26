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

    /// 解析远程下发的通道表并做清洗。
    ///
    /// 原则：**坏项丢弃、整体可用**。远程表是网络内容，不能被它搞崩更新流程：
    /// 重复 id、明文 http、缺 base、未知 rewrite 一律剔除；剔除后如果连 direct
    /// 都没了，自动补回内置的 direct 并排在最前，保证永远有一条兜底。
    ///
    /// 未知 `rewrite` 会在 `serde_json::from_value` 处失败（`Rewrite` 是
    /// kebab-case 的单元枚举），于是自然被丢弃 —— 不需要额外判断。
    pub fn parse(json: &str) -> Option<Self> {
        let raw: serde_json::Value = serde_json::from_str(json).ok()?;
        let version = raw.get("version")?.as_u64()? as u32;
        let items = raw.get("channels")?.as_array()?;

        let mut out: Vec<Channel> = Vec::new();
        for item in items {
            let Ok(channel) = serde_json::from_value::<Channel>(item.clone()) else {
                continue;
            };
            if channel.id.trim().is_empty() {
                continue;
            }
            if out.iter().any(|existing| existing.id == channel.id) {
                continue;
            }
            if channel.rewrite == Rewrite::Prefix {
                let Some(base) = channel.base.as_deref() else {
                    continue;
                };
                if !base.trim().starts_with("https://") {
                    continue;
                }
            }
            out.push(channel);
        }

        if !out.iter().any(|channel| channel.id == "direct") {
            let direct = Self::builtin()
                .channels
                .into_iter()
                .find(|channel| channel.id == "direct")?;
            out.insert(0, direct);
        }

        Some(Self {
            version,
            channels: out,
        })
    }
}

impl Channel {
    /// 把一个 GitHub release 地址映射到本通道的地址。
    ///
    /// 返回 `None` 表示**这个通道不支持这类地址**（例如 jsDelivr 代理不了 release 资产）。
    /// 调用方看到 `None` 应当跳过该通道，而不是把它当作「可用但失败」——
    /// 两者在用户眼里完全不同：前者是"这条通道不具备该能力"，后者是"这条通道坏了"。
    pub fn map_release_url(&self, github_url: &str) -> Option<String> {
        match self.rewrite {
            Rewrite::Identity => Some(github_url.to_string()),
            Rewrite::Prefix => {
                let base = self.base.as_deref()?.trim();
                if base.is_empty() || !base.starts_with("https://") {
                    // 只接受 https：明文 http 的加速通道会被中间设备随意改写内容。
                    return None;
                }
                Some(format!("{}{}", ensure_trailing_slash(base), github_url))
            }
            Rewrite::Jsdelivr => None,
        }
    }

    /// jsDelivr 这类 CDN 只能取**仓库文件**（不是 release 资产）。
    ///
    /// 用途：远程下发的通道表本身（`update-channels.json`）就存放在仓库里，
    /// 可以用 jsDelivr 拉取，这比走 release 更稳。
    pub fn map_repo_file_url(
        &self,
        owner: &str,
        repo: &str,
        branch: &str,
        path: &str,
    ) -> Option<String> {
        match self.rewrite {
            Rewrite::Identity => Some(format!(
                "https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"
            )),
            Rewrite::Jsdelivr => Some(format!(
                "https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}"
            )),
            Rewrite::Prefix => {
                let base = self.base.as_deref()?.trim();
                if base.is_empty() || !base.starts_with("https://") {
                    return None;
                }
                Some(format!(
                    "{}{}",
                    ensure_trailing_slash(base),
                    format!("https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}")
                ))
            }
        }
    }
}

fn ensure_trailing_slash(value: &str) -> String {
    if value.ends_with('/') {
        value.to_string()
    } else {
        format!("{value}/")
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

    #[test]
    fn identity_keeps_the_original_url() {
        let url = "https://github.com/Mochocyang/QMAI/releases/download/v1/latest.json";
        let channel = Channel {
            id: "direct".into(),
            label: "直连".into(),
            rewrite: Rewrite::Identity,
            base: None,
            scope: ChannelScope::UpdateOnly,
        };
        assert_eq!(channel.map_release_url(url).as_deref(), Some(url));
    }

    #[test]
    fn prefix_channel_prepends_base() {
        let url = "https://github.com/O/R/releases/download/v1/app.exe";
        let channel = Channel {
            id: "p".into(),
            label: "A".into(),
            rewrite: Rewrite::Prefix,
            base: Some("https://ghproxy.net/".into()),
            scope: ChannelScope::UpdateOnly,
        };
        assert_eq!(
            channel.map_release_url(url).as_deref(),
            Some("https://ghproxy.net/https://github.com/O/R/releases/download/v1/app.exe")
        );
    }

    #[test]
    fn prefix_channel_without_trailing_slash_still_joins_correctly() {
        let channel = Channel {
            id: "p".into(),
            label: "A".into(),
            rewrite: Rewrite::Prefix,
            base: Some("https://ghproxy.net".into()),
            scope: ChannelScope::UpdateOnly,
        };
        assert_eq!(
            channel.map_release_url("https://github.com/x").as_deref(),
            Some("https://ghproxy.net/https://github.com/x")
        );
    }

    #[test]
    fn prefix_channel_needs_an_https_base() {
        let missing = Channel {
            id: "p".into(),
            label: "A".into(),
            rewrite: Rewrite::Prefix,
            base: None,
            scope: ChannelScope::UpdateOnly,
        };
        assert_eq!(missing.map_release_url("https://github.com/x"), None);

        // 明文 http 的加速通道会被中间设备随意改写，不接受
        let plain = Channel {
            id: "p".into(),
            label: "A".into(),
            rewrite: Rewrite::Prefix,
            base: Some("http://evil.example/".into()),
            scope: ChannelScope::UpdateOnly,
        };
        assert_eq!(plain.map_release_url("https://github.com/x"), None);
    }

    #[test]
    fn jsdelivr_refuses_release_assets() {
        // jsDelivr 只能代理仓库文件，代理 release 资产会 404。
        // 必须提前拒绝，否则用户看到的是一个 200MB 下载卡在 404 上反复重试。
        let channel = Channel {
            id: "j".into(),
            label: "C".into(),
            rewrite: Rewrite::Jsdelivr,
            base: None,
            scope: ChannelScope::UpdateOnly,
        };
        assert_eq!(
            channel.map_release_url("https://github.com/O/R/releases/download/v1/app.exe"),
            None
        );
    }

    #[test]
    fn jsdelivr_maps_repo_files_to_cdn() {
        let channel = Channel {
            id: "j".into(),
            label: "C".into(),
            rewrite: Rewrite::Jsdelivr,
            base: None,
            scope: ChannelScope::UpdateOnly,
        };
        assert_eq!(
            channel.map_repo_file_url("Mochocyang", "QMAI", "main", "latest.json").as_deref(),
            Some("https://cdn.jsdelivr.net/gh/Mochocyang/QMAI@main/latest.json")
        );
    }

    #[test]
    fn identity_maps_repo_files_to_raw_github() {
        let channel = Channel {
            id: "direct".into(),
            label: "直连".into(),
            rewrite: Rewrite::Identity,
            base: None,
            scope: ChannelScope::UpdateOnly,
        };
        assert_eq!(
            channel.map_repo_file_url("O", "R", "main", "x.json").as_deref(),
            Some("https://raw.githubusercontent.com/O/R/main/x.json")
        );
    }

    #[test]
    fn invalid_channels_are_dropped_not_fatal() {
        let json = r#"{
            "version": 2,
            "channels": [
                {"id":"direct","label":"直连","rewrite":"identity","scope":"update-only"},
                {"id":"direct","label":"重复 id","rewrite":"identity","scope":"update-only"},
                {"id":"http","label":"明文","rewrite":"prefix","base":"http://evil.example/","scope":"update-only"},
                {"id":"nobase","label":"缺 base","rewrite":"prefix","scope":"update-only"},
                {"id":"mystery","label":"未知规则","rewrite":"teleport","scope":"update-only"},
                {"id":"ok","label":"好通道","rewrite":"prefix","base":"https://ok.example/","scope":"update-only"}
            ]
        }"#;
        let table = ChannelTable::parse(json).expect("能解析");
        let ids: Vec<&str> = table.channels.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["direct", "ok"], "只留合法且不重复的");
    }

    #[test]
    fn table_without_direct_still_falls_back_to_builtin_direct() {
        let json = r#"{"version":9,"channels":[{"id":"only","label":"唯一","rewrite":"identity","scope":"update-only"}]}"#;
        let table = ChannelTable::parse(json).expect("能解析");
        assert!(
            table.channels.iter().any(|c| c.id == "direct"),
            "远程表删掉直连时要自动补回，否则一旦镜像全挂就没有兜底"
        );
        // 补回来的 direct 要排在最前面，保证它一定是"最后才尝试"的那条
        assert_eq!(table.channels[0].id, "direct");
    }

    #[test]
    fn broken_json_returns_none() {
        assert!(ChannelTable::parse("{ not json").is_none());
        assert!(ChannelTable::parse(r#"{"version":1,"channels":"nope"}"#).is_none());
        assert!(ChannelTable::parse(r#"{"channels":[]}"#).is_none(), "缺 version 也要拒绝");
    }

    #[test]
    fn empty_channel_list_after_sanitizing_still_yields_direct() {
        let json = r#"{"version":3,"channels":[{"id":"","label":"空 id","rewrite":"identity","scope":"update-only"}]}"#;
        let table = ChannelTable::parse(json).expect("能解析");
        assert_eq!(table.channels.len(), 1);
        assert_eq!(table.channels[0].id, "direct");
    }

    #[test]
    fn builtin_mirrors_can_map_the_manifest_but_jsdelivr_cannot() {
        let table = ChannelTable::builtin();
        let manifest = "https://github.com/Mochocyang/QMAI/releases/latest/download/latest.json";
        for channel in &table.channels {
            let mapped = channel.map_release_url(manifest);
            if channel.id == "jsdelivr" {
                assert!(mapped.is_none(), "jsDelivr 不该能映射 release 清单");
            } else {
                assert!(mapped.is_some(), "{} 应该能映射清单", channel.id);
            }
        }
    }
}
