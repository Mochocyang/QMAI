/**
 * 设置页里的「插件 provider」运行期卡片（T4，S2 补齐登录/余额/签到/成本）。
 *
 * 为什么是运行期 preset 而不是往 `LLM_PRESETS` 里加内容：
 * `LLM_PRESETS` 是静态数组（内置 11 个 provider 的策划目录），插件 provider 是
 * 装/卸/启/停都会变的运行期对象。把它转成与 preset 同形状的对象再追加到渲染列表，
 * 既能复用卡片的排版与品牌位，又不会让静态目录随插件状态漂移。
 *
 * v2.0 的边界（设计 §5 / 计划第 5.2 节）：
 *   - `登录/设置` 只处理「插件声明了 `settingsPagePath`」的情形，走 Rust 的受控窗口
 *     命令 `plugins_provider_open_login`；**页面 URL、导航白名单、临时数据目录都在
 *     Rust 侧**，这里只传 providerId（设计 §5.2：白名单不能由前端说了算）。
 *   - 插件没声明设置页时按钮**禁用 + 说明原因**，这里**不伪造**登录界面 ——
 *     假 UI 会让用户以为凭据已经交给了软件。
 *   - `刷新模型` 只走 Rust 命令 `plugins_provider_refresh_models`，
 *     不能复用 `settings-model-list.buildModelsUrl`：那条路会去读 `apiKey`
 *     并抛「令牌尚未获取」（插件 token 只在 Rust 内存里）。
 *   - `余额` / `每日签到` 完全由 `capabilities` 驱动（设计 §4.3）：能力位是插件对
 *     「我实现了这个端点」的声明，**没声明就说明端点不存在**。所以缺 capability 时
 *     连按钮都不渲染 —— 渲染一个灰色占位会骗用户去点，点完只能得到一个
 *     「插件不支持该端点」的 404，那是把插件的诚实宣言变成宿主的假承诺。
 *   - 但 `刷新模型` **例外**：`/v1/models` 是 provider 契约里的必需端点（设计 §3.1），
 *     刷新是宿主自己的能力，所以它不受任何能力位门控（理由见按钮处的注释）。
 *   - `paste-token` / `import-file` 有自己的输入入口（设计 §5.3）：`paste-token` 是
 *     一个密码框 + 「保存」，`import-file` 是「选择文件」→ 读文本。两者都走同一条
 *     命令（`plugins_provider_submit_credential`），插件侧端点是固定的
 *     `POST /login/credential`。**已提交的值不回填、不缓存** —— 宿主手里没有这个值
 *     （它只在一次内存中转里经过），所以这里既没有"读取已保存令牌"的调用，也不把
 *     `value` 放进任何 React 之外的地方。
 *
 * ── v2.2：与内置卡片对齐 —— 内联模型目录 + 复用上下文选择器 ──
 * 用户在这里改名、拉取/点选模型、测连接、改窗口。写入策略分两条路：
 *   1. **配置名称走草稿**，点「保存配置」才写覆盖表（`provider-overrides`）——
 *      名字是自由文本，"打了又删"不该在覆盖表上留痕。
 *   2. **模型选择 / 上下文窗口 / 输出上限 / 启停是即点即写**：目录里点一下、
 *      滑块拖一下，就直接 `setPluginProviderOverride`。这些是离散选择（选中/未选中、
 *      预设档位），没有"半途状态"，即写即生效符合直觉 —— 内置卡片（见
 *      `provider-custom.tsx`）的模型目录就是这个交互。目录**内联展开**在卡片里，
 *      逐字复用内置的 `model-catalog` / `model-section-heading` / `model-note` /
 *      `model-catalog-list` 类名（那套 CSS 已全局生效），不再是居中弹窗。
 *   3. **覆盖表是持久价值的唯一出口**：`providerConfigs` 下一次同步会用
 *      `mergePluginProviderConfig` 合并它（`provider-sync`），所以用户改的东西不会再被刷新冲掉。
 *   4. **模型只测已选的**（理由见 `runTest`），**允许手填插件没上报的模型**
 *      （理由见 `splitKnownModels`）—— 两个决定都是"替用户省时间/不夺权"。
 *
 * ── v3：视觉与自定义提供方卡片完全同构（设计 docs/plugins/workbuddy-provider-卡片设计v3.html）──
 *   1. **折叠行同构**：`model-provider-card` + `ModelConfigTitle` + `model-switch`
 *      （与 provider-custom.tsx 同一结构同一 CSS），插件身份只多一个淡紫「插件」徽标；
 *      「来自插件 xxx · N 个模型」副标题删除（那是展开态信息，不该常驻头部）。
 *   2. **chip 只剩「名称 + ×」**：v3 的小开关与「关掉变灰保留」逻辑已按用户标注3
 *      整块删除 —— chip 就是 `selectedModels`，× 是唯一移除入口，不新增覆盖表字段。
 *   3. **删除冗余**：目录提示语用截图那句「点击模型加入上方输入框，再次点击可取消。」，
 *      不再写「已从插件拉到 N 个模型…」—— 目录头的「已拉取 N · 已选择 M」就是反馈。
 *
 * ── v4/v5：上下文常展、登录外置、账号昵称、额度池（设计 …v4.html / v5.html）──
 *   1. **上下文常展**（v4 §1）：删掉 v3 的「文字行 + 点击展开」，ContextSizeSelector
 *      与 OutputTokensSelector 常驻渲染（与内置 provider-custom.tsx 同构：label +
 *      selector 竖排），「用插件上报值」重置按钮照旧。
 *   2. **登录外置**（v4 §4a）：「登录/设置」从展开区移到折叠行头部（与开关同一行、
 *      开关左侧），折叠状态下也直接可见可点；逻辑不变（authKind 分支 + openSettings）。
 *   3. **账号昵称**（v4 §5.1）：「账号状态」栏已按用户标注2 删除（列表区块已有昵称）；
 *      多账号解析约定见 `parseAccountList`（插件 b8a34523 起 get_account 返回额度池列表）。
 *   4. **额度池列表**（v5 §1）：展开区新增「已登录账号」区块 —— 每行「状态点 + 昵称 +
 *      uid + 状态 + 退出」，**没有手动切换按钮**（自动故障转移，「当前生效」只是状态展示）；
 *      「＋ 登录新账号」复用登录窗口（插件侧有「换个账号登录」），放在列表上方（标注1）。
 *   5. **插件区置顶**（v4 §4b）：llm-provider-section.tsx 里插件 provider 卡片从页面
 *      底部移到「添加提供方 / 添加自定义模型」按钮行的正下方（所有卡片的第一个位置）。
 *
 * ── v6：用户截图标注的四处调整 ──
 *   1. **账号列表最新在前**（标注1）：渲染时反转 `get_account` 的返回顺序（= 插件
 *      order 数组 = 加入先后），最新登录的排第一行 —— **只改展示顺序**，重试顺序
 *      仍由插件按加入先后决定；「＋ 登录新账号」移到列表上方（新账号从顶部插入时
 *      按钮位置不漂移）。
 *   2. **删「账号状态」栏**（标注2）：row2 只留配置名称（420px 窄框）；昵称由
 *      「已登录账号」列表区块展示，不再重复。
 *   3. **删 chip 右侧小开关**（标注3）：CHIP_TOGGLE_STYLE / aria-pressed 那套与
 *      灰 chip 保留逻辑整块删除，chip 只剩「名称 + ×」。
 *   4. **删说明留白**（标注4）：账号区块只留「区块标题（简短）+ 账号行 + 按钮」，
 *      长说明段删除；展开区间距与 provider-custom.tsx 一致（space-y-4 mt-5 等）。
 */
import { useState, useRef, useEffect, type CSSProperties } from "react"
import { AlertTriangle, CalendarCheck, Image as ImageIcon, Loader2, RefreshCw, Wallet, X } from "lucide-react"
import { ContextSizeSelector } from "@/components/settings/context-size-selector"
import { OutputTokensSelector } from "@/components/settings/output-tokens-selector"
import {
  ModelConfigTitle,
  modelEnableLabel,
} from "@/components/settings/provider-brand-icon"
import { pluginsApi, type PluginCredentialKind } from "@/lib/plugins/api"
import { watchProviderLogin } from "@/lib/plugins/login-watch"
import { syncPluginProviders } from "@/lib/plugins/provider-sync"
import { getPluginProviderOverride, setPluginProviderOverride } from "@/lib/plugins/provider-overrides"
import { deriveSelectedModelIds } from "@/lib/plugins/selected-models"
import type { PluginProviderModel, PluginProviderView } from "@/lib/plugins/types"
import { testLlmConnection, testLlmFunction, type ProviderTestResult } from "@/lib/connection-tests"
import { MIN_USER_LLM_CONTEXT_SIZE } from "@/lib/llm-context-size"
import { useWikiStore, type LlmConfig, type ProviderOverride } from "@/stores/wiki-store"
import type { LlmPreset } from "../llm-presets"

/**
 * 插件 provider 的 preset 形状。
 *
 * 额外字段只用于卡片展示与按钮分支，不参与模型解析 —— 模型解析读的是
 * `providerConfigs[providerId]`（同步写进去的），两条数据源名字相同、含义不同：
 * 这里的是「Rust 刚报上来的状态」，那里的是「界面与请求层实际在用的配置」。
 */
export interface PluginProviderPreset extends LlmPreset {
  pluginId: string
  authKind: PluginProviderView["authKind"]
  ready: boolean
  lastError?: string
  /**
   * 插件声明的能力位（设计 §4.3）。**只决定余额/签到按钮是否出现**，不改变协议。
   *
   * 缺省按「没有能力」处理：插件没写就等于没实现端点，宿主不能替它假设。
   * `models.refresh` 虽然在这一栏里，但不驱动 UI（见文件头与按钮处注释）。
   */
  capabilities: string[]
  /** 插件的登录/设置页路径（清单里的 `settingsPagePath`）。空 = 没声明页面。 */
  settingsPage?: string
  /** 运行期模型（带上下文窗口，卡片上显示；未就绪时可能为空）。 */
  models: PluginProviderModel[]
}

/**
 * 卡片认得的能力位（设计 §4.2 白名单里只有这三个）。
 *
 * **没有 `models.refresh` 常量**：它虽然仍被清单接受（写着不报错，向后兼容），
 * 但不驱动任何 UI，理由见「刷新模型」按钮处的注释 —— 留一个没人读的常量只会
 * 让人以为它还有语义。
 */
const CAP_BALANCE = "balance.query"
const CAP_CHECKIN = "checkin"

/**
 * 登录命令「快速返回」的判定阈值。
 *
 * 为什么要判时长：`plugins_provider_open_login` 目前约定「窗口打开即 resolve」，
 * 但 Rust 侧也可能实现成「等用户关窗才 resolve」。两种实现下「窗口已打开」这句话
 * 只有前者成立，后者要等到关窗才说得通。用耗时把两种情况区分开，**兼容两种实现**；
 * 等 Rust 侧时机定型后这个分支可以删掉，只留一句话。
 */
const LOGIN_QUICK_RESOLVE_MS = 3000

/** 插件没声明设置页时的说明（同时用作按钮 tooltip 与 aria 描述）。 */
const NO_SETTINGS_PAGE_HINT = "该插件没有声明设置页（settingsPagePath），宿主无法打开登录窗口"

/*
 * v3 的内联样式（只作用于这张卡片，不动全局 CSS 文件）：
 *   · `PLUGIN_BADGE_STYLE` —— 折叠行上「插件 / 未就绪」两个小徽标（v3 设计的淡紫/红）。
 *   （chip 右侧小开关的三段内联样式已随用户标注3 删除。）
 */
const PLUGIN_BADGE_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  flexShrink: 0,
  fontSize: "0.6875rem",
  fontWeight: 500,
  lineHeight: "16px",
  padding: "2px 7px",
  borderRadius: "999px",
}
function maxOf(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((max, value) => (value > max ? value : max), values[0])
}

export function toPluginProviderPreset(view: PluginProviderView): PluginProviderPreset {
  return {
    // preset.id 必须等于 provider id：它同时是 `providerConfigs` 的键，也是
    // 模型复合键 `providerId/modelId` 的前缀（设计 D1）。三者错位就会选到别人的模型。
    id: view.providerId,
    label: view.name || view.providerId,
    hint: `来自插件 ${view.pluginId}`,
    provider: view.providerId,
    defaultModel: view.models[0]?.id,
    suggestedContextSize: maxOf(view.models.map((model) => model.maxInputTokens)),
    suggestedMaxOutputTokens: maxOf(view.models.map((model) => model.maxOutputTokens)),
    pluginId: view.pluginId,
    authKind: view.authKind,
    ready: view.ready,
    lastError: view.lastError,
    // 能力位与设置页原样带出：卡片靠它们决定按钮渲染，不能在这里「补齐默认值」。
    capabilities: view.capabilities ?? [],
    settingsPage: view.settingsPage,
    models: view.models,
  }
}

/** 读 Tauri 命令失败原因（与插件管理页同一套约定：字符串优先）。 */
function describeError(cause: unknown): string {
  if (typeof cause === "string" && cause.trim()) return cause
  if (cause instanceof Error && cause.message.trim()) return cause.message
  return "操作失败，请重试。"
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/* ------------------------------------------------------------------ *
 * 第三方返回值的归一化（插件是第三方，脏数据必须在入口处收住）
 * ------------------------------------------------------------------ */

/** 余额里的一行。`value` 一律转成字符串：插件可能报数字，也可能报 "1,234 积分"。 */
export interface PluginProviderBalanceItem {
  label: string
  value: string
}

/**
 * 解析 `POST /v1/_qmai/balance` 的返回（设计 §4.4：`{items:[{label,value}]}`）。
 *
 * 结构不符返回 `undefined`（由调用方显示「格式无法识别」），**不抛异常**：
 * 一个插件的余额格式写错，不该把整个设置页打白屏。
 * 空数组算**合法**（插件确实没有余额项），与「结构错」区分开。
 */
export function parseBalance(payload: unknown): PluginProviderBalanceItem[] | undefined {
  const record = asRecord(payload)
  if (!record || !Array.isArray(record.items)) return undefined
  const items: PluginProviderBalanceItem[] = []
  for (const raw of record.items) {
    const item = asRecord(raw)
    if (!item) return undefined
    const label = typeof item.label === "string" ? item.label.trim() : ""
    const value =
      typeof item.value === "string"
        ? item.value.trim()
        : typeof item.value === "number" && Number.isFinite(item.value)
          ? String(item.value)
          : ""
    // 缺 label 或 value 的行无法渲染成「小字」；这种情况下整份结构按不可识别处理，
    // 免得界面上出现「 · 1234」这种半截内容骗用户。
    if (!label || !value) return undefined
    items.push({ label, value })
  }
  return items
}

/** 签到结果。`ok=false` 也是**结构合法**的结果（插件明确说了失败），必须如实展示。 */
export interface PluginProviderCheckinResult {
  ok: boolean
  message: string
}

/**
 * 解析 `POST /v1/_qmai/checkin` 的返回（设计 §4.4：`{ok, message}`）。
 *
 * `message` 缺省时用「已签到」/「签到失败」兜底：按钮点下去必须有反馈，
 * 不能出现「点了没反应」的空白。
 */
export function parseCheckin(payload: unknown): PluginProviderCheckinResult | undefined {
  const record = asRecord(payload)
  if (!record || typeof record.ok !== "boolean") return undefined
  const message = typeof record.message === "string" ? record.message.trim() : ""
  if (message) return { ok: record.ok, message }
  return { ok: record.ok, message: record.ok ? "已签到" : "签到失败，插件没有给出原因。" }
}

/**
 * 模型成本小字。
 *
 * **单位：每百万 token**（与 `PluginProviderModel.cost` 的约定一致）。
 * 不写货币符号：`cost` 由插件申报，货币单位也由插件定义，宿主不替它假设 ¥/$ ——
 * 标错货币比不标更糟（用户会照着算钱）。
 */
export function formatModelCost(cost: PluginProviderModel["cost"]): string | undefined {
  if (!cost) return undefined
  const { input, output } = cost
  if (input === undefined && output === undefined) return undefined
  const show = (value: number | undefined) => (value === undefined ? "–" : String(value))
  return `${show(input)}/${show(output)} /1M tokens`
}

/* ------------------------------------------------------------------ *
 * 额度池账号（v5）：插件 `get_account` 工具的多行返回解析
 * ------------------------------------------------------------------ */

/** 插件 `get_account` 解析出的一行账号（v5 额度池列表）。 */
export interface PluginProviderAccount {
  nickname: string
  uid: string
  /** 插件报的原始状态文本（如「就绪（第 2 顺位）」）；详情放行的 title，列表只显短标签。 */
  state: string
  /** 是否「当前生效」—— 只是状态展示（额度池自动故障转移，无手动切换）。 */
  active: boolean
}

/*
 * 「没有账号」的共享空列表：初始 state、未登录、解析失败都引用同一个实例，
 * 让 `setAccounts(NO_ACCOUNTS)` 命中 React 的 bailout（Object.is 相等 → 不重渲染）
 * —— 否则每次空结果都换一个新数组，卡片会在无谓的重渲染上多跑一遍。
 */
const NO_ACCOUNTS: PluginProviderAccount[] = []

/*
 * 一行账号的形状（与 samples/plugins/workbuddy-account 的 get_account 逐字对应）：
 *   `1. Yang（uid: uid-1）· 当前生效（请求从它发起） · 登录态到期：2026/10/31 20:35:00`
 * 首行「已登录 N 个账号，构成同平台额度池…」是说明，不匹配；「还没有登录…」也不匹配。
 */
const ACCOUNT_LINE_RE =
  /^\d+\.\s*(?<nickname>[^（]+)（uid:\s*(?<uid>[^）]+)）·\s*(?<state>[^·]+?)\s*·\s*登录态到期/u

/**
 * 解析 `get_account` 的多行文本返回（v5：多账号额度池）。
 *
 * 插件是第三方，脏数据在入口处收住：认不出的行直接跳过；一条都认不出（未登录 /
 * 插件没实现这个工具 / 格式变了）就返回 `[]`，界面按「⚠️ 还没有登录」显示，**不猜**。
 */
export function parseAccountList(raw: string): PluginProviderAccount[] {
  const accounts: PluginProviderAccount[] = []
  for (const line of raw.split(/\r?\n/)) {
    const match = line.trim().match(ACCOUNT_LINE_RE)
    if (!match?.groups) continue
    const nickname = match.groups.nickname?.trim() ?? ""
    const uid = match.groups.uid?.trim() ?? ""
    if (!nickname || !uid) continue
    const state = match.groups.state?.trim() ?? ""
    accounts.push({ nickname, uid, state, active: state.includes("当前生效") })
  }
  return accounts.length === 0 ? NO_ACCOUNTS : accounts
}

/** 状态的短标签：「就绪（第 2 顺位）」→「就绪」（完整状态留在行的 title 里）。 */
function accountStateLabel(state: string): string {
  const cut = state.indexOf("（")
  return (cut > 0 ? state.slice(0, cut) : state).trim()
}

/** 状态点的三档（v5 设计）：当前生效=绿实心、就绪=绿空心、冷却中/额度用完=灰。 */
type AccountDotKind = "active" | "ready" | "muted"

function accountDotKind(account: PluginProviderAccount): AccountDotKind {
  if (account.active) return "active"
  if (account.state.includes("冷却中") || account.state.includes("额度用完")) return "muted"
  return "ready"
}

const ACCOUNT_DOT_BASE_STYLE: CSSProperties = {
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  flex: "0 0 8px",
}
const ACCOUNT_DOT_STYLES: Record<AccountDotKind, CSSProperties> = {
  active: { ...ACCOUNT_DOT_BASE_STYLE, backgroundColor: "#10b981" },
  ready: { ...ACCOUNT_DOT_BASE_STYLE, border: "2px solid #10b981" },
  muted: { ...ACCOUNT_DOT_BASE_STYLE, backgroundColor: "#9ca3af" },
}

/* ------------------------------------------------------------------ *
 * 凭据输入（`paste-token` / `import-file`，设计 §5.3）
 * ------------------------------------------------------------------ */

/**
 * 凭据文件的大小上限：1 MB。
 *
 * 为什么要有上限：这类文件是令牌/凭证串（几 KB 就顶天了）。一个误选的 200MB 日志
 * 或视频文件若先读进内存再判断，设置页会当场卡死 —— 那是"顺手支持一下导入文件"
 * 最容易砸到用户的地方。所以**先量大小、再读内容**（见 `readCredentialFile`）。
 */
export const MAX_CREDENTIAL_FILE_BYTES = 1024 * 1024

/**
 * 常见凭据文本文件的扩展名（**宽松白名单**）。
 *
 * 只用来决定「要不要给一句提醒」，**不用来决定拒收**：插件的凭据格式是插件自己的事
 * （可能是 `.key`、`.pem`、无扩展名，甚至插件让用户自己起个名字）。用扩展名拒收会把
 * 「宿主不认识这个后缀」变成「这个插件用不了」，而真正该说话的是插件自己 ——
 * 它收到内容后可以回 400 并说明原因，宿主把那段错误原样展示。
 */
export const TEXT_CREDENTIAL_EXTENSIONS = [".txt", ".json", ".toml", ".yaml", ".yml", ".conf", ".ini"] as const

/** 文件名是否属于常见的凭据文本类型（决定要不要提醒，见上面的常量）。 */
export function isKnownTextCredentialFile(filename: string): boolean {
  const lower = filename.trim().toLowerCase()
  return TEXT_CREDENTIAL_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/** 从路径里取文件名：插件只需要知道"这原来是哪个文件"，不需要（也不该拿到）完整路径。 */
export function credentialFilename(path: string): string {
  const normalized = path.trim()
  const cut = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"))
  return cut >= 0 ? normalized.slice(cut + 1) : normalized
}

/** 人类可读的字节数（只用于错误文案，不参与任何判断）。 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** 读文件得到的东西：原文件名 + 文本内容 + 可能的一句提醒。 */
export interface CredentialFile {
  filename: string
  text: string
  /** 扩展名不在常见文本类型里时的提醒；**仍然允许提交**（见 TEXT_CREDENTIAL_EXTENSIONS）。 */
  warning?: string
}

/**
 * 读一个凭据文件（先量大小，再读文本）。
 *
 * 用的是项目既有的能力（`@tauri-apps/plugin-dialog` 选路径 + `@/commands/fs` 的量大小/
 * 读文本），没有引入新依赖。两个都**动态导入**：这张卡片会被设置页的第一个渲染路径
 * 加载，把文件对话框塞进模块顶层会让所有渲染这个卡片的测试都要跟着打桩。
 */
export async function readCredentialFile(path: string): Promise<CredentialFile> {
  const target = path.trim()
  if (!target) throw new Error("没有选中任何文件")
  const filename = credentialFilename(target)
  const { getFileSize, readFile } = await import("@/commands/fs")
  // 顺序不能反：先量大小，再读内容。
  const size = await getFileSize(target)
  if (size > MAX_CREDENTIAL_FILE_BYTES) {
    throw new Error(`文件 ${filename} 有 ${formatBytes(size)}，超过 ${formatBytes(MAX_CREDENTIAL_FILE_BYTES)} 上限`)
  }
  const text = await readFile(target)
  const warning = isKnownTextCredentialFile(filename)
    ? undefined
    : `${filename} 的后缀不常见，已按纯文本读取；如果插件不认这个格式，它会返回自己的错误原因`
  return { filename, text, warning }
}


/* ------------------------------------------------------------------ *
 * 卡片
 * ------------------------------------------------------------------ */

/** 同一时刻只做一件事：避免用户把「刷新模型」「签到」连点成一堆并发命令。 */
type PendingAction = "refresh" | "login" | "balance" | "checkin" | "credential" | "test" | "logout"

type BalanceState =
  | { kind: "loading" }
  | { kind: "items"; items: PluginProviderBalanceItem[] }
  | { kind: "malformed" }
  | { kind: "error"; text: string }

/* ------------------------------------------------------------------ *
 * 编辑器：草稿 → 覆盖表
 * ------------------------------------------------------------------ */

/**
 * 卡片上的**草稿** —— v2.2 之后只剩配置名称（见文件头：模型选择与窗口档位
 * 都是即点即写覆盖表，离散选择没有"半途状态"，不需要草稿缓冲）。
 *
 * 名字是自由文本：输入框要允许「删光重打」，边打边写会让覆盖表在半途状态
 * （例如名字被清成空串）上留痕，而覆盖表没有「撤销」。
 */
interface EditorDraft {
  label: string
}

/** 测试用的模型配置解析器：`providerId/modelId` → 完整 LlmConfig。 */
type ModelConfigResolver = (modelKey: string) => LlmConfig

/** 内联目录里的一行：插件报的模型（`label` 用作 tooltip；按钮文案与内置一致，用 id）。 */
interface CatalogEntry {
  id: string
  label: string
}

/**
 * 一次测试的结果。`failures` 必带模型名与原因：
 * 「2/3 通过」对用户没有可操作价值，他要的是「哪几个挂了、为什么」。
 */
interface TestOutcome {
  total: number
  failures: { model: string; reason: string }[]
}

/**
 * 把「插件上报值 + 当前覆盖」算成草稿的初始值。
 *
 * 导出是为了让测试能直接断言「打开卡片时草稿长什么样」，而不必去猜 DOM 里的
 * placeholder 是插件值还是兜底值 —— 这两者混在一起是这类"可空数字框"最典型的 bug。
 */
export function draftFromPreset(
  preset: PluginProviderPreset,
  config: ProviderOverride | undefined,
): EditorDraft {
  return {
    // 名字优先用用户改过的：`providerConfigs` 里已经是合并后的结果（provider-sync 会 merge 覆盖）。
    label: config?.label?.trim() || preset.label,
  }
}

/** 两个草稿是否等价（保存按钮的禁用条件）。 */
function sameDraft(a: EditorDraft, b: EditorDraft): boolean {
  return a.label.trim() === b.label.trim()
}

/**
 * 把模型按"插件清单里有没有"分成两拨。
 *
 * 为什么允许手动加清单里没有的模型：插件上报的 `/v1/models` 可能不全（有的上游只在
 * 收到请求时才告诉你"这个模型确实存在"），也可能是用户知道自己账号能用的新模型。
 * 宿主替用户拒绝，等于把「插件没说」当成「一定不存在」。所以照收，但**标黄提醒**
 * 「插件未上报此模型」—— 让用户自己判断，而不是让宿主假装知道。
 */
function splitKnownModels(
  models: readonly string[],
  catalog: readonly { id: string }[],
): { known: string[]; unknown: string[] } {
  const ids = new Set(catalog.map((entry) => entry.id))
  const known: string[] = []
  const unknown: string[] = []
  for (const model of models) (ids.has(model) ? known : unknown).push(model)
  return { known, unknown }
}

export function PluginProviderCard({
  preset,
  expanded,
  onToggle,
  resolveModelConfig: resolveConfigForModel,
}: {
  preset: PluginProviderPreset
  expanded: boolean
  onToggle: () => void
  /**
   * 由设置页注入（`preset-resolver` 的 `resolveModelConfig`）。
   *
   * 为什么不在卡片里直接 import：那条链路会拖进整个 novel/模型解析层，
   * 而卡片是设置页冷启动时就要渲染的组件。由调用方注入也让测试能精确控制
   * 「测的是哪一份配置」，不必在 jsdom 里搭 store。
   */
  resolveModelConfig?: ModelConfigResolver
}) {
  const [pending, setPending] = useState<PendingAction | null>(null)
  /** 登录完成观察器（重复点登录 / 卸载时要停掉上一次）。 */
  const stopLoginWatchRef = useRef<null | (() => void)>(null)
  // 卸载时停掉登录观察：组件都没了还继续轮询只是白耗。
  useEffect(() => () => stopLoginWatchRef.current?.(), [])
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null)
  const [balance, setBalance] = useState<BalanceState | null>(null)
  // 粘贴框的内容。**只活在这一次输入里**：提交后立刻清空，不写 store、不进 providerConfigs
  // （宿主手里也没有"已保存的令牌"可以回填，见文件头的说明）。
  const [credentialText, setCredentialText] = useState("")

  // model 列表：插件快照的模型 + 同步写进 providerConfigs 的合并结果（用户覆盖已经在里面）。
  const providerConfigs = useWikiStore((state) => state.providerConfigs)
  const savedConfig = providerConfigs?.[preset.id]

  const [draft, setDraft] = useState<EditorDraft>(() => draftFromPreset(preset, savedConfig))
  // 手动输入中的模型名（回车/「添加」才进选中集）。
  const [manualModel, setManualModel] = useState("")
  /*
   * 拉取回来的**内联目录**；null = 还没拉取过（不渲染，同内置卡片的 !!options.length）。
   * 选中态不在目录里存副本：真源是覆盖表的 `selectedModels`（undefined = 没写过 =
   * 全选；[] = 显式清空），下面的 `selected` 只是让点击的瞬间界面立刻翻转，
   * 不必等异步同步把 `providerConfigs` 带回来。
   */
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null)
  const [selected, setSelected] = useState<string[] | undefined>(
    () => getPluginProviderOverride(preset.id)?.selectedModels,
  )
  /*
   * 上下文/输出的**用户覆盖**（undefined = 用插件上报值）。两个选择器都没有
   * "自动"档（API 只收 number），按任务约定包一层：有覆盖时给一个
   * 「用插件上报值」按钮，点了写回 undefined（= 回到插件值）。
   */
  const [contextOverride, setContextOverride] = useState<number | undefined>(
    () => getPluginProviderOverride(preset.id)?.maxContextSize,
  )
  const [outputOverride, setOutputOverride] = useState<number | undefined>(
    () => getPluginProviderOverride(preset.id)?.maxOutputTokens,
  )
  const [testOutcome, setTestOutcome] = useState<TestOutcome | null>(null)
  /*
   * v5：额度池账号列表。WorkBuddy 的昵称/uid 只在插件自己手里（Rust 的 ProviderView
   * 没有账号字段），所以走 `get_account` 工具（invokeTool 通道）问插件本人；
   * 空数组 = 还没问到 / 没登录 / 插件没实现，账号区块整块不渲染（没有可展示的行）。
   */
  const [accounts, setAccounts] = useState<PluginProviderAccount[]>(NO_ACCOUNTS)

  /** 已保存的草稿（保存按钮的基准）：跟随 `providerConfigs` 与插件快照变化而重算。 */
  const savedDraft = draftFromPreset(preset, savedConfig)

  /*
   * 草稿的"已保存基准"。
   *
   * 为什么不用「草稿初始值直接对比 `providerConfigs`」：保存会把草稿写进覆盖表，
   * 但 `providerConfigs` 的更新要等一次异步同步；在那之前比出来的结论是"仍有改动"，
   * 保存按钮会一直亮着（用户会以为没存上）。所以基准用 state：保存成功的**那一刻**
   * 就换成草稿本身 —— 保存 → 亮着的按钮立刻变灰，是用户判断"到底存没存"的唯一依据。
   * 随后 `providerConfigs` 变化（签名变了）时只更新基准，**不碰草稿**：
   * 插件刷新不能吞掉用户正在编辑的内容。
   */
  const [baseDraft, setBaseDraft] = useState(savedDraft)
  const [baseSignature, setBaseSignature] = useState(() => (savedConfig ? JSON.stringify(savedConfig) : ""))
  const configSignature = savedConfig ? JSON.stringify(savedConfig) : ""
  if (configSignature !== baseSignature) {
    setBaseSignature(configSignature)
    setBaseDraft(savedDraft)
  }
  const dirty = !sameDraft(draft, baseDraft)
  /*
   * 启停状态：本地 state，点击即时切换并写覆盖表。
   *
   * 为什么不用 `providerConfigs[preset.id].enabled`：那里要等一次异步同步才更新，
   * 点完开关界面会"没反应"（用户会再点一次，结果又切回去）。初始值取已保存的配置，
   * 之后由本地状态接管 —— 覆盖表本身已经写好了，下一次同步自然会对齐。
   */
  const [disabled, setDisabled] = useState(() => savedConfig?.enabled === false)

  const reportedContext = maxOf(preset.models.map((model) => model.maxInputTokens))
  const reportedOutput = maxOf(preset.models.map((model) => model.maxOutputTokens))
  // 选择器显示的值：用户覆盖 ?? 插件上报（插件什么都没报时落在最小档，滑块总得有个位置）。
  const effectiveContext = contextOverride ?? reportedContext ?? MIN_USER_LLM_CONTEXT_SIZE
  const effectiveOutput = outputOverride ?? reportedOutput
  /*
   * 当前生效的选中集（chips / 测试 / 保存提示都读它）。
   * 覆盖表写过（含显式清空 []）就用覆盖表；没写过 = 全选语义 → 从合并后的配置
   * 反推（`deriveSelectedModelIds`），配置还没有（刚装好没同步）就用插件快照兜底。
   */
  const effectiveSelected =
    selected === undefined ? deriveSelectedModelIds(savedConfig, preset.models) : selected
  /*
   * 目录里「已选择 M 个」的计数：全选语义下 M = 目录里全部（都点亮）；
   * 显式清单下 M = 清单长度（含手填的、目录外的模型 —— 与内置卡片数 savedModels 一致）。
   */
  const selectedCount = selected === undefined ? (catalog?.length ?? 0) : selected.length

  // 「刷新模型」不受 capabilities 门控：/v1/models 是 provider 契约的必需端点（设计 §3.1），
  // 刷新是宿主自己的能力。models.refresh 这个 capability 因此没有 UI 语义，仅为向后兼容保留。
  const capabilities = preset.capabilities
  const canQueryBalance = capabilities.includes(CAP_BALANCE)
  const canCheckin = capabilities.includes(CAP_CHECKIN)

  const needsLogin = preset.authKind !== "none"
  const settingsPage = preset.settingsPage?.trim() ?? ""
  // 有登录需求但没声明页面 → 宿主无窗口可开。按钮禁用而不是「点了才报错」：
  // 用户一眼就知道这条能力缺在哪（tooltip 里写着缺的是 settingsPagePath）。
  const loginBlocked = needsLogin && settingsPage === ""

  /**
   * 需要用户"交一段文本"的 authKind（设计 §5.3）。
   *
   * 只有这两种走凭据入口；`none` 不需要，`browser-login` 走受控窗口里的插件页面。
   */
  const credentialKind: PluginCredentialKind | null =
    preset.authKind === "paste-token" || preset.authKind === "import-file" ? preset.authKind : null

  /**
   * 是否渲染「登录/设置」按钮。
   *
   * 凭据型 authKind 且没声明设置页时**不渲染**：这类 provider 的登录入口就是下面的
   * 输入框/选择文件按钮，再摆一个永远禁用的「登录/设置」只会让用户以为插件坏了一半
   * （"为什么这个按钮点不动？"）。声明了 `settingsPagePath` 的仍然照常给按钮 ——
   * 有的插件既收令牌、又需要一个说明页。
   */
  const showLoginButton = credentialKind === null || settingsPage !== ""

  /**
   * 「没东西可选」的状态：插件没就绪，或者一个模型都没报。
   *
   * 这时模型区不能留白 —— 空白会让用户以为宿主把模型弄丢了。右侧的主按钮换成
   * 「登录 WorkBuddy」（它就是让模型出现的那一步）；不需要登录的插件则引导去「刷新模型」。
   */
  const noModels = preset.models.length === 0
  /*
   * 「没模型」只有一种情况算「登录卡住了」：插件需要登录 + 现在没模型。
   * 不需要登录的插件（例如本地推理端点）没模型说明它自己没就绪，喊"登录"是误导 ——
   * 这时提示去刷新即可，不加一个点了只会说「该插件不需要登录」的主按钮。
   */
  const needsModelLogin = needsLogin && noModels

  /**
   * 拉一次 `get_account` 并解析成账号列表。
   *
   * 失败（插件没实现 / 未登录 / 工具超时）按"没有账号信息"处理，**不算错误** ——
   * 那只是"还没登录"，账号行显示占位即可（挂载、ready 后、退出账号后共用这条路径）。
   */
  async function fetchAccounts(): Promise<PluginProviderAccount[]> {
    try {
      return parseAccountList(await pluginsApi.invokeTool(preset.pluginId, "get_account", {}))
    } catch {
      return NO_ACCOUNTS
    }
  }

  /*
   * 账号列表只问**有账号概念**的插件（authKind ≠ none）。
   *
   * 依赖故意只有三个稳定值：插件 / 登录形态 / 就绪态 —— 不放 providerConfigs，
   * 否则每次保存都重新打一次工具。失败/空结果**不算错误**：那只是"还没登录"，
   * 账号行显示占位即可，不该在状态栏弹一条红字盖住别的反馈。
   */
  useEffect(() => {
    if (preset.authKind === "none") {
      setAccounts(NO_ACCOUNTS)
      return
    }
    let alive = true
    void fetchAccounts().then((list) => {
      if (alive) setAccounts(list)
    })
    return () => {
      alive = false
    }
  }, [preset.authKind, preset.pluginId, preset.ready])

  async function refreshModels() {
    if (pending) return
    setPending("refresh")
    setStatus(null)
    try {
      // 只走 Rust 命令：它知道怎么带着 token 打插件的 /v1/models。
      const models = await pluginsApi.refreshProviderModels(preset.id)
      // 抓完模型再同步一次，`providerConfigs` 与界面才会一起更新。
      await syncPluginProviders()
      /*
       * 拿到模型后**内联展开目录**（与内置卡片一致），而不是弹窗、也不是直接覆盖。
       *
       * 默认全部点亮：`selectedModels` 没写过 = 全选语义，正好是"整份清单都可选"
       * 的界面表达。用户点哪个灭哪个（即点即写覆盖表），没有"确定"这一步。
       */
      const entries: CatalogEntry[] = models.map((model) => ({
        id: model.id,
        label: model.name?.trim() || model.id,
      }))
      setCatalog(entries)
      // v3：不再写「已从插件拉到 N 个模型…」提示行 —— 目录头的
      // 「已拉取 N 个模型 · 已选择 M 个」就是反馈；空结果仍要说一声。
      if (entries.length === 0) setStatus({ error: false, text: "插件没有返回任何模型。" })
    } catch (cause) {
      setStatus({ error: true, text: `刷新失败：${describeError(cause)}` })
    } finally {
      setPending(null)
    }
  }

  /**
   * 把一次选择变化写进覆盖表（模型选择的**唯一**写入路径：目录点选、全选/清空、
   * chip 的 ×、手填添加全都走这里）。`undefined` = 删掉字段（回到"没勾过 = 全选"），
   * `[]` = 显式清空（一个都不显示，`applySelectedModels` 的新语义）。
   */
  function writeSelection(next: string[] | undefined) {
    setSelected(next)
    setPluginProviderOverride(preset.id, { selectedModels: next })
    // 同步让 `providerConfigs`（聊天选择器读的那份）立刻跟上；失败只 warn，
    // 覆盖表已经写好了，下一次同步仍会带上。
    void syncPluginProviders().catch((cause: unknown) => {
      console.warn("[plugins] 更新模型选择后同步 provider 失败：", cause)
    })
  }

  /**
   * "没写过 = 全选"语义下的**写入基准**：目录开着时基准是目录里的全部 id
   * （快照可能还是空的 —— 刚装好、还没同步 —— 拿快照当基准会把"全亮"点一下
   * 变成"只选一个"），再加上同步进配置的有效模型（手填的也在里面）。
   */
  function currentSelection(): string[] {
    if (selected !== undefined) return selected
    const ids = new Set<string>(catalog?.map((entry) => entry.id) ?? [])
    for (const id of deriveSelectedModelIds(savedConfig, preset.models)) ids.add(id)
    return [...ids]
  }

  /** 目录里点一个模型：点亮 → 熄灭；熄灭 → 点亮（aria-pressed 跟着翻转）。 */
  function toggleCatalogModel(id: string) {
    const current = currentSelection()
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    writeSelection(next)
  }

  /** 「全选」= 写空：删掉 `selectedModels`，回到"没勾过 = 全选"语义。 */
  function selectAllModels() {
    writeSelection(undefined)
  }

  /** 「清空」= 写 `[]`：显式一个都不选（不是"没勾过"，两者语义不同，见 writeSelection）。 */
  function clearAllModels() {
    writeSelection([])
  }

  function addModel(raw: string) {
    const names = raw
      .split(/[,，\n]/)
      .map((value) => value.trim())
      .filter(Boolean)
    if (names.length === 0) return
    const next = currentSelection()
    for (const name of names) if (!next.includes(name)) next.push(name)
    writeSelection(next)
    setManualModel("")
  }

  function removeModel(model: string) {
    writeSelection(currentSelection().filter((item) => item !== model))
  }

  /** 上下文窗口：选择器即点即写覆盖表（离散档位没有"半途状态"，见文件头）。 */
  function writeContextOverride(value: number) {
    setContextOverride(value)
    setPluginProviderOverride(preset.id, { maxContextSize: value })
    void syncPluginProviders().catch((cause: unknown) => {
      console.warn("[plugins] 更新上下文窗口后同步 provider 失败：", cause)
    })
  }

  /** 「用插件上报值」= 写 undefined（选择器没有"自动"档，这里是那个包装层）。 */
  function resetContextOverride() {
    setContextOverride(undefined)
    setPluginProviderOverride(preset.id, { maxContextSize: undefined })
    void syncPluginProviders().catch((cause: unknown) => {
      console.warn("[plugins] 恢复上下文窗口后同步 provider 失败：", cause)
    })
  }

  function writeOutputOverride(value: number) {
    setOutputOverride(value)
    setPluginProviderOverride(preset.id, { maxOutputTokens: value })
    void syncPluginProviders().catch((cause: unknown) => {
      console.warn("[plugins] 更新输出上限后同步 provider 失败：", cause)
    })
  }

  function resetOutputOverride() {
    setOutputOverride(undefined)
    setPluginProviderOverride(preset.id, { maxOutputTokens: undefined })
    void syncPluginProviders().catch((cause: unknown) => {
      console.warn("[plugins] 恢复输出上限后同步 provider 失败：", cause)
    })
  }

  /**
   * 测试已勾选的模型。
   *
   * 为什么只测已选的：插件能报 41 个模型，逐个发一次真实请求既慢又烧额度 —— 一个
   * "点一下测试"的按钮跑两分钟、还花掉用户的钱，没人会再用第二次。用户真正在意的是
   * 「我现在能用哪些」，那就是已选的这几个。
   */
  async function runTest(kind: "connection" | "function") {
    if (pending) return
    const models = effectiveSelected
    if (models.length === 0) {
      setTestOutcome(null)
      setStatus({ error: true, text: "请先选择要测试的模型。" })
      return
    }
    if (!resolveConfigForModel) {
      setStatus({ error: true, text: "宿主没有提供模型解析器，无法测试。" })
      return
    }
    setPending("test")
    setTestOutcome(null)
    setStatus({ error: false, text: `正在测试 0/${models.length}…` })
    const probe = kind === "function" ? testLlmFunction : testLlmConnection
    const failures: TestOutcome["failures"] = []
    try {
      for (const [index, model] of models.entries()) {
        let result: ProviderTestResult
        try {
          result = await probe(resolveConfigForModel(`${preset.id}/${model}`))
        } catch (cause) {
          result = { ok: false, message: describeError(cause) }
        }
        if (!result.ok) failures.push({ model, reason: result.message || "没有返回原因" })
        setStatus({ error: false, text: `正在测试 ${index + 1}/${models.length}…` })
      }
      const label = kind === "function" ? "功能测试" : "连接测试"
      setTestOutcome({ total: models.length, failures })
      setStatus({
        error: failures.length > 0,
        text:
          failures.length === 0
            ? `${label}通过（${models.length}/${models.length}）。${dirty ? "当前配置尚未保存。" : "本次测试没有修改配置。"}`
            : `${label}完成：${models.length - failures.length}/${models.length} 通过。失败：${failures
                .map((failure) => `${failure.model}：${failure.reason}`)
                .join("；")}`,
      })
    } finally {
      setPending(null)
    }
  }

  /**
   * 「保存配置」：把**配置名称**写覆盖表（模型选择/窗口/输出/启停都是即点即写，
   * 不经过这里 —— 见文件头的两条写入路径）。
   */
  function saveDraft() {
    const label = draft.label.trim()
    setPluginProviderOverride(preset.id, {
      // 名字清空 → 删掉这条覆盖，退回插件上报的名字（而不是存一个空标题）。
      label: label === "" ? undefined : label,
    })
    // 保存即"已保存基准"：按钮立刻变灰，而不是等异步同步回来才变（见 baseDraft 的注释）。
    setBaseDraft(draft)
    /*
     * 覆盖表已经写好了，但 `providerConfigs` 那边还是旧值 —— 模型选择器读的是后者。
     * 这里主动同步一次，否则用户会看到「保存成功，但聊天里还是老样子」。
     * 失败只 warn：保存本身已经生效，下次同步仍会带上覆盖。
     */
    void syncPluginProviders().catch((cause: unknown) => {
      console.warn("[plugins] 保存后同步 provider 失败：", cause)
    })
    setStatus({
      error: false,
      text: `配置已保存。${effectiveSelected.length} 个模型现在可以在 AI 对话里选择了。`,
    })
  }

  async function openSettings() {
    // `authKind === "none"`：这个插件压根没有登录这回事（例如本地推理端点），
    // 不发命令、只把话说清楚 —— 点了说「不需要登录」比按钮消失更好理解。
    if (!needsLogin) {
      setStatus({ error: false, text: "该插件不需要登录。" })
      return
    }
    if (!settingsPage || pending) return
    setPending("login")
    setStatus(null)
    // 计时是为了兼容 Rust 的两种返回时机，见 LOGIN_QUICK_RESOLVE_MS 的注释。
    const startedAt = Date.now()
    try {
      // 受控窗口由 Rust 打开；关窗后 Rust 会自己重探活 + 重抓模型。
      await pluginsApi.providerOpenLogin(preset.id)
      const elapsed = Date.now() - startedAt
      setStatus({
        error: false,
        text:
          elapsed >= LOGIN_QUICK_RESOLVE_MS
            ? // 耗时过长 → 命令很可能是在「等关窗才 resolve」，此时窗口早就不在了，
              // 再说「窗口已打开」会误导用户去找一个已经关闭的窗口。
              "登录流程已结束，模型会自动刷新。"
            : "登录窗口已打开，完成后模型会自动刷新。",
      })
      // 再同步一次快照：Rust 重抓完模型后，卡片的就绪状态/模型数要立刻跟上。
      // 失败只 warn —— 它不该把上面那句成功提示改写成错误。
      void syncPluginProviders().catch((cause: unknown) => {
        console.warn("[plugins] 登录后同步 provider 失败：", cause)
      })
      /*
       * 开始观察登录结果。
       *
       * 宿主的模型刷新挂在登录窗口的关闭事件上，而账号类插件的登录是在窗口
       * **内部**完成的 —— 用户看到"登录成功"往往就不再管那个窗口了，于是
       * 刷新链一步都没走，QMAI 里模型列表还是空的。
       *
       * 这里改成看**插件状态**：一旦 provider 变成"就绪且有模型"，就认为登录成了，
       * 立刻刷新模型。不依赖窗口有没有关。
       */
      stopLoginWatchRef.current?.()
      stopLoginWatchRef.current = watchProviderLogin({
        providerId: preset.id,
        onReady: () => {
          stopLoginWatchRef.current = null
          setStatus({ error: false, text: "登录成功，模型列表已更新。" })
        },
      })
    } catch (cause) {
      // 原文展示：Rust 的中文原因（白名单拒绝、settingsPage 非法…）比「操作失败」有用得多。
      setStatus({ error: true, text: `打开登录窗口失败：${describeError(cause)}` })
    } finally {
      setPending(null)
    }
  }

  /**
   * 真正把凭据发出去（两种 kind 共用），并把结果写进 `status`。
   *
   * 调用方只负责 `pending`：这样"读文件失败"与"提交失败"的文案不会串味
   * （前者是本地问题，后者是插件的问题，用户看到的第一句话必须能区分开）。
   */
  async function deliverCredential(
    kind: PluginCredentialKind,
    value: string,
    filename?: string,
    warning?: string,
  ) {
    try {
      const result = await pluginsApi.submitProviderCredential(preset.id, kind, value, filename)
      // 凭证不留在界面上：**无论成败都清空**输入框。
      // 失败时清空的代价是用户要重新粘贴一次，但"令牌停在设置页上等着被截图/被旁观"
      // 是更糟的一类问题，而失败原因（Rust 的中文原文或插件的响应体）已经说明了一切。
      setCredentialText("")
      // 插件没给 message 时兜底「已保存」：点了保存却什么都不显示，用户会以为没生效。
      const message = result?.message?.trim() || "已保存"
      setStatus({ error: false, text: warning ? `${message}。${warning}` : message })
      // 提交成功后 Rust 已经重探活 + 重抓模型（并 emit 了事件），这里再同步一次快照，
      // 让卡片上的模型数立刻跟上。失败只 warn —— 不该把成功提示改写成错误。
      void syncPluginProviders().catch((cause: unknown) => {
        console.warn("[plugins] 凭据提交后同步 provider 失败：", cause)
      })
    } catch (cause) {
      setCredentialText("")
      // 原文展示 Rust 的中文原因（"不支持的凭据类型"、401 与插件响应体…）：
      // 吞成「操作失败」等于把唯一可排查的信息扔掉。
      setStatus({ error: true, text: `提交失败：${describeError(cause)}` })
    }
  }

  /** `paste-token`：把输入框里的文本交给插件。 */
  async function savePastedCredential() {
    const value = credentialText
    // 空输入直接不做事（按钮本身也是禁用的，这里是第二道闸）：宁可什么都不发，
    // 也不给插件送一条空凭据、让它自己报一个含糊的错。
    if (pending || value.trim() === "") return
    setPending("credential")
    setStatus(null)
    try {
      await deliverCredential("paste-token", value)
    } finally {
      setPending(null)
    }
  }

  /** `import-file`：选文件 → 读文本 → 交给插件（原文件名一并带过去）。 */
  async function importCredentialFile() {
    if (pending) return
    setStatus(null)
    let picked: string | string[] | null = null
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      picked = await open({
        multiple: false,
        directory: false,
        title: "选择凭据文件",
        // 过滤器只是**便利**，不是白名单：第二个「全部文件」让作者那些非常规后缀
        // （.key / .pem / 无后缀）仍然可选 —— 收不收由插件决定，不由宿主猜。
        filters: [
          { name: "凭据文本", extensions: [...TEXT_CREDENTIAL_EXTENSIONS].map((ext) => ext.replace(/^\./, "")) },
          { name: "全部文件", extensions: ["*"] },
        ],
      })
    } catch (cause) {
      setStatus({ error: true, text: `打开文件选择器失败：${describeError(cause)}` })
      return
    }
    // 用户取消（返回 null）：安静退出，不要留一句"操作失败"的假错误。
    if (typeof picked !== "string") return

    setPending("credential")
    try {
      const file = await readCredentialFile(picked)
      if (file.text.trim() === "") {
        setStatus({ error: true, text: `${file.filename} 里没有可提交的内容。` })
        return
      }
      await deliverCredential("import-file", file.text, file.filename, file.warning)
    } catch (cause) {
      setStatus({ error: true, text: `读取凭据文件失败：${describeError(cause)}` })
    } finally {
      setPending(null)
    }
  }

  async function queryBalance() {
    if (pending) return
    setPending("balance")
    setBalance({ kind: "loading" })
    try {
      const payload = await pluginsApi.providerCall(preset.id, "/v1/_qmai/balance")
      const items = parseBalance(payload)
      setBalance(items ? { kind: "items", items } : { kind: "malformed" })
    } catch (cause) {
      setBalance({ kind: "error", text: describeError(cause) })
    } finally {
      setPending(null)
    }
  }

  async function runCheckin() {
    if (pending) return
    setPending("checkin")
    setStatus(null)
    try {
      const payload = await pluginsApi.providerCall(preset.id, "/v1/_qmai/checkin")
      const result = parseCheckin(payload)
      if (!result) {
        setStatus({ error: true, text: "插件返回的签到结果无法识别" })
      } else {
        // 插件主动说 `ok:false` 属于「有结果但失败」：照样展示它给的 message。
        setStatus({ error: !result.ok, text: result.message })
      }
    } catch (cause) {
      setStatus({ error: true, text: `签到失败：${describeError(cause)}` })
    } finally {
      setPending(null)
    }
  }

  /**
   * 退出一个账号（v5 §1）：调插件的 `logout` 工具（带 uid —— 只退这一个，
   * 其余账号继续构成额度池），成功后重新拉一次 `get_account` 刷新列表。
   */
  async function logoutAccount(uid: string) {
    if (pending) return
    setPending("logout")
    setStatus(null)
    try {
      const message = await pluginsApi.invokeTool(preset.pluginId, "logout", { uid })
      // 插件给的退出结果原样展示（如「已退出 Ming（uid: uid-2）。剩余账号继续作为额度池使用。」）。
      const text = typeof message === "string" && message.trim() ? message.trim() : "已退出该账号。"
      setStatus({ error: false, text })
      setAccounts(await fetchAccounts())
      // 最后一个账号退出后 provider 可能变未就绪，快照也补一次（失败只 warn，
      // 退出本身已经生效）。
      void syncPluginProviders().catch((cause: unknown) => {
        console.warn("[plugins] 退出账号后同步 provider 失败：", cause)
      })
    } catch (cause) {
      // 原文展示：插件的中文原因（uid 不存在等）比「操作失败」有用得多。
      setStatus({ error: true, text: `退出失败：${describeError(cause)}` })
    } finally {
      setPending(null)
    }
  }

  // chips 按"插件清单里有没有"分两拨（known / unknown 的理由见 splitKnownModels）。
  // 用户标注3：灰 chip（关掉变灰保留）逻辑删除后，chip 集合就是 selectedModels 本身。
  const { known: knownModels, unknown: unknownModels } = splitKnownModels(effectiveSelected, preset.models)
  const failedModels = new Set(testOutcome?.failures.map((failure) => failure.model) ?? [])

  return (
    <article
      className={`model-provider-card ${preset.ready ? "" : "opacity-60"}`}
      data-model-provider={preset.id}
      data-plugin-provider="true"
      data-ready={preset.ready ? "true" : "false"}
    >
      {/*
        v3 折叠行：与内置自定义提供方卡片（provider-custom.tsx）同一结构 ——
        ModelConfigTitle（箭头 + 标记 + 名称 + 「已保存 / 已启用」状态小字）+ model-switch。
        插件身份补两个徽标：淡紫「插件」（v3 设计色 #e8e6f8 / #4a3f9e）与未就绪时的
        红色「未就绪」（诚实优先：插件没过健康检查必须一眼可见，title 里带原因）。
        v3 删掉的：展开才有的「来自插件 xxx · N 个模型」副标题与头部那排动作按钮。
        v4 §4a：「登录/设置」从展开区移到折叠行头部（开关左侧）—— 折叠状态下也
        直接可见可点，余额/签到仍在展开区（它们是"查信息"，不是"找回入口"）。
      */}
      <header>
        <ModelConfigTitle
          expanded={expanded}
          onToggle={onToggle}
          name={draft.label || preset.label}
          /*
           * 「已保存/未保存」与 v2.2 的徽标同一语义：模型/窗口/启停是即点即写，
           * 配置由 provider-sync 自动持久化 —— 唯一会"悬着"的是改名草稿。
           * 所以只要没在改名（dirty=false）就是「已保存」；改名中显示「未保存」。
           * 不用 modelSaveLabel 的 persisted 分支：插件 provider 没有"从未保存过"
           * 的状态，那会把刚装好的插件错标成「未保存」。
           */
          saveLabel={dirty ? "未保存" : "已保存"}
          enableLabel={modelEnableLabel(!disabled)}
          mark={
            <span
              className="model-brand-icon"
              style={{ fontSize: "0.8125rem", lineHeight: "16px", fontWeight: 500 }}
              aria-hidden="true"
            >
              ⛩
            </span>
          }
          title={expanded ? "收起" : "展开"}
        />
        <span
          className="model-plugin-badge"
          data-plugin-badge="plugin"
          style={{ ...PLUGIN_BADGE_STYLE, backgroundColor: "#e8e6f8", color: "#4a3f9e" }}
        >
          插件
        </span>
        {preset.ready ? null : (
          <span
            className="model-plugin-badge"
            data-plugin-badge="unready"
            style={{ ...PLUGIN_BADGE_STYLE, backgroundColor: "#fdecea", color: "#b42318" }}
            title={preset.lastError?.trim() || "插件没有通过健康检查"}
          >
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            未就绪
          </span>
        )}
        {/*
          v4 §4a：「登录/设置」外置到折叠行头部（与开关同一行、开关左侧）——
          折叠状态下也直接可见可点，不再藏在展开区里。逻辑与 v3 相同（authKind
          分支 + openSettings）；凭据型 authKind 且没声明设置页时不渲染（那种
          provider 的入口就是展开区的输入框/选择文件按钮）。
        */}
        {showLoginButton ? (
          <button
            type="button"
            className="model-button ghost"
            data-plugin-action="login"
            aria-label="登录或打开插件设置页"
            disabled={loginBlocked || pending === "login"}
            title={loginBlocked ? NO_SETTINGS_PAGE_HINT : undefined}
            style={{ padding: "4px 10px", flexShrink: 0 }}
            onClick={() => void openSettings()}
          >
            {pending === "login" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {pending === "login" ? "打开中…" : "登录/设置"}
          </button>
        ) : null}
        {/*
          启停开关与内置卡片同款（model-switch，无文字）：直接写覆盖表的 `enabled`
          （即时生效，不等「保存配置」）—— 停用是"我想让它现在就从聊天里消失"。
        */}
        <button
          type="button"
          role="switch"
          aria-checked={!disabled}
          aria-label={!disabled ? "停用此插件模型" : "启用此插件模型"}
          className="model-switch"
          data-plugin-action="toggle-enabled"
          onClick={() => {
            const next = !disabled
            setDisabled(next)
            setPluginProviderOverride(preset.id, { enabled: next ? false : undefined })
            setStatus({ error: false, text: next ? "已停用，聊天里不再出现这些模型。" : "已启用。" })
            void syncPluginProviders().catch((cause: unknown) => {
              console.warn("[plugins] 切换启停后同步 provider 失败：", cause)
            })
          }}
        >
          <span />
        </button>
      </header>
      {/* 折叠态也要能看见错误反馈（与 provider-custom 的收起态错误行同构）。 */}
      {!expanded && status?.error ? (
        <p
          className="model-feedback error"
          role="status"
          aria-live="polite"
          data-plugin-status="error"
        >
          {status.text}
        </p>
      ) : null}

      {/*
        v3：动作按钮（余额/签到/登录）与凭据/余额/未就绪反馈全部随展开区走，
        折叠行只剩信息与开关 —— 与自定义卡片完全同构。
      */}
      {expanded ? (
        <>
        <div className="model-form" data-plugin-editor="true">
          {/*
            插件专属动作行（余额/签到）各绑自己的能力位，没有该能力就整块不渲染
            （见文件头）。「登录/设置」v4 起外置到折叠行头部（见 header 处）；
            「登录 WorkBuddy」是「没模型 + 需要登录」时的主按钮（让模型出现的那一步）。
          */}
          <div className="model-actions" data-plugin-row="actions">
            {canQueryBalance ? (
              <button
                type="button"
                className="model-button ghost"
                data-plugin-action="balance"
                disabled={pending !== null}
                onClick={() => void queryBalance()}
              >
                {pending === "balance" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="h-4 w-4" />
                )}
                {pending === "balance" ? "查询中…" : "余额"}
              </button>
            ) : null}
            {canCheckin ? (
              <button
                type="button"
                className="model-button ghost"
                data-plugin-action="checkin"
                disabled={pending !== null}
                onClick={() => void runCheckin()}
              >
                {pending === "checkin" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CalendarCheck className="h-4 w-4" />
                )}
                {pending === "checkin" ? "签到中…" : "每日签到"}
              </button>
            ) : null}
            {/*
              未登录 / 没模型时，主按钮换成「登录 WorkBuddy」：它才是让模型出现的那一步。
              tooltip 用原生 `title`：按钮 disabled 后指针事件被吞，原生 title 仍会显示。
            */}
            {needsModelLogin ? (
              <button
                type="button"
                className="model-button primary"
                data-plugin-action="login-workbuddy"
                aria-label="登录 WorkBuddy"
                disabled={loginBlocked || pending === "login"}
                title={loginBlocked ? NO_SETTINGS_PAGE_HINT : undefined}
                onClick={() => void openSettings()}
              >
                {pending === "login" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {pending === "login" ? "打开中…" : "登录 WorkBuddy"}
              </button>
            ) : null}
          </div>
          {/*
            凭据入口（设计 §5.3）。两种 authKind 都渲染自己的那一行：
            - `paste-token`：密码框 + 「保存」。**不回填已保存的值** —— 宿主根本
              没存，所以也就没有任何"显示成 ****"的假象；空框就是真实状态。
            - `import-file`：「选择文件」→ 读文本（≤1MB）→ 交给插件，原文件名一并带过去。
            - 其他 authKind：说清楚凭据在登录窗口里交（没有第二入口），不摆假输入框。
          */}
          {credentialKind ? (
            <div className="model-field" data-plugin-credential-row="true">
              <span>账号凭据</span>
              {credentialKind === "paste-token" ? (
                <div className="space-y-2" data-plugin-credential={credentialKind}>
                  <input
                    id={`plugin-credential-${preset.id}`}
                    type="password"
                    aria-label="把插件要求的令牌粘贴到这里"
                    className="w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
                    data-plugin-credential-input="paste-token"
                    // 关掉密码管理器与拼写检查：这不是登录表单，自动填充弹层会盖住卡片。
                    autoComplete="off"
                    spellCheck={false}
                    value={credentialText}
                    disabled={pending !== null}
                    onChange={(event) => setCredentialText(event.target.value)}
                  />
                  <div className="model-actions">
                    <button
                      type="button"
                      className="model-button ghost"
                      data-plugin-action="submit-credential"
                      aria-label="保存插件令牌"
                      // 空输入时禁用：不给插件送空凭据（第二道闸在 savePastedCredential 里）。
                      disabled={pending !== null || credentialText.trim() === ""}
                      onClick={() => void savePastedCredential()}
                    >
                      {pending === "credential" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      {pending === "credential" ? "提交中…" : "保存"}
                    </button>
                  </div>
                  <small className="text-muted-foreground">
                    这段内容只经过一次内存中转交给插件：QMAI 不保存、不缓存、不写日志，也不会回填。
                  </small>
                </div>
              ) : (
                <div className="space-y-2" data-plugin-credential={credentialKind}>
                  <div className="model-actions">
                    <button
                      type="button"
                      className="model-button ghost"
                      data-plugin-action="pick-credential-file"
                      aria-label="选择凭据文件"
                      disabled={pending !== null}
                      onClick={() => void importCredentialFile()}
                    >
                      {pending === "credential" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      {pending === "credential" ? "提交中…" : "选择文件"}
                    </button>
                  </div>
                  <small className="text-muted-foreground">
                    选择一个文本文件（上限 1MB），内容会原样交给插件。
                  </small>
                </div>
              )}
            </div>
          ) : null}
          {/* 余额是「一张小字」而不是一块面板：它是一眼确认，不该抢走模型列表的位置。 */}
          {balance ? (
              <p
                className={`model-feedback${
                  balance.kind === "error" || balance.kind === "malformed" ? " error" : ""
                }`}
                data-plugin-balance={balance.kind}
                role="status"
                aria-live="polite"
              >
                {balance.kind === "loading"
                  ? "正在查询余额…"
                  : balance.kind === "malformed"
                    ? "插件返回的余额格式无法识别"
                    : balance.kind === "error"
                      ? `余额查询失败：${balance.text}`
                      : balance.items.length === 0
                        ? "插件没有报告余额项。"
                        : balance.items.map((item) => `${item.label} ${item.value}`).join(" · ")}
              </p>
            ) : null}
          {preset.ready ? null : (
            <p className="model-feedback error" role="status">
              {preset.lastError?.trim() || "插件没有通过健康检查，模型暂不可用。"}
            </p>
          )}

          <div className="model-fields">
          {/* ── 配置名称（v4：名称收窄 420px）。「账号状态」栏已按用户标注2 删除 ── */}
          <label className="model-field">
            <span>配置名称</span>
            <input
              aria-label="配置名称"
              data-plugin-field="label"
              style={{ maxWidth: "420px" }}
              value={draft.label}
              placeholder={preset.label}
              spellCheck={false}
              disabled={pending === "test"}
              onChange={(event) => setDraft((previous) => ({ ...previous, label: event.target.value }))}
            />
          </label>

          {/*
            v5 §1（经用户标注1/4 调整）：「已登录账号」区块。多账号 = 一个额度池（按
            加入先后自动故障转移），**没有手动切换按钮** ——「当前生效」只是插件报的
            状态展示。退出按行删（logout 工具带 uid）；「＋ 登录新账号」复用登录窗口
            （插件侧已有「换个账号登录」），放在列表**上方** —— 新登录的账号从列表顶部
            插入，按钮位置不漂移（标注1）。区块只留「标题 + 按钮 + 账号行」，说明性
            文字行全部删除（标注4）。没有账号时整块不渲染。位置在模型区之前（v4/v5 §3）。
          */}
          {needsLogin && accounts.length > 0 ? (
            <div className="model-field full" data-plugin-field="account-list">
              <span>已登录账号</span>
              <div className="model-actions">
                {/*
                  ＋ 登录新账号：打开同一个登录窗口（providerOpenLogin）—— 多账号
                  就是重复登录流程追加，插件窗口里有「换个账号登录」的入口。放在列表
                  上方（用户标注1）：新账号从列表顶部插入时按钮位置不漂移。
                */}
                <button
                  type="button"
                  className="model-button"
                  data-plugin-action="add-account"
                  aria-label="登录新账号"
                  disabled={loginBlocked || pending === "login"}
                  title={loginBlocked ? NO_SETTINGS_PAGE_HINT : undefined}
                  onClick={() => void openSettings()}
                >
                  ＋ 登录新账号
                </button>
              </div>
              {/*
                展示按**最新在前**（用户标注1）：get_account 返回顺序 = 插件 order 数组
                = 加入先后，渲染时反转，最新（最后登录的）排第一行。**只改展示顺序**：
                插件侧 order 保持加入先后，重试（故障转移）逻辑不动。
              */}
              <ul className="space-y-1.5">
                {[...accounts].reverse().map((account) => (
                  <li
                    key={account.uid}
                    data-plugin-account={account.uid}
                    data-plugin-account-dot={accountDotKind(account)}
                    className="flex items-center gap-2"
                    title={account.state}
                  >
                    {/* 状态点：当前生效=绿实心、就绪=绿空心、冷却中/额度用完=灰（v5 设计）。 */}
                    <span aria-hidden="true" style={ACCOUNT_DOT_STYLES[accountDotKind(account)]} />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {account.nickname} · {account.uid} · {accountStateLabel(account.state)}
                    </span>
                    <button
                      type="button"
                      className="model-button ghost"
                      data-plugin-action="logout-account"
                      data-plugin-account-uid={account.uid}
                      aria-label={`退出账号 ${account.nickname}`}
                      disabled={pending !== null}
                      style={{ padding: "2px 10px", flexShrink: 0 }}
                      onClick={() => void logoutAccount(account.uid)}
                    >
                      退出
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ── 模型 chips + 手填（与内置 model-tag-input 同构；小开关已删，chip=名称+×） ── */}
          <div className="model-field full" data-plugin-field="models">
            <span>模型</span>
            {/*
              没模型时**不渲染空白**（无论是不是未登录）：
              一片空白看起来像"宿主把模型弄丢了"，用户不知道该点哪里。
              需要登录的插件说出来：真正缺的那一步是登录（登录按钮在上方动作行）；
              不需要登录的插件（authKind=none）喊"登录"是误导，改成引导去拉取。
            */}
            {noModels && effectiveSelected.length === 0 ? (
              <p className="model-note" data-plugin-models-empty="true">
                {needsLogin
                  ? "还没有模型。登录后会自动拉取模型，就不用在这里手填了。"
                  : "插件还没有报告任何模型，先点「拉取模型」试试。"}
              </p>
            ) : (
              <div className="model-tag-input" data-plugin-chips="true">
                {[
                  ...knownModels.map((model) => ({ model, unknown: false })),
                  ...unknownModels.map((model) => ({ model, unknown: true })),
                ].map(({ model, unknown }) => {
                  const chipStyle: CSSProperties = {}
                  if (unknown) {
                    // 手填的、插件清单里没有的模型：标黄而不是拒绝（理由见 splitKnownModels）。
                    chipStyle.color = "#8a5a0b"
                    chipStyle.boxShadow = "inset 0 0 0 1px #e0a010"
                  }
                  return (
                    <span
                      key={model}
                      className={failedModels.has(model) ? "is-failed" : ""}
                      data-plugin-chip={model}
                      data-plugin-chip-unknown={unknown ? "true" : undefined}
                      style={chipStyle}
                      title={
                        unknown
                          ? "插件未上报此模型：可以保存，但请求时可能被上游拒绝"
                          : undefined
                      }
                    >
                      {model}
                      {/*
                        成本与模态都是「有就加、没有就什么都不加」：不占位、不留「—」。
                        一个空白占位会让用户以为宿主没读到数据，而事实是插件没申报。
                      */}
                      {(() => {
                        const entry = preset.models.find((item) => item.id === model)
                        const cost = formatModelCost(entry?.cost)
                        if (!cost) return null
                        return (
                          <span
                            className="ml-1 text-muted-foreground"
                            data-model-cost={model}
                            title="每百万 token 成本（货币单位由插件定义）"
                          >
                            {cost}
                          </span>
                        )
                      })()}
                      {preset.models.find((entry) => entry.id === model)?.inputModalities?.includes("image") ? (
                        <span
                          className="ml-1 inline-flex items-center gap-0.5 text-muted-foreground"
                          data-model-input-modality="image"
                          title="该模型支持图片输入"
                        >
                          <ImageIcon className="h-3 w-3" aria-hidden="true" />
                          支持图片
                        </span>
                      ) : null}
                      {/* 用户标注3：chip 右侧小开关整块删除，chip 只剩「名称 + ×」。 */}
                      <button
                        type="button"
                        aria-label={`移除模型 ${model}`}
                        data-plugin-chip-remove={model}
                        onClick={() => removeModel(model)}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  )
                })}
                <div className="model-tag-compose">
                  <input
                    aria-label="模型名称"
                    data-plugin-field="manual-model"
                    value={manualModel}
                    placeholder={
                      knownModels.length + unknownModels.length
                        ? "输入模型名称，按回车添加"
                        : "输入模型名称或拉取后选择"
                    }
                    spellCheck={false}
                    onChange={(event) => setManualModel(event.target.value)}
                    onKeyDown={(event) => {
                      // 输入法组字中的回车是"选词"，不是"提交"。
                      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        addModel(manualModel)
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="model-button"
                    data-plugin-action="add-model"
                    aria-label="添加模型"
                    disabled={!manualModel.trim()}
                    onClick={() => addModel(manualModel)}
                  >
                    添加
                  </button>
                </div>
              </div>
            )}
          </div>
          </div>
          {/*
            「拉取模型」（v2.2 起代替头部的「刷新模型」）**不带任何能力位判断**，始终显示。
            拉取是宿主自己的能力：/v1/models 是 provider 契约的必需端点（设计 §3.1），
            宿主随时可以打它。把它藏在 `models.refresh` 后面，等于对没写这个字段的
            插件说「你的模型列表更新不了」——既不是事实，也纯属摩擦。
          */}
          <div className="model-actions">
            <button
              type="button"
              className="model-button"
              data-plugin-action="pull-models"
              aria-label="拉取模型"
              disabled={pending !== null}
              onClick={() => void refreshModels()}
            >
              {pending === "refresh" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              拉取模型
            </button>
            <button
              type="button"
              className="model-button ghost"
              data-plugin-action="test-connection"
              aria-label="测试连接"
              disabled={pending !== null}
              onClick={() => void runTest("connection")}
            >
              测试连接
            </button>
            <button
              type="button"
              className="model-button ghost"
              data-plugin-action="test-function"
              aria-label="测试功能"
              disabled={pending !== null}
              onClick={() => void runTest("function")}
            >
              测试功能
            </button>
          </div>

          {/*
            拉取后的**内联模型目录**（与内置卡片逐字同构：model-catalog /
            model-section-heading / model-note / model-catalog-list，那套 CSS 已全局生效）。
            每个模型是一个可点击的 button：aria-pressed = 选中态（填色样式由
            `model-catalog-list button[aria-pressed="true"]` 提供），点击即切换并写覆盖表；
            测试失败的模型标 `is-failed`（红）。没有搜索框 —— 内置卡片没有，不加。
          */}
          {catalog && catalog.length > 0 ? (
            <div className="model-catalog" data-plugin-catalog="open">
              <div className="model-section-heading">
                <p>已拉取 {catalog.length} 个模型 · 已选择 {selectedCount} 个</p>
                <div className="model-actions">
                  <button
                    type="button"
                    className="model-button ghost"
                    data-plugin-action="catalog-select-all"
                    aria-label="全选模型"
                    onClick={selectAllModels}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="model-button ghost"
                    data-plugin-action="catalog-clear"
                    aria-label="清空模型选择"
                    onClick={clearAllModels}
                  >
                    清空
                  </button>
                </div>
              </div>
              <p className="model-note">点击模型加入上方输入框，再次点击可取消。</p>
              <div className="model-catalog-list">
                {catalog.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    data-plugin-catalog-item={entry.id}
                    aria-label={`选择模型 ${entry.id}`}
                    aria-pressed={selected === undefined ? true : selected.includes(entry.id)}
                    className={failedModels.has(entry.id) ? "is-failed" : ""}
                    title={entry.label !== entry.id ? entry.label : undefined}
                    onClick={() => toggleCatalogModel(entry.id)}
                  >
                    {entry.id}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/*
            ── 上下文窗口 / 输出上限（v4 §1：常驻展开，与内置 provider-custom.tsx
            完全同构：label + selector 竖排） ──
            v3 的「收起文字行 + 点击展开」（toggle-context）已删除：滑块常驻可见可拖，
            选完即写覆盖表；「用插件上报值」重置按钮照旧（有覆盖时才出现）。
          */}
          <div className="space-y-4 mt-5" data-plugin-field="max-context">
            <div className="space-y-2" data-plugin-field="max-context-selectors">
              <span className="text-sm font-medium">上下文窗口</span>
              <ContextSizeSelector value={effectiveContext} onChange={writeContextOverride} />
              {contextOverride === undefined ? (
                <p className="model-note">
                  当前使用插件上报值
                  {reportedContext ? `（${reportedContext.toLocaleString()} tokens）` : ""}，拖动滑块即覆盖。
                </p>
              ) : (
                <button
                  type="button"
                  className="model-button ghost"
                  data-plugin-action="reset-context"
                  aria-label="恢复插件上报的上下文窗口"
                  onClick={resetContextOverride}
                >
                  用插件上报值
                </button>
              )}
            </div>
            <div className="space-y-2" data-plugin-field="max-output">
              <span className="text-sm font-medium">输出上限</span>
              <OutputTokensSelector
                value={effectiveOutput}
                contextWindow={effectiveContext}
                onChange={writeOutputOverride}
              />
              {outputOverride === undefined ? (
                <p className="model-note">
                  当前使用插件上报值
                  {reportedOutput ? `（${reportedOutput.toLocaleString()} tokens）` : ""}，拖动滑块即覆盖。
                </p>
              ) : (
                <button
                  type="button"
                  className="model-button ghost"
                  data-plugin-action="reset-output"
                  aria-label="恢复插件上报的输出上限"
                  onClick={resetOutputOverride}
                >
                  用插件上报值
                </button>
              )}
            </div>
          </div>

          {/* ── 底部：删除 + 保存（v3：与内置 model-save-footer 同构，含状态行） ── */}
          </div>
          <footer className="model-save-footer">
            <div>
              <p
                role="status"
                aria-live="polite"
                className={status?.error ? "model-feedback error" : "model-feedback"}
                data-plugin-status={status?.error ? "error" : "info"}
              >
                {status?.text ??
                  (dirty
                    ? "有未保存修改（模型与窗口的即点即写不在此列），点「保存配置」确认。"
                    : "当前配置已保存。测试和保存是两种独立操作。")}
              </p>
              <small>测试和保存是两种独立操作</small>
            </div>
            <div className="model-actions">
              {/*
                「删除」只是说明插件模型的移除路径：插件 provider 由插件提供，宿主没有
                「删除这张卡」的操作（停用/卸载插件才是正解），照旧用一行话把话说清。
              */}
              <button
                type="button"
                className="model-icon-button danger"
                data-plugin-action="delete"
                aria-label="删除这个插件模型配置"
                title="停用或卸载插件即可移除"
                onClick={() =>
                  setStatus({ error: false, text: "插件模型由插件提供，停用或卸载插件即可移除。" })
                }
              >
                🗑
              </button>
              <button
                type="button"
                className="model-button primary"
                data-plugin-action="save"
                aria-label="保存配置"
                disabled={!dirty || pending === "test"}
                onClick={saveDraft}
              >
                保存配置
              </button>
            </div>
          </footer>
        </>
      ) : null}
    </article>
  )
}
