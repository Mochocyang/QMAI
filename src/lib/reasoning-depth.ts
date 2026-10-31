import type { LlmConfig, ReasoningMode } from "@/stores/wiki-store"

/**
 * 「推理程度」的档位，从左到右由弱到强。聊天框悬停弹窗与设置页共用这一份。
 *
 * 2026-10-28 起 **不再有「自动」档**：它原先表示"不覆盖、沿用设置里该供应商的推理配置"，
 * 而聊天框改成把选择直接写回供应商配置之后，设置本身就成了唯一的来源，
 * 「不覆盖」这个状态没有存在意义。默认档位因此是 `medium`（中）。
 *
 * `custom` 同样不在这里：自定义 token 预算要一个数字输入框，
 * 那属于设置页，不属于聊天框的悬停弹窗。
 */
export const REASONING_DEPTH_STEPS = [
  "off",
  "low",
  "medium",
  "high",
  "max",
] as const satisfies readonly ReasoningMode[]

export type ReasoningDepth = (typeof REASONING_DEPTH_STEPS)[number]

export const DEFAULT_REASONING_DEPTH: ReasoningDepth = "medium"

function isReasoningDepth(value: unknown): value is ReasoningDepth {
  return typeof value === "string"
    && (REASONING_DEPTH_STEPS as readonly string[]).includes(value)
}

/**
 * Coerce a persisted or user-supplied value onto a slider stop.
 *
 * 旧数据里的 `auto`（原来的「默认」档，含义是"沿用设置"）与设置页才有的 `custom`，
 * 都会回落到默认档 `medium`：档位现在必须明确，不能出现"什么都不发"的中间态。
 */
export function normalizeReasoningDepth(value: unknown): ReasoningDepth {
  return isReasoningDepth(value) ? value : DEFAULT_REASONING_DEPTH
}

export function reasoningDepthToIndex(depth: ReasoningDepth): number {
  const index = REASONING_DEPTH_STEPS.indexOf(depth)
  return index === -1 ? 0 : index
}

export function reasoningDepthFromIndex(index: number): ReasoningDepth {
  if (!Number.isFinite(index)) return DEFAULT_REASONING_DEPTH
  const clamped = Math.min(
    REASONING_DEPTH_STEPS.length - 1,
    Math.max(0, Math.round(index)),
  )
  return REASONING_DEPTH_STEPS[clamped]
}

/**
 * Stamp a depth onto the config that will actually be sent.
 *
 * The value has to land on `LlmConfig.reasoning` rather than
 * `RequestOverrides.reasoning`: `streamChat` and the outline/chapter budget
 * planners all derive their output-token floor from `config.reasoning`, so an
 * override-only path would ask for deep thinking without widening the output
 * allowance and the model would spend the whole budget on reasoning with no
 * content left.
 *
 * 现在只有一处调用：MCP 显式传入 `reasoningDepth` 时对本次调用生效。
 * 聊天框与大纲面板的会话级覆盖已移除，档位只从供应商配置来。
 */
export function applyReasoningDepth(config: LlmConfig, depth: ReasoningDepth): LlmConfig {
  // Normalized rather than trusted: a garbled persisted value reaching the
  // wire as `mode: undefined` would silently disable every thinking branch.
  const mode = normalizeReasoningDepth(depth)
  return { ...config, reasoning: { ...config.reasoning, mode } }
}
