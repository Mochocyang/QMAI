import type {
  ContextLoadContext,
  DataSource,
  DataSourceLoadAdapter,
} from "@/lib/novel/context-data-source"
import { getDataSourceKinds } from "./source-paths"
import { sha256Text } from "./fingerprint"
import {
  CONTEXT_CACHE_SCHEMA_VERSION,
  type CachedArtifact,
  type ContextCacheScope,
  type ContextCacheItemTrace,
  type ContextSourceKind,
  type ContextSourceTraceStatus,
  type DependencyStamp,
} from "./types"

interface DataSourceCacheRegistry {
  refresh(): Promise<unknown>
  getDependencyStamp(kinds?: ContextSourceKind[]): Promise<DependencyStamp>
  getDependencyPreview(kinds?: ContextSourceKind[], limit?: number): string[]
}

interface DataSourceCacheStorage {
  readArtifact<T>(key: string): Promise<CachedArtifact<T> | null>
  writeArtifact<T>(key: string, artifact: CachedArtifact<T>): Promise<void>
}

export interface DataSourceCacheAdapterOptions {
  registry: DataSourceCacheRegistry
  storage: DataSourceCacheStorage
  forceRefresh?: boolean
}

export interface DataSourceCacheStats {
  cacheHits: number
  reloaded: number
  empty: number
  fallbackUsed: number
  readFailed: number
  writeFailed: number
}

const STATIC_SOURCES = new Set([
  "canonRules",
  "writingStyle",
  "soulDoc",
  "storyFrameworkBinding",
  "relatedSettings",
])

const CHAPTER_SCOPED_SOURCES = new Set([
  "outline",
  "chapterOutline",
  "volumeContext",
  "snapshots",
  "recentChapterContents",
  "fallbackRecentSummaries",
  "fallbackPreviousEnding",
  "fallbackCharacterStates",
  "fallbackForeshadowingStates",
  "fallbackTimeline",
  "revisionFeedback",
  "cognitionText",
  "retrieval",
])

// Bump only the affected data source when its extraction semantics change.
// This prevents a previously cached wrong-chapter outline from surviving the fix.
const SOURCE_CACHE_VERSIONS: Partial<Record<string, number>> = {
  outline: 2,
  chapterOutline: 3,
  volumeContext: 2,
  sectionBriefing: 2,
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

async function sourceRequestKey(sourceName: string, context: ContextLoadContext): Promise<string> {
  const scope = STATIC_SOURCES.has(sourceName)
    ? {}
    : CHAPTER_SCOPED_SOURCES.has(sourceName)
      ? { chapterNumber: context.chapterNumber ?? null, config: context.config }
      : { task: context.task, chapterNumber: context.chapterNumber ?? null, config: context.config }
  const version = SOURCE_CACHE_VERSIONS[sourceName]
  const versionSuffix = version ? `:v${version}` : ""
  return `data-source:${sourceName}${versionSuffix}:${await sha256Text(JSON.stringify(canonicalize(scope)))}`
}

function dependencyStampsMatch(cached: DependencyStamp, current: DependencyStamp): boolean {
  return cached.fingerprint === current.fingerprint
}

function cacheScopeFor(sourceName: string): ContextCacheScope {
  if (STATIC_SOURCES.has(sourceName)) return "static"
  if (CHAPTER_SCOPED_SOURCES.has(sourceName)) return "chapter"
  return "task"
}

export function hasCacheableValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === "object") return Object.keys(value).length > 0
  return value !== null && value !== undefined
}

export class DataSourceCacheAdapter implements DataSourceLoadAdapter {
  private readonly pending = new Map<string, Promise<unknown>>()
  private readonly stats: DataSourceCacheStats = {
    cacheHits: 0,
    reloaded: 0,
    empty: 0,
    fallbackUsed: 0,
    readFailed: 0,
    writeFailed: 0,
  }
  private readonly traceItems: ContextCacheItemTrace[] = []

  constructor(private readonly options: DataSourceCacheAdapterOptions) {}

  async load<T>(
    source: DataSource<T>,
    context: ContextLoadContext,
    directLoad: () => Promise<T>,
  ): Promise<T> {
    await this.options.registry.refresh()
    const kinds = getDataSourceKinds(source.name)
    const dependencyStamp = await this.options.registry.getDependencyStamp(kinds)
    const dependencyPaths = this.options.registry.getDependencyPreview(kinds, 20)
    const key = await sourceRequestKey(source.name, context)
    const pending = this.pending.get(key)
    if (pending) return pending as Promise<T>

    const operation = this.loadInternal(
      key,
      source.name,
      dependencyStamp,
      dependencyPaths,
      directLoad,
    )
      .finally(() => this.pending.delete(key))
    this.pending.set(key, operation)
    return operation
  }

  /**
   * Registry calls this when source.load throws. If fallback later succeeds,
   * recordFallbackUsed replaces the primary list status with fallback_used while
   * keeping both counters.
   */
  recordReadFailed(sourceName: string, dependencyStamp?: DependencyStamp): void {
    this.upsertSyntheticTrace(sourceName, "read_failed", dependencyStamp)
    this.stats.readFailed += 1
  }

  recordFallbackUsed(sourceName: string, dependencyStamp?: DependencyStamp): void {
    this.upsertSyntheticTrace(sourceName, "fallback_used", dependencyStamp)
    this.stats.fallbackUsed += 1
  }

  getStats(): DataSourceCacheStats {
    return { ...this.stats }
  }

  getTraceItems(): ContextCacheItemTrace[] {
    return this.traceItems.map((item) => ({
      ...item,
      dependencyStamp: { ...item.dependencyStamp, kinds: [...item.dependencyStamp.kinds] },
      dependencyPaths: [...item.dependencyPaths],
    }))
  }

  private upsertTrace(item: ContextCacheItemTrace): void {
    const existingIndex = this.traceItems.findIndex((entry) => entry.key === item.key)
    if (existingIndex >= 0) {
      this.traceItems[existingIndex] = item
      return
    }
    this.traceItems.push(item)
  }

  private upsertSyntheticTrace(
    sourceName: string,
    status: ContextSourceTraceStatus,
    dependencyStamp?: DependencyStamp,
  ): void {
    const kinds = getDataSourceKinds(sourceName)
    const stamp = dependencyStamp ?? { fingerprint: "", sourceCount: 0, kinds }
    const paths = this.options.registry.getDependencyPreview(kinds, 20)
    this.upsertTrace({
      key: `data-source:${sourceName}:outcome`,
      sourceName,
      status,
      dependencyStamp: stamp,
      dependencyPaths: paths,
      dependencyPathsTruncated: stamp.sourceCount > paths.length,
    })
  }

  private async loadInternal<T>(
    key: string,
    sourceName: string,
    dependencyStamp: DependencyStamp,
    dependencyPaths: string[],
    directLoad: () => Promise<T>,
  ): Promise<T> {
    const makeTrace = (status: ContextSourceTraceStatus): ContextCacheItemTrace => ({
      key,
      sourceName,
      status,
      dependencyStamp,
      dependencyPaths,
      dependencyPathsTruncated: dependencyStamp.sourceCount > dependencyPaths.length,
    })

    if (!this.options.forceRefresh) {
      try {
        const cached = await this.options.storage.readArtifact<T>(key)
        if (cached && dependencyStampsMatch(cached.dependencyStamp, dependencyStamp)) {
          this.stats.cacheHits += 1
          this.upsertTrace(makeTrace("cache_hit"))
          return cached.value
        }
      } catch {
        // Corrupted/missing cache artifact: rebuild from source without counting as source failure.
      }
    }

    const value = await directLoad()
    if (!hasCacheableValue(value)) {
      this.stats.empty += 1
      this.upsertTrace(makeTrace("empty"))
      return value
    }

    this.stats.reloaded += 1

    try {
      await this.options.storage.writeArtifact(key, {
        schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
        key,
        sourceName,
        scope: cacheScopeFor(sourceName),
        value,
        dependencyStamp,
        createdAt: Date.now(),
      })
      this.upsertTrace(makeTrace("reloaded"))
    } catch {
      this.stats.writeFailed += 1
      // One primary list item: write_failed (reload still counted in reloaded).
      this.upsertTrace(makeTrace("write_failed"))
    }
    return value
  }
}
