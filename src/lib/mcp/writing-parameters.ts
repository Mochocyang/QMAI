import { isAiWorkflowMode, resolveAiWorkflowMode, type AiWorkflowMode } from "@/lib/agent/workflow-mode"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import {
  resolveAgentSessionModel,
  resolveModelConfig,
  resolveNovelModel,
  resolveUsableModelKey,
} from "@/lib/novel/model-resolver"
import { applyReasoningDepth, normalizeReasoningDepth, REASONING_DEPTH_STEPS, type ReasoningDepth } from "@/lib/reasoning-depth"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"

export interface ResolvedWritingParameters {
  workflowMode: AiWorkflowMode
  reasoningDepth: ReasoningDepth
  agentLlm: LlmConfig
  chapterWritingLlm: LlmConfig
}

function requireReasoningDepth(value: unknown): ReasoningDepth {
  if (typeof value === "string" && (REASONING_DEPTH_STEPS as readonly string[]).includes(value)) {
    return value as ReasoningDepth
  }
  throw new Error("思考深度无效，只能是 auto、off、low、medium、high、max")
}

export function resolveWritingParameters(input: {
  workflowMode?: unknown
  model?: unknown
  reasoningDepth?: unknown
} = {}): ResolvedWritingParameters {
  const state = useWikiStore.getState()
  if (input.workflowMode !== undefined && !isAiWorkflowMode(input.workflowMode)) {
    throw new Error("写作模式无效，只能是 fast、standard、strict、discuss")
  }
  const workflowMode = input.workflowMode === undefined
    ? resolveAiWorkflowMode(state.aiWorkflowMode)
    : input.workflowMode
  const reasoningDepth = input.reasoningDepth === undefined
    ? normalizeReasoningDepth(state.aiChatReasoningDepth)
    : requireReasoningDepth(input.reasoningDepth)
  const requestedModel = typeof input.model === "string" ? input.model.trim() : ""
  const chapterWritingLlm = requestedModel
    ? (() => {
        const key = resolveUsableModelKey(requestedModel, state.llmConfig, state.providerConfigs)
        if (!key) throw new Error(`找不到写作模型：${requestedModel}`)
        return applyReasoningDepth(resolveModelConfig(key, state.llmConfig, state.providerConfigs), reasoningDepth)
      })()
    : applyReasoningDepth(resolveNovelModel(state.llmConfig, state.novelConfig, "writing"), reasoningDepth)
  const agentLlm = workflowMode === "fast"
    ? chapterWritingLlm
    : applyReasoningDepth(resolveAgentSessionModel(state.llmConfig, state.novelConfig, workflowMode), reasoningDepth)
  if (!hasUsableLlm(agentLlm, state.providerConfigs)) {
    throw new Error("当前没有可用的写作模型")
  }
  return { workflowMode, reasoningDepth, agentLlm, chapterWritingLlm }
}
