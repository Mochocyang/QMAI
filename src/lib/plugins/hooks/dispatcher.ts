/**
 * 钩子调度器（设计 §5.3 / §5.4 / §5.6）。
 *
 * 它要回答的只有几个问题，但每一个错了都会以"偶发难以复现"的形式出现在线上：
 *
 *   跑哪些（过滤 on）→ 什么顺序（priority + pluginId）→ 怎么跑（串行、每钩子独立超时）
 *   → 结果怎么合并（替换而非拼接）→ 失败怎么办（gate 才 fail-closed）
 *
 * **为什么这个文件不 import `@tauri-apps/api`**：调度判定与宿主无关，把它焊在
 * Tauri 上，10 条行为就只能靠手工验收（而不是单测）。命令封装在 `api.ts`，
 * 依赖在 `HookDeps` 里注入。
 */
import {
  isObserverEvent,
  resolveHookTimeoutMs,
  type HookContext,
  type HookDeps,
  type HookEvent,
  type HookImplRunner,
  type HookPatch,
  type HookResult,
  type PluginHookView,
} from "./types"
import { buildHookTextPatch, resolveHookText, runPromptHook } from "./prompt-impl"

/**
 * `HookDeps` 定义在 `types.ts`（数据形状集中一处），这里 re-export 让调用方
 * 仍然可以只从 `hooks/dispatcher` 拿到全部需要的类型。
 */
export type { HookDeps, HookImplRunner } from "./types"

/** 外部取消时的失败原因（界面直接展示，必须是中文人话）。 */
const CANCELLED_REASON = "已取消：用户中止，未继续执行钩子"

export interface RunHooksOptions {
  /** 外部取消（用户点了停止）。 */
  signal?: AbortSignal
  /** 覆盖事件默认超时（测试用）。 */
  timeoutMsOverride?: Partial<Record<HookEvent, number>>
}

export interface RunHooksOutcome {
  /** 应用了 patch 之后的上下文（观测事件原样返回）。 */
  context: HookContext
  /** 是否有 gate 钩子阻断了流程。 */
  blocked?: { reason: string; pluginId: string }
  /** 实际执行成功的钩子数（不含跳过/超时）。 */
  ran: number
  /** 出错的钩子（超时/抛错），供界面提示"某插件未生效"。 */
  failures: Array<{ pluginId: string; pluginName: string; reason: string }>
}

/* ------------------------------------------------------------------ *
 * 1. 过滤 + 2. 排序
 * ------------------------------------------------------------------ */

function priorityOf(entry: PluginHookView): number {
  const priority = entry?.hook?.priority
  // NaN/缺失一律当 0：NaN 参与比较会让 sort 的比较函数自相矛盾（顺序随引擎实现变化）。
  return typeof priority === "number" && Number.isFinite(priority) ? priority : 0
}

/**
 * 插件 id 的字典序比较。
 *
 * **刻意不用 `localeCompare`**：它依赖运行环境的 ICU 数据与默认 locale，
 * 同一份插件集在不同机器/不同 Node 版本上可能排出不同顺序。钩子顺序决定
 * "谁最后改了 prompt"，跨机器不一致的确定性等于没有确定性。
 * 直接比较大小只认 UTF-16 码元，任何环境结果都一样。
 */
function compareIds(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * 排序：`priority` 升序（小的先跑），同 priority 按 `pluginId` 字典序。
 *
 * 三级 tie-break 字段都相同时（同一插件在同一事件上声明了两条钩子）依赖
 * `Array.prototype.sort` 的稳定性：保持清单里的原始声明顺序，仍然可复现。
 */
export function compareHookEntries(a: PluginHookView, b: PluginHookView): number {
  const byPriority = priorityOf(a) - priorityOf(b)
  if (byPriority !== 0) return byPriority
  const aId = typeof a?.pluginId === "string" ? a.pluginId : ""
  const bId = typeof b?.pluginId === "string" ? b.pluginId : ""
  return compareIds(aId, bId)
}

/**
 * 选出要跑这一事件的钩子并按确定性顺序排好。
 *
 * 为什么不按"事件组"批量跑（设计 D7）：串行保证可预测 —— 并行会让"谁改了 prompt"
 * 无法复现，而钩子恰恰是一个能改 prompt 的机制。
 */
export function selectEventHooks(
  entries: readonly PluginHookView[],
  event: HookEvent,
): PluginHookView[] {
  const list = Array.isArray(entries) ? entries : []
  return list
    .filter((entry) => Boolean(entry) && Boolean(entry.hook) && entry.hook.on === event)
    .sort(compareHookEntries)
}

/* ------------------------------------------------------------------ *
 * 5. patch 合并
 * ------------------------------------------------------------------ */

/** 把失败的 `unknown` 变成一行中文可读原因（沿用 llm-bridge 的口径）。 */
function describeFailure(cause: unknown): string {
  if (typeof cause === "string" && cause.trim() !== "") return cause.trim()
  if (cause instanceof Error && cause.message.trim() !== "") return cause.message.trim()
  if (cause === null || cause === undefined) return "未知错误"
  try {
    return JSON.stringify(cause)
  } catch {
    return String(cause)
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

type WarnFn = (message: string) => void

/**
 * 合并 `llm` 部分的 patch。
 *
 * **`messages` 采用替换语义，不是拼接** —— 这是本文件最重要的一条决定：
 * 拼接会让后面的钩子越改越长（每个钩子都能看到别人加的东西，再"顺手续"一段），
 * 十个钩子就是十段互相引用的提示词；更糟的是结果依赖"谁先跑"，而钩子的顺序
 * 由 priority 决定，作者改一个数字整本书的提示词就变了。替换则让"最后一个改
 * messages 的钩子胜出"成为一条**可预测、可复现**的规则：任何一个钩子拿到的始终是
 * 原始请求（或上一个钩子明确交出的完整版本），而不是一坨累积物。
 */
function applyLlmPatch(
  llm: NonNullable<HookContext["llm"]>,
  patch: NonNullable<HookPatch["llm"]>,
  entry: PluginHookView,
  warn: WarnFn,
): NonNullable<HookContext["llm"]> {
  let next = llm

  if (patch.messages !== undefined) {
    if (!Array.isArray(patch.messages) || patch.messages.length === 0) {
      // 空消息列表会让上游直接报 400（没有任何内容可回答），这是把"钩子写错"
      // 放大成"整个请求失败"的最短路径。忽略并警告。
      warn(`[plugins] 「${entry.pluginName}」返回的 llm.messages 为空或非法，已忽略（保留原消息）。`)
    } else {
      // 逐个复制：不把插件的数组/对象引用直接收进上下文，避免它事后改自己的返回值
      // 影响已经合并好的上下文（那种 bug 只在并发调用时出现）。
      next = {
        ...next,
        messages: patch.messages.map((message) => ({
          role: typeof message?.role === "string" ? message.role : "user",
          content: typeof message?.content === "string" ? message.content : "",
        })),
      }
    }
  }

  if (patch.temperature !== undefined) {
    if (isFiniteNumber(patch.temperature) && patch.temperature >= 0) {
      next = { ...next, temperature: patch.temperature }
    } else {
      warn(`[plugins] 「${entry.pluginName}」返回的 temperature 非法，已忽略。`)
    }
  }

  if (patch.maxTokens !== undefined) {
    if (isFiniteNumber(patch.maxTokens) && patch.maxTokens > 0) {
      next = { ...next, maxTokens: Math.floor(patch.maxTokens) }
    } else {
      warn(`[plugins] 「${entry.pluginName}」返回的 maxTokens 非法，已忽略。`)
    }
  }

  return next
}

/**
 * 应用一个钩子的 patch，返回**新**上下文。
 *
 * 三条守则：
 *   1. 只认 `HookPatch` 声明过的字段（`llm` / `response`）。插件返回值里多带的
 *      `usage` / `project` / `chapter` 一律看不到效果 —— 那些是宿主事实。
 *   2. `llm` 的 patch 必须有 llm 上下文可改（响应后事件没有 llm，改了也无处安放）；
 *      `response` 允许新建：工作流事件的接缝就是靠宿主读 `context.response?.text`
 *      拿到改写结果的（见 `buildHookTextPatch`）。
 *   3. 空文本一律忽略：`patch.response.text = ""` 等于静默清空正文。
 */
function applyPatch(
  context: HookContext,
  patch: HookPatch | undefined,
  entry: PluginHookView,
  warn: WarnFn,
): HookContext {
  if (!patch || typeof patch !== "object") return context

  let next = context

  if (patch.llm !== undefined) {
    if (!context.llm) {
      warn(
        `[plugins] 「${entry.pluginName}」在 ${context.event} 上返回了 llm patch，但该事件没有请求上下文，已忽略。`,
      )
    } else {
      next = { ...next, llm: applyLlmPatch(context.llm, patch.llm, entry, warn) }
    }
  }

  if (patch.response !== undefined) {
    const text = patch.response?.text
    if (typeof text !== "string") {
      warn(`[plugins] 「${entry.pluginName}」返回的 response.text 不是字符串，已忽略。`)
    } else if (text.trim() === "") {
      warn(`[plugins] 「${entry.pluginName}」返回了空的 response.text，已忽略（空文本会清空正文）。`)
    } else {
      next = { ...next, response: { text } }
    }
  }

  return next
}

/* ------------------------------------------------------------------ *
 * 6/7. 单钩子执行：独立超时 + 真取消
 * ------------------------------------------------------------------ */

type HookAttempt =
  | { kind: "ok"; result: HookResult }
  | { kind: "failed"; reason: string }
  | { kind: "cancelled" }

/**
 * process 实现：调插件工具，返回文本。
 *
 * **MCP 侧无法被前端真取消**（这是本文件唯一做不到 D6 的地方，必须写明）：
 * 真正的中止只能由宿主向插件发 MCP `notifications/cancelled`，那是 Rust 侧的事。
 * 前端这一层能做的只有两件：把 `signal` 尽早判一次（还没发出去就别发了），
 * 以及超时后**放手不等** —— 绝不能让一个卡住的插件工具把整条生成流水线挂住。
 * 副作用是：插件进程可能仍在跑它自己的活，因此 process 钩子的工具实现必须幂等。
 */
async function runProcessHook(
  entry: PluginHookView,
  context: HookContext,
  deps: HookDeps,
  signal: AbortSignal,
): Promise<HookResult> {
  const tool = typeof entry.hook.tool === "string" ? entry.hook.tool.trim() : ""
  if (tool === "") {
    throw new Error("钩子缺少 tool：impl 为 process 时必须提供要调用的插件工具名。")
  }
  if (signal.aborted) throw new Error("钩子已取消，未发起工具调用。")

  /*
   * 参数形状：清单里的 hook 只有 `tool`，没有参数映射表，所以把"事件 + 当前原文 +
   * 可用的上下文"原样交给工具，由工具按自己的 inputSchema 取用。
   * 这是 P2 的让步：真要做声明式参数映射，应该在清单里加 `args` 字段，而不是在宿主
   * 里按工具名硬编码（硬编码等于把插件能力写死在宿主里）。
   */
  const args: Record<string, unknown> = { event: context.event }
  // 与 prompt 实现共用同一套"原文是什么"的规则：两种 impl 必须给出一致答案，
  // 否则作者换 impl 时行为会变，而清单里看不出任何差别。
  const source = resolveHookText(context)
  if (source !== undefined) args.text = source
  if (context.project) args.project = context.project
  if (context.chapter) args.chapter = context.chapter
  if (context.llm) args.llm = context.llm
  if (context.response) args.response = context.response
  if (context.usage) args.usage = context.usage

  const raw = await deps.invokePluginTool(entry.pluginId, tool, args)
  const text = typeof raw === "string" ? raw : ""
  if (text.trim() === "") {
    throw new Error("钩子工具返回了空结果：不把空文本当作有效改写。")
  }
  return { patch: buildHookTextPatch(context, text) }
}

/**
 * 按 `impl` 分派到默认实现（`deps.runHookImpl` 未注入时的默认路径）。
 */
function defaultRunner(deps: HookDeps): HookImplRunner {
  return async (entry, context, signal) => {
    if (entry.hook.impl === "prompt") return runPromptHook(entry.hook, entry.pluginId, context, deps, signal)
    if (entry.hook.impl === "process") return runProcessHook(entry, context, deps, signal)
    throw new Error(`未知的钩子实现：${String((entry.hook as { impl?: unknown }).impl)}`)
  }
}

/**
 * 跑一个钩子，带独立超时与真取消。
 *
 * 三件事必须同时成立，任何一条漏掉都会让"超时"变成装饰：
 *   1. 每个钩子一个 `AbortController`，超时就 `abort()` —— 信号会一路传到
 *      `deps.llm.call` 的 `fetch`，请求真的停下（设计 D6）。
 *   2. 调度器**不再等**这个钩子（`Promise.race`），无论它是否响应中止。
 *      真实世界里"真取消"与"立即放手"是两道保险，缺一道都可能挂住流水线。
 *   3. 外部取消（用户点停止）也接到同一个 controller 上，让在跑的钩子立刻收手。
 *
 * 为什么先看 `timedOut` / `externalAborted` 标志而不是只看 race 的胜者：
 * `abort()` 会让实现几乎立刻 reject（AbortError），它的微任务可能抢在超时
 * promise 之前被 resolve —— 只看胜者会把"超时"误报成"插件报错"，用户看到的
 * 提示就变成了"某插件出错"，而他其实什么都没改。
 */
async function attemptHook(
  entry: PluginHookView,
  context: HookContext,
  runner: HookImplRunner,
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
): Promise<HookAttempt> {
  const controller = new AbortController()
  let timedOut = false
  let externalAborted = false

  let timer: ReturnType<typeof setTimeout> | undefined
  const onExternalAbort = () => {
    externalAborted = true
    controller.abort()
  }
  if (externalSignal) externalSignal.addEventListener("abort", onExternalAbort, { once: true })

  const timeoutSignal = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      timedOut = true
      // 真取消：先 abort 再 resolve，让在跑的 fetch 立刻断掉。
      controller.abort()
      resolve("timeout")
    }, timeoutMs)
  })

  const cancelSignal = new Promise<"cancelled">((resolve) => {
    // 没有外部信号时这个 promise 永远不 resolve（不占资源，随 GC 回收）。
    if (!externalSignal) return
    if (externalSignal.aborted) {
      resolve("cancelled")
      return
    }
    externalSignal.addEventListener("abort", () => resolve("cancelled"), { once: true })
  })

  const work = (async (): Promise<HookAttempt> => {
    try {
      return { kind: "ok", result: await runner(entry, context, controller.signal) }
    } catch (cause) {
      // 这里必须**吃掉**异常并转成结果：超时之后被放弃的那个 promise 若还 reject，
      // Node 会把它报成 unhandled rejection，一次正常超时就会刷屏成"程序异常"。
      return { kind: "failed", reason: describeFailure(cause) }
    }
  })()

  try {
    await Promise.race([work, timeoutSignal, cancelSignal])
    if (timedOut) {
      return { kind: "failed", reason: `钩子超时（超过 ${timeoutMs}ms），已取消并跳过` }
    }
    if (externalAborted) return { kind: "cancelled" }
    return await work
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    externalSignal?.removeEventListener("abort", onExternalAbort)
  }
}

/** 钩子之间让出事件循环（设计 §5.4：串行但不阻塞 UI）。 */
async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

/**
 * 按事件跑一遍钩子。
 *
 * 失败策略（设计 §5.1）：
 *   - 加 `gate: true` → fail-closed：超时/报错记 failures 并**阻断**；
 *   - 其余（含观测事件）→ fail-open：记 failures，用当前上下文继续下一个。
 * 观测事件永远是 fail-open：它是通知，不是门禁。
 */
export async function runHooks(
  entries: PluginHookView[],
  context: HookContext,
  deps: HookDeps,
  options: RunHooksOptions = {},
): Promise<RunHooksOutcome> {
  const warn: WarnFn = deps.onWarn ?? ((message: string) => console.warn(message))
  const signal = options.signal
  const failures: RunHooksOutcome["failures"] = []

  let working = context
  let ran = 0

  const selected = selectEventHooks(entries, context.event)

  if (signal?.aborted) {
    // 一个钩子都不跑：用户已经点了停止，再发模型请求就是"边停止边计费"。
    // failures 里留一条，让界面能解释"为什么这次没有任何插件生效"。
    failures.push({ pluginId: "", pluginName: "", reason: CANCELLED_REASON })
    return { context: working, ran: 0, failures }
  }

  if (selected.length === 0) return { context: working, ran, failures }

  const runner = deps.runHookImpl ?? defaultRunner(deps)
  const observer = isObserverEvent(context.event)

  for (const entry of selected) {
    if (signal?.aborted) {
      failures.push({ pluginId: entry.pluginId, pluginName: entry.pluginName, reason: CANCELLED_REASON })
      break
    }

    const timeoutMs = resolveHookTimeoutMs(context.event, entry.hook.timeoutMs, options.timeoutMsOverride)
    const attempt = await attemptHook(entry, working, runner, timeoutMs, signal)

    if (attempt.kind === "cancelled") {
      failures.push({ pluginId: entry.pluginId, pluginName: entry.pluginName, reason: CANCELLED_REASON })
      break
    }

    if (attempt.kind === "failed") {
      failures.push({
        pluginId: entry.pluginId,
        pluginName: entry.pluginName,
        reason: attempt.reason,
      })
      if (entry.hook.gate === true && !observer) {
        // 门禁：一次失败就是"未通过"，后面的钩子和整条流程都不该继续。
        return {
          context: working,
          blocked: { reason: attempt.reason, pluginId: entry.pluginId },
          ran,
          failures,
        }
      }
      // fail-open：跳过这一个，用**当前**上下文继续（不是回滚，也不是丢弃别人已做的修改）。
      await yieldToEventLoop()
      continue
    }

    ran += 1
    const result = attempt.result ?? {}

    if (observer) {
      /*
       * 观测事件：patch 一律忽略 + 警告一次。
       * 为什么是"忽略并告诉作者"而不是"默默忽略"：作者可能真的以为能靠
       * onLlmUsage 改模型名来"省 token"。静默忽略会让他在几周后才发现这个钩子
       * 从来没生效过；一次 warn 是这条规则唯一的落地证据。
       */
      if (result.patch) {
        warn(
          `[plugins] 「${entry.pluginName}」在观测事件 ${context.event} 上返回了 patch，已忽略：观测事件只读。`,
        )
      }
      if (result.block) {
        warn(
          `[plugins] 「${entry.pluginName}」在观测事件 ${context.event} 上请求阻断，已忽略：观测事件只通知不决策。`,
        )
      }
      await yieldToEventLoop()
      continue
    }

    if (result.block) {
      if (entry.hook.gate === true) {
        // 只有门禁钩子的 block 才算数：这是"opt-in 失败策略"的另一半 ——
        // 增强型钩子无权替用户决定"这次生成不要做了"。
        return {
          context: working,
          blocked: {
            reason: typeof result.block.reason === "string" && result.block.reason.trim() !== ""
              ? result.block.reason
              : `插件「${entry.pluginName}」的钩子请求阻断流程`,
            pluginId: entry.pluginId,
          },
          ran,
          failures,
        }
      }
      warn(
        `[plugins] 「${entry.pluginName}」不是门禁钩子（gate 未开启），返回的 block 已忽略，流程继续。`,
      )
    }

    working = applyPatch(working, result.patch, entry, warn)
    await yieldToEventLoop()
  }

  return { context: working, ran, failures }
}
