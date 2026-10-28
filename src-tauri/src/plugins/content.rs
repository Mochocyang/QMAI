//! 内容包（设计 §4 / 决策 D4）：Tier 1 灵感素材的加载、校验与索引。
//!
//! 三条边界：
//!
//! 1. **不跑插件代码**（D1）。内容包是磁盘上的 JSON，宿主自己读、自己渲染，
//!    纯 Tier 1 插件因此在 `processState == "declarative"` 下也能用（零进程开销）。
//! 2. **内容包是不可信输入**。它是第三方仓库里的文件：可以是任意嵌套、任意类型、
//!    任意大小。宿主必须自己校验，而不是"装上时看着像"。
//! 3. **坏包只跳过、不连坐**（见 [`list_packs`]）。一个作者写坏一份包，不该让用户
//!    的整张灵感库列表变成红字。
//!
//! ## 为什么宿主与前端都要校验
//!
//! 同一份规则在两处各写一遍，看起来是重复劳动，实际是**故意**的：
//! 前端 `src/lib/plugins/declarative/content-pack.ts` 的 `parseContentPack` 是
//! 「界面拿到的东西一定可用」的守卫（插件作者也可能直接把文件喂给界面）；
//! 这里 `content.rs` 是「坏数据永不进内存缓存、永不进 IPC」的守卫。
//! 只留一侧的后果是割裂：宿主放过的包会让界面整屏报错，界面放过的包会让宿主持有
//! 半残的数据缓存 —— 两种都会表现成"这个灵感库是坏的"，而作者收不到可行动的报错。
//! 所以两边的**规则**必须逐条一致（见 [`parse_pack`] 的注释），措辞可以有差异。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use super::host_api;
use super::manifest::{self, ContentPackDecl};
use super::paths;
use super::registry::PluginRegistry;

/// 单包字节上限（设计 D4）：超限**拒绝**，绝不截断。
///
/// 截断比拒绝更危险：用户会拿到一份"看起来能用、实际少了一半"的灵感库，
/// 而作者永远不知道自己的包被砍过。
pub const MAX_PACK_BYTES: u64 = 5 * 1024 * 1024;

/// 单包条目上限的默认值（设计 D4：5000 条）。与前端 `DEFAULT_MAX_CONTENT_ITEMS` 同值。
pub const DEFAULT_MAX_ITEMS: usize = 5000;

/// 内容包数据的格式版本。目前只有 1；出现 2 时必须有迁移，不能静默兼容。
pub const PACK_VERSION: u32 = 1;

/// 上限的人类可读写法，用于报错（设计原文就是「上限 5MB」）。
const MAX_PACK_LABEL: &str = "5MB";

/// 一条灵感素材。字段与前端 `ContentPackItem` 一一对应（camelCase 序列化）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentPackItem {
    pub id: String,
    pub title: String,
    pub body: String,
    /// 可选：空数组不序列化，前端 `item.tags ?? []` 两边都吃得下。
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub tags: Vec<String>,
}

/// 内容包的元信息：够界面画一张卡片与一个筛选项，**不含正文**。
///
/// 列表接口只回这个，是为了让「装 20 个灵感包」的插件中心不必把 100MB 条目
/// 一次性搬进前端内存；用户点开哪个包，才去取哪个包的 items。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentPackMeta {
    /// 形如 `<pluginId>/<packId>`。前端的 `plugins_content_pack_items` 就按它取值，
    /// 拼成一体是为了让前端不必自己拼 key（拼错就是"找不到内容包"）。
    pub pack_id: String,
    pub plugin_id: String,
    pub plugin_name: String,
    /// 包在插件内的 id（不带插件前缀）。
    pub id: String,
    pub title: String,
    pub description: String,
    pub count: usize,
    /// 生效的插槽：清单没写时填 `"inspiration-browser"`（内容包的本职位置）。
    ///
    /// 与清单里的 `slot: Option<String>` 不同，这里始终是字符串 —— 前端
    /// `ContentPack.slot`（`api.ts` 的 `toSlotPackEntry`）拿它建插槽索引，
    /// 给 `null` 只会让包静默不挂任何插槽。
    pub slot: String,
    /// 该包的条目上可用动作（清单里 `contentPacks[].actions` 的原样 JSON，设计 §4.1）。
    ///
    /// 必须沿元信息一路送到前端：灵感库要在「用户点开某个包之前」就知道这个包的条目
    /// 能插入正文、能写项目字段、还是能触发一个声明式动作。若只放在条目接口里，
    /// 界面得先把几千条拉进来才知道有没有按钮。
    ///
    /// **不校验、不归一化**：真源是前端 `declarative/api.ts` 的 `normalizeTargets` +
    /// `CONTENT_ITEM_TARGET_KINDS` 白名单，宿主再判一遍会变成两份会分叉的规则。
    pub actions: Vec<serde_json::Value>,
}

// ── 路径与读盘 ─────────────────────────────────────────

/// 词法闸门：确认 `decl.file` 是「插件目录内的相对路径」，返回尚未解析的拼接路径。
///
/// 为什么还要再判一次：清单里的 `file` 在**解析**时已经被 `manifest::is_safe_content_file`
/// 限成相对路径且无 `..`，但那份清单是磁盘上的普通文件，用户可以手改。
fn pack_candidate(plugin_root: &Path, decl: &ContentPackDecl) -> Result<PathBuf, String> {
    let illegal = decl.file.trim().is_empty()
        || decl.file.starts_with('/')
        || decl.file.starts_with('\\')
        || Path::new(&decl.file).is_absolute()
        || decl
            .file
            .split(['/', '\\'])
            .any(|segment| segment == ".." || segment.is_empty());
    if illegal {
        return Err(format!("内容包 {} 的路径非法：{}", decl.id, decl.file));
    }
    Ok(plugin_root.join(&decl.file))
}

/// 真实路径闸门：挡住插件目录里的符号链接 / NTFS junction。
///
/// 「字符串上在插件目录内」不等于「解析出的真实路径在插件目录内」—— 一个指向
/// `C:\secret.json` 的符号链接就能让 `content/x.json` 读到任意位置。所以清单校验之外
/// 必须再 canonical 一次，并**用复检后的路径去读**：检查的对象与被读的对象不是同一个，
/// 两者之间就有做手脚的空间。逻辑直接复用 `host_api::canonical_inside`（项目读写那条
/// 通道用的是同一段），两处各写一份迟早会在「哪个更严」上分叉。
fn canonical_pack_path(
    plugin_root: &Path,
    candidate: &Path,
    decl: &ContentPackDecl,
) -> Result<PathBuf, String> {
    host_api::canonical_inside(plugin_root, candidate)
        .map_err(|code| format!("内容包 {} 越出插件目录（{code}）：{}", decl.id, decl.file))
}

fn oversize_error(bytes: u64) -> String {
    format!("内容包过大：{bytes} 字节，上限 {MAX_PACK_LABEL}")
}

/// 读盘 → 存在/大小闸门 → 真实路径复检 → 解析 JSON。
///
/// 顺序是刻意的：**先看大小再读内容**（一个 500MB 的坏包不该先被整个读进内存再被判超限），
/// 且先判「存不存在」再判「越不越界」—— 这是作者完全不同的两种错误，报错必须能区分。
fn read_pack_json(
    plugin_root: &Path,
    decl: &ContentPackDecl,
) -> Result<serde_json::Value, String> {
    let candidate = pack_candidate(plugin_root, decl)?;
    // `metadata` 跟随符号链接：到这一步只说明「目标文件存在」，不说明目标在插件目录内。
    let meta = std::fs::metadata(&candidate).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => format!(
            "内容包 {} 的文件不存在：{}",
            decl.id,
            candidate.display()
        ),
        _ => format!("读取内容包 {} 失败：{error}", decl.id),
    })?;
    if meta.len() > MAX_PACK_BYTES {
        return Err(oversize_error(meta.len()));
    }
    let path = canonical_pack_path(plugin_root, &candidate, decl)?;
    let text = std::fs::read_to_string(&path)
        .map_err(|error| format!("读取内容包 {} 失败：{error}", decl.id))?;
    // metadata 与 read 之间文件可能被换掉（TOCTOU）：以真正读到的字节数为准再判一次。
    if text.len() as u64 > MAX_PACK_BYTES {
        return Err(oversize_error(text.len() as u64));
    }
    serde_json::from_str(&text)
        .map_err(|error| format!("内容包 {} 不是合法 JSON：{error}", decl.id))
}

// ── 校验（与前端 content-pack.ts 逐条对齐）──────────────

/// `version` 必须是**数字** 1：字符串 `"1"`、布尔 `true` 都拒绝。
///
/// 与前端 `source.version !== 1` 等价：JS 里 `true !== 1` 成立，所以布尔也不算数字。
/// 放宽一次就再也收不紧 —— 将来上 v2 结构时无法区分「字符串 1」的真实意图。
fn is_version_one(value: Option<&serde_json::Value>) -> bool {
    match value {
        Some(serde_json::Value::Number(number)) => {
            number.as_u64() == Some(u64::from(PACK_VERSION))
                || number.as_f64() == Some(f64::from(PACK_VERSION))
        }
        _ => false,
    }
}

/// 条数上限。`maxItems: 0`（或漏写后 serde 给出的 0）按默认 5000 处理：
/// 与前端 `resolveItemLimit`（`<= 0` → 默认值）一致，否则一个漏写字段的清单
/// 会让整包 5000 条全变成"超限"。
///
/// 结果再夹到设计 D4 的 5000 硬顶。
///
/// 5000 条是设计 D4 的硬上限：作者在清单里写更大的 maxItems 也不生效。
/// 为什么不报错而是夹住：清单校验层（manifest.rs）已定稿，且"作者想放宽上限"
/// 是善意误用而非攻击；夹住后表现可预测（超出部分被拒），报错会让老包莫名装不上。
fn resolve_item_limit(declared: usize) -> usize {
    let limit = if declared == 0 {
        DEFAULT_MAX_ITEMS
    } else {
        declared
    };
    limit.min(DEFAULT_MAX_ITEMS)
}

/// 非空字符串（空白算空）—— 前端 `isNonEmptyString` 的镜像。
fn non_empty_str(value: Option<&serde_json::Value>) -> Option<&str> {
    value
        .and_then(serde_json::Value::as_str)
        .filter(|text| !text.trim().is_empty())
}

/// 包级报错：统一带上包 id。
///
/// 前端返回的是 `errors: string[]`（一次性列全，作者才能一轮改完）；宿主这边
/// 契约是 `Result<_, String>`，所以把多条用 `；` 拼起来 —— 数量信息不丢，
/// 顺序也和前端一致。
fn pack_error(decl: &ContentPackDecl, detail: impl std::fmt::Display) -> String {
    format!("内容包 {}：{detail}", decl.id)
}

/// 校验一份已解析的包，返回条目。`limit` 是调用方算好的**生效**上限
/// （[`resolve_item_limit`] 已把 0 归到默认值、并夹到 5000 硬顶），
/// 从入口传进来是为了让加载与计数两条路径用同一个数。
///
/// 规则与前端 `parseContentPack` 逐条对齐：
///
/// | 规则 | 前端 | 这里 |
/// |---|---|---|
/// | 顶层必须是对象 | ✅ | ✅ 直接返回单条错误 |
/// | `version` 必须是数字 1 | ✅ | ✅ |
/// | `items` 必须是数组 | ✅ 且不再继续校验 | ✅ 同 |
/// | 条数 > maxItems（默认 5000） | ✅ | ✅ |
/// | `id`/`title`/`body` 非空（空白算空）| ✅ | ✅ |
/// | `id` 去空白后唯一 | ✅ 指出重复值 | ✅ |
/// | `tags` 存在时必须是字符串数组 | ✅ | ✅ |
/// | 一次性列出全部错误 | ✅ | ✅（`；` 拼接）|
fn parse_pack(
    raw: &serde_json::Value,
    decl: &ContentPackDecl,
    limit: usize,
) -> Result<Vec<ContentPackItem>, String> {
    let Some(source) = raw.as_object() else {
        return Err(pack_error(decl, "必须是 JSON 对象"));
    };

    let mut errors: Vec<String> = Vec::new();
    if !is_version_one(source.get("version")) {
        errors.push("version 必须为 1".to_string());
    }

    let Some(raw_items) = source.get("items").and_then(serde_json::Value::as_array) else {
        // items 不是数组就没法往下校验：与前端一样只报这一条（其余错误此时无意义）。
        return Err(pack_error(decl, "items 必须是数组"));
    };

    if raw_items.len() > limit {
        errors.push(format!("条目数 {} 超过上限 {limit}", raw_items.len()));
    }

    let mut items: Vec<ContentPackItem> = Vec::with_capacity(raw_items.len().min(limit));
    let mut seen_ids: HashSet<String> = HashSet::new();

    for (index, raw_item) in raw_items.iter().enumerate() {
        // 索引从 1 起报：作者看的是"第 12 条"，不是"第 11 个元素"。
        let position = format!("第 {} 条", index + 1);
        let Some(item) = raw_item.as_object() else {
            errors.push(format!("{position}必须是对象"));
            continue;
        };

        let mut usable = true;
        if non_empty_str(item.get("id")).is_none() {
            errors.push(format!("{position}缺少有效的 id"));
            usable = false;
        }
        if non_empty_str(item.get("title")).is_none() {
            errors.push(format!("{position}缺少有效的 title"));
            usable = false;
        }
        if non_empty_str(item.get("body")).is_none() {
            errors.push(format!("{position}缺少有效的 body"));
            usable = false;
        }

        // 唯一性以**去空白后**的 id 为准：落内存的是 trimmed 版本，按原串去重会让
        // " i001" 与 "i001" 双双通过校验、却在包里撞成同一个 id。
        let id_value = item
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        if !id_value.is_empty() && !seen_ids.insert(id_value.to_string()) {
            // 几万条数据里只说"有重复"等于没说，必须点名是哪个 id。
            errors.push(format!("{position}的 id 重复：{id_value}"));
            usable = false;
        }

        // tags 可选，但给了就必须是字符串数组：混进数字会让筛选器的计数与匹配都失真。
        let mut tags: Vec<String> = Vec::new();
        if let Some(raw_tags) = item.get("tags") {
            match raw_tags.as_array() {
                Some(list) if list.iter().all(serde_json::Value::is_string) => {
                    tags = list
                        .iter()
                        .filter_map(serde_json::Value::as_str)
                        .map(str::to_string)
                        .collect();
                }
                _ => {
                    errors.push(format!("{position}的 tags 必须是字符串数组"));
                    usable = false;
                }
            }
        }

        if !usable {
            continue;
        }

        items.push(ContentPackItem {
            id: id_value.to_string(),
            title: non_empty_str(item.get("title"))
                .unwrap_or_default()
                .trim()
                .to_string(),
            body: non_empty_str(item.get("body"))
                .unwrap_or_default()
                .trim()
                .to_string(),
            tags,
        });
    }

    if !errors.is_empty() {
        return Err(pack_error(decl, errors.join("；")));
    }
    Ok(items)
}

// ── 公开的加载入口 ──────────────────────────────────────

/// 读并校验一个内容包文件，返回条目（**不走缓存**，测试与一次性读取用这个）。
///
/// 宿主必须自己校验：内容包是**不可信输入**（第三方仓库里的 JSON）。
pub fn load_pack_items(
    plugin_root: &Path,
    decl: &ContentPackDecl,
) -> Result<Vec<ContentPackItem>, String> {
    let raw = read_pack_json(plugin_root, decl)?;
    let limit = resolve_item_limit(decl.max_items);
    parse_pack(&raw, decl, limit)
}

/// 只算条数（给列表卡片用）。
///
/// **必须**走与 [`load_pack_items`] 完全相同的校验，否则列表里会出现一个
/// 「count 显示 120、点开却报 400」的包 —— 那正是我们要消灭的割裂。
/// 代价是同样把条目构建一遍再丢掉：单包上限 5MB / 5000 条，这点瞬时分配可以接受，
/// 而且它只在用户打开插件中心/灵感库时才发生。
pub fn count_pack_items(plugin_root: &Path, decl: &ContentPackDecl) -> Result<usize, String> {
    let raw = read_pack_json(plugin_root, decl)?;
    // 与 load_pack_items 用同一个生效上限：两处各算一遍会让「列表显示 N 条、
    // 点开却报超限」重新出现，所以规则只能有一个来源。
    let limit = resolve_item_limit(decl.max_items);
    Ok(parse_pack(&raw, decl, limit)?.len())
}

/// 缓存 key：`<pluginId>/<packId>`。插件 id 的字符集不含 `/`，所以这个 key 无歧义。
pub fn pack_key(plugin_id: &str, pack_id: &str) -> String {
    format!("{plugin_id}/{pack_id}")
}

/// 进程内缓存：读过一次的包不再重新解析。
///
/// 为什么需要它：5000 条的包在界面里被反复打开、切换筛选、点条目，每次都重新读盘 +
/// 解析 JSON 是白白的几十毫秒；内容是**随包分发、安装后不变**的（D4），天然适合缓存。
/// 因此它的失效只由两件事触发：插件被停用/卸载（[`invalidate`]），或进程重启。
static CACHE: OnceLock<Mutex<HashMap<String, Vec<ContentPackItem>>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<String, Vec<ContentPackItem>>> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 带缓存地读一个内容包。校验失败**不入缓存**：作者改好文件后重开界面就该能用，
/// 不该让一次失败一直粘着。
pub fn cached_pack_items(
    plugin_root: &Path,
    plugin_id: &str,
    decl: &ContentPackDecl,
) -> Result<Vec<ContentPackItem>, String> {
    let key = pack_key(plugin_id, &decl.id);
    // 锁只包住查表/插表，不跨读盘：解析 5MB JSON 要几十毫秒，持锁会把并发的灵感库
    // 请求（以及未来任何用到这张表的地方）一起堵住。
    if let Some(hit) = cache()
        .lock()
        .map_err(|_| "内容包缓存状态不可用".to_string())?
        .get(&key)
        .cloned()
    {
        return Ok(hit);
    }
    let items = load_pack_items(plugin_root, decl)?;
    cache()
        .lock()
        .map_err(|_| "内容包缓存状态不可用".to_string())?
        .insert(key, items.clone());
    Ok(items)
}

/// 清掉某个插件的全部缓存条目。
///
/// 在插件**停用/卸载**时调用：停用意味着用户不再信任这份内容，卸载意味着文件马上要
/// 被删。不清的话，被删掉的包还能从内存里被读出来 —— 用户看到"已卸载的插件还在
/// 出内容"，那种感觉比直接报错糟得多。
pub fn invalidate(plugin_id: &str) {
    let prefix = format!("{plugin_id}/");
    if let Ok(mut guard) = cache().lock() {
        guard.retain(|key, _| !key.starts_with(&prefix));
    }
}

/// 列出注册表里**已启用**插件的内容包元信息（不启动任何插件进程 —— Tier 1，D1）。
///
/// 为什么只列已启用的：停用是用户明确表达的"别再让它出现在我的界面里"。数据仍留在
/// 磁盘上（重新启用即可用），但索引不该继续供出它 —— 否则"停用"在插件中心看得见效果、
/// 在灵感库里却毫无效果。
///
/// 为什么坏包只跳过、不让整张列表失败：`list_packs` 的返回值就是插件中心/灵感库的
/// 全部输入。一个第三方包写错一个字段，就让用户的最佳素材之外的一切都消失（甚至
/// 让整个插件中心报红），是把作者的错误放大成用户的故障。所以坏包 eprintln 留痕、
/// 其余照常返回 —— 排查时看日志，使用时不打扰。
pub fn list_packs(root: &Path) -> Vec<ContentPackMeta> {
    let registry = match PluginRegistry::load(root) {
        Ok(registry) => registry,
        // 注册表坏了是另一个层面的故障（安装/启停全都不可用），但内容包索引仍应
        // 安静地返回空列表，而不是把插件中心整页打红。
        Err(error) => {
            eprintln!("[content] 读取插件注册表失败，内容包索引为空：{error}");
            return Vec::new();
        }
    };

    let mut metas: Vec<ContentPackMeta> = Vec::new();
    for entry in registry.list().into_iter().filter(|entry| entry.enabled) {
        let plugin_root = paths::plugin_dir(root, &entry.id);
        // 清单读不到/坏掉的插件：跳过它自己的包，继续看别的插件（同理不连坐）。
        let manifest = match std::fs::read_to_string(plugin_root.join("plugin.json")) {
            Ok(raw) => match manifest::PluginManifest::parse(&raw) {
                Ok(manifest) => manifest,
                Err(error) => {
                    eprintln!(
                        "[content] 跳过插件 {} 的内容包：清单校验失败 {}",
                        entry.id,
                        error.code()
                    );
                    continue;
                }
            },
            Err(error) => {
                eprintln!(
                    "[content] 跳过插件 {} 的内容包：读不到清单（{error}）",
                    entry.id
                );
                continue;
            }
        };

        for decl in &manifest.contributes.content_packs {
            match count_pack_items(&plugin_root, decl) {
                Ok(count) => metas.push(ContentPackMeta {
                    pack_id: pack_key(&entry.id, &decl.id),
                    plugin_id: entry.id.clone(),
                    plugin_name: manifest.name.clone(),
                    id: decl.id.clone(),
                    title: decl.title.clone(),
                    description: decl.description.clone(),
                    count,
                    // 缺省回填灵感库：设计 §4.1 里 `slot` 是可选字段，而内容包的本职
                    // 位置就是灵感库 —— 老插件不写也必须出现在界面上。
                    slot: decl
                        .slot
                        .clone()
                        .unwrap_or_else(|| "inspiration-browser".to_string()),
                    // 清单里写了什么就送什么（不做白名单）：前端 `normalizeTargets` 会把
                    // 不认识的 kind 丢掉，宿主在这里再拦一次只会让「界面能认的新 kind」
                    // 卡在 Rust 侧的旧规则上。
                    actions: decl.actions.clone(),
                }),
                Err(error) => eprintln!(
                    "[content] 跳过内容包 {}/{}：{error}",
                    entry.id, decl.id
                ),
            }
        }
    }

    // 注册表本身是 BTreeMap（顺序稳定），这里再排一次是为了让「同一插件的多个包」
    // 也稳定有序 —— 界面每次刷新都跳顺序是很容易被当成 bug 反馈的。
    metas.sort_by(|a, b| a.pack_id.cmp(&b.pack_id));
    metas
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 临时目录；Drop 时清掉，避免测试在 %TEMP% 下越积越多。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "qmai-content-{tag}-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).expect("创建临时目录");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// 声明侧只需要 id/file/maxItems；title/description 只是展示用。
    fn decl(id: &str, file: &str, max_items: usize) -> ContentPackDecl {
        ContentPackDecl {
            id: id.to_string(),
            title: "科幻灵感包".to_string(),
            description: "120 条赛博 / 末世 / 星际的设定切入点".to_string(),
            file: file.to_string(),
            max_items,
            // 这条助手造的是「只描述文件」的声明；插槽与包级动作由用例显式给。
            slot: None,
            actions: Vec::new(),
        }
    }

    /// 建一个插件目录并写入内容包文件（自动补齐子目录）。
    fn write_plugin_pack(plugin_root: &Path, file: &str, content: &str) {
        let path = plugin_root.join(file);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("创建内容包目录");
        }
        std::fs::write(&path, content).expect("写内容包文件");
    }

    fn plugin_root(temp: &TempDir, id: &str) -> PathBuf {
        let dir = paths::plugin_dir(temp.path(), id);
        std::fs::create_dir_all(&dir).expect("创建插件目录");
        dir
    }

    fn valid_pack_json() -> String {
        json!({
            "version": 1,
            "items": [
                {
                    "id": "i001",
                    "title": "最后一班地铁",
                    "body": "末班车只有七个人，其中六个没有影子。",
                    "tags": ["都市", "悬疑"]
                },
                { "id": "i002", "title": "盐湖", "body": "湖面结的不是水，是盐。" }
            ]
        })
        .to_string()
    }

    #[test]
    fn loads_a_valid_pack() {
        let temp = TempDir::new("valid");
        let root = plugin_root(&temp, "idea-pack");
        write_plugin_pack(&root, "content/inspirations.json", &valid_pack_json());

        let items = load_pack_items(&root, &decl("scifi", "content/inspirations.json", 0))
            .expect("合法内容包必须能读");

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "i001");
        assert_eq!(items[0].title, "最后一班地铁");
        assert_eq!(items[0].tags, vec!["都市".to_string(), "悬疑".to_string()]);
        // 没有 tags 的条目也合法，且序列化成空数组之外的形态（camelCase + 省略空 tags）
        assert!(items[1].tags.is_empty());
        let value = serde_json::to_value(&items[1]).expect("条目可序列化");
        assert!(value.get("tags").is_none(), "空 tags 不该出现在 JSON 里");
        assert_eq!(value["body"], "湖面结的不是水，是盐。");
    }

    #[test]
    fn trims_item_fields_like_the_frontend() {
        let temp = TempDir::new("trim");
        let root = plugin_root(&temp, "trim-pack");
        write_plugin_pack(
            &root,
            "pack.json",
            &json!({
                "version": 1,
                "items": [{ "id": "  i001  ", "title": " 标题 ", "body": " 正文 " }]
            })
            .to_string(),
        );

        let items = load_pack_items(&root, &decl("scifi", "pack.json", 0)).expect("应通过校验");
        assert_eq!(items[0].id, "i001", "落内存的是 trimmed 版本");
        assert_eq!(items[0].title, "标题");
        assert_eq!(items[0].body, "正文");
    }

    #[test]
    fn rejects_missing_file() {
        let temp = TempDir::new("missing");
        let root = plugin_root(&temp, "missing-pack");

        let error = load_pack_items(&root, &decl("scifi", "content/nope.json", 0))
            .expect_err("文件不存在必须报错");
        assert!(error.contains("不存在"), "错误应说明文件不存在：{error}");
        assert!(error.contains("nope.json"), "错误应带上文件路径：{error}");
    }

    #[test]
    fn rejects_wrong_version() {
        let temp = TempDir::new("version");
        let root = plugin_root(&temp, "version-pack");
        write_plugin_pack(
            &root,
            "pack.json",
            &json!({ "version": 2, "items": [] }).to_string(),
        );

        let error =
            load_pack_items(&root, &decl("scifi", "pack.json", 0)).expect_err("version 2 必须拒绝");
        assert!(error.contains("version"), "错误应点名 version：{error}");
        assert!(error.contains('1'), "错误应说明要求为 1：{error}");

        // 字符串 "1" 同样拒绝：版本是契约，不是展示字段。
        write_plugin_pack(
            &root,
            "pack.json",
            &json!({ "version": "1", "items": [] }).to_string(),
        );
        let error = load_pack_items(&root, &decl("scifi", "pack.json", 0))
            .expect_err("字符串版本必须拒绝");
        assert!(error.contains("version 必须为 1"), "错误应说明版本要求：{error}");
    }

    #[test]
    fn rejects_missing_title_with_item_index() {
        let temp = TempDir::new("title");
        let root = plugin_root(&temp, "title-pack");
        let mut items: Vec<serde_json::Value> = (1..=11)
            .map(|index| {
                json!({ "id": format!("i{index:03}"), "title": "标题", "body": "正文" })
            })
            .collect();
        // 第 12 条故意漏掉 title
        items.push(json!({ "id": "i012", "body": "正文" }));
        write_plugin_pack(
            &root,
            "pack.json",
            &json!({ "version": 1, "items": items }).to_string(),
        );

        let error = load_pack_items(&root, &decl("scifi", "pack.json", 0))
            .expect_err("缺 title 必须报错");
        assert!(
            error.contains("第 12 条"),
            "错误必须指出是第几条（几万条里只说'缺 title'等于没说）：{error}"
        );
        assert!(error.contains("title"), "错误必须点名字段：{error}");
    }

    #[test]
    fn rejects_duplicate_item_ids() {
        let temp = TempDir::new("duplicate");
        let root = plugin_root(&temp, "duplicate-pack");
        write_plugin_pack(
            &root,
            "pack.json",
            &json!({
                "version": 1,
                "items": [
                    { "id": "dup-1", "title": "第一条", "body": "正文" },
                    { "id": " dup-1 ", "title": "第二条", "body": "正文" }
                ]
            })
            .to_string(),
        );

        let error = load_pack_items(&root, &decl("scifi", "pack.json", 0))
            .expect_err("重复 id 必须报错");
        assert!(error.contains("dup-1"), "错误必须指出重复的那个 id：{error}");
        assert!(error.contains("重复"), "错误应说明是重复：{error}");
        // 去空白后判重：第二条才是重复者
        assert!(error.contains("第 2 条"), "错误应指出重复位置：{error}");
    }

    #[test]
    fn rejects_too_many_items() {
        let temp = TempDir::new("too-many");
        let root = plugin_root(&temp, "too-many-pack");
        write_plugin_pack(
            &root,
            "pack.json",
            &json!({
                "version": 1,
                "items": [
                    { "id": "a", "title": "t", "body": "b" },
                    { "id": "b", "title": "t", "body": "b" },
                    { "id": "c", "title": "t", "body": "b" }
                ]
            })
            .to_string(),
        );

        let error = load_pack_items(&root, &decl("scifi", "pack.json", 2))
            .expect_err("超过 maxItems 必须报错");
        assert!(error.contains("超过上限 2"), "错误应带上上限：{error}");
    }

    /// 设计 D4：5000 条是硬上限，清单里写更大的 `maxItems` 也不生效。
    ///
    /// 造 5001 条（比硬顶多 1 条）：夹住生效时必须报错，且报错里要出现 5000 而不是
    /// 作者写的 20000 —— 否则作者会以为自己的声明被采纳了，实际被悄悄夹小。
    #[test]
    fn max_items_is_capped_at_5000() {
        let temp = TempDir::new("cap-5000");
        let root = plugin_root(&temp, "cap-pack");
        let items: Vec<serde_json::Value> = (1..=5001)
            .map(|index| json!({ "id": format!("i{index:05}"), "title": "标题", "body": "正文" }))
            .collect();
        write_plugin_pack(
            &root,
            "pack.json",
            &json!({ "version": 1, "items": items }).to_string(),
        );

        let capped = decl("scifi", "pack.json", 20_000);
        // 不用 expect_err：失败时它会 Debug 打印整个 5001 条 Vec，把测试输出淹掉。
        let error = match load_pack_items(&root, &capped) {
            Ok(items) => panic!("超过 5000 硬顶必须报错，实际读到了 {} 条", items.len()),
            Err(error) => error,
        };
        assert!(
            error.contains("上限 5000"),
            "生效上限必须是 5000 而不是清单里的 20000：{error}"
        );

        // 计数路径必须与加载路径同一条规则，否则列表会显示一个点开就报错的包。
        let error = match count_pack_items(&root, &capped) {
            Ok(count) => panic!("计数路径同样要夹到 5000，实际数出 {count} 条"),
            Err(error) => error,
        };
        assert!(
            error.contains("上限 5000"),
            "计数路径的生效上限也必须是 5000：{error}"
        );
    }

    #[test]
    fn rejects_pack_over_size_limit() {
        let temp = TempDir::new("too-large");
        let root = plugin_root(&temp, "too-large-pack");
        // 5MB 上限按**字节**算：中文每字 3 字节，200 万字符约 6MB。
        let big_body = "灵".repeat(2_000_000);
        write_plugin_pack(
            &root,
            "pack.json",
            &format!(
                r#"{{"version":1,"items":[{{"id":"a","title":"t","body":"{big_body}"}}]}}"#
            ),
        );
        assert!(
            std::fs::metadata(root.join("pack.json"))
                .expect("文件已写入")
                .len()
                > MAX_PACK_BYTES
        );

        let error = load_pack_items(&root, &decl("scifi", "pack.json", 0))
            .expect_err("超大内容包必须拒绝");
        assert!(error.contains("内容包过大"), "错误应说明超限：{error}");
        assert!(error.contains("上限 5MB"), "错误应给出上限：{error}");
        // 超限是拒绝，不是截断：报错文案里绝不能出现"已截断"这类说法。
        assert!(!error.contains("截断"), "超限必须拒绝而不是截断：{error}");
    }

    #[test]
    fn rejects_tags_that_are_not_strings() {
        let temp = TempDir::new("tags");
        let root = plugin_root(&temp, "tags-pack");
        write_plugin_pack(
            &root,
            "pack.json",
            &json!({
                "version": 1,
                "items": [
                    { "id": "a", "title": "t", "body": "b" },
                    // 故意塞一个数字：内容包是第三方 JSON，运行时什么都可能进来
                    { "id": "b", "title": "t", "body": "b", "tags": ["都市", 7] }
                ]
            })
            .to_string(),
        );

        let error = load_pack_items(&root, &decl("scifi", "pack.json", 0))
            .expect_err("tags 混进非字符串必须报错");
        assert!(
            error.contains("tags 必须是字符串数组"),
            "错误应说明 tags 的形状：{error}"
        );
        assert!(error.contains("第 2 条"), "错误应指出条目位置：{error}");
    }

    #[test]
    fn rejects_path_escaping_via_symlink() {
        let temp = TempDir::new("symlink");
        let root = plugin_root(&temp, "symlink-pack");
        // 插件目录**之外**放一份合法内容包：只要路径闸门失效，它就会被安静地读进来。
        let outside = temp.path().join("outside.json");
        std::fs::write(&outside, valid_pack_json()).expect("写插件目录外的包");
        let link = root.join("leak.json");

        #[cfg(windows)]
        let created = std::os::windows::fs::symlink_file(&outside, &link);
        #[cfg(unix)]
        let created = std::os::unix::fs::symlink(&outside, &link);
        #[cfg(not(any(windows, unix)))]
        let created: Result<(), std::io::Error> = Err(std::io::Error::other("当前平台不支持符号链接"));

        if let Err(error) = created {
            // Windows 上创建符号链接需要开发者模式或管理员权限：没权限就如实跳过，
            // 不把这条安全用例变成"在某些机器上必红"的噪声。
            eprintln!("跳过：本机创建符号链接需要特权（{error}）");
            return;
        }

        let error = load_pack_items(&root, &decl("scifi", "leak.json", 0))
            .expect_err("符号链接指向插件目录之外必须被拒");
        assert!(
            error.contains("越出插件目录"),
            "错误应说明路径越界：{error}"
        );
    }

    #[test]
    fn rejects_absolute_and_parent_dir_files() {
        let temp = TempDir::new("bad-path");
        let root = plugin_root(&temp, "bad-path-pack");
        std::fs::write(root.join("pack.json"), valid_pack_json()).expect("写包");

        for bad in ["../pack.json", "/etc/passwd", "content//pack.json"] {
            let error = load_pack_items(&root, &decl("scifi", bad, 0))
                .expect_err("非法路径必须被拒（不依赖清单侧的校验）");
            assert!(
                error.contains("路径非法"),
                "{bad} 应被路径闸门拒绝：{error}"
            );
        }
    }

    #[test]
    fn list_packs_skips_a_broken_pack_without_failing() {
        let temp = TempDir::new("list");
        let root = temp.path();

        let good_manifest = |plugin_id: &str, pack_id: &str, file: &str| {
            format!(
                r#"{{
                    "schema": 3,
                    "id": "{plugin_id}",
                    "name": "灵感包插件",
                    "version": "1.0.0",
                    "runtime": {{ "type": "node", "entry": "index.js" }},
                    "contributes": {{ "contentPacks": [{{
                        "id": "{pack_id}", "title": "科幻灵感包",
                        "description": "120 条设定切入点", "file": "{file}"
                    }}] }}
                }}"#
            )
        };

        // 好插件：包合法
        std::fs::write(
            plugin_root(&temp, "good-plugin").join("plugin.json"),
            good_manifest("good-plugin", "scifi", "content/inspirations.json"),
        )
        .expect("写好插件清单");
        write_plugin_pack(
            &plugin_root(&temp, "good-plugin"),
            "content/inspirations.json",
            &valid_pack_json(),
        );

        // 坏插件：包文件是坏 JSON —— 跳过它，但别让整个列表变空
        std::fs::write(
            plugin_root(&temp, "broken-plugin").join("plugin.json"),
            good_manifest("broken-plugin", "scifi", "content/inspirations.json"),
        )
        .expect("写坏插件清单");
        write_plugin_pack(
            &plugin_root(&temp, "broken-plugin"),
            "content/inspirations.json",
            "{not json",
        );

        // 停用插件：包本身完好，只是不该出现在索引里（否则"停用"在灵感库里毫无效果）
        std::fs::write(
            plugin_root(&temp, "disabled-plugin").join("plugin.json"),
            good_manifest("disabled-plugin", "scifi", "content/inspirations.json"),
        )
        .expect("写停用插件清单");
        write_plugin_pack(
            &plugin_root(&temp, "disabled-plugin"),
            "content/inspirations.json",
            &valid_pack_json(),
        );

        let mut registry = PluginRegistry::load(root).expect("空注册表可加载");
        registry.upsert(registry_entry("good-plugin", true));
        registry.upsert(registry_entry("broken-plugin", true));
        registry.upsert(registry_entry("disabled-plugin", false));
        registry.save(root).expect("保存注册表");

        let packs = list_packs(root);

        assert_eq!(packs.len(), 1, "坏包被跳过、停用插件不出现：{packs:?}");
        assert_eq!(packs[0].pack_id, "good-plugin/scifi");
        assert_eq!(packs[0].plugin_id, "good-plugin");
        assert_eq!(packs[0].plugin_name, "灵感包插件");
        assert_eq!(packs[0].id, "scifi");
        assert_eq!(packs[0].title, "科幻灵感包");
        assert_eq!(packs[0].count, 2);
    }

    /// 包级 `actions` 必须沿元信息透传到前端（设计 §4.1）。
    ///
    /// 灵感库要在「拉条目之前」就知道这个包的条目能插入正文/写项目字段/触发动作，
    /// 所以动作挂在包的元信息上，而不是等到 items 接口才给。
    #[test]
    fn list_packs_exposes_pack_actions() {
        let temp = TempDir::new("pack-actions");
        let root = temp.path();

        // 同一插件两个包：一个带条目动作，一个完全不写 actions。顺便用**没有 runtime**
        // 的纯 Tier 1 清单（D1），确认内容包索引不依赖插件有没有进程。
        let manifest = r#"{
            "schema": 3,
            "id": "idea-generator",
            "name": "脑洞生成器",
            "version": "1.0.0",
            "kind": ["declarative"],
            "contributes": { "contentPacks": [
                { "id": "scifi", "title": "科幻灵感包", "file": "content/inspirations.json",
                  "actions": [
                    { "kind": "insert-at-cursor", "label": "插入到正文" },
                    { "kind": "project-field", "field": "bookTitle", "label": "设为书名", "confirm": true }
                  ] },
                { "id": "plain", "title": "朴素包", "file": "content/plain.json" }
            ] }
        }"#;
        let plugin_dir = plugin_root(&temp, "idea-generator");
        std::fs::write(plugin_dir.join("plugin.json"), manifest).expect("写清单");
        write_plugin_pack(&plugin_dir, "content/inspirations.json", &valid_pack_json());
        write_plugin_pack(&plugin_dir, "content/plain.json", &valid_pack_json());

        let mut registry = PluginRegistry::load(root).expect("空注册表可加载");
        registry.upsert(registry_entry("idea-generator", true));
        registry.save(root).expect("保存注册表");

        let packs = list_packs(root);
        assert_eq!(packs.len(), 2, "两个包都应出现在索引里：{packs:?}");

        let scifi = packs.iter().find(|p| p.id == "scifi").expect("科幻包");
        assert_eq!(scifi.actions.len(), 2, "两个动作都要原样透传");
        assert_eq!(scifi.actions[0]["kind"], "insert-at-cursor");
        assert_eq!(scifi.actions[1]["kind"], "project-field");
        assert_eq!(scifi.actions[1]["field"], "bookTitle");
        assert_eq!(scifi.actions[1]["confirm"], true);

        let plain = packs.iter().find(|p| p.id == "plain").expect("朴素包");
        assert!(
            plain.actions.is_empty(),
            "没写 actions 的包不能凭空多出动作：{:?}",
            plain.actions
        );

        // 前端按 camelCase 消费（`meta.actions`），键名不能变成别的写法
        let value = serde_json::to_value(scifi).expect("meta 可序列化");
        assert_eq!(value["actions"][0]["kind"], "insert-at-cursor");
    }

    /// 清单没写 `slot` 时，元信息必须回填灵感库 —— 内容包的本职位置。
    ///
    /// 前端 `ContentPack.slot` 是字符串（`api.ts` 的 `toSlotPackEntry` 用它建插槽索引），
    /// 所以这里必须给默认值而不是 `null`：`null` 会让包在前端静默不挂任何插槽。
    #[test]
    fn list_packs_defaults_slot_to_inspiration_browser() {
        let temp = TempDir::new("slot-default");
        let root = temp.path();
        let manifest = r#"{
            "schema": 3,
            "id": "idea-generator",
            "name": "脑洞生成器",
            "version": "1.0.0",
            "kind": ["declarative"],
            "contributes": { "contentPacks": [
                { "id": "plain", "title": "朴素包", "file": "content/plain.json" }
            ] }
        }"#;
        let plugin_dir = plugin_root(&temp, "idea-generator");
        std::fs::write(plugin_dir.join("plugin.json"), manifest).expect("写清单");
        write_plugin_pack(&plugin_dir, "content/plain.json", &valid_pack_json());

        let mut registry = PluginRegistry::load(root).expect("空注册表可加载");
        registry.upsert(registry_entry("idea-generator", true));
        registry.save(root).expect("保存注册表");

        let packs = list_packs(root);
        assert_eq!(packs.len(), 1, "包应出现在索引里：{packs:?}");
        assert_eq!(packs[0].slot, "inspiration-browser");

        // 前端按 camelCase 读 `meta.slot`，且必须是字符串
        let value = serde_json::to_value(&packs[0]).expect("meta 可序列化");
        assert_eq!(value["slot"], "inspiration-browser");
    }

    /// 清单写了 `slot` 就原样透传（设计 §4.1 示例写的是 `inspiration-browser`，
    /// 作者也可以把包挂到别的插槽）。
    #[test]
    fn list_packs_passes_declared_slot_through() {
        let temp = TempDir::new("slot-declared");
        let root = temp.path();
        let manifest = r#"{
            "schema": 3,
            "id": "idea-generator",
            "name": "脑洞生成器",
            "version": "1.0.0",
            "kind": ["declarative"],
            "contributes": { "contentPacks": [
                { "id": "plain", "title": "朴素包", "file": "content/plain.json",
                  "slot": "chapter-toolbar" }
            ] }
        }"#;
        let plugin_dir = plugin_root(&temp, "idea-generator");
        std::fs::write(plugin_dir.join("plugin.json"), manifest).expect("写清单");
        write_plugin_pack(&plugin_dir, "content/plain.json", &valid_pack_json());

        let mut registry = PluginRegistry::load(root).expect("空注册表可加载");
        registry.upsert(registry_entry("idea-generator", true));
        registry.save(root).expect("保存注册表");

        let packs = list_packs(root);
        assert_eq!(packs.len(), 1, "包应出现在索引里：{packs:?}");
        assert_eq!(
            packs[0].slot, "chapter-toolbar",
            "声明的插槽必须原样送到前端"
        );
    }

    #[test]
    fn list_packs_returns_empty_when_the_registry_is_missing() {
        let temp = TempDir::new("list-empty");
        assert!(
            list_packs(temp.path()).is_empty(),
            "首次启动没有注册表是正常状态，必须安静返回空列表"
        );
    }

    #[test]
    fn meta_serializes_to_the_frontend_contract() {
        let meta = ContentPackMeta {
            pack_id: "idea-generator/scifi".to_string(),
            plugin_id: "idea-generator".to_string(),
            plugin_name: "脑洞生成器".to_string(),
            id: "scifi".to_string(),
            title: "科幻灵感包".to_string(),
            description: "120 条".to_string(),
            count: 120,
            slot: "inspiration-browser".to_string(),
            actions: Vec::new(),
        };
        let value = serde_json::to_value(&meta).expect("meta 可序列化");
        assert_eq!(value["packId"], "idea-generator/scifi");
        assert_eq!(value["pluginId"], "idea-generator");
        assert_eq!(value["pluginName"], "脑洞生成器");
        assert_eq!(value["count"], 120);
        assert!(value.get("pack_id").is_none(), "前端按 camelCase 消费");
    }

    #[test]
    fn cache_serves_hits_and_invalidate_drops_only_that_plugin() {
        let temp = TempDir::new("cache");
        let mine = plugin_root(&temp, "cache-plugin");
        let other = plugin_root(&temp, "other-plugin");
        let pack = decl("scifi", "pack.json", 0);
        write_plugin_pack(&mine, "pack.json", &valid_pack_json());
        write_plugin_pack(&other, "pack.json", &valid_pack_json());

        assert_eq!(
            cached_pack_items(&mine, "cache-plugin", &pack)
                .expect("首次读取")
                .len(),
            2
        );
        assert_eq!(
            cached_pack_items(&other, "other-plugin", &pack)
                .expect("别的插件的包")
                .len(),
            2
        );

        // 改盘上的文件：命中缓存时必须还是旧值（这才是"真的缓存了"）。
        write_plugin_pack(&mine, "pack.json", &json!({"version":1,"items":[]}).to_string());
        assert_eq!(
            cached_pack_items(&mine, "cache-plugin", &pack)
                .expect("命中缓存")
                .len(),
            2,
            "缓存命中时不该重新读盘"
        );

        invalidate("cache-plugin");
        assert!(
            cached_pack_items(&mine, "cache-plugin", &pack)
                .expect("失效后重读")
                .is_empty(),
            "停用/卸载后必须重新读盘（否则已删除的内容还能从内存里被读出来）"
        );
        assert_eq!(
            cached_pack_items(&other, "other-plugin", &pack)
                .expect("别的插件不受影响")
                .len(),
            2,
            "失效只清本插件的 key"
        );
    }

    /// 注册表条目（只为 list_packs 造数据，字段值与用例无关）。
    fn registry_entry(id: &str, enabled: bool) -> super::super::registry::RegistryEntry {
        super::super::registry::RegistryEntry {
            id: id.to_string(),
            version: "1.0.0".to_string(),
            enabled,
            granted_permissions: vec![],
            source: super::super::registry::SourceRecord {
                repo: "local:test".to_string(),
                git_ref: "local".to_string(),
                commit: "local".to_string(),
                zip_sha256: "0".repeat(64),
                installed_at: "2026-01-01T00:00:00Z".to_string(),
            },
        }
    }
}
