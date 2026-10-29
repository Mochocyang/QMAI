//! `plugin.json` 清单契约：结构体 + 字段校验。
//!
//! 本模块只做「字符串 → 结构体」的解析与静态校验，**不碰任何 IO / 进程 / 网络**。
//! 路径归一化（canonical 前缀检查）属于安装器的职责，这里只做纯字符串层面的
//! 「相对路径、无 `..`」判断，因为清单可能来自尚未落盘的 zip 包。

use serde::{Deserialize, Serialize};

/// 运行时类型。serde 层只认小写三个值；其他值由 `parse` 单独兜底，
/// 以便给出契约里的 `E_RUNTIME_INVALID` 而不是笼统的 `E_JSON_INVALID`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeType {
    Node,
    Python,
    Binary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginRuntime {
    #[serde(rename = "type")]
    pub entry_type: RuntimeType,
    pub entry: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// 默认常驻：第一期绝大多数插件都是服务型，反复冷启动代价高。
    #[serde(default = "default_true", rename = "keepAlive")]
    pub keep_alive: bool,
    #[serde(default = "default_timeout", rename = "startTimeoutMs")]
    pub start_timeout_ms: u64,
}

fn default_true() -> bool {
    true
}

fn default_timeout() -> u64 {
    10_000
}

/// 声明式工具参数（JSON Schema 的极简子集），只用于生成给模型的工具描述。
///
/// 这里**故意不开** `deny_unknown_fields`：真实 MCP 工具的 inputSchema 会带
/// `properties` / `items` / `default` / `pattern` 等合法关键字，开了会让合法清单集体装不上。
/// （`tool_parameters_stay_open_to_json_schema_keywords` 就是这条的护栏，别顺手「统一」掉。）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolParam {
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub r#enum: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolDecl {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// 用 BTreeMap 而不是 HashMap：注入宿主时参数顺序要稳定，避免提示词抖动。
    #[serde(default)]
    pub parameters: std::collections::BTreeMap<String, ToolParam>,
}

/// 插件如何取得上游凭证。v2.0 只接受并校验，只有 `none` 是本期真正可用的分支。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthKind {
    /// 不需要登录（例如转发到用户本机的推理端点）
    None,
    /// 插件自托管登录页，由宿主用受控窗口打开（v2.1）
    BrowserLogin,
    /// 用户粘贴令牌（v2.1）
    PasteToken,
    /// 从文件导入凭证（v2.1）
    ImportFile,
}

/// 插件充当模型供应商的声明（v2 / schema 2）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderDecl {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "authKind")]
    pub auth_kind: AuthKind,
    /// 插件自托管的登录/设置页路径（如 "/login"）。v2.0 只校验不打开。
    #[serde(default, rename = "settingsPagePath")]
    pub settings_page_path: Option<String>,
    /// 受控登录窗口的导航白名单（主机后缀）。v2.1 才真正使用。
    #[serde(default, rename = "authDomains")]
    pub auth_domains: Vec<String>,
    /// 可选能力位：models.refresh / balance.query / checkin
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Contributes {
    #[serde(default)]
    pub tools: Vec<ToolDecl>,
    #[serde(default)]
    pub stages: Vec<String>,
    /// 第一期解析但不渲染（界面插件不在范围内，先接受字段以免未来清单改版）
    #[serde(default)]
    pub panels: Vec<serde_json::Value>,
    /// 插件充当模型供应商（schema 2 起）
    #[serde(default)]
    pub providers: Vec<ProviderDecl>,
    /// v3 · Tier 1 灵感素材包（schema 3 起）。内容由宿主读、宿主渲染，不跑插件代码。
    #[serde(default, rename = "contentPacks")]
    pub content_packs: Vec<ContentPackDecl>,
    /// v3 · Tier 1 声明式动作：表单 + 提示词 + 输出映射，作者一行代码不写。
    #[serde(default)]
    pub actions: Vec<ActionDecl>,
    /// v3 · 钩子声明。
    ///
    /// 与 `panels` / 内容包的 `actions` 不同，这里**不能收成裸 `Value`**：钩子会被宿主
    /// 按 `on` / `priority` 排序后逐个执行，字段名或类型写错（`timeoutMs: "5s"`、把
    /// `on` 拼成 `afterLLMResponse`）在宿主侧就是一个静默不触发的钩子 —— 作者永远看不到
    /// 报错，只会觉得「插件装了但没生效」。所以在解析期就把它收成结构体 + 白名单。
    #[serde(default)]
    pub hooks: Vec<HookDecl>,
}

/// 一个灵感内容包的声明（设计 §4.1）。
///
/// `file` 是相对插件根的路径，内容会被宿主读进界面 —— 路径必须能在解析期就判定安全，
/// 否则一份清单就能让宿主去读插件目录之外的任意 JSON。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContentPackDecl {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub file: String,
    /// 条数上限（设计 D4：单包 5000 条）。缺省 5000，防止作者漏写后宿主被超大包卡住。
    #[serde(default = "default_max_items", rename = "maxItems")]
    pub max_items: usize,
    /// 该内容包挂到哪个插槽（设计 §4.1：决定它在界面哪里出现）。
    ///
    /// 缺省视为 `inspiration-browser`（内容包的本职位置，回填在
    /// `content::list_packs` 里），所以老插件不写也不受影响。
    #[serde(default)]
    pub slot: Option<String>,
    /// 该包的条目上可用动作：`insert-at-cursor` / `project-field` / `run-action`（设计 §4.1）。
    ///
    /// 存成裸 `Value` 而不是结构体、**不做任何内部校验**：动作的真源是前端
    /// `declarative/api.ts` 的 `normalizeTargets` + `CONTENT_ITEM_TARGET_KINDS` 白名单。
    /// 宿主再养一份平行 schema，只会变成「宿主放过、界面报错」的两份规则。
    #[serde(default)]
    pub actions: Vec<serde_json::Value>,
}

fn default_max_items() -> usize {
    5000
}

/// 声明式动作的提示词模板（`{{变量}}` 由前端插值，宿主只校验非空）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PromptDecl {
    pub system: String,
    pub user: String,
}

/// 一个声明式动作（设计 §3.1）。`form` / `output` / `limits` 原样透传给前端：
/// 它们的形状由声明式引擎（TS 侧）负责，Rust 侧不该为它再养一份平行 schema。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionDecl {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub slot: Option<String>,
    #[serde(default)]
    pub form: Option<serde_json::Value>,
    pub prompt: PromptDecl,
    pub output: serde_json::Value,
    #[serde(default)]
    pub limits: Option<serde_json::Value>,
    /// 模型选择策略（设计 §3.1）：`{"strategy": "current"}` / `{"minContextTokens": N}`。
    ///
    /// 与 `form` / `output` / `limits` 同一条理由：形状归前端的声明式引擎，宿主原样透传。
    /// 在这里做成结构体，等于让「前端新增一种策略」必须先发一版 Rust。
    #[serde(default)]
    pub model: Option<serde_json::Value>,
}

/// 一个钩子的实现方式（设计 D5）。
///
/// - `Prompt`：**声明式**。宿主把 `template` 里的变量替换掉、再调一次模型，
///   作者一行代码不写。80% 的钩子（去 AI 味、格式规整、提示词注入）都属于这类。
/// - `Process`：**代码型**。宿主通过 MCP 调插件声明的 `tool`，只有真正复杂的
///   文本处理才需要升级到这里。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HookImpl {
    Prompt,
    Process,
}

/// 一个钩子声明（设计 §5.1 / D5 / D6 / D7）。
///
/// 字段为什么这么少：钩子的全部语义就是「在哪个事件的哪个时机、用什么方式、插到
/// 多前面、最多等多久、失败了算不算数」。多一个字段就等于多一条要跨版本兼容的契约，
/// 而这条契约没有作者会去读第二遍。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HookDecl {
    /// 事件名，必须在 `HOOK_EVENTS` 白名单内
    pub on: String,
    /// `prompt` = 声明式（宿主用模板再调一次模型）；`process` = 代码型（调插件工具）
    #[serde(rename = "impl")]
    pub impl_kind: HookImpl,
    /// impl=prompt 时必需：模板，可含 `{{text}}` / `{{config.*}}` / `{{project.*}}` 等变量
    #[serde(default)]
    pub template: Option<String>,
    /// impl=process 时必需：要调用的插件工具名
    #[serde(default)]
    pub tool: Option<String>,
    /// 同事件多插件的执行顺序，小的先跑；默认 0
    ///
    /// 默认 0 而不是「按安装顺序」：安装顺序取决于用户什么时候装了哪个插件，
    /// 同一份清单在两台机器上会得到不同的提示词改写顺序 —— 那种 bug 无法复现（D7）。
    #[serde(default)]
    pub priority: i32,
    /// 本钩子的超时预算；缺省按事件类型的默认值（唯一真源是前端
    /// `HOOK_DEFAULT_TIMEOUT_MS`，Rust 侧只校验上界）。
    ///
    /// 为什么允许覆盖：默认值是按「事件类型」定的（请求前后 8s / 工作流 15s /
    /// 观测 2s），但同一组里也有快慢之分 —— 一个只做正则替换的 `afterLlmResponse`
    /// 不该占用 8s 预算，一个要跑整章一致性检查的 `beforeReview` 又不够 15s。
    #[serde(default, rename = "timeoutMs")]
    pub timeout_ms: Option<u64>,
    /// 仅当为 true 时，超时/报错按 **fail-closed** 处理（视为"未通过"，阻止流程）。
    /// 默认 false（fail-open：出错就跳过这个钩子，用原值继续）。
    ///
    /// 为什么不一律 fail-closed（设计 D6）：QMAI 的写作流程是**用户主动触发**的，
    /// 一个卡住或写坏的第三方插件不该让作者连章节都写不出来。超时预算再准，
    /// 也只能保证宿主自己不等 —— 它不能保证插件在预算内给出正确答案。所以默认
    /// fail-open，只有作者明确知道"这个钩子是门禁"时才 opt-in：
    /// 门禁语义是**作者对用户的承诺**，不该由宿主替他做默认决定。
    #[serde(default)]
    pub gate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Requires {
    #[serde(default)]
    pub qmai: Option<String>,
}

/// 作者信息。设计文档 4.1 的示例里有这一块，结构体必须接住，
/// 否则加上 `deny_unknown_fields` 后会把文档认可的清单判成非法。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Author {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginManifest {
    pub schema: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    // 设计文档 4.1 示例里就有这三个，结构体必须接住，否则 deny_unknown_fields 会误伤文档认可的清单
    #[serde(default)]
    pub author: Option<Author>,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub requires: Option<Requires>,
    /// 运行时入口。**纯声明式插件不需要**（Tier 1 不启进程，设计 D1）。
    ///
    /// 可选不是「宽松」而是「分层」：灵感包 / 声明式动作 / 钩子都由宿主读、宿主渲染，
    /// 装 20 个这类插件时进程表里就该是 0 条。但只要有需要执行的贡献
    /// （tools / providers / `impl: "process"` 的 hook），`runtime` 就必须存在 ——
    /// 那条规则由 `validate` 以 `E_RUNTIME_REQUIRED` 强制，所以
    /// `runtime.is_some()` 与「这个插件需要进程」是同一个判断。
    #[serde(default)]
    pub runtime: Option<PluginRuntime>,
    /// 本包声明用到的层级。目前唯一有语义的值是 `"declarative"`（纯声明式，不启进程）。
    ///
    /// 未知值**忽略并在日志里 warn**（`eprintln!`），不报错、也不参与其它校验：
    /// 层级名会随宿主能力增长，老宿主若因为一个自己不认识的层级名就拒装整个包，
    /// 作者就没法用一份清单兼容多代宿主 —— 而多出来一个不认识的 `kind` 对老宿主
    /// 本来也无害（它只是不认识，不会误执行）。
    #[serde(default)]
    pub kind: Vec<String>,
    #[serde(default)]
    pub inject: Vec<String>,
    #[serde(default)]
    pub contributes: Contributes,
    #[serde(default)]
    pub permissions: Vec<String>,
    /// 设计文档 8.2 第 6 步：安装完成后是否随 App 启动。
    /// 缺省 false —— 用户没点过「启用」前，不该拉起任何第三方进程。
    #[serde(default, rename = "autoStart")]
    pub auto_start: bool,
    /// v3 · 配置的 JSON Schema 子集（设计 §6.3）。存成裸 `Value` 而不是结构体：
    /// 关键字集合会随宿主能力增长，用结构体接会把「我们还没实现的关键字」判成非法。
    #[serde(default, rename = "configSchema")]
    pub config_schema: Option<serde_json::Value>,
    /// v3 · 免执行发现（设计 §8）：**只用于展示**，调用真源仍是运行期。
    #[serde(default)]
    pub preview: Option<serde_json::Value>,
    /// v3 · 本插件要占用的插槽（设计 §6.1）。
    #[serde(default)]
    pub slots: Vec<String>,
    /// v3 · 插槽 → 依赖的插槽 API 版本（设计 D8）。
    /// 用 HashMap 是因为它是查表用的；无序不影响契约（校验只看 key/值，不做有序输出）。
    #[serde(default, rename = "requiresSlot")]
    pub requires_slot: std::collections::HashMap<String, u32>,
}

/// 校验失败：`code` 是暴露给前端的稳定错误码，`detail` 只用于日志与排障。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestError {
    pub code: &'static str,
    pub detail: String,
}

impl ManifestError {
    pub fn code(&self) -> &'static str {
        self.code
    }

    fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

/// 当前支持的最高清单版本。新增字段必须 bump 它（见设计文档 4.2 的封闭契约规则）。
///
/// v3 起：`contentPacks` / `actions` / `hooks` / `configSchema` / `slots` / `requiresSlot`
/// / `preview` 才允许出现（v3 字段出现在 schema 1/2 上由 `validate` 拒掉，
/// 因为老宿主会静默丢掉它们，作者却以为已经生效）。schema 1/2 的清单仍然全部接受。
pub const CURRENT_SCHEMA: u32 = 3;

/// v3 引入的新贡献面所需的最低清单版本。单独取名而不是到处写 `3`：
/// 这条闸门与 `CURRENT_SCHEMA` 是两个概念（后者还会继续涨，闸门不会动）。
const V3_SCHEMA: u32 = 3;

/// 宿主认识的分层名（设计 §2.1）。目前只有 `declarative` 有语义：纯声明式，不启进程。
///
/// **这是 warn 的白名单，不是拒装的闸门** —— 未知值只忽略（见 `warn_unknown_kinds`）。
const KNOWN_KINDS: &[&str] = &["declarative"];

/// 钩子事件白名单（**受控资源**，新增需评审）。设计 §5.1。
///
/// 为什么是白名单而不是「任意字符串 + 宿主不认识就忽略」：事件名是宿主与插件之间
/// 唯一的触发协议，宿主**没有办法**替一个自己不认识的事件名做任何事 —— 它既不会
/// 在那个时机被调用，也不会报错。作者写错一个字母（`afterLLMResponse` vs
/// `afterLlmResponse`）得到的是一份「装得上、永远不触发」的插件，而这恰恰是最难
/// 排查的一类问题。白名单把它变成安装期的一条明确报错。
///
/// 反过来，新增事件的成本也在这里：一个事件名发布出去就成了永远不能改的公开契约
/// （插件清单里写死它），而且每加一个事件就多一个宿主必须真的去调用的接缝 ——
/// 声明了却不调用的钩子比没有更糟。所以是受控资源，不是随手加。
///
/// 默认超时不在这里：它由前端 dispatcher 持有（`HOOK_DEFAULT_TIMEOUT_MS`，唯一真源）。
/// 宿主只负责校验上界 `MAX_HOOK_TIMEOUT_MS`。早先 Rust 侧也有
/// 一份 per-event 毫秒表，但从未被生产代码消费，已删以免两处漂移。
pub const HOOK_EVENTS: &[&str] = &[
    // 请求前 / 响应后：模型增强（注入系统提示词、去 AI 味、格式规整）
    "beforeLlmRequest",
    "afterLlmResponse",
    // 工作流：起草 / 审稿 / 润色 各自的进出门
    "beforeChapterDraft",
    "afterChapterDraft",
    "beforeReview",
    "afterReview",
    "beforePolish",
    "afterPolish",
    // 观测：纯通知（用量、成本、章节完成）
    "onLlmUsage",
    "onChapterCompleted",
];

/// 单个钩子超时的上限。超过它就说明作者在用一个钩子做整章重写 ——
/// 那该是声明式 action（有进度、可取消），而不是挂在一个必经过的接缝上。
pub const MAX_HOOK_TIMEOUT_MS: u64 = 120_000;

/// 事件是否在 `HOOK_EVENTS` 白名单内。
fn is_known_hook_event(event: &str) -> bool {
    HOOK_EVENTS.contains(&event)
}

/// `E_HOOK_EVENT_UNKNOWN` 的 detail 里要列出的合法事件名。
///
/// 从 `HOOK_EVENTS` 现算而不是另写一份字面量：手抄的清单迟早和新事件表对不上，
/// 而这条 detail 正是作者修清单时唯一会看的东西。
fn hook_event_names() -> String {
    HOOK_EVENTS.join(" / ")
}

/// 宿主对外暴露的插槽（设计 §6.1）。**受控资源**：新增需评审并 bump 版本。
///
/// 插槽是宿主与插件之间最脆弱的耦合面：名字改一个字符，线上插件的按钮就静默消失。
/// 所以这里是白名单而不是「任意字符串 + 前端自己忽略」。
pub const SLOT_IDS: &[&str] = &[
    "chapter-toolbar",
    "inspiration-browser",
    "editor-context-menu",
    "outline-toolbar",
    "analysis-toolbar",
    "plugin-center",
];

/// `E_SLOT_UNKNOWN` 的 detail 里要列出的合法插槽名。
///
/// 与 `hook_event_names` 同一条理由：从 `SLOT_IDS` 现算，别手抄第二份清单 ——
/// 插槽白名单是受控资源，手抄的副本迟早与它分叉，而这条 detail 正是作者修清单时
/// 唯一会看的东西。
fn slot_names() -> String {
    SLOT_IDS.join(" / ")
}

/// 每个插槽当前的 API 版本（设计 D8）。插槽语义变了就 bump 这里的值，
/// 老插件按 `requiresSlot` 里声明的版本继续渲染或提示升级。
pub const SLOT_API_VERSIONS: &[(&str, u32)] = &[
    ("chapter-toolbar", 1),
    ("inspiration-browser", 1),
    ("editor-context-menu", 1),
    ("outline-toolbar", 1),
    ("analysis-toolbar", 1),
    ("plugin-center", 1),
];

/// 插槽当前支持的 API 版本。未知插槽返回 0：调用方（`validate`）已经在
/// key 校验阶段拒过未知插槽，这里只需不 panic。
fn slot_api_version(slot: &str) -> u32 {
    SLOT_API_VERSIONS
        .iter()
        .find(|(id, _)| *id == slot)
        .map(|(_, version)| *version)
        .unwrap_or(0)
}

/// 宿主暴露给插件的服务名白名单（第一期只开这两个）
pub const KNOWN_INJECT: &[&str] = &["host.qmai.tools", "host.logger"];
/// 需用户逐项勾选的权限（设计文档 6.2 的「需用户勾选」行）。
///
/// `net:listen` 专门放在这里：它会请求宿主为插件开一个本机端口，属于用户必须
/// 知情并显式同意的能力，不能走自动授予。
pub const KNOWN_PERMISSIONS: &[&str] = &[
    "fs:project-read",
    "fs:project-write",
    "net:https",
    "llm:use",
    "net:listen",
];

/// 宿主自动授予的权限：允许在清单里声明（旧文档/示例就是这么写的），但声明与否都不改变
/// 授予结果，也永远不进「需用户勾选」列表。别把它并进 KNOWN_PERMISSIONS —— 那会让
/// 任务 10 的权限弹窗把它当成需要用户同意的权限。
///
/// `net:listen` **故意不在这里**：它会让宿主在 `127.0.0.1` 上给插件开端口，
/// 属于必须由用户逐项勾选的能力（见 `KNOWN_PERMISSIONS`），自动授予等于绕过知情同意。
pub const AUTO_GRANTED_PERMISSIONS: &[&str] = &["data:write"];

/// 内置 provider id（来自 src/components/settings/llm-presets.ts 的 LlmProviderId 联合）。
/// 插件 provider 不得与之冲突：模型复合键是 `providerId/modelId`，
/// 同名会让用户在选择器里无法分辨数据流向了谁。
pub const BUILTIN_PROVIDER_IDS: &[&str] = &[
    "openai",
    "anthropic",
    "google",
    "azure",
    "ollama",
    "custom",
    "minimax",
    "claude-code",
    "codex-cli",
    "cursor-cli",
    "antigravity-cli",
    "workbuddy",
];

/// 允许声明的 provider 能力位
pub const KNOWN_PROVIDER_CAPABILITIES: &[&str] = &["models.refresh", "balance.query", "checkin"];

/// 「可以在清单里写」的权限 = 需勾选的 + 自动授予的。写错成别的（如 `ui:panel`）才拒。
fn is_declarable_permission(perm: &str) -> bool {
    KNOWN_PERMISSIONS.contains(&perm) || AUTO_GRANTED_PERMISSIONS.contains(&perm)
}

/// id 会直接当目录名用（`<root>/<id>`），所以收紧到「小写字母数字连字符」，
/// 避免大小写不敏感文件系统上的重名覆盖，也避免空格等需要转义的字符。
pub fn is_valid_id(id: &str) -> bool {
    let len = id.chars().count();
    if !(2..=64).contains(&len) {
        return false;
    }
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// 只接受完整三段式 `x.y.z`（纯数字）。预发布/构建元数据第一期不支持：
/// 宿主只做「版本展示 + 是否可升级」的粗比较，收窄格式比日后放宽更安全。
fn is_valid_semver(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// entry 是从插件目录起算的相对路径。这里先做纯字符串层面的一票否决
/// （绝对路径 / 含 `..` 段），canonical 前缀检查留给安装器，因为此时清单
/// 可能还没落盘，无法 canonical。
fn is_safe_relative(entry: &str) -> bool {
    if entry.trim().is_empty() {
        return false;
    }
    // 清单里的字符串最终会当路径用：NUL 会让所有 fs 调用返回 InvalidInput；
    // 首尾空白在 Windows 上指向另一个文件名。都该在解析期拒掉。
    if entry.chars().any(char::is_control) || entry != entry.trim() {
        return false;
    }
    // 末尾带分隔符说明作者写的是目录，不是入口文件。
    if entry.ends_with('/') || entry.ends_with('\\') {
        return false;
    }
    let path = std::path::Path::new(entry);
    // Windows 上 `/etc/passwd` 的 is_absolute() 为 false（只有根没有前缀），
    // 所以分隔符开头单独判一次，保证跨平台语义一致。
    if path.is_absolute()
        || entry.starts_with('/')
        || entry.starts_with('\\')
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::Prefix(_)))
    {
        return false;
    }
    // `/` 和 `\` 都要切：清单作者可能在 Windows 上写反斜杠，只用 split('/')
    // 会把 `..\..\evil.js` 当成单个安全段放过。
    let segs: Vec<&str> = entry.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
    // 最后一段必须是真文件名：`.` / `sub/` 这种目录值装上之后才在 spawn 时炸，
    // 报错位置离作者写的字段很远。
    match segs.last() {
        Some(last) if *last != "." && *last != ".." => {}
        _ => return false,
    }
    !segs.iter().any(|s| *s == "..")
}

/// 工具名注入宿主时会加 `<pluginId>__` 前缀，插件内部只允许下划线风格，
/// 以免和内置工具的命名习惯冲突、也避免模型看到混合风格的名字。
fn is_valid_tool_name(name: &str) -> bool {
    let len = name.chars().count();
    if !(3..=64).contains(&len) {
        return false;
    }
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// providerId 会拼进模型复合键 `providerId/modelId`，前端用第一个 `/` 切分。
/// 字符集本身已排除 `/`，这里仍单独判一次：D1 把「不含斜杠」列为硬约束，
/// 将来放宽字符集时不能把这条一起丢掉。
fn is_valid_provider_id(id: &str) -> bool {
    if id.contains('/') {
        return false;
    }
    let len = id.chars().count();
    if !(2..=32).contains(&len) {
        return false;
    }
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// 内容包 / 动作的 id 规则（设计 §4.1 / §3.1）：`^[a-z][a-z0-9-]{0,31}$`。
///
/// 它们会被前端拿去当 DOM key、按钮 id、URL 查询参数用。放开成任意字符串
/// 会让「两个作者各写一个 `API Key`」在同一个插槽里撞成同一个 key。
fn is_valid_content_pack_id(id: &str) -> bool {
    let len = id.chars().count();
    if !(1..=32).contains(&len) {
        return false;
    }
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// 内容包文件路径（相对插件根，允许 `content/x.json` 这种子路径）。
///
/// 与 `is_safe_relative`（入口文件）分开写，因为这里更严：反斜杠也拒。
/// 内容包随包分发，zip 里统一用 `/`，允许反斜杠只会让 Windows 上的作者写出
/// 只有自己机器能读的清单。
fn is_safe_content_file(file: &str) -> bool {
    if file.trim().is_empty() || file != file.trim() {
        return false;
    }
    if file.chars().any(char::is_control) {
        return false;
    }
    // 白名单字符：字母数字 + `-` `_` `.` `/`。这同时排掉了绝对路径（`/x` 与 `C:/x`）、
    // 反斜杠、冒号、`~`、空格与通配符，比逐条黑名单更难漏。
    if !file
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
    {
        return false;
    }
    if file.starts_with('/') {
        return false;
    }
    let segments: Vec<&str> = file.split('/').collect();
    // 空段（`a//b`、`a/`）与 `.`/`..` 段一律拒：前者是拼写错误，后者能跳目录。
    !segments
        .iter()
        .any(|segment| segment.is_empty() || *segment == "." || *segment == "..")
}

/// 设置页由插件自己托管在 `127.0.0.1:<port>` 上，所以只接受站内绝对路径。
/// 绝对 URL 会把受控窗口带到外部站点；`..` 能跳出插件端点根。
fn is_valid_settings_page_path(path: &str) -> bool {
    path.starts_with('/') && !path.contains("..") && !path.contains("://")
}

/// `authDomains` 是受控登录窗口的导航白名单（设计 5.2），一旦有洞，
/// 插件就能把窗口变成任意浏览器看到用户的输入，所以这里宁严勿宽。
fn is_valid_auth_domain(domain: &str) -> bool {
    let d = domain.trim();
    if d.is_empty() || d.contains('*') || d.contains("://") || d.contains('/') {
        return false;
    }
    // 裸后缀（".qoder.com"）会让匹配逻辑含糊，必须写成完整后缀
    if d.starts_with('.') || d.ends_with('.') {
        return false;
    }
    if d.eq_ignore_ascii_case("localhost") {
        return false;
    }
    // IP 一律拒：登录窗口只应该去域名
    if d.parse::<std::net::IpAddr>().is_ok() {
        return false;
    }
    // 至少一个点，允许字母/数字/连字符/点
    d.contains('.') && d.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
}

/// 白名单外的 `kind` 只 warn、不进 `ManifestError`（设计 §2.1）。
///
/// 为什么是忽略而不是报错：`kind` 表达的是「本包用到了哪一代能力」，宿主本就该
/// **按自己认识的部分工作**。把不认识的层级名判成非法，会让今天发布的插件在明天
/// 加了一个新层级名之后连老宿主都装不上 —— 而它多出来的那部分对老宿主完全无害。
fn warn_unknown_kinds(kinds: &[String]) {
    for kind in kinds {
        if !KNOWN_KINDS.contains(&kind.as_str()) {
            eprintln!(
                "[plugins] 忽略未知的清单层级 kind = {kind:?}（宿主只认识 {KNOWN_KINDS:?}）"
            );
        }
    }
}

impl PluginManifest {
    /// 清单里是否声明了「宿主要真的去执行」的贡献。
    ///
    /// 这三类都必须有进程或钩子执行器才可能生效：工具与 provider 走 MCP stdio 子进程，
    /// `impl: "process"` 的钩子是插件自己的代码。其余贡献面（内容包、声明式动作、
    /// `impl: "prompt"` 的钩子）全是「宿主读数据 + 宿主渲染」，不需要插件代码。
    fn needs_runtime(&self) -> bool {
        !self.contributes.tools.is_empty()
            || !self.contributes.providers.is_empty()
            || self
                .contributes
                .hooks
                .iter()
                .any(|hook| hook.impl_kind == HookImpl::Process)
    }

    /// 解析 + 校验。字段级错误返回第一个命中的错误码。
    pub fn parse(raw: &str) -> Result<Self, ManifestError> {
        let value: serde_json::Value = serde_json::from_str(raw)
            .map_err(|e| ManifestError::new("E_JSON_INVALID", e.to_string()))?;
        // enum 字段先单独校验：直接反序列化会把未知值折叠成 E_JSON_INVALID，
        // 而契约里 runtime.type 的非法值有自己的错误码。
        if let Some(t) = value
            .get("runtime")
            .and_then(|r| r.get("type"))
            .and_then(|t| t.as_str())
        {
            if !matches!(t, "node" | "python" | "binary") {
                return Err(ManifestError::new("E_RUNTIME_INVALID", t.to_string()));
            }
        }
        // 与 runtime.type 同理：provider 的 authKind 有自己的错误码，
        // 直接反序列化会被折叠成 E_JSON_INVALID，作者看不出是哪一项写错了。
        if let Some(providers) = value
            .get("contributes")
            .and_then(|c| c.get("providers"))
            .and_then(|p| p.as_array())
        {
            for provider in providers {
                if let Some(kind) = provider.get("authKind").and_then(|k| k.as_str()) {
                    if !matches!(kind, "none" | "browser-login" | "paste-token" | "import-file") {
                        return Err(ManifestError::new("E_AUTH_KIND_INVALID", kind.to_string()));
                    }
                }
            }
        }
        let m: PluginManifest = serde_json::from_value(value)
            .map_err(|e| ManifestError::new("E_JSON_INVALID", e.to_string()))?;
        m.validate()?;
        Ok(m)
    }

    /// 字段级校验。顺序即优先级：越基础、越容易一次修对的错误越先报，
    /// 这样作者改清单时一次只看到一个问题，而不是级联报错。
    fn validate(&self) -> Result<(), ManifestError> {
        if !(1..=CURRENT_SCHEMA).contains(&self.schema) {
            return Err(ManifestError::new(
                "E_SCHEMA_UNSUPPORTED",
                self.schema.to_string(),
            ));
        }
        if !is_valid_id(&self.id) {
            return Err(ManifestError::new("E_ID_INVALID", self.id.clone()));
        }
        if self.name.trim().is_empty() || self.name.chars().count() > 64 {
            return Err(ManifestError::new("E_NAME_INVALID", self.name.clone()));
        }
        // `kind` 只在这里 warn、不拒：白名单外的值对老宿主无害（它只是不认识），
        // 拒装反而让「一份清单兼容多代宿主」这条路断掉。放在最前面，是为了让
        // 清单即使别处还有错，作者也能先看到这条提示。
        warn_unknown_kinds(&self.kind);
        if !is_valid_semver(&self.version) {
            return Err(ManifestError::new(
                "E_VERSION_INVALID",
                self.version.clone(),
            ));
        }
        // 分层规则（设计 D1）：需要宿主动手执行点东西的贡献，必须有 runtime。
        // 反过来说，只要没这条错误，`runtime == None` 就等价于「纯 Tier 1」——
        // `start_plugin` / `plugins_enable` / `plugins_list` 全都靠这个等价关系决策。
        if self.runtime.is_none() && self.needs_runtime() {
            return Err(ManifestError::new(
                "E_RUNTIME_REQUIRED",
                "声明了需要执行的贡献（tools / providers / impl=process 的 hook），必须提供 runtime",
            ));
        }
        // 运行时字段的校验只对「确实有 runtime」的清单成立：纯声明式清单没有 entry，
        // 也没有 startTimeoutMs，拿缺省值去判等于凭空造一个必须填的字段。
        if let Some(runtime) = &self.runtime {
            if !is_safe_relative(&runtime.entry) {
                return Err(ManifestError::new("E_ENTRY_INVALID", runtime.entry.clone()));
            }
            // 下限 1s 防止插件作者把超时设成 0 导致永不等待；上限 60s 防止
            // 一个坏插件把宿主启动流程拖死。
            if !(1_000..=60_000).contains(&runtime.start_timeout_ms) {
                return Err(ManifestError::new(
                    "E_START_TIMEOUT_INVALID",
                    runtime.start_timeout_ms.to_string(),
                ));
            }
        }
        for svc in &self.inject {
            if !KNOWN_INJECT.contains(&svc.as_str()) {
                return Err(ManifestError::new("E_INJECT_UNKNOWN", svc.clone()));
            }
        }
        for perm in &self.permissions {
            if !is_declarable_permission(perm) {
                return Err(ManifestError::new("E_PERMISSION_UNKNOWN", perm.clone()));
            }
        }
        let mut seen = std::collections::HashSet::new();
        for tool in &self.contributes.tools {
            if !is_valid_tool_name(&tool.name) {
                return Err(ManifestError::new("E_TOOL_NAME_INVALID", tool.name.clone()));
            }
            if !seen.insert(tool.name.as_str()) {
                // 注入 ToolRegistry 是 Map.set：同名后写覆盖先写，作者会以为两个工具都在。
                return Err(ManifestError::new(
                    "E_TOOL_NAME_INVALID",
                    format!("{} (duplicate)", tool.name),
                ));
            }
        }

        // provider 声明：先校验身份字段，再校验跨条规则，最后才看可选能力/登录配置。
        // 这样作者一次只看到一个需要修的问题（与文件顶部注释的顺序原则一致）。
        let providers = &self.contributes.providers;
        if self.schema == 1 && !providers.is_empty() {
            // v1 宿主会拒绝 schema 2；反过来 schema 1 清单声明 providers 只会得到
            // 一个永远不出现在模型列表里的插件，必须在安装期就拒。
            return Err(ManifestError::new(
                "E_PROVIDER_REQUIRES_SCHEMA_2",
                providers[0].id.clone(),
            ));
        }
        let mut seen_providers = std::collections::HashSet::new();
        for provider in providers {
            if !is_valid_provider_id(&provider.id) {
                return Err(ManifestError::new(
                    "E_PROVIDER_ID_INVALID",
                    provider.id.clone(),
                ));
            }
            if BUILTIN_PROVIDER_IDS.contains(&provider.id.as_str()) {
                return Err(ManifestError::new(
                    "E_PROVIDER_ID_CONFLICT",
                    provider.id.clone(),
                ));
            }
            if !seen_providers.insert(provider.id.as_str()) {
                // 与内置冲突同理：同一个 providerId 出现两次，前端按 id 建索引时后者覆盖前者。
                return Err(ManifestError::new(
                    "E_PROVIDER_ID_CONFLICT",
                    format!("{} (duplicate)", provider.id),
                ));
            }
            if provider.name.trim().is_empty() || provider.name.chars().count() > 64 {
                return Err(ManifestError::new(
                    "E_PROVIDER_NAME_INVALID",
                    provider.name.clone(),
                ));
            }
        }
        if !providers.is_empty() && !self.permissions.iter().any(|p| p == "net:listen") {
            // D4：端口由宿主分配、插件只绑 127.0.0.1。没有 net:listen 就声明 providers，
            // 会得到「声明了却绑不了端口」的诡异状态。
            return Err(ManifestError::new(
                "E_PROVIDER_REQUIRES_NET_LISTEN",
                "providers 声明了但没有 net:listen 权限",
            ));
        }
        for provider in providers {
            for capability in &provider.capabilities {
                if !KNOWN_PROVIDER_CAPABILITIES.contains(&capability.as_str()) {
                    return Err(ManifestError::new(
                        "E_PROVIDER_CAPABILITY_UNKNOWN",
                        capability.clone(),
                    ));
                }
            }
            if let Some(path) = provider.settings_page_path.as_deref() {
                if !path.is_empty() && !is_valid_settings_page_path(path) {
                    return Err(ManifestError::new("E_SETTINGS_PAGE_INVALID", path));
                }
            }
            if provider.auth_kind == AuthKind::BrowserLogin && provider.auth_domains.is_empty() {
                return Err(ManifestError::new(
                    "E_AUTH_DOMAIN_INVALID",
                    "authKind = browser-login 时必须声明 authDomains",
                ));
            }
            for domain in &provider.auth_domains {
                if !is_valid_auth_domain(domain) {
                    return Err(ManifestError::new("E_AUTH_DOMAIN_INVALID", domain.clone()));
                }
            }
        }

        self.validate_v3()?;
        Ok(())
    }

    /// schema 3 新增的声明面校验（设计 §2.1 / §3.1 / §4.1 / §6）。
    ///
    /// 单独成函数而不是继续往 `validate` 里堆：v3 的规则有 6 条错误码，
    /// 与 v2 的 provider 规则完全无关，混在一个函数里会让「错误优先级」越来越难读。
    fn validate_v3(&self) -> Result<(), ManifestError> {
        // 老清单（schema 1/2）声明 v3 字段：老宿主会静默丢掉，作者却以为生效了。
        // 空数组不算「声明」—— 模板生成器吐一个 `"contentPacks": []` 是常见写法。
        let v3_declared = !self.contributes.content_packs.is_empty()
            || !self.contributes.actions.is_empty()
            || !self.contributes.hooks.is_empty()
            || self.config_schema.is_some();
        if self.schema < V3_SCHEMA && v3_declared {
            return Err(ManifestError::new(
                "E_V3_REQUIRES_SCHEMA_3",
                "contentPacks / actions / hooks / configSchema 需要 schema 3",
            ));
        }

        // 内容包：先看路径（最危险），再看 id（会进前端 key），最后查重。
        let mut seen_packs = std::collections::HashSet::new();
        for pack in &self.contributes.content_packs {
            if !is_safe_content_file(&pack.file) {
                return Err(ManifestError::new(
                    "E_CONTENT_FILE_INVALID",
                    pack.file.clone(),
                ));
            }
            if !is_valid_content_pack_id(&pack.id) {
                return Err(ManifestError::new(
                    "E_CONTENT_PACK_ID_INVALID",
                    pack.id.clone(),
                ));
            }
            if !seen_packs.insert(pack.id.as_str()) {
                // 前端按 pack id 建索引：重复时后者覆盖前者，用户会少一个包却查不出原因。
                return Err(ManifestError::new(
                    "E_CONTENT_PACK_ID_INVALID",
                    format!("{} (duplicate)", pack.id),
                ));
            }
            // 插槽同样是受控资源（设计 §4.1 / §6.1）：名字写错一个字，这个包就在界面上
            // 静默不出现 —— 作者只会觉得「装了但没生效」。所以写了就必须在白名单内。
            //
            // 这里**不像 `actions[].slot` 那样放行空串**：动作的空串等于「不挂插槽」，
            // 而内容包没有那个状态（不写就落在灵感库），空串只可能是笔误。
            if let Some(slot) = pack.slot.as_deref() {
                if !SLOT_IDS.contains(&slot) {
                    return Err(ManifestError::new(
                        "E_SLOT_UNKNOWN",
                        format!("{slot} (合法插槽：{})", slot_names()),
                    ));
                }
            }
        }

        let mut seen_actions = std::collections::HashSet::new();
        for action in &self.contributes.actions {
            if !is_valid_content_pack_id(&action.id) {
                return Err(ManifestError::new("E_ACTION_ID_INVALID", action.id.clone()));
            }
            if !seen_actions.insert(action.id.as_str()) {
                // 动作 id 是「点击哪个按钮」的唯一标识，重复会让一个按钮永远点不到。
                return Err(ManifestError::new(
                    "E_ACTION_ID_INVALID",
                    format!("{} (duplicate)", action.id),
                ));
            }
            if let Some(slot) = action.slot.as_deref() {
                // 空串等于「不挂插槽」（模板里常见 `"slot": ""`），只有非空才当声明。
                if !slot.trim().is_empty() && !SLOT_IDS.contains(&slot) {
                    return Err(ManifestError::new("E_SLOT_UNKNOWN", slot.to_string()));
                }
            }
            // 提示词是声明式动作的全部业务逻辑：空的 system/user 会得到一份
            // 「模型不知道要干什么」的请求，且作者在界面上完全看不出来。
            if action.prompt.system.trim().is_empty() || action.prompt.user.trim().is_empty() {
                return Err(ManifestError::new(
                    "E_PROMPT_EMPTY",
                    format!("{} (system / user 不能为空)", action.id),
                ));
            }
        }

        // 钩子（设计 §5 / D5 / D6 / D7）。校验顺序沿「作者改一次只遇到一个问题」：
        // 事件名（最基础，写错了后面全白搭）→ 实现方式的必需字段 → 超时范围 → 查重。
        //
        // 注意 `E_RUNTIME_REQUIRED` 不在这里，它在 `validate` 的前半段：没有进程的
        // `impl=process` 钩子会先撞那条（更本质：这个包根本跑不起来）。
        let mut seen_hooks: Vec<(&str, i32)> = Vec::new();
        for hook in &self.contributes.hooks {
            if !is_known_hook_event(&hook.on) {
                return Err(ManifestError::new(
                    "E_HOOK_EVENT_UNKNOWN",
                    format!("{} (合法事件：{})", hook.on, hook_event_names()),
                ));
            }
            // 两种实现各有自己的必需字段，缺了就等于一次「什么也不做」的钩子：
            // prompt 没模板时模型收到的是一句空提示，process 没 tool 时宿主要调谁？
            match hook.impl_kind {
                HookImpl::Prompt => {
                    if hook.template.as_deref().is_none_or(|t| t.trim().is_empty()) {
                        return Err(ManifestError::new(
                            "E_HOOK_TEMPLATE_REQUIRED",
                            format!("{} (impl=prompt 必须提供非空 template)", hook.on),
                        ));
                    }
                }
                HookImpl::Process => {
                    if hook.tool.as_deref().is_none_or(|t| t.trim().is_empty()) {
                        return Err(ManifestError::new(
                            "E_HOOK_TOOL_REQUIRED",
                            format!("{} (impl=process 必须提供非空 tool)", hook.on),
                        ));
                    }
                }
            }
            if let Some(ms) = hook.timeout_ms {
                // 0 等于「立刻超时」（钩子形同虚设），超上限等于让一个必经过的接缝
                // 把主流程拖到用户以为卡死。两者都在解析期拒，而不是运行期才发现。
                if ms == 0 || ms > MAX_HOOK_TIMEOUT_MS {
                    return Err(ManifestError::new(
                        "E_HOOK_TIMEOUT_INVALID",
                        format!("{} (timeoutMs = {ms}，合法范围 1..={MAX_HOOK_TIMEOUT_MS})", hook.on),
                    ));
                }
            }
            // D7 是「同事件串行 + priority 排序」：同事件同 priority 的两个钩子之间
            // 没有任何确定顺序可言（排序不稳定），而钩子会改提示词/正文 —— 顺序不同
            // 结果就不同。这种不确定性必须在安装期拒掉，而不是留成「有时好有时坏」。
            // 允许同事件不同 priority（那正是 D7 想要的），也允许不同事件同 priority。
            if seen_hooks
                .iter()
                .any(|(on, priority)| *on == hook.on.as_str() && *priority == hook.priority)
            {
                return Err(ManifestError::new(
                    "E_HOOK_DUPLICATE",
                    format!(
                        "{} (priority {} 重复：同事件同优先级无法确定执行顺序，请给其中一个改 priority)",
                        hook.on, hook.priority
                    ),
                ));
            }
            seen_hooks.push((hook.on.as_str(), hook.priority));
        }

        // 插槽：先查名字，再查版本。分开两轮是为了「名字写错」永远优先于
        // 「版本超前」报出来 —— 前者是笔误，后者才是真要升级宿主。
        for slot in &self.slots {
            if !SLOT_IDS.contains(&slot.as_str()) {
                return Err(ManifestError::new("E_SLOT_UNKNOWN", slot.clone()));
            }
        }
        for slot in self.requires_slot.keys() {
            if !SLOT_IDS.contains(&slot.as_str()) {
                return Err(ManifestError::new("E_SLOT_UNKNOWN", slot.clone()));
            }
        }
        for (slot, required) in &self.requires_slot {
            let current = slot_api_version(slot);
            if *required > current {
                // detail 必须带名字与当前版本：只说「版本不支持」，作者不知道该改谁。
                return Err(ManifestError::new(
                    "E_SLOT_VERSION_UNSUPPORTED",
                    format!("{slot} 需要插槽 API 版本 {required}，宿主当前支持 {current}"),
                ));
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINIMAL: &str = r#"{
      "schema": 1,
      "id": "chapter-insights",
      "name": "章节洞察",
      "version": "1.2.0",
      "runtime": { "type": "node", "entry": "index.js" }
    }"#;

    #[test]
    fn parses_minimal_manifest_with_defaults() {
        let m = PluginManifest::parse(MINIMAL).expect("should parse");
        assert_eq!(m.id, "chapter-insights");
        // runtime 现在是 Option（v3 起纯 Tier 1 插件没有它）：这份清单写了 runtime，
        // 所以必须解出 Some —— 断言从 `m.runtime.x` 改成 `runtime.x`，语义不变。
        let runtime = m.runtime.as_ref().expect("最小清单声明了 runtime");
        assert_eq!(runtime.entry_type, RuntimeType::Node);
        assert!(runtime.keep_alive);
        assert_eq!(runtime.start_timeout_ms, 10_000);
        assert!(m.permissions.is_empty());
        assert!(m.contributes.tools.is_empty());
    }

    #[test]
    fn rejects_unsupported_schema_version() {
        // CURRENT_SCHEMA = 3：1/2/3 都合法，4 起才是"不支持"。
        // 每次 bump CURRENT_SCHEMA 时，这里的数字要跟着 +1 —— 它是一条版本护栏。
        let err = PluginManifest::parse(&MINIMAL.replace("\"schema\": 1", "\"schema\": 4"))
            .unwrap_err();
        assert_eq!(err.code(), "E_SCHEMA_UNSUPPORTED");
    }

    #[test]
    fn accepts_every_supported_schema_version() {
        for v in 1..=CURRENT_SCHEMA {
            let src = MINIMAL.replace("\"schema\": 1", &format!("\"schema\": {v}"));
            assert!(PluginManifest::parse(&src).is_ok(), "schema {v} 应当被接受");
        }
    }

    #[test]
    fn rejects_uppercase_or_spaced_id() {
        for bad in ["My-Plugin", "my plugin", "", "-bad", "a"] {
            let src = MINIMAL.replace("chapter-insights", bad);
            let err = PluginManifest::parse(&src).unwrap_err();
            assert_eq!(err.code(), "E_ID_INVALID", "input: {bad}");
        }
    }

    #[test]
    fn rejects_non_semver_version() {
        let src = MINIMAL.replace("1.2.0", "1.2");
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_VERSION_INVALID"
        );
    }

    #[test]
    fn rejects_unknown_runtime_type() {
        let src = MINIMAL.replace("\"node\"", "\"ruby\"");
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_RUNTIME_INVALID"
        );
    }

    #[test]
    fn rejects_unknown_permission() {
        let src = MINIMAL.replace(
            "\"runtime\"",
            "\"permissions\": [\"root:everything\"], \"runtime\"",
        );
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_PERMISSION_UNKNOWN"
        );
    }

    #[test]
    fn rejects_entry_escaping_plugin_dir() {
        let src = MINIMAL.replace("\"index.js\"", "\"../../evil.js\"");
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_ENTRY_INVALID"
        );
    }

    #[test]
    fn rejects_absolute_entry() {
        let src = MINIMAL.replace("\"index.js\"", "\"/etc/passwd\"");
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_ENTRY_INVALID"
        );
    }

    #[test]
    fn rejects_unknown_inject_target() {
        let src = MINIMAL.replace(
            "\"runtime\"",
            "\"inject\": [\"host.nonexistent\"], \"runtime\"",
        );
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_INJECT_UNKNOWN"
        );
    }

    #[test]
    fn rejects_tool_name_with_bad_chars() {
        let src = MINIMAL.replace(
            "\"runtime\"",
            "\"contributes\": {\"tools\": [{\"name\": \"Bad-Name\", \"description\": \"x\"}]}, \"runtime\"",
        );
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_TOOL_NAME_INVALID"
        );
    }

    const FULL_DOC_EXAMPLE: &str = r#"{
      "schema": 1,
      "id": "chapter-insights",
      "name": "章节洞察",
      "version": "1.2.0",
      "description": "后台分析章节，产出节奏与伏笔报告",
      "author": { "name": "某某", "url": "https://github.com/someone" },
      "license": "MIT",
      "requires": { "qmai": ">=4.4.0" },
      "runtime": { "type": "node", "entry": "index.js", "args": ["--stdio"], "keepAlive": true, "startTimeoutMs": 10000 },
      "inject": ["host.qmai.tools", "host.logger"],
      "contributes": {
        "tools": [{ "name": "analyze_chapter_rhythm", "description": "分析指定章节的叙事节奏",
          "parameters": { "chapterPath": { "type": "string", "description": "章节文件路径", "required": true } } }],
        "stages": ["planning"],
        "panels": []
      },
      "permissions": ["fs:project-read", "net:https"],
      "autoStart": true
    }"#;

    #[test]
    fn rejects_misspelled_field_instead_of_silently_ignoring_it() {
        // 拼错字段若被静默忽略，作者会以为申请到了权限，实际是空集 —— 必须在解析期炸。
        let src = MINIMAL.replace("\"version\"", "\"permissionss\": [\"fs:project-write\"], \"version\"");
        let err = PluginManifest::parse(&src).unwrap_err();
        assert_eq!(err.code(), "E_JSON_INVALID");
        assert!(
            err.detail.contains("permissionss"),
            "detail 应指出拼错的字段: {}",
            err.detail
        );
    }

    #[test]
    fn accepts_the_documented_full_manifest() {
        // 设计文档 4.1 的示例清单必须原样通过，否则 deny_unknown_fields 就变成了误伤
        let m = PluginManifest::parse(FULL_DOC_EXAMPLE).expect("设计文档 4.1 示例必须合法");
        assert_eq!(m.author.as_ref().map(|a| a.name.as_str()), Some("某某"));
        assert_eq!(m.license, "MIT");
        assert!(m.auto_start);
        assert_eq!(m.permissions, vec!["fs:project-read", "net:https"]);
        assert_eq!(m.contributes.tools.len(), 1);
    }

    #[test]
    fn accepts_declared_auto_granted_data_write() {
        let src = MINIMAL.replace("\"version\"", "\"permissions\": [\"data:write\", \"net:https\"], \"version\"");
        let m = PluginManifest::parse(&src).expect("data:write 声明应被接受");
        assert_eq!(m.permissions, vec!["data:write", "net:https"]);
    }

    #[test]
    fn rejects_ui_panel_permission_until_phase_two() {
        // 设计 6.2：ui:panel「第二期 · 现阶段不可申请」—— 这条才该拒
        let src = MINIMAL.replace("\"version\"", "\"permissions\": [\"ui:panel\"], \"version\"");
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_PERMISSION_UNKNOWN"
        );
    }

    #[test]
    fn rejects_entries_that_are_not_a_file_name() {
        for bad in [".", "sub/", "index.js/", " index.js", "index.js ", "ind\u{0}ex.js"] {
            let src = MINIMAL.replace("\"index.js\"", &serde_json::to_string(bad).unwrap());
            assert_eq!(
                PluginManifest::parse(&src).unwrap_err().code(),
                "E_ENTRY_INVALID",
                "entry: {bad:?}"
            );
        }
    }

    #[test]
    fn rejects_duplicate_tool_names() {
        let src = MINIMAL.replace(
            "\"runtime\"",
            "\"contributes\": {\"tools\": [{\"name\": \"aa_tool\"}, {\"name\": \"aa_tool\"}]}, \"runtime\"",
        );
        let err = PluginManifest::parse(&src).unwrap_err();
        assert_eq!(err.code(), "E_TOOL_NAME_INVALID");
        assert!(err.detail.contains("duplicate"), "detail: {}", err.detail);
    }

    #[test]
    fn rejects_empty_or_too_long_name() {
        for bad in ["   ", &"a".repeat(65)] {
            let src = MINIMAL.replace("\"name\": \"章节洞察\"", &format!("\"name\": \"{bad}\""));
            assert_eq!(
                PluginManifest::parse(&src).unwrap_err().code(),
                "E_NAME_INVALID",
                "name: {bad:?}"
            );
        }
    }

    #[test]
    fn start_timeout_range_is_inclusive() {
        let with = |ms: u64| {
            MINIMAL.replace(
                "\"entry\": \"index.js\"",
                &format!("\"entry\": \"index.js\", \"startTimeoutMs\": {ms}"),
            )
        };
        for ok in [1_000u64, 60_000] {
            assert!(PluginManifest::parse(&with(ok)).is_ok(), "{ok} 应被接受");
        }
        for bad in [999u64, 60_001] {
            assert_eq!(
                PluginManifest::parse(&with(bad)).unwrap_err().code(),
                "E_START_TIMEOUT_INVALID",
                "{bad} 应被拒绝"
            );
        }
    }

    #[test]
    fn rejects_truncated_json() {
        assert_eq!(
            PluginManifest::parse("{\"schema\": 1, \"id\":").unwrap_err().code(),
            "E_JSON_INVALID"
        );
    }

    #[test]
    fn error_detail_carries_the_offending_value() {
        // detail 是排障唯一线索；丢了实际值等于让人对着「清单非法」猜
        let src = MINIMAL.replace("\"index.js\"", "\"../../evil.js\"");
        let err = PluginManifest::parse(&src).unwrap_err();
        assert_eq!(err.code(), "E_ENTRY_INVALID");
        assert_eq!(err.detail, "../../evil.js");
    }

    #[test]
    fn tool_parameters_stay_open_to_json_schema_keywords() {
        // ToolParam 故意不加 deny_unknown_fields：真实 MCP 工具的 inputSchema 会带
        // properties / items / default / pattern 等关键字，加了会让合法清单装不上。
        let src = MINIMAL.replace(
            "\"runtime\"",
            r#""contributes": {"tools": [{
                "name": "analyze",
                "description": "d",
                "parameters": {
                    "chapterPath": {
                        "type": "string",
                        "description": "路径",
                        "required": true,
                        "default": "x",
                        "pattern": ".*"
                    }
                }
            }]}, "runtime""#,
        );
        let m = PluginManifest::parse(&src).expect("含 JSON Schema 关键字的参数应被接受");
        assert_eq!(m.contributes.tools.len(), 1);
        assert_eq!(m.contributes.tools[0].parameters.len(), 1);
    }

    // ── schema 2 / provider 声明 ─────────────────────────

    /// 一个合法的 schema 2 provider。各用例只在它上面做最小替换，
    /// 这样失败时能确定是被目标规则拒的，而不是别的字段先炸。
    const PROVIDER: &str = r#"{
      "id": "wb-connect",
      "name": "WorkBuddy 插件",
      "description": "本机已登录的 WorkBuddy 账号",
      "authKind": "none",
      "settingsPagePath": "/login",
      "authDomains": ["workbuddy.cn"],
      "capabilities": ["models.refresh"]
    }"#;

    const BROWSER_LOGIN_PROVIDER: &str = r#"{
      "id": "qoder-connect",
      "name": "Qoder 插件",
      "authKind": "browser-login",
      "authDomains": ["qoder.com"]
    }"#;

    /// 在 MINIMAL 上插入 `permissions: ["net:listen"]` 与给定 provider，
    /// 并把 schema 提到 2。
    fn manifest_with_providers(providers: &str) -> String {
        MINIMAL
            .replace("\"schema\": 1", "\"schema\": 2")
            .replace(
                "\"runtime\"",
                &format!(
                    "\"permissions\": [\"net:listen\"], \"contributes\": {{\"providers\": [{providers}]}}, \"runtime\""
                ),
            )
    }

    #[test]
    fn accepts_schema_2_with_provider() {
        let m = PluginManifest::parse(&manifest_with_providers(PROVIDER))
            .expect("合法的 schema 2 provider 清单必须通过");
        assert_eq!(m.schema, 2);
        assert_eq!(m.contributes.providers.len(), 1);
        let provider = &m.contributes.providers[0];
        assert_eq!(provider.id, "wb-connect");
        assert_eq!(provider.name, "WorkBuddy 插件");
        assert_eq!(provider.auth_kind, AuthKind::None);
        assert_eq!(provider.settings_page_path.as_deref(), Some("/login"));
        assert_eq!(provider.auth_domains, vec!["workbuddy.cn"]);
        assert_eq!(provider.capabilities, vec!["models.refresh"]);
    }

    #[test]
    fn rejects_provider_on_schema_1() {
        let src = manifest_with_providers(PROVIDER).replace("\"schema\": 2", "\"schema\": 1");
        let err = PluginManifest::parse(&src).unwrap_err();
        assert_eq!(err.code(), "E_PROVIDER_REQUIRES_SCHEMA_2");
    }

    #[test]
    fn rejects_provider_id_matching_builtin() {
        let provider = PROVIDER.replace("\"id\": \"wb-connect\"", "\"id\": \"openai\"");
        let err = PluginManifest::parse(&manifest_with_providers(&provider)).unwrap_err();
        assert_eq!(err.code(), "E_PROVIDER_ID_CONFLICT");
        assert!(err.detail.contains("openai"), "detail: {}", err.detail);
    }

    #[test]
    fn rejects_duplicate_provider_ids_in_same_manifest() {
        let err = PluginManifest::parse(&manifest_with_providers(&format!("{PROVIDER}, {PROVIDER}")))
            .unwrap_err();
        assert_eq!(err.code(), "E_PROVIDER_ID_CONFLICT");
        assert!(err.detail.contains("duplicate"), "detail: {}", err.detail);
    }

    #[test]
    fn rejects_bad_provider_name() {
        for bad in ["   ", &"a".repeat(65)] {
            let provider =
                PROVIDER.replace("\"name\": \"WorkBuddy 插件\"", &format!("\"name\": \"{bad}\""));
            let err = PluginManifest::parse(&manifest_with_providers(&provider)).unwrap_err();
            assert_eq!(err.code(), "E_PROVIDER_NAME_INVALID", "name: {bad:?}");
        }
    }

    #[test]
    fn rejects_provider_without_net_listen_permission() {
        let src = manifest_with_providers(PROVIDER).replace("\"net:listen\"", "\"net:https\"");
        let err = PluginManifest::parse(&src).unwrap_err();
        assert_eq!(err.code(), "E_PROVIDER_REQUIRES_NET_LISTEN");
    }

    #[test]
    fn accepts_provider_with_net_listen_permission() {
        let provider = r#"{"id": "local-llm", "name": "本地推理", "authKind": "none"}"#;
        let m = PluginManifest::parse(&manifest_with_providers(provider))
            .expect("申请了 net:listen 的 provider 清单必须通过");
        assert_eq!(m.permissions, vec!["net:listen"]);
        assert!(m.contributes.providers[0].settings_page_path.is_none());
        assert!(m.contributes.providers[0].capabilities.is_empty());
    }

    #[test]
    fn rejects_provider_id_with_slash() {
        // D1：复合键用 indexOf("/") 解析，providerId 含斜杠会产生歧义。
        let provider = PROVIDER.replace("\"id\": \"wb-connect\"", "\"id\": \"a/b\"");
        let err = PluginManifest::parse(&manifest_with_providers(&provider)).unwrap_err();
        assert_eq!(err.code(), "E_PROVIDER_ID_INVALID");
        assert!(err.detail.contains("a/b"), "detail: {}", err.detail);
    }

    #[test]
    fn rejects_unknown_provider_capability() {
        let provider =
            PROVIDER.replace("\"models.refresh\"", "\"models.refresh\", \"teleport\"");
        let err = PluginManifest::parse(&manifest_with_providers(&provider)).unwrap_err();
        assert_eq!(err.code(), "E_PROVIDER_CAPABILITY_UNKNOWN");
        assert!(err.detail.contains("teleport"), "detail: {}", err.detail);
    }

    #[test]
    fn rejects_bad_settings_page_path() {
        for bad in ["login", "/../x", "http://x"] {
            let provider = PROVIDER.replace("\"/login\"", &format!("\"{bad}\""));
            let err = PluginManifest::parse(&manifest_with_providers(&provider)).unwrap_err();
            assert_eq!(err.code(), "E_SETTINGS_PAGE_INVALID", "path: {bad}");
        }
    }

    #[test]
    fn rejects_browser_login_without_auth_domains() {
        let provider = BROWSER_LOGIN_PROVIDER
            .replace("\"authDomains\": [\"qoder.com\"]", "\"authDomains\": []");
        let err = PluginManifest::parse(&manifest_with_providers(&provider)).unwrap_err();
        assert_eq!(err.code(), "E_AUTH_DOMAIN_INVALID");
    }

    #[test]
    fn rejects_wildcard_or_ip_auth_domain() {
        for bad in ["*.qoder.com", "127.0.0.1", "localhost", ".qoder.com"] {
            let provider =
                BROWSER_LOGIN_PROVIDER.replace("\"qoder.com\"", &format!("\"{bad}\""));
            let err = PluginManifest::parse(&manifest_with_providers(&provider)).unwrap_err();
            assert_eq!(err.code(), "E_AUTH_DOMAIN_INVALID", "domain: {bad}");
        }
    }

    #[test]
    fn rejects_unknown_auth_kind() {
        let provider = PROVIDER.replace("\"authKind\": \"none\"", "\"authKind\": \"oauth\"");
        let err = PluginManifest::parse(&manifest_with_providers(&provider)).unwrap_err();
        assert_eq!(err.code(), "E_AUTH_KIND_INVALID");
    }

    #[test]
    fn schema_1_manifest_still_parses() {
        let m = PluginManifest::parse(MINIMAL).expect("schema 1 清单必须继续通过");
        assert_eq!(m.schema, 1);
        assert!(m.contributes.providers.is_empty());

        // 老的整段示例（含 tools/stages/panels）也不能被新字段影响。
        let full = PluginManifest::parse(FULL_DOC_EXAMPLE).expect("schema 1 完整示例必须继续通过");
        assert_eq!(full.schema, 1);
        assert!(full.contributes.providers.is_empty());
    }

    // ── schema 3 · contentPacks / actions / hooks / configSchema ─────────

    /// schema 3 的最小清单。各用例只在它上面做最小替换，
    /// 这样失败时能确定是被目标规则拒的，而不是别的字段先炸。
    const V3_MINIMAL: &str = r#"{
      "schema": 3,
      "id": "idea-generator",
      "name": "脑洞生成器",
      "version": "1.0.0",
      "runtime": { "type": "node", "entry": "index.js" }
    }"#;

    /// 一个合法的内容包声明（设计 §4.1）
    const CONTENT_PACK: &str = r#"{
      "id": "scifi-inspiration",
      "title": "科幻灵感包",
      "description": "120 条赛博 / 末世 / 星际的设定切入点",
      "file": "content/inspirations.json",
      "maxItems": 120
    }"#;

    /// 一个合法的声明式动作（设计 §3.1）
    const ACTION: &str = r#"{
      "id": "generate-titles",
      "title": "生成书名",
      "description": "根据题材生成书名备选",
      "slot": "chapter-toolbar",
      "form": { "fields": [] },
      "prompt": { "system": "你是中文网文书名策划。", "user": "题材：{{genre}}" },
      "output": { "mode": "list" },
      "limits": { "timeoutMs": 60000 }
    }"#;

    /// 在 V3_MINIMAL 的 `runtime` 之前插入一段顶层 JSON。
    fn v3_with_top(fields: &str) -> String {
        V3_MINIMAL.replace("\"runtime\"", &format!("{fields}, \"runtime\""))
    }

    fn v3_with_contributes(contributes: &str) -> String {
        v3_with_top(&format!("\"contributes\": {contributes}"))
    }

    /// 一条只有 id/title/file 的内容包声明（不写 maxItems，用来验证默认值）。
    fn pack_with_file(file: &str) -> String {
        format!(
            r#"{{"id": "scifi", "title": "科幻灵感包", "file": {}}}"#,
            serde_json::to_string(file).expect("字符串可序列化")
        )
    }

    /// 带 `slot` 的内容包声明 —— 设计 §4.1 的示例就是这个形状。
    fn pack_with_slot(slot: &str) -> String {
        format!(
            r#"{{"id": "scifi", "title": "科幻灵感包", "file": "content/inspirations.json", "slot": {}}}"#,
            serde_json::to_string(slot).expect("字符串可序列化")
        )
    }

    #[test]
    fn accepts_schema_3_with_content_packs_and_actions() {
        let src = v3_with_top(&format!(
            r#""configSchema": {{"type": "object", "properties": {{"style": {{"type": "string"}}}}}},
               "slots": ["chapter-toolbar", "inspiration-browser"],
               "requiresSlot": {{"chapter-toolbar": 1}},
               "preview": {{"actions": [{{"id": "generate-titles", "title": "生成书名"}}]}},
               "contributes": {{"contentPacks": [{CONTENT_PACK}], "actions": [{ACTION}],
                                 "hooks": [{{"on": "afterLlmResponse", "impl": "prompt", "template": "去 AI 味"}}]}}"#
        ));
        let m = PluginManifest::parse(&src).expect("schema 3 的完整声明必须通过");
        assert_eq!(m.schema, 3);
        assert_eq!(m.contributes.content_packs.len(), 1);
        assert_eq!(m.contributes.content_packs[0].id, "scifi-inspiration");
        assert_eq!(
            m.contributes.content_packs[0].file,
            "content/inspirations.json"
        );
        assert_eq!(m.contributes.content_packs[0].max_items, 120);
        assert_eq!(m.contributes.actions.len(), 1);
        assert_eq!(m.contributes.actions[0].id, "generate-titles");
        assert_eq!(m.contributes.actions[0].slot.as_deref(), Some("chapter-toolbar"));
        assert_eq!(m.contributes.actions[0].prompt.user, "题材：{{genre}}");
        assert_eq!(m.contributes.hooks.len(), 1);
        assert!(m.config_schema.is_some());
        assert_eq!(m.slots, vec!["chapter-toolbar", "inspiration-browser"]);
        assert_eq!(m.requires_slot.get("chapter-toolbar"), Some(&1));
        assert!(m.preview.is_some());
        // v3 清单不再声明 provider/tools，两个老贡献面必须仍是空 vec
        assert!(m.contributes.providers.is_empty());
        assert!(m.contributes.tools.is_empty());
    }

    #[test]
    fn content_pack_max_items_defaults_to_5000() {
        let src = v3_with_contributes(&format!(
            "{{\"contentPacks\": [{}]}}",
            pack_with_file("content/inspirations.json")
        ));
        let m = PluginManifest::parse(&src).expect("省略 maxItems 必须通过");
        assert_eq!(m.contributes.content_packs[0].max_items, 5000);
    }

    /// 设计 §4.1 的内容包示例带 `"slot": "inspiration-browser"`：白名单内的插槽必须放行。
    #[test]
    fn accepts_content_pack_with_known_slot() {
        let src = v3_with_contributes(&format!(
            "{{\"contentPacks\": [{}]}}",
            pack_with_slot("inspiration-browser")
        ));
        let m = PluginManifest::parse(&src).expect("内容包声明已知插槽必须通过");
        assert_eq!(
            m.contributes.content_packs[0].slot.as_deref(),
            Some("inspiration-browser")
        );
    }

    /// 插槽是受控资源：名字写错一个字，包就在界面上静默不出现 —— 必须在解析期炸。
    #[test]
    fn rejects_content_pack_with_unknown_slot() {
        let src = v3_with_contributes(&format!(
            "{{\"contentPacks\": [{}]}}",
            pack_with_slot("inspiration-browser-v2")
        ));
        let err = PluginManifest::parse(&src).expect_err("未知插槽必须被拒绝");
        assert_eq!(err.code(), "E_SLOT_UNKNOWN");
        assert!(
            err.detail.contains("inspiration-browser-v2"),
            "detail 应指出插槽名：{}",
            err.detail
        );
        // detail 还得列出合法值：作者改清单时唯一会看的就是这一行
        assert!(
            err.detail.contains("inspiration-browser"),
            "detail 应列出合法插槽：{}",
            err.detail
        );

        // 空串不是「不挂插槽」：内容包没有那个状态（缺省就落在灵感库），
        // 写的空串只可能是笔误，所以按未知插槽拒掉。
        let empty = v3_with_contributes(&format!(
            "{{\"contentPacks\": [{}]}}",
            pack_with_slot("")
        ));
        assert_eq!(
            PluginManifest::parse(&empty).unwrap_err().code(),
            "E_SLOT_UNKNOWN"
        );
    }

    /// 老插件不写 `slot`：内容包的本职位置就是灵感库，缺省必须放行。
    #[test]
    fn content_pack_slot_is_optional() {
        let src = v3_with_contributes(&format!(
            "{{\"contentPacks\": [{}]}}",
            pack_with_file("content/inspirations.json")
        ));
        let m = PluginManifest::parse(&src).expect("省略 slot 必须通过");
        assert_eq!(m.contributes.content_packs[0].slot, None);
    }

    #[test]
    fn rejects_v3_fields_on_schema_1_or_2() {
        let v3_fields = [
            format!("\"contributes\": {{\"contentPacks\": [{CONTENT_PACK}]}}"),
            format!("\"contributes\": {{\"actions\": [{ACTION}]}}"),
            // 钩子结构化后 `impl` 是必需字段：这里要测的是「schema 闸门」，
            // 所以给一份**合法**的钩子，免得先撞 E_JSON_INVALID（缺 impl）。
            r#""contributes": {"hooks": [{"on": "afterLlmResponse", "impl": "prompt", "template": "去 AI 味"}]}"#.to_string(),
            r#""configSchema": {"type": "object"}"#.to_string(),
        ];
        for schema in 1..=2u32 {
            for field in &v3_fields {
                let src = MINIMAL
                    .replace("\"schema\": 1", &format!("\"schema\": {schema}"))
                    .replace("\"runtime\"", &format!("{field}, \"runtime\""));
                let err = PluginManifest::parse(&src)
                    .expect_err(&format!("schema {schema} 声明 v3 字段必须被拒绝"));
                assert_eq!(err.code(), "E_V3_REQUIRES_SCHEMA_3", "schema {schema} / {field}");
            }
        }
        // 空数组不算「声明」：模板生成器吐 `"contentPacks": []` 是常见写法，
        // 在 schema 1/2 上不该因此装不上。
        for schema in 1..=2u32 {
            let src = MINIMAL
                .replace("\"schema\": 1", &format!("\"schema\": {schema}"))
                .replace(
                    "\"runtime\"",
                    "\"contributes\": {\"contentPacks\": [], \"actions\": [], \"hooks\": []}, \"runtime\"",
                );
            assert!(PluginManifest::parse(&src).is_ok(), "schema {schema} 空声明必须通过");
        }
    }

    #[test]
    fn rejects_content_pack_file_with_traversal() {
        // 内容包文件由宿主读进界面：绝对路径 / `..` / 反斜杠 / 空路径 / 可疑字符
        // 都等于让一份清单把读取范围挪出插件目录。
        for bad in [
            "../x.json",
            "content/../../x.json",
            "/abs/x.json",
            "..\\x.json",
            "C:/x.json",
            "",
            "content//x.json",
            "content/",
            "content/x json",
            " content/x.json",
        ] {
            let src = v3_with_contributes(&format!(
                "{{\"contentPacks\": [{}]}}",
                pack_with_file(bad)
            ));
            let err = PluginManifest::parse(&src)
                .expect_err(&format!("内容包路径 {bad:?} 必须被拒绝"));
            assert_eq!(err.code(), "E_CONTENT_FILE_INVALID", "file: {bad:?}");
        }

        // 合法的子路径必须放行（设计 §2.2 的目录结构就是这个形状）
        let ok = v3_with_contributes(&format!(
            "{{\"contentPacks\": [{}]}}",
            pack_with_file("content/inspirations.json")
        ));
        assert!(PluginManifest::parse(&ok).is_ok());
    }

    #[test]
    fn rejects_duplicate_content_pack_ids() {
        let src = v3_with_contributes(&format!(
            "{{\"contentPacks\": [{CONTENT_PACK}, {CONTENT_PACK}]}}"
        ));
        let err = PluginManifest::parse(&src).expect_err("重复的内容包 id 必须被拒绝");
        assert_eq!(err.code(), "E_CONTENT_PACK_ID_INVALID");
        assert!(err.detail.contains("duplicate"), "detail: {}", err.detail);
    }

    #[test]
    fn rejects_content_pack_id_outside_the_documented_pattern() {
        for bad in ["Scifi", "1scifi", "", "-scifi", "scifi inspiration", "scifi_1"] {
            let pack = format!(
                r#"{{"id": {}, "title": "科幻", "file": "content/x.json"}}"#,
                serde_json::to_string(bad).expect("字符串可序列化")
            );
            let src = v3_with_contributes(&format!("{{\"contentPacks\": [{pack}]}}"));
            let err = PluginManifest::parse(&src)
                .expect_err(&format!("内容包 id {bad:?} 必须被拒绝"));
            assert_eq!(err.code(), "E_CONTENT_PACK_ID_INVALID", "id: {bad:?}");
        }
        // 长度上限 32：33 个字符要拒
        let too_long = "a".repeat(33);
        let pack = format!(
            r#"{{"id": "{too_long}", "title": "科幻", "file": "content/x.json"}}"#
        );
        let src = v3_with_contributes(&format!("{{\"contentPacks\": [{pack}]}}"));
        assert_eq!(
            PluginManifest::parse(&src).unwrap_err().code(),
            "E_CONTENT_PACK_ID_INVALID"
        );
    }

    #[test]
    fn rejects_unknown_slot_in_action() {
        let action = ACTION.replace("\"chapter-toolbar\"", "\"chapter-toolbar-v2\"");
        let src = v3_with_contributes(&format!("{{\"actions\": [{action}]}}"));
        let err = PluginManifest::parse(&src).expect_err("未知插槽必须被拒绝");
        assert_eq!(err.code(), "E_SLOT_UNKNOWN");
        assert!(
            err.detail.contains("chapter-toolbar-v2"),
            "detail 应指出插槽名：{}",
            err.detail
        );

        // 空 slot 等于「不挂插槽」，是模板里的常见写法，必须放行
        let no_slot = ACTION.replace("\"slot\": \"chapter-toolbar\"", "\"slot\": \"\"");
        assert!(PluginManifest::parse(&v3_with_contributes(&format!(
            "{{\"actions\": [{no_slot}]}}"
        )))
        .is_ok());
    }

    #[test]
    fn rejects_unknown_slot_in_slots_and_requires_slot() {
        for src in [
            v3_with_top(r#""slots": ["no-such-slot"]"#),
            v3_with_top(r#""requiresSlot": {"no-such-slot": 1}"#),
        ] {
            let err = PluginManifest::parse(&src).expect_err("未知插槽必须被拒绝");
            assert_eq!(err.code(), "E_SLOT_UNKNOWN", "src: {src}");
            assert!(
                err.detail.contains("no-such-slot"),
                "detail 应指出插槽名：{}",
                err.detail
            );
        }
    }

    #[test]
    fn rejects_empty_prompt() {
        for (system, user) in [("   ", "给点灵感"), ("你是策划", "")] {
            let action = format!(
                r#"{{"id": "a1", "title": "生成", "prompt": {{"system": {}, "user": {}}}, "output": {{"mode": "text"}}}}"#,
                serde_json::to_string(system).expect("字符串可序列化"),
                serde_json::to_string(user).expect("字符串可序列化")
            );
            let src = v3_with_contributes(&format!("{{\"actions\": [{action}]}}"));
            let err = PluginManifest::parse(&src)
                .expect_err(&format!("空提示词必须被拒绝（{system:?}/{user:?}）"));
            assert_eq!(err.code(), "E_PROMPT_EMPTY", "system: {system:?}");
        }
    }

    #[test]
    fn rejects_bad_or_duplicate_action_ids() {
        for bad in ["Generate-Titles", "1generate", "", "-generate"] {
            let action = format!(
                r#"{{"id": {}, "title": "生成", "prompt": {{"system": "s", "user": "u"}}, "output": {{"mode": "text"}}}}"#,
                serde_json::to_string(bad).expect("字符串可序列化")
            );
            let src = v3_with_contributes(&format!("{{\"actions\": [{action}]}}"));
            let err = PluginManifest::parse(&src)
                .expect_err(&format!("动作 id {bad:?} 必须被拒绝"));
            assert_eq!(err.code(), "E_ACTION_ID_INVALID", "id: {bad:?}");
        }
        let src = v3_with_contributes(&format!("{{\"actions\": [{ACTION}, {ACTION}]}}"));
        let err = PluginManifest::parse(&src).expect_err("重复的动作 id 必须被拒绝");
        assert_eq!(err.code(), "E_ACTION_ID_INVALID");
        assert!(err.detail.contains("duplicate"), "detail: {}", err.detail);
    }

    #[test]
    fn rejects_slot_version_from_the_future() {
        let src = v3_with_top(r#""requiresSlot": {"chapter-toolbar": 2}"#);
        let err = PluginManifest::parse(&src).expect_err("超前声明的插槽版本必须被拒绝");
        assert_eq!(err.code(), "E_SLOT_VERSION_UNSUPPORTED");
        // detail 必须带插槽名与宿主当前版本，否则作者不知道该改谁、改到多少
        assert!(
            err.detail.contains("chapter-toolbar"),
            "detail 应指出插槽名：{}",
            err.detail
        );
        assert!(
            err.detail.contains('1'),
            "detail 应指出宿主当前版本：{}",
            err.detail
        );

        // 声明当前版本必须通过
        assert!(PluginManifest::parse(&v3_with_top(
            r#""requiresSlot": {"chapter-toolbar": 1}"#
        ))
        .is_ok());
    }

    #[test]
    fn schema_1_and_2_still_parse() {
        // 回归护栏：v1/v2 清单在 v3 宿主下必须继续可用（设计 §12）
        for schema in 1..=2u32 {
            let src = MINIMAL.replace("\"schema\": 1", &format!("\"schema\": {schema}"));
            let m = PluginManifest::parse(&src).expect("老清单必须继续通过");
            assert_eq!(m.schema, schema);
            assert!(m.contributes.content_packs.is_empty());
            assert!(m.contributes.actions.is_empty());
            assert!(m.contributes.hooks.is_empty());
            assert!(m.config_schema.is_none());
            assert!(m.preview.is_none());
            assert!(m.slots.is_empty());
            assert!(m.requires_slot.is_empty());
        }
        // 老的完整示例（含 tools/stages/panels）同样不受影响
        assert!(PluginManifest::parse(FULL_DOC_EXAMPLE).is_ok());
    }

    #[test]
    fn accepts_every_supported_schema_version_up_to_3() {
        // `accepts_every_supported_schema_version` 是按 CURRENT_SCHEMA 遍历的，
        // 这条用例额外钉住「当前上限确实是 3」，防止有人把上限改了却没意识到
        // 老测试的循环范围跟着一起漂。
        assert_eq!(CURRENT_SCHEMA, 3);
        for v in 1..=3u32 {
            let src = MINIMAL.replace("\"schema\": 1", &format!("\"schema\": {v}"));
            assert!(PluginManifest::parse(&src).is_ok(), "schema {v} 应当被接受");
        }
    }

    // ── Tier 1 分层：可选 runtime / kind / 包级 actions / 动作 model ─────────

    /// schema 3 的**纯 Tier 1**清单骨架：**故意不写 runtime**。
    ///
    /// 这是本组用例的基准形状 —— 任务 3 之后它必须能装上，而在那之前它会先撞
    /// 「runtime 必填」，所以每条用例都在它上面只做一处改动。
    const NO_RUNTIME_MINIMAL: &str = r#"{
      "schema": 3,
      "id": "idea-generator",
      "name": "脑洞生成器",
      "version": "1.0.0"
    }"#;

    /// 在 NO_RUNTIME_MINIMAL 里插一段顶层 JSON（用 `version` 作锚点）。
    fn no_runtime_with_top(fields: &str) -> String {
        NO_RUNTIME_MINIMAL.replace(
            "\"version\": \"1.0.0\"",
            &format!("\"version\": \"1.0.0\", {fields}"),
        )
    }

    fn no_runtime_with_contributes(contributes: &str) -> String {
        no_runtime_with_top(&format!("\"contributes\": {contributes}"))
    }

    #[test]
    fn accepts_pure_tier1_manifest_without_runtime() {
        // 这就是 samples/plugins/idea-generator 的真实形状：kind=declarative +
        // 内容包（带条目动作）+ 声明式动作，一个进程都不该起，所以没有 runtime。
        let src = no_runtime_with_top(&format!(
            r#""kind": ["declarative"],
               "contributes": {{
                 "contentPacks": [{{
                   "id": "webnovel-hooks", "title": "网文开局钩子",
                   "file": "content/inspirations.json",
                   "actions": [{{"kind": "insert-at-cursor", "label": "插入到正文"}}]
                 }}],
                 "actions": [{ACTION}]
               }}"#
        ));
        let m = PluginManifest::parse(&src).expect("纯 Tier 1 清单没有 runtime 也必须能装");
        assert!(m.runtime.is_none(), "Tier 1 不该被塞进一个 runtime");
        assert_eq!(m.kind, vec!["declarative".to_string()]);
        assert_eq!(m.contributes.content_packs.len(), 1);
        assert_eq!(m.contributes.actions.len(), 1);
    }

    #[test]
    fn rejects_tier2_contributions_without_runtime() {
        let src = no_runtime_with_contributes(
            r#"{"tools": [{"name": "analyze_rhythm", "description": "分析节奏"}]}"#,
        );
        let err = PluginManifest::parse(&src).expect_err("声明了 tools 却没 runtime 必须被拒");
        assert_eq!(err.code(), "E_RUNTIME_REQUIRED");
        // detail 要说清「为什么需要」，否则作者只会去翻文档猜是哪个字段
        assert!(err.detail.contains("runtime"), "detail: {}", err.detail);
    }

    #[test]
    fn rejects_providers_without_runtime() {
        let src = no_runtime_with_top(&format!(
            r#""permissions": ["net:listen"],
               "contributes": {{"providers": [{PROVIDER}]}}"#
        ));
        let err = PluginManifest::parse(&src).expect_err("声明了 providers 却没 runtime 必须被拒");
        assert_eq!(err.code(), "E_RUNTIME_REQUIRED");
    }

    #[test]
    fn rejects_process_hook_without_runtime() {
        // `impl: "process"` 的钩子要跑插件自己的代码 —— 没有进程就永远执行不到。
        // `tool` 写全，是为了让这条用例只测「缺 runtime」，而不是顺带撞上
        // E_HOOK_TOOL_REQUIRED（错误码的先后顺序不该由测试来兜底）。
        let src = no_runtime_with_contributes(
            r#"{"hooks": [{"on": "afterLlmResponse", "impl": "process", "tool": "rewrite_style"}]}"#,
        );
        let err = PluginManifest::parse(&src).expect_err("process 钩子没 runtime 必须被拒");
        assert_eq!(err.code(), "E_RUNTIME_REQUIRED");
    }

    #[test]
    fn accepts_tier2_with_runtime() {
        // 回归护栏：加了 E_RUNTIME_REQUIRED 之后，**原来能过的 Tier 2 清单必须照样过**。
        let src = v3_with_contributes(
            r#"{"tools": [{"name": "analyze_rhythm", "description": "分析节奏"}],
                "hooks": [{"on": "afterLlmResponse", "impl": "process", "tool": "rewrite_style"}]}"#,
        );
        let m = PluginManifest::parse(&src).expect("有 runtime 的 Tier 2 清单必须通过");
        assert!(m.runtime.is_some());
        assert_eq!(m.contributes.tools.len(), 1);
    }

    #[test]
    fn ignores_unknown_kind_values() {
        // 未来新增的层级名：老宿主不认识，但它对老宿主无害，忽略 + warn 而不是拒装。
        let src = no_runtime_with_top(r#""kind": ["declarative", "future-thing"]"#);
        let m = PluginManifest::parse(&src).expect("未知 kind 值不能让整份清单装不上");
        // 原样保留（只是不参与任何校验），作者排查时还能看到自己写了什么
        assert_eq!(m.kind, vec!["declarative", "future-thing"]);
        // 未知 kind 也不该把「没有 runtime」变成错误
        assert!(m.runtime.is_none());
    }

    #[test]
    fn accepts_content_pack_actions() {
        // 包级 actions 是原样透传给前端的 JSON：宿主只负责接住，不解释内部结构。
        let src = no_runtime_with_contributes(&format!(
            r#"{{"contentPacks": [{{
                "id": "scifi", "title": "科幻灵感包", "file": "content/inspirations.json",
                "actions": [
                    {{"kind": "insert-at-cursor", "label": "插入到正文"}},
                    {{"kind": "project-field", "field": "bookTitle", "label": "设为书名", "confirm": true}},
                    {{"kind": "run-action", "actionId": "generate-titles"}}
                ]
            }}]}}"#
        ));
        let m = PluginManifest::parse(&src).expect("包级 actions 必须能解析");
        let actions = &m.contributes.content_packs[0].actions;
        assert_eq!(actions.len(), 3);
        assert_eq!(actions[0]["kind"], "insert-at-cursor");
        assert_eq!(actions[1]["field"], "bookTitle");
        assert_eq!(actions[1]["confirm"], true);
        assert_eq!(actions[2]["actionId"], "generate-titles");
    }

    #[test]
    fn accepts_action_model_field() {
        // 模型选择策略原样透传（前端 `strategy: "current"` / `minContextTokens`）
        let action = ACTION.replace(
            "\"limits\"",
            "\"model\": {\"strategy\": \"current\", \"minContextTokens\": 32000}, \"limits\"",
        );
        let src = no_runtime_with_contributes(&format!("{{\"actions\": [{action}]}}"));
        let m = PluginManifest::parse(&src).expect("动作的 model 字段必须能解析");
        let model = m.contributes.actions[0]
            .model
            .as_ref()
            .expect("model 应被透传成 Some");
        assert_eq!(model["strategy"], "current");
        assert_eq!(model["minContextTokens"], 32000);
    }

    // ── Phase 3 · 钩子清单结构化（事件白名单 / prompt·process / gate opt-in）─────

    /// 在 V3_MINIMAL 的 contributes 里放一组钩子。
    fn v3_with_hooks(hooks: &str) -> String {
        v3_with_contributes(&format!("{{\"hooks\": [{hooks}]}}"))
    }

    #[test]
    fn accepts_valid_prompt_hook() {
        // D5 的 Tier 1 形状：一条纯声明式的去 AI 味钩子，作者一行代码不写。
        let src = v3_with_hooks(
            r#"{"on": "afterLlmResponse", "impl": "prompt", "template": "改写得更自然：\n{{text}}"}"#,
        );
        let m = PluginManifest::parse(&src).expect("合法的 prompt 钩子必须通过");
        assert_eq!(m.contributes.hooks.len(), 1);
        let hook = &m.contributes.hooks[0];
        assert_eq!(hook.on, "afterLlmResponse");
        assert_eq!(hook.impl_kind, HookImpl::Prompt);
        assert_eq!(hook.template.as_deref(), Some("改写得更自然：\n{{text}}"));
        // 缺省值必须在结构体上真的生效（否则「同事件同 priority」查重会误判）
        assert_eq!(hook.priority, 0);
        assert_eq!(hook.timeout_ms, None);
        // D6：gate 默认 true 的话，一个坏插件就能让作者写不出章节
        assert!(!hook.gate, "gate 必须默认 false（fail-open）");
        assert_eq!(hook.tool, None);
    }

    #[test]
    fn accepts_valid_process_hook() {
        // Tier 2 形状：调插件自己的工具，所以必须配 runtime。
        let src = v3_with_hooks(
            r#"{"on": "afterLlmResponse", "impl": "process", "tool": "rewrite_style",
                "priority": -5, "timeoutMs": 3000}"#,
        );
        let m = PluginManifest::parse(&src).expect("合法的 process 钩子必须通过");
        let hook = &m.contributes.hooks[0];
        assert_eq!(hook.impl_kind, HookImpl::Process);
        assert_eq!(hook.tool.as_deref(), Some("rewrite_style"));
        // priority 允许负数：想「插到所有默认优先级(0)之前」就得用负值
        assert_eq!(hook.priority, -5);
        assert_eq!(hook.timeout_ms, Some(3000));
    }

    #[test]
    fn rejects_unknown_hook_event() {
        // 拼错大小写是最常见的写法错误：宿主不会「忽略」，而是装不上并告诉作者能写什么。
        let src = v3_with_hooks(r#"{"on": "afterLLMResponse", "impl": "prompt", "template": "x"}"#);
        let err = PluginManifest::parse(&src).expect_err("未知事件必须被拒绝");
        assert_eq!(err.code(), "E_HOOK_EVENT_UNKNOWN");
        assert!(
            err.detail.contains("afterLLMResponse"),
            "detail 应回显作者写的值：{}",
            err.detail
        );
        // detail 必须列出合法事件，否则作者只能去翻文档
        assert!(
            err.detail.contains("afterLlmResponse") && err.detail.contains("beforeReview"),
            "detail 应列出合法事件：{}",
            err.detail
        );
    }

    #[test]
    fn rejects_prompt_hook_without_template() {
        // 缺模板 / 空白模板等价：模型会收到一句空提示，作者在界面上完全看不出来。
        for hook in [
            r#"{"on": "afterLlmResponse", "impl": "prompt"}"#,
            r#"{"on": "afterLlmResponse", "impl": "prompt", "template": "   "}"#,
        ] {
            let err = PluginManifest::parse(&v3_with_hooks(hook))
                .expect_err(&format!("prompt 钩子缺 template 必须被拒绝：{hook}"));
            assert_eq!(err.code(), "E_HOOK_TEMPLATE_REQUIRED", "hook: {hook}");
        }
    }

    #[test]
    fn rejects_process_hook_without_tool() {
        for hook in [
            r#"{"on": "afterLlmResponse", "impl": "process"}"#,
            r#"{"on": "afterLlmResponse", "impl": "process", "tool": "  "}"#,
        ] {
            let err = PluginManifest::parse(&v3_with_hooks(hook))
                .expect_err(&format!("process 钩子缺 tool 必须被拒绝：{hook}"));
            assert_eq!(err.code(), "E_HOOK_TOOL_REQUIRED", "hook: {hook}");
        }
    }

    #[test]
    fn rejects_zero_and_huge_timeout() {
        let with = |ms: u64| {
            v3_with_hooks(&format!(
                r#"{{"on": "afterLlmResponse", "impl": "prompt", "template": "x", "timeoutMs": {ms}}}"#
            ))
        };
        // 0 等于「立刻超时」（钩子形同虚设）；上限之外等于让一个必经过的接缝拖死主流程
        for bad in [0u64, MAX_HOOK_TIMEOUT_MS + 1] {
            let err = PluginManifest::parse(&with(bad))
                .expect_err(&format!("timeoutMs = {bad} 必须被拒绝"));
            assert_eq!(err.code(), "E_HOOK_TIMEOUT_INVALID", "timeoutMs: {bad}");
        }
        // 边界必须包含在合法区间里
        for ok in [1u64, MAX_HOOK_TIMEOUT_MS] {
            assert!(
                PluginManifest::parse(&with(ok)).is_ok(),
                "timeoutMs = {ok} 应被接受"
            );
        }
    }

    #[test]
    fn rejects_duplicate_hook_same_event_and_priority() {
        // D7：同事件串行执行，顺序由 priority 决定。同事件同 priority 的两个钩子
        // 之间没有确定顺序，而钩子会改提示词/正文 —— 顺序不同结果就不同。
        let dup = r#"{"on": "beforeReview", "impl": "prompt", "template": "a"},
                     {"on": "beforeReview", "impl": "process", "tool": "check_consistency"}"#;
        let err = PluginManifest::parse(&v3_with_hooks(dup))
            .expect_err("同事件同 priority 的重复钩子必须被拒绝");
        assert_eq!(err.code(), "E_HOOK_DUPLICATE");
        assert!(
            err.detail.contains("beforeReview"),
            "detail 应指出是哪个事件：{}",
            err.detail
        );

        // 同事件**不同** priority 是 D7 想要的写法，必须放行
        let ok = r#"{"on": "beforeReview", "impl": "prompt", "template": "a", "priority": 1},
                    {"on": "beforeReview", "impl": "prompt", "template": "b", "priority": 2}"#;
        assert!(
            PluginManifest::parse(&v3_with_hooks(ok)).is_ok(),
            "同事件不同 priority 必须通过"
        );
    }

    #[test]
    fn process_hook_still_requires_runtime() {
        // 回归：结构化之后 `needs_runtime()` 的语义不变 —— impl=process 仍要进程。
        let src = no_runtime_with_contributes(
            r#"{"hooks": [{"on": "afterLlmResponse", "impl": "process", "tool": "rewrite_style"}]}"#,
        );
        let err = PluginManifest::parse(&src).expect_err("process 钩子没 runtime 必须被拒");
        assert_eq!(err.code(), "E_RUNTIME_REQUIRED");
    }

    #[test]
    fn prompt_hook_does_not_require_runtime() {
        // 纯声明式钩子由宿主「读模板 + 再调一次模型」完成，不需要插件进程（D1）。
        // 这条规则一旦破了，一个只有钩子的插件就会被迫拉起一个从不被调用的 Node 进程。
        let src = no_runtime_with_contributes(
            r#"{"hooks": [{"on": "afterLlmResponse", "impl": "prompt", "template": "去 AI 味：{{text}}"}]}"#,
        );
        let m = PluginManifest::parse(&src).expect("prompt 钩子没有 runtime 也必须能装");
        assert!(m.runtime.is_none(), "声明式钩子不该被塞进一个 runtime");
        assert_eq!(m.contributes.hooks.len(), 1);
    }

    #[test]
    fn hook_event_names_are_unique() {
        // 事件名不能重复：重复的事件名会让「同一个事件触发两次」变成只出现在
        // 某些调用点上的随机行为，而查表永远只命中第一个。
        //
        // 各事件的默认超时不在这里断言：唯一真源在前端
        // `HOOK_DEFAULT_TIMEOUT_MS`，由 `types.spec.ts` 守着那些数字。
        let mut names: Vec<&str> = HOOK_EVENTS.to_vec();
        let total = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), total, "HOOK_EVENTS 里的事件名必须唯一");
    }
}
