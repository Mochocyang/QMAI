import { describe, expect, it, vi } from "vitest"
import type { ContextPack } from "@/lib/novel/context-engine"
import { ContextHubController } from "./context-hub"
import type { CachedArtifact, ContextHubSnapshot, StableBundle } from "./types"

function pack(): ContextPack {
  return {
    task: "生成大纲",
    chapterGoal: "建立第一幕冲突",
    outline: "第一幕：失踪",
    recentChapterContents: [],
    recentSummaries: [],
    previousChapterEnding: "",
    characterStates: "",
    soulDoc: "现实主义悬疑",
    characterAuras: "",
    cognitionStates: "",
    foreshadowingStates: "",
    timeline: "",
    relatedSettings: "旧车站",
    canonRules: "",
    writingStyle: "克制",
    searchResults: "",
    graphSearchResults: "",
    mustDo: "",
    mustAvoid: "",
    nextChapterAdvice: "",
    revisionDirectives: "",
  }
}

function createHarness() {
  const artifacts = new Map<string, CachedArtifact>()
  const bundles = new Map<string, StableBundle>()
  const snapshots = new Map<string, ContextHubSnapshot>()
  const registry = {
    refresh: vi.fn(async () => ({ versions: {}, changedPaths: [] as string[] })),
    getDependencies: vi.fn(() => ({ "E:/Novel/wiki/outlines/main.md": 1 })),
    markDirty: vi.fn(),
    dispose: vi.fn(),
  }
  const storage = {
    readArtifact: vi.fn(async (key: string) => artifacts.get(key) ?? null),
    writeArtifact: vi.fn(async (key: string, value: CachedArtifact) => { artifacts.set(key, value) }),
    readStableBundle: vi.fn(async (surface: string) => bundles.get(surface) ?? null),
    writeStableBundle: vi.fn(async (surface: string, value: StableBundle) => { bundles.set(surface, value) }),
    readSnapshot: vi.fn(async (_surface: string, id: string) => snapshots.get(id) ?? null),
    writeSnapshot: vi.fn(async (value: ContextHubSnapshot) => { snapshots.set(value.id, value) }),
    pruneSnapshots: vi.fn(async () => {}),
  }
  const buildContextPack = vi.fn(async () => pack())
  const readFile = vi.fn(async (path: string) => `内容:${path}:${readFile.mock.calls.length}`)
  const controller = new ContextHubController("E:/Novel", {
    registry,
    storage,
    buildContextPack,
    readFile,
    subscribe: () => () => {},
  })
  return { controller, registry, storage, buildContextPack, readFile }
}

const request = {
  projectPath: "E:/Novel",
  surface: "ai-chat" as const,
  sessionId: "chat-1",
  task: "生成大纲",
  intent: "generate" as const,
}

describe("ContextHubController", () => {
  it("bypasses review and lint intents", async () => {
    const harness = createHarness()

    await expect(harness.controller.prepare({ ...request, intent: "review" })).resolves.toBeNull()
    await expect(harness.controller.prepare({ ...request, intent: "lint" })).resolves.toBeNull()
    expect(harness.registry.refresh).not.toHaveBeenCalled()
    expect(harness.buildContextPack).not.toHaveBeenCalled()
  })

  it("isolates the provided session summary for each request", async () => {
    const harness = createHarness()
    const chat = await harness.controller.prepare({
      ...request,
      existingSummary: { text: "AI 对话摘要", dependencies: { "E:/Novel/wiki/outlines/main.md": 1 }, updatedAt: 1 },
    })
    const outline = await harness.controller.prepare({
      ...request,
      surface: "ai-outline",
      sessionId: "outline-1",
      existingSummary: { text: "AI 大纲摘要", dependencies: { "E:/Novel/wiki/outlines/main.md": 1 }, updatedAt: 1 },
    })

    expect(chat?.sessionSummary).toBe("AI 对话摘要")
    expect(outline?.sessionSummary).toBe("AI 大纲摘要")
  })

  it("does not reuse an existing summary during a forced refresh", async () => {
    const harness = createHarness()

    const result = await harness.controller.prepare({
      ...request,
      forceRefresh: true,
      existingSummary: { text: "旧摘要", dependencies: { "E:/Novel/wiki/outlines/main.md": 1 }, updatedAt: 1 },
    })

    expect(result?.sessionSummary).toBe("")
  })

  it("deduplicates an identical concurrent prepare", async () => {
    const harness = createHarness()

    await Promise.all([
      harness.controller.prepare(request),
      harness.controller.prepare(request),
    ])

    expect(harness.buildContextPack).toHaveBeenCalledOnce()
  })

  it("reports the stable cache item with project-relative dependency paths", async () => {
    const harness = createHarness()

    const first = await harness.controller.prepare(request)
    const second = await harness.controller.prepare({ ...request, task: "继续生成大纲" })

    expect(first?.cacheItems).toEqual([
      expect.objectContaining({
        sourceName: "stableCore",
        status: "refreshed",
        dependencyPaths: ["wiki/outlines/main.md"],
      }),
    ])
    expect(second?.cacheItems).toEqual([
      expect.objectContaining({
        sourceName: "stableCore",
        status: "hit",
        dependencyPaths: ["wiki/outlines/main.md"],
      }),
    ])
  })

  it("removes a Windows project root from dependency paths case-insensitively", async () => {
    const harness = createHarness()
    harness.registry.getDependencies.mockReturnValue({
      "e:/Novel/wiki/outlines/main.md": 1,
    })

    const result = await harness.controller.prepare(request)

    expect(result?.cacheItems[0].dependencyPaths).toEqual(["wiki/outlines/main.md"])
  })

  it("persists the exact composed context and returns a lightweight snapshot reference", async () => {
    const harness = createHarness()
    const result = await harness.controller.prepare(request)

    const reference = await harness.controller.saveSnapshot("assistant:1", result!)

    expect(reference).toMatchObject({
      id: "assistant:1",
      surface: "ai-chat",
      stats: result?.stats,
    })
    expect(reference).not.toHaveProperty("stableCore")
    expect(reference).not.toHaveProperty("items")
    await expect(harness.controller.readSnapshot(reference)).resolves.toMatchObject({
      items: result?.cacheItems,
      stableCore: result?.stableCore,
      sessionSummary: result?.sessionSummary,
      dynamicContext: result?.dynamicContext,
    })
  })

  it("returns the lightweight reference when snapshot persistence fails", async () => {
    const harness = createHarness()
    const result = await harness.controller.prepare(request)
    harness.storage.writeSnapshot.mockRejectedValueOnce(new Error("磁盘写入失败"))

    const reference = await harness.controller.saveSnapshot("assistant:failed", result!)

    expect(reference).toMatchObject({
      id: "assistant:failed",
      stats: result?.stats,
    })
    expect(reference).not.toHaveProperty("items")
    await expect(harness.controller.readSnapshot(reference)).resolves.toBeNull()
  })

  it("rejects a snapshot whose creation time does not match the persisted reference", async () => {
    const harness = createHarness()
    const result = await harness.controller.prepare(request)
    const reference = await harness.controller.saveSnapshot("assistant:versioned", result!)

    await expect(harness.controller.readSnapshot({ ...reference, createdAt: reference.createdAt + 1 }))
      .resolves.toBeNull()
  })

  it("uses a read-through cache and evicts a dirty file", async () => {
    const harness = createHarness()
    const path = "E:/Novel/wiki/chapters/1.md"

    const first = await harness.controller.readFile(path)
    const second = await harness.controller.readFile(path)
    harness.controller.markDirty(path)
    const third = await harness.controller.readFile(path)

    expect(first).toBe(second)
    expect(third).not.toBe(second)
    expect(harness.readFile).toHaveBeenCalledTimes(2)
  })

  it("evicts read-through entries changed by the external refresh", async () => {
    const harness = createHarness()
    const path = "E:/Novel/wiki/chapters/1.md"
    await harness.controller.readFile(path)
    harness.registry.refresh.mockResolvedValueOnce({ versions: {}, changedPaths: [path] })

    await harness.controller.prepare(request)
    await harness.controller.readFile(path)

    expect(harness.readFile).toHaveBeenCalledTimes(2)
  })

  it("returns null so the caller can use its unchanged path when cache validation fails", async () => {
    const harness = createHarness()
    harness.registry.refresh.mockRejectedValueOnce(new Error("manifest 损坏"))

    const result = await harness.controller.prepare(request)

    expect(result).toBeNull()
    expect(harness.buildContextPack).not.toHaveBeenCalled()
  })
})
