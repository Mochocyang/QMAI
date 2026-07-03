import type { LlmConfig, ReasoningConfig } from "@/stores/wiki-store"
import type { RequestOverrides } from "./llm-providers"

const REASONING_ONLY_RESPONSE_RE = /模型只输出了[\s\S]*思考内容[\s\S]*没有输出正文/

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
