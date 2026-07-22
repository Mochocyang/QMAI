import type { ProviderConfigs, ProviderOverride, SavedModel } from "@/stores/wiki-store"

function isProviderAvailable(providerId: string, config: ProviderOverride): boolean {
  if (providerId.startsWith("custom-")) {
    return config.enabled !== false
  }
  // 内置预设：已启用，或有有效配置（apiKey + model/savedModels）
  return config.enabled === true
    || Boolean((config.apiKey || config.savedModels?.length) && (config.model || config.savedModels?.length))
}

function getAvailableProviderEntries(
  providerConfigs: ProviderConfigs,
): Array<[string, ProviderOverride]> {
  const entries = Object.entries(providerConfigs)
  return [
    ...entries.filter(([providerId, config]) =>
      !providerId.startsWith("custom-") && isProviderAvailable(providerId, config)),
    ...entries.filter(([providerId, config]) =>
      providerId.startsWith("custom-") && isProviderAvailable(providerId, config)),
  ]
}

/**
 * 获取 provider 的有效模型列表。
 * 优先使用 savedModels；为空时回退到 model 字段（兼容旧数据/未拉取模型的场景）。
 */
export function getEffectiveSavedModels(config: ProviderOverride): SavedModel[] {
  if (config.savedModels && config.savedModels.length > 0) {
    return config.savedModels
  }
  const model = config.model?.trim()
  if (model) {
    return [{
      id: `fallback-${model}`,
      name: model,
      model,
      createdAt: 0,
    }]
  }
  return []
}

export function hasAvailableModels(providerConfigs: ProviderConfigs): boolean {
  return getAvailableProviderEntries(providerConfigs)
    .some(([, config]) => getEffectiveSavedModels(config).length > 0)
}

export function getFirstAvailableModelKey(providerConfigs: ProviderConfigs): string {
  for (const [providerId, config] of getAvailableProviderEntries(providerConfigs)) {
    const first = getEffectiveSavedModels(config)[0]
    if (first) return `${providerId}/${first.model}`
  }
  return ""
}

export function getStableAvailableModelKey(
  targetModel: string,
  providerConfigs: ProviderConfigs,
): string {
  const trimmed = targetModel.trim()
  if (!trimmed) return ""

  let exactProviderId: string | null = null
  const slashIdx = trimmed.indexOf("/")
  if (slashIdx > 0) {
    const providerId = trimmed.slice(0, slashIdx)
    if (Object.prototype.hasOwnProperty.call(providerConfigs, providerId)) {
      exactProviderId = providerId
      const modelId = trimmed.slice(slashIdx + 1)
      const config = providerConfigs[providerId]
      if (
        isProviderAvailable(providerId, config)
        && getEffectiveSavedModels(config).some((model) => model.model === modelId)
      ) {
        return `${providerId}/${modelId}`
      }
    }
  }

  for (const [providerId, config] of getAvailableProviderEntries(providerConfigs)) {
    if (providerId === exactProviderId) continue
    if (getEffectiveSavedModels(config).some((model) => model.model === trimmed)) {
      return `${providerId}/${trimmed}`
    }
  }
  return ""
}
