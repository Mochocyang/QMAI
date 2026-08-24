import {
  deleteFile,
  fileExists,
  readFile as readProjectFile,
  subscribeProjectFileMutations,
  type ProjectFileMutation,
} from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { DataSourceLoadAdapter } from "@/lib/novel/context-data-source"
import { buildContextPack as buildProjectContextPack, type ContextPack } from "@/lib/novel/context-engine"
import type { DataSourceCategory } from "@/lib/novel/classification"
import { composeContext } from "./composer"
import { DataSourceCacheAdapter } from "./data-source-cache"
import { isSessionSummaryFresh } from "./session-summary"
import { normalizeContextPath } from "./source-paths"
import { ContextSourceRegistry, type SourceRefreshResult } from "./source-registry"
import { ContextHubStorage } from "./storage"
import {
  CONTEXT_CACHE_SCHEMA_VERSION,
  type CachedArtifact,
  type ContextCacheItemTrace,
  type ContextHub,
  type ContextHubRequest,
  type ContextHubResult,
  type ContextHubSnapshot,
  type ContextHubSnapshotRef,
  type ContextSourceKind,
  type DependencyStamp,
  type StableBundle,
  type StablePrefixStatus,
} from "./types"

interface HubRegistry {
  refresh(): Promise<SourceRefreshResult>
  getDependencyStamp(kinds?: ContextSourceKind[]): Promise<DependencyStamp>
  getDependencyPreview(kinds?: ContextSourceKind[], limit?: number): string[]
  markDirty(path: string): void
  dispose(): void
}

interface HubStorage {
  initialize?(): Promise<void>
  dispose?(): void
  readArtifact<T>(key: string): Promise<CachedArtifact<T> | null>
  writeArtifact<T>(key: string, artifact: CachedArtifact<T>): Promise<void>
  readStableBundle(surface: ContextHubRequest["surface"]): Promise<StableBundle | null>
  writeStableBundle(surface: ContextHubRequest["surface"], bundle: StableBundle): Promise<void>
  readSnapshot(surface: ContextHubRequest["surface"], id: string): Promise<ContextHubSnapshot | null>
  writeSnapshot(snapshot: ContextHubSnapshot): Promise<void>
  pruneSnapshots(surface: ContextHubRequest["surface"], referencedIds: string[]): Promise<void>
}

type BuildContextPack = (
  projectPath: string,
  task: string,
  chapterNumber?: number,
  options?: { categories?: DataSourceCategory[]; loadAdapter?: DataSourceLoadAdapter },
) => Promise<ContextPack>

const STABLE_SOURCE_KINDS: ContextSourceKind[] = ["soul", "setting", "entity", "outline", "deduction"]

interface ContextHubControllerDependencies {
  registry?: HubRegistry
  storage?: HubStorage
  buildContextPack?: BuildContextPack
  readFile?: (path: string) => Promise<string>
  subscribe?: (listener: (event: ProjectFileMutation) => void) => () => void
}

function confidenceFor(request: ContextHubRequest, pack: ContextPack): number {
  if ((request.references?.length ?? 0) > 0) return 0.95
  if (request.chapterNumber && !pack.chapterGoal.trim() && !pack.outline.trim()) return 0.45
  if (!pack.outline.trim() && !pack.relatedSettings.trim() && !pack.searchResults.trim()) return 0.55
  return 0.85
}

function prepareKey(request: ContextHubRequest): string {
  return JSON.stringify({
    surface: request.surface,
    sessionId: request.sessionId,
    task: request.task,
    intent: request.intent,
    chapterNumber: request.chapterNumber ?? null,
    categories: request.categories ?? [],
    references: request.references ?? [],
    summary: request.existingSummary ?? null,
    tokenBudget: request.tokenBudget ?? null,
    maxContextSize: request.maxContextSize ?? null,
    forceRefresh: request.forceRefresh ?? false,
  })
}

function toProjectRelativePath(projectPath: string, path: string): string {
  const normalizedProject = normalizePath(projectPath).replace(/\/$/, "")
  const normalizedPath = normalizeContextPath(path)
  const prefix = `${normalizedProject}/`
  const windowsPath = /^[A-Za-z]:\//.test(prefix) && /^[A-Za-z]:\//.test(normalizedPath)
  const matchesProject = windowsPath
    ? normalizedPath.toLowerCase().startsWith(prefix.toLowerCase())
    : normalizedPath.startsWith(prefix)
  return matchesProject ? normalizedPath.slice(prefix.length) : normalizedPath
}

function withRelativeDependencyPaths(
  projectPath: string,
  items: ContextCacheItemTrace[],
): ContextCacheItemTrace[] {
  return items.map((item) => ({
    ...item,
    dependencyStamp: { ...item.dependencyStamp, kinds: [...item.dependencyStamp.kinds] },
    dependencyPaths: item.dependencyPaths.map((path) => toProjectRelativePath(projectPath, path)),
  }))
}

function stableItemStatus(status: StablePrefixStatus): ContextCacheItemTrace["status"] {
  if (status === "unchanged") return "cache_hit"
  if (status === "updated") return "reloaded"
  return "write_failed"
}

export class ContextHubController implements ContextHub {
  private readonly projectPath: string
  private readonly registry: HubRegistry
  private readonly storage: HubStorage
  private readonly buildContextPack: BuildContextPack
  private readonly directReadFile: (path: string) => Promise<string>
  private readonly unsubscribe: () => void
  private readonly fileCache = new Map<string, string>()
  private readonly pending = new Map<string, Promise<ContextHubResult | null>>()
  private disposed = false

  constructor(projectPath: string, dependencies: ContextHubControllerDependencies = {}) {
    this.projectPath = normalizePath(projectPath)
    const concreteStorage = dependencies.storage ?? new ContextHubStorage(this.projectPath)
    this.storage = concreteStorage
    this.registry = dependencies.registry ?? new ContextSourceRegistry(this.projectPath, {
      storage: concreteStorage as ContextHubStorage,
    })
    this.buildContextPack = dependencies.buildContextPack ?? buildProjectContextPack
    this.directReadFile = dependencies.readFile ?? readProjectFile
    const subscribe = dependencies.subscribe ?? subscribeProjectFileMutations
    this.unsubscribe = subscribe((event) => this.markDirty(event.path))
  }

  prepare(request: ContextHubRequest): Promise<ContextHubResult | null> {
    if (this.disposed) return Promise.resolve(null)
    if (request.intent === "review" || request.intent === "lint") return Promise.resolve(null)
    const key = prepareKey(request)
    const pending = this.pending.get(key)
    if (pending) return pending
    const operation = this.prepareWithFallback(request).finally(() => this.pending.delete(key))
    this.pending.set(key, operation)
    return operation
  }

  initialize(): Promise<void> {
    return this.storage.initialize?.() ?? Promise.resolve()
  }

  async readFile(path: string): Promise<string> {
    if (this.disposed) throw new Error("Context Hub 已释放")
    const normalized = normalizeContextPath(path)
    const cached = this.fileCache.get(normalized)
    if (cached !== undefined) return cached
    const content = await this.directReadFile(normalized)
    this.fileCache.set(normalized, content)
    return content
  }

  async saveSnapshot(id: string, result: ContextHubResult): Promise<ContextHubSnapshotRef> {
    const createdAt = Date.now()
    const snapshot: ContextHubSnapshot = {
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      id,
      surface: result.surface,
      createdAt,
      stats: { ...result.stats },
      items: result.cacheItems.map((item) => ({
        ...item,
        dependencyStamp: { ...item.dependencyStamp, kinds: [...item.dependencyStamp.kinds] },
        dependencyPaths: [...item.dependencyPaths],
      })),
      stableCore: result.stableCore,
      sessionSummary: result.sessionSummary,
      dynamicContext: result.dynamicContext,
      warnings: [...result.warnings],
    }
    try {
      await this.storage.writeSnapshot(snapshot)
    } catch {
      // The summary remains useful even when the optional full snapshot cannot be persisted.
    }
    return {
      id,
      surface: snapshot.surface,
      createdAt,
      stats: { ...snapshot.stats },
    }
  }

  async readSnapshot(reference: ContextHubSnapshotRef): Promise<ContextHubSnapshot | null> {
    const snapshot = await this.storage.readSnapshot(reference.surface, reference.id)
    return snapshot?.createdAt === reference.createdAt ? snapshot : null
  }

  pruneSnapshots(surface: ContextHubRequest["surface"], referencedIds: string[]): Promise<void> {
    return this.storage.pruneSnapshots(surface, referencedIds)
  }

  markDirty(path: string): void {
    if (this.disposed) return
    const normalized = normalizeContextPath(path)
    this.fileCache.delete(normalized)
    this.registry.markDirty(normalized)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.registry.dispose()
    this.storage.dispose?.()
    this.fileCache.clear()
    this.pending.clear()
  }

  private async prepareWithFallback(request: ContextHubRequest): Promise<ContextHubResult | null> {
    try {
      return await this.prepareCached(request)
    } catch {
      return null
    }
  }

  private async prepareCached(request: ContextHubRequest): Promise<ContextHubResult> {
    const refresh = await this.registry.refresh()
    for (const path of refresh.changedPaths) this.fileCache.delete(normalizeContextPath(path))
    const dependencyStamp = await this.registry.getDependencyStamp()
    const stableDependencyStamp = await this.registry.getDependencyStamp(STABLE_SOURCE_KINDS)
    const stableDependencyPaths = this.registry.getDependencyPreview(STABLE_SOURCE_KINDS, 20)
    const warnings: string[] = []
    const cacheAdapter = new DataSourceCacheAdapter({
      registry: this.registry,
      storage: this.storage,
      forceRefresh: request.forceRefresh,
    })
    const contextPack = await this.buildContextPack(
      this.projectPath,
      request.task,
      request.chapterNumber,
      {
        ...(request.categories?.length ? { categories: request.categories } : {}),
        loadAdapter: cacheAdapter,
      },
    )
    const summaryFresh = !request.forceRefresh
      && isSessionSummaryFresh(request.existingSummary, dependencyStamp.fingerprint)
    if (request.existingSummary && !summaryFresh) {
      warnings.push("项目资料已更新，本轮未使用旧会话摘要。")
    }
    const composed = composeContext({
      contextPack,
      sessionSummary: summaryFresh ? request.existingSummary?.text : undefined,
      dependencyStamp,
      referenceContext: request.references,
      confidence: confidenceFor(request, contextPack),
      tokenBudget: request.tokenBudget,
      maxContextSize: request.maxContextSize,
    })
    const cacheStats = cacheAdapter.getStats()
    const cacheItems = cacheAdapter.getTraceItems()
    let stablePrefixStatus: StablePrefixStatus = "updated"
    try {
      const existing = await this.storage.readStableBundle(request.surface)
      if (
        existing
        && existing.dependencyStamp.fingerprint === stableDependencyStamp.fingerprint
        && existing.text === composed.stableCore
      ) {
        stablePrefixStatus = "unchanged"
      } else {
        await this.storage.writeStableBundle(request.surface, {
          schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
          surface: request.surface,
          text: composed.stableCore,
          dependencyStamp: stableDependencyStamp,
          updatedAt: Date.now(),
        })
        stablePrefixStatus = "updated"
      }
    } catch {
      stablePrefixStatus = "persist_failed"
      warnings.push("稳定上下文缓存写入失败，本轮已继续使用内存中的最新内容。")
    }

    cacheItems.push({
      key: `stable-core:${request.surface}`,
      sourceName: "stableCore",
      status: stableItemStatus(stablePrefixStatus),
      dependencyStamp: stableDependencyStamp,
      dependencyPaths: stableDependencyPaths,
      dependencyPathsTruncated: stableDependencyStamp.sourceCount > stableDependencyPaths.length,
    })

    return {
      ...composed,
      surface: request.surface,
      contextPack,
      stats: {
        ...composed.stats,
        cacheHits: cacheStats.cacheHits,
        reloaded: cacheStats.reloaded,
        empty: cacheStats.empty,
        fallbackUsed: cacheStats.fallbackUsed,
        readFailed: cacheStats.readFailed,
        writeFailed: cacheStats.writeFailed,
        stablePrefixStatus,
      },
      cacheItems: withRelativeDependencyPaths(this.projectPath, cacheItems),
      warnings,
      readFile: (path) => this.readFile(path),
    }
  }
}

const projectHubs = new Map<string, ContextHubController>()

export function getContextHub(projectPath: string): ContextHubController {
  const normalized = normalizePath(projectPath)
  const existing = projectHubs.get(normalized)
  if (existing) return existing
  const hub = new ContextHubController(normalized)
  projectHubs.set(normalized, hub)
  return hub
}

export function disposeAllContextHubs(): void {
  for (const hub of projectHubs.values()) hub.dispose()
  projectHubs.clear()
}

export async function initializeProjectContextCache(projectPath: string): Promise<void> {
  const normalized = normalizePath(projectPath)
  try {
    await getContextHub(normalized).initialize()
  } catch (error) {
    console.warn("[Context Hub] v2 缓存初始化失败，将在首次使用时重试：", error)
  }

  const legacyPath = `${normalized}/.qmai/context-cache/v1`
  void fileExists(legacyPath)
    .then((exists) => exists ? deleteFile(legacyPath) : undefined)
    .catch((error) => {
      console.warn("[Context Hub] 旧版缓存后台清理失败，下次打开项目时将重试：", error)
    })
}
