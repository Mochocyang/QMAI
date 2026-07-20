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
