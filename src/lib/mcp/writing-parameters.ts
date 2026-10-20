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
  // MCP 不指定模式时，读取聊天框当前选择；显式覆盖仅作用于本次调用。
  const workflowMode = input.workflowMode === undefined
    ? resolveAiWorkflowMode(state.aiWorkflowMode)
    : input.workflowMode
  const reasoningDepth = input.reasoningDepth === undefined
    ? normalizeReasoningDepth(state.aiChatReasoningDepth)
    : requireReasoningDepth(input.reasoningDepth)
  const requestedModel = typeof input.model === "string" ? input.model.trim() : ""
  // 已选模型不可用时明确报错，不能静默改用默认模型生成正文。
  const writingModel = requestedModel || state.aiChatModel.trim()
  const chapterWritingLlm = writingModel
    ? (() => {
        const key = resolveUsableModelKey(writingModel, state.llmConfig, state.providerConfigs)
        if (!key) throw new Error(requestedModel
          ? `找不到写作模型：${requestedModel}`
          : `聊天框选中的写作模型不可用：${writingModel}，请重新选择模型`)
        return applyReasoningDepth(resolveModelConfig(key, state.llmConfig, state.providerConfigs), reasoningDepth)
      })()
    : applyReasoningDepth(resolveNovelModel(state.llmConfig, state.novelConfig, "writing"), reasoningDepth)
  const agentLlm = workflowMode === "fast"
    ? chapterWritingLlm
    : applyReasoningDepth(resolveAgentSessionModel(state.llmConfig, state.novelConfig, workflowMode), reasoningDepth)
  if (!hasUsableLlm(chapterWritingLlm, state.providerConfigs) || !hasUsableLlm(agentLlm, state.providerConfigs)) {
    throw new Error("当前没有可用的写作模型")
  }
  return { workflowMode, reasoningDepth, agentLlm, chapterWritingLlm }
}
