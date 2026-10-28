/**
 * 钩子机制的类型契约（设计 §5、§5.6）。
 *
 * 与 `plugins_hooks()` 的 Rust 侧返回**逐字段对齐**（camelCase）：清单由 Rust 透传，
 * 前端若在这里换一层命名，每个消费点都要做一次翻译，漏改一处就是「默认值静默失效」
 * 这种最难查的 bug。
 *
 * 本目录与 `declarative/` 同一纪律：**纯逻辑**，不 import `@tauri-apps/api`、不碰
 * `window`、不读文件、不发请求。只有 `api.ts` 例外（它存在的唯一职责就是包命令）。
 * 这样 `dispatcher.ts` / `prompt-impl.ts` 能被 Vitest（`environment: "node"`）直接单测，
 * 不需要假造 Tauri 运行时。
 */
import type { LlmCaller } from "../declarative/run"

/**
 * 十个事件，分成设计 §5.1 的四组。
 *
 * 为什么是**固定枚举**而不是任意字符串：钩子的超时预算、是否能改上下文、失败是
 * fail-open 还是 fail-closed，全都按事件决定。允许插件自造事件名，就等于允许它
 * 落进一个"没有任何预算与失败策略"的黑洞 —— 那比不支持更危险。
 */
export type HookEvent =
  | "beforeLlmRequest"
  | "afterLlmResponse"
  | "beforeChapterDraft"
  | "afterChapterDraft"
  | "beforeReview"
  | "afterReview"
  | "beforePolish"
  | "afterPolish"
  | "onLlmUsage"
  | "onChapterCompleted"

/** 全部事件（供归一化/校验使用，顺序与上同）。 */
export const HOOK_EVENTS: readonly HookEvent[] = [
  "beforeLlmRequest",
  "afterLlmResponse",
  "beforeChapterDraft",
  "afterChapterDraft",
  "beforeReview",
  "afterReview",
  "beforePolish",
  "afterPolish",
  "onLlmUsage",
  "onChapterCompleted",
]

/** 事件默认超时（毫秒）。与 Rust 侧 `HOOK_EVENTS` 表保持一致（设计 §5.3 独立预算）。 */
export const HOOK_DEFAULT_TIMEOUT_MS: Record<HookEvent, number> = {
  beforeLlmRequest: 8_000,
  afterLlmResponse: 8_000,
  beforeChapterDraft: 15_000,
  afterChapterDraft: 15_000,
  beforeReview: 15_000,
  afterReview: 15_000,
  beforePolish: 15_000,
  afterPolish: 15_000,
  onLlmUsage: 2_000,
  onChapterCompleted: 2_000,
}

/**
 * 观测类事件：只读，不允许改上下文（改了也无效）。
 *
 * 为什么把「只读」做成硬规则而不是约定：这类钩子的用途是上报用量/成本、提醒超预算。
 * 一旦它能改上下文，就等于在"生成已经结束"的时刻还能改写结果 —— 预算提醒插件
 * 顺手把正文改短（"省点钱"）就成了完全合法且无法复现的行为。
 * 观测就是观测：看得见、改不动。
 */
export const OBSERVER_EVENTS: readonly HookEvent[] = ["onLlmUsage", "onChapterCompleted"]

/** 是否为已知事件（第三方 JSON 归一化用；未知事件名一律丢弃而不是兜底）。 */
export function isHookEvent(value: unknown): value is HookEvent {
  return typeof value === "string" && (HOOK_EVENTS as readonly string[]).includes(value)
}

/** 是否为观测事件（只读）。 */
export function isObserverEvent(event: HookEvent): boolean {
  return OBSERVER_EVENTS.includes(event)
}

/** 钩子的两种实现（设计 D5：让 80% 的钩子保持零代码）。 */
export type HookImpl = "prompt" | "process"

/** 清单里一条 `hooks[]` 声明（`PluginHookView.hook` 的形状）。 */
export interface PluginHookDeclaration {
  on: HookEvent
  impl: HookImpl
  /** `impl: "prompt"` 必填：提示词模板，必须含 `{{text}}`（否则宿主不知道处理哪段原文）。 */
  template?: string
  /** `impl: "process"` 必填：要调用的插件工具名。 */
  tool?: string
  /** 默认 0；**小的先跑**（设计 D7）。 */
  priority?: number
  /** 缺省按事件默认值（见 `HOOK_DEFAULT_TIMEOUT_MS`）。 */
  timeoutMs?: number
  /**
   * 默认 `false`（fail-open）；`true` 表示"门禁"：超时/报错视为**未通过**，
   * 直接阻断本次流程（fail-closed）。
   *
   * 为什么门禁必须 opt-in：绝大多数钩子是增强型（去 AI 味、注入系统提示词），
   * 插件写坏一个正则就把整本书的生成卡住，是最典型的"第三方代码绑架主流程"。
   * 只有作者明确声明"我是门禁"（内容合规、字数下限这类），宿主的失败策略才翻转。
   */
  gate?: boolean
}

/** `plugins_hooks()` 返回的一项：插件身份 + 一条钩子声明。 */
export interface PluginHookView {
  pluginId: string
  pluginName: string
  hook: PluginHookDeclaration
}

/** 请求/响应里的模型负载（与设计 §5.6 的 `llm` 字段同形状）。 */
export interface HookLlmPayload {
  provider: string
  model: string
  messages: Array<{ role: string; content: string }>
  temperature?: number
  maxTokens?: number
}

/** 钩子拿到的上下文（宿主在调用点构造）。 */
export interface HookContext {
  event: HookEvent
  project?: { bookTitle?: string; bookIntro?: string; bookTags?: string[] }
  chapter?: { id?: string; title?: string; text?: string }
  /** 请求前：可改；响应后：只读（用于给钩子看"上游回了什么"）。 */
  llm?: HookLlmPayload
  /** 响应后：可改。 */
  response?: { text: string }
  /** 观测：只读。 */
  usage?: { promptTokens?: number; completionTokens?: number; model?: string; provider?: string }
}

/**
 * 钩子只允许改声明过的字段；未声明即忽略。
 *
 * 刻意**不含** `project` / `chapter` / `usage`：这三个是"事实"，不是"产物"。
 * 允许钩子改它们，等于让第三方代码伪造项目信息或用量数字 —— 用量是他们自己上报的，
 * 再让他们改汇总口径，成本面板就彻底不可信了。
 */
export interface HookPatch {
  /**
   * `messages` 是**替换**语义（不是拼接）；`temperature` / `maxTokens` 覆盖。
   *
   * 见 `dispatcher.ts` 里 `applyPatch` 的注释：为什么必须替换而不是拼接。
   */
  llm?: Partial<Pick<HookLlmPayload, "messages" | "temperature" | "maxTokens">>
  response?: { text: string }
}

/** 钩子的执行结果。 */
export interface HookResult {
  patch?: HookPatch
  /** 显式阻断（只有 gate 钩子生效）。 */
  block?: { reason: string }
}

/**
 * 调度器的可注入依赖。
 *
 * 为什么全是注入：调度器本身要做"排序、串行、超时、patch 合并、失败策略"这些
 * 与宿主无关的判定，唯一的外部世界接触点是三件事 —— 调模型、调插件工具、读插件配置。
 * 把它们收成三个函数，单测就能在 Node 里把 10 条行为逐条钉死，不需要真模型、
 * 也不需要 MCP。
 */
export interface HookDeps {
  /** 声明式 prompt 实现要用的模型调用器（复用 `declarative/run` 的 `LlmCaller`）。 */
  llm: LlmCaller
  /**
   * process 实现：调插件工具，返回文本。
   *
   * 注意这是**文本进文本出**：P2 的 process 钩子不能返回 `block`，只能靠抛错表达
   * "我没能力判断/我失败了"。显式阻断只对 prompt 之外的实现留了口子
   * （见 `HookDeps.runHookImpl`）。
   */
  invokePluginTool: (pluginId: string, tool: string, args: Record<string, unknown>) => Promise<string>
  getConfig: (pluginId: string) => Promise<Record<string, unknown>>
  /** 打日志用；缺省 `console.warn`。 */
  onWarn?: (message: string) => void
  /**
   * **可选**的实现注入点：给定钩子直接产出 `HookResult`。
   *
   * 为什么留这个口子（而不是只认 prompt/process 两种）：
   *   1. 单测要覆盖"gate 钩子显式 block / 非 gate 钩子乱 block"这两条语义，
   *      而两个默认实现都只能抛出错误（`invokePluginTool` 只能返回字符串），
   *      不留注入点这两条规则就永远测不到 —— 测不到的规则等于没实现；
   *   2. 将来代码型钩子要返回结构化结果（阻断理由、多个 patch）时，宿主只需接这里，
   *      不必改调度器。
   * 宿主默认不传（`undefined` → 按 `impl` 分派到 prompt/process）。
   */
  runHookImpl?: HookImplRunner
}

/** 一个钩子实现：拿到上下文与中止信号，产出结果。 */
export type HookImplRunner = (
  entry: PluginHookView,
  context: HookContext,
  signal: AbortSignal,
) => Promise<HookResult>

/**
 * 单个钩子的超时：`hook.timeoutMs` → `options.timeoutMsOverride[event]` → 事件默认值。
 *
 * 非法值（NaN / 0 / 负数）按"没写"处理：`timeoutMs: 0` 若被当成"立即超时"，
 * 插件作者少写一个数字就会让钩子永远不生效；若被当成"不限时"，一个死循环的
 * 钩子就能把整条生成流水线挂住。两种猜测都不该由宿主替作者做，退回事件默认值最安全。
 */
export function resolveHookTimeoutMs(
  event: HookEvent,
  hookTimeoutMs?: number,
  override?: Partial<Record<HookEvent, number>>,
): number {
  const candidates = [hookTimeoutMs, override?.[event]]
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return candidate
    }
  }
  return HOOK_DEFAULT_TIMEOUT_MS[event]
}
