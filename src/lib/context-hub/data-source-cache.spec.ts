import { describe, expect, it, vi } from "vitest"
import type { ContextLoadContext, DataSource } from "@/lib/novel/context-data-source"
import { DataSourceCacheAdapter } from "./data-source-cache"
import type { CachedArtifact, ContextSourceKind } from "./types"

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
  }
  const registry = {
    refresh: vi.fn(async () => ({ versions: {}, changedPaths: [] })),
    getDependencies: vi.fn((kinds?: ContextSourceKind[]) => Object.assign(
      {},
      ...(kinds ?? []).map((kind) => revisions[kind] ?? {}),
    )),
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
    expect(harness.adapter.getStats()).toMatchObject({ hits: 1, refreshed: 1, failures: 0 })
    expect(harness.adapter.getTraceItems()).toEqual([
      expect.objectContaining({
        sourceName: "outline",
        status: "refreshed",
        dependencyPaths: ["E:/Novel/wiki/outlines/main.md"],
      }),
      expect.objectContaining({
        sourceName: "outline",
        status: "hit",
        dependencyPaths: ["E:/Novel/wiki/outlines/main.md"],
      }),
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

  it("does not register empty values as cache hits", async () => {
    const harness = createHarness()
    const source: DataSource<string> = { name: "outline", priority: 1, load: async () => "" }
    const directLoad = vi.fn(async () => "")

    await harness.adapter.load(source, context, directLoad)
    await harness.adapter.load(source, context, directLoad)

    expect(directLoad).toHaveBeenCalledTimes(2)
    expect(harness.storage.writeArtifact).not.toHaveBeenCalled()
  })

  it("returns fresh data when cache writes fail", async () => {
    const harness = createHarness()
    harness.storage.writeArtifact.mockRejectedValue(new Error("磁盘已满"))
    const source: DataSource<string> = { name: "outline", priority: 1, load: async () => "" }

    await expect(harness.adapter.load(source, context, async () => "新大纲")).resolves.toBe("新大纲")
    expect(harness.adapter.getStats().failures).toBe(1)
    expect(harness.adapter.getTraceItems().map((item) => item.status)).toEqual([
      "refreshed",
      "failed",
    ])
  })
})
