import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatMessage, RequestOverrides } from "./llm-providers"
import { sha256Text } from "./context-hub/fingerprint"

/** 只向确认支持的官方入口发送路由参数，兼容网关不能靠模型名称推断。 */
export function supportsPromptCacheRouting(config: LlmConfig): boolean {
  if (config.provider === "openai") return true
  if (config.provider !== "custom" || config.apiMode === "anthropic_messages") return false
  try {
    const endpoint = new URL(config.customEndpoint)
    return endpoint.protocol === "https:" && endpoint.hostname === "api.openai.com"
      && (!endpoint.port || endpoint.port === "443")
  } catch {
    return false
  }
}

export async function preparePromptCacheRouting(
  config: LlmConfig,
  messages: ChatMessage[],
  overrides: RequestOverrides,
): Promise<RequestOverrides> {
  if (overrides.promptCacheKey !== undefined) {
    overrides = { ...overrides }
    delete overrides.promptCacheKey
  }
  if (!supportsPromptCacheRouting(config)) return overrides
  for (const [messageIndex, message] of messages.entries()) {
    if (!Array.isArray(message.content)) continue
    const blockIndex = message.content.findIndex((block) => block.type === "text" && block.cacheControl)
    if (blockIndex < 0) continue
    const prefix = [...messages.slice(0, messageIndex), { ...message, content: message.content.slice(0, blockIndex + 1) }]
    try {
      const promptCacheKey = await sha256Text(JSON.stringify({
        version: 1,
        model: config.model,
        apiMode: config.provider === "openai" ? "chat_completions" : config.apiMode ?? "chat_completions",
        scope: overrides.userMemoryProjectKey ?? overrides.userMemorySessionKey ?? "",
        tools: overrides.tools ?? [],
        toolChoice: overrides.toolChoice,
        reasoning: overrides.reasoning ?? config.reasoning ?? { mode: "auto" },
        prefix,
      }))
      return { ...overrides, promptCacheKey }
    } catch {
      // 路由优化失败不能阻止原有模型请求；自动前缀缓存仍由供应商决定。
      return overrides
    }
  }
  return overrides
}
