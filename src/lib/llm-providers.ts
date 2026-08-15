import type { LlmConfig, ReasoningConfig } from "@/stores/wiki-store"
import {
  AZURE_OPENAI_API_VERSION,
  buildAzureOpenAiUrl,
  isAzureOpenAiEndpoint,
} from "@/lib/azure-openai"
import { normalizeEndpoint } from "@/lib/endpoint-normalizer"
import {
  normalizeUserLlmContextSize,
  normalizeUserLlmMaxOutputTokens,
} from "@/lib/llm-context-size"
import { RESPONSE_RESERVE_FRAC } from "./context-budget"
import type { LlmUsage } from "./llm-usage"
import type { UserMemorySurface } from "./user-memory/types"

/**
 * One piece of a multimodal message body. Text + image is the only
 * shape we use today; the discriminated union makes it cheap to
 * extend (audio, file, tool_result …) without re-typing every
 * call site.
 *
 * `dataBase64` holds the raw image bytes encoded as base64 — NOT a
 * `data:` URL. The provider-specific translators below own the
 * `data:image/png;base64,…` framing because each wire prefers a
 * different shape (OpenAI puts it inside `image_url.url`, Anthropic
 * splits the mime type out into `source.media_type`, Gemini uses
 * `inline_data.mime_type`/`inline_data.data`). Putting the framing
 * in the translators keeps the producer (image extractor) provider-
 * agnostic.
 */
export type ContentBlock =
  | { type: "text"; text: string; cacheControl?: boolean }
  | { type: "image"; mediaType: string; dataBase64: string }

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  /**
   * `string` is the legacy shape — every existing call site uses it,
   * and providers that don't speak vision (or callers that don't
   * have images to send) keep working unchanged.
   *
   * `ContentBlock[]` unlocks vision input. Each provider's
   * `buildBody` translates it into the native wire format; see
   * `toOpenAiContent` / `toAnthropicContent` / `toGooglePart` /
   * `extractOllamaImages` below.
   */
  content: string | ContentBlock[]
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
  /**
   * Chain-of-thought / reasoning content from thinking models
   * (DeepSeek-R1, Qwen3, Kimi K2.x, etc.). Must be passed back
   * on subsequent multi-turn requests or the API returns 400:
   * "The `reasoning_content` in the thinking mode must be passed
   * back to the API."
   */
  reasoning_content?: string
}

/**
 * Sampling knobs a caller can pass to `streamChat` without caring about
 * the underlying wire's naming. Each provider's `buildBody` is
 * responsible for translating these into its native schema — OpenAI-
 * style wires accept them at the top level, Gemini demands they live
 * under `generationConfig` with renamed keys (`top_p` → `topP`,
 * `max_tokens` → `maxOutputTokens`, etc.). Missing fields are left
 * unset; providers keep their existing defaults.
 */
export interface RequestOverrides {
  temperature?: number
  top_p?: number
  top_k?: number
  max_tokens?: number
  stop?: string | string[]
  reasoning?: ReasoningConfig
  tools?: { type: string; function: { name: string; description: string; parameters: object } }[]
  toolChoice?: "auto" | "none"
  /** Internal: prevent recursive global-user-memory injection for the memory extractor itself. */
  skipUserMemory?: boolean
  /** Internal: explicit task surface for global-user-memory selection. */
  userMemorySurface?: UserMemorySurface
  /** Internal: project scope key for layered user-memory selection. */
  userMemoryProjectKey?: string
  /** Internal: conversation/session scope key for layered user-memory selection. */
  userMemorySessionKey?: string
}

interface ProviderConfig {
  url: string
  headers: Record<string, string>
  buildBody: (messages: ChatMessage[], overrides?: RequestOverrides) => unknown
  parseStream: (line: string) => string | null
  parseUsage: (line: string) => LlmUsage | null
  /**
   * Extract the provider's finish/stop reason from an SSE line, so the
   * stream-end path can distinguish a natural stop from a token-limit
   * truncation ("length" / "max_tokens" / "MAX_TOKENS" / ...).
   */
  parseFinishReason: (line: string) => string | null
}

/**
 * Finish/stop reasons that mean the provider cut the output because it
 * hit a token limit, per wire: OpenAI "length", Anthropic "max_tokens",
 * Gemini "MAX_TOKENS", Responses "max_output_tokens".
 */
export function isTruncationFinishReason(reason: string | null | undefined): boolean {
  if (!reason) return false
  const normalized = reason.toLowerCase()
  return normalized === "length"
    || normalized === "max_tokens"
    || normalized === "max_output_tokens"
}

const JSON_CONTENT_TYPE = "application/json"

/**
 * Origin header for local-LLM endpoints (Ollama, LM Studio, llama.cpp
 * server, LocalAI, vLLM, …).
 *
 * Always sets `Origin: http://localhost` regardless of where the
 * actual server is. Two interlocking reasons:
 *
 *   1. We MUST override the platform default. `@tauri-apps/plugin-
 *      http` v2.5.x auto-injects the webview's own origin
 *      (`tauri://localhost` on macOS/Linux,
 *      `http://tauri.localhost` on Windows). Ollama's default
 *      `OLLAMA_ORIGINS` allowlist accepts `tauri://*` since ~0.1.30
 *      but NOT `http://tauri.localhost` — without our override,
 *      Windows users hit 403. (User packet capture v0.3.11.)
 *
 *   2. We can't override with the request's REAL origin because
 *      that breaks cross-machine LAN setups. A user pointing at
 *      `http://192.168.0.20:11434/v1` would get `Origin:
 *      http://192.168.0.20:11434`, which is NOT in Ollama's
 *      default OLLAMA_ORIGINS — Ollama then 403s or RST-closes
 *      the connection, surfacing as a generic "error sending
 *      request" reqwest error. The earlier code claimed Ollama
 *      did same-origin bypass; it does not. Reported by user
 *      v0.4.2.
 *
 * `http://localhost` is unconditionally in Ollama's default
 * OLLAMA_ORIGINS list (`http://localhost`, `http://localhost:*`,
 * `http://127.0.0.1*`, etc.). LM Studio / llama.cpp / vLLM /
 * LocalAI don't check Origin at all, so the value is ignored
 * there. The header is purely a CORS-allowlist signal — semantic
 * "where this request came from" is meaningless here because the
 * server uses API keys (or no auth), not origin, for actual
 * permission checks.
 *
 * Users who actively tightened OLLAMA_ORIGINS to remove localhost
 * (rare) need to re-add `http://localhost` to their server config;
 * no client-side fix can satisfy a hand-locked allowlist that
 * specifically excludes the one origin every other LLM client
 * also relies on.
 *
 * Why this overrides at all: plugin-http's JS shim respects user-
 * set headers (see `node_modules/@tauri-apps/plugin-http/dist-js/
 * index.js` — the loop after `new Request(input, init)` only fills
 * browser-default headers when the user did NOT already set them).
 * Rust-side, the `unsafe-headers` feature flag in
 * `src-tauri/Cargo.toml` lets reqwest forward Origin without
 * stripping it. End-to-end our value wins.
 */
function localLlmOriginHeader(): Record<string, string> {
  return { Origin: "http://localhost" }
}

function isLocalOrPrivateHttpEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint)
    const host = parsed.hostname.toLowerCase()
    if (host === "localhost" || host.endsWith(".localhost")) return true
    if (host === "127.0.0.1" || host === "::1" || host === "[::1]") return true
    if (/^10\./.test(host)) return true
    if (/^192\.168\./.test(host)) return true
    const match = host.match(/^172\.(\d+)\./)
    if (match) {
      const second = Number(match[1])
      if (second >= 16 && second <= 31) return true
    }
    return false
  } catch {
    return /^(https?:\/\/)?(localhost|127\.0\.0\.1)([:/]|$)/i.test(endpoint)
  }
}

export function getCustomCompatibleHeaders(apiKey: string, url: string): Record<string, string> {
  return withCustomOriginHeader({
    "Content-Type": JSON_CONTENT_TYPE,
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }, url)
}

export function withCustomOriginHeader(headers: Record<string, string>, url: string): Record<string, string> {
  // 部分中转站会拒绝任何桌面 WebView Origin；Tauri HTTP 插件在 unsafe-headers 下会把空 Origin 视为显式移除。
  return {
    ...headers,
    ...(isLocalOrPrivateHttpEndpoint(url) ? localLlmOriginHeader() : { Origin: "" }),
  }
}

function parseOpenAiLine(line: string): string | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  if (data === "[DONE]") return null
  try {
    const parsed = JSON.parse(data) as {
      choices: Array<{ delta: { content?: string } }>
    }
    return parsed.choices?.[0]?.delta?.content ?? null
  } catch {
    return null
  }
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined
}

function usageOrNull(usage: LlmUsage): LlmUsage | null {
  return Object.values(usage).some((value) => value !== undefined) ? usage : null
}

function parseOpenAiUsage(line: string): LlmUsage | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  if (data === "[DONE]") return null
  try {
    const parsed = JSON.parse(data) as {
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        total_tokens?: number
        cached_tokens?: number
        prompt_cache_hit_tokens?: number
        cache_read_input_tokens?: number
        cache_creation_input_tokens?: number
        prompt_tokens_details?: { cached_tokens?: number }
        input_tokens_details?: { cached_tokens?: number }
      }
    }
    const raw = parsed.usage
    if (!raw) return null
    return usageOrNull({
      inputTokens: tokenCount(raw.prompt_tokens),
      outputTokens: tokenCount(raw.completion_tokens),
      totalTokens: tokenCount(raw.total_tokens),
      cachedInputTokens: tokenCount(raw.prompt_tokens_details?.cached_tokens)
        ?? tokenCount(raw.input_tokens_details?.cached_tokens)
        ?? tokenCount(raw.cached_tokens)
        ?? tokenCount(raw.prompt_cache_hit_tokens)
        ?? tokenCount(raw.cache_read_input_tokens),
      cacheWriteInputTokens: tokenCount(raw.cache_creation_input_tokens),
    })
  } catch {
    return null
  }
}

export function parseOpenAiFinishReason(line: string): string | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  if (data === "[DONE]") return null
  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{ finish_reason?: string | null }>
    }
    return parsed.choices?.[0]?.finish_reason ?? null
  } catch {
    return null
  }
}

export function parseAnthropicFinishReason(line: string): string | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  try {
    const parsed = JSON.parse(data) as {
      delta?: { stop_reason?: string | null }
      message?: { stop_reason?: string | null }
    }
    // message_delta events carry delta.stop_reason ("max_tokens" on
    // truncation); some proxies put it on message.stop_reason instead.
    return parsed.delta?.stop_reason ?? parsed.message?.stop_reason ?? null
  } catch {
    return null
  }
}

export function parseGoogleFinishReason(line: string): string | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  try {
    const parsed = JSON.parse(data) as {
      candidates?: Array<{ finishReason?: string | null }>
    }
    return parsed.candidates?.[0]?.finishReason ?? null
  } catch {
    return null
  }
}

export function parseResponsesFinishReason(line: string): string | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  if (data === "[DONE]") return null
  try {
    const parsed = JSON.parse(data) as {
      response?: {
        status?: string
        incomplete_details?: { reason?: string | null }
      }
    }
    return parsed.response?.incomplete_details?.reason ?? null
  } catch {
    return null
  }
}

function parseResponsesLine(line: string): string | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  if (data === "[DONE]") return null
  try {
    const parsed = JSON.parse(data) as { type?: string; delta?: string }
    if (parsed.type === "response.output_text.delta") {
      return parsed.delta ?? null
    }
    return null
  } catch {
    return null
  }
}

function parseResponsesUsage(line: string): LlmUsage | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  if (data === "[DONE]") return null
  try {
    const parsed = JSON.parse(data) as {
      response?: {
        usage?: {
          input_tokens?: number
          output_tokens?: number
          total_tokens?: number
          input_tokens_details?: { cached_tokens?: number }
        }
      }
    }
    const raw = parsed.response?.usage
    if (!raw) return null
    return usageOrNull({
      inputTokens: tokenCount(raw.input_tokens),
      outputTokens: tokenCount(raw.output_tokens),
      totalTokens: tokenCount(raw.total_tokens),
      cachedInputTokens: tokenCount(raw.input_tokens_details?.cached_tokens),
    })
  } catch {
    return null
  }
}

function parseAnthropicLine(line: string): string | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  try {
    const parsed = JSON.parse(data) as {
      type: string
      delta?: { type: string; text?: string }
    }
    if (
      parsed.type === "content_block_delta" &&
      parsed.delta?.type === "text_delta"
    ) {
      return parsed.delta.text ?? null
    }
    return null
  } catch {
    return null
  }
}

function parseAnthropicUsage(line: string): LlmUsage | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  try {
    const parsed = JSON.parse(data) as {
      message?: { usage?: Record<string, unknown> }
      usage?: Record<string, unknown>
    }
    const raw = parsed.message?.usage ?? parsed.usage
    if (!raw) return null
    const directInput = tokenCount(raw.input_tokens)
    const cacheRead = tokenCount(raw.cache_read_input_tokens)
    const cacheWrite = tokenCount(raw.cache_creation_input_tokens)
    const hasInput = directInput !== undefined || cacheRead !== undefined || cacheWrite !== undefined
    return usageOrNull({
      inputTokens: hasInput
        ? (directInput ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)
        : undefined,
      outputTokens: tokenCount(raw.output_tokens),
      cachedInputTokens: cacheRead,
      cacheWriteInputTokens: cacheWrite,
    })
  } catch {
    return null
  }
}

export function parseGoogleLine(line: string): string | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  try {
    const parsed = JSON.parse(data) as {
      candidates: Array<{
        content: { parts: Array<{ text?: string; thought?: boolean }> }
      }>
    }
    // Gemini can split a single event's output across multiple parts —
    // common with 2.5/3.x reasoning models, which interleave
    // `thought: true` parts (chain-of-thought) with the real answer.
    // Previous impl only took parts[0].text, silently dropping anything
    // that came in a later part. Concatenate all visible text parts and
    // skip ones flagged as thoughts so we don't leak reasoning text into
    // the user-visible stream.
    const parts = parsed.candidates?.[0]?.content?.parts
    if (!parts || parts.length === 0) return null
    let out = ""
    for (const p of parts) {
      if (p.thought) continue
      if (p.text) out += p.text
    }
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

function parseGoogleUsage(line: string): LlmUsage | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  try {
    const parsed = JSON.parse(data) as {
      usageMetadata?: {
        promptTokenCount?: number
        candidatesTokenCount?: number
        totalTokenCount?: number
        cachedContentTokenCount?: number
      }
    }
    const raw = parsed.usageMetadata
    if (!raw) return null
    return usageOrNull({
      inputTokens: tokenCount(raw.promptTokenCount),
      outputTokens: tokenCount(raw.candidatesTokenCount),
      totalTokens: tokenCount(raw.totalTokenCount),
      cachedInputTokens: tokenCount(raw.cachedContentTokenCount),
    })
  } catch {
    return null
  }
}

/**
 * Translate a `ChatMessage.content` into the OpenAI Chat Completions
 * `content` field. The wire accepts either a plain string or an
 * array of `{type:"text"|"image_url", ...}` parts; we use the array
 * form only when the message actually carries an image, so single-
 * string requests stay byte-identical to what we sent before vision
 * existed (avoids accidentally regressing endpoints that lag behind
 * the spec — quite a few llama.cpp and vLLM builds in the wild
 * still parse `content: string` faster than `content: [...]`).
 *
 * Image bytes are emitted as a `data:` URL inside `image_url.url`.
 * `image_url` accepts both URLs and data URLs; data URL keeps every
 * byte in the request (no follow-up GET from the model server),
 * which is what we want for desktop-LLM endpoints that may not
 * have outbound network access at all.
 */
function toOpenAiContent(content: string | ContentBlock[]): unknown {
  if (typeof content === "string") return content
  // Pure-text block array → flatten to a string so we don't force
  // every provider proxy to handle parts. Same wire either way.
  if (content.every((b) => b.type === "text")) {
    return content.map((b) => (b.type === "text" ? b.text : "")).join("")
  }
  return content.map((b) => {
    if (b.type === "text") return { type: "text", text: b.text }
    return {
      type: "image_url",
      image_url: { url: `data:${b.mediaType};base64,${b.dataBase64}` },
    }
  })
}

/**
 * Qwen3.5 / Qwen3.6 chat templates raise
 * `System message must be at the beginning` when any `role=system`
 * message is not index 0. That includes a second consecutive leading
 * system. Do not reuse `isChatTemplateThinkingModel` — that matches
 * every Qwen3 id, including qwen3-coder / qwen3-235b which do not
 * ship this guard.
 */
function needsStrictLeadingSystemTemplate(model: string): boolean {
  return /qwen[-_./]?3[._-]?[56](?:\b|[._+:-]|$)/i.test(model)
}

function flattenSystemText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content
  return content.map((block) => (block.type === "text" ? block.text : "")).join("")
}

function mergeSystemContents(systems: ChatMessage[]): ChatMessage["content"] {
  const usesBlocks = systems.some((message) => Array.isArray(message.content))
  if (!usesBlocks) {
    return systems
      .map((message) => flattenSystemText(message.content))
      .filter((text) => text.length > 0)
      .join("\n\n")
  }
  const blocks: ContentBlock[] = []
  for (const [index, message] of systems.entries()) {
    if (typeof message.content === "string") {
      if (!message.content) continue
      blocks.push({
        type: "text",
        text: index > 0 && blocks.length > 0 ? `\n\n${message.content}` : message.content,
      })
      continue
    }
    if (index > 0 && blocks.length > 0 && message.content.length > 0) {
      blocks.push({ type: "text", text: "\n\n" })
    }
    for (const block of message.content) {
      blocks.push(block)
    }
  }
  return blocks
}

/**
 * Fold every system message into a single leading system entry so
 * Qwen3.5/3.6 templates accept the payload. Leaves user / assistant /
 * tool order unchanged. Does not invent a system message when none exist.
 */
function coalesceSystemMessages(messages: ChatMessage[]): ChatMessage[] {
  const systems = messages.filter((message) => message.role === "system")
  if (systems.length === 0) return messages
  if (systems.length === 1 && messages[0]?.role === "system") return messages
  const rest = messages.filter((message) => message.role !== "system")
  return [{ role: "system", content: mergeSystemContents(systems) }, ...rest]
}

function buildOpenAiBody(
  messages: ChatMessage[],
  overrides?: RequestOverrides,
): Record<string, unknown> {
  // OpenAI (and every /v1/chat/completions clone — DeepSeek, Groq,
  // Ollama, Zhipu, Kimi, xAI, MiniMax OpenAI-compat, ...) accepts these
  // knobs at the top level using the names clients already send.
  const translated = messages.map((m) => ({
    role: m.role,
    content: toOpenAiContent(m.content),
    ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    ...(m.name ? { name: m.name } : {}),
    ...(m.reasoning_content?.trim() ? { reasoning_content: m.reasoning_content } : {}),
  }))
  const body: Record<string, unknown> = { messages: translated, stream: true, ...stripWireAgnosticOverrides(overrides) }
  if (overrides?.tools && overrides.tools.length > 0) {
    body.tools = overrides.tools
    body.tool_choice = overrides.toolChoice ?? "auto"
  }
  return body
}

function toResponsesContent(content: string | ContentBlock[]): unknown {
  if (typeof content === "string") return content
  return content.map((block) => {
    if (block.type === "text") {
      return { type: "input_text", text: block.text }
    }
    return {
      type: "input_image",
      image_url: `data:${block.mediaType};base64,${block.dataBase64}`,
    }
  })
}

function buildResponsesBody(
  config: LlmConfig,
  messages: ChatMessage[],
  overrides?: RequestOverrides,
): Record<string, unknown> {
  const wiredMessages = needsStrictLeadingSystemTemplate(config.model)
    ? coalesceSystemMessages(messages)
    : messages
  const body: Record<string, unknown> = {
    model: config.model,
    input: wiredMessages.map((message) => ({
      role: message.role,
      content: toResponsesContent(message.content),
    })),
    stream: true,
  }

  if (overrides?.temperature !== undefined) body.temperature = overrides.temperature
  if (overrides?.top_p !== undefined) body.top_p = overrides.top_p
  if (overrides?.max_tokens !== undefined) body.max_output_tokens = overrides.max_tokens
  if (overrides?.stop !== undefined) body.stop = overrides.stop

  const reasoning = effectiveReasoning(config, overrides)
  const effort = reasoningEffort(reasoning)
  if (effort) {
    body.reasoning = { effort }
  }

  return body
}

function stripWireAgnosticOverrides(overrides?: RequestOverrides): Omit<
  RequestOverrides,
  | "reasoning"
  | "skipUserMemory"
  | "userMemorySurface"
  | "userMemoryProjectKey"
  | "userMemorySessionKey"
  | "tools"
  | "toolChoice"
> {
  const {
    reasoning: _reasoning,
    skipUserMemory: _skipUserMemory,
    userMemorySurface: _userMemorySurface,
    userMemoryProjectKey: _userMemoryProjectKey,
    userMemorySessionKey: _userMemorySessionKey,
    tools: _tools,
    toolChoice: _toolChoice,
    ...rest
  } = overrides ?? {}
  return rest
}

function effectiveReasoning(config: LlmConfig, overrides?: RequestOverrides): ReasoningConfig {
  return overrides?.reasoning ?? config.reasoning ?? { mode: "auto" }
}

function reasoningEffort(reasoning: ReasoningConfig): "low" | "medium" | "high" | null {
  if (reasoning.mode === "low" || reasoning.mode === "medium" || reasoning.mode === "high") {
    return reasoning.mode
  }
  if (reasoning.mode === "max" || reasoning.mode === "custom") {
    return "high"
  }
  return null
}

/**
 * Total output tokens (thinking + final answer) a reasoning level needs in
 * order to produce anything useful. Below this the model spends the whole
 * allowance on `reasoning_content` and returns zero `content`, which surfaces
 * as the "思考上限" error.
 *
 * This is a pure query. Two consumers act on it, both *before* the request
 * body is built: `planLlmRequestBudget` raises the planned output to this
 * floor (still bounded by the user's output cap and the context window), and
 * the settings UI raises the user's configured output cap when they pick a
 * reasoning level that needs more. Nothing may inflate `max_tokens` at
 * body-build time — that happens after budgeting and would break the
 * window conservation the planner just established.
 */
export function thinkingMinMaxTokens(reasoning: ReasoningConfig): number {
  switch (reasoning.mode) {
    case "low":
      return 4096
    case "medium":
      return 8192
    case "high":
    case "max":
      return 16384
    case "custom":
      if (reasoning.budgetTokens !== undefined) {
        return reasoning.budgetTokens + 4096
      }
      return 8192
    default:
      return 0
  }
}

/**
 * Whether explicit thinking can be honoured within the output allowance the
 * caller already decided on. An absent `max_tokens` means the provider
 * default applies and we have no basis to judge, so thinking stays on.
 *
 * OpenAI-compatible endpoints expose thinking as a boolean with no budget
 * field, so the only remedy when it does not fit is to turn thinking off —
 * unlike the Anthropic path, which can shrink `budget_tokens` instead.
 */
function thinkingFitsInOutputBudget(
  body: Record<string, unknown>,
  reasoning: ReasoningConfig,
): boolean {
  const required = thinkingMinMaxTokens(reasoning)
  if (required <= 0) return true
  const planned = body.max_tokens
  if (typeof planned !== "number") return true
  return planned >= required
}

function isDeepSeekEndpoint(config: LlmConfig): boolean {
  return /deepseek/i.test(config.model) || /deepseek/i.test(config.customEndpoint)
}

/**
 * The context window to plan against, in tokens.
 *
 * Deliberately just the user's setting plus a fallback. Model-specific
 * minimums used to be forced here, which meant the value in the settings UI
 * and the value actually used could differ with nothing on screen to say so —
 * for DeepSeek the window slider had no effect at all. Model defaults belong
 * in the presets (`suggestedContextSize`), where the user can see and change
 * them.
 */
export function getEffectiveMaxContextSize(config: LlmConfig): number {
  return normalizeUserLlmContextSize(config.maxContextSize)
}

/** The declared output ceiling to plan against, in tokens. */
export function getEffectiveMaxOutputTokens(config: LlmConfig): number {
  return normalizeUserLlmMaxOutputTokens(config.maxOutputTokens)
}

/**
 * Models that control chain-of-thought via the vLLM/SGLang-standard
 * `chat_template_kwargs.enable_thinking` boolean.
 *
 * Covers:
 *  - Qwen3 / Qwen3.5 / Qwen3.6 / Qwen3-Coder  (qwen3 prefix)
 *  - Xiaomi MiMo v2.x  (mimo-v2-pro, mimo-v2.5-pro, mimo-v2-flash, …)
 *
 * When `enable_thinking` is false the model suppresses reasoning_content
 * entirely; when true it streams CoT through that field before the
 * final `content`. Third-party vLLM gateways serving these models use
 * the same parameter, so model-name matching is sufficient.
 */
function isChatTemplateThinkingModel(model: string): boolean {
  return /qwen[-_]?3/i.test(model) || /mimo/i.test(model)
}

/**
 * Endpoint-level fallback for Xiaomi MiMo. If the user kept the default
 * model name but changed nothing else, model-name matching already
 * catches it. This also covers custom model ids on the MiMo Token Plan
 * gateways (api.xiaomimimo.com / token-plan-cn.xiaomimimo.com).
 */
function isMiMoEndpoint(config: LlmConfig): boolean {
  return /xiaomimimo\.com/i.test(config.customEndpoint)
}

/**
 * GLM-5+ models on the official Zhipu BigModel API control thinking
 * through a top-level `thinking` object: `{ type: "enabled" }` or
 * `{ type: "disabled" }`. GLM-4.x and earlier do not support this
 * parameter — sending it would cause a 400, so the version gate matters.
 *
 * Third-party GLM deployments (Atlas Cloud, NVIDIA NIM, vLLM self-host)
 * may use a different convention; we only apply this adaptation to the
 * official bigmodel.cn endpoint.
 */
function isGLMThinkingModel(model: string): boolean {
  return /glm[-_]?5/i.test(model)
}

function isZhipuEndpoint(config: LlmConfig): boolean {
  return /bigmodel\.cn/i.test(config.customEndpoint)
    || /(^|[/:.])zhipu([/:.]|$)/i.test(config.customEndpoint)
}

function isKimiEndpoint(config: LlmConfig): boolean {
  return /(^|[/:.-])kimi([/:.-]|$)/i.test(config.model)
    || /moonshot/i.test(config.model)
    || /api\.moonshot\.(ai|cn)/i.test(config.customEndpoint)
}

function isOpenAiStrictCompletionModel(config: LlmConfig): boolean {
  if ((config.provider === "azure" || (config.provider === "custom" && isAzureOpenAiEndpoint(config.customEndpoint)))
    && config.azureModelFamily === "gpt5") {
    return true
  }

  const model = config.model.trim().toLowerCase()
  const strictModel = /^gpt-5(?:[.\-_]|$)/.test(model) || /^o\d+(?:[.\-_]|$)/.test(model)
  if (!strictModel) return false
  if (config.provider === "openai" || config.provider === "azure") return true
  return config.provider === "custom" && isAzureOpenAiEndpoint(config.customEndpoint)
}

function adaptOpenAiStrictCompletionBody(config: LlmConfig, body: Record<string, unknown>): void {
  if (!isOpenAiStrictCompletionModel(config)) return

  if (typeof body.max_tokens === "number") {
    body.max_completion_tokens = body.max_tokens
    delete body.max_tokens
  }

  // GPT-5 / o-series Chat Completions deployments reject non-default
  // sampling knobs. Structured ingest passes temperature=0.1, so strip
  // these only on the strict OpenAI path; custom/OpenRouter-compatible
  // routes keep their existing behavior.
  delete body.temperature
  delete body.top_p
  delete body.top_k
}

function adaptKimiBody(config: LlmConfig, body: Record<string, unknown>): void {
  if (!isKimiEndpoint(config)) return

  // Moonshot/Kimi OpenAI-compatible endpoints reject non-default
  // temperature values for several current models ("only 1 is allowed").
  // Structured ingest/dedup pass temperature=0.1 for determinism, so
  // omit it and let the endpoint use its required default.
  delete body.temperature
}

function buildOpenAiCompatibleBody(
  config: LlmConfig,
  messages: ChatMessage[],
  overrides?: RequestOverrides,
): Record<string, unknown> {
  const reasoning = effectiveReasoning(config, overrides)
  const wiredMessages = needsStrictLeadingSystemTemplate(config.model)
    ? coalesceSystemMessages(messages)
    : messages
  // Pass full overrides: buildOpenAiBody strips internal/wire-agnostic
  // fields (including tools/toolChoice) then re-emits tools + tool_choice.
  const body: Record<string, unknown> = buildOpenAiBody(wiredMessages, overrides)
  if (
    config.provider === "openai"
    || config.provider === "azure"
    || (config.provider === "custom" && isAzureOpenAiEndpoint(config.customEndpoint))
  ) {
    body.stream_options = { include_usage: true }
  }
  adaptOpenAiStrictCompletionBody(config, body)
  adaptKimiBody(config, body)

  if (isDeepSeekEndpoint(config)) {
    // DeepSeek V4 thinking mode. `thinking.type=disabled` is the most
    // important path for ingestion/rewrite tasks: it prevents the model
    // from spending the whole response on `reasoning_content` with no
    // final `content`.
    if (reasoning.mode === "off") {
      body.thinking = { type: "disabled" }
    } else if (reasoning.mode !== "auto") {
      if (!thinkingFitsInOutputBudget(body, reasoning)) {
        body.thinking = { type: "disabled" }
        return body
      }
      body.thinking = { type: "enabled" }
      const effort = reasoningEffort(reasoning)
      if (effort) {
        body.reasoning_effort = effort
      }
    }
    return body
  }

  // 思考放不下时改为关闭，同时压掉 reasoning_effort，避免请求体自相矛盾
  let thinkingSuppressed = false

  // chat_template_kwargs 类型思考模型（Qwen3、MiMo）
  // 同时检查模型名称和端点URL，双重保险确保MiMo等模型被正确识别
  if (isChatTemplateThinkingModel(config.model) || isMiMoEndpoint(config)) {
    if (reasoning.mode === "off") {
      body.chat_template_kwargs = { enable_thinking: false }
    } else if (reasoning.mode !== "auto") {
      const fits = thinkingFitsInOutputBudget(body, reasoning)
      body.chat_template_kwargs = { enable_thinking: fits }
      if (!fits) thinkingSuppressed = true
    }
  }

  // GLM-5+ 模型（智谱BigModel官方端点）使用顶层 thinking 对象控制思考
  if (isGLMThinkingModel(config.model) && isZhipuEndpoint(config)) {
    if (reasoning.mode === "off") {
      body.thinking = { type: "disabled" }
    } else if (reasoning.mode !== "auto") {
      const fits = thinkingFitsInOutputBudget(body, reasoning)
      body.thinking = { type: fits ? "enabled" : "disabled" }
      if (!fits) thinkingSuppressed = true
    }
  }

  const effort = reasoningEffort(reasoning)
  if (
    !thinkingSuppressed
    && (config.provider === "openai" || config.provider === "azure" || config.provider === "custom")
    && effort
  ) {
    body.reasoning_effort = effort
  }

  return body
}

/**
 * Translate `ChatMessage.content` into Anthropic Messages
 * `content`. Anthropic requires the array form for any non-text
 * block, and uses a different shape than OpenAI for images
 * (`source.media_type` + `source.data` instead of a `data:` URL).
 *
 * For system messages, Anthropic accepts the top-level `system`
 * field as a string OR as a content-block array. We always
 * stringify system content here because every existing system-
 * prompt call site sends a string and the round-trip through
 * blocks is lossy.
 */
function toAnthropicContent(content: string | ContentBlock[]): unknown {
  if (typeof content === "string") return content
  // 任一文本块带 cacheControl 时，必须保留块数组形式以承载 cache_control 断点，
  // 不能再折叠成纯字符串（折叠会丢掉缓存标记）。无标记时维持原有折叠行为，
  // 以保持对落后端点的兼容（见 toOpenAiContent 注释）。
  const hasCacheControl = content.some((b) => b.type === "text" && b.cacheControl)
  if (!hasCacheControl && content.every((b) => b.type === "text")) {
    return content.map((b) => (b.type === "text" ? b.text : "")).join("")
  }
  return content.map((b) => {
    if (b.type === "text") {
      return b.cacheControl
        ? { type: "text", text: b.text, cache_control: { type: "ephemeral" } }
        : { type: "text", text: b.text }
    }
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: b.mediaType,
        data: b.dataBase64,
      },
    }
  })
}

/** Anthropic accepts top-level system as a string or text-block array. */
function flattenAnthropicSystem(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content
  return content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
}

function buildAnthropicSystem(messages: ChatMessage[]): string | unknown[] | undefined {
  const hasCacheControl = messages.some(
    (message) => Array.isArray(message.content)
      && message.content.some((block) => block.type === "text" && block.cacheControl),
  )
  if (!hasCacheControl) {
    return messages.map((message) => flattenAnthropicSystem(message.content)).join("\n") || undefined
  }

  const blocks: unknown[] = []
  for (const [messageIndex, message] of messages.entries()) {
    if (messageIndex > 0) blocks.push({ type: "text", text: "\n" })
    if (typeof message.content === "string") {
      if (message.content) blocks.push({ type: "text", text: message.content })
      continue
    }
    for (const block of message.content) {
      if (block.type !== "text") continue
      blocks.push(block.cacheControl
        ? { type: "text", text: block.text, cache_control: { type: "ephemeral" } }
        : { type: "text", text: block.text })
    }
  }
  return blocks.length > 0 ? blocks : undefined
}

function defaultAnthropicMaxTokens(config: LlmConfig): number {
  // Anthropic requires max_tokens. Prefer the same window-fraction plan the
  // HTTP kernel uses; never fall back to a vendor-hardcoded 4096.
  const windowTokens = getEffectiveMaxContextSize(config)
  return Math.max(
    512,
    Math.min(
      getEffectiveMaxOutputTokens(config),
      Math.floor(windowTokens * RESPONSE_RESERVE_FRAC),
    ),
  )
}

function buildAnthropicBody(
  config: LlmConfig,
  messages: ChatMessage[],
  overrides?: RequestOverrides,
): Record<string, unknown> {
  const systemMessages = messages.filter((m) => m.role === "system")
  const conversationMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: toAnthropicContent(m.content) }))
  const system = buildAnthropicSystem(systemMessages)

  // Anthropic Messages uses top_p / top_k (Python-style snake_case), a
  // mandatory `max_tokens`, and `stop_sequences` instead of `stop`.
  // Overrides may still set max_tokens to stretch long outputs.
  return {
    messages: conversationMessages,
    ...(system !== undefined ? { system } : {}),
    stream: true,
    max_tokens: overrides?.max_tokens ?? defaultAnthropicMaxTokens(config),
    ...(overrides?.temperature !== undefined ? { temperature: overrides.temperature } : {}),
    ...(overrides?.top_p !== undefined ? { top_p: overrides.top_p } : {}),
    ...(overrides?.top_k !== undefined ? { top_k: overrides.top_k } : {}),
    ...(overrides?.stop !== undefined
      ? { stop_sequences: Array.isArray(overrides.stop) ? overrides.stop : [overrides.stop] }
      : {}),
  }
}

function buildAnthropicBodyWithReasoning(
  config: LlmConfig,
  messages: ChatMessage[],
  overrides?: RequestOverrides,
): Record<string, unknown> {
  const body = buildAnthropicBody(config, messages, overrides)
  const reasoning = effectiveReasoning(config, overrides)
  if (reasoning.mode === "auto" || reasoning.mode === "off") return body

  const budget =
    reasoning.mode === "custom" && reasoning.budgetTokens !== undefined
      ? reasoning.budgetTokens
      : reasoning.mode === "low"
        ? 1024
        : reasoning.mode === "medium"
          ? 4096
        : 8192
  const maxOutputTokens = body.max_tokens as number
  const minimumAnswerTokens = 512
  const availableThinkingTokens = maxOutputTokens - minimumAnswerTokens
  // Anthropic requires at least 1024 thinking tokens. Never inflate max_tokens
  // beyond the workflow plan; disable explicit thinking when it cannot fit.
  if (availableThinkingTokens < 1024) return body
  const budgetTokens = Math.min(Math.max(1024, budget), availableThinkingTokens)
  body.thinking = { type: "enabled", budget_tokens: budgetTokens }
  delete body.temperature
  delete body.top_p
  delete body.top_k
  return body
}

/**
 * Some Anthropic-compatible third-party endpoints (MiniMax global + CN)
 * serve the Messages API but authenticate with `Authorization: Bearer`
 * instead of Anthropic-native `x-api-key`. See hermes-agent
 * `agent/anthropic_adapter.py:_requires_bearer_auth` for reference.
 *
 * This also matters for CORS: MiniMax's preflight lists `Authorization`
 * in `Access-Control-Allow-Headers` but NOT `x-api-key`, so sending the
 * Anthropic-native header gets blocked by the browser before the request
 * even leaves.
 */
function requiresBearerAuth(url: string): boolean {
  const normalized = url.toLowerCase().replace(/\/+$/, "")
  return (
    // MiniMax — CORS allow-headers doesn't include x-api-key
    normalized.startsWith("https://api.minimax.io/anthropic") ||
    normalized.startsWith("https://api.minimaxi.com/anthropic") ||
    // Alibaba Bailian Coding Plan — issues sk-xxx bearer-style tokens
    // on its /apps/anthropic gateway; behavior matches the other
    // Chinese Anthropic-wire proxies above.
    normalized.startsWith("https://coding.dashscope.aliyuncs.com/apps/anthropic")
  )
}

/**
 * Build the final POST URL for an Anthropic-wire endpoint given whatever
 * base the user provided. Handles every shape we've seen in the wild:
 *
 *   .../v1/messages    → as-is (user pasted the full path)
 *   .../v1             → append /messages (don't double the /v1)
 *   .../api/paas/v4    → append /messages (arbitrary version segment)
 *   .../anthropic      → append /v1/messages (MiniMax-style proxy base)
 *   .../               → append /v1/messages (bare host)
 *
 * A bug where this naively appended "/v1/messages" caused requests to
 * ".../v1/v1/messages" (404) whenever a user typed a URL ending in /v1.
 */
export function buildAnthropicUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "")
  if (/\/v\d+\/messages$/i.test(trimmed)) return trimmed
  if (/\/v\d+$/i.test(trimmed)) return `${trimmed}/messages`
  return `${trimmed}/v1/messages`
}

function buildAnthropicHeaders(apiKey: string, url: string): Record<string, string> {
  const base: Record<string, string> = {
    "Content-Type": JSON_CONTENT_TYPE,
  }
  if (requiresBearerAuth(url)) {
    base.Authorization = `Bearer ${apiKey}`
  } else {
    base["x-api-key"] = apiKey
    base["anthropic-version"] = "2023-06-01"
    base["anthropic-dangerous-direct-browser-access"] = "true"
  }
  return base
}

/**
 * Translate `ChatMessage.content` into Gemini `parts`. Gemini's
 * native shape is already block-like (`parts: [{text}|{inline_data}]`)
 * so the mapping is mostly cosmetic — we don't try to flatten
 * single-text-block arrays because Gemini accepts the array form
 * uniformly.
 */
function toGoogleParts(content: string | ContentBlock[]): unknown[] {
  if (typeof content === "string") return [{ text: content }]
  return content.map((b) => {
    if (b.type === "text") return { text: b.text }
    return {
      inline_data: {
        mime_type: b.mediaType,
        data: b.dataBase64,
      },
    }
  })
}

function flattenGoogleSystemParts(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content
  return content.map((b) => (b.type === "text" ? b.text : "")).join("")
}

function buildGoogleBody(
  messages: ChatMessage[],
  overrides?: RequestOverrides,
): Record<string, unknown> {
  const systemMessages = messages.filter((m) => m.role === "system")
  const conversationMessages = messages.filter((m) => m.role !== "system")

  const contents = conversationMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: toGoogleParts(m.content),
  }))

  // Gemini's `systemInstruction.parts` is a `parts` array but in
  // practice every consumer flattens it to a string equivalent —
  // images in a system instruction are not a documented use case.
  // Keep it text-only.
  const systemInstruction =
    systemMessages.length > 0
      ? {
          parts: systemMessages.map((m) => ({ text: flattenGoogleSystemParts(m.content) })),
        }
      : undefined

  // Gemini rejects sampling knobs at the top level (HTTP 400
  // "Unknown name 'temperature': Cannot find field.") — everything
  // must live under `generationConfig` with Gemini-specific naming:
  //   top_p       → topP
  //   top_k       → topK
  //   max_tokens  → maxOutputTokens
  //   stop        → stopSequences (array)
  // Build it only when the caller actually passed something, so an
  // unmodified request stays minimal and lets server defaults apply.
  const generationConfig: Record<string, unknown> = {}
  if (overrides?.temperature !== undefined) generationConfig.temperature = overrides.temperature
  if (overrides?.top_p !== undefined) generationConfig.topP = overrides.top_p
  if (overrides?.top_k !== undefined) generationConfig.topK = overrides.top_k
  if (overrides?.max_tokens !== undefined) generationConfig.maxOutputTokens = overrides.max_tokens
  if (overrides?.stop !== undefined) {
    generationConfig.stopSequences = Array.isArray(overrides.stop) ? overrides.stop : [overrides.stop]
  }
  if (overrides?.reasoning?.mode === "off") {
    generationConfig.thinkingConfig = { thinkingBudget: 0 }
  } else if (overrides?.reasoning && overrides.reasoning.mode !== "auto") {
    const budget =
      overrides.reasoning.mode === "custom" && overrides.reasoning.budgetTokens !== undefined
        ? overrides.reasoning.budgetTokens
        : overrides.reasoning.mode === "low"
          ? 1024
          : overrides.reasoning.mode === "medium"
            ? 4096
            : 8192
    generationConfig.thinkingConfig = { thinkingBudget: budget }
  }

  return {
    contents,
    ...(systemInstruction !== undefined ? { systemInstruction } : {}),
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  }
}

export function getProviderConfig(config: LlmConfig): ProviderConfig {
  const { provider, apiKey, model, ollamaUrl, customEndpoint } = config

  switch (provider) {
    case "openai":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: {
          "Content-Type": JSON_CONTENT_TYPE,
          Authorization: `Bearer ${apiKey}`,
        },
        buildBody: (messages, overrides) => ({
          ...buildOpenAiCompatibleBody(config, messages, overrides),
          model,
        }),
        parseStream: parseOpenAiLine,
        parseUsage: parseOpenAiUsage,
        parseFinishReason: parseOpenAiFinishReason,
      }

    case "anthropic": {
      const url = buildAnthropicUrl("https://api.anthropic.com")
      return {
        url,
        headers: buildAnthropicHeaders(apiKey, url),
        buildBody: (messages, overrides) => ({
          ...buildAnthropicBodyWithReasoning(config, messages, overrides),
          model,
        }),
        parseStream: parseAnthropicLine,
        parseUsage: parseAnthropicUsage,
        parseFinishReason: parseAnthropicFinishReason,
      }
    }

    case "google": {
      // Encode the model segment — users sometimes paste OpenRouter-style
      // ids with slashes (e.g. "google/gemini-3-pro-preview") and bare
      // interpolation would produce a broken URL. encodeURIComponent
      // handles that plus any other path-illegal characters.
      const encodedModel = encodeURIComponent(model)
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:streamGenerateContent?alt=sse`,
        headers: {
          "Content-Type": JSON_CONTENT_TYPE,
          "x-goog-api-key": apiKey,
        },
        buildBody: (messages, overrides) => buildGoogleBody(messages, {
          ...(overrides ?? {}),
          reasoning: effectiveReasoning(config, overrides),
        }),
        parseStream: parseGoogleLine,
        parseUsage: parseGoogleUsage,
        parseFinishReason: parseGoogleFinishReason,
      }
    }

    case "azure": {
      return {
        url: buildAzureOpenAiUrl(
          customEndpoint,
          model,
          config.azureApiVersion ?? AZURE_OPENAI_API_VERSION,
        ),
        headers: {
          "Content-Type": JSON_CONTENT_TYPE,
          "api-key": apiKey,
        },
        buildBody: (messages, overrides) =>
          buildOpenAiCompatibleBody(config, messages, overrides),
        parseStream: parseOpenAiLine,
        parseUsage: parseOpenAiUsage,
        parseFinishReason: parseOpenAiFinishReason,
      }
    }

    case "ollama": {
      // Defense-in-depth for the same reason as the custom branch: if a
      // user pasted the full path as their Ollama URL, don't tack on
      // another copy. Also strip a bare trailing "/v1" so the user can
      // enter either form ("http://host:11434" or "http://host:11434/v1").
      let ollamaBase = ollamaUrl.replace(/\/+$/, "")
      if (/\/v1\/chat\/completions$/i.test(ollamaBase)) {
        ollamaBase = ollamaBase.replace(/\/v1\/chat\/completions$/i, "")
      } else if (/\/v1$/i.test(ollamaBase)) {
        ollamaBase = ollamaBase.replace(/\/v1$/i, "")
      }
      return {
        url: `${ollamaBase}/v1/chat/completions`,
        headers: {
          "Content-Type": JSON_CONTENT_TYPE,
          ...localLlmOriginHeader(),
        },
        buildBody: (messages, overrides) => ({
          ...buildOpenAiCompatibleBody(config, messages, overrides),
          model,
        }),
        parseStream: parseOpenAiLine,
        parseUsage: parseOpenAiUsage,
        parseFinishReason: parseOpenAiFinishReason,
      }
    }

    case "minimax": {
      // MiniMax's real API is Anthropic Messages at /anthropic, not
      // OpenAI chat completions. customEndpoint can point at either the
      // global (.io) or China (.minimaxi.com) regional endpoint; default
      // to the global one when unset. Auth uses Bearer (see
      // buildAnthropicHeaders / requiresBearerAuth above).
      const url = buildAnthropicUrl(customEndpoint || "https://api.minimax.io/anthropic")
      return {
        url,
        headers: buildAnthropicHeaders(apiKey, url),
        buildBody: (messages, overrides) => ({
          ...buildAnthropicBodyWithReasoning(config, messages, overrides),
          model,
        }),
        parseStream: parseAnthropicLine,
        parseUsage: parseAnthropicUsage,
        parseFinishReason: parseAnthropicFinishReason,
      }
    }

    case "claude-code":
    case "codex-cli":
      // Local CLI providers use subprocess transports (stdin/stdout JSON
      // streams), not HTTP. Dispatch happens one layer up in
      // streamChat() before getProviderConfig is called. Reaching this
      // branch means wiring is broken somewhere upstream.
      throw new Error(
        `${provider} provider uses subprocess transport; getProviderConfig should not be called for it`,
      )

    case "cursor-cli": {
      // OpenAI-compatible HTTP via local cursor-api-proxy.
      const endpoint = (customEndpoint || "http://127.0.0.1:8765/v1").replace(/\/+$/, "")
      const base = normalizeEndpoint(endpoint, "chat_completions").normalized.replace(/\/+$/, "")
      const url = /\/chat\/completions$/i.test(base)
        ? base
        : `${base}/chat/completions`
      const key = apiKey.trim() || "unused"
      return {
        url,
        headers: withCustomOriginHeader({
          "Content-Type": JSON_CONTENT_TYPE,
          Authorization: `Bearer ${key}`,
        }, url),
        buildBody: (messages, overrides) => ({
          ...buildOpenAiCompatibleBody(config, messages, overrides),
          model,
        }),
        parseStream: parseOpenAiLine,
        parseUsage: parseOpenAiUsage,
        parseFinishReason: parseOpenAiFinishReason,
      }
    }

    case "custom": {
      // Custom endpoints can speak either OpenAI's /chat/completions
      // wire or Anthropic's /v1/messages wire. The field `apiMode` on
      // the config picks which. Default (missing) = chat_completions
      // so pre-0.3.7 configs keep working unchanged.
      const mode = config.apiMode ?? "chat_completions"
      if (mode === "anthropic_messages") {
        const url = buildAnthropicUrl(customEndpoint)
        return {
          url,
          headers: withCustomOriginHeader(buildAnthropicHeaders(apiKey, url), url),
          buildBody: (messages, overrides) => ({
            ...buildAnthropicBodyWithReasoning(config, messages, overrides),
            model,
          }),
          parseStream: parseAnthropicLine,
          parseUsage: parseAnthropicUsage,
          parseFinishReason: parseAnthropicFinishReason,
        }
      }
      if (mode === "responses") {
        const base = normalizeEndpoint(customEndpoint, "responses").normalized.replace(/\/+$/, "")
        const url = /\/responses$/i.test(base)
          ? base
          : `${base}/responses`
        return {
          url,
          headers: getCustomCompatibleHeaders(apiKey, url),
          buildBody: (messages, overrides) => buildResponsesBody(config, messages, overrides),
          parseStream: parseResponsesLine,
          parseUsage: parseResponsesUsage,
          parseFinishReason: parseResponsesFinishReason,
        }
      }
      // Defense-in-depth: settings-side EndpointField normalizes URLs on
      // blur, but older configs saved before that shipped may still carry
      // a pasted "/chat/completions" tail. Don't double-append in that
      // case, or we'd POST to ".../chat/completions/chat/completions".
      const base = normalizeEndpoint(customEndpoint, "chat_completions").normalized.replace(/\/+$/, "")
      const url = isAzureOpenAiEndpoint(base)
        ? buildAzureOpenAiUrl(
            base,
            model,
            config.azureApiVersion ?? AZURE_OPENAI_API_VERSION,
          )
        : /\/chat\/completions$/i.test(base)
          ? base
          : `${base}/chat/completions`
      const azure = isAzureOpenAiEndpoint(url)
      return {
        url,
        headers: azure
          ? {
              "Content-Type": JSON_CONTENT_TYPE,
              ...(apiKey ? { "api-key": apiKey } : {}),
            }
          : withCustomOriginHeader({
              "Content-Type": JSON_CONTENT_TYPE,
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            }, url),
        buildBody: (messages, overrides) => {
          const body = buildOpenAiCompatibleBody(config, messages, overrides)
          if (!azure) body.model = model
          return body
        },
        parseStream: parseOpenAiLine,
        parseUsage: parseOpenAiUsage,
        parseFinishReason: parseOpenAiFinishReason,
      }
    }

    default: {
      const exhaustive: never = provider
      throw new Error(`Unknown provider: ${String(exhaustive)}`)
    }
  }
}
