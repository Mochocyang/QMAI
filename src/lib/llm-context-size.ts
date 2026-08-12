import type { LlmConfig, ProviderConfigs, ProviderOverride } from "@/stores/wiki-store"

export const MIN_USER_LLM_CONTEXT_SIZE = 204_800

/** Default declared output ceiling when neither the user nor the preset says
 *  otherwise. Generous on purpose — it must not silently truncate capable
 *  models — so presets should carry a real figure wherever one is known. */
export const DEFAULT_USER_LLM_MAX_OUTPUT_TOKENS = 131_072
/** Below this an answer is not worth requesting. */
export const MIN_USER_LLM_MAX_OUTPUT_TOKENS = 512
/** Highest output any model in the catalog declares (DeepSeek V4: 384K). */
export const MAX_USER_LLM_MAX_OUTPUT_TOKENS = 393_216

export function normalizeUserLlmContextSize(value: number | undefined): number {
  if (!Number.isFinite(value) || (value as number) <= 0) {
    return MIN_USER_LLM_CONTEXT_SIZE
  }
  return Math.max(MIN_USER_LLM_CONTEXT_SIZE, Math.floor(value as number))
}

/**
 * Unlike the context window this has no floor, only a default: a user must be
 * able to declare a small ceiling for a model that really does cap out low.
 */
export function normalizeUserLlmMaxOutputTokens(value: number | undefined): number {
  if (!Number.isFinite(value) || (value as number) <= 0) {
    return DEFAULT_USER_LLM_MAX_OUTPUT_TOKENS
  }
  return Math.max(
    MIN_USER_LLM_MAX_OUTPUT_TOKENS,
    Math.min(MAX_USER_LLM_MAX_OUTPUT_TOKENS, Math.floor(value as number)),
  )
}

export function normalizeUserLlmConfig(config: LlmConfig): LlmConfig {
  const maxContextSize = normalizeUserLlmContextSize(config.maxContextSize)
  const maxOutputTokens = config.maxOutputTokens === undefined
    ? undefined
    : normalizeUserLlmMaxOutputTokens(config.maxOutputTokens)
  return maxContextSize === config.maxContextSize && maxOutputTokens === config.maxOutputTokens
    ? config
    : { ...config, maxContextSize, ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }) }
}

export function normalizeProviderOverride(override: ProviderOverride): ProviderOverride {
  const maxContextSize = override.maxContextSize === undefined
    ? undefined
    : normalizeUserLlmContextSize(override.maxContextSize)
  const maxOutputTokens = override.maxOutputTokens === undefined
    ? undefined
    : normalizeUserLlmMaxOutputTokens(override.maxOutputTokens)
  if (maxContextSize === override.maxContextSize && maxOutputTokens === override.maxOutputTokens) {
    return override
  }
  return {
    ...override,
    ...(maxContextSize === undefined ? {} : { maxContextSize }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  }
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
