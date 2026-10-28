/**
 * 插槽注册表（设计 §6.1 / §6.2）。
 *
 * 插槽是**宿主与插件之间唯一的 UI 契约面**：插件只能在 6 个预先定好的位置里
 * 放两种东西 —— `action`（按钮，点开是宿主渲染的表单/对话框）与 `contentPack`
 * （内容包，宿主渲染的浏览面板）。**不接受任意 UI**。
 *
 * 这里刻意保持纯函数：不 import React、不 import `@tauri-apps/api`。
 * 理由有两条：
 *   1. 本仓 Vitest 是 `environment: "node"`，纯函数能直接单测；
 *   2. 拉数据的部分（命令可能还没注册）单独在 `declarative/api.ts` 里容错，
 *      注册表本身不该知道"命令是否可用"这件事 —— 它只负责"把给定内容排好队"。
 *
 * 为什么插槽内**绝不加载插件 HTML / iframe**：Tier 1 插件的全部价值在于"零执行"。
 * 一旦允许插件自带标记或脚本，宿主就等于把 XSS 面、样式污染面和 CSP 破口一起
 * 打开，密码、项目正文、模型密钥全在同一个 webview 里。插槽里只渲染宿主组件，
 * 插件能控制的只有**数据**（标题、提示词、条目文本），永远控制不到 DOM。
 */
import type { ContentPack, DeclarativeAction } from "./declarative/types"

/**
 * 允许的插槽常量。**先定 6 个，写进契约，不随便加**（设计 §6.1）。
 *
 * 加一个插槽 = 一次对外承诺：宿主每次改这个位置的结构，都要保证老插件不被
 * 静默打断（所以设计 §6.2 同时要求插槽带版本号）。
 */
export const SLOT_IDS = [
  "chapter-toolbar",
  "inspiration-browser",
  "editor-context-menu",
  "outline-toolbar",
  "analysis-toolbar",
  "plugin-center",
] as const

export type SlotId = (typeof SLOT_IDS)[number]

/**
 * 未声明 `slot` 时的默认插槽。
 *
 * 选 `plugin-center` 而不是"丢弃"：作者忘写 slot 时，用户仍能在插件中心找到
 * 这个能力（可见、可点、可反馈），比按钮凭空消失好得多。而**写错** slot
 * （拼错/写了没发布的插槽）则必须丢弃 —— 那说明作者的意图是"放到别处"，
 * 强行塞进插件中心会让作者误以为插槽生效了，永远发现不了拼写错误。
 */
export const DEFAULT_SLOT_ID: SlotId = "plugin-center"

/**
 * 插槽版本（设计 §6.2）。宿主升级插槽语义时 bump；当前全部为 1。
 *
 * 前端目前只做展示与提示，真正的"版本不足则拒绝渲染"由 Rust 侧校验清单的
 * `requiresSlot` 完成 —— 两边都存一份常量，是为了将来前端要判断时不必先发一版后端。
 */
export const SLOT_API_VERSIONS: Record<SlotId, number> = {
  "chapter-toolbar": 1,
  "inspiration-browser": 1,
  "editor-context-menu": 1,
  "outline-toolbar": 1,
  "analysis-toolbar": 1,
  "plugin-center": 1,
}

/** 插槽的中文名，供「插件能力」区、日志与提示文案复用（避免各处各写一套）。 */
export const SLOT_LABELS: Record<SlotId, string> = {
  "chapter-toolbar": "章节工具栏",
  "inspiration-browser": "灵感库",
  "editor-context-menu": "编辑器右键菜单",
  "outline-toolbar": "大纲工具栏",
  "analysis-toolbar": "拆书库工具栏",
  "plugin-center": "插件中心",
}

/** 插槽里的一项 action：带上"来自哪个插件"，因为插槽里可能并列多个插件的按钮。 */
export interface SlotActionEntry {
  pluginId: string
  pluginName: string
  action: DeclarativeAction
}

/** 插槽里的一项内容包。`pack.items` 可能是空的（懒加载），由浏览器面板按需取。 */
export interface SlotPackEntry {
  pluginId: string
  pluginName: string
  pack: ContentPack
}

export interface SlotBucket {
  actions: SlotActionEntry[]
  packs: SlotPackEntry[]
}

/** 6 个插槽的完整索引：**每个 SlotId 都必须有桶**，消费方不必判空。 */
export type SlotIndex = Record<SlotId, SlotBucket>

/** 判断一个字符串是不是允许的插槽 id（清单校验、容错解析都靠它）。 */
export function isSlotId(value: unknown): value is SlotId {
  return typeof value === "string" && (SLOT_IDS as readonly string[]).includes(value)
}

/** 空索引：6 个插槽全部就位但都为空，消费方可以直接 `.actions.map(...)`。 */
export function emptySlotIndex(): SlotIndex {
  const index = {} as SlotIndex
  for (const slot of SLOT_IDS) index[slot] = { actions: [], packs: [] }
  return index
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "zh")
}

/**
 * 桶内排序：插件名 → 标题 → id。
 *
 * **为什么必须显式排序**：`plugins_actions()` 的返回顺序取决于插件注册表
 * （HashMap/目录遍历），每次刷新都可能不同。不排序的话，用户每打开一次面板，
 * 按钮就在跳 —— 这种"界面在动"的观感会被当成"软件不稳定"。
 *
 * 末尾再按 id 兜底，是为了让"同名同插件"的两项也有确定顺序（全序，而不是
 * "大多时候稳定"）。
 */
function compareActionEntries(a: SlotActionEntry, b: SlotActionEntry): number {
  return (
    compareText(a.pluginName, b.pluginName) ||
    compareText(a.action.title, b.action.title) ||
    compareText(a.action.id, b.action.id) ||
    compareText(a.pluginId, b.pluginId)
  )
}

function comparePackEntries(a: SlotPackEntry, b: SlotPackEntry): number {
  return (
    compareText(a.pluginName, b.pluginName) ||
    compareText(a.pack.title, b.pack.title) ||
    compareText(a.pack.id, b.pack.id) ||
    compareText(a.pluginId, b.pluginId)
  )
}

/**
 * 决定一项内容进哪个插槽。
 *
 * - 没写 `slot`（undefined / 空串）→ 默认插槽（见 `DEFAULT_SLOT_ID` 的注释）
 * - 写了但不认识 → 丢弃 + `console.warn`（作者拼错了，宿主没有地方放它，
 *   硬塞会让"插槽生效了"变成错觉）
 */
function resolveSlotId(declared: unknown, describe: string): SlotId | undefined {
  if (declared === undefined || declared === null) return DEFAULT_SLOT_ID
  if (typeof declared !== "string") {
    console.warn(`[plugins] ${describe} 的 slot 不是字符串，已丢弃该项：`, declared)
    return undefined
  }
  const trimmed = declared.trim()
  if (trimmed === "") return DEFAULT_SLOT_ID
  if (!isSlotId(trimmed)) {
    console.warn(`[plugins] ${describe} 声明了未知插槽「${trimmed}」，已丢弃该项`)
    return undefined
  }
  return trimmed
}

/**
 * 从 action / pack 列表构建插槽索引。
 *
 * 入参已经是"归一化后的领域对象"（由 `declarative/api.ts` 把命令返回的原始
 * JSON 转好）：注册表不解析第三方 JSON，也不做降级 —— 那些都是加载层的责任。
 */
export function buildSlotIndex(
  actions: readonly SlotActionEntry[],
  packs: readonly SlotPackEntry[],
): SlotIndex {
  const index = emptySlotIndex()

  for (const entry of actions ?? []) {
    const slot = resolveSlotId(
      entry?.action?.slot,
      `action「${entry?.pluginId ?? "?"}/${entry?.action?.id ?? "?"}」`,
    )
    if (!slot) continue
    index[slot].actions.push(entry)
  }

  for (const entry of packs ?? []) {
    const slot = resolveSlotId(
      entry?.pack?.slot,
      `contentPack「${entry?.pluginId ?? "?"}/${entry?.pack?.id ?? "?"}」`,
    )
    if (!slot) continue
    index[slot].packs.push(entry)
  }

  for (const slot of SLOT_IDS) {
    index[slot].actions.sort(compareActionEntries)
    index[slot].packs.sort(comparePackEntries)
  }

  return index
}

/** 取一个插槽的桶（索引里必定存在，这里只是省掉调用方的 `!`）。 */
export function slotBucket(index: SlotIndex, slotId: SlotId): SlotBucket {
  return index[slotId] ?? { actions: [], packs: [] }
}
