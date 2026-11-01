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
 * 预算规划层用的窗口：**信任调用方传入的声明值，只兜非法/荒谬值**。
 *
 * 为什么这里不再套 `MIN_USER_LLM_CONTEXT_SIZE`：
 * 「用户手填不许低于 204800」是**输入护栏**，已经在 config 边界做过
 * （`normalizeProviderConfigs` / `normalizeUserLlmConfig`）。到预算层再套一遍
 * 不会多出任何安全性，却会把插件按上游目录声明的真实窗口（设计 3.4）抬歪 ——
 * 32k 的模型会被规划成 200k 的请求尺寸，上游必然 400，而报错看起来像
 * 「上下文超出」，完全看不出是我们的下限造成的。
 *
 * 留下的兜底只针对「不可能是真实窗口」的值：0 / 负数 / NaN / 小于 1024 的荒谬值。
 * 这样「窗口是否合法」只有一个真源（config 边界），预算层只负责消费。
 */
const ABSURD_CONTEXT_WINDOW = 1_024

export function trustDeclaredContextWindow(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) >= ABSURD_CONTEXT_WINDOW
    ? Math.floor(value as number)
    : MIN_USER_LLM_CONTEXT_SIZE
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
