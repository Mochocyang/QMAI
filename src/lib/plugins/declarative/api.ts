/**
 * 声明式插件的 Tauri 命令封装（C1 阶段）。
 *
 * **本文件的头号职责是"命令可能还没注册"**：Rust 侧的 `plugins_actions` /
 * `plugins_content_packs` / `plugins_config_*` 是另一个并行任务在加。前端先落地，
 * 就必须做到"命令不存在时界面照常渲染"——否则一个空列表都看不到的插件中心，
 * 会被误判成"整个插件系统挂了"。
 *
 * 容错口径分两类，**故意不一样**：
 *   - **读**命令失败 → 返回空数组/空对象 + `console.warn`，并标 `degraded`，
 *     让 UI 能说"能力清单暂时取不到"（而不是假装"没有插件能力"）；
 *   - **写**命令失败 → 返回 `{ ok: false, error }`，**不吞错**。写操作静默失败
 *     等于骗用户"已保存"，那比报错严重得多。Rust 返回的中文原文一律原样带出。
 *
 * 另有一条硬约束：命令返回的第三方 JSON 在这里统一**归一化**（`normalizeActionDeclaration`
 * 等），组件只认领域对象。理由和 `form.ts` 一样——插件清单是第三方写的，
 * 脏数据必须在入口处收住，不能漏进渲染层。
 */
import { useCallback, useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { parseContentPack } from "./content-pack"
import { normalizeForm } from "./form"
import { readChapterContext, readProjectContext, readSelectionContext } from "./host-context"
import { createStreamChatLlmCaller } from "./llm-bridge"
import type { LlmCaller, RunActionDeps } from "./run"
import type {
  ActionOutput,
  ActionPrompt,
  ContentPack,
  ContentPackItem,
  DeclarativeAction,
  OutputMode,
  OutputTarget,
  OutputTargetKind,
} from "./types"
import { buildSlotIndex, type SlotIndex, type SlotActionEntry, type SlotPackEntry } from "../slots"

/**
 * 读命令失败时的统一提示（`console.warn` 用，不直接展示给用户）。
 *
 * **每个命令只 warn 一次**：命令还没注册时，宿主每次挂载插槽都会失败一次
 * （大纲面板、插件中心…），逐次打印会把控制台刷满，把真正的错误埋掉。
 * 第一条带完整堆栈，够定位；后续静默降级，行为不变。
 */
const warnedCommands = new Set<string>()

function warnCommandUnavailable(command: string, cause: unknown): void {
  if (warnedCommands.has(command)) return
  warnedCommands.add(command)
  console.warn(
    `[plugins] 命令 ${command} 不可用（可能尚未注册），已按空结果降级，界面不受影响：`,
    cause,
  )
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function positiveInt(value: unknown): number | undefined {
  const num = finiteNumber(value)
  if (num === undefined) return undefined
  const floored = Math.floor(num)
  return floored > 0 ? floored : undefined
}

/* ------------------------------------------------------------------ *
 * 领域归一化：第三方 JSON → 宿主可用的对象
 * ------------------------------------------------------------------ */

/** 允许的输出目标（设计 D2：**枚举**，不是路径）。 */
const OUTPUT_TARGET_KINDS = ["project-field", "insert-at-cursor", "clipboard", "chapter-note"] as const

/**
 * 内容包条目还能额外用 `run-action`（设计 §4.1「让 AI 扩写」）。
 *
 * 与 action 的 `output.targets` **分开**：前者是"再跑一个 action"，后者是
 * "写点什么"。写通道的白名单多一个入口，就多一条要考虑覆盖确认的路。
 */
const CONTENT_ITEM_TARGET_KINDS = [...OUTPUT_TARGET_KINDS, "run-action"] as const

/** 目标没写 label 时的兜底文案：按钮上不能出现空字符串。 */
const OUTPUT_TARGET_LABELS: Record<OutputTargetKind, string> = {
  "project-field": "写入项目字段",
  "insert-at-cursor": "插入到光标处",
  clipboard: "复制",
  "chapter-note": "追加到章节备注",
  "run-action": "运行动作",
}

/** 未知/缺失的 mode 一律按 `text` 处理（设计 D3 的同类原则：不因写错就整条作废）。 */
function normalizeOutputMode(value: unknown): OutputMode {
  return value === "list" || value === "json" || value === "text" ? value : "text"
}

/**
 * 归一化一组 target。
 *
 * @param allowed 允许的 kind 白名单：action 的 `output.targets` 用写通道那份，
 *                内容包条目的操作额外允许 `run-action`。
 */
function normalizeTargets(
  value: unknown,
  allowed: readonly OutputTargetKind[] = OUTPUT_TARGET_KINDS,
): OutputTarget[] {
  if (!Array.isArray(value)) return []
  const targets: OutputTarget[] = []
  for (const raw of value) {
    const target = asRecord(raw)
    if (!target) continue
    const kind = target.kind
    if (typeof kind !== "string" || !(allowed as readonly string[]).includes(kind)) {
      // 不认识的 kind 直接丢弃：它是写入通道的白名单，多放一个就是多一条写权限
      console.warn(`[plugins] 丢弃未知的输出目标 kind：`, kind)
      continue
    }
    const normalized: OutputTarget = {
      kind: kind as OutputTargetKind,
      label: nonEmptyString(target.label) ?? OUTPUT_TARGET_LABELS[kind as OutputTargetKind],
    }
    const field = nonEmptyString(target.field)
    if (field !== undefined) normalized.field = field
    if (target.confirm === true) normalized.confirm = true
    // `actionId` 只对 `run-action` 有意义；其它 kind 带着它是写错，丢掉。
    // 缺 actionId 的 run-action 仍然收下（label 还在），由 `isRunnableTarget`
    // 在渲染期判定为不可运行并禁用按钮 —— 直接丢弃会让作者以为声明被吃了。
    if (kind === "run-action") {
      const actionId = nonEmptyString(target.actionId)
      if (actionId !== undefined) normalized.actionId = actionId
    }
    targets.push(normalized)
  }
  return targets
}

function normalizeOutput(value: unknown): ActionOutput {
  const source = asRecord(value)
  const output: ActionOutput = {
    mode: normalizeOutputMode(source?.mode),
    targets: normalizeTargets(source?.targets),
  }
  if (source?.presentation === "chips" || source?.presentation === "markdown" || source?.presentation === "plain") {
    output.presentation = source.presentation
  }
  const maxItems = positiveInt(source?.maxItems)
  if (maxItems !== undefined) output.maxItems = maxItems
  if (source?.schema !== undefined) output.schema = source.schema
  return output
}

function normalizePrompt(value: unknown): ActionPrompt {
  const source = asRecord(value)
  return {
    system: typeof source?.system === "string" ? source.system : "",
    user: typeof source?.user === "string" ? source.user : "",
  }
}

/**
 * 把一条 action 声明归一化成领域对象；不可用时返回 `undefined`（由调用方丢弃并 warn）。
 *
 * 只硬性要求 `id`：`title` 缺了用 id 兜底，`prompt` 缺了给空串（模型会拿到空消息，
 * 由 Rust 侧/校验器去拒绝这种清单）。前端不做第二套校验，否则两处结论会漂移。
 */
export function normalizeActionDeclaration(raw: unknown): DeclarativeAction | undefined {
  const source = asRecord(raw)
  if (!source) return undefined

  const id = nonEmptyString(source.id)
  if (id === undefined) return undefined

  const action: DeclarativeAction = {
    id,
    title: nonEmptyString(source.title) ?? id,
    prompt: normalizePrompt(source.prompt),
    output: normalizeOutput(source.output),
  }

  const description = nonEmptyString(source.description)
  if (description !== undefined) action.description = description
  const slot = nonEmptyString(source.slot)
  if (slot !== undefined) action.slot = slot

  // 表单归一化统一走 `form.ts`（不在这里重写一套）：空字段的表单等同于"没有表单"，
  // 否则界面会显示一个只有标题的空白对话框。
  const form = normalizeForm(source.form)
  if (form.fields.length > 0) action.form = form

  const limits = asRecord(source.limits)
  if (limits) {
    const normalized: NonNullable<DeclarativeAction["limits"]> = {}
    const timeoutMs = positiveInt(limits.timeoutMs)
    if (timeoutMs !== undefined) normalized.timeoutMs = timeoutMs
    const maxOutputTokens = positiveInt(limits.maxOutputTokens)
    if (maxOutputTokens !== undefined) normalized.maxOutputTokens = maxOutputTokens
    if (Object.keys(normalized).length > 0) action.limits = normalized
  }

  return action
}

/**
 * `plugins_actions()` 的原始返回项。
 *
 * Rust 侧透传 `pluginId` / `pluginName` / `packId`（说明来源），action 本体可能
 * 嵌在 `action` 字段里，也可能平铺在同一层。两种形状都收：契约由并行的 Rust
 * 任务最终决定，前端先两种都认，能避免"命令一上线界面就空白"。
 */
export interface DeclarativeActionWire {
  pluginId?: string
  pluginName?: string
  packId?: string
  /** 嵌套形状：Rust 透传的 action 原文 */
  action?: unknown
  /** 扁平形状：action 字段直接写在顶层 */
  id?: string
  title?: string
  slot?: string
  form?: unknown
  prompt?: unknown
  output?: unknown
  limits?: unknown
  description?: string
}

/** `plugins_content_packs()` 的原始返回项（同样允许 `id` / `packId` 两种键名）。 */
export interface ContentPackMeta {
  pluginId?: string
  pluginName?: string
  packId?: string
  id?: string
  title?: string
  description?: string
  slot?: string
  maxItems?: number
  /** 内容包自带的条目操作（`insert-at-cursor` / `project-field` / `run-action`） */
  actions?: unknown
}

/** 内容包条目的操作：写通道那四种 + `run-action`（见 `CONTENT_ITEM_TARGET_KINDS`）。 */
function normalizePackActions(value: unknown): OutputTarget[] {
  return normalizeTargets(value, CONTENT_ITEM_TARGET_KINDS)
}

/** wire → 插槽条目；action 本体不合法时返回 `undefined`。 */
export function toSlotActionEntry(wire: DeclarativeActionWire): SlotActionEntry | undefined {
  const pluginId = nonEmptyString(wire?.pluginId) ?? "unknown"
  const action = normalizeActionDeclaration(wire?.action !== undefined ? wire.action : wire)
  if (!action) {
    console.warn(`[plugins] 丢弃来源插件 ${pluginId} 的一条无效 action 声明`, wire)
    return undefined
  }
  return { pluginId, pluginName: nonEmptyString(wire?.pluginName) ?? pluginId, action }
}

/**
 * wire → 插槽内容包条目。
 *
 * `items` 一律置空：内容包可能有几千条，插件中心不该为了显示一个包名就把全部条目
 * 拉进内存（真正要看的条目由 `ContentPackBrowser` 按需 `plugins_content_pack_items` 取）。
 */
export function toSlotPackEntry(meta: ContentPackMeta): SlotPackEntry | undefined {
  const pluginId = nonEmptyString(meta?.pluginId) ?? "unknown"
  /*
   * `pack.id` 用**包自己声明的 id**，取条目用的宿主键放在 `loadKey`。
   *
   * 这两者必须分开：Rust 的 `plugins_content_pack_items` 只认合成键
   * `<pluginId>/<packId>`，而 `pack.id` 是包在清单里的身份。把合成键写进
   * `pack.id` 会让任何"按 id 反查/去重/比对包声明"的代码静默错位 ——
   * 那是把后端的一个实现细节漏进了领域对象。
   */
  const packId = nonEmptyString(meta?.id) ?? nonEmptyString(meta?.packId)
  if (packId === undefined) {
    console.warn(`[plugins] 丢弃来源插件 ${pluginId} 的一条无 id 内容包声明`, meta)
    return undefined
  }
  const loadKey = nonEmptyString(meta?.packId) ?? `${pluginId}/${packId}`
  const pack: ContentPack = {
    id: packId,
    title: nonEmptyString(meta?.title) ?? packId,
    items: [],
  }
  const description = nonEmptyString(meta?.description)
  if (description !== undefined) pack.description = description
  const slot = nonEmptyString(meta?.slot)
  if (slot !== undefined) pack.slot = slot
  const actions = normalizePackActions(meta?.actions)
  if (actions.length > 0) pack.actions = actions
  return { pluginId, pluginName: nonEmptyString(meta?.pluginName) ?? pluginId, pack, loadKey }
}

/* ------------------------------------------------------------------ *
 * 命令封装
 * ------------------------------------------------------------------ */

/** 写命令的结果：**不抛错、不吞错**（错误原文交给 UI 展示）。 */
export interface CommandResult {
  ok: boolean
  error?: string
}

function describeCause(cause: unknown): string {
  if (typeof cause === "string" && cause.trim()) return cause
  if (cause instanceof Error && cause.message.trim()) return cause.message
  if (cause === null || cause === undefined) return "命令执行失败，请重试。"
  try {
    return JSON.stringify(cause)
  } catch {
    return String(cause)
  }
}

interface ReadResult<T> {
  value: T
  /** 命令本身失败（含未注册）：UI 可以据此区分"没有能力"与"取不到能力列表"。 */
  degraded: boolean
}

async function readCommand<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  normalize: (raw: unknown) => T,
  fallback: T,
): Promise<ReadResult<T>> {
  let raw: unknown
  try {
    raw = args === undefined ? await invoke<unknown>(command) : await invoke<unknown>(command, args)
  } catch (cause) {
    warnCommandUnavailable(command, cause)
    return { value: fallback, degraded: true }
  }
  try {
    return { value: normalize(raw), degraded: false }
  } catch (cause) {
    // 命令成功但数据形状超出预期：按空结果处理，保留 warn 供排查
    console.warn(`[plugins] 命令 ${command} 返回的数据无法解析，已按空结果处理：`, cause)
    return { value: fallback, degraded: false }
  }
}

async function writeCommand(command: string, args: Record<string, unknown>): Promise<CommandResult> {
  try {
    await invoke<unknown>(command, args)
    return { ok: true }
  } catch (cause) {
    return { ok: false, error: describeCause(cause) }
  }
}

function normalizeWireList(raw: unknown): DeclarativeActionWire[] {
  return Array.isArray(raw) ? (raw.filter((item) => asRecord(item)) as DeclarativeActionWire[]) : []
}

function normalizePackMetaList(raw: unknown): ContentPackMeta[] {
  return Array.isArray(raw) ? (raw.filter((item) => asRecord(item)) as ContentPackMeta[]) : []
}

/**
 * 解析内容包条目。
 *
 * Rust 命令约定返回**字符串**（文件原文），因此这里要自己 `JSON.parse`；
 * 但为了不被"某天改成直接返回对象"打穿，两种形状都收。解析失败按空数组处理：
 * 一个坏包不该让整个灵感库白屏。
 */
function normalizeContentPackItems(packId: string, raw: unknown): ContentPackItem[] {
  let parsed: unknown = raw
  if (typeof raw === "string") {
    if (raw.trim() === "") return []
    try {
      parsed = JSON.parse(raw)
    } catch (cause) {
      console.warn(`[plugins] 内容包 ${packId} 的 JSON 解析失败，已按空包处理：`, cause)
      return []
    }
  }
  const result = parseContentPack(parsed, { id: packId, title: packId, maxItems: undefined })
  if (!result.ok) {
    console.warn(`[plugins] 内容包 ${packId} 校验失败，已按空包处理：`, result.errors)
    return []
  }
  return result.pack.items
}

/** 内部读接口：带 degraded 标记，供 `loadSlotIndex` 使用。 */
const readers = {
  actions: () =>
    readCommand<DeclarativeActionWire[]>("plugins_actions", undefined, normalizeWireList, []),
  contentPacks: () =>
    readCommand<ContentPackMeta[]>("plugins_content_packs", undefined, normalizePackMetaList, []),
}

/**
 * 声明式插件相关的命令封装。
 *
 * 每个方法的容错口径都在上面注释里写明；调用方不需要写 try/catch 也能保证不崩。
 */
export const declarativePluginsApi = {
  /** 所有插件的 action 声明（含来源插件信息）。失败 → `[]`。 */
  actions: async (): Promise<DeclarativeActionWire[]> => (await readers.actions()).value,

  /** 所有插件的内容包元信息（不含条目）。失败 → `[]`。 */
  contentPacks: async (): Promise<ContentPackMeta[]> => (await readers.contentPacks()).value,

  /** 某个内容包的条目。失败/坏包 → `[]`。 */
  contentPackItems: async (packId: string): Promise<ContentPackItem[]> => {
    const { value } = await readCommand(
      "plugins_content_pack_items",
      { packId },
      (raw) => normalizeContentPackItems(packId, raw),
      [],
    )
    return value
  },

  /** 读插件配置（secret 字段由 Rust 返回空串，不会回真值）。失败 → `{}`。 */
  configGet: async (pluginId: string): Promise<Record<string, unknown>> => {
    const { value } = await readCommand(
      "plugins_config_get",
      { pluginId },
      (raw) => asRecord(raw) ?? {},
      {},
    )
    return value
  },

  /** 保存插件配置（Rust 侧按 configSchema 校验）。 */
  configSet: (pluginId: string, value: Record<string, unknown>): Promise<CommandResult> =>
    writeCommand("plugins_config_set", { pluginId, value }),

  /** 单独设置密钥字段（不落盘，走 Rust 内存）。 */
  configSecretSet: (pluginId: string, field: string, value: string): Promise<CommandResult> =>
    writeCommand("plugins_config_secret_set", { pluginId, field, value }),

  /** 某密钥字段是否已设置。失败 → `false`（界面上不显示"已设置"比错误显示安全）。 */
  configSecretHas: async (pluginId: string, field: string): Promise<boolean> => {
    const { value } = await readCommand(
      "plugins_config_secret_has",
      { pluginId, field },
      (raw) => raw === true,
      false,
    )
    return value
  },
}

/** 插槽索引 + 加载状态。 */
export interface PluginSlotIndexState {
  index: SlotIndex
  loading: boolean
  /** 至少一个命令不可用（未注册/失败）—— UI 该说"暂时取不到"，而不是"没有能力"。 */
  degraded: boolean
  reload: () => void
}

/**
 * 加载插槽索引。
 *
 * 同一插件可能在多个包里重复声明同一个 action（`packId` 不同），这里按
 * `插件id:action id` 去重：插槽里出现两个一模一样的按钮，用户会以为可以点两次。
 */
export async function loadSlotIndex(): Promise<{ index: SlotIndex; degraded: boolean }> {
  const [actionsRead, packsRead] = await Promise.all([readers.actions(), readers.contentPacks()])

  const seenActions = new Set<string>()
  const actionEntries: SlotActionEntry[] = []
  for (const wire of actionsRead.value) {
    const entry = toSlotActionEntry(wire)
    if (!entry) continue
    const key = `${entry.pluginId}:${entry.action.id}`
    if (seenActions.has(key)) continue
    seenActions.add(key)
    actionEntries.push(entry)
  }

  const packEntries: SlotPackEntry[] = []
  for (const meta of packsRead.value) {
    const entry = toSlotPackEntry(meta)
    if (!entry) continue
    packEntries.push(entry)
  }

  return {
    index: buildSlotIndex(actionEntries, packEntries),
    degraded: actionsRead.degraded || packsRead.degraded,
  }
}

/**
 * React 侧的插槽索引加载器。
 *
 * 为什么放在 api 层而不是某个组件里：`plugin-section` 与 `outline-chat-panel`
 * 两个挂载点都要这份数据，写在组件里就会出现"两套加载逻辑、两种失败表现"。
 * 这里只负责取数与状态，渲染仍由 `SlotActions` / `ContentPackBrowser` 决定。
 */
export function usePluginSlotIndex(): PluginSlotIndexState {
  const [index, setIndex] = useState<SlotIndex>(() => buildSlotIndex([], []))
  const [loading, setLoading] = useState(true)
  const [degraded, setDegraded] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void loadSlotIndex()
      .then((result) => {
        if (cancelled) return
        setIndex(result.index)
        setDegraded(result.degraded)
      })
      .catch((cause: unknown) => {
        // loadSlotIndex 自己已经吞掉了命令错误；能走到这里说明是意料之外的 bug，
        // 仍然只 warn：插件能力是附加功能，不该把宿主界面拖垮。
        if (cancelled) return
        console.warn("[plugins] 加载插槽索引失败：", cause)
        setDegraded(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const reload = useCallback(() => setReloadKey((value) => value + 1), [])

  return { index, loading, degraded, reload }
}

/**
 * 组装执行依赖的默认实现。
 *
 * 组件（`SlotActions` / `ContentPackBrowser`）在没人显式传 `deps` 时用它：
 * 配置读取走真实命令、模型调用走**用户当前选中的那个模型**（与平常聊天同一条
 * 链路）、项目/章节上下文读宿主 store。任何一项都允许被覆盖 —— 测试与将来的
 * "指定模型"策略都从这里注入，不必改组件。
 *
 * 为什么不去掉这个"默认实现"、让每个挂载点自己拼：六个插槽 + 插件中心 + 灵感库
 * 都会挂 action，各拼一份必然出现"某处用了别的模型/没读项目"的静默差异，
 * 而这类差异只有用户能发现（"为什么同样一个按钮，在大纲页能用、章节页不能用"）。
 */
export function createDefaultRunDeps(
  options: Partial<Omit<RunActionDeps, "llm">> & { llm?: LlmCaller } = {},
): RunActionDeps {
  return {
    llm: options.llm ?? createStreamChatLlmCaller(),
    readProject: options.readProject ?? readProjectContext,
    readChapter: options.readChapter ?? readChapterContext,
    getSelection: options.getSelection ?? readSelectionContext,
    getConfig: options.getConfig ?? ((pluginId: string) => declarativePluginsApi.configGet(pluginId)),
  }
}
