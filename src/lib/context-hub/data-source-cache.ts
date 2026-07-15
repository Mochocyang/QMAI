import type {
  ContextLoadContext,
  DataSource,
  DataSourceLoadAdapter,
} from "@/lib/novel/context-data-source"
import { getDataSourceKinds } from "./source-paths"
import {
  CONTEXT_CACHE_SCHEMA_VERSION,
  type CachedArtifact,
  type ContextCacheItemTrace,
  type ContextSourceKind,
} from "./types"

interface DataSourceCacheRegistry {
  refresh(): Promise<unknown>
  getDependencies(kinds?: ContextSourceKind[]): Record<string, number>
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

function hashText(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function sourceRequestKey(sourceName: string, context: ContextLoadContext): string {
  const scope = STATIC_SOURCES.has(sourceName)
    ? {}
    : CHAPTER_SCOPED_SOURCES.has(sourceName)
      ? { chapterNumber: context.chapterNumber ?? null, config: context.config }
      : { task: context.task, chapterNumber: context.chapterNumber ?? null, config: context.config }
  return `data-source:${sourceName}:${hashText(JSON.stringify(canonicalize(scope)))}`
}

function dependenciesMatch(
  cached: Record<string, number>,
  current: Record<string, number>,
): boolean {
  const cachedEntries = Object.entries(cached)
  const currentEntries = Object.entries(current)
  return cachedEntries.length === currentEntries.length
    && cachedEntries.every(([path, revision]) => current[path] === revision)
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
    const dependencies = this.options.registry.getDependencies(getDataSourceKinds(source.name))
    const key = sourceRequestKey(source.name, context)
    const pending = this.pending.get(key)
    if (pending) return pending as Promise<T>

    const operation = this.loadInternal(key, source.name, dependencies, directLoad)
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
      dependencyPaths: [...item.dependencyPaths],
    }))
  }

  private async loadInternal<T>(
    key: string,
    sourceName: string,
    dependencies: Record<string, number>,
    directLoad: () => Promise<T>,
  ): Promise<T> {
    const dependencyPaths = Object.keys(dependencies)
    if (!this.options.forceRefresh) {
      try {
        const cached = await this.options.storage.readArtifact<T>(key)
        if (cached && dependenciesMatch(cached.dependencies, dependencies)) {
          this.stats.hits += 1
          this.traceItems.push({ key, sourceName, status: "hit", dependencyPaths })
          return cached.value
        }
      } catch {
        this.stats.failures += 1
        this.traceItems.push({ key, sourceName, status: "failed", dependencyPaths })
      }
    }

    const value = await directLoad()
    this.stats.refreshed += 1
    this.traceItems.push({ key, sourceName, status: "refreshed", dependencyPaths })
    if (!hasCacheableValue(value)) return value

    try {
      await this.options.storage.writeArtifact(key, {
        schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
        key,
        value,
        dependencies,
        createdAt: Date.now(),
      })
    } catch {
      this.stats.failures += 1
      this.traceItems.push({ key, sourceName, status: "failed", dependencyPaths })
    }
    return value
  }
}
