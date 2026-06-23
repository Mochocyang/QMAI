import type { LlmConfig } from "@/stores/wiki-store"
import { isAzureOpenAiEndpoint } from "@/lib/azure-openai"
import { getProviderConfig, type RequestOverrides } from "./llm-providers"
import { getHttpFetch, isFetchNetworkError } from "./tauri-fetch"
import { countReasoningCharsInLine, extractReasoningTextFromLine } from "./reasoning-detector"
import { resolveRuntimeLocalCliConfig } from "./local-cli-config"
import { trimChatMessagesToBudget } from "./chat-request-budget"

export type { ChatMessage, RequestOverrides } from "./llm-providers"
export { isFetchNetworkError } from "./tauri-fetch"

export interface StreamCallbacks {
  onToken: (token: string) => void
  onReasoningToken?: (token: string) => void
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

const DECODER = new TextDecoder()
const NETWORK_RETRY_DELAYS_MS = [30_000, 60_000, 90_000, 120_000]
export const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 30 * 60 * 1000

export function shouldRetryWithBrowserFetch(errorDetail: string): boolean {
  return /client not allowed/i.test(errorDetail) && /tauri-plugin-http/i.test(errorDetail)
}

function parseLines(chunk: Uint8Array, buffer: string): [string[], string] {
  const text = buffer + DECODER.decode(chunk, { stream: true })
  const lines = text.split("\n")
  const remaining = lines.pop() ?? ""
  return [lines, remaining]
}

function waitForRetry(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(true), ms)
    const onAbort = () => {
      clearTimeout(timeoutId)
      resolve(false)
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
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

export async function streamChat(
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
  const runtimeConfig = await resolveRuntimeLocalCliConfig(config)
  const { onToken, onDone, onError } = callbacks

  // Claude Code CLI uses a subprocess transport (stdin/stdout), not
  // HTTP. Dispatch before getProviderConfig — that function throws for
  // this provider because it has no URL/headers.
  if (runtimeConfig.provider === "claude-code") {
    return streamViaClaudeCodeCli(runtimeConfig, messages, callbacks, signal, requestOverrides)
  }

  if (runtimeConfig.provider === "codex-cli") {
    return streamViaCodexCli(runtimeConfig, messages, callbacks, signal, requestOverrides)
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

  if (typeof AbortSignal.timeout === "function") {
    timeoutController = new AbortController()
    const timeoutId = setTimeout(() => {
      timeoutFired = true
      timeoutController?.abort()
    }, timeoutMs)

    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timeoutId)
        timeoutController?.abort()
      })
    }
    combinedSignal = timeoutController.signal
  }

  const buildRequestInit = (nextMessages: import("./llm-providers").ChatMessage[]): RequestInit => ({
    method: "POST",
    headers: providerConfig.headers,
    body: JSON.stringify(providerConfig.buildBody(nextMessages, requestOverrides)),
    signal: combinedSignal,
  })

  const sendRequest = async (requestInit: RequestInit): Promise<Response> => {
    const httpFetch = await getHttpFetch()
    let attempt = 0
    while (true) {
      try {
        return await httpFetch(providerConfig.url, requestInit)
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

  let requestInit = buildRequestInit(messages)
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
    let inputLimitRetrySucceeded = false
    const inputLimit = parseInputLengthLimit(errorDetail)
    if (inputLimit) {
      const retryRequestInit = buildRequestInit(
        trimChatMessagesToBudget(messages, Math.floor(inputLimit.maxLength * 0.85)),
      )
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
        inputLimitRetrySucceeded = true
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
    if (
      !inputLimitRetrySucceeded &&
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
    if (!inputLimitRetrySucceeded && shouldRetryWithBrowserFetch(errorDetail) && typeof globalThis.fetch === "function") {
      try {
        response = await globalThis.fetch(providerConfig.url, requestInit)
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
    } else if (!inputLimitRetrySucceeded) {
      onError(new Error(errorDetail))
      return
    }
  }

  if (!response.body) {
    onError(new Error("Response body is null"))
    return
  }

  const reader = response.body.getReader()
  let lineBuffer = ""

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
  const recordToken = (text: string) => {
    contentCharsEmitted += text.length
    onToken(text)
  }
  const recordReasoning = (line: string) => {
    const reasoningParts = extractReasoningTextFromLine(line)
    for (const part of reasoningParts) {
      callbacks.onReasoningToken?.(part)
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        if (lineBuffer.trim()) {
          const trimmed = lineBuffer.trim()
          reasoningCharsObserved += countReasoningCharsInLine(trimmed)
          recordReasoning(trimmed)
          const token = providerConfig.parseStream(trimmed)
          if (token !== null) recordToken(token)
        }
        break
      }

      const [lines, remaining] = parseLines(value, lineBuffer)
      lineBuffer = remaining

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        reasoningCharsObserved += countReasoningCharsInLine(trimmed)
        recordReasoning(trimmed)
        const token = providerConfig.parseStream(trimmed)
        if (token !== null) recordToken(token)
      }
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
      reasoningCharsObserved >= REASONING_DIAGNOSTIC_THRESHOLD
    ) {
      onError(
        new Error(
          `模型只输出了 ${reasoningCharsObserved.toLocaleString()} 字符的思考内容，但没有输出正文。` +
          `这通常表示接口触发了思考 token 上限、模型没有从思考阶段切换到正式回答，或当前兼容接口的流式输出不完整。` +
          `请缩短输入、提高 max_tokens，或在设置里切换其他模型后重试。`,
        ),
      )
      return
    }

    onDone()
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || (signal?.aborted))) {
      onDone()
      return
    }
    if (isFetchNetworkError(err)) {
      // Stream reader threw a network error mid-response (connection
      // dropped, server closed early, network blip). Same message
      // regardless of whether the webview is WebKit or Chromium.
      onError(new Error("Connection lost during streaming. Try again."))
      return
    }
    onError(err instanceof Error ? err : new Error(String(err)))
  } finally {
    reader.releaseLock()
  }
}
