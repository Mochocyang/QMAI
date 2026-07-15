import { createDirectory, deleteFile, listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import {
  CONTEXT_CACHE_SCHEMA_VERSION,
  type CachedArtifact,
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
}

const defaultIo: ContextHubStorageIo = {
  readFile,
  writeFileAtomic,
  createDirectory,
  listDirectory: (path) => listDirectory(path, { includeHidden: true, maxDepth: 1 }),
  deleteFile,
}

const SNAPSHOT_CLEANUP_GRACE_MS = 60_000

function emptyManifest(): ContextCacheManifest {
  return {
    schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
    sources: {},
    artifacts: {},
  }
}

function cloneManifest(manifest: ContextCacheManifest): ContextCacheManifest {
  return JSON.parse(JSON.stringify(manifest)) as ContextCacheManifest
}

function artifactFileName(key: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}.json`
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

export class ContextHubStorage {
  private readonly basePath: string
  private readonly manifestPath: string
  private manifest: ContextCacheManifest | null = null
  private manifestWriteQueue: Promise<void> = Promise.resolve()
  private snapshotOperationQueue: Promise<void> = Promise.resolve()

  constructor(
    projectPath: string,
    private readonly io: ContextHubStorageIo = defaultIo,
  ) {
    this.basePath = `${normalizePath(projectPath)}/.qmai/context-cache/v1`
    this.manifestPath = `${this.basePath}/manifest.json`
  }

  async loadManifest(): Promise<ContextCacheManifest> {
    return cloneManifest(await this.getManifest())
  }

  async saveManifest(manifest: ContextCacheManifest): Promise<void> {
    await this.enqueueManifestWrite(async () => {
      const current = await this.getManifest()
      const next = cloneManifest({
        ...manifest,
        schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
        artifacts: {
          ...manifest.artifacts,
          ...current.artifacts,
        },
      })
      await this.persistManifest(next)
    })
  }

  async readArtifact<T>(key: string): Promise<CachedArtifact<T> | null> {
    const entry = (await this.getManifest()).artifacts[key]
    if (!entry) return null
    try {
      const raw = parseObject(await this.io.readFile(entry.path))
      if (
        !raw
        || raw.schemaVersion !== CONTEXT_CACHE_SCHEMA_VERSION
        || raw.key !== key
        || !("value" in raw)
      ) return null
      return raw as unknown as CachedArtifact<T>
    } catch {
      return null
    }
  }

  async writeArtifact<T>(key: string, artifact: CachedArtifact<T>): Promise<void> {
    await this.ensureBaseDirectories()
    const artifactPath = `${this.basePath}/artifacts/${artifactFileName(key)}`
    const value: CachedArtifact<T> = {
      ...artifact,
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      key,
    }
    await this.io.writeFileAtomic(artifactPath, JSON.stringify(value, null, 2))

    await this.enqueueManifestWrite(async () => {
      const current = await this.getManifest()
      const next: ContextCacheManifest = {
        ...cloneManifest(current),
        artifacts: {
          ...current.artifacts,
          [key]: {
            path: artifactPath,
            dependencies: { ...artifact.dependencies },
          },
        },
      }
      await this.persistManifest(next)
    })
  }

  async readStableBundle(surface: ContextSurface): Promise<StableBundle | null> {
    try {
      const raw = parseObject(await this.io.readFile(this.stableBundlePath(surface)))
      if (
        !raw
        || raw.schemaVersion !== CONTEXT_CACHE_SCHEMA_VERSION
        || raw.surface !== surface
        || typeof raw.text !== "string"
      ) return null
      return raw as unknown as StableBundle
    } catch {
      return null
    }
  }

  async writeStableBundle(surface: ContextSurface, bundle: StableBundle): Promise<void> {
    await this.ensureBaseDirectories()
    const value: StableBundle = {
      ...bundle,
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      surface,
    }
    await this.io.writeFileAtomic(this.stableBundlePath(surface), JSON.stringify(value, null, 2))
  }

  async readSnapshot(surface: ContextSurface, id: string): Promise<ContextHubSnapshot | null> {
    try {
      const raw = parseObject(await this.io.readFile(this.snapshotPath(surface, id)))
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
    await this.enqueueSnapshotOperation(async () => {
      await this.ensureBaseDirectories()
      const value: ContextHubSnapshot = {
        ...snapshot,
        schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      }
      await this.io.writeFileAtomic(
        this.snapshotPath(snapshot.surface, snapshot.id),
        JSON.stringify(value, null, 2),
      )
    })
  }

  async pruneSnapshots(surface: ContextSurface, referencedIds: string[]): Promise<void> {
    await this.enqueueSnapshotOperation(async () => {
      const directory = this.snapshotSurfacePath(surface)
      let nodes: Array<{ name: string; path: string; is_dir: boolean; mtimeMs?: number }>
      try {
        nodes = await this.io.listDirectory(directory)
      } catch {
        return
      }
      const referencedPaths = new Set(
        referencedIds.map((id) => this.snapshotPath(surface, id).toLowerCase()),
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
        try {
          await this.io.deleteFile(candidate)
        } catch {
        }
      }
    })
  }

  private async getManifest(): Promise<ContextCacheManifest> {
    if (this.manifest) return this.manifest
    try {
      const raw = parseObject(await this.io.readFile(this.manifestPath))
      if (
        !raw
        || raw.schemaVersion !== CONTEXT_CACHE_SCHEMA_VERSION
        || !raw.sources
        || !raw.artifacts
      ) {
        this.manifest = emptyManifest()
      } else {
        this.manifest = raw as unknown as ContextCacheManifest
      }
    } catch {
      this.manifest = emptyManifest()
    }
    return this.manifest
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
    const result = this.manifestWriteQueue.then(
      () => operation(),
      () => operation(),
    )
    this.manifestWriteQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async persistManifest(manifest: ContextCacheManifest): Promise<void> {
    await this.ensureBaseDirectories()
    await this.io.writeFileAtomic(this.manifestPath, JSON.stringify(manifest, null, 2))
    this.manifest = manifest
  }

  private stableBundlePath(surface: ContextSurface): string {
    return `${this.basePath}/stable-bundles/${surface}.json`
  }

  private snapshotSurfacePath(surface: ContextSurface): string {
    return `${this.basePath}/snapshots/${surface}`
  }

  private snapshotPath(surface: ContextSurface, id: string): string {
    return `${this.snapshotSurfacePath(surface)}/${artifactFileName(`snapshot:${id}`)}`
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
    const result = this.snapshotOperationQueue.then(
      () => operation(),
      () => operation(),
    )
    this.snapshotOperationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
