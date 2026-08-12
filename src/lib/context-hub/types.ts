import type { AgentMessage } from "@/lib/agent/types"
import type { DataSourceCategory } from "@/lib/novel/classification"
import type { ContextPack } from "@/lib/novel/context-engine"

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

export interface ContextHubStats {
  hits: number
  refreshed: number
  failures: number
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
  budgetTokens?: number
  composedTokens?: number
  utilizationPercent?: number
  memoryCandidateCount?: number
  memorySelectedCount?: number
  memoryFilteredCount?: number
  memoryInjectedChars?: number
  memoryEstimatedTokens?: number
}

export type ContextCacheItemStatus = "hit" | "refreshed" | "failed"

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
