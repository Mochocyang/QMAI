import type { LlmConfig } from "@/stores/wiki-store"
import { isAzureOpenAiEndpoint } from "@/lib/azure-openai"
import {
  getEffectiveMaxContextSize,
  getEffectiveMaxOutputTokens,
  isTruncationFinishReason,
  parseOpenAiSseError,
  resolveProviderConfig,
  thinkingMinMaxTokens,
  type ChatMessage,
  type RequestOverrides,
} from "./llm-providers"
import { getHttpFetch, isFetchNetworkError } from "./tauri-fetch"
import { isUserAbortError } from "./user-abort"
import { isTauriInvalidResourceIdError } from "./tauri-resource-error"
import { countReasoningCharsInLine, extractReasoningTextFromLine } from "./reasoning-detector"
import {
  formatReasoningReplayRiskForError,
  isReasoningContentRequiredError,
  logReasoningReplay,
  summarizeReasoningReplayRisk,
} from "./reasoning-replay-debug"
import { resolveRuntimeLocalCliConfig } from "./local-cli-config"
import { ensureCursorProxyRunning, withCursorProxyEndpoint } from "./cursor-cli-proxy"
import {
  estimateChatMessagesTokens,
  estimateRequestScaffoldTokens,
  trimChatMessagesToTokenBudget,
} from "./chat-request-budget"
import { RESPONSE_RESERVE_FRAC, planLlmRequestBudget } from "./context-budget"
import { mergeLlmUsageSnapshot, type LlmUsage } from "./llm-usage"
import {
  hasUnreplayableToolAssistantReasoning,
  isReasoningDisabled,
  stripEmptyReasoningContent,
  withReasoningDisabled,
} from "./reasoning-retry"
import { applyGlobalUserMemoryToMessages } from "./user-memory/request-integration"
import { preparePromptCacheRouting } from "./prompt-cache-routing"
import type { UserMemoryDecision } from "./user-memory/decision-trace"
import {
  buildLlmRequestCacheTrace,
  buildLlmRequestPrefixDescriptor,
  type LlmRequestCacheTrace,
  type LlmRequestTraceStatus,
} from "./llm-request-trace"
import { withWritingWakeLock } from "./writing-wake-lock"
import { runEventHooks, takeHooksFor } from "./plugins/hooks/runtime"
import type { HookLlmPayload, PluginHookView } from "./plugins/hooks/types"

export type { ChatMessage, RequestOverrides } from "./llm-providers"

export type { LlmUsage } from "./llm-usage"

export interface StreamCallbacks {
  onToken: (token: string) => void
  onReasoningToken?: (token: string) => void
  /** 工具调用流式 delta，用于累积 tool_calls */
  onToolCallDelta?: (delta: { index: number; id?: string; name?: string; arguments?: string }) => void
  /** Provider reported finish reason for the current response. */
  onFinishReason?: (reason: string) => void
  onUsage?: (usage: LlmUsage) => void
  /** Sanitized request-level timing/cache trace; never contains prompt text or credentials. */
  onRequestTrace?: (trace: LlmRequestCacheTrace) => void
  /** Decision produced while preparing this request's messages (request-scoped). */
  onUserMemoryDecision?: (decision: UserMemoryDecision | null) => void
  /**
   * 流结束。
   *
   * 参数是 `afterLlmResponse` 插件钩子**改写后**的正文；没有钩子、没有改写、
   * 或本次是取消/截断结束时一律为 `undefined`（此时行为与引入钩子前逐字相同）。
   *
   * 为什么用"追加一个可选参数"而不是新开回调：`() => void` 的既有实现全部
   * 自然兼容（少写参数不会报错），不需要改几十个调用点就能上线；而愿意换用
   * 改写结果的调用方（目前是 agent runner，即主聊天路径）显式接收即可。
   *
   * ⚠️ 消费方必须自己判断能否**替换**已显示文本：绝大多数调用点把 `onToken`
   * 增量追加进自己的累加器，界面上已经是原文，拿 `finalText` 直接追加会变成
   * "正文重复一遍"。只有"整段文本在流结束后才落地"的调用方才能安全使用它。
   */
  onDone: (finalText?: string) => void
  onError: (error: Error) => void
}

// Lazy import keeps the Tauri event/invoke bindings out of bundles that
// never touch the subprocess provider (e.g. vitest with a fetch mock).
async function streamViaClaudeCodeCli(
  config: LlmConfig,
  messages: import("./llm-providers").ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  requestOverrides?: RequestOverrides,
) {
  const mod = await import("./claude-cli-transport")
  return mod.streamClaudeCodeCli(config, messages, callbacks, signal, requestOverrides)
}

async function streamViaAntigravityCli(
  config: LlmConfig,
  messages: import("./llm-providers").ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  requestOverrides?: RequestOverrides,
) {
  const mod = await import("./antigravity-cli-transport")
  return mod.streamAntigravityCli(config, messages, callbacks, signal, requestOverrides)
}

async function streamViaCodexCli(
  config: LlmConfig,
  messages: import("./llm-providers").ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  requestOverrides?: RequestOverrides,
) {
  const mod = await import("./codex-cli-transport")
  return mod.streamCodexCli(config, messages, callbacks, signal, requestOverrides)
}

const NETWORK_RETRY_DELAYS_MS = [30_000, 60_000, 90_000, 120_000]
export const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 30 * 60 * 1000

/**
 * Stable marker for token-limit truncation errors. Callers that want to
 * tolerate truncation (keep the partial text and offer "继续") match on
 * this prefix — see outline-chat-panel's isLengthTruncated check.
 */
export const OUTPUT_TRUNCATED_ERROR_MARKER = "输出被截断"

function buildOutputTruncatedError(finishReason: string): Error {
  return new Error(
    `${OUTPUT_TRUNCATED_ERROR_MARKER}：模型已达到最大输出 token 上限（finish_reason=${finishReason}）。` +
    `已生成的内容已保留，可输入"继续"让模型补全剩余部分，或提高最大输出 token 后重试。`,
  )
}

export function isOutputTruncatedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(OUTPUT_TRUNCATED_ERROR_MARKER)
}

function shouldRetryWithBrowserFetch(errorDetail: string): boolean {
  return /client not allowed/i.test(errorDetail) && /tauri-plugin-http/i.test(errorDetail)
}

function parseLines(chunk: Uint8Array, buffer: string, decoder: TextDecoder): [string[], string] {
  const text = buffer + decoder.decode(chunk, { stream: true })
  const lines = text.split("\n")
  const remaining = lines.pop() ?? ""
  return [lines, remaining]
}

function waitForRetry(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timeoutId)
      resolve(false)
    }
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve(true)
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function parseToolCallDeltasFromLine(
  line: string,
): Array<{ index: number; id?: string; name?: string; arguments?: string }> {
  const trimmed = line.trim()
  if (!trimmed.startsWith("data: ")) return []
  const data = trimmed.slice(6).trim()
  if (data === "[DONE]") return []
  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{
        delta?: {
          tool_calls?: Array<{
            index?: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
      }>
    }
    const toolCalls = parsed.choices?.[0]?.delta?.tool_calls ?? []
    return toolCalls.map((toolCall) => ({
      index: toolCall.index ?? 0,
      ...(toolCall.id !== undefined ? { id: toolCall.id } : {}),
      ...(toolCall.function?.name !== undefined ? { name: toolCall.function.name } : {}),
      ...(toolCall.function?.arguments !== undefined
        ? { arguments: toolCall.function.arguments }
        : {}),
    }))
  } catch {
    // A malformed SSE line is not fatal: skip it and keep the stream alive.
    // The only error reachable here is JSON.parse's SyntaxError.
    return []
  }
}

function parseInputLengthLimit(errorDetail: string): { inputLength: number; maxLength: number } | null {
  const match = /input length\s*([\d,]+)\s*exceeds(?:\s+the)?\s+maximum length\s*([\d,]+)/i.exec(errorDetail)
    ?? /input length\s*([\d,]+)\s*exceeds(?:\s+the)?\s+max(?:imum)?\s*([\d,]+)/i.exec(errorDetail)
  if (!match) return null
  const inputLength = Number(match[1]?.replace(/,/g, ""))
  const maxLength = Number(match[2]?.replace(/,/g, ""))
  if (!Number.isFinite(inputLength) || !Number.isFinite(maxLength) || maxLength <= 0) return null
  return { inputLength, maxLength }
}

function inputLengthLimitMessage(limit: { inputLength: number; maxLength: number }): string {
  return `输入内容过长：本次请求约 ${limit.inputLength} 字符，接口最大允许 ${limit.maxLength} 字符。请减少历史上下文、缩短章节正文，或确认当前接口是否真的支持所选模型的上下文长度。`
}

/**
 * Detect provider rejections of an oversized max_tokens / max_output_tokens
 * request. Returns the highest value the model will accept when the error
 * reports one; otherwise null.
 */
function parseMaxTokensLimit(errorDetail: string): number | null {
  const patterns = [
    /max[_ ]?(?:output[_ ]?)?tokens?\s*(?:of\s+|is\s+|=\s*)?([\d,]+)\s*(?:is\s+)?(?:too\s+(?:large|high)|exceeds|above|greater than)/i,
    /(?:max[_ ]?(?:output[_ ]?)?tokens?|maximum\s+output)\s*(?:must be|should be|limited to|capped at|<=|≤)\s*([\d,]+)/i,
    /(?:supports?|allows?|accepts?)\s+(?:at most|up to|a maximum of)\s*([\d,]+)\s*(?:output\s+)?tokens?/i,
    /max[_ ]?(?:completion|output)[_ ]?tokens?\s*(?:cannot exceed|must not exceed|<=|≤)\s*([\d,]+)/i,
    /(?:this model|model)\s+(?:has a )?(?:maximum|max)\s+(?:of\s+)?([\d,]+)\s*(?:output\s+)?tokens?/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(errorDetail)
    if (!match) continue
    const value = Number(match[1]?.replace(/,/g, ""))
    if (Number.isFinite(value) && value >= 512) return Math.floor(value)
  }
  return null
}

function isLocalCliProvider(provider: LlmConfig["provider"]): boolean {
  return provider === "claude-code" || provider === "codex-cli" || provider === "cursor-cli" || provider === "antigravity-cli"
}

/* ------------------------------------------------------------------ *
 * 插件钩子（设计 §5.1 / §5.6）
 *
 * 全部逻辑都写成"没有钩子就一行都不跑"的形态：入口用 `takeHooksFor()` 同步判定，
 * 返回 `null` 时调用点直接走原路径。这里是全应用最热的函数，任何"顺手 await 一下"
 * 都会把同步直通变成微任务，改变既有请求时序。
 * ------------------------------------------------------------------ */

/**
 * 钩子只认 `{ role, content: string }`：把多模态消息拍平成文本。
 *
 * `lossy` 标记"这次拍平丢了东西"（图片块→占位符）。丢过东西的请求**不允许**钩子
 * 改写消息：还原时图片会变成一行 `[image]` 占位符，用户的图就被插件系统悄悄删掉了。
 * 宁可这次钩子不生效。
 */
function flattenMessagesForHooks(messages: ChatMessage[]): {
  payload: HookLlmPayload["messages"]
  lossy: boolean
} {
  let lossy = false
  const payload = messages.map((message) => {
    if (typeof message.content === "string") {
      return { role: message.role, content: message.content }
    }
    lossy = true
    const text = message.content
      .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
      .join("\n")
    return { role: message.role, content: text }
  })
  return { payload, lossy }
}

/**
 * 跑 `beforeLlmRequest` 钩子并算出真正要发出去的消息与采样参数。
 *
 * 返回 `null` = 按原请求发（无钩子/无改写/钩子机制出错，fail-open）。
 * `gate` 钩子明确 block 时**抛**可读错误：用户必须看到"为什么这次没发出去"，
 * 而不是界面转一圈又安静地什么都没发生。
 */
async function runBeforeLlmRequestHooks(
  entries: PluginHookView[],
  config: LlmConfig,
  messages: ChatMessage[],
  overrides: RequestOverrides | undefined,
  signal: AbortSignal | undefined,
): Promise<{ messages: ChatMessage[]; overrides: RequestOverrides | undefined } | null> {
  const { payload, lossy } = flattenMessagesForHooks(messages)
  const outcome = await runEventHooks(
    entries,
    {
      event: "beforeLlmRequest",
      llm: {
        provider: typeof config.provider === "string" ? config.provider : "",
        model: typeof config.model === "string" ? config.model : "",
        messages: payload,
        ...(typeof overrides?.temperature === "number" ? { temperature: overrides.temperature } : {}),
        ...(typeof overrides?.max_tokens === "number" ? { maxTokens: overrides.max_tokens } : {}),
      },
    },
    { signal },
  )
  if (!outcome) return null

  if (outcome.blocked) {
    const reason = outcome.blocked.reason?.trim()
    throw new Error(
      reason
        ? `插件门禁未通过，本次请求已中止：${reason}`
        : "插件门禁未通过，本次请求已中止。",
    )
  }

  const patched = outcome.context.llm
  if (!patched) return null

  // 引用比较即"钩子到底改没改"：调度器的 `applyLlmPatch` 只在钩子给了 messages 时
  // 才建新数组，没给就沿用同一个引用。这样不必再深比较一份大消息列表。
  let nextMessages = messages
  if (patched.messages !== payload) {
    if (lossy) {
      console.warn(
        "[plugins] 本次请求包含非文本消息（图片等），已忽略 beforeLlmRequest 对 messages 的改写（拍平后无法还原）。",
      )
    } else {
      nextMessages = patched.messages.map((message) => ({
        role: message.role as ChatMessage["role"],
        content: message.content,
      }))
    }
  }

  let nextOverrides = overrides
  if (typeof patched.temperature === "number") {
    nextOverrides = { ...nextOverrides, temperature: patched.temperature }
  }
  if (typeof patched.maxTokens === "number") {
    // 交给原有预算链路去夹（`planLlmRequestBudget` 仍会按窗口/上限收敛），
    // 钩子只能"要求"，不能绕过宿主对输出上限的规划。
    nextOverrides = { ...nextOverrides, max_tokens: patched.maxTokens }
  }

  return nextMessages === messages && nextOverrides === overrides
    ? null
    : { messages: nextMessages, overrides: nextOverrides }
}

/**
 * 跑 `afterLlmResponse` 钩子，返回改写后的正文（`null` = 不改）。
 *
 * 只在"流正常结束"时调用：取消/截断/网络中断的收尾一律不适用 —— 那些情况下
 * 上层要的是原文，改写只会把"半截内容"包装成"看起来完整"。
 */
async function runAfterLlmResponseHooks(
  entries: PluginHookView[] | null,
  text: string,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  if (!entries || text.trim() === "") return null
  const outcome = await runEventHooks(entries, { event: "afterLlmResponse", response: { text } }, { signal })
  if (!outcome) return null
  if (outcome.blocked) {
    // 正文已经流给界面了，这时候"阻断"没有可撤回的东西。
    // 把一次成功的回复变成报错，只会让用户莫名丢掉已经看到的正文。
    console.warn(
      `[plugins] afterLlmResponse 的门禁钩子未通过（${outcome.blocked.reason || "无原因"}），但正文已流出，已忽略本次阻断。`,
    )
  }
  const rewritten = outcome.context.response?.text
  if (typeof rewritten !== "string" || rewritten.trim() === "" || rewritten === text) return null
  return rewritten
}

/**
 * 上报用量给 `onLlmUsage` 观测钩子（fire-and-forget）。
 *
 * 三件事必须成立：
 *   1. **不 await**：观测钩子的超时/卡顿绝不能挡住"用户看到回复"；
 *   2. 无钩子时零成本（`takeHooksFor` 同步判定，直接 return）；
 *   3. 钩子内部再调模型**不能**又上报一次用量（否则用量会指数级膨胀）——
 *      由 `runEventHooks` 内部的 bypass 标记 + `createHookDeps` 的双重保护负责。
 */
function notifyLlmUsageHooks(usage: LlmUsage | undefined, config: LlmConfig): void {
  if (!usage) return
  const entries = takeHooksFor("onLlmUsage")
  if (!entries) return
  void runEventHooks(
    entries,
    {
      event: "onLlmUsage",
      usage: {
        ...(typeof usage.inputTokens === "number" ? { promptTokens: usage.inputTokens } : {}),
        ...(typeof usage.outputTokens === "number" ? { completionTokens: usage.outputTokens } : {}),
        model: typeof config.model === "string" ? config.model : undefined,
        provider: typeof config.provider === "string" ? config.provider : undefined,
      },
    },
    {},
  ).catch(() => {
    /* runEventHooks 自己已经吞错；这里只是不留 unhandled rejection */
  })
}

/**
 * `streamChat` 的宿主级开关（**不进请求体**：放在第 6 个参数里而不是 `RequestOverrides`，
 * 因为 `stripWireAgnosticOverrides` 会把不认识的字段原样塞进请求体，那会让上游 400）。
 */
export interface StreamChatOptions {
  /**
   * 是否允许 `afterLlmResponse` 插件钩子改写本次回复的最终文本（经 `onDone(finalText)` 交付）。
   *
   * 默认**关闭**，只有"整段文本在流结束后才落地、且能安全替换"的调用方才开启
   * （目前是 agent runner，即主聊天路径）。理由：
   *   1. 多数内部调用只想要一段结构化结果（审稿 JSON、计划合规、记忆抽取），
   *      界面/下游并不会用改写后的文本；
   *   2. 钩子是一次**真实模型调用**。为一份没人使用的改写付费，比"钩子不生效"糟得多。
   */
  applyAfterLlmResponseHooks?: boolean
}

export async function streamChat(
  config: LlmConfig,
  messages: import("./llm-providers").ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  requestOverrides?: RequestOverrides,
  options?: StreamChatOptions,
): Promise<void> {
  return withWritingWakeLock(true, () => streamChatHeld(
    config,
    messages,
    callbacks,
    signal,
    requestOverrides,
    options,
  ))
}

async function streamChatHeld(
  config: LlmConfig,
  messages: import("./llm-providers").ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  /**
   * Wire-agnostic sampling knobs. The provider's buildBody() translates
   * these into its native schema — OpenAI-style wires accept them at
   * the top level ({temperature: 0.1}), Gemini nests them under
   * generationConfig with renamed keys ({generationConfig: {temperature: 0.1}}).
   * Previously we spread them onto the body here, which broke Gemini
   * with "Unknown name 'temperature': Cannot find field." HTTP 400.
   */
  requestOverrides?: RequestOverrides,
  options?: StreamChatOptions,
): Promise<void> {
  /*
   * ── 插件钩子 · 请求前（设计 §5.1） ──────────────────────────────────
   *
   * 三道护栏，缺一条都会出事故：
   *
   *   1. **零开销直通**：`takeHooksFor()` 同步读缓存清单，没钩子就返回 `null`，
   *      这个 if 之外一个 Promise 都不会建。绝不能写成 `await runHooks([])` ——
   *      那会把每次请求的同步直通变成一次微任务，悄悄改变整条链路的时序。
   *   2. **重入保护**：`impl: "prompt"` 的钩子自己会调模型 → 又回到这里。那次调用
   *      被标记为"钩子内部"，`takeHooksFor` 直接返回 `null`，否则钩子触发钩子 → 爆栈。
   *   3. **fail-open**：钩子机制自身出错只 warn（`runEventHooks` 内部吞错），
   *      用原请求继续。绝不能因为插件问题让用户发不出消息。
   *
   * 位置刻意放在最前面：钩子改写后的消息要参与后面的上下文裁剪与预算规划，
   * 否则"钩子塞进来的系统提示词"可能刚好把预算撑爆。
   */
  let requestMessages = messages
  let baseOverrides = requestOverrides
  const beforeLlmHooks = takeHooksFor("beforeLlmRequest")
  if (beforeLlmHooks) {
    const hooked = await runBeforeLlmRequestHooks(
      beforeLlmHooks,
      config,
      requestMessages,
      baseOverrides,
      signal,
    )
    if (hooked) {
      requestMessages = hooked.messages
      baseOverrides = hooked.overrides
    }
  }

  /*
   * `afterLlmResponse` 需要完整正文，所以只有"本次回复会作为最终文本落地"且真的装了
   * 这类钩子时才顺手累积一份 `collectedText`（`null` = 不累积，零开销）。
   *
   * 为什么默认不跑（见 `StreamChatOptions.applyAfterLlmResponseHooks`）：钩子是一次
   * 真实模型调用，而绝大多数内部调用根本不会用改写后的文本 —— 为一份被丢弃的结果
   * 付钱，比"钩子在这些调用上不生效"糟得多。
   */
  const afterLlmHooks = options?.applyAfterLlmResponseHooks
    ? takeHooksFor("afterLlmResponse")
    : null
  let collectedText: string | null = afterLlmHooks ? "" : null

  let runtimeConfig = await resolveRuntimeLocalCliConfig(config)
  const { messages: preparedMessages, decision: userMemoryDecision } = applyGlobalUserMemoryToMessages(
    requestMessages,
    baseOverrides,
  )
  callbacks.onUserMemoryDecision?.(userMemoryDecision)
  const configuredWindow = getEffectiveMaxContextSize(runtimeConfig)
  const toolScaffoldTokens = estimateRequestScaffoldTokens(baseOverrides?.tools)
  const outputCap = getEffectiveMaxOutputTokens(runtimeConfig)
  const thinkingFloorTokens = thinkingMinMaxTokens(runtimeConfig.reasoning ?? { mode: "auto" })
  const runtimeBudget = planLlmRequestBudget({
    maxContextSize: configuredWindow,
    desiredOutputTokens: baseOverrides?.max_tokens
      ?? Math.floor(configuredWindow * RESPONSE_RESERVE_FRAC),
    scaffoldReserveTokens: toolScaffoldTokens,
    minimumContextTokens: 64,
    maxOutputTokensCap: outputCap,
    thinkingFloorTokens,
  })
  let effectiveOutputTokens = runtimeBudget.outputTokens
  // HTTP providers always receive the planned max_tokens so every vendor
  // follows the same window-fraction rule. Local CLI transports have no
  // equivalent flag and warn in DEV when the field is present.
  const shouldSendMaxTokens = !isLocalCliProvider(runtimeConfig.provider)
  let budgetedMessages: import("./llm-providers").ChatMessage[]
  try {
    budgetedMessages = trimChatMessagesToTokenBudget(
      preparedMessages,
      runtimeBudget.inputTokenBudget - toolScaffoldTokens,
    )
  } catch {
    // Protected system/current-user content did not fit beside the desired output.
    // Retry locally with the 512-token floor; no provider request is made on failure.
    const minimumOutputTokens = 512
    const maximumInputTokens = runtimeBudget.windowTokens
      - toolScaffoldTokens
      - minimumOutputTokens
    budgetedMessages = trimChatMessagesToTokenBudget(
      preparedMessages,
      maximumInputTokens,
    )
    effectiveOutputTokens = Math.max(
      minimumOutputTokens,
      Math.min(
        runtimeBudget.outputTokens,
        runtimeBudget.windowTokens
          - toolScaffoldTokens
          - estimateChatMessagesTokens(budgetedMessages),
      ),
    )
  }
  let effectiveRequestOverrides: RequestOverrides = shouldSendMaxTokens
    ? { ...baseOverrides, max_tokens: effectiveOutputTokens }
    : (() => {
      const { max_tokens: _ignored, ...rest } = baseOverrides ?? {}
      return rest
    })()
  // thinking 开着却回传不了上一轮 tool-assistant 的思考时，空串/缺字段都会 400。
  // 先关 thinking 再发，比带着 "" 去撞接口更干净。
  if (
    !isReasoningDisabled(runtimeConfig, effectiveRequestOverrides) &&
    hasUnreplayableToolAssistantReasoning(budgetedMessages)
  ) {
    logReasoningReplay("request.disable_thinking_unreplayable", {
      model: runtimeConfig.model,
      ...summarizeReasoningReplayRisk(budgetedMessages),
    })
    effectiveRequestOverrides = withReasoningDisabled(effectiveRequestOverrides)
    budgetedMessages = stripEmptyReasoningContent(budgetedMessages)
  }
  const { onToken, onDone, onError } = callbacks
  const decoder = new TextDecoder()

  effectiveRequestOverrides = await preparePromptCacheRouting(runtimeConfig, budgetedMessages, effectiveRequestOverrides)
  let prefixDescriptor = await buildLlmRequestPrefixDescriptor(
    runtimeConfig,
    budgetedMessages,
    effectiveRequestOverrides,
  )
  interface ActiveRequestTrace {
    requestId: string
    startedAt: number
    firstResponseAt?: number
    finished: boolean
  }
  const startRequestTrace = (): ActiveRequestTrace => ({
    requestId: crypto.randomUUID(),
    startedAt: Date.now(),
    finished: false,
  })
  const markFirstResponse = (trace: ActiveRequestTrace | null | undefined) => {
    if (trace && trace.firstResponseAt === undefined) trace.firstResponseAt = Date.now()
  }
  const finishRequestTrace = (
    trace: ActiveRequestTrace | null | undefined,
    status: LlmRequestTraceStatus,
    usage?: LlmUsage,
  ) => {
    if (!trace || trace.finished) return
    trace.finished = true
    try {
      callbacks.onRequestTrace?.(buildLlmRequestCacheTrace({
        requestId: trace.requestId,
        config: runtimeConfig,
        ...prefixDescriptor,
        startedAt: trace.startedAt,
        finishedAt: Date.now(),
        firstResponseAt: trace.firstResponseAt,
        usage,
        status,
      }))
    } catch (error) {
      console.warn("LLM 请求追踪回调失败，忽略观测错误：", error)
    }
  }

  const streamLocalWithTrace = async (
    run: (localCallbacks: StreamCallbacks) => Promise<void>,
  ): Promise<void> => {
    const trace = startRequestTrace()
    let usage: LlmUsage | undefined
    const tracedCallbacks: StreamCallbacks = {
      ...callbacks,
      onToken: (token) => {
        markFirstResponse(trace)
        callbacks.onToken(token)
      },
      onReasoningToken: (token) => {
        markFirstResponse(trace)
        callbacks.onReasoningToken?.(token)
      },
      onToolCallDelta: (delta) => {
        markFirstResponse(trace)
        callbacks.onToolCallDelta?.(delta)
      },
      onUsage: (nextUsage) => {
        usage = mergeLlmUsageSnapshot(usage, nextUsage)
        callbacks.onUsage?.(nextUsage)
      },
      onDone: (finalText?: string) => {
        finishRequestTrace(trace, signal?.aborted ? "cancelled" : "success", usage)
        // 本地 CLI 传输目前不会产出钩子改写后的文本；透传参数只为保持契约一致。
        callbacks.onDone(finalText)
      },
      onError: (error) => {
        finishRequestTrace(trace, signal?.aborted ? "cancelled" : "error", usage)
        callbacks.onError(error)
      },
    }
    try {
      await run(tracedCallbacks)
    } catch (error) {
      finishRequestTrace(
        trace,
        signal?.aborted ? "cancelled" : isFetchNetworkError(error) ? "network_error" : "error",
        usage,
      )
      throw error
    }
  }

  // Claude Code CLI uses a subprocess transport (stdin/stdout), not
  // HTTP. Dispatch before getProviderConfig — that function throws for
  // this provider because it has no URL/headers.
  if (runtimeConfig.provider === "claude-code") {
    return streamLocalWithTrace((localCallbacks) =>
      streamViaClaudeCodeCli(runtimeConfig, budgetedMessages, localCallbacks, signal, effectiveRequestOverrides))
  }

  if (runtimeConfig.provider === "codex-cli") {
    return streamLocalWithTrace((localCallbacks) =>
      streamViaCodexCli(runtimeConfig, budgetedMessages, localCallbacks, signal, effectiveRequestOverrides))
  }

  if (runtimeConfig.provider === "antigravity-cli") {
    return streamLocalWithTrace((localCallbacks) =>
      streamViaAntigravityCli(runtimeConfig, budgetedMessages, localCallbacks, signal, effectiveRequestOverrides))
  }

  if (runtimeConfig.provider === "cursor-cli") {
    const endpoint = await ensureCursorProxyRunning(runtimeConfig)
    runtimeConfig = withCursorProxyEndpoint(runtimeConfig, endpoint)
  }

  // 账号登录类：先确保进程内网关在跑，再把地址与一次性令牌套进配置。
  // 与上面 cursor-cli 同构 —— 之后的链路把它当普通 OpenAI 供应方。
  if (runtimeConfig.provider === "workbuddy") {
    const { ensureWorkbuddyGateway, withWorkbuddyEndpoint } = await import("./workbuddy-gateway")
    const gateway = await ensureWorkbuddyGateway()
    runtimeConfig = withWorkbuddyEndpoint(runtimeConfig, gateway)
  }

  // 插件 provider 需要先现取 token（异步），所以统一走 resolveProviderConfig：
  // 内置 provider 与 getProviderConfig 等价，插件 provider 走 OpenAI 兼容适配器。
  const providerConfig = await resolveProviderConfig(runtimeConfig)

  // Combined abort: (a) user cancel, (b) our long-horizon timeout.
  // The long timeout is a backstop for truly stuck requests; it's NOT
  // what fires when a user sees "Timeout" after 2 seconds — that is
  // almost always a fast network failure (DNS, TLS, 404, refused) that
  // WebKit surfaces as a generic "Load failed". We track whether the
  // backstop actually fired so we can tell the two apart in the error.
  const timeoutMs = DEFAULT_LLM_REQUEST_TIMEOUT_MS // 30 min — generous backstop for huge-context reasoning models
  let combinedSignal = signal
  let timeoutController: AbortController | undefined
  let timeoutFired = false
  let onSignalAbort: (() => void) | undefined

  if (typeof AbortSignal.timeout === "function") {
    timeoutController = new AbortController()
    const timeoutId = setTimeout(() => {
      timeoutFired = true
      timeoutController?.abort()
    }, timeoutMs)

    if (signal) {
      onSignalAbort = () => {
        clearTimeout(timeoutId)
        timeoutController?.abort()
      }
      signal.addEventListener("abort", onSignalAbort)
    }
    combinedSignal = timeoutController.signal
  }

  try {
    let activeRequestTrace: ActiveRequestTrace | null = null
    const tracedFetch = async (
      fetcher: (url: string, init: RequestInit) => Promise<Response>,
      url: string,
      init: RequestInit,
    ): Promise<Response> => {
      const trace = startRequestTrace()
      try {
        const result = await fetcher(url, init)
        if (result.ok) {
          activeRequestTrace = trace
        } else {
          finishRequestTrace(trace, "error")
        }
        return result
      } catch (error) {
        finishRequestTrace(
          trace,
          signal?.aborted || (combinedSignal?.aborted && !timeoutFired)
            ? "cancelled"
            : isFetchNetworkError(error)
              ? "network_error"
              : "error",
        )
        throw error
      }
    }

    const buildRequestInit = (
      nextMessages: import("./llm-providers").ChatMessage[],
      overrides: RequestOverrides = effectiveRequestOverrides,
    ): RequestInit => ({
      method: "POST",
      headers: providerConfig.headers,
      body: JSON.stringify(providerConfig.buildBody(nextMessages, overrides)),
      signal: combinedSignal,
    })

    const sendRequest = async (requestInit: RequestInit): Promise<Response> => {
      const httpFetch = await getHttpFetch()
      let attempt = 0
      while (true) {
        try {
          return await tracedFetch(httpFetch, providerConfig.url, requestInit)
        } catch (err) {
          if (signal?.aborted || combinedSignal?.aborted) throw err
          if (!isFetchNetworkError(err)) throw err
          if (timeoutFired) throw err
          const retryDelay = NETWORK_RETRY_DELAYS_MS[attempt]
          if (retryDelay === undefined) {
            throw new Error(
              `无法连接到模型接口：软件已自动等待并重试约 5 分钟，但仍然连接失败。` +
              `常见原因是网络不稳定、代理不可用、接口地址无法访问、服务商网关暂时中断，或本机网络环境阻断了访问。` +
              `请检查网络、代理和接口地址后再重试。接口地址：${providerConfig.url}`,
            )
          }
          attempt += 1
          const shouldContinue = await waitForRetry(retryDelay, combinedSignal)
          if (!shouldContinue) throw err
        }
      }
    }

    const requestRisk = summarizeReasoningReplayRisk(budgetedMessages)
    if (requestRisk.assistantWithTools > 0) {
      logReasoningReplay("request.before_send", {
        url: providerConfig.url,
        model: runtimeConfig.model,
        messageCount: budgetedMessages.length,
        ...requestRisk,
      })
    }

    let requestInit = buildRequestInit(budgetedMessages)
    let response: Response
    try {
      response = await sendRequest(requestInit)
    } catch (err) {
      if (signal?.aborted || (combinedSignal?.aborted && !timeoutFired) || isTauriInvalidResourceIdError(err)) {
        onDone()
        return
      }
      if (err instanceof Error && err.name === "AbortError") {
        // Backstop timeout aborted the request (we tracked this via
        // timeoutFired); treat it as a real timeout rather than a cancel.
        if (timeoutFired) {
          onError(new Error(`Request timed out after ${Math.round(timeoutMs / 60000)} min. Try a faster model or a smaller context.`))
          return
        }
        onDone()
        return
      }
      if (isFetchNetworkError(err)) {
        if (timeoutFired) {
          onError(new Error(`Request timed out after ${Math.round(timeoutMs / 60000)} min. Try a faster model or a smaller context.`))
          return
        }
        // Fast fetch failure: DNS, TLS handshake, connection refused,
        // wrong endpoint, CORS preflight rejection, etc. All webviews
        // collapse this class of failure into an opaque error — point
        // users at the likely cause (endpoint / key / connectivity).
        onError(new Error(`网络连接中断，请检查网络、代理或接口地址后重试。接口地址：${providerConfig.url}`))
        return
      }
      onError(err instanceof Error ? err : new Error(String(err)))
      return
    }

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}: ${response.statusText}`
      try {
        const body = await response.text()
        if (body) errorDetail += ` — ${body}`
      } catch {
        // ignore body read failure
      }
      if (isReasoningContentRequiredError(errorDetail)) {
        const risk = summarizeReasoningReplayRisk(budgetedMessages)
        logReasoningReplay("request.http_error_reasoning_content", {
          url: providerConfig.url,
          model: runtimeConfig.model,
          status: response.status,
          errorDetail,
          ...risk,
        })
        // Surface probe in the toast/UI error — console.warn alone stays in WebView DevTools.
        errorDetail += `\n${formatReasoningReplayRiskForError(risk)}`
      }
      let httpRetrySucceeded = false
      const inputLimit = parseInputLengthLimit(errorDetail)
      if (inputLimit) {
        const currentInputTokens = estimateChatMessagesTokens(budgetedMessages)
        // The provider reports the overshoot in characters; we trim in tokens.
        // Applying the ratio across units is a heuristic, not an exact
        // conversion — it only has to land us under the limit, and the 0.85
        // factor absorbs the imprecision.
        const shrinkRatio = Math.min(1, inputLimit.maxLength / Math.max(1, inputLimit.inputLength))
        const retryInputTokenBudget = Math.max(
          1,
          Math.floor(currentInputTokens * shrinkRatio * 0.85),
        )
        let retryMessages: import("./llm-providers").ChatMessage[]
        try {
          retryMessages = trimChatMessagesToTokenBudget(budgetedMessages, retryInputTokenBudget)
        } catch {
          // Even the protected messages exceed the provider's limit; there is
          // nothing left to shrink, so report the original limit.
          onError(new Error(inputLengthLimitMessage(inputLimit)))
          return
        }
        effectiveRequestOverrides = await preparePromptCacheRouting(runtimeConfig, retryMessages, effectiveRequestOverrides)
        prefixDescriptor = await buildLlmRequestPrefixDescriptor(
          runtimeConfig,
          retryMessages,
          effectiveRequestOverrides,
        )
        const retryRequestInit = buildRequestInit(retryMessages)
        if (retryRequestInit.body === requestInit.body) {
          onError(new Error(inputLengthLimitMessage(inputLimit)))
          return
        }
        requestInit = retryRequestInit
        try {
          response = await sendRequest(requestInit)
        } catch (err) {
          onError(err instanceof Error ? err : new Error(String(err)))
          return
        }
        if (response.ok) {
          httpRetrySucceeded = true
        } else {
          let retryErrorDetail = `HTTP ${response.status}: ${response.statusText}`
          try {
            const retryBody = await response.text()
            if (retryBody) retryErrorDetail += ` — ${retryBody}`
          } catch {
            // ignore body read failure
          }
          onError(new Error(inputLengthLimitMessage(parseInputLengthLimit(retryErrorDetail) ?? inputLimit)))
          return
        }
      }
      const reportedMaxTokens = !httpRetrySucceeded ? parseMaxTokensLimit(errorDetail) : null
      if (
        reportedMaxTokens !== null
        && typeof effectiveRequestOverrides.max_tokens === "number"
        && reportedMaxTokens < effectiveRequestOverrides.max_tokens
      ) {
        effectiveOutputTokens = reportedMaxTokens
        effectiveRequestOverrides = {
          ...effectiveRequestOverrides,
          max_tokens: reportedMaxTokens,
        }
        requestInit = buildRequestInit(budgetedMessages, effectiveRequestOverrides)
        try {
          response = await sendRequest(requestInit)
        } catch (err) {
          onError(err instanceof Error ? err : new Error(String(err)))
          return
        }
        if (response.ok) {
          httpRetrySucceeded = true
        } else {
          let retryErrorDetail = `HTTP ${response.status}: ${response.statusText}`
          try {
            const retryBody = await response.text()
            if (retryBody) retryErrorDetail += ` — ${retryBody}`
          } catch {
            // ignore body read failure
          }
          onError(new Error(retryErrorDetail))
          return
        }
      }
      if (
        !httpRetrySucceeded &&
        isReasoningContentRequiredError(errorDetail) &&
        !isReasoningDisabled(runtimeConfig, effectiveRequestOverrides)
      ) {
        effectiveRequestOverrides = withReasoningDisabled(effectiveRequestOverrides)
        budgetedMessages = stripEmptyReasoningContent(budgetedMessages)
        effectiveRequestOverrides = await preparePromptCacheRouting(runtimeConfig, budgetedMessages, effectiveRequestOverrides)
        prefixDescriptor = await buildLlmRequestPrefixDescriptor(
          runtimeConfig,
          budgetedMessages,
          effectiveRequestOverrides,
        )
        requestInit = buildRequestInit(budgetedMessages, effectiveRequestOverrides)
        try {
          response = await sendRequest(requestInit)
        } catch (err) {
          onError(err instanceof Error ? err : new Error(String(err)))
          return
        }
        if (response.ok) {
          httpRetrySucceeded = true
        }
      }
      if (
        !httpRetrySucceeded &&
        response.status === 404 &&
        (runtimeConfig.provider === "azure" ||
          (runtimeConfig.provider === "custom" && isAzureOpenAiEndpoint(runtimeConfig.customEndpoint)))
      ) {
        onError(
          new Error(
            `${errorDetail}。Azure OpenAI 返回 404 通常表示部署名称不正确。请确认模型栏填写的是 Azure deployment name，而不是模型 SKU；接口地址填写 https://<resource>.openai.azure.com 或包含 /openai/deployments/<deployment-name> 的地址。`,
          ),
        )
        return
      }
      if (!httpRetrySucceeded && shouldRetryWithBrowserFetch(errorDetail) && typeof globalThis.fetch === "function") {
        try {
          response = await tracedFetch(
            (url, init) => globalThis.fetch(url, init),
            providerConfig.url,
            requestInit,
          )
        } catch (err) {
          onError(err instanceof Error ? err : new Error(String(err)))
          return
        }

        if (!response.ok) {
          let retryErrorDetail = `HTTP ${response.status}: ${response.statusText}`
          try {
            const retryBody = await response.text()
            if (retryBody) retryErrorDetail += ` — ${retryBody}`
          } catch {
            // ignore body read failure
          }
          onError(new Error(retryErrorDetail))
          return
        }
      } else if (!httpRetrySucceeded) {
        onError(new Error(errorDetail))
        return
      }
    }

    if (!response.body) {
      finishRequestTrace(activeRequestTrace, "error")
      onError(new Error("Response body is null"))
      return
    }

    const reader = response.body.getReader()
    let lineBuffer = ""
    let streamUsage: LlmUsage | undefined

    const recordUsage = (line: string) => {
      const usage = providerConfig.parseUsage(line)
      if (usage) streamUsage = mergeLlmUsageSnapshot(streamUsage, usage)
    }

    // Diagnostic counters. Some OpenAI-compatible endpoints stream
    // chain-of-thought through a `reasoning_content` (DeepSeek-R1,
    // Kimi K2.x) or `reasoning` (Qwen-flavored deployments) field
    // and only put the actual answer in `delta.content` after
    // thinking ends. Misbehaving endpoints sometimes emit kilobytes
    // of reasoning and end the stream with no content at all,
    // leaving the user with a silent empty analysis. We track the
    // two channels separately so the stream-end path can tell the
    // difference between "model said nothing" and "model thought
    // out loud but never produced an answer". See reasoning-
    // detector.ts.
    let contentCharsEmitted = 0
    let reasoningCharsObserved = 0
    let reasoningTokensForwarded = 0
    let toolCallDeltaCount = 0
    let finishReason: string | null = null
    const recordToken = (text: string) => {
      contentCharsEmitted += text.length
      // 只有装了 afterLlmResponse 钩子时才累积（`collectedText === null` 表示不累积）
      if (collectedText !== null) collectedText += text
      onToken(text)
    }
    const recordFinishReason = (line: string) => {
      const reason = providerConfig.parseFinishReason(line)
      if (reason) {
        finishReason = reason
        callbacks.onFinishReason?.(reason)
      }
    }
    const recordReasoning = (line: string) => {
      const reasoningParts = extractReasoningTextFromLine(line)
      for (const part of reasoningParts) {
        if (part) markFirstResponse(activeRequestTrace)
        reasoningTokensForwarded += part.length
        callbacks.onReasoningToken?.(part)
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          if (lineBuffer.trim()) {
            const trimmed = lineBuffer.trim()
            const sseError = parseOpenAiSseError(trimmed)
            if (sseError) {
              finishRequestTrace(activeRequestTrace, "error", streamUsage)
              onError(new Error(sseError))
              return
            }
            recordUsage(trimmed)
            recordFinishReason(trimmed)
            // Always harvest reasoning first: some gateways emit
            // reasoning_content and tool_calls on the same SSE line.
            reasoningCharsObserved += countReasoningCharsInLine(trimmed)
            recordReasoning(trimmed)
            const toolDeltas = parseToolCallDeltasFromLine(trimmed)
            for (const toolDelta of toolDeltas) {
              markFirstResponse(activeRequestTrace)
              toolCallDeltaCount += 1
              callbacks.onToolCallDelta?.(toolDelta)
            }
            const token = providerConfig.parseStream(trimmed)
            if (token !== null) {
              if (token) markFirstResponse(activeRequestTrace)
              recordToken(token)
            }
          }
          break
        }

        const [lines, remaining] = parseLines(value, lineBuffer, decoder)
        lineBuffer = remaining

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          const sseError = parseOpenAiSseError(trimmed)
          if (sseError) {
            finishRequestTrace(activeRequestTrace, "error", streamUsage)
            onError(new Error(sseError))
            return
          }
          recordUsage(trimmed)
          recordFinishReason(trimmed)
          // Always harvest reasoning first: some gateways emit
          // reasoning_content and tool_calls on the same SSE line.
          reasoningCharsObserved += countReasoningCharsInLine(trimmed)
          recordReasoning(trimmed)
          const toolDeltas = parseToolCallDeltasFromLine(trimmed)
          for (const toolDelta of toolDeltas) {
            markFirstResponse(activeRequestTrace)
            toolCallDeltaCount += 1
            callbacks.onToolCallDelta?.(toolDelta)
          }
          const token = providerConfig.parseStream(trimmed)
          if (token !== null) {
            if (token) markFirstResponse(activeRequestTrace)
            recordToken(token)
          }
        }
      }

      if (streamUsage) callbacks.onUsage?.(streamUsage)
      // 观测钩子：fire-and-forget，不 await（见 notifyLlmUsageHooks 的注释）。
      notifyLlmUsageHooks(streamUsage, config)

      if (toolCallDeltaCount > 0 || reasoningCharsObserved > 0) {
        logReasoningReplay("stream.collected", {
          model: runtimeConfig.model,
          contentCharsEmitted,
          reasoningCharsObserved,
          reasoningTokensForwarded,
          toolCallDeltaCount,
        })
      }

      // Stream ended cleanly. If the model produced thinking tokens
      // but no actual answer, surface that as a clear diagnostic
      // instead of letting the caller silently see "" (which usually
      // surfaces several layers up as "analysis not available" with
      // no clue why). Threshold guards against single-stray-byte
      // false positives from spurious empty `reasoning:""` deltas.
      const REASONING_DIAGNOSTIC_THRESHOLD = 200
      if (
        contentCharsEmitted === 0 &&
        toolCallDeltaCount === 0 &&
        reasoningCharsObserved >= REASONING_DIAGNOSTIC_THRESHOLD
      ) {
        finishRequestTrace(activeRequestTrace, "error", streamUsage)
        onError(
          new Error(
            `模型只输出了 ${reasoningCharsObserved.toLocaleString()} 字符的思考内容，但没有输出正文。` +
            `这通常表示接口触发了思考 token 上限、模型没有从思考阶段切换到正式回答，或当前兼容接口的流式输出不完整。` +
            `请关闭模型思考、切换到非推理模型，或缩短输入后重试。`,
          ),
        )
        return
      }

      // The provider explicitly told us the output was cut at the token
      // limit. Surface it as a distinct, tolerable error so callers can
      // keep the partial text and offer continuation, instead of parsing
      // a silently half-finished response.
      const finalFinishReason: string | null = finishReason
      if (finalFinishReason && isTruncationFinishReason(finalFinishReason)) {
        finishRequestTrace(activeRequestTrace, "error", streamUsage)
        onError(buildOutputTruncatedError(finalFinishReason))
        return
      }

      /*
       * 插件钩子 · 响应后（设计 §5.1）。
       *
       * 只在"干净结束"这一条路径上跑：取消/截断/网络中断的收尾一律不适用
       * （那几种情况上层要的是原文，改写会把半截内容伪装成完整回复）。
       *
       * 改写结果只经 `onDone(finalText)` 交付，**不**在这里自己重放 token：
       * 界面已经把原文流式显示过了，"再补一段改写后的"只会得到两份正文。
       * 因此能不能真正替换，取决于调用方是否在流结束后才落地正文 —— 详见
       * `StreamCallbacks.onDone` 的契约说明。
       */
      const rewrittenText = afterLlmHooks && collectedText !== null
        ? await runAfterLlmResponseHooks(afterLlmHooks, collectedText, signal)
        : null

      finishRequestTrace(activeRequestTrace, "success", streamUsage)
      onDone(rewrittenText ?? undefined)
    } catch (err) {
      if (isUserAbortError(err, signal)) {
        finishRequestTrace(activeRequestTrace, "cancelled", streamUsage)
        onDone()
        return
      }
      if (isFetchNetworkError(err)) {
        finishRequestTrace(activeRequestTrace, "network_error", streamUsage)
        // Stream reader threw a network error mid-response (connection
        // dropped, server closed early, network blip). Same message
        // regardless of whether the webview is WebKit or Chromium.
        onError(new Error("流式响应读取中断，请检查网络、代理或接口稳定性后重试。"))
        return
      }
      finishRequestTrace(activeRequestTrace, "error", streamUsage)
      onError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      reader.releaseLock()
    }
  } finally {
    if (onSignalAbort && signal) {
      signal.removeEventListener("abort", onSignalAbort)
    }
  }
}
