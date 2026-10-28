import type { LlmConfig, ProviderConfigs, ProviderOverride } from "@/stores/wiki-store"
import { isPluginProviderInjected } from "@/lib/plugins/provider-registry"

export const MIN_USER_LLM_CONTEXT_SIZE = 204_800

/** Default declared output ceiling when neither the user nor the preset says
 *  otherwise. Generous on purpose — it must not silently truncate capable
 *  models — so presets should carry a real figure wherever one is known. */
const DEFAULT_USER_LLM_MAX_OUTPUT_TOKENS = 131_072
/** Below this an answer is not worth requesting. */
const MIN_USER_LLM_MAX_OUTPUT_TOKENS = 512
/** Highest output any model in the catalog declares (DeepSeek V4: 384K). */
const MAX_USER_LLM_MAX_OUTPUT_TOKENS = 393_216

/**
 * 用户手填窗口的规范化：低于 `MIN_USER_LLM_CONTEXT_SIZE` 的一律抬到下限。
 *
 * `floor` 只给**不受用户输入护栏约束**的调用方用（插件声明值，见
 * `normalizeDeclaredContextSize`）；不传就是原来的用户护栏。
 */
export function normalizeUserLlmContextSize(
  value: number | undefined,
  floor: number = MIN_USER_LLM_CONTEXT_SIZE,
): number {
  if (!Number.isFinite(value) || (value as number) <= 0) {
    return MIN_USER_LLM_CONTEXT_SIZE
  }
  return Math.max(floor, Math.floor(value as number))
}

/**
 * 声明式窗口的规范化（插件 provider 专用）：**不套用户输入下限**。
 *
 * 插件模型目录里的 `maxInputTokens` 是上游的客观事实（设计 3.4：缺失即拒绝该模型，
 * 理由正是剪裁必须依赖真实窗口）。32k 就是 32k。
 * `MIN_USER_LLM_CONTEXT_SIZE` 的用途是拦住**用户手填**的不靠谱数字；套到插件上
 * 会把真实窗口抬高，剪裁于是塞进模型装不下的上下文 → 上游 400，
 * 而报错看起来像「上下文超出」，用户完全看不出是我们的下限造成的。
 */
export function normalizeDeclaredContextSize(value: number | undefined): number {
  if (!Number.isFinite(value) || (value as number) <= 0) {
    return MIN_USER_LLM_CONTEXT_SIZE
  }
  return Math.floor(value as number)
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

export function normalizeProviderOverride(
  override: ProviderOverride,
  options: { contextFloor?: number } = {},
): ProviderOverride {
  const maxContextSize = override.maxContextSize === undefined
    ? undefined
    : normalizeUserLlmContextSize(override.maxContextSize, options.contextFloor)
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
      /*
       * 插件 provider 的窗口是上游目录声明的客观事实（设计 3.4），不套
       * 「用户手填」下限：抬到 204800 会让 32k 的模型收到必然 400 的请求，
       * 而且报错完全看不出是我们的下限造成的。
       * 其它（用户手工配置的）provider 继续走原来的护栏。
       */
      const next = normalizeProviderOverride(override, {
        contextFloor: isPluginProviderInjected(id) ? 0 : MIN_USER_LLM_CONTEXT_SIZE,
      })
      if (next !== override) changed = true
      return [id, next]
    }),
  )
  return changed ? normalized : configs
}
