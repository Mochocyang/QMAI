import { describe, expect, it, vi } from "vitest"
import type { ContextLoadContext, DataSource } from "@/lib/novel/context-data-source"
import { DataSourceCacheAdapter } from "./data-source-cache"
import type { CachedArtifact, ContextSourceKind, DependencyStamp } from "./types"

const context: ContextLoadContext = {
  projectPath: "E:/Novel",
  task: "续写第2章",
  chapterNumber: 2,
  config: {
    recentSummaryWindow: 8,
    searchTopK: 5,
    snapshotLookback: 3,
    revisionFeedbackWindowConfig: {},
  },
}

function createHarness() {
  const artifacts = new Map<string, CachedArtifact>()
  const revisions: Partial<Record<ContextSourceKind, Record<string, number>>> = {
    chapter: { "E:/Novel/wiki/chapters/1.md": 1 },
    outline: { "E:/Novel/wiki/outlines/main.md": 1 },
    setting: { "E:/Novel/wiki/settings/world.md": 1 },
    entity: {},
    snapshot: {},
  }
  const registry = {
    refresh: vi.fn(async () => ({ versions: {}, changedPaths: [] })),
    getDependencyStamp: vi.fn(async (kinds?: ContextSourceKind[]): Promise<DependencyStamp> => {
      const dependencies = Object.assign(
        {},
        ...(kinds ?? []).map((kind) => revisions[kind] ?? {}),
      ) as Record<string, number>
      return {
        fingerprint: JSON.stringify(dependencies),
        sourceCount: Object.keys(dependencies).length,
        kinds: [...(kinds ?? [])],
      }
    }),
    getDependencyPreview: vi.fn((kinds?: ContextSourceKind[]) => Object.keys(Object.assign(
      {},
      ...(kinds ?? []).map((kind) => revisions[kind] ?? {}),
    ))),
  }
  const storage = {
    readArtifact: vi.fn(async (key: string) => artifacts.get(key) ?? null),
    writeArtifact: vi.fn(async (key: string, value: CachedArtifact) => { artifacts.set(key, value) }),
  }
  return { adapter: new DataSourceCacheAdapter({ registry, storage }), revisions, registry, storage }
}

describe("DataSourceCacheAdapter", () => {
  it("hits a persisted artifact for an unchanged repeated load", async () => {
    const harness = createHarness()
    const source: DataSource<string> = { name: "outline", priority: 1, load: async () => "" }
    const directLoad = vi.fn(async () => "大纲")

    await expect(harness.adapter.load(source, context, directLoad)).resolves.toBe("大纲")
    await expect(harness.adapter.load(source, context, directLoad)).resolves.toBe("大纲")

    expect(directLoad).toHaveBeenCalledOnce()
    expect(harness.adapter.getStats()).toMatchObject({
      cacheHits: 1,
      reloaded: 1,
      empty: 0,
      writeFailed: 0,
      readFailed: 0,
    })
    // One primary status per key: second load replaces reloaded with cache_hit.
    expect(harness.adapter.getTraceItems()).toEqual([
      expect.objectContaining({
        sourceName: "outline",
        status: "cache_hit",
        dependencyPaths: ["E:/Novel/wiki/outlines/main.md"],
      }),
    ])
  })

  it("marks empty values as empty and does not count them as reloaded", async () => {
    const harness = createHarness()
    const source: DataSource<string> = { name: "outline", priority: 1, load: async () => "" }
    const directLoad = vi.fn(async () => "")

    await harness.adapter.load(source, context, directLoad)
    await harness.adapter.load(source, context, directLoad)

    expect(directLoad).toHaveBeenCalledTimes(2)
    expect(harness.storage.writeArtifact).not.toHaveBeenCalled()
    expect(harness.adapter.getStats()).toMatchObject({
      empty: 2,
      reloaded: 0,
      cacheHits: 0,
    })
    expect(harness.adapter.getTraceItems().map((item) => item.status)).toEqual(["empty"])
  })

  it("records write_failed as the primary status without a second list item", async () => {
    const harness = createHarness()
    harness.storage.writeArtifact.mockRejectedValue(new Error("磁盘已满"))
    const source: DataSource<string> = { name: "outline", priority: 1, load: async () => "" }

    await expect(harness.adapter.load(source, context, async () => "新大纲")).resolves.toBe("新大纲")
    expect(harness.adapter.getStats()).toMatchObject({
      reloaded: 1,
      writeFailed: 1,
    })
    expect(harness.adapter.getTraceItems().map((item) => item.status)).toEqual(["write_failed"])
  })

  it("records read_failed then fallback_used as a single primary outcome", () => {
    const harness = createHarness()
    harness.adapter.recordReadFailed("outline")
    harness.adapter.recordFallbackUsed("outline")
    expect(harness.adapter.getStats()).toMatchObject({
      readFailed: 1,
      fallbackUsed: 1,
    })
    expect(harness.adapter.getTraceItems()).toEqual([
      expect.objectContaining({ sourceName: "outline", status: "fallback_used" }),
    ])
  })

  it("refreshes only an artifact whose dependencies changed", async () => {
    const harness = createHarness()
    const chapterSource: DataSource<string> = { name: "recentChapterContents", priority: 1, load: async () => "" }
    const settingSource: DataSource<string> = { name: "relatedSettings", priority: 1, load: async () => "" }
    const loadChapter = vi.fn(async () => "章节")
    const loadSetting = vi.fn(async () => "设定")
    await harness.adapter.load(chapterSource, context, loadChapter)
    await harness.adapter.load(settingSource, context, loadSetting)
    harness.revisions.chapter!["E:/Novel/wiki/chapters/1.md"] = 2

    await harness.adapter.load(chapterSource, context, loadChapter)
    await harness.adapter.load(settingSource, context, loadSetting)

    expect(loadChapter).toHaveBeenCalledTimes(2)
    expect(loadSetting).toHaveBeenCalledOnce()
  })

  it("deduplicates concurrent rebuilds for the same key", async () => {
    const harness = createHarness()
    const source: DataSource<string> = { name: "outline", priority: 1, load: async () => "" }
    const directLoad = vi.fn(async () => "大纲")

    await Promise.all([
      harness.adapter.load(source, context, directLoad),
      harness.adapter.load(source, context, directLoad),
    ])

    expect(directLoad).toHaveBeenCalledOnce()
  })

  it("uses chapter scope for retrieval and project scope for related settings", async () => {
    const harness = createHarness()
    const retrieval: DataSource<string> = { name: "retrieval", priority: 1, load: async () => "" }
    const relatedSettings: DataSource<string> = { name: "relatedSettings", priority: 1, load: async () => "" }
    const loadRetrieval = vi.fn(async () => "检索索引")
    const loadSettings = vi.fn(async () => "设定")

    await harness.adapter.load(retrieval, context, loadRetrieval)
    await harness.adapter.load(retrieval, { ...context, task: "完全不同的提示词" }, loadRetrieval)
    await harness.adapter.load(relatedSettings, context, loadSettings)
    await harness.adapter.load(relatedSettings, { ...context, task: "另一个任务", chapterNumber: 99 }, loadSettings)

    expect(loadRetrieval).toHaveBeenCalledOnce()
    expect(loadSettings).toHaveBeenCalledOnce()
  })

  it("returns a deeply equal value on a cache hit and a forced rebuild", async () => {
    const harness = createHarness()
    const source: DataSource<{ outline: string; chapters: number[] }> = {
      name: "outline",
      priority: 1,
      load: async () => ({ outline: "", chapters: [] }),
    }
    const expected = { outline: "第一卷", chapters: [1, 2, 3] }
    const directLoad = vi.fn(async () => ({ ...expected, chapters: [...expected.chapters] }))

    const refreshed = await harness.adapter.load(source, context, directLoad)
    const hit = await harness.adapter.load(source, context, directLoad)
    const forcedAdapter = new DataSourceCacheAdapter({
      registry: harness.registry,
      storage: harness.storage,
      forceRefresh: true,
    })
    const forced = await forcedAdapter.load(source, context, directLoad)

    expect(hit).toEqual(refreshed)
    expect(forced).toEqual(refreshed)
  })

  it("invalidates search results when a snapshot or community-summary file is added", async () => {
    const harness = createHarness()
    const source: DataSource<string> = { name: "searchResults", priority: 1, load: async () => "" }
    const directLoad = vi.fn(async () => `结果-${directLoad.mock.calls.length}`)

    await harness.adapter.load(source, context, directLoad)
    await harness.adapter.load(source, context, directLoad)
    harness.revisions.snapshot!["E:/Novel/.novel/community-summaries/new.json"] = 1
    await harness.adapter.load(source, context, directLoad)

    expect(directLoad).toHaveBeenCalledTimes(2)
  })
})
