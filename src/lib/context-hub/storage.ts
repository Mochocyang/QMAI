import {
  createDirectory,
  deleteFile,
  fileExists,
  getFileSize,
  listDirectory,
  readFile,
  writeFileAtomic,
} from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { sha256Text } from "./fingerprint"
import {
  CONTEXT_CACHE_SCHEMA_VERSION,
  type CachedArtifact,
  type ContextCacheArtifactEntry,
  type ContextCacheManifest,
  type ContextHubSnapshot,
  type ContextSurface,
  type StableBundle,
} from "./types"

export interface ContextHubStorageIo {
  readFile(path: string): Promise<string>
  writeFileAtomic(path: string, contents: string): Promise<void>
  createDirectory(path: string): Promise<void>
  listDirectory(path: string): Promise<Array<{ name: string; path: string; is_dir: boolean; mtimeMs?: number }>>
  deleteFile(path: string): Promise<void>
  fileExists(path: string): Promise<boolean>
  getFileSize(path: string): Promise<number>
}

const defaultIo: ContextHubStorageIo = {
  readFile,
  writeFileAtomic,
  createDirectory,
  listDirectory: (path) => listDirectory(path, { includeHidden: true, maxDepth: 1 }),
  deleteFile,
  fileExists,
  getFileSize,
}

const SNAPSHOT_CLEANUP_GRACE_MS = 60_000
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_ARTIFACT_BYTES = 128 * 1024 * 1024
const MAX_ARTIFACT_COUNT = 2048
const MAX_TASK_ARTIFACTS_PER_SOURCE = 128

function emptyManifest(): ContextCacheManifest {
  return { schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION, sources: {}, artifacts: {} }
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

async function hashedFileName(key: string): Promise<string> {
  return `${await sha256Text(key)}.json`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isDependencyStamp(value: unknown): boolean {
  if (!isRecord(value)) return false
  return typeof value.fingerprint === "string"
    && value.fingerprint.length > 0
    && Number.isInteger(value.sourceCount)
    && (value.sourceCount as number) >= 0
    && Array.isArray(value.kinds)
    && value.kinds.every((kind) => typeof kind === "string")
}

function cloneManifest(manifest: ContextCacheManifest): ContextCacheManifest {
  return {
    schemaVersion: manifest.schemaVersion,
    sources: { ...manifest.sources },
    artifacts: { ...manifest.artifacts },
  }
}

function artifactSort(left: ContextCacheArtifactEntry, right: ContextCacheArtifactEntry): number {
  if (left.scope === "static" && right.scope !== "static") return 1
  if (right.scope === "static" && left.scope !== "static") return -1
  return left.createdAt - right.createdAt
}

function pruneArtifactEntries(
  entries: Record<string, ContextCacheArtifactEntry>,
): { artifacts: Record<string, ContextCacheArtifactEntry>; removed: ContextCacheArtifactEntry[] } {
  const artifacts = { ...entries }
  const removed: ContextCacheArtifactEntry[] = []
  const removeKey = (key: string) => {
    const entry = artifacts[key]
    if (!entry) return
    removed.push(entry)
    delete artifacts[key]
  }

  const taskGroups = new Map<string, Array<[string, ContextCacheArtifactEntry]>>()
  for (const pair of Object.entries(artifacts)) {
    const [key, entry] = pair
    if (entry.scope !== "task") continue
    const group = taskGroups.get(entry.sourceName) ?? []
    group.push([key, entry])
    taskGroups.set(entry.sourceName, group)
  }
  for (const group of taskGroups.values()) {
    group.sort((left, right) => left[1].createdAt - right[1].createdAt)
    for (const [key] of group.slice(0, Math.max(0, group.length - MAX_TASK_ARTIFACTS_PER_SOURCE))) {
      removeKey(key)
    }
  }

  const remaining = () => Object.entries(artifacts)
  let totalBytes = remaining().reduce((sum, [, entry]) => sum + entry.byteSize, 0)
  const candidates = remaining().sort((left, right) => artifactSort(left[1], right[1]))
  while (
    candidates.length > 0
    && (Object.keys(artifacts).length > MAX_ARTIFACT_COUNT || totalBytes > MAX_TOTAL_ARTIFACT_BYTES)
  ) {
    const [key, entry] = candidates.shift()!
    if (!artifacts[key]) continue
    totalBytes -= entry.byteSize
    removeKey(key)
  }
  return { artifacts, removed }
}

export class ContextHubStorage {
  private readonly basePath: string
  private readonly manifestPath: string
  private manifest: ContextCacheManifest | null = null
  private initialization: Promise<void> | null = null
  private manifestWriteQueue: Promise<void> = Promise.resolve()
  private snapshotOperationQueue: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(
    projectPath: string,
    private readonly io: ContextHubStorageIo = defaultIo,
  ) {
    this.basePath = `${normalizePath(projectPath)}/.qmai/context-cache/v2`
    this.manifestPath = `${this.basePath}/manifest.json`
  }

  initialize(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Context Hub storage 已释放"))
    if (!this.initialization) {
      this.initialization = this.initializeInternal().catch((error) => {
        this.initialization = null
        throw error
      })
    }
    return this.initialization
  }

  dispose(): void {
    this.disposed = true
    this.manifest = null
    this.initialization = null
  }

  async loadManifest(): Promise<ContextCacheManifest> {
    await this.initialize()
    return cloneManifest(this.manifest ?? emptyManifest())
  }

  async saveManifest(manifest: ContextCacheManifest): Promise<void> {
    await this.initialize()
    await this.enqueueManifestWrite(async () => {
      const current = this.manifest ?? emptyManifest()
      await this.persistManifest({
        schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
        sources: { ...manifest.sources },
        artifacts: { ...current.artifacts },
      })
    })
  }

  async readArtifact<T>(key: string): Promise<CachedArtifact<T> | null> {
    await this.initialize()
    const entry = this.manifest?.artifacts[key]
    if (!entry) return null
    try {
      const raw = parseObject(await this.io.readFile(entry.path))
      if (
        !raw
        || raw.schemaVersion !== CONTEXT_CACHE_SCHEMA_VERSION
        || raw.key !== key
        || !("value" in raw)
        || !isDependencyStamp(raw.dependencyStamp)
      ) return null
      return raw as unknown as CachedArtifact<T>
    } catch {
      return null
    }
  }

  async writeArtifact<T>(key: string, artifact: CachedArtifact<T>): Promise<void> {
    await this.initialize()
    const value: CachedArtifact<T> = {
      ...artifact,
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      key,
    }
    const serialized = JSON.stringify(value)
    const byteSize = new TextEncoder().encode(serialized).byteLength
    if (byteSize > MAX_ARTIFACT_BYTES) return
    const artifactPath = `${this.basePath}/artifacts/${await hashedFileName(`${key}:${await sha256Text(serialized)}`)}`

    const previous = this.manifest?.artifacts[key]
    await this.io.writeFileAtomic(artifactPath, serialized)
    try {
      await this.enqueueManifestWrite(async () => {
        const current = this.manifest ?? emptyManifest()
        const candidate = {
          ...current.artifacts,
          [key]: {
            path: artifactPath,
            sourceName: artifact.sourceName,
            scope: artifact.scope,
            dependencyStamp: artifact.dependencyStamp,
            createdAt: artifact.createdAt,
            byteSize,
          },
        }
        const pruned = pruneArtifactEntries(candidate)
        await this.persistManifest({ ...current, artifacts: pruned.artifacts })
        const obsoletePaths = pruned.removed.map((entry) => entry.path)
        if (previous?.path && previous.path !== artifactPath) obsoletePaths.push(previous.path)
        await Promise.all(obsoletePaths.map((path) => this.safeDelete(path)))
      })
    } catch (error) {
      if (previous?.path !== artifactPath) await this.safeDelete(artifactPath)
      throw error
    }
  }

  async readStableBundle(surface: ContextSurface): Promise<StableBundle | null> {
    await this.initialize()
    try {
      const raw = parseObject(await this.io.readFile(this.stableBundlePath(surface)))
      if (
        !raw
        || raw.schemaVersion !== CONTEXT_CACHE_SCHEMA_VERSION
        || raw.surface !== surface
        || typeof raw.text !== "string"
        || !isDependencyStamp(raw.dependencyStamp)
      ) return null
      return raw as unknown as StableBundle
    } catch {
      return null
    }
  }

  async writeStableBundle(surface: ContextSurface, bundle: StableBundle): Promise<void> {
    await this.initialize()
    const value: StableBundle = {
      ...bundle,
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      surface,
    }
    await this.io.writeFileAtomic(this.stableBundlePath(surface), JSON.stringify(value))
  }

  async readSnapshot(surface: ContextSurface, id: string): Promise<ContextHubSnapshot | null> {
    await this.initialize()
    try {
      const raw = parseObject(await this.io.readFile(await this.snapshotPath(surface, id)))
      if (
        !raw
        || raw.schemaVersion !== CONTEXT_CACHE_SCHEMA_VERSION
        || raw.id !== id
        || raw.surface !== surface
        || typeof raw.createdAt !== "number"
        || !raw.stats
        || !Array.isArray(raw.items)
        || typeof raw.stableCore !== "string"
        || typeof raw.sessionSummary !== "string"
        || typeof raw.dynamicContext !== "string"
      ) return null
      return raw as unknown as ContextHubSnapshot
    } catch {
      return null
    }
  }

  async writeSnapshot(snapshot: ContextHubSnapshot): Promise<void> {
    await this.initialize()
    await this.enqueueSnapshotOperation(async () => {
      const value: ContextHubSnapshot = {
        ...snapshot,
        schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      }
      await this.io.writeFileAtomic(
        await this.snapshotPath(snapshot.surface, snapshot.id),
        JSON.stringify(value),
      )
    })
  }

  async pruneSnapshots(surface: ContextSurface, referencedIds: string[]): Promise<void> {
    await this.initialize()
    await this.enqueueSnapshotOperation(async () => {
      const directory = this.snapshotSurfacePath(surface)
      let nodes: Array<{ name: string; path: string; is_dir: boolean; mtimeMs?: number }>
      try {
        nodes = await this.io.listDirectory(directory)
      } catch {
        return
      }
      const referencedPaths = new Set(
        (await Promise.all(referencedIds.map((id) => this.snapshotPath(surface, id))))
          .map((path) => path.toLowerCase()),
      )
      const cutoff = Date.now() - SNAPSHOT_CLEANUP_GRACE_MS
      for (const node of nodes) {
        if (node.is_dir) continue
        const candidate = normalizePath(node.path)
        if (!this.isDirectSnapshotFile(directory, candidate)) continue
        if (referencedPaths.has(candidate.toLowerCase())) continue

        let createdAt = node.mtimeMs
        try {
          const raw = parseObject(await this.io.readFile(candidate))
          if (raw && typeof raw.createdAt === "number") createdAt = raw.createdAt
        } catch {
        }
        if (createdAt === undefined || createdAt > cutoff) continue
        await this.safeDelete(candidate)
      }
    })
  }

  private async initializeInternal(): Promise<void> {
    await this.ensureBaseDirectories()
    const exists = await this.io.fileExists(this.manifestPath).catch(() => false)
    if (!exists) {
      this.manifest = emptyManifest()
      await this.cleanupOrphanArtifacts()
      return
    }
    const size = await this.io.getFileSize(this.manifestPath).catch(() => MAX_MANIFEST_BYTES + 1)
    if (size > MAX_MANIFEST_BYTES) {
      await this.resetCache()
      return
    }
    try {
      const raw = parseObject(await this.io.readFile(this.manifestPath))
      if (!raw || !this.isValidManifest(raw)) {
        await this.resetCache()
        return
      }
      this.manifest = raw as unknown as ContextCacheManifest
    } catch {
      await this.resetCache()
      return
    }

    const current = this.manifest ?? emptyManifest()
    const pruned = pruneArtifactEntries(current.artifacts)
    if (pruned.removed.length > 0) {
      await this.persistManifest({ ...current, artifacts: pruned.artifacts })
      await Promise.all(pruned.removed.map((entry) => this.safeDelete(entry.path)))
    }
    await this.cleanupOrphanArtifacts()
  }

  private async resetCache(): Promise<void> {
    await this.safeDelete(this.basePath)
    this.manifest = emptyManifest()
    await this.ensureBaseDirectories()
    await this.cleanupOrphanArtifacts()
  }

  private async cleanupOrphanArtifacts(): Promise<void> {
    const directory = `${this.basePath}/artifacts`
    let nodes: Array<{ name: string; path: string; is_dir: boolean }>
    try {
      nodes = await this.io.listDirectory(directory)
    } catch {
      return
    }
    const referenced = new Set(
      Object.values(this.manifest?.artifacts ?? {}).map((entry) => normalizePath(entry.path).toLowerCase()),
    )
    await Promise.all(nodes
      .filter((node) => !node.is_dir && node.name.toLowerCase().endsWith(".json"))
      .map(async (node) => {
        const path = normalizePath(node.path)
        if (!this.isDirectSnapshotFile(directory, path)) return
        if (!referenced.has(path.toLowerCase())) await this.safeDelete(path)
      }))
  }

  private async ensureBaseDirectories(): Promise<void> {
    await this.io.createDirectory(this.basePath)
    await this.io.createDirectory(`${this.basePath}/artifacts`)
    await this.io.createDirectory(`${this.basePath}/stable-bundles`)
    await this.io.createDirectory(`${this.basePath}/snapshots`)
    await this.io.createDirectory(this.snapshotSurfacePath("ai-chat"))
    await this.io.createDirectory(this.snapshotSurfacePath("ai-outline"))
  }

  private enqueueManifestWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.manifestWriteQueue.then(operation, operation)
    this.manifestWriteQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async persistManifest(manifest: ContextCacheManifest): Promise<void> {
    if (this.disposed) throw new Error("Context Hub storage 已释放")
    await this.io.writeFileAtomic(this.manifestPath, JSON.stringify(manifest))
    this.manifest = manifest
  }

  private isValidManifest(raw: Record<string, unknown>): boolean {
    if (
      raw.schemaVersion !== CONTEXT_CACHE_SCHEMA_VERSION
      || !isRecord(raw.sources)
      || !isRecord(raw.artifacts)
    ) return false
    for (const source of Object.values(raw.sources)) {
      if (
        !isRecord(source)
        || typeof source.path !== "string"
        || typeof source.kind !== "string"
        || !Number.isInteger(source.revision)
        || (source.revision as number) < 0
      ) return false
    }
    const artifactDirectory = `${this.basePath}/artifacts`
    for (const artifact of Object.values(raw.artifacts)) {
      if (
        !isRecord(artifact)
        || typeof artifact.path !== "string"
        || !this.isDirectSnapshotFile(artifactDirectory, normalizePath(artifact.path))
        || typeof artifact.sourceName !== "string"
        || !["static", "chapter", "task"].includes(String(artifact.scope))
        || !isDependencyStamp(artifact.dependencyStamp)
        || typeof artifact.createdAt !== "number"
        || !Number.isFinite(artifact.createdAt)
        || typeof artifact.byteSize !== "number"
        || !Number.isFinite(artifact.byteSize)
        || artifact.byteSize < 0
      ) return false
    }
    return true
  }

  private stableBundlePath(surface: ContextSurface): string {
    return `${this.basePath}/stable-bundles/${surface}.json`
  }

  private snapshotSurfacePath(surface: ContextSurface): string {
    return `${this.basePath}/snapshots/${surface}`
  }

  private async snapshotPath(surface: ContextSurface, id: string): Promise<string> {
    return `${this.snapshotSurfacePath(surface)}/${await hashedFileName(`snapshot:${id}`)}`
  }

  private isDirectSnapshotFile(directory: string, candidate: string): boolean {
    const prefix = `${normalizePath(directory).replace(/\/$/, "")}/`
    const windowsPath = /^[A-Za-z]:\//.test(prefix) && /^[A-Za-z]:\//.test(candidate)
    const matchesDirectory = windowsPath
      ? candidate.toLowerCase().startsWith(prefix.toLowerCase())
      : candidate.startsWith(prefix)
    if (!matchesDirectory) return false
    const relative = candidate.slice(prefix.length)
    return relative.length > 0 && !relative.includes("/") && relative.toLowerCase().endsWith(".json")
  }

  private enqueueSnapshotOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.snapshotOperationQueue.then(operation, operation)
    this.snapshotOperationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async safeDelete(path: string): Promise<void> {
    try {
      await this.io.deleteFile(path)
    } catch {
    }
  }
}
