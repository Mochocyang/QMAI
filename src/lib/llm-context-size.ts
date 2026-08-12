import type { LlmConfig, ProviderConfigs, ProviderOverride } from "@/stores/wiki-store"

export const MIN_USER_LLM_CONTEXT_SIZE = 204_800

export function normalizeUserLlmContextSize(value: number | undefined): number {
  if (!Number.isFinite(value) || (value as number) <= 0) {
    return MIN_USER_LLM_CONTEXT_SIZE
  }
  return Math.max(MIN_USER_LLM_CONTEXT_SIZE, Math.floor(value as number))
}

export function normalizeUserLlmConfig(config: LlmConfig): LlmConfig {
  const maxContextSize = normalizeUserLlmContextSize(config.maxContextSize)
  return maxContextSize === config.maxContextSize
    ? config
    : { ...config, maxContextSize }
}

export function normalizeProviderOverride(override: ProviderOverride): ProviderOverride {
  if (override.maxContextSize === undefined) return override
  const maxContextSize = normalizeUserLlmContextSize(override.maxContextSize)
  return maxContextSize === override.maxContextSize
    ? override
    : { ...override, maxContextSize }
}

export function normalizeProviderConfigs(configs: ProviderConfigs): ProviderConfigs {
  let changed = false
  const normalized = Object.fromEntries(
    Object.entries(configs).map(([id, override]) => {
      const next = normalizeProviderOverride(override)
      if (next !== override) changed = true
      return [id, next]
    }),
  )
  return changed ? normalized : configs
}
