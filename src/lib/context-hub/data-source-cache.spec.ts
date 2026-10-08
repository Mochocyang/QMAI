import { describe, expect, it, vi } from "vitest"
import { DataSourceRegistry, type ContextLoadContext, type DataSource } from "@/lib/novel/context-data-source"
import { DataSourceCacheAdapter } from "./data-source-cache"
import * as fingerprint from "./fingerprint"
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

function prefixToKinds(prefix: string): ContextSourceKind[] {
  if (prefix.startsWith("wiki/chapters/")) return ["chapter"]
  if (prefix.startsWith("wiki/outlines/")) return ["outline"]
  if (prefix.startsWith("wiki/settings/") || prefix === "wiki/canon.md" || prefix === "wiki/writing-style.md" || prefix === ".qmai/writing-style.json") return ["setting"]
  if (prefix.startsWith("wiki/entities/") || prefix.startsWith("wiki/characters/") || prefix === ".novel/cognition-state.json") return ["entity"]
  if (prefix.startsWith("wiki/memory/") || prefix === ".novel/timeline.json") return ["memory"]
  if (prefix.startsWith(".novel/snapshots/") || prefix.startsWith(".novel/community-summaries/") || prefix === ".novel/revision-feedback.json") return ["snapshot"]
  if (prefix.startsWith("retrieval/")) return ["retrieval"]
  if (prefix === "soul.md" || prefix === "wiki/soul.md") return ["soul"]
  if (prefix.startsWith(".qmai/simulations/")) return ["deduction"]
  return ["other"]
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
    getDependencyStampForPrefixes: vi.fn(async (prefixes: string[]): Promise<DependencyStamp> => {
      const kinds = [...new Set(prefixes.flatMap((prefix) => prefixToKinds(prefix)))]
      const dependencies = Object.assign(
        {},
        ...kinds.map((kind) => revisions[kind] ?? {}),
      ) as Record<string, number>
      return {
        fingerprint: JSON.stringify(dependencies),
        sourceCount: Object.keys(dependencies).length,
        kinds,
      }
    }),
  }
  const storage = {
    readArtifact: vi.fn(async (key: string) => artifacts.get(key) ?? null),
    writeArtifact: vi.fn(async (key: string, value: CachedArtifact) => { artifacts.set(key, value) }),
  }
  // 生产的 DataSourceCacheStorage 声明的是泛型方法（readArtifact<T>/writeArtifact<T>），
  // 而 vi.fn 返回的 Mock<T> 会把签名擦除成 Parameters/ReturnType，结构上无法满足泛型契约。
  // 所以这里给适配器一个与契约同形的泛型视图，调用依旧记录在上面的 spy 上。
  // 所有类型共用同一个异构 Map，读取时无法静态还原值类型，因此只有这一处收窄，
  // 与生产 storage.ts 读取 artifact 时的收窄一致。
  const cacheStorage = {
    readArtifact: async <T>(key: string): Promise<CachedArtifact<T> | null> =>
      (await storage.readArtifact(key)) as CachedArtifact<T> | null,
    writeArtifact: async <T>(key: string, value: CachedArtifact<T>): Promise<void> => {
      await storage.writeArtifact(key, value)
    },
  }
  return { adapter: new DataSourceCacheAdapter({ registry, storage: cacheStorage }), revisions, registry, storage, cacheStorage }
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
      cacheableLoaded: 2,
      cacheableHits: 1,
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

  it("uses a versioned key for chapter outlines so stale wrong-chapter artifacts are not reused", async () => {
    const harness = createHarness()
    const source: DataSource<string> = { name: "chapterOutline", priority: 1, load: async () => "" }

    await harness.adapter.load(source, context, async () => "第2章章纲")

    expect(harness.storage.readArtifact).toHaveBeenCalledWith(
      expect.stringMatching(/^data-source:chapterOutline:v3:/),
    )
    expect(harness.storage.writeArtifact).toHaveBeenCalledWith(
      expect.stringMatching(/^data-source:chapterOutline:v3:/),
      expect.objectContaining({ sourceName: "chapterOutline", value: "第2章章纲" }),
    )
  })

  it("ignores v2 outline strings and caches layered outlines with a v3 chapter key", async () => {
    const harness = createHarness()
    const dependencyStamp = await harness.registry.getDependencyStamp(["outline"])
    harness.storage.readArtifact.mockImplementation(async (key) => key.startsWith("data-source:outline:v2:") ? {
      schemaVersion: 2, key, sourceName: "outline", scope: "chapter",
      value: "旧缓存中的原始大纲字符串", dependencyStamp, createdAt: 1,
    } : null)
    const layered = { full: "全书大纲", project: "全书骨架", task: "本章资料" }
    const source: DataSource<typeof layered> = { name: "outline", priority: 1, load: async () => layered }
    const directLoad = vi.fn(() => source.load(context))

    await expect(harness.adapter.load(source, context, directLoad)).resolves.toEqual(layered)
    expect(directLoad).toHaveBeenCalledOnce()
    expect(harness.storage.readArtifact).toHaveBeenCalledWith(expect.stringMatching(/^data-source:outline:v3:/))
    expect(harness.storage.writeArtifact).toHaveBeenCalledWith(
      expect.stringMatching(/^data-source:outline:v3:/),
      expect.objectContaining({ sourceName: "outline", scope: "chapter", value: layered }),
    )
  })

  it("includes task text in section briefing cache keys for on-demand character selection", async () => {
    const harness = createHarness()
    const source: DataSource<string> = { name: "sectionBriefing", priority: 1, load: async () => "" }
    const directLoad = vi.fn(async () => "人物速记")

    await harness.adapter.load(source, context, directLoad)
    await harness.adapter.load(source, { ...context, task: "改由另一个人物处理" }, directLoad)

    expect(directLoad).toHaveBeenCalledTimes(2)
    expect(harness.storage.readArtifact.mock.calls[0]?.[0]).not.toBe(
      harness.storage.readArtifact.mock.calls[1]?.[0],
    )
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
      cacheableLoaded: 2,
      cacheableHits: 0,
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
      cacheableLoaded: 1,
      cacheableHits: 0,
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

  it.each([
    { sourceName: "outline", expected: { cacheableLoaded: 1, cacheableHits: 0, taskScopedLoaded: 0 } },
    { sourceName: "searchResults", expected: { cacheableLoaded: 0, cacheableHits: 0, taskScopedLoaded: 1 } },
  ])("counts one actual pending load for concurrent consumers: $sourceName", async ({ sourceName, expected }) => {
    const harness = createHarness()
    const source: DataSource<string> = { name: sourceName, priority: 1, load: async () => "资料" }
    const directLoad = vi.fn(() => source.load(context))
    let finishRead!: (value: CachedArtifact | null) => void
    const pendingRead = new Promise<CachedArtifact | null>((resolve) => { finishRead = resolve })
    harness.storage.readArtifact.mockImplementation(() => pendingRead)
    // Observe real hashes so every consumer reaches the same pending operation before storage resolves.
    const hashes = vi.spyOn(fingerprint, "sha256Text")
    const loads = Array.from({ length: 4 }, () => harness.adapter.load(source, context, directLoad))
    try {
      await vi.waitFor(() => expect(hashes).toHaveBeenCalledTimes(4))
      await Promise.all(hashes.mock.results.map((result) => result.value))
      finishRead(null)
      await Promise.all(loads)
      expect(directLoad).toHaveBeenCalledOnce()
      expect(harness.adapter.getStats()).toMatchObject(expected)
    } finally {
      finishRead(null)
      hashes.mockRestore()
    }
  })

  it("excludes all four task sources from both counters on a repeated twelve-source request", async () => {
    const harness = createHarness()
    const sources = [
      "canonRules", "writingStyle", "soulDoc", "storyFrameworkBinding",
      "relatedSettings", "fallbackRecentSummaries", "cognitionText", "retrieval",
      "searchResults", "graphSearchResults", "bookAnalysisReferences", "sectionBriefing",
    ].map((name): DataSource<string> => ({ name, priority: 1, load: vi.fn(async () => name) }))
    const coldRegistry = new DataSourceRegistry({ loadAdapter: harness.adapter })
    coldRegistry.registerAll(sources)
    const cold = await coldRegistry.loadAll(context)
    expect(harness.adapter.getStats()).toMatchObject({ cacheableLoaded: 8, cacheableHits: 0 })

    const warmAdapter = new DataSourceCacheAdapter({ registry: harness.registry, storage: harness.cacheStorage })
    const warmRegistry = new DataSourceRegistry({ loadAdapter: warmAdapter })
    warmRegistry.registerAll(sources)
    const warm = await warmRegistry.loadAll(context)

    expect(warm).toEqual(cold)
    expect(warmAdapter.getStats()).toMatchObject({
      cacheHits: 12,
      taskScopedLoaded: 4,
      cacheableLoaded: 8,
      cacheableHits: 8,
    })
    for (const source of sources) expect(source.load).toHaveBeenCalledOnce()
  })

  it("does not multiply source loads when read/fallback and reload/write failures overlap", async () => {
    const harness = createHarness()
    const cachedSource: DataSource<string> = { name: "canonRules", priority: 1, load: async () => "规则" }
    await harness.adapter.load(cachedSource, context, () => cachedSource.load(context))
    const adapter = new DataSourceCacheAdapter({ registry: harness.registry, storage: harness.cacheStorage })
    const sources = new DataSourceRegistry({ loadAdapter: adapter })
    sources.registerAll([
      cachedSource,
      {
        name: "outline", priority: 1,
        load: async () => { throw new Error("读取大纲失败") },
        fallback: async () => "降级大纲",
      },
      { name: "writingStyle", priority: 1, load: async () => "克制" },
    ])
    harness.storage.writeArtifact.mockRejectedValueOnce(new Error("写入缓存失败"))
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await expect(sources.loadAll(context)).resolves.toMatchObject({
        canonRules: "规则", outline: "降级大纲", writingStyle: "克制",
      })
    } finally {
      warning.mockRestore()
    }

    expect(adapter.getStats()).toMatchObject({
      cacheHits: 1, reloaded: 1, readFailed: 1, fallbackUsed: 1, writeFailed: 1,
      cacheableLoaded: 3, cacheableHits: 1,
    })
  })

  it.each([{ value: "" }, { value: [] }, { value: {} }, { value: null }, { value: undefined }])("counts an empty source result once per actual load: $value", async ({ value }) => {
    const harness = createHarness()
    const source: DataSource<unknown> = { name: "relatedSettings", priority: 1, load: async () => value }
    await harness.adapter.load(source, context, () => source.load(context))

    expect(harness.adapter.getStats()).toMatchObject({ empty: 1, cacheableLoaded: 1, cacheableHits: 0 })
    expect(harness.storage.writeArtifact).not.toHaveBeenCalled()
  })

  it.each([{ value: "" }, { value: [] }, { value: {} }, { value: null }])("uses the same scope when an existing artifact has an empty value: $value", async ({ value }) => {
    const harness = createHarness()
    const source: DataSource<unknown> = { name: "relatedSettings", priority: 1, load: async () => "设定" }
    await harness.adapter.load(source, context, () => source.load(context))
    const artifact = harness.storage.writeArtifact.mock.calls[0]![1]
    harness.storage.readArtifact.mockResolvedValue({ ...artifact, value })
    const adapter = new DataSourceCacheAdapter({ registry: harness.registry, storage: harness.cacheStorage })
    const directLoad = vi.fn(async () => "不应重载")

    await expect(adapter.load(source, context, directLoad)).resolves.toEqual(value)
    expect(adapter.getStats()).toMatchObject({ cacheableLoaded: 1, cacheableHits: 1 })
    expect(directLoad).not.toHaveBeenCalled()
  })

  it("uses project scope for retrieval and related settings", async () => {
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

  it("reuses project-scoped static sources across different chapters", async () => {
    const harness = createHarness()
    const source: DataSource<string> = { name: "fallbackRecentSummaries", priority: 1, load: async () => "" }
    const directLoad = vi.fn(async () => "项目级摘要")

    await harness.adapter.load(source, { ...context, chapterNumber: 2 }, directLoad)
    await harness.adapter.load(source, { ...context, chapterNumber: 9 }, directLoad)

    expect(directLoad).toHaveBeenCalledOnce()
    expect(harness.adapter.getStats()).toMatchObject({ cacheHits: 1 })
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
      storage: harness.cacheStorage,
      forceRefresh: true,
    })
    const forced = await forcedAdapter.load(source, context, directLoad)

    expect(hit).toEqual(refreshed)
    expect(forced).toEqual(refreshed)
    expect(forcedAdapter.getStats()).toMatchObject({ cacheableLoaded: 1, cacheableHits: 0 })
  })

  it("counts task-scoped hits separately from cacheable hits", async () => {
    const harness = createHarness()
    const source: DataSource<string> = { name: "searchResults", priority: 1, load: async () => "" }
    const directLoad = vi.fn(async () => "检索结果")

    await harness.adapter.load(source, context, directLoad)
    await harness.adapter.load(source, context, directLoad)

    expect(directLoad).toHaveBeenCalledOnce()
    expect(harness.adapter.getStats()).toMatchObject({
      cacheHits: 1,
      reloaded: 1,
      taskScopedLoaded: 2,
      taskScopedHits: 1,
    })
  })

  it("does not count chapter-scoped hits as task-scoped", async () => {
    const harness = createHarness()
    const source: DataSource<string> = { name: "outline", priority: 1, load: async () => "" }
    const directLoad = vi.fn(async () => "大纲")

    await harness.adapter.load(source, context, directLoad)
    await harness.adapter.load(source, context, directLoad)

    expect(harness.adapter.getStats()).toMatchObject({
      cacheHits: 1,
      reloaded: 1,
      taskScopedLoaded: 0,
      taskScopedHits: 0,
    })
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


describe("缓存读取异常的单次计数", () => {
  it.each([false, true])("缓存读取失败后回源，写入失败=%s 时也不重复计数", async (writeFails) => {
    const harness = createHarness()
    const source: DataSource<string> = { name: "canonRules", priority: 1, load: async () => "最新规则" }
    const directLoad = vi.fn(async () => "最新规则")
    harness.storage.readArtifact.mockRejectedValueOnce(new Error("缓存文件损坏"))
    if (writeFails) harness.storage.writeArtifact.mockRejectedValueOnce(new Error("缓存目录不可写"))
    await expect(harness.adapter.load(source, context, directLoad)).resolves.toBe("最新规则")
    expect(directLoad).toHaveBeenCalledOnce()
    expect(harness.adapter.getStats()).toMatchObject({
      cacheableLoaded: 1,
      cacheableHits: 0,
      reloaded: 1,
      readFailed: 0,
      writeFailed: writeFails ? 1 : 0,
    })
  })
})
