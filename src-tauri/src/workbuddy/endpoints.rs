//! WorkBuddy 两个版本（国内版 / 国际版）的端点与客户端身份常量。
//!
//! ── 为什么两版是两份常量而不是一个「地区」字段 ────────────────
//! 两版的协议完全一致，差别只有域名、`platform` 取值、UA 里的产品段/版本号，
//! 以及桌面端登录态的文件名。但它们**不共享账号**：拿国内版的 token 打国际版
//! 端点必然 401。所以「版本」必须在账号记录里落下来（`Account::edition`），
//! 而本模块就是这份事实的唯一来源 —— 别处不要再写 `"copilot.tencent.com"`
//! 这类字面量，改端点时只改这里。
//!
//! ── 三个 URL 的差别（容易写错，单独说）────────────────────────
//!   `auth_url(path)` → `{endpoint}/v2{prefix}{path}`，**带** `/plugin` 前缀
//!                      （登录 / 账号 / 刷新都在这个前缀下）
//!   `chat_url()`     → `{endpoint}/v2/chat/completions`，**不带**前缀
//!   `config_url()`   → `{endpoint}/v3/config`，不带前缀，且**必须带客户端 UA**
//!                      否则上游把 `data.models` 返回成 null
//! 这三条都来自对官方客户端通信的实测，不是猜的；写错任何一条的症状分别是
//! 「登录 404」「对话 404」「模型列表一直为空」。
//!
//! ── 本期只用国内版 ───────────────────────────────────────────
//! 国际版常量先备好（[`Edition::INTL`]），二期放开 UI 后直接可用；本期的
//! `provider` id 只有 `workbuddy`，`workbuddy-intl` 留到二期再开放。

use std::path::PathBuf;

/// 一个版本的完整客户端身份。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Edition {
    /// 版本 id（`"cn"` / `"intl"`），落进账号记录
    pub id: &'static str,
    /// 展示名（`"国内版"` / `"国际版"`）
    pub label: &'static str,
    /// 站点根（不带尾斜杠）
    pub endpoint: &'static str,
    /// 鉴权前缀（两版都是 `/plugin`）
    pub prefix_path: &'static str,
    /// `auth/state?platform=` 的取值
    pub platform: &'static str,
    /// 对话链路的完整 UA（含 `CLI/<版本>` 扩展段 —— 少了它 `/v3/config`
    /// 只下发旧版兼容清单，这是「模型列表少一半」的直接原因）
    pub ua: &'static str,
    /// 对话链路的 `X-IDE-Version`
    pub ide_version: &'static str,
    /// 官方桌面端登录态文件名
    pub desktop_file: &'static str,
}

impl Edition {
    /// 国内版：`copilot.tencent.com` / platform `workbuddy`。
    pub const CN: Edition = Edition {
        id: "cn",
        label: "国内版",
        endpoint: "https://copilot.tencent.com",
        prefix_path: "/plugin",
        platform: "workbuddy",
        ua: "WorkBuddy/5.5.4 WorkBuddy/5.5.4 CLI/2.137.1",
        ide_version: "5.5.4",
        desktop_file: "workbuddy-desktop.info",
    };

    /// 国际版：`www.workbuddy.ai` / platform `workbuddy-ai`（二期启用）。
    ///
    /// UA 取 5.8.4 实测值：产品段是**小写** `workbuddy-ai`，末段 `CLI/2.161.0`
    /// 是客户端内置 CLI 的版本；`X-IDE-Version` 也随之走 5.8.4（对话渠道校验
    /// 按它认客户端，用国内版的 5.5.4 会是一种网关特征）。
    pub const INTL: Edition = Edition {
        id: "intl",
        label: "国际版",
        endpoint: "https://www.workbuddy.ai",
        prefix_path: "/plugin",
        platform: "workbuddy-ai",
        ua: "WorkBuddy/5.8.4 workbuddy-ai/5.8.4 CLI/2.161.0",
        ide_version: "5.8.4",
        desktop_file: "workbuddy-desktop-ai.info",
    };

    /// 全部版本（顺序即界面顺序：国内版在前）。
    pub const ALL: [Edition; 2] = [Edition::CN, Edition::INTL];

    /// 版本 id → 版本。未知值回落国内版（与上游行为一致：缺省就是国内站）。
    ///
    /// 接受几种常见别名，是为了让「从别处导出的账号 JSON」和命令行调试都不必
    /// 先归一成 `cn` / `intl`；别名表只此一份，别处不要再写一份。
    pub fn from_id(value: Option<&str>) -> Edition {
        let raw = value.unwrap_or("").trim().to_ascii_lowercase();
        match raw.as_str() {
            "" | "cn" | "china" | "mainland" | "zh" | "workbuddy" => Edition::CN,
            "intl" | "international" | "global" | "ai" | "workbuddy-ai" | "workbuddyai" | "en" => {
                Edition::INTL
            }
            _ => Edition::CN,
        }
    }

    /// QMAI 里的 provider id：`workbuddy` / `workbuddy-intl`。
    ///
    /// provider id 决定账号落在哪一组、模型卡片归谁、请求打哪个站 —— 它是**身份**
    /// 而不是展示字段，所以只在这里生成，别处不要再拼字符串。
    pub fn provider_id(self) -> &'static str {
        match self.id {
            "intl" => "workbuddy-intl",
            _ => "workbuddy",
        }
    }

    /// provider id → 版本（不是 workbuddy 系返回 None）。
    pub fn from_provider_id(provider_id: &str) -> Option<Edition> {
        Edition::ALL
            .into_iter()
            .find(|edition| edition.provider_id() == provider_id)
    }

    /// 鉴权类接口的完整 URL（**带** `/plugin` 前缀）。
    ///
    /// `path` 传 `/auth/state?platform=…` 这种以斜杠开头的路径。
    pub fn auth_url(self, path: &str) -> String {
        format!("{}/v2{}{}", self.endpoint, self.prefix_path, path)
    }

    /// 对话接口 URL（**不带**前缀）。
    pub fn chat_url(self) -> String {
        format!("{}/v2/chat/completions", self.endpoint)
    }

    /// 模型目录接口 URL（不带前缀；请求必须带 [`Edition::ua`]）。
    pub fn config_url(self) -> String {
        format!("{}/v3/config", self.endpoint)
    }

    /// `Origin` / `Referer` 用（与站点根同值）。
    pub fn origin(self) -> &'static str {
        self.endpoint
    }

    /// 端点的 authority（`host[:port]`），`X-Domain` 兜底用。
    ///
    /// 手写拆分而不是引 `url` crate：本 crate 没有这个直接依赖，而为了一行
    /// 「取 host」引入一个新依赖不划算 —— 端点是我们自己的常量，形态固定。
    pub fn authority(self) -> String {
        let without_scheme = self
            .endpoint
            .split_once("://")
            .map(|(_, rest)| rest)
            .unwrap_or(self.endpoint);
        without_scheme
            .split('/')
            .next()
            .unwrap_or("")
            .to_string()
    }
}

/// 匿名请求头：登录的前两步（state / token 轮询）不能带任何身份。
///
/// 少给一个上游就按「已登录但无权限」处理，症状是登录流程永远等不到 token。
pub const ANONYMOUS_HEADERS: &[(&str, &str)] = &[
    ("X-No-Authorization", "true"),
    ("X-No-User-Id", "true"),
    ("X-No-Enterprise-Id", "true"),
    ("X-No-Department-Info", "true"),
];

/// `auth/token` 的「还没登录完」业务码：轮询期间看到它要继续等，不算失败。
pub const CODE_RETRY_FETCH_TOKEN: i64 = 11217;

/// 对话链路的限额业务码（额度 / 并发用尽）。
pub const CODE_QUOTA_LIMIT: i64 = 6004;

/// 对话链路的风控业务码（提示词命中敏感词）。
///
/// 注意它是**负数**：上游把 `11-128` 当表达式算出来了，落进 JSON 就是 `-117`。
pub const CODE_WAF_BLOCK: i64 = 11 - 128;

/// 上游不支持非流式对话的业务码（本网关因此强制 `stream: true`）。
pub const CODE_NON_STREAM_UNSUPPORTED: i64 = 11101;

/// 官方客户端登录态目录（Windows：`%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth`）。
///
/// 两个版本共用同一个目录，靠文件名区分（见 [`Edition::desktop_file`]）。
pub fn desktop_auth_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var("LOCALAPPDATA")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|base| {
                PathBuf::from(base)
                    .join("CodeBuddyExtension")
                    .join("Data")
                    .join("Public")
                    .join("auth")
            })
    } else {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .ok()
            .filter(|value| !value.trim().is_empty())?;
        Some(
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("CodeBuddyExtension")
                .join("Data")
                .join("Public")
                .join("auth"),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_url_has_prefix_but_chat_and_config_do_not() {
        let edition = Edition::CN;
        assert_eq!(
            edition.auth_url("/auth/state?platform=workbuddy"),
            "https://copilot.tencent.com/v2/plugin/auth/state?platform=workbuddy"
        );
        assert_eq!(
            edition.chat_url(),
            "https://copilot.tencent.com/v2/chat/completions"
        );
        assert_eq!(edition.config_url(), "https://copilot.tencent.com/v3/config");
        assert_eq!(
            edition.auth_url("/login/account?state=abc"),
            "https://copilot.tencent.com/v2/plugin/login/account?state=abc"
        );
    }

    #[test]
    fn intl_urls_use_its_own_site() {
        let edition = Edition::INTL;
        assert_eq!(
            edition.chat_url(),
            "https://www.workbuddy.ai/v2/chat/completions"
        );
        assert_eq!(edition.authority(), "www.workbuddy.ai");
    }

    #[test]
    fn edition_alias_resolution_falls_back_to_cn() {
        assert_eq!(Edition::from_id(Some("intl")), Edition::INTL);
        assert_eq!(Edition::from_id(Some("WORKBUDDY-AI")), Edition::INTL);
        assert_eq!(Edition::from_id(Some("cn")), Edition::CN);
        assert_eq!(Edition::from_id(Some("zh")), Edition::CN);
        assert_eq!(Edition::from_id(None), Edition::CN);
        assert_eq!(Edition::from_id(Some("不认识的值")), Edition::CN);
    }

    #[test]
    fn provider_id_round_trips() {
        assert_eq!(Edition::CN.provider_id(), "workbuddy");
        assert_eq!(Edition::INTL.provider_id(), "workbuddy-intl");
        assert_eq!(
            Edition::from_provider_id("workbuddy-intl"),
            Some(Edition::INTL)
        );
        assert_eq!(Edition::from_provider_id("workbuddy"), Some(Edition::CN));
        assert_eq!(Edition::from_provider_id("cline-free"), None);
    }

    #[test]
    fn ua_carries_cli_segment() {
        // 少了 `CLI/<版本>` 段，/v3/config 只下发旧版兼容清单（37 个而不是 51 个）。
        assert!(Edition::CN.ua.contains("CLI/2.137.1"));
        assert!(Edition::CN.ua.starts_with("WorkBuddy/5.5.4 WorkBuddy/5.5.4"));
        assert!(Edition::INTL.ua.contains("workbuddy-ai/5.8.4"));
    }

    #[test]
    fn waf_code_matches_upstream_arithmetic() {
        // 上游把 `11-128` 当表达式，落进 JSON 是 -117 —— 这里必须同源。
        assert_eq!(CODE_WAF_BLOCK, -117);
    }
}
