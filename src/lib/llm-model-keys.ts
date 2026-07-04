import type { ProviderConfigs } from "@/stores/wiki-store"

export function hasAvailableModels(providerConfigs: ProviderConfigs): boolean {
  for (const key of Object.keys(providerConfigs)) {
    const config = providerConfigs[key]
    if (key.startsWith("custom-")) {
      if (config.enabled === false) continue
    } else {
      if (config.enabled !== true) continue
    }
    if (config.savedModels && config.savedModels.length > 0) {
      return true
    }
  }
  return false
}

export function getFirstAvailableModelKey(providerConfigs: ProviderConfigs): string {
  for (const key of Object.keys(providerConfigs)) {
    if (key.startsWith("custom-")) continue
    const config = providerConfigs[key]
    if (config.enabled !== true) continue
    const first = config.savedModels?.[0]
    if (first) return `${key}/${first.model}`
  }
  for (const key of Object.keys(providerConfigs)) {
    if (!key.startsWith("custom-")) continue
    const config = providerConfigs[key]
    if (config.enabled === false) continue
    const first = config.savedModels?.[0]
    if (first) return `${key}/${first.model}`
  }
  return ""
}
