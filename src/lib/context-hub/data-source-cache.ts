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
  hits: number
  refreshed: number
  failures: number
}

const STATIC_SOURCES = new Set([
  "canonRules",
  "writingStyle",
  "soulDoc",
  "characterAuras",
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
  "sectionBriefing",
  "retrieval",
])

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
  return `data-source:${sourceName}:${await sha256Text(JSON.stringify(canonicalize(scope)))}`
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

export class DataSourceCacheAdapter implements DataSourceLoadAdapter {
  private readonly pending = new Map<string, Promise<unknown>>()
  private readonly stats: DataSourceCacheStats = { hits: 0, refreshed: 0, failures: 0 }
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

  private async loadInternal<T>(
    key: string,
    sourceName: string,
    dependencyStamp: DependencyStamp,
    dependencyPaths: string[],
    directLoad: () => Promise<T>,
  ): Promise<T> {
    const trace = (status: ContextCacheItemTrace["status"]): ContextCacheItemTrace => ({
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
          this.stats.hits += 1
          this.traceItems.push(trace("hit"))
          return cached.value
        }
      } catch {
        this.stats.failures += 1
        this.traceItems.push(trace("failed"))
      }
    }

    const value = await directLoad()
    this.stats.refreshed += 1
    this.traceItems.push(trace("refreshed"))
    if (!hasCacheableValue(value)) return value

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
    } catch {
      this.stats.failures += 1
      this.traceItems.push(trace("failed"))
    }
    return value
  }
}
