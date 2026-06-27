import { useWikiStore, type LlmConfig, type NovelConfig, type ProviderOverride } from "@/stores/wiki-store"
import { LLM_PRESETS } from "@/components/settings/llm-presets"
import { resolveConfig } from "@/components/settings/preset-resolver"
import { hasUsableLlm } from "@/lib/has-usable-llm"

export type NovelTaskType = "writing" | "review" | "summary" | "extract" | "lint"

function isConfigUsable(cfg: LlmConfig, providerConfigs: Record<string, ProviderOverride>): boolean {
  return hasUsableLlm(cfg, providerConfigs)
}

export function resolveModelConfig(
  targetModel: string,
  baseConfig: LlmConfig,
  providerConfigs: Record<string, ProviderOverride>,
): LlmConfig {
  // 优先按 "providerId/modelId" 格式精确匹配
  const slashIdx = targetModel.indexOf("/")
  if (slashIdx > 0) {
    const providerId = targetModel.slice(0, slashIdx)
    const modelId = targetModel.slice(slashIdx + 1)
    const override = providerConfigs[providerId]
    if (override?.savedModels?.some((m) => m.model === modelId)) {
      const template = LLM_PRESETS.find((p) => p.id === providerId) ?? LLM_PRESETS.find((p) => p.id === "custom")
      if (template) {
        return { ...resolveConfig(template, override, baseConfig), model: modelId }
      }
    }
    return { ...baseConfig, model: modelId }
  }
  // 回退：按纯模型名匹配（兼容旧数据）
  for (const [providerId, override] of Object.entries(providerConfigs)) {
    if (override.savedModels?.some((m) => m.model === targetModel)) {
      const template = LLM_PRESETS.find((p) => p.id === providerId) ?? LLM_PRESETS.find((p) => p.id === "custom")
      if (template) {
        return { ...resolveConfig(template, override, baseConfig), model: targetModel }
      }
    }
  }
  return { ...baseConfig, model: targetModel }
}

/**
 * 解析后台任务的默认模型。
 * 优先级：defaultLlmModel > aiChatModel
 * 不回退到 baseConfig（llmConfig），避免静默使用已禁用的 CLI provider。
 * 用于提取记忆、提取角色等后台 AI 任务。
 */
export function resolveDefaultModel(baseConfig: LlmConfig): LlmConfig {
  const { providerConfigs, defaultLlmModel, aiChatModel } = useWikiStore.getState()

  const defaultModel = defaultLlmModel?.trim()
  if (defaultModel) {
    const cfg = resolveModelConfig(defaultModel, baseConfig, providerConfigs)
    if (isConfigUsable(cfg, providerConfigs)) {
      return cfg
    }
  }

  const chatModel = aiChatModel?.trim()
  if (chatModel && chatModel !== defaultModel) {
    const cfg = resolveModelConfig(chatModel, baseConfig, providerConfigs)
    if (isConfigUsable(cfg, providerConfigs)) {
      return cfg
    }
  }

  return { ...baseConfig, apiKey: "", model: "" }
}

export function resolveNovelModel(
  llmConfig: LlmConfig,
  novelConfig: NovelConfig,
  taskType: NovelTaskType,
): LlmConfig {
  const modelMap: Record<NovelTaskType, string> = {
    writing: "", // 写作模型已移除，始终使用 AI 会话当前模型
    review: novelConfig.reviewModel,
    summary: novelConfig.summaryModel,
    extract: novelConfig.extractModel,
    lint: novelConfig.reviewModel,
  }

  const { providerConfigs, defaultLlmModel, aiChatModel } = useWikiStore.getState()

  const taskModel = modelMap[taskType]
  if (taskModel?.trim()) {
    const cfg = resolveModelConfig(taskModel, llmConfig, providerConfigs)
    if (isConfigUsable(cfg, providerConfigs)) {
      return cfg
    }
  }

  const chatModel = aiChatModel?.trim()
  if (chatModel) {
    const cfg = resolveModelConfig(chatModel, llmConfig, providerConfigs)
    if (isConfigUsable(cfg, providerConfigs)) {
      return cfg
    }
  }

  const defaultModel = defaultLlmModel?.trim()
  if (defaultModel && defaultModel !== chatModel) {
    const cfg = resolveModelConfig(defaultModel, llmConfig, providerConfigs)
    if (isConfigUsable(cfg, providerConfigs)) {
      return cfg
    }
  }

  return { ...llmConfig, apiKey: "", model: "" }
}
