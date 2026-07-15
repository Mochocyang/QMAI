import { describe, expect, it } from "vitest"
import { ContextHubStorage, type ContextHubStorageIo } from "./storage"
import {
  CONTEXT_CACHE_SCHEMA_VERSION,
  type CachedArtifact,
  type ContextHubSnapshot,
} from "./types"

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
    },
  }
  return { files, directories, deletedPaths, io, setFailWrite: (value?: (path: string) => boolean) => { failWrite = value } }
}

function artifact(value: string, key = "outline:main"): CachedArtifact<string> {
  return {
    schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
    key,
    value,
    dependencies: { "E:/Novel/wiki/outlines/main.md": 1 },
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
      dependencyPaths: ["wiki/outlines/main.md"],
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
      "E:/Novel/.qmai/context-cache/v1/manifest.json",
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
    const first = { schemaVersion: 1, surface: "ai-chat" as const, text: "一", dependencies: {}, updatedAt: 1 }
    const second = { ...first, text: "二", updatedAt: 2 }

    await storage.writeStableBundle("ai-chat", first)
    await storage.writeStableBundle("ai-chat", second)

    expect([...memory.files.keys()].filter((path) => path.includes("stable-bundles"))).toEqual([
      "E:/Novel/.qmai/context-cache/v1/stable-bundles/ai-chat.json",
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
    const outsidePath = "E:/Novel/.qmai/context-cache/v1/outside.json"
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
})
