import { describe, expect, it, vi } from "vitest"

const recoveryGate = vi.hoisted(() => {
  let resolve: ((value: { tasks: never[]; chunks: never[] }) => void) | null = null
  const promise = new Promise<{ tasks: never[]; chunks: never[] }>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve: (value: { tasks: never[]; chunks: never[] }) => resolve?.(value) }
})

vi.mock("@/lib/novel/book-analysis/analysis-pipeline-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/novel/book-analysis/analysis-pipeline-storage")>()
  return {
    ...actual,
    loadAndRecoverAnalysisTasks: vi.fn(() => recoveryGate.promise),
    saveAnalysisTask: vi.fn(async () => undefined),
    saveAnalysisChunk: vi.fn(async () => undefined),
    replaceAnalysisTaskChunks: vi.fn(async () => undefined),
  }
})

vi.mock("@/lib/novel/book-analysis/analysis-scheduler", () => ({
  createAnalysisScheduler: vi.fn(() => {
    let currentSnapshot: { tasks: never[]; chunks: never[] } = { tasks: [], chunks: [] }
    return {
      initialize: vi.fn((tasks: never[], chunks: never[]) => {
        currentSnapshot = { tasks, chunks }
      }),
      subscribe: vi.fn((listener: (snapshot: { tasks: never[]; chunks: never[] }) => void) => {
        listener(currentSnapshot)
        return () => undefined
      }),
      dispose: vi.fn(async () => undefined),
      registerTask: vi.fn(async () => undefined),
      enqueue: vi.fn(async () => undefined),
      pauseTask: vi.fn(async () => undefined),
      continueTask: vi.fn(async () => undefined),
      retryFailedChunk: vi.fn(async () => undefined),
      cancelTask: vi.fn(async () => undefined),
      getSnapshot: vi.fn(() => currentSnapshot),
      whenIdle: vi.fn(async () => undefined),
    }
  }),
}))

vi.mock("@/lib/novel/book-analysis/analysis-engine", () => ({
  loadChapterList: vi.fn(async () => []),
  loadMetadata: vi.fn(async () => null),
}))

describe("book-analysis-pipeline-store 初始化竞态", () => {
  it("恢复任务完成时不会覆盖初始化期间刚创建的角色分析任务", async () => {
    const { createBookAnalysisPipelineStore } = await import("./book-analysis-pipeline-store")
    const store = createBookAnalysisPipelineStore()
    const initializing = store.getState().initializeProject("E:/Novel")

    await vi.waitFor(() => expect(store.getState().projectPath).toBe("E:/Novel"))
    const task = await store.getState().createAwaitingRangeTask({
      bookId: "book-1",
      bookPath: "E:/Novel/book-analysis/book-1",
      selectedSkills: ["characters"],
      forceNew: true,
    })
    expect(task).not.toBeNull()

    recoveryGate.resolve({ tasks: [], chunks: [] })
    await initializing

    expect(store.getState().tasks.some((item) => item.id === task?.id)).toBe(true)
  })
})

vi.mock("@/lib/has-usable-llm", () => ({
  hasUsableLlm: vi.fn(() => true),
}))

async function refreshStore() {
  recoveryGate.resolve({ tasks: [], chunks: [] })
  const { loadChapterList } = await import("@/lib/novel/book-analysis/analysis-engine")
  vi.mocked(loadChapterList).mockResolvedValue([
    { chapterId: "ch-0001", title: "第一章", order: 1, wordCount: 1000, selected: false, analyzed: false },
  ])
  const { createBookAnalysisPipelineStore } = await import("./book-analysis-pipeline-store")
  const store = createBookAnalysisPipelineStore()
  await store.getState().initializeProject("E:/Novel-cache")
  return store
}

describe("book-analysis-pipeline-store 显式重生成语义", () => {
  it("forceNew 只创建独立任务，普通任务仍允许复用", async () => {
    const store = await refreshStore()
    const input = {
      bookId: "book-cache", bookPath: "E:/Novel-cache/book-analysis/book-cache",
      selectedSkills: ["style" as const], forceNew: true,
    }
    const first = await store.getState().createAwaitingRangeTask(input)
    const second = await store.getState().createAwaitingRangeTask(input)
    expect(first?.id).not.toBe(second?.id)
    expect(first?.forceRefresh).not.toBe(true)
    expect(second?.forceRefresh).not.toBe(true)
  })

  it("显式 forceRefresh 会持久化并随范围配置、启动传给 scheduler", async () => {
    const store = await refreshStore()
    const value = await store.getState().createAwaitingRangeTask({
      bookId: "book-refresh", bookPath: "E:/Novel-cache/book-analysis/book-refresh",
      selectedSkills: ["style"], forceNew: true, forceRefresh: true,
    })
    expect(value?.forceRefresh).toBe(true)
    const { saveAnalysisTask } = await import("@/lib/novel/book-analysis/analysis-pipeline-storage")
    expect(saveAnalysisTask).toHaveBeenLastCalledWith(expect.objectContaining({ id: value!.id, forceRefresh: true }))
    await store.getState().configureTaskRange(value!.id, { startOrder: 1, endOrder: 1 })
    expect(store.getState().tasks[0].forceRefresh).toBe(true)
    await store.getState().startTask(value!.id)
    const { createAnalysisScheduler } = await import("@/lib/novel/book-analysis/analysis-scheduler")
    const scheduler = vi.mocked(createAnalysisScheduler).mock.results.at(-1)!.value
    expect(scheduler.enqueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: value!.id, forceRefresh: true }),
      expect.arrayContaining([expect.objectContaining({ taskId: value!.id })]),
    )
    await store.getState().continueTask(value!.id)
    await store.getState().retryFailedChunk(value!.id, "style", "chunk-1")
    expect(scheduler.continueTask).toHaveBeenCalledWith(value!.id)
    expect(scheduler.retryFailedChunk).toHaveBeenCalledWith(value!.id, "style", "chunk-1")
    expect(store.getState().tasks[0].forceRefresh).toBe(true)
  })

  it("明确重生成不能因已有同书任务而静默返回普通旧任务", async () => {
    const store = await refreshStore()
    const input = {
      bookId: "book-existing", bookPath: "E:/Novel-cache/book-analysis/book-existing",
      selectedSkills: ["story" as const],
    }
    const existing = await store.getState().createAwaitingRangeTask(input)
    const refresh = await store.getState().createAwaitingRangeTask({ ...input, forceRefresh: true })
    expect(refresh?.id).not.toBe(existing?.id)
    expect(refresh?.forceRefresh).toBe(true)
    expect(existing?.forceRefresh).not.toBe(true)
  })
})
