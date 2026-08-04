import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/novel/book-analysis/analysis-pipeline-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/novel/book-analysis/analysis-pipeline-storage")>()
  return {
    ...actual,
    loadAndRecoverAnalysisTasks: vi.fn(async () => ({ tasks: [], chunks: [] })),
    saveAnalysisTask: vi.fn(async () => undefined),
    saveAnalysisChunk: vi.fn(async () => undefined),
    replaceAnalysisTaskChunks: vi.fn(async () => undefined),
  }
})

vi.mock("@/lib/novel/book-analysis/analysis-scheduler", () => ({
  createAnalysisScheduler: vi.fn(() => ({
    initialize: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    dispose: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => undefined),
    pauseTask: vi.fn(async () => undefined),
    continueTask: vi.fn(async () => undefined),
    retryFailedChunk: vi.fn(async () => undefined),
    cancelTask: vi.fn(async () => undefined),
    getSnapshot: vi.fn(() => ({ tasks: [], chunks: [], progresses: {} })),
    whenIdle: vi.fn(async () => undefined),
  })),
}))

vi.mock("@/lib/novel/book-analysis/analysis-engine", () => ({
  loadChapterList: vi.fn(async () => [
    { chapterId: "ch-0001", title: "第一章", order: 1, wordCount: 1000, selected: false, analyzed: false },
    { chapterId: "ch-0002", title: "第二章", order: 2, wordCount: 1000, selected: false, analyzed: false },
  ]),
  loadMetadata: vi.fn(async () => null),
}))

vi.mock("@/lib/has-usable-llm", () => ({
  hasUsableLlm: vi.fn(() => true),
}))

describe("book-analysis-pipeline-store 角色选型门闩", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("配置含 characters 的范围后进入 awaiting-character-selection", async () => {
    const { createBookAnalysisPipelineStore } = await import("./book-analysis-pipeline-store")
    const store = createBookAnalysisPipelineStore()
    await store.getState().initializeProject("E:/Novel-character-gate")
    const task = await store.getState().createAwaitingRangeTask({
      bookId: "book-1",
      bookPath: "E:/Novel-character-gate/book-analysis/book-1",
      selectedSkills: ["characters"],
      forceNew: true,
    })
    expect(task).not.toBeNull()

    await store.getState().configureTaskRange(task!.id, { startOrder: 1, endOrder: 2 }, ["characters"])
    const updated = store.getState().tasks.find((item) => item.id === task!.id)
    expect(updated?.status).toBe("awaiting-character-selection")
    expect(updated?.targetCharacters).toBeUndefined()
    expect(updated?.recognizedCharacters).toBeUndefined()
  })

  it("不含 characters 时配置后直接 queued", async () => {
    const { createBookAnalysisPipelineStore } = await import("./book-analysis-pipeline-store")
    const store = createBookAnalysisPipelineStore()
    await store.getState().initializeProject("E:/Novel-style-only")
    const task = await store.getState().createAwaitingRangeTask({
      bookId: "book-2",
      bookPath: "E:/Novel-style-only/book-analysis/book-2",
      selectedSkills: ["style"],
      forceNew: true,
    })
    await store.getState().configureTaskRange(task!.id, { startOrder: 1, endOrder: 2 }, ["style"])
    expect(store.getState().tasks.find((item) => item.id === task!.id)?.status).toBe("queued")
  })

  it("确认角色选型后写入 targetCharacters 并进入 queued", async () => {
    const { createBookAnalysisPipelineStore } = await import("./book-analysis-pipeline-store")
    const store = createBookAnalysisPipelineStore()
    await store.getState().initializeProject("E:/Novel-confirm-chars")
    const task = await store.getState().createAwaitingRangeTask({
      bookId: "book-3",
      bookPath: "E:/Novel-confirm-chars/book-analysis/book-3",
      selectedSkills: ["characters"],
      forceNew: true,
    })
    await store.getState().configureTaskRange(task!.id, { startOrder: 1, endOrder: 2 }, ["characters"])
    await store.getState().setTaskRecognizedCharacters(task!.id, [
      {
        id: "char-1",
        name: "林远",
        aliases: [],
        appearances: 2,
        chapterIndices: [0, 1],
        importanceScore: 90,
        category: "主角",
        sourceBook: "book-3",
      },
      {
        id: "char-2",
        name: "路人",
        aliases: [],
        appearances: 1,
        chapterIndices: [0],
        importanceScore: 10,
        category: "次要",
        sourceBook: "book-3",
      },
    ])

    await store.getState().confirmCharacterSelection(task!.id, ["char-1"])
    const updated = store.getState().tasks.find((item) => item.id === task!.id)
    expect(updated?.status).toBe("queued")
    expect(updated?.targetCharacters).toEqual([
      expect.objectContaining({ id: "char-1", name: "林远" }),
    ])
  })

  it("未选角色时不能 startTask", async () => {
    const { createBookAnalysisPipelineStore } = await import("./book-analysis-pipeline-store")
    const store = createBookAnalysisPipelineStore()
    await store.getState().initializeProject("E:/Novel-block-start")
    const task = await store.getState().createAwaitingRangeTask({
      bookId: "book-4",
      bookPath: "E:/Novel-block-start/book-analysis/book-4",
      selectedSkills: ["characters"],
      forceNew: true,
    })
    await store.getState().configureTaskRange(task!.id, { startOrder: 1, endOrder: 2 }, ["characters"])
    await expect(store.getState().startTask(task!.id)).rejects.toThrow("请先选择要深度分析的角色")
  })

  it("setRuntimeProgress 可写入并清除识别进度", async () => {
    const { createBookAnalysisPipelineStore } = await import("./book-analysis-pipeline-store")
    const store = createBookAnalysisPipelineStore()
    await store.getState().initializeProject("E:/Novel-runtime-progress")
    const key = "task-x:characters:recognition"
    store.getState().setRuntimeProgress(key, {
      stageLabel: "读取章节中",
      percentage: 20,
      currentItem: "第一章",
    })
    expect(store.getState().progresses[key]).toEqual({
      stageLabel: "读取章节中",
      percentage: 20,
      currentItem: "第一章",
    })
    store.getState().setRuntimeProgress(key, null)
    expect(store.getState().progresses[key]).toBeUndefined()
  })
})
