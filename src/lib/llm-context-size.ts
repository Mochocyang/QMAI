import type { LlmConfig, ProviderConfigs, ProviderOverride } from "@/stores/wiki-store"

export const MIN_USER_LLM_CONTEXT_SIZE = 204_800

/** Default declared output ceiling when neither the user nor the preset says
 *  otherwise. Generous on purpose — it must not silently truncate capable
 *  models — so presets should carry a real figure wherever one is known. */
const DEFAULT_USER_LLM_MAX_OUTPUT_TOKENS = 131_072
/** Below this an answer is not worth requesting. */
const MIN_USER_LLM_MAX_OUTPUT_TOKENS = 512
/** Highest output any model in the catalog declares (DeepSeek V4: 384K). */
const MAX_USER_LLM_MAX_OUTPUT_TOKENS = 393_216

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
  /**
   * 「自动」（auto）档已从界面上取消，改为默认「中」。
   * 老配置读进来就地迁移，否则它会一直以"什么都不发"的状态留在磁盘上，
   * 用户在弹窗里根本看不到自己是哪一档。
   */
  const reasoning = override.reasoning?.mode === "auto"
    ? { ...override.reasoning, mode: "medium" as const }
    : override.reasoning
  if (
    maxContextSize === override.maxContextSize &&
    maxOutputTokens === override.maxOutputTokens &&
    reasoning === override.reasoning
  ) {
    return override
  }
  return {
    ...override,
    ...(maxContextSize === undefined ? {} : { maxContextSize }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(reasoning === undefined ? {} : { reasoning }),
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
