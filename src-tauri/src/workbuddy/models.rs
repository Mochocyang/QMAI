//! WorkBuddy 模型目录：`GET /v3/config` 的解析、缓存与「OpenAI 列表」形状。
//!
//! ── 远程目录是权威，但必须有兜底 ────────────────────────────
//! 运行时权威来源是 `GET {endpoint}/v3/config` 的 `data.models`。两个真实坑：
//!   1. **不带客户端 UA 时 `models` 返回 null** —— 于是「明明登录成功却一个模型
//!      都没有」。请求侧必须逐字带 [`crate::workbuddy::endpoints::Edition::ua`]。
//!   2. 网络抖动 / 上游临时故障时，若直接返回空清单，用户会以为账号没权限。
//!      因此本地留一份缓存文件（`workbuddy-models.json`）与一份内置兜底清单，
//!      三者优先级：远程新结果 > 本地缓存 > 内置。
//!
//! ── 为什么要过滤 ───────────────────────────────────────────
//! `/v3/config` 下发的是一张**客户端全量能力表**，里面混着补全模型、图像模型、
//! 内部专用 id（`completion-*`、`hunyuan-image*`、`default-1.*` …）。把它们原样
//! 塞进模型下拉框，用户会选中一个「一发就 400」的名字。过滤规则照抄官方客户端
//! 的实际可选项（前缀黑名单，见 [`NON_CHAT_PREFIXES`]）。
//!
//! ── 形状 ──────────────────────────────────────────────────
//! 对外只暴露两种形状：[`ModelInfo`]（内部）与 [`to_openai_list`]（`/v1/models`
//! 的 OpenAI 兼容信封）。字段名映射只在这里写一份，别处不要再拼。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::accounts::now_ms;
use super::endpoints::Edition;

/// 本地缓存文件名（与账号文件同目录）。
pub const CACHE_FILE: &str = "workbuddy-models.json";

/// 非对话模型的前缀黑名单（照抄官方客户端实际可选项的口径）。
///
/// `default-1.` 会同时排除 `default-1.1` / `default-1.2` —— 那两个是 Claude 的
/// 内部 id，官方界面也不展示。
pub const NON_CHAT_PREFIXES: &[&str] = &[
    "completion-",
    "codewise-",
    "hunyuan-image",
    "hunyuan-3b",
    "hunyuan-7b",
    "deepseek-r1-0528",
    "deepseek-v3-0324",
    "kimi-k2-instruct",
    "default-1.",
];

/// 一条对话模型的元数据（内部形状）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// 上下文窗口（token）；0 表示上游没给。
    #[serde(default)]
    pub max_input: i64,
    /// 单次输出上限；0 表示上游没给。
    #[serde(default)]
    pub max_output: i64,
    #[serde(default)]
    pub supports_tool_call: bool,
    #[serde(default)]
    pub supports_reasoning: bool,
    #[serde(default)]
    pub is_default: bool,
}

impl ModelInfo {
    /// 上下文窗口的有效值：上游没给时按 128K 估（QMAI 侧还会再取用户配置的
    /// `maxContextSize`，两者取小；这里给 0 会让预算算出「没有上限」）。
    ///
    /// 前端的卡片生成（`src/lib/workbuddy-card.ts`）里有一份同源兜底 ——
    /// 前端拿不到这个函数，所以那条规则只能两边各写一次，改这里时同步改那边。
    #[allow(dead_code)]
    pub fn effective_context(&self) -> i64 {
        if self.max_input > 0 {
            self.max_input
        } else {
            131_072
        }
    }
}

/// 解析 `/v3/config` 的响应体。
///
/// 兼容三种形态：`data.models` 数组、顶层 `models` 数组、`data` 直接是数组
/// （上游在不同版本里都出现过）。解析不出就返回空 —— 由调用方决定回落。
pub fn parse_config(body: &Value) -> Vec<ModelInfo> {
    let candidates = body
        .get("data")
        .and_then(|data| data.get("models"))
        .and_then(Value::as_array)
        .or_else(|| body.get("models").and_then(Value::as_array))
        .or_else(|| body.get("data").and_then(Value::as_array));

    let Some(items) = candidates else {
        return Vec::new();
    };

    let mut models: Vec<ModelInfo> = items
        .iter()
        .filter_map(parse_model)
        .filter(|model| is_chat_model(&model.id))
        .collect();

    // 去重（上游偶尔把同一个 id 下发两次），保留第一次出现的顺序。
    let mut seen = std::collections::HashSet::new();
    models.retain(|model| seen.insert(model.id.clone()));
    models
}

fn parse_model(item: &Value) -> Option<ModelInfo> {
    let id = item.get("id").and_then(Value::as_str)?.trim();
    if id.is_empty() {
        return None;
    }
    Some(ModelInfo {
        id: id.to_string(),
        name: item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        max_input: number(item.get("maxInputTokens")),
        max_output: number(item.get("maxOutputTokens")),
        supports_tool_call: truthy(item.get("supportsToolCall")),
        supports_reasoning: truthy(item.get("supportsReasoning")),
        is_default: truthy(item.get("isDefault")),
    })
}

/// 上游字段既可能是数字也可能是字符串（实测两种都见过）。
fn number(value: Option<&Value>) -> i64 {
    match value {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::String(text)) => text.trim().parse::<i64>().unwrap_or(0),
        _ => 0,
    }
}

fn truthy(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        Some(Value::String(text)) => !text.is_empty() && text != "false" && text != "0",
        _ => false,
    }
}

/// 是不是一个可以拿来对话的模型。
pub fn is_chat_model(id: &str) -> bool {
    !NON_CHAT_PREFIXES
        .iter()
        .any(|prefix| id.starts_with(prefix))
}

/// `/v1/models` 的 OpenAI 兼容信封。
pub fn to_openai_list(models: &[ModelInfo], provider_id: &str) -> Value {
    let data: Vec<Value> = models
        .iter()
        .map(|model| {
            let mut item = json!({
                "id": model.id,
                "object": "model",
                "created": 0,
                "owned_by": provider_id,
                "name": if model.name.is_empty() { model.id.clone() } else { model.name.clone() },
                "supports_tool_call": model.supports_tool_call,
                "supports_reasoning": model.supports_reasoning,
                "is_default": model.is_default,
            });
            let object = item.as_object_mut().expect("刚构造的对象一定是 map");
            if model.max_input > 0 {
                object.insert("max_input_tokens".to_string(), json!(model.max_input));
            }
            if model.max_output > 0 {
                object.insert("max_output_tokens".to_string(), json!(model.max_output));
            }
            item
        })
        .collect();
    json!({ "object": "list", "data": data })
}

/// 远程不可用时的兜底清单。
///
/// 只放确实存在的对话模型：宁可少几个，也不能广告一个「点了就 400」的名字。
pub fn builtin() -> Vec<ModelInfo> {
    let rows: &[(&str, &str, i64, i64)] = &[
        ("deepseek-v4.1-flash", "DeepSeek V4.1 Flash", 262_144, 65_536),
        ("deepseek-v4.1-pro", "DeepSeek V4.1 Pro", 262_144, 65_536),
        ("hunyuan-t1", "混元 T1", 131_072, 32_768),
        ("hunyuan-turbos", "混元 TurboS", 131_072, 32_768),
        ("kimi-k2.6", "Kimi K2.6", 262_144, 65_536),
        ("glm-5.3", "GLM-5.3", 131_072, 32_768),
    ];
    rows.iter()
        .map(|(id, name, input, output)| ModelInfo {
            id: (*id).to_string(),
            name: (*name).to_string(),
            max_input: *input,
            max_output: *output,
            supports_tool_call: true,
            supports_reasoning: !id.contains("flash") && !id.contains("turbos"),
            is_default: *id == "deepseek-v4.1-flash",
        })
        .collect()
}

/// 缓存文件形状。
#[derive(Serialize, Deserialize, Default)]
struct CacheFile {
    #[serde(default)]
    provider: String,
    #[serde(default)]
    fetched_at: i64,
    #[serde(default)]
    models: Vec<ModelInfo>,
}

/// 某个 provider 的模型目录：内存 + 磁盘缓存。
///
/// `load` 时优先读缓存文件；缓存不存在/损坏就退到内置清单。`store` 把一次成功
/// 的远程结果写回磁盘。**没有 TTL**：WorkBuddy 的清单变化很慢，按需刷新即可
/// （登录后、缓存为空时、用户点刷新），加 TTL 只会让「刚拉的清单又变回旧的」。
pub struct ModelCache {
    path: PathBuf,
    provider: String,
    models: Vec<ModelInfo>,
    fetched_at: i64,
}

impl ModelCache {
    /// 从目录加载缓存（找不到就用内置清单）。
    pub fn load(dir: &Path, provider_id: &str) -> ModelCache {
        let path = dir.join(format!("{provider_id}-{CACHE_FILE}"));
        let mut cache = ModelCache {
            path,
            provider: provider_id.to_string(),
            models: builtin(),
            fetched_at: 0,
        };
        if let Ok(text) = std::fs::read_to_string(&cache.path) {
            if let Ok(file) = serde_json::from_str::<CacheFile>(&text) {
                if !file.models.is_empty() {
                    cache.models = file.models;
                    cache.fetched_at = file.fetched_at;
                }
            }
        }
        cache
    }

    pub fn models(&self) -> &[ModelInfo] {
        &self.models
    }

    pub fn fetched_at(&self) -> i64 {
        self.fetched_at
    }

    /// 是否来自远程（`fetched_at > 0` 表示至少成功拉过一次）。
    pub fn is_remote(&self) -> bool {
        self.fetched_at > 0
    }

    /// 目录里有没有这个模型 id。
    pub fn contains(&self, id: &str) -> bool {
        self.models.iter().any(|model| model.id == id)
    }

    /// 取一条模型。
    ///
    /// 网关处理对话时只用 `contains`（存在性判定）；取详情留给「命令层把某条
    /// 模型的上下文/输出上限回填到卡片」那种场景（二期多账号时用）。
    #[allow(dead_code)]
    pub fn get(&self, id: &str) -> Option<&ModelInfo> {
        self.models.iter().find(|model| model.id == id)
    }

    /// 落地一次远程结果。空清单**不覆盖**现有目录（见模块头「两个真实坑」）。
    pub fn store(&mut self, models: Vec<ModelInfo>) {
        if models.is_empty() {
            return;
        }
        let fetched_at = now_ms();
        let file = CacheFile {
            provider: self.provider.clone(),
            fetched_at,
            models: models.clone(),
        };
        if let Ok(text) = serde_json::to_string(&file) {
            if let Err(error) = crate::atomic_file::write_bytes_atomically(&self.path, text.as_bytes())
            {
                super::logging::warn(&format!("模型目录缓存写入失败（不影响本次使用）：{error}"));
            }
        }
        self.models = models;
        self.fetched_at = fetched_at;
    }

    /// 该版本默认勾选的模型：优先 `is_default`，不足 3 个就按顺序补。
    ///
    /// 「不足 3 个就补」是为了让用户在模型下拉框里立刻有可选的东西；
    /// 超过 3 个不自动勾，避免把一个 50 项的清单全塞进选择器。
    ///
    /// ⚠️ 前端已有一份**同规则**的实现（`src/lib/workbuddy-card.ts` 的
    /// `buildWorkbuddyCard`）并带单测：卡片是前端组件直接生成的，让它绕回
    /// IPC 只为算三个模型不值得。两处规则必须一致，改这里时同步改那边。
    #[allow(dead_code)]
    pub fn default_selection(&self) -> Vec<ModelInfo> {
        let mut picked: Vec<ModelInfo> = self
            .models
            .iter()
            .filter(|model| model.is_default)
            .cloned()
            .collect();
        for model in &self.models {
            if picked.len() >= 3 {
                break;
            }
            if !picked.iter().any(|item| item.id == model.id) {
                picked.push(model.clone());
            }
        }
        picked
    }

    /// 模型所属版本（写进账号/卡片时用）。
    pub fn edition_provider(&self) -> &str {
        &self.provider
    }
}

/// 取一个版本的默认兜底（给「连缓存都没有」的极端情况用）。
///
/// 两个版本共用同一份内置清单（见模块头）：它是「远程不可用时别让用户一个模型
/// 都没有」的兜底，按版本分叉只会让国际版先缺一半。参数保留是为了将来上游按
/// 站点下发不同能力时不必改调用点。
#[allow(dead_code)]
pub fn builtin_for(_edition: Edition) -> Vec<ModelInfo> {
    builtin()
}

/// 用某个账号的登录态去拉一次真实目录（`GET /v3/config`）。
///
/// ── 必须带客户端 UA ────────────────────────────────────────
/// 不带 UA 时上游把 `data.models` 返回成 null —— 这是「登录成功却一个模型都没有」
/// 的最常见原因。UA 与 `X-IDE-*` 一组身份头一起发，理由同 [`super::chat`]。
pub async fn fetch_remote(account: &super::accounts::Account) -> Result<Vec<ModelInfo>, String> {
    let endpoint = if account.endpoint.trim().is_empty() {
        account.edition().endpoint.to_string()
    } else {
        account.endpoint.trim_end_matches('/').to_string()
    };
    let url = format!("{endpoint}/v3/config");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| format!("初始化 HTTP 客户端失败：{error}"))?;

    let edition = account.edition();
    let mut request = client
        .get(&url)
        .header(reqwest::header::USER_AGENT, edition.ua)
        .header("X-IDE-Type", "WorkBuddy")
        .header("X-IDE-Name", "WorkBuddy")
        .header("X-IDE-Version", edition.ide_version)
        .header("X-Product", "SaaS")
        .header("X-Requested-With", "XMLHttpRequest")
        .header("Accept", "application/json");

    if !account.auth.access_token.is_empty() {
        request = request.header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", account.auth.access_token),
        );
    }
    if !account.uid.is_empty() {
        request = request.header("X-User-Id", account.uid.clone());
    }
    let domain = if account.auth.domain.is_empty() {
        edition.authority()
    } else {
        account.auth.domain.clone()
    };
    if !domain.is_empty() {
        request = request.header("X-Domain", domain);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("拉取模型目录失败：{error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取模型目录失败：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "拉取模型目录失败：上游返回 {status}（{}）",
            super::accounts::tail(&text, 200)
        ));
    }
    let body: Value = serde_json::from_str(&text)
        .map_err(|_| "模型目录的响应不是 JSON".to_string())?;
    let models = parse_config(&body);
    if models.is_empty() {
        return Err("上游没有下发任何对话模型（可能是登录态失效或缺少客户端 UA）".to_string());
    }
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workbuddy::test_support::temp_dir;

    const FIXTURE: &str = r#"{
        "code": 0,
        "data": {
            "models": [
                { "id": "deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash",
                  "maxInputTokens": 262144, "maxOutputTokens": 65536,
                  "supportsToolCall": true, "supportsReasoning": true, "isDefault": true },
                { "id": "hunyuan-turbos", "name": "混元 TurboS",
                  "maxInputTokens": "131072", "maxOutputTokens": 32768,
                  "supportsToolCall": true },
                { "id": "completion-1.5b", "name": "内部补全", "maxOutputTokens": 8192 },
                { "id": "hunyuan-image-3", "name": "图像" },
                { "id": "default-1.1", "name": "内部" },
                { "id": "deepseek-v4.1-flash", "name": "重复条目" }
            ]
        }
    }"#;

    fn fixture() -> Vec<ModelInfo> {
        parse_config(&serde_json::from_str(FIXTURE).unwrap())
    }

    #[test]
    fn maps_fields_and_drops_non_chat_models() {
        let models = fixture();
        assert_eq!(models.len(), 2, "只应留下两个对话模型：{models:?}");
        assert_eq!(models[0].id, "deepseek-v4.1-flash");
        assert_eq!(models[0].max_input, 262_144);
        assert!(models[0].supports_tool_call);
        assert!(models[0].supports_reasoning);
        assert!(models[0].is_default);
        // 字符串形态的数字也要认
        assert_eq!(models[1].max_input, 131_072);
        // 前缀黑名单
        assert!(models.iter().all(|m| !m.id.starts_with("completion-")));
        assert!(models.iter().all(|m| !m.id.starts_with("hunyuan-image")));
        assert!(models.iter().all(|m| !m.id.starts_with("default-1.")));
    }

    #[test]
    fn duplicate_ids_are_collapsed() {
        let models = fixture();
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids.iter().filter(|id| **id == "deepseek-v4.1-flash").count(), 1);
    }

    #[test]
    fn null_models_yields_empty_not_panic() {
        let body: Value = serde_json::from_str(r#"{"code":0,"data":{"models":null}}"#).unwrap();
        assert!(parse_config(&body).is_empty());
        let body: Value = serde_json::from_str(r#"{"code":0}"#).unwrap();
        assert!(parse_config(&body).is_empty());
    }

    #[test]
    fn openai_list_shape_is_stable() {
        let list = to_openai_list(&fixture(), "workbuddy");
        assert_eq!(list["object"], "list");
        let first = &list["data"][0];
        assert_eq!(first["object"], "model");
        assert_eq!(first["owned_by"], "workbuddy");
        assert_eq!(first["id"], "deepseek-v4.1-flash");
        assert_eq!(first["max_input_tokens"], 262_144);
        assert_eq!(first["max_output_tokens"], 65_536);
        assert_eq!(first["supports_tool_call"], true);
    }

    #[test]
    fn cache_round_trips_through_disk() {
        let dir = temp_dir();
        {
            let mut cache = ModelCache::load(&dir, "workbuddy");
            assert!(!cache.is_remote());
            cache.store(fixture());
            assert!(cache.is_remote());
            assert!(cache.contains("deepseek-v4.1-flash"));
        }
        let reloaded = ModelCache::load(&dir, "workbuddy");
        assert!(reloaded.is_remote());
        assert_eq!(reloaded.models().len(), 2);
    }

    #[test]
    fn empty_remote_result_does_not_wipe_cache() {
        let dir = temp_dir();
        let mut cache = ModelCache::load(&dir, "workbuddy");
        cache.store(fixture());
        cache.store(Vec::new());
        assert_eq!(cache.models().len(), 2, "空结果不能把已有目录清空");
    }

    #[test]
    fn default_selection_prefers_default_flag_then_fills_up_to_three() {
        let dir = temp_dir();
        let mut cache = ModelCache::load(&dir, "workbuddy");
        cache.store(fixture());
        let picked = cache.default_selection();
        assert!(picked.len() <= 3);
        assert!(picked.len() >= 2);
        assert_eq!(picked[0].id, "deepseek-v4.1-flash");
        assert!(picked.iter().any(|m| m.id == "hunyuan-turbos"));
    }

    #[test]
    fn effective_context_falls_back_when_unknown() {
        let model = ModelInfo {
            id: "x".into(),
            name: String::new(),
            max_input: 0,
            max_output: 0,
            supports_tool_call: false,
            supports_reasoning: false,
            is_default: false,
        };
        assert_eq!(model.effective_context(), 131_072);
    }

    #[test]
    fn builtin_is_never_empty() {
        assert!(!builtin().is_empty());
        assert!(!builtin_for(Edition::CN).is_empty());
    }
}
