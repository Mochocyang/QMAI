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
import { ContextHubStorage } from "./storage"
import type { ContextCacheManifest, ContextSourceKind, SourceVersion } from "./types"

interface SourceRegistryStorage {
  loadManifest(): Promise<ContextCacheManifest>
  saveManifest(manifest: ContextCacheManifest): Promise<void>
}

export interface ContextSourceRegistryOptions {
  scanFiles?: () => Promise<FileNode[]>
  getFileMd5?: (path: string) => Promise<string>
  storage?: SourceRegistryStorage
  subscribe?: (listener: (event: ProjectFileMutation) => void) => () => void
}

export interface ContextSourceScannerIo {
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
  ])
  return flattenFiles(roots.flat())
}

function metadataMatches(left: SourceVersion, right: FileNode): boolean {
  return left.mtimeMs === right.mtimeMs && left.size === right.size
}

function manifestsEqual(left: ContextCacheManifest, right: ContextCacheManifest): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
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

  getDependencies(kinds?: ContextSourceKind[]): Record<string, number> {
    const allowed = kinds ? new Set(kinds) : null
    return Object.fromEntries(
      sortContextSourcePaths(Object.keys(this.versions))
        .filter((path) => !allowed || allowed.has(this.versions[path].kind))
        .map((path) => [path, this.versions[path].revision]),
    )
  }

  dispose(): void {
    this.unsubscribe()
    this.dirtyPaths.clear()
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
      if (contentChanged) changedPaths.push(path)
    }

    for (const path of Object.keys(previous)) {
      if (!byPath.has(path)) changedPaths.push(path)
    }

    const nextManifest: ContextCacheManifest = { ...manifest, sources: next }
    if (!manifestsEqual(manifest, nextManifest)) await this.storage.saveManifest(nextManifest)
    this.versions = next
    this.dirtyPaths.clear()

    return {
      versions: { ...next },
      changedPaths: sortContextSourcePaths([...new Set(changedPaths)]),
    }
  }
}
