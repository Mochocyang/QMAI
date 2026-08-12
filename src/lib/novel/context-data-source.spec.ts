import { describe, expect, it, vi } from "vitest"
import { DataSourceRegistry, type DataSource, type ContextLoadContext } from "./context-data-source"

const context: ContextLoadContext = {
  projectPath: "E:/Novel",
  task: "生成大纲",
  config: {
    recentSummaryWindow: 8,
    searchTopK: 5,
    snapshotLookback: 3,
    revisionFeedbackWindowConfig: {},
  },
}

describe("DataSourceRegistry", () => {
  it("uses an optional load adapter without changing the source contract", async () => {
    const load = vi.fn(async () => "原始值")
    const adapter = {
      load: vi.fn(async (_source, _context, directLoad) => `缓存:${await directLoad()}`),
    }
    const registry = new DataSourceRegistry({ loadAdapter: adapter })
    registry.register({ name: "outline", priority: 1, load })

    await expect(registry.loadAll(context)).resolves.toMatchObject({ outline: "缓存:原始值" })
    expect(adapter.load).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledOnce()
  })

  it("replaces undefined snapshot payloads with default values", async () => {
    const registry = new DataSourceRegistry()
    const snapshotsSource: DataSource<unknown> = {
      name: "snapshots",
      priority: 1,
      load: async () => undefined,
    }

    registry.register(snapshotsSource)
    const loaded = await registry.loadAll(context)

    expect(loaded.snapshots).toEqual({
      recentSummaries: [],
      previousChapterEnding: "",
      characterStates: "",
      foreshadowingSignals: [],
      timeline: "",
    })
  })

  it("replaces undefined scalar payloads with source defaults", async () => {
    const registry = new DataSourceRegistry()
    registry.register({
      name: "fallbackRecentSummaries",
      priority: 1,
      load: async () => undefined,
    })
    registry.register({
      name: "outline",
      priority: 2,
      load: async () => undefined,
    })

    const loaded = await registry.loadAll(context)

    expect(loaded.fallbackRecentSummaries).toEqual([])
    expect(loaded.outline).toBe("")
  })

  it("records read_failed without fallback_used when the source has no fallback", async () => {
    const adapter = {
      load: vi.fn(async () => {
        throw new Error("磁盘损坏")
      }),
      recordReadFailed: vi.fn(),
      recordFallbackUsed: vi.fn(),
    }
    const registry = new DataSourceRegistry({ loadAdapter: adapter })
    registry.register({
      name: "outline",
      priority: 1,
      load: async () => "不应调用",
    })

    await expect(registry.loadAll(context)).resolves.toMatchObject({ outline: "" })
    expect(adapter.recordReadFailed).toHaveBeenCalledWith("outline")
    expect(adapter.recordFallbackUsed).not.toHaveBeenCalled()
  })

  it("records fallback_used only after a real source.fallback succeeds", async () => {
    const adapter = {
      load: vi.fn(async () => {
        throw new Error("主路径失败")
      }),
      recordReadFailed: vi.fn(),
      recordFallbackUsed: vi.fn(),
    }
    const registry = new DataSourceRegistry({ loadAdapter: adapter })
    registry.register({
      name: "outline",
      priority: 1,
      load: async () => "不应调用",
      fallback: async () => "降级大纲",
    })

    await expect(registry.loadAll(context)).resolves.toMatchObject({ outline: "降级大纲" })
    expect(adapter.recordReadFailed).toHaveBeenCalledWith("outline")
    expect(adapter.recordFallbackUsed).toHaveBeenCalledWith("outline")
  })
})
