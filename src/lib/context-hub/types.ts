import type { AgentMessage } from "@/lib/agent/types"
import type { DataSourceCategory } from "@/lib/novel/classification"
import type { ContextPack } from "@/lib/novel/context-engine"
import {
  copyLlmRequestCacheTrace,
  isLlmRequestCacheTrace,
  type LlmRequestCacheTrace,
} from "@/lib/llm-request-trace"

export const CONTEXT_CACHE_SCHEMA_VERSION = 2

export type ContextSurface = "ai-chat" | "ai-outline"
export type ContextIntent = "generate" | "question" | "review" | "lint"
export type ContextSourceKind =
  | "chapter"
  | "outline"
  | "memory"
  | "setting"
  | "entity"
  | "snapshot"
  | "deduction"
  | "soul"
  | "book-analysis"
  | "retrieval"
  | "other"
  | "ignored"

export interface DependencyStamp {
  fingerprint: string
  sourceCount: number
  kinds: ContextSourceKind[]
}

export type ContextCacheScope = "static" | "chapter" | "task"

export interface SourceVersion {
  path: string
  kind: ContextSourceKind
  mtimeMs?: number
  size?: number
  hash?: string
  revision: number
}

export interface CachedArtifact<T = unknown> {
  schemaVersion: number
  key: string
  sourceName: string
  scope: ContextCacheScope
  value: T
  dependencyStamp: DependencyStamp
  createdAt: number
}

export interface StableBundle {
  schemaVersion: number
  surface: ContextSurface
  text: string
  dependencyStamp: DependencyStamp
  updatedAt: number
}

export interface ContextCacheArtifactEntry {
  path: string
  sourceName: string
  scope: ContextCacheScope
  dependencyStamp: DependencyStamp
  createdAt: number
  byteSize: number
}

export interface ContextCacheManifest {
  schemaVersion: number
  sources: Record<string, SourceVersion>
  artifacts: Record<string, ContextCacheArtifactEntry>
}

export interface SessionContextSummary {
  text: string
  dependencyFingerprint?: string
  updatedAt: number
}

export type StablePrefixStatus = "unchanged" | "updated" | "persist_failed"

export type ContextFragmentDisposition =
  | "kept"
  | "truncated"
  | "budget_dropped"
  | "policy_excluded"

export interface ContextFragmentTrace {
  title: string
  layer: "stable" | "summary" | "dynamic"
  disposition: ContextFragmentDisposition
  candidateEstimatedTokens: number
  injectedEstimatedTokens: number
}

export interface LlmRequestDiagnostics {
  requestCount: number
  /** False when the provider only exposes aggregate usage without an internal request count. */
  requestCountAvailable?: boolean
  /** Distinguishes a normal workflow aggregate from a provider-managed thread total. */
  usageScope?: "workflow" | "provider_thread"
  providerUsageAvailable: boolean
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  requests?: LlmRequestCacheTrace[]
  omittedRequestCount?: number
}

/** Generation-details stats: source traces + independent stablePrefixStatus; token fields are estimates. */
export interface ContextHubStats {
  cacheHits: number
  reloaded: number
  empty: number
  fallbackUsed: number
  readFailed: number
  writeFailed: number
  stablePrefixStatus?: StablePrefixStatus
  /** Estimated tokens (local heuristic). */
  stableTokens: number
  summaryTokens: number
  dynamicTokens: number
  candidateTokens: number
  estimatedSavedTokens: number
  estimatedSavedPercent: number
  expanded: boolean
  providerCacheEnabled: boolean
  providerUsageReported?: boolean
  providerInputTokens?: number
  providerCachedTokens?: number
  providerCacheWriteTokens?: number
  /** Hub injection budget (estimated domain). */
  budgetTokens?: number
  /** Hub injection total (estimated); not full-window occupancy. */
  composedTokens?: number
  utilizationPercent?: number
  memoryCandidateCount?: number
  memorySelectedCount?: number
  memoryFilteredCount?: number
  memoryInjectedChars?: number
  memoryEstimatedTokens?: number
  fragmentTraces?: ContextFragmentTrace[]
  requestDiagnostics?: LlmRequestDiagnostics
}

export type ContextCacheItemStatus =
  | "cache_hit"
  | "reloaded"
  | "empty"
  | "fallback_used"
  | "read_failed"
  | "write_failed"

export type ContextSourceTraceStatus = ContextCacheItemStatus

export interface ContextCacheItemTrace {
  key: string
  sourceName: string
  status: ContextCacheItemStatus
  dependencyStamp: DependencyStamp
  dependencyPaths: string[]
  dependencyPathsTruncated: boolean
}

export interface ContextHubSnapshotRef {
  id: string
  surface: ContextSurface
  createdAt: number
  stats: ContextHubStats
}

export interface ContextHubSnapshot extends ContextHubSnapshotRef {
  schemaVersion: number
  items: ContextCacheItemTrace[]
  stableCore: string
  sessionSummary: string
  dynamicContext: string
  warnings?: string[]
}

export interface ContextHubRequest {
  projectPath: string
  surface: ContextSurface
  sessionId: string
  task: string
  intent: ContextIntent
  chapterNumber?: number
  categories?: DataSourceCategory[]
  references?: string[]
  messages?: AgentMessage[]
  existingSummary?: SessionContextSummary
  /** Explicit token budget; 0 / undefined = window-derived safe cap. */
  tokenBudget?: number
  /** Model context window in tokens (wiki-store `maxContextSize`). */
  maxContextSize?: number
  forceRefresh?: boolean
}

export interface ContextHubResult {
  surface: ContextSurface
  stableCore: string
  sessionSummary: string
  dynamicContext: string
  contextPack: ContextPack
  dependencyStamp: DependencyStamp
  stats: ContextHubStats
  cacheItems: ContextCacheItemTrace[]
  warnings: string[]
  readFile: (path: string) => Promise<string>
}

export interface ContextHub {
  prepare(request: ContextHubRequest): Promise<ContextHubResult | null>
  readFile(path: string): Promise<string>
  saveSnapshot(id: string, result: ContextHubResult): Promise<ContextHubSnapshotRef>
  readSnapshot(reference: ContextHubSnapshotRef): Promise<ContextHubSnapshot | null>
  pruneSnapshots(surface: ContextSurface, referencedIds: string[]): Promise<void>
  markDirty(path: string): void
  dispose(): void
}

const CURRENT_ITEM_STATUSES = new Set<ContextCacheItemStatus>([
  "cache_hit",
  "reloaded",
  "empty",
  "fallback_used",
  "read_failed",
  "write_failed",
])

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function normalizeRequestDiagnostics(value: unknown): LlmRequestDiagnostics | undefined {
  if (!value || typeof value !== "object") return undefined
  const source = value as Record<string, unknown>
  if (!isFiniteNumber(source.requestCount) || typeof source.providerUsageAvailable !== "boolean") {
    return undefined
  }
  const optionalNumber = (key: string) => source[key] === undefined || isFiniteNumber(source[key])
  if (
    !optionalNumber("inputTokens")
    || !optionalNumber("outputTokens")
    || !optionalNumber("cacheReadTokens")
    || !optionalNumber("cacheWriteTokens")
  ) return undefined
  const requests = Array.isArray(source.requests)
    ? source.requests.filter(isLlmRequestCacheTrace).map(copyLlmRequestCacheTrace)
    : undefined
  const requestCountAvailable = typeof source.requestCountAvailable === "boolean"
    ? source.requestCountAvailable
    : undefined
  const usageScope = source.usageScope === "workflow" || source.usageScope === "provider_thread"
    ? source.usageScope
    : undefined
  return {
    requestCount: Math.max(0, Math.floor(source.requestCount)),
    ...(requestCountAvailable !== undefined ? { requestCountAvailable } : {}),
    ...(usageScope ? { usageScope } : {}),
    providerUsageAvailable: source.providerUsageAvailable,
    ...(isFiniteNumber(source.inputTokens) ? { inputTokens: source.inputTokens } : {}),
    ...(isFiniteNumber(source.outputTokens) ? { outputTokens: source.outputTokens } : {}),
    ...(isFiniteNumber(source.cacheReadTokens) ? { cacheReadTokens: source.cacheReadTokens } : {}),
    ...(isFiniteNumber(source.cacheWriteTokens) ? { cacheWriteTokens: source.cacheWriteTokens } : {}),
    ...(requests ? { requests } : {}),
    ...(isFiniteNumber(source.omittedRequestCount)
      ? { omittedRequestCount: Math.max(0, Math.floor(source.omittedRequestCount)) }
      : {}),
  }
}

function normalizeContextHubStats(source: ContextHubStats): ContextHubStats {
  const { requestDiagnostics: _requestDiagnostics, ...rest } = source
  const requestDiagnostics = normalizeRequestDiagnostics(source.requestDiagnostics)
  return {
    ...rest,
    ...(requestDiagnostics ? { requestDiagnostics } : {}),
  }
}

/** True only for the current stats shape. Legacy hits/refreshed/failures payloads are rejected. */
export function isCurrentContextHubStats(raw: unknown): raw is ContextHubStats {
  if (!raw || typeof raw !== "object") return false
  const source = raw as Record<string, unknown>
  return isFiniteNumber(source.cacheHits)
    && isFiniteNumber(source.reloaded)
    && isFiniteNumber(source.empty)
    && isFiniteNumber(source.fallbackUsed)
    && isFiniteNumber(source.readFailed)
    && isFiniteNumber(source.writeFailed)
    && isFiniteNumber(source.stableTokens)
    && isFiniteNumber(source.summaryTokens)
    && isFiniteNumber(source.dynamicTokens)
    && isFiniteNumber(source.candidateTokens)
    && isFiniteNumber(source.estimatedSavedTokens)
    && isFiniteNumber(source.estimatedSavedPercent)
    && typeof source.expanded === "boolean"
    && typeof source.providerCacheEnabled === "boolean"
}

function isCurrentCacheItemStatus(status: unknown): status is ContextCacheItemStatus {
  return typeof status === "string" && CURRENT_ITEM_STATUSES.has(status as ContextCacheItemStatus)
}

/** Disk/UI parse: reject legacy or corrupt snapshots instead of remapping fields. */
export function parseContextHubSnapshot(raw: unknown): ContextHubSnapshot | null {
  if (!raw || typeof raw !== "object") return null
  const source = raw as Record<string, unknown>
  if (
    source.schemaVersion !== CONTEXT_CACHE_SCHEMA_VERSION
    || typeof source.id !== "string"
    || (source.surface !== "ai-chat" && source.surface !== "ai-outline")
    || typeof source.createdAt !== "number"
    || typeof source.stableCore !== "string"
    || typeof source.sessionSummary !== "string"
    || typeof source.dynamicContext !== "string"
    || !Array.isArray(source.items)
    || !isCurrentContextHubStats(source.stats)
  ) return null
  if (source.warnings !== undefined && !Array.isArray(source.warnings)) return null

  const items: ContextCacheItemTrace[] = []
  for (const item of source.items) {
    if (!item || typeof item !== "object") return null
    const entry = item as Record<string, unknown>
    if (
      typeof entry.key !== "string"
      || typeof entry.sourceName !== "string"
      || !isCurrentCacheItemStatus(entry.status)
      || !entry.dependencyStamp
      || typeof entry.dependencyStamp !== "object"
      || !Array.isArray(entry.dependencyPaths)
    ) return null
    items.push({
      key: entry.key,
      sourceName: entry.sourceName,
      status: entry.status,
      dependencyStamp: entry.dependencyStamp as DependencyStamp,
      dependencyPaths: entry.dependencyPaths.filter((path): path is string => typeof path === "string"),
      dependencyPathsTruncated: Boolean(entry.dependencyPathsTruncated),
    })
  }

  return {
    schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
    id: source.id,
    surface: source.surface,
    createdAt: source.createdAt,
    stats: normalizeContextHubStats(source.stats as ContextHubStats),
    items,
    stableCore: source.stableCore,
    sessionSummary: source.sessionSummary,
    dynamicContext: source.dynamicContext,
    ...(Array.isArray(source.warnings)
      ? { warnings: source.warnings.filter((warning): warning is string => typeof warning === "string") }
      : {}),
  }
}

export function parseContextHubSnapshotRef(raw: unknown): ContextHubSnapshotRef | null {
  if (!raw || typeof raw !== "object") return null
  const source = raw as Record<string, unknown>
  if (
    typeof source.id !== "string"
    || (source.surface !== "ai-chat" && source.surface !== "ai-outline")
    || typeof source.createdAt !== "number"
    || !isCurrentContextHubStats(source.stats)
  ) return null
  return {
    id: source.id,
    surface: source.surface,
    createdAt: source.createdAt,
    stats: normalizeContextHubStats(source.stats as ContextHubStats),
  }
}
