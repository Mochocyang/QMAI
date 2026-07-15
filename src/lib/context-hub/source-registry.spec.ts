import { describe, expect, it, vi } from "vitest"
import type { FileNode } from "@/types/wiki"
import { ContextSourceRegistry, scanProjectContextFiles } from "./source-registry"
import { CONTEXT_CACHE_SCHEMA_VERSION, type ContextCacheManifest } from "./types"

function file(path: string, mtimeMs: number, size = 10): FileNode {
  return {
    name: path.split("/").at(-1) ?? path,
    path,
    is_dir: false,
    mtimeMs,
    size,
  }
}

function createHarness(initialFiles: FileNode[]) {
  let files = initialFiles
  let manifest: ContextCacheManifest = {
    schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
    sources: {},
    artifacts: {},
  }
  const hashes = new Map<string, string>()
  const scanFiles = vi.fn(async () => files)
  const getFileMd5 = vi.fn(async (path: string) => hashes.get(path) ?? `hash:${path}`)
  const storage = {
    loadManifest: vi.fn(async () => structuredClone(manifest)),
    saveManifest: vi.fn(async (next: ContextCacheManifest) => { manifest = structuredClone(next) }),
  }
  const registry = new ContextSourceRegistry("E:/Novel", {
    scanFiles,
    getFileMd5,
    storage,
    subscribe: () => () => {},
  })
  return {
    registry,
    hashes,
    scanFiles,
    getFileMd5,
    setFiles: (next: FileNode[]) => { files = next },
  }
}

describe("ContextSourceRegistry", () => {
  it("scans direct .qmai files and nested simulation files", async () => {
    const calls: Array<[string, unknown]> = []
    const writingStyle = file("E:/Novel/.qmai/writing-style.json", 1)
    const simulation = file("E:/Novel/.qmai/simulations/latest.json", 1)

    const result = await scanProjectContextFiles("E:/Novel", {
      fileExists: vi.fn(async () => true),
      listDirectory: vi.fn(async (path, options) => {
        calls.push([path, options])
        if (path === "E:/Novel/.qmai") return [writingStyle]
        if (path === "E:/Novel/.qmai/simulations") return [simulation]
        return []
      }),
    })

    expect(result).toEqual([writingStyle, simulation])
    expect(calls).toContainEqual(["E:/Novel/.qmai", { includeHidden: true, maxDepth: 1 }])
    expect(calls).toContainEqual(["E:/Novel/.qmai/simulations", { includeHidden: true, maxDepth: 30 }])
  })

  it("propagates a scan error when an existing directory is unreadable", async () => {
    await expect(scanProjectContextFiles("E:/Novel", {
      fileExists: vi.fn(async (path) => path.endsWith("/wiki")),
      listDirectory: vi.fn(async (path) => {
        if (path.endsWith("/wiki")) throw new Error("无权读取")
        return []
      }),
    })).rejects.toThrow("无权读取")
  })

  it("does not hash unchanged metadata on a repeated refresh", async () => {
    const path = "E:/Novel/wiki/chapters/1.md"
    const harness = createHarness([file(path, 1)])

    const first = await harness.registry.refresh()
    const second = await harness.registry.refresh()

    expect(first.versions[path].revision).toBe(1)
    expect(second.versions[path].revision).toBe(1)
    expect(harness.getFileMd5).toHaveBeenCalledTimes(1)
  })

  it("keeps the revision when metadata changes but content hash does not", async () => {
    const path = "E:/Novel/wiki/outlines/main.md"
    const harness = createHarness([file(path, 1)])
    harness.hashes.set(path, "same")
    await harness.registry.refresh()
    harness.setFiles([file(path, 2)])

    const result = await harness.registry.refresh()

    expect(result.versions[path].revision).toBe(1)
    expect(result.changedPaths).toEqual([])
    expect(harness.getFileMd5).toHaveBeenCalledTimes(2)
  })

  it("increments only the changed source revision", async () => {
    const chapter = "E:/Novel/wiki/chapters/1.md"
    const setting = "E:/Novel/wiki/settings/world.md"
    const harness = createHarness([file(chapter, 1), file(setting, 1)])
    harness.hashes.set(chapter, "chapter-1")
    harness.hashes.set(setting, "setting-1")
    await harness.registry.refresh()
    harness.hashes.set(chapter, "chapter-2")
    harness.setFiles([file(chapter, 2), file(setting, 1)])

    const result = await harness.registry.refresh()

    expect(result.versions[chapter].revision).toBe(2)
    expect(result.versions[setting].revision).toBe(1)
    expect(result.changedPaths).toEqual([chapter])
  })

  it("hashes a dirty internal write even when metadata has not changed", async () => {
    const path = "E:/Novel/wiki/memory/clue.md"
    const harness = createHarness([file(path, 1)])
    harness.hashes.set(path, "one")
    await harness.registry.refresh()
    harness.hashes.set(path, "two")
    harness.registry.markDirty(path)

    const result = await harness.registry.refresh()

    expect(result.versions[path].revision).toBe(2)
  })

  it("deduplicates concurrent refreshes", async () => {
    const harness = createHarness([file("E:/Novel/wiki/chapters/1.md", 1)])

    await Promise.all([harness.registry.refresh(), harness.registry.refresh()])

    expect(harness.scanFiles).toHaveBeenCalledTimes(1)
  })
})
