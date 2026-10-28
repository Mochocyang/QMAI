import { useWikiStore, type LlmConfig, type NovelConfig, type ProviderOverride } from "@/stores/wiki-store"
import { findLlmPresetById } from "@/components/settings/llm-presets"
import { resolveConfig } from "@/components/settings/preset-resolver"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { getEffectiveMaxContextSize, getEffectiveMaxOutputTokens } from "@/lib/llm-providers"
import { getStableAvailableModelKey, getEffectiveSavedModels } from "@/lib/llm-model-keys"
import { isPluginProviderInjected } from "@/lib/plugins/provider-sync"
import { normalizeDeclaredContextSize, normalizeUserLlmConfig, normalizeUserLlmMaxOutputTokens } from "@/lib/llm-context-size"
import type { AiWorkflowMode } from "@/lib/agent/workflow-mode"

export type NovelTaskType = "writing" | "review" | "summary" | "extract" | "lint" | "deAi"

const UNUSABLE_LLM_CONFIG: Pick<LlmConfig, "provider" | "apiKey" | "model"> = {
  provider: "openai",
  apiKey: "",
  model: "",
}

function isConfigUsable(cfg: LlmConfig, providerConfigs: Record<string, ProviderOverride>): boolean {
  return hasUsableLlm(cfg, providerConfigs)
}

function withEffectiveContextSize(config: LlmConfig): LlmConfig {
  /*
   * 插件 provider 的窗口是插件按上游目录声明的**客观事实**（设计 3.4），
   * 而 `MIN_USER_LLM_CONTEXT_SIZE` 是「用户手填」的护栏。把下限套到插件模型上，
   * 32k 窗口的模型会被抬到 204800：剪裁按 204800 塞上下文 → 上游 400，
   * 报错看起来像「上下文超出」，用户完全看不出是我们的下限造成的。
   * 所以这里（以及 `normalizeProviderConfigs`）对插件 provider 跳过下限。
   */
  if (isPluginProviderInjected(config.provider)) {
    return {
      ...config,
      maxContextSize: normalizeDeclaredContextSize(config.maxContextSize),
      ...(config.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: normalizeUserLlmMaxOutputTokens(config.maxOutputTokens) }),
    }
  }
  const normalized = normalizeUserLlmConfig(config)
  return {
    ...normalized,
    maxContextSize: getEffectiveMaxContextSize(normalized),
    maxOutputTokens: getEffectiveMaxOutputTokens(normalized),
  }
}

function toUnusableConfig(baseConfig: LlmConfig): LlmConfig {
  return withEffectiveContextSize({ ...baseConfig, ...UNUSABLE_LLM_CONFIG })
}

function isModelKeyRegistered(
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

/**
 * 把一个 provider 的 override 解析成完整 `LlmConfig`。
 *
 * 插件 provider 没有静态 preset（`LLM_PRESETS` 只放内置），所以**不能**沿用
 * `findLlmPresetById(id) ?? findLlmPresetById("custom")`：那条路会把 `provider`
 * 改写成 `"custom"`，请求落到 custom 分支，用一个按设计永远为空的 `apiKey`
 * 发出去（插件侧只会回 401），而插件 provider 的 token 本应在请求前由
 * `ensurePluginProviderAuth` 现取。
 *
 * 插件的路径：借 custom preset 搬运字段（上下文窗口、推理、工具开关），
 * 但 `provider` 保持插件 id、端点取宿主分配的 `baseUrl`（写进 `customEndpoint`，
 * 与 workbuddy / cursor-cli 注入运行期端点同构）。
 */
function resolveOverrideConfig(
  providerId: string,
  override: ProviderOverride,
  baseConfig: LlmConfig,
  modelId: string,
): LlmConfig | null {
  const preset = findLlmPresetById(providerId)
  if (preset) {
    return withEffectiveContextSize({ ...resolveConfig(preset, override, baseConfig), model: modelId })
  }

  const customTemplate = findLlmPresetById("custom")
  if (!customTemplate) return null

  if (isPluginProviderInjected(providerId)) {
    const config = resolveConfig(customTemplate, override, baseConfig)
    return withEffectiveContextSize({
      ...config,
      // 请求分派必须落到插件分支（`llm-providers` 的 default case）。
      provider: providerId,
      // token 不落盘（计划第 0 节）：这里留空，请求前现取。
      apiKey: "",
      model: modelId,
      // 宿主分配的 baseUrl（`http://127.0.0.1:<port>`，设计 D4）。
      customEndpoint: override.baseUrl ?? config.customEndpoint,
      // 插件端点契约固定 OpenAI 兼容（设计 3.1），不允许被旧配置带到 Responses/Anthropic。
      apiMode: "chat_completions",
      // `resolveConfig` 会按「用户手填」下限把声明窗口抬到 204800；
      // 插件声明值必须原样还原：32k 就是 32k（见 `withEffectiveContextSize` 的注释）。
      maxContextSize: override.maxContextSize ?? config.maxContextSize,
      maxOutputTokens: override.maxOutputTokens ?? config.maxOutputTokens,
    })
  }

  // 用户手工配置的 `custom-*` 卡片：沿用 custom preset，行为不变。
  return withEffectiveContextSize({ ...resolveConfig(customTemplate, override, baseConfig), model: modelId })
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
      const resolved = resolveOverrideConfig(providerId, override, baseConfig, modelId)
      if (resolved) return resolved
    }
    return withEffectiveContextSize({ ...baseConfig, model: modelId })
  }
  // 回退：按纯模型名匹配（兼容旧数据）
  for (const [providerId, override] of Object.entries(providerConfigs)) {
    if (getEffectiveSavedModels(override).some((m) => m.model === targetModel)) {
      const resolved = resolveOverrideConfig(providerId, override, baseConfig, targetModel)
      if (resolved) return resolved
    }
  }
  return withEffectiveContextSize({ ...baseConfig, model: targetModel })
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

/**
 * 解析 AI 会话主 Agent 使用的模型。
 * 快速模式像普通对话/大纲绘制一样由主 Agent 直接出稿，必须用聊天框选中的写作模型。
 * 标准/严格模式主 Agent 只负责编排，继续用默认模型；正文由 chapterWritingLlmConfig 走聊天模型。
 */
export function resolveAgentSessionModel(
  baseConfig: LlmConfig,
  novelConfig: NovelConfig,
  workflowMode: AiWorkflowMode,
): LlmConfig {
  if (workflowMode === "fast") {
    return resolveNovelModel(baseConfig, novelConfig, "writing")
  }
  return resolveDefaultModel(baseConfig)
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
