import { estimateContextTokens } from "@/lib/context-hub/token-estimator"
import type { LlmUsage } from "@/lib/llm-usage"

export type ContextUsageKey =
  | "softwareRules"
  | "toolDefinitions"
  | "stableCore"
  | "sessionSummary"
  | "dynamicContext"
  | "history"
  | "toolResults"
  | "currentInput"

export interface ContextUsageSegment {
  key: ContextUsageKey
  tokens: number
}

export interface ContextUsageSnapshot {
  windowTokens: number
  totalTokens: number
  segments: ContextUsageSegment[]
  measuredAt: number
  /** true = 无 provider usage，纯本地估算 */
  estimated: boolean
}

export interface BuildContextUsageSnapshotInput {
  windowTokens: number
  softwareRules?: string
  toolDefinitionsJson?: string
  stableTokens?: number
  summaryTokens?: number
  dynamicTokens?: number
  historyTexts?: string[]
  currentInput?: string
  usage?: LlmUsage
  measuredAt?: number
}

export const CONTEXT_USAGE_SEGMENT_ORDER: ContextUsageKey[] = [
  "softwareRules",
  "toolDefinitions",
  "stableCore",
  "sessionSummary",
  "dynamicContext",
  "history",
  "toolResults",
  "currentInput",
]

export const CONTEXT_USAGE_WARN_RATIO = 0.75
export const CONTEXT_USAGE_FULL_RATIO = 0.9

function nonNegativeInt(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

function estimateText(value: string | undefined): number {
  return value?.trim() ? estimateContextTokens(value) : 0
}

export function buildContextUsageSnapshot(
  input: BuildContextUsageSnapshotInput,
): ContextUsageSnapshot {
  const windowTokens = Math.max(1, nonNegativeInt(input.windowTokens) || 1)
  const localSegments: ContextUsageSegment[] = [
    { key: "softwareRules", tokens: estimateText(input.softwareRules) },
    { key: "toolDefinitions", tokens: estimateText(input.toolDefinitionsJson) },
    { key: "stableCore", tokens: nonNegativeInt(input.stableTokens) },
    { key: "sessionSummary", tokens: nonNegativeInt(input.summaryTokens) },
    { key: "dynamicContext", tokens: nonNegativeInt(input.dynamicTokens) },
    {
      key: "history",
      tokens: (input.historyTexts ?? []).reduce((sum, text) => sum + estimateText(text), 0),
    },
    { key: "toolResults", tokens: 0 },
    { key: "currentInput", tokens: estimateText(input.currentInput) },
  ]
  const localTotal = localSegments.reduce((sum, segment) => sum + segment.tokens, 0)
  const providerPromptTokens = nonNegativeInt(input.usage?.inputTokens)
  const estimated = providerPromptTokens <= 0
  const totalTokens = estimated ? localTotal : providerPromptTokens

  let segments = localSegments
  if (!estimated && localTotal > 0 && totalTokens !== localTotal) {
    const scale = totalTokens / localTotal
    let assigned = 0
    segments = localSegments.map((segment, index) => {
      if (index === localSegments.length - 1) {
        return { ...segment, tokens: Math.max(0, totalTokens - assigned) }
      }
      const scaled = Math.max(0, Math.round(segment.tokens * scale))
      assigned += scaled
      return { ...segment, tokens: scaled }
    })
  } else if (!estimated && localTotal === 0 && totalTokens > 0) {
    segments = localSegments.map((segment) =>
      segment.key === "history"
        ? { ...segment, tokens: totalTokens }
        : { ...segment, tokens: 0 },
    )
  }

  return {
    windowTokens,
    totalTokens,
    segments,
    measuredAt: typeof input.measuredAt === "number" && Number.isFinite(input.measuredAt)
      ? input.measuredAt
      : Date.now(),
    estimated,
  }
}

export function calibrateContextUsageSnapshot(
  snapshot: ContextUsageSnapshot,
  usage?: LlmUsage,
): ContextUsageSnapshot {
  const providerPromptTokens = nonNegativeInt(usage?.inputTokens)
  if (providerPromptTokens <= 0) {
    return {
      ...snapshot,
      segments: snapshot.segments.map((segment) => ({ ...segment })),
      estimated: true,
      measuredAt: Date.now(),
    }
  }
  const localTotal = snapshot.segments.reduce((sum, segment) => sum + segment.tokens, 0)
  if (localTotal <= 0) {
    return {
      windowTokens: snapshot.windowTokens,
      totalTokens: providerPromptTokens,
      segments: CONTEXT_USAGE_SEGMENT_ORDER.map((key) => ({
        key,
        tokens: key === "history" ? providerPromptTokens : 0,
      })),
      measuredAt: Date.now(),
      estimated: false,
    }
  }
  const scale = providerPromptTokens / localTotal
  let assigned = 0
  const segments = snapshot.segments.map((segment, index) => {
    if (index === snapshot.segments.length - 1) {
      return { ...segment, tokens: Math.max(0, providerPromptTokens - assigned) }
    }
    const scaled = Math.max(0, Math.round(segment.tokens * scale))
    assigned += scaled
    return { ...segment, tokens: scaled }
  })
  return {
    windowTokens: snapshot.windowTokens,
    totalTokens: providerPromptTokens,
    segments,
    measuredAt: Date.now(),
    estimated: false,
  }
}

/**
 * Overlay live draft / pending tool reads on top of the last measured request.
 *
 * - Calibrated snapshots keep provider `totalTokens` as the base and only add
 *   input-draft deltas plus tool results that finished after `measuredAt`.
 * - Estimated snapshots recompute mutable layers locally.
 */
export function composeLiveContextUsage(
  lastUsage: ContextUsageSnapshot | null | undefined,
  live: {
    windowTokens?: number
    sessionSummaryText?: string
    historyTexts?: string[]
    currentInput?: string
    pendingToolResultTexts?: string[]
  },
): ContextUsageSnapshot | null {
  const historyTokens = (live.historyTexts ?? []).reduce(
    (sum, text) => sum + estimateText(text),
    0,
  )
  const currentInputTokens = estimateText(live.currentInput)
  const pendingToolTokens = (live.pendingToolResultTexts ?? []).reduce(
    (sum, text) => sum + estimateText(text),
    0,
  )
  const summaryTokens = live.sessionSummaryText !== undefined
    ? estimateText(live.sessionSummaryText)
    : nonNegativeInt(lastUsage?.segments.find((segment) => segment.key === "sessionSummary")?.tokens)
  const windowTokens = Math.max(
    1,
    nonNegativeInt(live.windowTokens) || nonNegativeInt(lastUsage?.windowTokens) || 1,
  )
  const lastByKey = new Map(
    (lastUsage?.segments ?? []).map((segment) => [segment.key, nonNegativeInt(segment.tokens)]),
  )
  const lastInputTokens = lastByKey.get("currentInput") ?? 0
  const calibrated = Boolean(lastUsage && !lastUsage.estimated)

  const segments: ContextUsageSegment[] = CONTEXT_USAGE_SEGMENT_ORDER.map((key) => {
    if (key === "currentInput") return { key, tokens: currentInputTokens }
    if (key === "toolResults") return { key, tokens: pendingToolTokens }
    if (!calibrated && key === "history") return { key, tokens: historyTokens }
    if (!calibrated && key === "sessionSummary") return { key, tokens: summaryTokens }
    return { key, tokens: lastByKey.get(key) ?? 0 }
  })

  let totalTokens = segments.reduce((sum, segment) => sum + segment.tokens, 0)
  if (calibrated && lastUsage) {
    totalTokens = Math.max(
      0,
      lastUsage.totalTokens + (currentInputTokens - lastInputTokens) + pendingToolTokens,
    )
  }
  if (!lastUsage && totalTokens <= 0) return null
  return {
    windowTokens,
    totalTokens,
    segments,
    measuredAt: lastUsage?.measuredAt ?? Date.now(),
    estimated: !calibrated || pendingToolTokens > 0 || currentInputTokens !== lastInputTokens,
  }
}

export function contextUsageRatio(snapshot: ContextUsageSnapshot): number {
  if (snapshot.windowTokens <= 0) return 0
  return Math.min(1, snapshot.totalTokens / snapshot.windowTokens)
}

export function formatContextTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return "0"
  if (tokens < 1000) return String(Math.round(tokens))
  const thousands = tokens / 1000
  if (thousands < 100) {
    const rounded = Math.round(thousands * 10) / 10
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}K`
  }
  return `${Math.round(thousands)}K`
}

export function isContextUsageSnapshot(value: unknown): value is ContextUsageSnapshot {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ContextUsageSnapshot>
  if (
    typeof candidate.windowTokens !== "number"
    || typeof candidate.totalTokens !== "number"
    || typeof candidate.measuredAt !== "number"
    || typeof candidate.estimated !== "boolean"
    || !Array.isArray(candidate.segments)
  ) {
    return false
  }
  return candidate.segments.every((segment) => (
    segment
    && typeof segment === "object"
    && typeof (segment as ContextUsageSegment).key === "string"
    && typeof (segment as ContextUsageSegment).tokens === "number"
  ))
}

export function normalizeContextUsageSnapshot(value: unknown): ContextUsageSnapshot | undefined {
  if (!isContextUsageSnapshot(value)) return undefined
  return {
    windowTokens: Math.max(1, Math.floor(value.windowTokens)),
    totalTokens: Math.max(0, Math.floor(value.totalTokens)),
    segments: value.segments.map((segment) => ({
      key: segment.key,
      tokens: Math.max(0, Math.floor(segment.tokens)),
    })),
    measuredAt: value.measuredAt,
    estimated: value.estimated,
  }
}
