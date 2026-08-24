import {
  fileExists,
  getFileMd5,
  listDirectory,
  subscribeProjectFileMutations,
  type ListDirectoryOptions,
  type ProjectFileMutation,
} from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { FileNode } from "@/types/wiki"
import { classifyContextSourcePath, normalizeContextPath, sortContextSourcePaths } from "./source-paths"
import { sha256Text } from "./fingerprint"
import { ContextHubStorage } from "./storage"
import type { ContextCacheManifest, ContextSourceKind, DependencyStamp, SourceVersion } from "./types"

interface SourceRegistryStorage {
  loadManifest(): Promise<ContextCacheManifest>
  saveManifest(manifest: ContextCacheManifest): Promise<void>
}

interface ContextSourceRegistryOptions {
  scanFiles?: () => Promise<FileNode[]>
  getFileMd5?: (path: string) => Promise<string>
  storage?: SourceRegistryStorage
  subscribe?: (listener: (event: ProjectFileMutation) => void) => () => void
}

interface ContextSourceScannerIo {
  fileExists(path: string): Promise<boolean>
  listDirectory(path: string, options: ListDirectoryOptions): Promise<FileNode[]>
}

export interface SourceRefreshResult {
  versions: Record<string, SourceVersion>
  changedPaths: string[]
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  const visit = (values: FileNode[]) => {
    for (const node of values) {
      if (node.is_dir) visit(node.children ?? [])
      else files.push(node)
    }
  }
  visit(nodes)
  return files
}

const defaultScannerIo: ContextSourceScannerIo = {
  fileExists,
  listDirectory,
}

async function safeList(
  path: string,
  options: ListDirectoryOptions,
  io: ContextSourceScannerIo,
): Promise<FileNode[]> {
  if (!await io.fileExists(path)) return []
  return io.listDirectory(path, options)
}

export async function scanProjectContextFiles(
  projectPath: string,
  io: ContextSourceScannerIo = defaultScannerIo,
): Promise<FileNode[]> {
  const roots = await Promise.all([
    safeList(projectPath, { maxDepth: 1 }, io),
    safeList(`${projectPath}/wiki`, { maxDepth: 30 }, io),
    safeList(`${projectPath}/.novel`, { includeHidden: true, maxDepth: 30 }, io),
    safeList(`${projectPath}/.qmai`, { includeHidden: true, maxDepth: 1 }, io),
    safeList(`${projectPath}/.qmai/simulations`, { includeHidden: true, maxDepth: 30 }, io),
    safeList(`${projectPath}/retrieval`, { maxDepth: 30 }, io),
  ])
  return flattenFiles(roots.flat())
}

function metadataMatches(left: SourceVersion, right: FileNode): boolean {
  return left.mtimeMs === right.mtimeMs && left.size === right.size
}

function toFingerprintPath(projectPath: string, path: string): string {
  const normalizedProject = normalizeContextPath(projectPath).replace(/\/$/, "")
  const normalizedPath = normalizeContextPath(path)
  const prefix = `${normalizedProject}/`
  const windowsPath = /^[A-Za-z]:\//.test(prefix) && /^[A-Za-z]:\//.test(normalizedPath)
  const matchesProject = windowsPath
    ? normalizedPath.toLowerCase().startsWith(prefix.toLowerCase())
    : normalizedPath.startsWith(prefix)
  return matchesProject ? normalizedPath.slice(prefix.length) : normalizedPath
}

export class ContextSourceRegistry {
  private readonly projectPath: string
  private readonly scanFiles: () => Promise<FileNode[]>
  private readonly hashFile: (path: string) => Promise<string>
  private readonly storage: SourceRegistryStorage
  private readonly unsubscribe: () => void
  private readonly dirtyPaths = new Set<string>()
  private pendingRefresh: Promise<SourceRefreshResult> | null = null
  private versions: Record<string, SourceVersion> = {}
  private readonly kindStampCache = new Map<ContextSourceKind, Promise<DependencyStamp>>()
  private readonly combinedStampCache = new Map<string, Promise<DependencyStamp>>()

  constructor(projectPath: string, options: ContextSourceRegistryOptions = {}) {
    this.projectPath = normalizePath(projectPath)
    this.scanFiles = options.scanFiles ?? (() => scanProjectContextFiles(this.projectPath))
    this.hashFile = options.getFileMd5 ?? getFileMd5
    this.storage = options.storage ?? new ContextHubStorage(this.projectPath)
    const subscribe = options.subscribe ?? subscribeProjectFileMutations
    this.unsubscribe = subscribe((event) => this.markDirty(event.path))
  }

  refresh(): Promise<SourceRefreshResult> {
    if (this.pendingRefresh) return this.pendingRefresh
    this.pendingRefresh = this.refreshInternal().finally(() => {
      this.pendingRefresh = null
    })
    return this.pendingRefresh
  }

  markDirty(path: string): void {
    const normalized = normalizeContextPath(path)
    const kind = classifyContextSourcePath(this.projectPath, normalized)
    if (kind !== "ignored" && kind !== "other") this.dirtyPaths.add(normalized)
  }

  getDependencyStamp(kinds?: ContextSourceKind[]): Promise<DependencyStamp> {
    const selectedKinds = this.normalizeKinds(kinds)
    const key = selectedKinds.join("|")
    const cached = this.combinedStampCache.get(key)
    if (cached) return cached
    const pending = this.buildCombinedStamp(selectedKinds)
    this.combinedStampCache.set(key, pending)
    return pending
  }

  getDependencyPreview(kinds?: ContextSourceKind[], limit = 20): string[] {
    const allowed = new Set(this.normalizeKinds(kinds))
    return sortContextSourcePaths(Object.keys(this.versions))
      .filter((path) => allowed.has(this.versions[path].kind))
      .slice(0, Math.max(0, limit))
  }

  dispose(): void {
    this.unsubscribe()
    this.dirtyPaths.clear()
    this.versions = {}
    this.kindStampCache.clear()
    this.combinedStampCache.clear()
  }

  private async refreshInternal(): Promise<SourceRefreshResult> {
    const manifest = await this.storage.loadManifest()
    const previous = manifest.sources
    const scanned = await this.scanFiles()
    const relevant = scanned
      .map((node) => ({ ...node, path: normalizeContextPath(node.path) }))
      .filter((node) => {
        const kind = classifyContextSourcePath(this.projectPath, node.path)
        return kind !== "ignored" && kind !== "other"
      })
    const byPath = new Map(relevant.map((node) => [node.path, node]))
    const next: Record<string, SourceVersion> = {}
    const changedPaths: string[] = []
    let manifestChanged = Object.keys(previous).length !== byPath.size

    for (const path of sortContextSourcePaths([...byPath.keys()])) {
      const node = byPath.get(path)!
      const oldVersion = previous[path]
      const dirty = this.dirtyPaths.has(path)
      if (oldVersion && !dirty && metadataMatches(oldVersion, node)) {
        next[path] = oldVersion
        continue
      }

      const hash = await this.hashFile(path)
      const contentChanged = !oldVersion || oldVersion.hash !== hash
      next[path] = {
        path,
        kind: classifyContextSourcePath(this.projectPath, path),
        mtimeMs: node.mtimeMs,
        size: node.size,
        hash,
        revision: oldVersion ? oldVersion.revision + (contentChanged ? 1 : 0) : 1,
      }
      manifestChanged = true
      if (contentChanged) changedPaths.push(path)
    }

    for (const path of Object.keys(previous)) {
      if (!byPath.has(path)) changedPaths.push(path)
    }

    const nextManifest: ContextCacheManifest = { ...manifest, sources: next }
    if (manifestChanged) await this.storage.saveManifest(nextManifest)
    this.versions = next
    this.kindStampCache.clear()
    this.combinedStampCache.clear()
    this.dirtyPaths.clear()

    return {
      versions: { ...next },
      changedPaths: sortContextSourcePaths([...new Set(changedPaths)]),
    }
  }

  private normalizeKinds(kinds?: ContextSourceKind[]): ContextSourceKind[] {
    const values = kinds ?? Object.values(this.versions).map((version) => version.kind)
    return [...new Set(values)]
      .filter((kind) => kind !== "ignored" && kind !== "other")
      .sort()
  }

  private getKindStamp(kind: ContextSourceKind): Promise<DependencyStamp> {
    const cached = this.kindStampCache.get(kind)
    if (cached) return cached
    const pending = (async () => {
      const paths = sortContextSourcePaths(Object.keys(this.versions))
        .filter((path) => this.versions[path].kind === kind)
      const canonical = paths.map((path) => {
        const version = this.versions[path]
        const relative = toFingerprintPath(this.projectPath, path)
        return `${relative}\u0000${version.hash ?? `revision:${version.revision}`}`
      }).join("\n")
      return {
        fingerprint: await sha256Text(canonical),
        sourceCount: paths.length,
        kinds: [kind],
      }
    })()
    this.kindStampCache.set(kind, pending)
    return pending
  }

  private async buildCombinedStamp(kinds: ContextSourceKind[]): Promise<DependencyStamp> {
    const stamps = await Promise.all(kinds.map((kind) => this.getKindStamp(kind)))
    return {
      fingerprint: await sha256Text(
        stamps.map((stamp) => `${stamp.kinds[0]}:${stamp.sourceCount}:${stamp.fingerprint}`).join("\n"),
      ),
      sourceCount: stamps.reduce((sum, stamp) => sum + stamp.sourceCount, 0),
      kinds: [...kinds],
    }
  }
}
