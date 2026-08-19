import type { LlmConfig } from "@/stores/wiki-store"
import { isAzureOpenAiEndpoint } from "@/lib/azure-openai"
import {
  getEffectiveMaxContextSize,
  getEffectiveMaxOutputTokens,
  getProviderConfig,
  isTruncationFinishReason,
  thinkingMinMaxTokens,
  type RequestOverrides,
} from "./llm-providers"
import { getHttpFetch, isFetchNetworkError } from "./tauri-fetch"
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
import type { UserMemoryDecision } from "./user-memory/decision-trace"
import {
  buildLlmRequestCacheTrace,
  buildLlmRequestPrefixDescriptor,
  type LlmRequestCacheTrace,
  type LlmRequestTraceStatus,
} from "./llm-request-trace"
import { withWritingWakeLock } from "./writing-wake-lock"

export type { ChatMessage, RequestOverrides } from "./llm-providers"
export { isFetchNetworkError } from "./tauri-fetch"
export type { LlmUsage } from "./llm-usage"

export interface StreamCallbacks {
  onToken: (token: string) => void
  onReasoningToken?: (token: string) => void
  /** 工具调用流式 delta，用于累积 tool_calls */
  onToolCallDelta?: (delta: { index: number; id?: string; name?: string; arguments?: string }) => void
  onUsage?: (usage: LlmUsage) => void
  /** Sanitized request-level timing/cache trace; never contains prompt text or credentials. */
  onRequestTrace?: (trace: LlmRequestCacheTrace) => void
  /** Decision produced while preparing this request's messages (request-scoped). */
  onUserMemoryDecision?: (decision: UserMemoryDecision | null) => void
  onDone: () => void
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

export function buildOutputTruncatedError(finishReason: string): Error {
  return new Error(
    `${OUTPUT_TRUNCATED_ERROR_MARKER}：模型已达到最大输出 token 上限（finish_reason=${finishReason}）。` +
    `已生成的内容已保留，可输入"继续"让模型补全剩余部分，或提高最大输出 token 后重试。`,
  )
}

export function isOutputTruncatedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(OUTPUT_TRUNCATED_ERROR_MARKER)
}

export function shouldRetryWithBrowserFetch(errorDetail: string): boolean {
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

function parseToolCallDeltaFromLine(line: string): { index: number; id?: string; name?: string; arguments?: string } | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("data: ")) return null
  const data = trimmed.slice(6).trim()
  if (data === "[DONE]") return null
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
    const toolCall = parsed.choices?.[0]?.delta?.tool_calls?.[0]
    if (toolCall === undefined) return null
    return {
      index: toolCall.index ?? 0,
      id: toolCall.id,
      name: toolCall.function?.name,
      arguments: toolCall.function?.arguments,
    }
  } catch {
    // A malformed SSE line is not fatal: skip it and keep the stream alive.
    // The only error reachable here is JSON.parse's SyntaxError.
    return null
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
export function parseMaxTokensLimit(errorDetail: string): number | null {
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
  return provider === "claude-code" || provider === "codex-cli" || provider === "cursor-cli"
}

export async function streamChat(
  config: LlmConfig,
  messages: import("./llm-providers").ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  requestOverrides?: RequestOverrides,
): Promise<void> {
  return withWritingWakeLock(true, () => streamChatHeld(
    config,
    messages,
    callbacks,
    signal,
    requestOverrides,
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
): Promise<void> {
  let runtimeConfig = await resolveRuntimeLocalCliConfig(config)
  const { messages: preparedMessages, decision: userMemoryDecision } = applyGlobalUserMemoryToMessages(
    messages,
    requestOverrides,
  )
  callbacks.onUserMemoryDecision?.(userMemoryDecision)
  const configuredWindow = getEffectiveMaxContextSize(runtimeConfig)
  const toolScaffoldTokens = estimateRequestScaffoldTokens(requestOverrides?.tools)
  const outputCap = getEffectiveMaxOutputTokens(runtimeConfig)
  const thinkingFloorTokens = thinkingMinMaxTokens(runtimeConfig.reasoning ?? { mode: "auto" })
  const runtimeBudget = planLlmRequestBudget({
    maxContextSize: configuredWindow,
    desiredOutputTokens: requestOverrides?.max_tokens
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
    ? { ...requestOverrides, max_tokens: effectiveOutputTokens }
    : (() => {
      const { max_tokens: _ignored, ...rest } = requestOverrides ?? {}
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

  let prefixDescriptor = await buildLlmRequestPrefixDescriptor(
    runtimeConfig,
    budgetedMessages,
    effectiveRequestOverrides,
  )
  interface ActiveRequestTrace {
    startedAt: number
    firstResponseAt?: number
    finished: boolean
  }
  const startRequestTrace = (): ActiveRequestTrace => ({
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
      onDone: () => {
        finishRequestTrace(trace, signal?.aborted ? "cancelled" : "success", usage)
        callbacks.onDone()
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

  if (runtimeConfig.provider === "cursor-cli") {
    const endpoint = await ensureCursorProxyRunning(runtimeConfig)
    runtimeConfig = withCursorProxyEndpoint(runtimeConfig, endpoint)
  }

  const providerConfig = getProviderConfig(runtimeConfig)

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
      if (signal?.aborted || (combinedSignal?.aborted && !timeoutFired)) {
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
      onToken(text)
    }
    const recordFinishReason = (line: string) => {
      const reason = providerConfig.parseFinishReason(line)
      if (reason) finishReason = reason
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
            recordUsage(trimmed)
            recordFinishReason(trimmed)
            // Always harvest reasoning first: some gateways emit
            // reasoning_content and tool_calls on the same SSE line.
            reasoningCharsObserved += countReasoningCharsInLine(trimmed)
            recordReasoning(trimmed)
            const toolDelta = parseToolCallDeltaFromLine(trimmed)
            if (toolDelta) {
              markFirstResponse(activeRequestTrace)
              toolCallDeltaCount += 1
              callbacks.onToolCallDelta?.(toolDelta)
            } else {
              const token = providerConfig.parseStream(trimmed)
              if (token !== null) {
                if (token) markFirstResponse(activeRequestTrace)
                recordToken(token)
              }
            }
          }
          break
        }

        const [lines, remaining] = parseLines(value, lineBuffer, decoder)
        lineBuffer = remaining

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          recordUsage(trimmed)
          recordFinishReason(trimmed)
          // Always harvest reasoning first: some gateways emit
          // reasoning_content and tool_calls on the same SSE line.
          reasoningCharsObserved += countReasoningCharsInLine(trimmed)
          recordReasoning(trimmed)
          const toolDelta = parseToolCallDeltaFromLine(trimmed)
          if (toolDelta) {
            markFirstResponse(activeRequestTrace)
            toolCallDeltaCount += 1
            callbacks.onToolCallDelta?.(toolDelta)
            continue
          }
          const token = providerConfig.parseStream(trimmed)
          if (token !== null) {
            if (token) markFirstResponse(activeRequestTrace)
            recordToken(token)
          }
        }
      }

      if (streamUsage) callbacks.onUsage?.(streamUsage)

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

      finishRequestTrace(activeRequestTrace, "success", streamUsage)
      onDone()
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || (signal?.aborted))) {
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
