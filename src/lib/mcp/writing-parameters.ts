import { isAiWorkflowMode, resolveAiWorkflowMode, type AiWorkflowMode } from "@/lib/agent/workflow-mode"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import {
  resolveAgentSessionModel,
  resolveModelConfig,
  resolveNovelModel,
  resolveUsableModelKey,
} from "@/lib/novel/model-resolver"
import { applyReasoningDepth, REASONING_DEPTH_STEPS, type ReasoningDepth } from "@/lib/reasoning-depth"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"

export interface ResolvedWritingParameters {
  workflowMode: AiWorkflowMode
  /** 本次调用显式指定的推理档；`null` 表示没有覆盖，按供应商配置走。 */
  reasoningDepth: ReasoningDepth | null
  agentLlm: LlmConfig
  chapterWritingLlm: LlmConfig
}

function requireReasoningDepth(value: unknown): ReasoningDepth {
  if (typeof value === "string" && (REASONING_DEPTH_STEPS as readonly string[]).includes(value)) {
    return value as ReasoningDepth
  }
  throw new Error("思考深度无效，只能是 off、low、medium、high、max")
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
  // 推理档只从供应商配置来；这里只处理调用方显式传入的覆盖。
  const reasoningDepth = input.reasoningDepth === undefined
    ? null
    : requireReasoningDepth(input.reasoningDepth)
  const withDepth = (config: LlmConfig): LlmConfig =>
    reasoningDepth === null ? config : applyReasoningDepth(config, reasoningDepth)
  const requestedModel = typeof input.model === "string" ? input.model.trim() : ""
  // 已选模型不可用时明确报错，不能静默改用默认模型生成正文。
  const writingModel = requestedModel || state.aiChatModel.trim()
  const chapterWritingLlm = withDepth(writingModel
    ? (() => {
        const key = resolveUsableModelKey(writingModel, state.llmConfig, state.providerConfigs)
        if (!key) throw new Error(requestedModel
          ? `找不到写作模型：${requestedModel}`
          : `聊天框选中的写作模型不可用：${writingModel}，请重新选择模型`)
        return resolveModelConfig(key, state.llmConfig, state.providerConfigs)
      })()
    : resolveNovelModel(state.llmConfig, state.novelConfig, "writing"))
  const agentLlm = workflowMode === "fast"
    ? chapterWritingLlm
    : withDepth(resolveAgentSessionModel(state.llmConfig, state.novelConfig, workflowMode))
  if (!hasUsableLlm(chapterWritingLlm, state.providerConfigs) || !hasUsableLlm(agentLlm, state.providerConfigs)) {
    throw new Error("当前没有可用的写作模型")
  }
  return { workflowMode, reasoningDepth, agentLlm, chapterWritingLlm }
}
