import type { LlmConfig, ReasoningMode } from "@/stores/wiki-store"

/**
 * Slider stops for the chat-model thinking depth control, ordered left to
 * right. `auto` sits at index 0 as the "default" stop: it means *defer*, not
 * "less than off", so the UI must mark it apart from the monotonic tail.
 *
 * `custom` is intentionally absent. A token budget needs a number field,
 * which belongs in settings next to the provider config, not in a chat
 * footer popover.
 */
export const REASONING_DEPTH_STEPS = [
  "auto",
  "off",
  "low",
  "medium",
  "high",
  "max",
] as const satisfies readonly ReasoningMode[]

export type ReasoningDepth = (typeof REASONING_DEPTH_STEPS)[number]

export const DEFAULT_REASONING_DEPTH: ReasoningDepth = "auto"

function isReasoningDepth(value: unknown): value is ReasoningDepth {
  return typeof value === "string"
    && (REASONING_DEPTH_STEPS as readonly string[]).includes(value)
}

/**
 * Coerce a persisted or user-supplied value onto a slider stop. Anything
 * unrecognised — including the `custom` mode that settings can still hold —
 * falls back to `auto`, which leaves the provider config untouched.
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
 * Stamp a slider depth onto the config that will actually be sent.
 *
 * The value has to land on `LlmConfig.reasoning` rather than
 * `RequestOverrides.reasoning`: `streamChat` and the outline/chapter budget
 * planners all derive their output-token floor from `config.reasoning`, so an
 * override-only path would ask for deep thinking without widening the output
 * allowance and the model would spend the whole budget on reasoning with no
 * content left.
 *
 * The `auto` stop returns the config untouched so the provider-level setting
 * — including a `custom` budget the user configured in settings — keeps
 * applying. That is what makes the default stop non-destructive.
 */
export function applyReasoningDepth(config: LlmConfig, depth: ReasoningDepth): LlmConfig {
  // Normalized rather than trusted: a garbled persisted value reaching the
  // wire as `mode: undefined` would silently disable every thinking branch.
  const mode = normalizeReasoningDepth(depth)
  if (mode === "auto") return config
  return { ...config, reasoning: { ...config.reasoning, mode } }
}
