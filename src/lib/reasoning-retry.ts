import type { LlmConfig, ReasoningConfig } from "@/stores/wiki-store"
import type { ChatMessage, RequestOverrides } from "./llm-providers"

const REASONING_ONLY_RESPONSE_RE = /模型只输出了[\s\S]*思考内容[\s\S]*没有输出正文/

function isToolAssistant(message: ChatMessage): boolean {
  return message.role === "assistant" && (message.tool_calls?.length ?? 0) > 0
}

/** DeepSeek thinking 把空串当成没回传；缺字段或空字段都无法续轮。 */
export function hasUnreplayableToolAssistantReasoning(messages: ChatMessage[]): boolean {
  return messages.some((message) => isToolAssistant(message) && !message.reasoning_content?.trim())
}

export function stripEmptyReasoningContent(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.reasoning_content === undefined || message.reasoning_content.trim()) {
      return message
    }
    const { reasoning_content: _dropped, ...rest } = message
    return rest
  })
}

export function isReasoningOnlyResponseError(error: Error): boolean {
  return REASONING_ONLY_RESPONSE_RE.test(error.message)
}

export function isReasoningDisabled(
  config: Pick<LlmConfig, "reasoning">,
  overrides?: RequestOverrides,
): boolean {
  const effectiveReasoning: ReasoningConfig | undefined = overrides?.reasoning ?? config.reasoning
  return effectiveReasoning?.mode === "off"
}

export function withReasoningDisabled(overrides?: RequestOverrides): RequestOverrides {
  return {
    ...(overrides ?? {}),
    reasoning: { mode: "off" },
  }
}
