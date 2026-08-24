import { estimateChatMessagesTokens } from "@/lib/chat-request-budget"
import { sha256Text } from "@/lib/context-hub/fingerprint"
import type { ChatMessage, RequestOverrides } from "@/lib/llm-providers"
import type { LlmUsage } from "@/lib/llm-usage"
import type { LlmConfig } from "@/stores/wiki-store"

export const MAX_LLM_REQUEST_CACHE_TRACES = 32
const LLM_REQUEST_TRACE_PROVIDERS = new Set<LlmConfig["provider"]>([
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
])

export type LlmRequestTraceStatus = "success" | "error" | "cancelled" | "network_error"

export interface LlmRequestCacheTrace {
  provider: LlmConfig["provider"]
  model: string
  apiMode: string
  prefixFingerprint?: string
  prefixEstimatedTokens?: number
  startedAt: number
  finishedAt: number
  durationMs: number
  firstResponseMs?: number
  startGapMs?: number
  idleGapMs?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  status: LlmRequestTraceStatus
}

function resolveLlmRequestApiMode(config: LlmConfig): string {
  if (config.provider === "custom") return config.apiMode ?? "chat_completions"
  if (config.provider === "anthropic" || config.provider === "minimax") return "anthropic_messages"
  if (config.provider === "google") return "gemini_generate_content"
  if (config.provider === "azure") return "azure_chat_completions"
  if (config.provider === "claude-code") return "claude_code_cli"
  if (config.provider === "codex-cli") return "codex_cli"
  return "chat_completions"
}

interface LlmRequestTraceSnapshot {
  requests: LlmRequestCacheTrace[]
  omittedRequestCount: number
}

function textBlocksThroughLastBreakpoint(messages: ChatMessage[]): ChatMessage[] | null {
  let lastMessageIndex = -1
  let lastBlockIndex = -1
  for (const [messageIndex, message] of messages.entries()) {
    if (!Array.isArray(message.content)) continue
    for (const [blockIndex, block] of message.content.entries()) {
      if (block.type === "text" && block.cacheControl) {
        lastMessageIndex = messageIndex
        lastBlockIndex = blockIndex
      }
    }
  }
  if (lastMessageIndex < 0) return null

  return messages.slice(0, lastMessageIndex + 1).map((message, messageIndex) => {
    if (messageIndex !== lastMessageIndex || !Array.isArray(message.content)) {
      return message
    }
    return {
      ...message,
      content: message.content.slice(0, lastBlockIndex + 1),
    }
  })
}

function canonicalMessage(message: ChatMessage): unknown {
  return {
    role: message.role,
    content: typeof message.content === "string"
      ? message.content
      : message.content.map((block) => block.type === "text"
        ? { type: "text", text: block.text, cacheControl: Boolean(block.cacheControl) }
        : { type: "image", mediaType: block.mediaType, dataBase64: block.dataBase64 }),
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.name ? { name: message.name } : {}),
    ...(message.reasoning_content !== undefined ? { reasoning_content: message.reasoning_content } : {}),
  }
}

export async function buildLlmRequestPrefixDescriptor(
  config: LlmConfig,
  messages: ChatMessage[],
  overrides?: RequestOverrides,
): Promise<{ prefixFingerprint?: string; prefixEstimatedTokens?: number }> {
  const prefixMessages = textBlocksThroughLastBreakpoint(messages)
  if (!prefixMessages) return {}

  const canonical = JSON.stringify({
    provider: config.provider,
    model: config.model,
    apiMode: resolveLlmRequestApiMode(config),
    tools: overrides?.tools ?? [],
    toolChoice: overrides?.toolChoice,
    reasoning: overrides?.reasoning ?? config.reasoning ?? { mode: "auto" },
    messages: prefixMessages.map(canonicalMessage),
  })
  return {
    prefixFingerprint: await sha256Text(canonical),
    prefixEstimatedTokens: estimateChatMessagesTokens(prefixMessages),
  }
}

export function buildLlmRequestCacheTrace(input: {
  config: LlmConfig
  prefixFingerprint?: string
  prefixEstimatedTokens?: number
  startedAt: number
  finishedAt: number
  firstResponseAt?: number
  usage?: LlmUsage
  status: LlmRequestTraceStatus
}): LlmRequestCacheTrace {
  return {
    provider: input.config.provider,
    model: input.config.model,
    apiMode: resolveLlmRequestApiMode(input.config),
    ...(input.prefixFingerprint ? { prefixFingerprint: input.prefixFingerprint } : {}),
    ...(input.prefixEstimatedTokens !== undefined
      ? { prefixEstimatedTokens: input.prefixEstimatedTokens }
      : {}),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: Math.max(0, input.finishedAt - input.startedAt),
    ...(input.firstResponseAt !== undefined
      ? { firstResponseMs: Math.max(0, input.firstResponseAt - input.startedAt) }
      : {}),
    ...(input.usage?.inputTokens !== undefined ? { inputTokens: input.usage.inputTokens } : {}),
    ...(input.usage?.outputTokens !== undefined ? { outputTokens: input.usage.outputTokens } : {}),
    ...(input.usage?.cachedInputTokens !== undefined
      ? { cacheReadTokens: input.usage.cachedInputTokens }
      : {}),
    ...(input.usage?.cacheWriteInputTokens !== undefined
      ? { cacheWriteTokens: input.usage.cacheWriteInputTokens }
      : {}),
    status: input.status,
  }
}

function requestKey(trace: LlmRequestCacheTrace): string | null {
  if (!trace.prefixFingerprint) return null
  return [trace.provider, trace.model, trace.apiMode, trace.prefixFingerprint].join("\u0000")
}

export class LlmRequestTraceCollector {
  private traces: LlmRequestCacheTrace[] = []
  private omitted = 0

  record = (trace: LlmRequestCacheTrace): void => {
    this.traces.push(copyLlmRequestCacheTrace(trace))
    this.traces.sort((left, right) => left.startedAt - right.startedAt)
    if (this.traces.length > MAX_LLM_REQUEST_CACHE_TRACES) {
      const overflow = this.traces.length - MAX_LLM_REQUEST_CACHE_TRACES
      this.traces.splice(0, overflow)
      this.omitted += overflow
    }
  }

  snapshot(): LlmRequestTraceSnapshot {
    const previousByKey = new Map<string, LlmRequestCacheTrace>()
    const requests = this.traces.map((source) => {
      const trace = { ...source }
      const key = requestKey(trace)
      if (key) {
        const previous = previousByKey.get(key)
        if (previous) {
          trace.startGapMs = Math.max(0, trace.startedAt - previous.startedAt)
          trace.idleGapMs = Math.max(0, trace.startedAt - previous.finishedAt)
        }
        previousByKey.set(key, trace)
      }
      return trace
    })
    return { requests, omittedRequestCount: this.omitted }
  }
}

export function copyLlmRequestCacheTrace(trace: LlmRequestCacheTrace): LlmRequestCacheTrace {
  return {
    provider: trace.provider,
    model: trace.model,
    apiMode: trace.apiMode,
    ...(trace.prefixFingerprint !== undefined ? { prefixFingerprint: trace.prefixFingerprint } : {}),
    ...(trace.prefixEstimatedTokens !== undefined ? { prefixEstimatedTokens: trace.prefixEstimatedTokens } : {}),
    startedAt: trace.startedAt,
    finishedAt: trace.finishedAt,
    durationMs: trace.durationMs,
    ...(trace.firstResponseMs !== undefined ? { firstResponseMs: trace.firstResponseMs } : {}),
    ...(trace.startGapMs !== undefined ? { startGapMs: trace.startGapMs } : {}),
    ...(trace.idleGapMs !== undefined ? { idleGapMs: trace.idleGapMs } : {}),
    ...(trace.inputTokens !== undefined ? { inputTokens: trace.inputTokens } : {}),
    ...(trace.outputTokens !== undefined ? { outputTokens: trace.outputTokens } : {}),
    ...(trace.cacheReadTokens !== undefined ? { cacheReadTokens: trace.cacheReadTokens } : {}),
    ...(trace.cacheWriteTokens !== undefined ? { cacheWriteTokens: trace.cacheWriteTokens } : {}),
    status: trace.status,
  }
}

export function isLlmRequestCacheTrace(value: unknown): value is LlmRequestCacheTrace {
  if (!value || typeof value !== "object") return false
  const source = value as Record<string, unknown>
  const optionalNumber = (key: string) => source[key] === undefined
    || (typeof source[key] === "number" && Number.isFinite(source[key]) && source[key] >= 0)
  return typeof source.provider === "string"
    && LLM_REQUEST_TRACE_PROVIDERS.has(source.provider as LlmConfig["provider"])
    && typeof source.model === "string"
    && typeof source.apiMode === "string"
    && source.apiMode.length > 0
    && (source.prefixFingerprint === undefined
      || (typeof source.prefixFingerprint === "string" && /^[a-f0-9]{64}$/.test(source.prefixFingerprint)))
    && typeof source.startedAt === "number"
    && Number.isFinite(source.startedAt)
    && source.startedAt >= 0
    && typeof source.finishedAt === "number"
    && Number.isFinite(source.finishedAt)
    && source.finishedAt >= source.startedAt
    && typeof source.durationMs === "number"
    && Number.isFinite(source.durationMs)
    && source.durationMs >= 0
    && optionalNumber("prefixEstimatedTokens")
    && optionalNumber("firstResponseMs")
    && optionalNumber("startGapMs")
    && optionalNumber("idleGapMs")
    && optionalNumber("inputTokens")
    && optionalNumber("outputTokens")
    && optionalNumber("cacheReadTokens")
    && optionalNumber("cacheWriteTokens")
    && (source.status === "success"
      || source.status === "error"
      || source.status === "cancelled"
      || source.status === "network_error")
}
