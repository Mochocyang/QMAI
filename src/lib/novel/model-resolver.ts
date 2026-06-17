import { useWikiStore, type LlmConfig, type NovelConfig, type ProviderOverride } from "@/stores/wiki-store"
import { LLM_PRESETS } from "@/components/settings/llm-presets"
import { resolveConfig } from "@/components/settings/preset-resolver"

export type NovelTaskType = "writing" | "review" | "summary" | "extract" | "lint"

function resolveModelConfig(
  targetModel: string,
  baseConfig: LlmConfig,
  providerConfigs: Record<string, ProviderOverride>,
): LlmConfig {
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

export function resolveNovelModel(
  llmConfig: LlmConfig,
  novelConfig: NovelConfig,
  taskType: NovelTaskType,
): LlmConfig {
  const modelMap: Record<NovelTaskType, string> = {
    writing: novelConfig.writingModel,
    review: novelConfig.reviewModel,
    summary: novelConfig.summaryModel,
    extract: novelConfig.extractModel,
    lint: novelConfig.reviewModel,
  }

  const { providerConfigs, aiChatModel } = useWikiStore.getState()

  const taskModel = modelMap[taskType]
  if (!taskModel) {
    const sessionModel = aiChatModel.trim()
    if (sessionModel) {
      return resolveModelConfig(sessionModel, llmConfig, providerConfigs)
    }
    return llmConfig
  }

  return resolveModelConfig(taskModel, llmConfig, providerConfigs)
}