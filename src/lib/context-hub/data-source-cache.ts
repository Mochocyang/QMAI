import type {
  ContextLoadContext,
  DataSource,
  DataSourceLoadAdapter,
} from "@/lib/novel/context-data-source"
import { getDataSourceKinds, getSourceDependencyPrefixes } from "./source-paths"
import { sha256Text } from "./fingerprint"
import { estimateContextTokens } from "./token-estimator"
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
  getDependencyStampForPrefixes(prefixes: string[]): Promise<DependencyStamp>
  getDependencyPreview(kinds?: ContextSourceKind[], limit?: number): string[]
}

interface DataSourceCacheStorage {
  readArtifact<T>(key: string): Promise<CachedArtifact<T> | null>
  writeArtifact<T>(key: string, artifact: CachedArtifact<T>): Promise<void>
}

interface DataSourceCacheAdapterOptions {
  registry: DataSourceCacheRegistry
  storage: DataSourceCacheStorage
  forceRefresh?: boolean
}

interface DataSourceCacheStats {
  cacheHits: number
  reloaded: number
  empty: number
  fallbackUsed: number
  readFailed: number
  writeFailed: number
  /** 缓存命中项内容的估算 token 之和（用户可见的「节省 token」）。 */
  cacheHitTokens: number
  /** 本轮加载的任务级（查询依赖）数据源数量；这类源无法跨消息复用，不计入可缓存命中率。 */
  taskScopedLoaded: number
}

const STATIC_SOURCES = new Set([
  "canonRules",
  "writingStyle",
  "soulDoc",
  "storyFrameworkBinding",
  "relatedSettings",
  // 以下源加载的是项目级数据（不依赖章节号），改用恒定 key 跨章节/跨消息复用
  "fallbackRecentSummaries",
  "fallbackCharacterStates",
  "fallbackForeshadowingStates",
  "fallbackTimeline",
  "cognitionText",
  // retrieval 现在返回项目级原始条目（按章节过滤移到构建阶段），同样跨章节复用
  "retrieval",
])

/**
 * 任务级数据源：加载结果依赖用户查询文本（搜索/检索/相关引用/章节简报），
 * 缓存 key 必须包含任务文本，无法安全跨消息复用；命中率统计时不计入可缓存部分。
 */
const TASK_SCOPED_SOURCES = new Set([
  "searchResults",
  "graphSearchResults",
  "bookAnalysisReferences",
  "sectionBriefing",
])

const CHAPTER_SCOPED_SOURCES = new Set([
  "outline",
  "chapterOutline",
  "volumeContext",
  "snapshots",
  "recentChapterContents",
  "fallbackPreviousEnding",
  "revisionFeedback",
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

function hasCacheableValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === "object") return Object.keys(value).length > 0
  return value !== null && value !== undefined
}

/** 估算一个缓存命中数据源内容的 token 数（用于「节省 token」显示）。 */
function valueToTokens(value: unknown): number {
  if (typeof value === "string") return estimateContextTokens(value)
  if (Array.isArray(value)) {
    const strings = value.filter((item) => typeof item === "string")
    return strings.length > 0 ? estimateContextTokens(strings.join("\n")) : 0
  }
  if (value && typeof value === "object") return estimateContextTokens(JSON.stringify(value))
  return estimateContextTokens(String(value ?? ""))
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
    cacheHitTokens: 0,
    taskScopedLoaded: 0,
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
    const prefixes = getSourceDependencyPrefixes(source.name)
    const dependencyStamp = prefixes.length > 0
      ? await this.options.registry.getDependencyStampForPrefixes(prefixes)
      : await this.options.registry.getDependencyStamp(kinds)
    const dependencyPaths = this.options.registry.getDependencyPreview(kinds, 20)
    const key = await sourceRequestKey(source.name, context)
    if (TASK_SCOPED_SOURCES.has(source.name)) this.stats.taskScopedLoaded += 1
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
          this.stats.cacheHitTokens += valueToTokens(cached.value)
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
