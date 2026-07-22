import { useWikiStore, type LlmConfig, type NovelConfig, type ProviderOverride } from "@/stores/wiki-store"
import { LLM_PRESETS } from "@/components/settings/llm-presets"
import { resolveConfig } from "@/components/settings/preset-resolver"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { getStableAvailableModelKey, getEffectiveSavedModels } from "@/lib/llm-model-keys"

export type NovelTaskType = "writing" | "review" | "summary" | "extract" | "lint" | "deAi"

const UNUSABLE_LLM_CONFIG: Pick<LlmConfig, "provider" | "apiKey" | "model"> = {
  provider: "openai",
  apiKey: "",
  model: "",
}

function isConfigUsable(cfg: LlmConfig, providerConfigs: Record<string, ProviderOverride>): boolean {
  return hasUsableLlm(cfg, providerConfigs)
}

function toUnusableConfig(baseConfig: LlmConfig): LlmConfig {
  return { ...baseConfig, ...UNUSABLE_LLM_CONFIG }
}

export function isModelKeyRegistered(
  targetModel: string,
  providerConfigs: Record<string, ProviderOverride>,
): boolean {
  const trimmed = targetModel.trim()
  if (!trimmed) return false

  const slashIdx = trimmed.indexOf("/")
  if (slashIdx > 0) {
    const providerId = trimmed.slice(0, slashIdx)
    const modelId = trimmed.slice(slashIdx + 1)
    return !!getEffectiveSavedModels(providerConfigs[providerId] ?? {}).some((m) => m.model === modelId)
  }

  for (const override of Object.values(providerConfigs)) {
    if (getEffectiveSavedModels(override).some((m) => m.model === trimmed)) {
      return true
    }
  }
  return false
}

function resolveRegisteredModel(
  targetModel: string,
  baseConfig: LlmConfig,
  providerConfigs: Record<string, ProviderOverride>,
): LlmConfig | null {
  const trimmed = targetModel.trim()
  if (!trimmed || !isModelKeyRegistered(trimmed, providerConfigs)) {
    return null
  }
  const cfg = resolveModelConfig(trimmed, baseConfig, providerConfigs)
  return isConfigUsable(cfg, providerConfigs) ? cfg : null
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
    if (override && getEffectiveSavedModels(override).some((m) => m.model === modelId)) {
      const template = LLM_PRESETS.find((p) => p.id === providerId) ?? LLM_PRESETS.find((p) => p.id === "custom")
      if (template) {
        return { ...resolveConfig(template, override, baseConfig), model: modelId }
      }
    }
    return { ...baseConfig, model: modelId }
  }
  // 回退：按纯模型名匹配（兼容旧数据）
  for (const [providerId, override] of Object.entries(providerConfigs)) {
    if (getEffectiveSavedModels(override).some((m) => m.model === targetModel)) {
      const template = LLM_PRESETS.find((p) => p.id === providerId) ?? LLM_PRESETS.find((p) => p.id === "custom")
      if (template) {
        return { ...resolveConfig(template, override, baseConfig), model: targetModel }
      }
    }
  }
  return { ...baseConfig, model: targetModel }
}

export function resolveUsableModelKey(
  targetModel: string,
  baseConfig: LlmConfig,
  providerConfigs: Record<string, ProviderOverride>,
): string {
  const stableModelKey = getStableAvailableModelKey(targetModel, providerConfigs)
  if (!stableModelKey) return ""
  const resolved = resolveModelConfig(stableModelKey, baseConfig, providerConfigs)
  return isConfigUsable(resolved, providerConfigs) ? stableModelKey : ""
}

function resolveProjectDefaultLlmModel(): string {
  const { novelConfig, defaultLlmModel } = useWikiStore.getState()
  return novelConfig.defaultLlmModel?.trim() || defaultLlmModel?.trim() || ""
}

/**
 * 解析后台任务的默认模型。
 * 优先级：defaultLlmModel > aiChatModel
 * 不回退到 baseConfig（llmConfig），避免静默使用已禁用的 CLI provider。
 * 用于导入队列、书籍分析、去重等通用后台任务；不含小说章节/大纲摄取（见 resolveNovelModel）。
 */
export function resolveDefaultModel(baseConfig: LlmConfig): LlmConfig {
  const { providerConfigs, aiChatModel } = useWikiStore.getState()

  const defaultModel = resolveProjectDefaultLlmModel()
  if (defaultModel) {
    const cfg = resolveRegisteredModel(defaultModel, baseConfig, providerConfigs)
    if (cfg) return cfg
  }

  const chatModel = aiChatModel?.trim()
  if (chatModel && chatModel !== defaultModel) {
    const cfg = resolveRegisteredModel(chatModel, baseConfig, providerConfigs)
    if (cfg) return cfg
  }

  return toUnusableConfig(baseConfig)
}

export function resolveNovelModel(
  llmConfig: LlmConfig,
  novelConfig: NovelConfig,
  taskType: NovelTaskType,
): LlmConfig {
  const modelMap: Record<NovelTaskType, string> = {
    writing: "", // 写作正文属于“聊天写小说”，直接用聊天模型（下方特判）
    review: novelConfig.reviewModel,
    summary: novelConfig.summaryModel,
    extract: novelConfig.extractModel,
    lint: novelConfig.reviewModel,
    deAi: novelConfig.deAiModel,
  }

  const { providerConfigs, aiChatModel } = useWikiStore.getState()
  const chatModel = aiChatModel?.trim()

  // 写作正文：聊天模型优先，默认模型兜底。
  if (taskType === "writing") {
    if (chatModel) {
      const cfg = resolveRegisteredModel(chatModel, llmConfig, providerConfigs)
      if (cfg) return cfg
    }
    const defaultModel = resolveProjectDefaultLlmModel()
    if (defaultModel && defaultModel !== chatModel) {
      const cfg = resolveRegisteredModel(defaultModel, llmConfig, providerConfigs)
      if (cfg) return cfg
    }
    return toUnusableConfig(llmConfig)
  }

  // 其余任务级模型（审稿/摘要/提取/lint）：
  //   任务单独设置 > 默认模型 > 聊天模型（仅默认未设置时兜底）
  const taskModel = modelMap[taskType]
  if (taskModel?.trim()) {
    const cfg = resolveRegisteredModel(taskModel, llmConfig, providerConfigs)
    if (cfg) return cfg
  }

  const defaultModel = resolveProjectDefaultLlmModel()
  if (defaultModel) {
    const cfg = resolveRegisteredModel(defaultModel, llmConfig, providerConfigs)
    if (cfg) return cfg
  }

  if (chatModel && chatModel !== defaultModel) {
    const cfg = resolveRegisteredModel(chatModel, llmConfig, providerConfigs)
    if (cfg) return cfg
  }

  return toUnusableConfig(llmConfig)
}

export function formatResolvedModelLabel(
  config: LlmConfig,
  providerConfigs: Record<string, ProviderOverride>,
): string {
  const model = config.model.trim()
  if (!model) return "未知模型"

  for (const override of Object.values(providerConfigs)) {
    const found = getEffectiveSavedModels(override).find((saved) => saved.model === model)
    if (found?.name?.trim()) return found.name.trim()
  }

  return model
}
