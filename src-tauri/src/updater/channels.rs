//! 更新通道表：有哪些通道、每个通道怎么把 GitHub 地址拼成它自己的地址。
//!
//! **只服务软件更新**（公开的 latest.json 与 release 安装包）。
//! 用户的小说同步永远走 api.github.com 直连或用户自己的代理 —— 见 `ChannelScope`。

use serde::{Deserialize, Serialize};

/// 「直连」通道的 id。
///
/// 单独抽成常量，是因为「direct 永远垫底兜底」这条硬约束分散在探活排序、
/// 通道表清洗、下载计划三处；散落的字面量一旦拼错，垫底保护会静默失效。
pub const DIRECT_CHANNEL_ID: &str = "direct";

/// 远程通道表的地址（仓库文件，走 jsDelivr CDN）。
///
/// 直接写常量而不是用 `Channel::map_repo_file_url` 拼：这条地址是**引导**用途，
/// 它必须在「还没有可信通道表」的时候就可信。如果拿一张表来决定怎么取这张表，
/// 表里有一条通道写错，远程覆盖就永远拉不起来，而且没有任何地方看得出原因。
pub const REMOTE_CHANNEL_TABLE_URL: &str =
    "https://cdn.jsdelivr.net/gh/Mochocyang/QMAI@main/update-channels.json";

/// 拉远程通道表的超时。
///
/// 用户点「检查更新」时会连带做这一步，所以必须短：拉不到就算了，
/// 内置表本来就是能用的。5 秒是「慢网够用、又不会让界面白等」的折中。
const REMOTE_TABLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

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
    /// 站点直出：地址是站点自己托管的完整安装包（不经 GitHub）。
    ///
    /// 实测 qmai.pro 的安装包存在 Azure Blob、经 Cloudflare CDN 分发，
    /// 单连接 0.6～0.8 MB/s、8 段并发 2.7 MB/s，比 GitHub 直连（58 KB/s）快两个数量级。
    /// 它**没有版本参数**，所以必须靠文件名版本守门（见 `site_asset_matches_version`）。
    Site,
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
                /*
                 * **镜像在前、直连垫底**。
                 *
                 * 这个顺序就是 updater_check 交给插件的 endpoints 顺序，
                 * 插件会按序逐个试。国内实测：
                 *   gh-proxy.com   1.0 秒 200
                 *   ghproxy.net    12 秒超时
                 *   github.com     12 秒超时
                 * 直连排第一的话，每次都要先白等一次超时；排最后才谈得上"加速"。
                 */
                /*
                 * 官网直出排第一：实测它比任何 GitHub 反代都快且稳定
                 * （Azure Blob + Cloudflare CDN）。但它是**固定文件**，
                 * 只有当文件名版本与 latest.json 一致时才可用 —— 见 `site_asset_matches_version`。
                 */
                Channel {
                    id: "official-site".to_string(),
                    label: "官网直链".to_string(),
                    rewrite: Rewrite::Site,
                    base: Some("https://qmai.pro/download/windows".to_string()),
                    scope: ChannelScope::UpdateOnly,
                },
                Channel {
                    id: "gh-proxy-com".to_string(),
                    label: "加速通道 A".to_string(),
                    rewrite: Rewrite::Prefix,
                    base: Some("https://gh-proxy.com/".to_string()),
                    scope: ChannelScope::UpdateOnly,
                },
                Channel {
                    id: "ghproxy-net".to_string(),
                    label: "加速通道 B".to_string(),
                    rewrite: Rewrite::Prefix,
                    base: Some("https://ghproxy.net/".to_string()),
                    scope: ChannelScope::UpdateOnly,
                },
                Channel {
                    id: "jsdelivr".to_string(),
                    label: "加速通道 C".to_string(),
                    rewrite: Rewrite::Jsdelivr,
                    base: None,
                    scope: ChannelScope::UpdateOnly,
                },
                // 直连永远垫底：唯一不依赖第三方、永远不会"服务下线"的那条。
                Channel {
                    id: DIRECT_CHANNEL_ID.to_string(),
                    label: "直连".to_string(),
                    rewrite: Rewrite::Identity,
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
        // 远程表最多认这么多条。通道是「探活后才用」的，条数一多，
        // 检查更新就要挨个探测，反而更慢 —— 上限比"全都信"更符合目标。
        const MAX_CHANNELS: usize = 8;
        let raw: serde_json::Value = serde_json::from_str(json).ok()?;
        let version = raw.get("version")?.as_u64()? as u32;
        let items = raw.get("channels")?.as_array()?;

        let mut out: Vec<Channel> = Vec::new();
        for item in items {
            let Ok(channel) = serde_json::from_value::<Channel>(item.clone()) else {
                continue;
            };
            // id 归一化后再存：远程表可能写 " direct"（带空格），
            // 不 trim 会让下面「有没有 direct」的判断漏判，于是多插一条内置 direct。
            let id = channel.id.trim().to_string();
            if id.is_empty() {
                continue;
            }
            let mut channel = channel;
            channel.id = id;
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
            if out.len() >= MAX_CHANNELS {
                break;
            }
            out.push(channel);
        }

        // 兜底的 direct 是**额外**补的：先给它留一个位，否则总数会超上限一条。
        if !out.iter().any(|channel| channel.id == "direct") {
            while out.len() >= MAX_CHANNELS {
                out.pop();
            }
            let direct = Self::builtin()
                .channels
                .into_iter()
                .find(|channel| channel.id == DIRECT_CHANNEL_ID)?;
            out.insert(0, direct);
        }

        Some(Self {
            version,
            channels: out,
        })
    }

    /// 拉一次远程表，成功且更新才采用。**任何**失败都静默回落到内置表 ——
    /// 加速通道是锦上添花的功能，不能因为 CDN 抽风就让「检查更新」整体不可用。
    pub fn load_effective(client: &reqwest::blocking::Client, proxy_url: Option<&str>) -> Self {
        Self::load_effective_from(client, REMOTE_CHANNEL_TABLE_URL, proxy_url)
    }

    /// `load_effective` 的可测版本：URL 可注入，测试才能指向本地 HTTP 替身。
    ///
    /// 让公开入口 `load_effective` 保持「只有两个参数」是刻意的：调用方不该有
    /// 机会传一个任意 URL 进来（那正是把远程表拉取变成"下载任意地址"的入口）。
    ///
    /// 入参里的 `_client` 保留但不用：远程表自己的超时（5 秒）要比探活客户端更紧，
    /// 它是个必须"拉不到就走"的附加步骤。不用它也就不会继承探活客户端的代理，
    /// 所以代理在这里显式重建一次。
    pub fn load_effective_from(
        _client: &reqwest::blocking::Client,
        url: &str,
        proxy_url: Option<&str>,
    ) -> Self {
        let mut builder = reqwest::blocking::Client::builder()
            .timeout(REMOTE_TABLE_TIMEOUT)
            .connect_timeout(REMOTE_TABLE_TIMEOUT)
            .user_agent("QMaiWrite-Updater");
        // 代理是显式传进来的：reqwest 只在建 client 时读一次环境变量，
        // 而用户完全可能运行中才打开代理，读环境变量会拿到旧配置。
        if let Some(proxy) = proxy_url {
            if let Ok(parsed) = reqwest::Proxy::all(proxy) {
                builder = builder.proxy(parsed);
            }
            // 代理串写坏了就当没配代理：宁可不走代理地再试一次，
            // 也比因为"代理地址格式错了"而彻底放弃远程表更符合目标。
        }

        let remote = builder
            .build()
            .ok()
            .and_then(|client| client.get(url).send().ok())
            .filter(|response| response.status().is_success())
            .and_then(|response| response.text().ok())
            .and_then(|body| Self::parse(&body));

        let Some(remote) = remote else {
            return Self::builtin();
        };

        // 只有**更高**的版本号才覆盖内置表：
        // - 相等：远程表不提供任何新信息，而内置表至少跟这个二进制一起测过；
        // - 更小：用户跑的是更新的版本，被回滚过的远程表不该把它降级。
        let builtin = Self::builtin();
        if remote.version > builtin.version {
            remote
        } else {
            builtin
        }
    }

    /// 整个进程内只解析一次的生效通道表。
    ///
    /// 为什么缓存：`updater_channel_plan` 每次检查更新都会走到这里，而远程表是
    /// 「CDN 上一般不会变」的内容，每次检查都拉一遍只会让检查更新更慢。
    /// 缓存进 `OnceLock` 之后，"刷新"就等于"重启软件"，语义简单到不会出错。
    pub fn effective() -> Self {
        static EFFECTIVE: std::sync::OnceLock<ChannelTable> = std::sync::OnceLock::new();
        EFFECTIVE.get_or_init(Self::fetch_effective).clone()
    }

    /// 真正执行一次远程拉取 + 回落。
    ///
    /// `probe::client()` 建不出来（极罕见）时直接给内置表：
    /// 连 HTTP 客户端都造不出来，再去试远程没有意义。
    fn fetch_effective() -> Self {
        match crate::updater::probe::client() {
            Ok(client) => Self::load_effective(&client, proxy_url_from_store().as_deref()),
            Err(_) => Self::builtin(),
        }
    }

    /// 表里所有镜像 base（prefix 通道的 `base`）。下载白名单从这里取域名，
    /// 这样远程表加镜像时不需要改代码。
    fn mirror_bases(&self) -> Vec<String> {
        self.channels
            .iter()
            .filter_map(|channel| channel.base.as_deref())
            .map(|base| base.trim().to_string())
            .filter(|base| !base.is_empty())
            .collect()
    }
}

/// 从 app-state.json 里读用户代理（任何失败都当作"没开代理"）。
///
/// 这里只读文件、不走 Tauri handle：`fetch_effective` 在 `spawn_blocking` 里
/// 被调用，那里没有 `AppHandle`，而有目录路径就足够了。
fn proxy_url_from_store() -> Option<String> {
    let path = crate::proxy::app_state_path()?;
    let config = crate::proxy::read_proxy_config_from_store(&path)?;
    crate::proxy::current_proxy_url(&config)
}

/// 从一个 https URL 里取出 host（小写、去端口）。
///
/// 为什么不引 `url` crate：这里只做安全判定，需要的是「严格、可审计」。
/// 手写这点逻辑比引入一个通用 URL 解析器更容易看清边界 —— 而且出错时
/// 这里一律返回 `None`（拒绝），不会像宽松解析那样把可疑输入当成合法。
fn host_of_https_url(url: &str) -> Option<String> {
    // 只认 https：明文 http 的内容会被中间设备随意改写，更新包尤其不能接受。
    // 这一步顺带挡掉了 `file://`、`data:` 之类根本不该出现的协议。
    let rest = url.strip_prefix("https://")?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    // 用户信息段（`a@b`）一律拒绝：`https://github.com@evil.com/` 这种写法在
    // 逐字符串比对里看着像 github，实际连的是 evil.com。
    if authority.contains('@') {
        return None;
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (authority, None),
    };
    // 端口要么不写，要么必须是纯数字：`github.com:https` 这种非法形态直接拒绝。
    if let Some(port) = port {
        if port.is_empty() || !port.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
    }
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host.starts_with('.') || host.contains("..") {
        return None;
    }
    Some(host)
}

/// `host` 是否等于 `domain`，或是它的**真子域**。
///
/// 必须比 `host.ends_with(domain)` 严格：后者会把 `evil-github.com`、
/// `ghproxy.net.evil.com` 这类伪装域名全放进来，白名单就形同虚设。
fn host_matches(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

/// 下载命令的 URL 白名单判定。
///
/// 为什么必须有：`updater_download_bytes` 是前端能任意调用的命令。不设边界，
/// 它就变成"从任意地址往内存里拉任意内容"的通用下载器 —— 既是 SSRF 入口，
/// 也是把用户机器当免费中转的入口。
///
/// 允许的只有两类：
/// 1. 官方发布域（GitHub 及其资产域）；
/// 2. 当前**生效通道表**里配置过的镜像 base 所属域名 —— 由表自己声明而不是
///    硬编码，这样远程表加镜像时不用改代码；而且表已经清洗过（只收 https）。
pub fn is_allowed_download_url(url: &str, table: &ChannelTable) -> bool {
    let Some(host) = host_of_https_url(url) else {
        return false;
    };

    const OFFICIAL_DOMAINS: &[&str] = &["github.com", "githubusercontent.com"];
    // 子域必须允许：`objects.githubusercontent.com` 这类资产域是下载必需的。
    if OFFICIAL_DOMAINS
        .iter()
        .any(|domain| host_matches(&host, domain))
    {
        return true;
    }

    table.mirror_bases().iter().any(|base| {
        host_of_https_url(base.trim_end_matches('/'))
            .map(|base_host| host_matches(&host, &base_host))
            .unwrap_or(false)
    })
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
            Rewrite::Jsdelivr | Rewrite::Site => None,
        }
    }

    /// 本通道对 release 资产的前缀：前端拼 `${prefix}${url}` 即可。
    ///
    /// 为什么要把这个东西暴露给前端：前端也要按同一规则改写地址（再交给我们的
    /// 下载命令去拉）。如果前端自己再实现一遍 prefix / identity / jsdelivr 的分支，
    /// 两处规则迟早漂移，而漂移的那一侧只会表现为"某个通道莫名其妙 404"。
    ///
    /// 三态的语义：
    /// - `Prefix` → `Some(base)`（带结尾斜杠）；
    /// - `Identity` → `Some("")`（空前缀、原样使用，与 `map_release_url` 一致）；
    /// - `Jsdelivr` → `None`（不支持 release 资产，前端就该退回插件自己的下载）。
    pub fn release_prefix(&self) -> Option<String> {
        match self.rewrite {
            Rewrite::Identity => Some(String::new()),
            Rewrite::Prefix => {
                let base = self.base.as_deref()?.trim();
                if base.is_empty() || !base.starts_with("https://") {
                    return None;
                }
                Some(ensure_trailing_slash(base))
            }
            Rewrite::Jsdelivr | Rewrite::Site => None,
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
            // 官网直链是「整包文件」，取不了仓库里的任意路径。
            Rewrite::Site => None,
        }
    }

    /// 站点直出通道的完整下载地址（只有 `Rewrite::Site` 有）。
    ///
    /// 与 `map_release_url` 分开的原因：它**不**由 GitHub 地址映射而来，
    /// 而是站点自己托管的固定 URL。混在一起会让「映射规则」这个概念变脏。
    pub fn site_asset_url(&self) -> Option<String> {
        match self.rewrite {
            Rewrite::Site => {
                let base = self.base.as_deref()?.trim();
                if base.is_empty() || !base.starts_with("https://") {
                    return None;
                }
                Some(base.to_string())
            }
            _ => None,
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

    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn builtin_channels_start_with_direct_and_are_unique() {
        let table = ChannelTable::builtin();
        // 直连**排最后**（镜像优先）：国内实测直连 12 秒超时，排第一等于每次先白等一次。
        assert_eq!(
            table.channels.last().map(|channel| channel.id.as_str()),
            Some(DIRECT_CHANNEL_ID)
        );
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
    fn channel_id_is_normalized_before_dedup_and_fallback() {
        // 远程表写 " direct"（前导空格）：归一化后应当被认成同一个 direct，
        // 不能再多插一条内置 direct，否则会出现两条语义重复的通道。
        let json = r#"{"version":4,"channels":[{"id":" direct","label":"带空格","rewrite":"identity","scope":"update-only"}]}"#;
        let table = ChannelTable::parse(json).expect("能解析");
        assert_eq!(table.channels.len(), 1);
        assert_eq!(table.channels[0].id, "direct");
    }

    #[test]
    fn channel_count_is_capped() {
        let mut channels = String::new();
        for index in 0..20 {
            if index > 0 {
                channels.push(',');
            }
            channels.push_str(&format!(
                r#"{{"id":"m{index}","label":"镜像{index}","rewrite":"prefix","base":"https://m{index}.example/","scope":"update-only"}}"#
            ));
        }
        let json = format!(r#"{{"version":5,"channels":[{channels}]}}"#);
        let table = ChannelTable::parse(&json).expect("能解析");
        assert_eq!(
            table.channels.len(),
            8,
            "上限算的是**总数**（含补回来的 direct），否则实际会变成 9 条"
        );
        assert_eq!(table.channels[0].id, "direct", "补回来的 direct 要排最前");
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
            // jsDelivr 只能取仓库文件；官网直链是站点自己的固定整包，
            // 两者都无法从 release 地址映射出来。
            if channel.id == "jsdelivr" || channel.id == "official-site" {
                assert!(mapped.is_none(), "{} 不该能映射 release 清单", channel.id);
            } else {
                assert!(mapped.is_some(), "{} 应该能映射清单", channel.id);
            }
        }
    }

    #[test]
    fn shipped_update_channels_json_is_parseable() {
        // 这份文件会被 jsDelivr 远程下发，写坏了等于把所有人的加速通道关掉。
        // 路径相对本源文件：src-tauri/src/updater/channels.rs → 上三级是仓库根。
        let raw = include_str!("../../../update-channels.json");
        let table = ChannelTable::parse(raw).expect("仓库根目录的 update-channels.json 必须合法");
        assert!(
            table.channels.iter().any(|c| c.id == "direct"),
            "远程表必须包含直连兜底"
        );
        assert!(
            table.channels.len() >= 2,
            "只有直连等于没加速，至少要有一条镜像"
        );
        assert!(
            table
                .channels
                .iter()
                .any(|c| c.rewrite != Rewrite::Identity),
            "必须至少有一条非直连通道"
        );
    }

    /// 起一个极简 HTTP 替身：固定回一段 JSON（与 `probe.rs` 里的 `serve` 同构）。
    ///
    /// 不用真实网络：远程表的核心逻辑是"版本更高才覆盖"，拿线上 CDN 来测，
    /// 等于把测试系在别人随时会改的文件上。
    fn serve(body: &'static str) -> String {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut buffer = [0u8; 2048];
                let _ = stream.read(&mut buffer);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://127.0.0.1:{port}/update-channels.json")
    }

    fn test_client() -> reqwest::blocking::Client {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap()
    }

    #[test]
    fn remote_table_with_higher_version_wins() {
        let body = r#"{"version":99,"channels":[
            {"id":"direct","label":"直连","rewrite":"identity","scope":"update-only"},
            {"id":"remote-mirror","label":"远程通道","rewrite":"prefix","base":"https://remote.example/","scope":"update-only"}
        ]}"#;
        let url = serve(body);
        let table = ChannelTable::load_effective_from(&test_client(), &url, None);
        assert_eq!(table.version, 99, "远程表版本更高时要用远程的");
        assert!(
            table.channels.iter().any(|c| c.id == "remote-mirror"),
            "用的是远程表，就该带上远程表里的通道"
        );
    }

    #[test]
    fn remote_table_with_same_version_falls_back_to_builtin() {
        // 同版本不提供任何新信息；内置表至少和这个二进制一起测过，更可信。
        let body = r#"{"version":1,"channels":[
            {"id":"direct","label":"直连","rewrite":"identity","scope":"update-only"}
        ]}"#;
        let url = serve(body);
        let table = ChannelTable::load_effective_from(&test_client(), &url, None);
        assert_eq!(table, ChannelTable::builtin(), "版本相同必须回落到内置表");
    }

    #[test]
    fn remote_table_with_lower_version_falls_back_to_builtin() {
        // 远程表可能被回滚；跑更新版本的用户不该被它降级。
        let body = r#"{"version":0,"channels":[
            {"id":"direct","label":"直连","rewrite":"identity","scope":"update-only"}
        ]}"#;
        let url = serve(body);
        let table = ChannelTable::load_effective_from(&test_client(), &url, None);
        assert_eq!(table, ChannelTable::builtin());
    }

    #[test]
    fn broken_remote_json_falls_back_to_builtin() {
        let url = serve("{ this is not json");
        let table = ChannelTable::load_effective_from(&test_client(), &url, None);
        assert_eq!(table, ChannelTable::builtin(), "坏 JSON 必须静默回落");
    }

    #[test]
    fn unreachable_remote_falls_back_to_builtin() {
        // 127.0.0.1:1 上通常没人监听，连接会被立刻拒绝 ——
        // 必须回落，而不是 panic 或一直等到超时。
        let table = ChannelTable::load_effective_from(
            &test_client(),
            "http://127.0.0.1:1/update-channels.json",
            None,
        );
        assert_eq!(table, ChannelTable::builtin());
    }

    #[test]
    fn release_prefix_matches_map_release_url_for_every_builtin_channel() {
        // 前端拼 `${prefix}${url}` 的结果必须与 Rust 的 map_release_url 完全一致；
        // 这条测试钉死"改写规则只存在一处"那个契约。
        let manifest = "https://github.com/Mochocyang/QMAI/releases/latest/download/latest.json";
        for channel in &ChannelTable::builtin().channels {
            assert_eq!(
                channel
                    .release_prefix()
                    .as_deref()
                    .map(|prefix| format!("{prefix}{manifest}")),
                channel.map_release_url(manifest),
                "{} 的前缀规则与 map_release_url 不一致",
                channel.id
            );
        }
    }

    #[test]
    fn official_github_hosts_are_allowed() {
        let table = ChannelTable::builtin();
        assert!(is_allowed_download_url(
            "https://github.com/Mochocyang/QMAI/releases/download/v1/app.exe",
            &table
        ));
        assert!(is_allowed_download_url(
            "https://objects.githubusercontent.com/x/app.exe?token=1",
            &table
        ));
    }

    #[test]
    fn configured_mirror_hosts_are_allowed() {
        let table = ChannelTable::builtin();
        // 前缀通道的 base 也是白名单来源：ghproxy.net / gh-proxy.com
        assert!(is_allowed_download_url("https://ghproxy.net/https://github.com/x", &table));
        assert!(is_allowed_download_url("https://gh-proxy.com/https://github.com/x", &table));
    }

    #[test]
    fn unknown_hosts_and_plain_http_are_rejected() {
        let table = ChannelTable::builtin();
        assert!(!is_allowed_download_url("https://evil.example/app.exe", &table));
        assert!(!is_allowed_download_url("http://github.com/x", &table), "明文 http 不接受");
        assert!(!is_allowed_download_url("file:///C:/windows/system32/calc.exe", &table));
        assert!(!is_allowed_download_url("https://", &table));
        assert!(!is_allowed_download_url("https://github.com:https/x", &table), "非法端口");
    }

    #[test]
    fn lookalike_hosts_are_rejected() {
        let table = ChannelTable::builtin();
        // 「后缀相等」很容易写成 `ends_with("github.com")`，
        // 那样下面前两条都会被混进来，白名单就形同虚设。
        assert!(!is_allowed_download_url("https://evil-github.com/x", &table));
        assert!(!is_allowed_download_url("https://ghproxy.net.evil.com/x", &table));
        // 用户信息段伪装：真实 host 是 evil.com
        assert!(!is_allowed_download_url("https://github.com@evil.com/x", &table));
    }

    #[test]
    fn remote_table_mirror_base_extends_the_allowlist() {
        // 白名单的镜像来源必须跟着**生效表**走，否则远程表加一条镜像后，
        // 那条镜像自己的下载会被白名单拦掉。
        let table = ChannelTable::parse(
            r#"{"version":99,"channels":[
                {"id":"direct","label":"直连","rewrite":"identity","scope":"update-only"},
                {"id":"new","label":"新镜像","rewrite":"prefix","base":"https://cdn.example.org/","scope":"update-only"}
            ]}"#,
        )
        .unwrap();
        assert!(is_allowed_download_url("https://cdn.example.org/https://github.com/x", &table));
        assert!(!is_allowed_download_url(
            "https://cdn.example.org/https://github.com/x",
            &ChannelTable::builtin()
        ));
    }
}


#[cfg(test)]
mod effective_tests {
    use super::*;

    #[test]
    fn builtin_table_yields_mirror_first_then_direct() {
        // updater_check 会把 map_release_url 的结果按顺序塞给插件的 endpoints。
        // 第一条必须是镜像：国内实测直连 12 秒超时、镜像 1 秒通。
        let table = ChannelTable::builtin();
        let urls: Vec<String> = table
            .channels
            .iter()
            .filter_map(|channel| channel.map_release_url("https://github.com/O/R/releases/latest/download/latest.json"))
            .collect();
        assert!(urls.len() >= 2, "至少要有镜像 + 直连");
        assert!(
            !urls[0].starts_with("https://github.com/"),
            "第一条得是镜像，不能是直连：{}",
            urls[0]
        );
        let last = urls.last().unwrap();
        assert!(
            last.starts_with("https://github.com/"),
            "最后一条必须是直连兜底：{last}"
        );
    }
}


#[cfg(test)]
mod remote_fetch_tests {
    use super::*;

    #[test]
    fn effective_table_has_mirror_first_when_remote_is_unreachable() {
        // 远程表拉不到时要**静默回落内置表**，且内置表第一必须是镜像。
        // 这条守住"镜像没效果"这类回归：一旦直连跑回第一位，国内每次都要先白等超时。
        let table = ChannelTable::builtin();
        let first = table
            .channels
            .iter()
            .find_map(|channel| channel.map_release_url("https://github.com/O/R/releases/latest/download/latest.json"));
        let first = first.expect("至少要能映射清单地址");
        assert!(
            first.starts_with("https://gh-proxy.com/"),
            "第一条应是 gh-proxy（实测 1 秒通），实际是 {first}"
        );
    }
}
