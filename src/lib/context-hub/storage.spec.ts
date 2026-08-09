import { describe, expect, it } from "vitest"
import { ContextHubStorage, type ContextHubStorageIo } from "./storage"
import {
  CONTEXT_CACHE_SCHEMA_VERSION,
  type CachedArtifact,
  type ContextCacheManifest,
  type ContextHubSnapshot,
  type DependencyStamp,
} from "./types"

const dependencyStamp: DependencyStamp = {
  fingerprint: "outline-v1",
  sourceCount: 1,
  kinds: ["outline"],
}

function createMemoryIo() {
  const files = new Map<string, string>()
  const directories = new Set<string>()
  const deletedPaths: string[] = []
  let failWrite: ((path: string) => boolean) | undefined
  const io: ContextHubStorageIo = {
    readFile: async (path) => {
      const value = files.get(path)
      if (value === undefined) throw new Error("文件不存在")
      return value
    },
    writeFileAtomic: async (path, contents) => {
      if (failWrite?.(path)) throw new Error("写入失败")
      files.set(path, contents)
    },
    createDirectory: async (path) => {
      directories.add(path)
    },
    listDirectory: async (path) => [...files.keys()]
      .filter((filePath) => filePath.startsWith(`${path}/`) && !filePath.slice(path.length + 1).includes("/"))
      .map((filePath) => ({ name: filePath.split("/").pop()!, path: filePath, is_dir: false, mtimeMs: 1 })),
    deleteFile: async (path) => {
      deletedPaths.push(path)
      files.delete(path)
      for (const filePath of [...files.keys()]) {
        if (filePath.startsWith(`${path}/`)) files.delete(filePath)
      }
      for (const directory of [...directories]) {
        if (directory === path || directory.startsWith(`${path}/`)) directories.delete(directory)
      }
    },
    fileExists: async (path) => files.has(path) || directories.has(path),
    getFileSize: async (path) => new TextEncoder().encode(files.get(path) ?? "").byteLength,
  }
  return { files, directories, deletedPaths, io, setFailWrite: (value?: (path: string) => boolean) => { failWrite = value } }
}

function artifact(value: string, key = "outline:main"): CachedArtifact<string> {
  return {
    schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
    key,
    sourceName: "outline",
    scope: "static",
    value,
    dependencyStamp,
    createdAt: 1,
  }
}

function snapshot(id = "assistant:1"): ContextHubSnapshot {
  return {
    schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
    id,
    surface: "ai-chat",
    createdAt: 10,
    stats: {
      hits: 1,
      refreshed: 2,
      failures: 0,
      stableTokens: 100,
      summaryTokens: 20,
      dynamicTokens: 80,
      candidateTokens: 400,
      estimatedSavedTokens: 200,
      estimatedSavedPercent: 50,
      expanded: false,
      providerCacheEnabled: true,
    },
    items: [{
      key: "data-source:outline",
      sourceName: "outline",
      status: "hit",
      dependencyStamp,
      dependencyPaths: ["wiki/outlines/main.md"],
      dependencyPathsTruncated: false,
    }],
    stableCore: "稳定核心正文",
    sessionSummary: "会话摘要正文",
    dynamicContext: "动态片段正文",
  }
}

describe("ContextHubStorage", () => {
  it("returns an empty manifest for a first run", async () => {
    const memory = createMemoryIo()
    const storage = new ContextHubStorage("E:/Novel", memory.io)

    await expect(storage.loadManifest()).resolves.toEqual({
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      sources: {},
      artifacts: {},
    })
  })

  it("persists artifacts for a new storage instance", async () => {
    const memory = createMemoryIo()
    await new ContextHubStorage("E:/Novel", memory.io).writeArtifact("outline:main", artifact("大纲"))

    const restarted = new ContextHubStorage("E:/Novel", memory.io)
    await expect(restarted.readArtifact<string>("outline:main")).resolves.toMatchObject({ value: "大纲" })
  })

  it("preserves every manifest entry during concurrent artifact writes", async () => {
    const memory = createMemoryIo()
    const storage = new ContextHubStorage("E:/Novel", memory.io)

    await Promise.all([
      storage.writeArtifact("outline:main", artifact("大纲")),
      storage.writeArtifact("chapter:1", artifact("第一章", "chapter:1")),
    ])

    const restarted = new ContextHubStorage("E:/Novel", memory.io)
    await expect(restarted.readArtifact<string>("outline:main")).resolves.toMatchObject({ value: "大纲" })
    await expect(restarted.readArtifact<string>("chapter:1")).resolves.toMatchObject({ value: "第一章" })
  })

  it("does not remove a newer artifact when saving a stale source snapshot", async () => {
    const memory = createMemoryIo()
    const storage = new ContextHubStorage("E:/Novel", memory.io)
    const staleManifest = await storage.loadManifest()
    await storage.writeArtifact("outline:main", artifact("大纲"))
    staleManifest.sources["E:/Novel/wiki/outlines/main.md"] = {
      path: "E:/Novel/wiki/outlines/main.md",
      kind: "outline",
      mtimeMs: 1,
      size: 10,
      hash: "hash",
      revision: 1,
    }

    await storage.saveManifest(staleManifest)

    const restarted = new ContextHubStorage("E:/Novel", memory.io)
    await expect(restarted.readArtifact<string>("outline:main")).resolves.toMatchObject({ value: "大纲" })
  })

  it("treats corrupted artifacts as misses", async () => {
    const memory = createMemoryIo()
    const storage = new ContextHubStorage("E:/Novel", memory.io)
    await storage.writeArtifact("outline:main", artifact("大纲"))
    const manifest = await storage.loadManifest()
    memory.files.set(manifest.artifacts["outline:main"].path, "{broken")

    await expect(storage.readArtifact("outline:main")).resolves.toBeNull()
  })

  it("treats a different schema as an empty cache", async () => {
    const memory = createMemoryIo()
    memory.files.set(
      "E:/Novel/.qmai/context-cache/v2/manifest.json",
      JSON.stringify({ schemaVersion: 999, sources: { stale: {} }, artifacts: {} }),
    )

    await expect(new ContextHubStorage("E:/Novel", memory.io).loadManifest()).resolves.toMatchObject({
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      sources: {},
    })
  })

  it("does not publish a manifest entry when artifact writing fails", async () => {
    const memory = createMemoryIo()
    memory.setFailWrite((path) => path.includes("/artifacts/"))
    const storage = new ContextHubStorage("E:/Novel", memory.io)

    await expect(storage.writeArtifact("outline:main", artifact("大纲"))).rejects.toThrow("写入失败")
    memory.setFailWrite()
    expect((await storage.loadManifest()).artifacts).toEqual({})
  })

  it("uses one fixed stable bundle file per surface", async () => {
    const memory = createMemoryIo()
    const storage = new ContextHubStorage("E:/Novel", memory.io)
    const first = {
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      surface: "ai-chat" as const,
      text: "一",
      dependencyStamp,
      updatedAt: 1,
    }
    const second = { ...first, text: "二", updatedAt: 2 }

    await storage.writeStableBundle("ai-chat", first)
    await storage.writeStableBundle("ai-chat", second)

    expect([...memory.files.keys()].filter((path) => path.includes("stable-bundles"))).toEqual([
      "E:/Novel/.qmai/context-cache/v2/stable-bundles/ai-chat.json",
    ])
    await expect(storage.readStableBundle("ai-chat")).resolves.toMatchObject({ text: "二" })
  })

  it("persists a context snapshot separately and reads it after restart", async () => {
    const memory = createMemoryIo()
    await new ContextHubStorage("E:/Novel", memory.io).writeSnapshot(snapshot())

    const snapshotPaths = [...memory.files.keys()].filter((path) => path.includes("/snapshots/"))
    expect(snapshotPaths).toHaveLength(1)
    expect(snapshotPaths[0]).not.toContain("assistant:1")
    await expect(new ContextHubStorage("E:/Novel", memory.io).readSnapshot("ai-chat", "assistant:1"))
      .resolves.toEqual(snapshot())
  })

  it("returns null for a corrupted context snapshot", async () => {
    const memory = createMemoryIo()
    const storage = new ContextHubStorage("E:/Novel", memory.io)
    await storage.writeSnapshot(snapshot())
    const snapshotPath = [...memory.files.keys()].find((path) => path.includes("/snapshots/"))!
    memory.files.set(snapshotPath, "{broken")

    await expect(storage.readSnapshot("ai-chat", "assistant:1")).resolves.toBeNull()
  })

  it("prunes only old unreferenced snapshots from the selected surface", async () => {
    const memory = createMemoryIo()
    const storage = new ContextHubStorage("E:/Novel", memory.io)
    await storage.writeSnapshot({ ...snapshot("kept"), createdAt: 1 })
    await storage.writeSnapshot({ ...snapshot("orphan"), createdAt: 1 })
    await storage.writeSnapshot({ ...snapshot("outline"), surface: "ai-outline", createdAt: 1 })

    await storage.pruneSnapshots("ai-chat", ["kept"])

    await expect(storage.readSnapshot("ai-chat", "kept")).resolves.not.toBeNull()
    await expect(storage.readSnapshot("ai-chat", "orphan")).resolves.toBeNull()
    await expect(storage.readSnapshot("ai-outline", "outline")).resolves.not.toBeNull()
    expect(memory.deletedPaths).toHaveLength(1)
    expect(memory.deletedPaths[0]).toContain("/snapshots/ai-chat/")
  })

  it("keeps a newly written unreferenced snapshot during the cleanup grace period", async () => {
    const memory = createMemoryIo()
    const storage = new ContextHubStorage("E:/Novel", memory.io)
    await storage.writeSnapshot({ ...snapshot("pending-reference"), createdAt: Date.now() })

    await storage.pruneSnapshots("ai-chat", [])

    await expect(storage.readSnapshot("ai-chat", "pending-reference")).resolves.not.toBeNull()
    expect(memory.deletedPaths).toEqual([])
  })

  it("never deletes a path returned from outside the selected snapshot directory", async () => {
    const memory = createMemoryIo()
    const outsidePath = "E:/Novel/.qmai/context-cache/v2/outside.json"
    memory.files.set(outsidePath, JSON.stringify({ createdAt: 1 }))
    memory.io.listDirectory = async () => [{
      name: "outside.json",
      path: outsidePath,
      is_dir: false,
      mtimeMs: 1,
    }]

    await new ContextHubStorage("E:/Novel", memory.io).pruneSnapshots("ai-chat", [])

    expect(memory.deletedPaths).toEqual([])
    expect(memory.files.has(outsidePath)).toBe(true)
  })

  it("keeps a 10,000-source and 2,000-artifact v2 manifest below 10 MiB", async () => {
    const memory = createMemoryIo()
    const manifestPath = "E:/Novel/.qmai/context-cache/v2/manifest.json"
    const sources = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => {
      const path = `E:/Novel/wiki/entities/entity-${String(index).padStart(5, "0")}.md`
      return [path, {
        path,
        kind: "entity" as const,
        mtimeMs: index,
        size: 100,
        hash: `hash-${index}`,
        revision: 1,
      }]
    }))
    const artifacts = Object.fromEntries(Array.from({ length: 2_000 }, (_, index) => [
      `data-source:searchResults:${index}`,
      {
        path: `E:/Novel/.qmai/context-cache/v2/artifacts/${index}.json`,
        sourceName: `searchResults-${index % 16}`,
        scope: "task" as const,
        dependencyStamp: { fingerprint: `fingerprint-${index}`, sourceCount: 10_000, kinds: ["entity" as const] },
        createdAt: index,
        byteSize: 100,
      },
    ]))
    const manifest: ContextCacheManifest = {
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      sources,
      artifacts,
    }
    const serialized = JSON.stringify(manifest)
    memory.files.set(manifestPath, serialized)

    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(10 * 1024 * 1024)
    const loaded = await new ContextHubStorage("E:/Novel", memory.io).loadManifest()
    expect(Object.keys(loaded.sources)).toHaveLength(10_000)
    expect(Object.keys(loaded.artifacts)).toHaveLength(2_000)
  })

  it("keeps dependency metadata bounded and does not serialize source paths into artifacts", async () => {
    const serialized = JSON.stringify(artifact("短值"))

    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(1024)
    expect(serialized).not.toContain("wiki/outlines/main.md")
  })

  it("prunes task-scoped artifacts beyond the per-source limit", async () => {
    const memory = createMemoryIo()
    const storage = new ContextHubStorage("E:/Novel", memory.io)
    for (let index = 0; index < 129; index += 1) {
      await storage.writeArtifact(
        `search:${index}`,
        { ...artifact(`结果${index}`, `search:${index}`), sourceName: "searchResults", scope: "task", createdAt: index },
      )
    }

    const manifest = await storage.loadManifest()
    expect(Object.keys(manifest.artifacts)).toHaveLength(128)
    expect(manifest.artifacts["search:0"]).toBeUndefined()
    expect(memory.deletedPaths.some((path) => path.includes("/artifacts/"))).toBe(true)
  })

  it("enforces the global artifact count limit during initialization", async () => {
    const memory = createMemoryIo()
    const manifestPath = "E:/Novel/.qmai/context-cache/v2/manifest.json"
    const artifacts = Object.fromEntries(Array.from({ length: 2_050 }, (_, index) => [
      `chapter:${index}`,
      {
        path: `E:/Novel/.qmai/context-cache/v2/artifacts/${index}.json`,
        sourceName: "chapterOutline",
        scope: "chapter" as const,
        dependencyStamp,
        createdAt: index,
        byteSize: 1,
      },
    ]))
    memory.files.set(manifestPath, JSON.stringify({
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      sources: {},
      artifacts,
    }))

    const manifest = await new ContextHubStorage("E:/Novel", memory.io).loadManifest()

    expect(Object.keys(manifest.artifacts)).toHaveLength(2_048)
    expect(manifest.artifacts["chapter:0"]).toBeUndefined()
  })

  it("enforces the global artifact byte limit during initialization", async () => {
    const memory = createMemoryIo()
    const manifestPath = "E:/Novel/.qmai/context-cache/v2/manifest.json"
    const artifacts = Object.fromEntries(Array.from({ length: 130 }, (_, index) => [
      `chapter:${index}`,
      {
        path: `E:/Novel/.qmai/context-cache/v2/artifacts/${index}.json`,
        sourceName: "chapterOutline",
        scope: "chapter" as const,
        dependencyStamp,
        createdAt: index,
        byteSize: 1024 * 1024,
      },
    ]))
    memory.files.set(manifestPath, JSON.stringify({
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      sources: {},
      artifacts,
    }))

    const manifest = await new ContextHubStorage("E:/Novel", memory.io).loadManifest()
    const totalBytes = Object.values(manifest.artifacts).reduce((sum, entry) => sum + entry.byteSize, 0)

    expect(totalBytes).toBeLessThanOrEqual(128 * 1024 * 1024)
    expect(Object.keys(manifest.artifacts)).toHaveLength(128)
  })

  it("removes a newly written orphan when manifest persistence fails", async () => {
    const memory = createMemoryIo()
    const storage = new ContextHubStorage("E:/Novel", memory.io)
    await storage.initialize()
    memory.setFailWrite((path) => path.endsWith("/manifest.json"))

    await expect(storage.writeArtifact("outline:orphan", artifact("大纲", "outline:orphan")))
      .rejects.toThrow("写入失败")

    expect([...memory.files.keys()].filter((path) => path.includes("/artifacts/"))).toEqual([])
  })

  it("keeps the previous artifact when replacing it fails at manifest persistence", async () => {
    const memory = createMemoryIo()
    const storage = new ContextHubStorage("E:/Novel", memory.io)
    await storage.writeArtifact("outline:main", artifact("旧大纲"))
    memory.setFailWrite((path) => path.endsWith("/manifest.json"))

    await expect(storage.writeArtifact("outline:main", artifact("新大纲"))).rejects.toThrow("写入失败")
    memory.setFailWrite()

    await expect(new ContextHubStorage("E:/Novel", memory.io).readArtifact<string>("outline:main"))
      .resolves.toMatchObject({ value: "旧大纲" })
    expect([...memory.files.keys()].filter((path) => path.includes("/artifacts/"))).toHaveLength(1)
  })

  it("does not cache an artifact larger than 8 MiB", async () => {
    const memory = createMemoryIo()
    const storage = new ContextHubStorage("E:/Novel", memory.io)

    await storage.writeArtifact("outline:huge", artifact("x".repeat(8 * 1024 * 1024), "outline:huge"))

    expect((await storage.loadManifest()).artifacts).toEqual({})
    expect([...memory.files.keys()].some((path) => path.includes("/artifacts/"))).toBe(false)
  })

  it("resets an oversized v2 manifest without parsing it", async () => {
    const memory = createMemoryIo()
    const manifestPath = "E:/Novel/.qmai/context-cache/v2/manifest.json"
    memory.files.set(manifestPath, "x".repeat(32 * 1024 * 1024 + 1))

    const manifest = await new ContextHubStorage("E:/Novel", memory.io).loadManifest()

    expect(manifest).toEqual({ schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION, sources: {}, artifacts: {} })
    expect(memory.deletedPaths).toContain("E:/Novel/.qmai/context-cache/v2")
  })

  it("resets a structurally invalid v2 manifest", async () => {
    const memory = createMemoryIo()
    const manifestPath = "E:/Novel/.qmai/context-cache/v2/manifest.json"
    memory.files.set(manifestPath, JSON.stringify({
      schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
      sources: {},
      artifacts: [{ path: "E:/outside.json" }],
    }))

    const manifest = await new ContextHubStorage("E:/Novel", memory.io).loadManifest()

    expect(manifest).toEqual({ schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION, sources: {}, artifacts: {} })
    expect(memory.deletedPaths).toContain("E:/Novel/.qmai/context-cache/v2")
  })

  it("cleans an unindexed artifact during initialization", async () => {
    const memory = createMemoryIo()
    const orphan = "E:/Novel/.qmai/context-cache/v2/artifacts/orphan.json"
    memory.files.set(orphan, "{}")

    await new ContextHubStorage("E:/Novel", memory.io).initialize()

    expect(memory.deletedPaths).toContain(orphan)
  })
})
