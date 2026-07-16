import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  BatchImportBatch,
  BatchImportCandidate,
  BatchImportTask,
} from "@/lib/novel/book-analysis/batch-import-types"

const mocks = vi.hoisted(() => {
  const schedulers: Array<{
    enqueue: ReturnType<typeof vi.fn>
    continueTask: ReturnType<typeof vi.fn>
    regenerateTask: ReturnType<typeof vi.fn>
    cancelTask: ReturnType<typeof vi.fn>
    cancelAllQueued: ReturnType<typeof vi.fn>
    subscribe: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    emit(tasks: BatchImportTask[]): void
  }> = []
  return {
    schedulers,
    loadBatchImportTasks: vi.fn(),
    loadBatchImportBatches: vi.fn(),
    saveBatchImportTask: vi.fn(),
    saveBatchImportBatch: vi.fn(),
    deleteFailedBatchImportTask: vi.fn(),
    cacheTaskSource: vi.fn(),
    loadBookLibrary: vi.fn(),
    findBookLibraryEntryBySha256: vi.fn(),
    renameBookLibraryEntry: vi.fn(),
    fileExists: vi.fn(),
    readFile: vi.fn(),
  }
})

vi.mock("@/lib/novel/book-analysis/batch-import-scheduler", () => ({
  createBatchImportScheduler: vi.fn(() => {
    let listener: ((tasks: BatchImportTask[]) => void) | null = null
    const scheduler = {
      enqueue: vi.fn(),
      continueTask: vi.fn().mockResolvedValue(undefined),
      regenerateTask: vi.fn().mockResolvedValue(undefined),
      cancelTask: vi.fn().mockResolvedValue(undefined),
      cancelAllQueued: vi.fn().mockResolvedValue(undefined),
      syncTerminalTask: vi.fn(),
      forgetTerminalTask: vi.fn(),
      subscribe: vi.fn((nextListener: (tasks: BatchImportTask[]) => void) => {
        listener = nextListener
        nextListener([])
        return vi.fn(() => { listener = null })
      }),
      dispose: vi.fn().mockResolvedValue(undefined),
      emit(tasks: BatchImportTask[]) { listener?.(tasks) },
    }
    mocks.schedulers.push(scheduler)
    return scheduler
  }),
}))

vi.mock("@/lib/novel/book-analysis/batch-import-storage", () => ({
  importTasksRoot: (projectPath: string) => `${projectPath}/book-analysis/import-tasks`,
  loadBatchImportTasks: mocks.loadBatchImportTasks,
  loadBatchImportBatches: mocks.loadBatchImportBatches,
  saveBatchImportTask: mocks.saveBatchImportTask,
  saveBatchImportBatch: mocks.saveBatchImportBatch,
  deleteFailedBatchImportTask: mocks.deleteFailedBatchImportTask,
  cacheTaskSource: mocks.cacheTaskSource,
}))

vi.mock("@/lib/novel/book-analysis/library-store", () => ({
  loadBookLibrary: mocks.loadBookLibrary,
  findBookLibraryEntryBySha256: mocks.findBookLibraryEntryBySha256,
  renameBookLibraryEntry: mocks.renameBookLibraryEntry,
}))

vi.mock("@/commands/fs", () => ({
  fileExists: mocks.fileExists,
  readFile: mocks.readFile,
}))

import { createBookAnalysisImportStore } from "./book-analysis-import-store"

const PROJECT_A = "E:/Novel-A"
const PROJECT_B = "E:/Novel-B"
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("等待异步状态超时")
}

function makeTask(id: string, overrides: Partial<BatchImportTask> = {}): BatchImportTask {
  return {
    version: 1,
    id,
    batchId: "batch-1",
    projectPath: PROJECT_A,
    originalPath: `E:/Sources/${id}.txt`,
    originalFileName: `${id}.txt`,
    cachedSourcePath: "",
    sourceSha256: null,
    requestedTitle: id,
    finalTitle: null,
    bookId: `book-${id}`,
    status: "interrupted",
    completed: 0,
    total: 0,
    error: null,
    skipReason: null,
    createdAt: 100,
    startedAt: null,
    completedAt: null,
    updatedAt: 100,
    ...overrides,
  }
}

function candidate(fileName: string): BatchImportCandidate {
  return { sourcePath: `E:/Sources/${fileName}`, fileName, fileSize: 10 }
}

function persistedBatch(projectPath: string): BatchImportBatch {
  return { version: 1, id: "old-batch", projectPath, taskIds: ["old-task"], createdAt: 1, updatedAt: 1 }
}

describe("book analysis import store", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.schedulers.length = 0
    mocks.loadBatchImportTasks.mockResolvedValue([])
    mocks.loadBatchImportBatches.mockResolvedValue([])
    mocks.saveBatchImportTask.mockResolvedValue(undefined)
    mocks.saveBatchImportBatch.mockResolvedValue(undefined)
    mocks.deleteFailedBatchImportTask.mockResolvedValue(undefined)
    mocks.loadBookLibrary.mockResolvedValue({ version: 1, entries: [] })
    mocks.findBookLibraryEntryBySha256.mockResolvedValue(undefined)
    mocks.renameBookLibraryEntry.mockImplementation(async (_path: string, bookId: string, title: string) => ({ bookId, title }))
    mocks.fileExists.mockResolvedValue(false)
    mocks.readFile.mockResolvedValue("[]")
    mocks.cacheTaskSource.mockImplementation(async (task: BatchImportTask) => ({
      ...task,
      cachedSourcePath: `${task.projectPath}/cache/${task.id}.txt`,
      sourceSha256: `sha-${task.originalFileName}`,
    }))
  })

  it("切换项目时释放旧调度器和订阅并重置面板手动状态", async () => {
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    store.getState().setPanelCollapsed(true)
    const first = mocks.schedulers[0]
    const unsubscribe = first.subscribe.mock.results[0]?.value

    await store.getState().initializeProject(PROJECT_B)

    expect(first.dispose).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(store.getState().projectPath).toBe(PROJECT_B)
    expect(store.getState().panelTouched).toBe(false)
  })

  it("项目切换会等待旧 scheduler dispose 完成后再创建新 scheduler", async () => {
    const disposeGate = deferred<void>()
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    const first = mocks.schedulers[0]
    first.dispose.mockReturnValue(disposeGate.promise)

    let switched = false
    const switching = store.getState().initializeProject(PROJECT_B).then(() => { switched = true })
    await waitFor(() => first.dispose.mock.calls.length === 1)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(switched).toBe(false)
    expect(mocks.schedulers).toHaveLength(1)
    disposeGate.resolve()
    await switching
    expect(mocks.schedulers).toHaveLength(2)
    expect(store.getState().projectPath).toBe(PROJECT_B)
  })
  it("initializeProject 调用后未 await 时立即动作不触达旧 scheduler", async () => {
    const oldTask = makeTask("old-task")
    mocks.loadBatchImportTasks.mockResolvedValueOnce([oldTask]).mockResolvedValueOnce([])
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    const oldScheduler = mocks.schedulers[0]

    const switching = store.getState().initializeProject(PROJECT_B)
    const continuing = store.getState().continueTask(oldTask.id)
    const regenerating = store.getState().regenerateTask(oldTask.id)
    const cancelling = store.getState().cancelTask(oldTask.id)

    await Promise.all([
      expect(continuing).rejects.toThrow("请先初始化拆书项目"),
      expect(regenerating).rejects.toThrow("请先初始化拆书项目"),
      expect(cancelling).rejects.toThrow("请先初始化拆书项目"),
    ])
    expect(oldScheduler.enqueue).not.toHaveBeenCalled()
    expect(oldScheduler.continueTask).not.toHaveBeenCalled()
    expect(oldScheduler.regenerateTask).not.toHaveBeenCalled()
    expect(oldScheduler.cancelTask).not.toHaveBeenCalled()
    await switching
  })

  it("dispose 调用后未 await 时立即动作不触达旧 scheduler", async () => {
    const oldTask = makeTask("old-task")
    mocks.loadBatchImportTasks.mockResolvedValue([oldTask])
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    const oldScheduler = mocks.schedulers[0]

    const disposing = store.getState().dispose()
    const continuing = store.getState().continueTask(oldTask.id)
    const regenerating = store.getState().regenerateTask(oldTask.id)
    const cancelling = store.getState().cancelTask(oldTask.id)

    await Promise.all([
      expect(continuing).rejects.toThrow("请先初始化拆书项目"),
      expect(regenerating).rejects.toThrow("请先初始化拆书项目"),
      expect(cancelling).rejects.toThrow("请先初始化拆书项目"),
    ])
    expect(oldScheduler.enqueue).not.toHaveBeenCalled()
    expect(oldScheduler.continueTask).not.toHaveBeenCalled()
    expect(oldScheduler.regenerateTask).not.toHaveBeenCalled()
    expect(oldScheduler.cancelTask).not.toHaveBeenCalled()
    await disposing
  })
  it("初始化加载任务与批次但不自动入队任何持久 queued 或 interrupted 任务", async () => {
    const tasks = [
      makeTask("queued-old", { status: "queued" }),
      makeTask("interrupted-old", { status: "interrupted" }),
    ]
    mocks.loadBatchImportTasks.mockResolvedValue(tasks)
    mocks.loadBatchImportBatches.mockResolvedValue([persistedBatch(PROJECT_A)])
    const store = createBookAnalysisImportStore()

    await store.getState().initializeProject(PROJECT_A)

    expect(store.getState().tasks.map((task) => task.id)).toEqual(["queued-old", "interrupted-old"])
    expect(store.getState().batches).toHaveLength(1)
    expect(mocks.schedulers[0].enqueue).not.toHaveBeenCalled()
  })

  it("创建批次按完整 SHA 查重，并为已有作品名与本批同名作品连续编号", async () => {
    mocks.loadBookLibrary.mockResolvedValue({
      version: 1,
      entries: [{ title: "长夜", contentSha256: "library-sha" }],
    })
    mocks.cacheTaskSource
      .mockImplementationOnce(async (task: BatchImportTask) => ({ ...task, sourceSha256: "library-sha", cachedSourcePath: "cache/1" }))
      .mockImplementationOnce(async (task: BatchImportTask) => ({ ...task, sourceSha256: "new-sha", cachedSourcePath: "cache/2" }))
      .mockImplementationOnce(async (task: BatchImportTask) => ({ ...task, sourceSha256: "new-sha", cachedSourcePath: "cache/3" }))
    mocks.findBookLibraryEntryBySha256.mockImplementation(async (_path: string, sha: string) => (
      sha === "library-sha" ? { title: "长夜" } : undefined
    ))
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)

    await store.getState().createBatch([candidate("长夜.txt"), candidate("长夜.txt"), candidate("长夜.txt")])

    const tasks = store.getState().tasks
    expect(tasks.map((task) => task.status)).toEqual(["skipped", "queued", "skipped"])
    expect(tasks[0].skipReason).toContain("相同内容")
    expect(tasks[1].finalTitle).toBe("长夜（2）")
    expect(tasks[2].skipReason).toContain("本批次")
    expect(tasks.every((task) => /^[A-Za-z0-9_-]+$/.test(task.id))).toBe(true)
    expect(store.getState().batches[0].taskIds).toEqual(tasks.map((task) => task.id))
    expect(mocks.schedulers[0].enqueue).toHaveBeenCalledWith([tasks[1]])
  })

  it("单文件缓存失败只标记该任务失败并继续处理其他文件", async () => {
    mocks.cacheTaskSource
      .mockRejectedValueOnce(new Error("磁盘不可读"))
      .mockImplementationOnce(async (task: BatchImportTask) => ({ ...task, sourceSha256: "ok-sha", cachedSourcePath: "cache/ok" }))
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)

    await store.getState().createBatch([candidate("坏文件.txt"), candidate("好文件.txt")])

    expect(store.getState().tasks.map((task) => task.status)).toEqual(["failed", "queued"])
    expect(store.getState().tasks[0].error).toContain("缓存源文件失败")
    expect(mocks.schedulers[0].enqueue).toHaveBeenCalledWith([store.getState().tasks[1]])
  })

  it("有待处理任务时默认展开，用户手动折叠后普通进度更新不覆盖", async () => {
    mocks.loadBatchImportTasks.mockResolvedValue([makeTask("failed", { status: "failed" })])
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    expect(store.getState().panelCollapsed).toBe(false)

    store.getState().setPanelCollapsed(true)
    mocks.schedulers[0].emit([makeTask("running", { status: "splitting" })])

    expect(store.getState().panelCollapsed).toBe(true)
    expect(store.getState().panelTouched).toBe(true)
  })

  it("显式操作持久任务时才注册到调度器，并可取消未自动恢复的 queued", async () => {
    const queued = makeTask("queued-old", { status: "queued", batchId: "batch-old" })
    const failed = makeTask("failed-old", { status: "failed" })
    mocks.loadBatchImportTasks.mockResolvedValue([queued, failed])
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    const scheduler = mocks.schedulers[0]

    await store.getState().cancelTask(queued.id)
    expect(store.getState().tasks.find((task) => task.id === queued.id)?.status).toBe("cancelled")
    expect(mocks.saveBatchImportTask).toHaveBeenCalledWith(expect.objectContaining({
      id: queued.id,
      status: "cancelled",
    }))
    expect(scheduler.cancelTask).toHaveBeenCalledWith(queued.id)

    await store.getState().regenerateTask(failed.id)
    expect(scheduler.enqueue).toHaveBeenCalledWith([failed])
    expect(scheduler.regenerateTask).toHaveBeenCalledWith(failed.id)
  })
  it("动作委托给当前项目调度器，完成任务时递增 revision 并支持释放", async () => {
    const onRevision = vi.fn()
    const store = createBookAnalysisImportStore({ onRevision })
    await store.getState().initializeProject(PROJECT_A)
    const scheduler = mocks.schedulers[0]

    await store.getState().continueTask("task-1")
    await store.getState().regenerateTask("task-2")
    await store.getState().cancelTask("task-3")
    await store.getState().cancelAllQueued("batch-9")
    scheduler.emit([makeTask("done", { status: "completed" })])

    expect(scheduler.continueTask).toHaveBeenCalledWith("task-1")
    expect(scheduler.regenerateTask).toHaveBeenCalledWith("task-2")
    expect(scheduler.cancelTask).toHaveBeenCalledWith("task-3")
    expect(scheduler.cancelAllQueued).toHaveBeenCalledWith("batch-9")
    expect(store.getState().revision).toBe(1)
    expect(onRevision).toHaveBeenCalledOnce()

    await store.getState().dispose()
    expect(scheduler.dispose).toHaveBeenCalledOnce()
    expect(store.getState().projectPath).toBeNull()
  })
  it("延迟初始化旧项目不会覆盖后初始化的新项目", async () => {
    const gate = deferred<BatchImportTask[]>()
    mocks.loadBatchImportTasks.mockImplementation((path: string) => (
      path === PROJECT_A ? gate.promise : Promise.resolve([makeTask("project-b", { projectPath: PROJECT_B })])
    ))
    const store = createBookAnalysisImportStore()
    const first = store.getState().initializeProject(PROJECT_A)
    await store.getState().initializeProject(PROJECT_B)
    gate.resolve([makeTask("project-a")])
    await first

    expect(store.getState().projectPath).toBe(PROJECT_B)
    expect(store.getState().tasks.map((task) => task.id)).toEqual(["project-b"])
    expect(mocks.schedulers).toHaveLength(1)
  })

  it("createBatch 缓存期间切项目会把当前 copying 落盘为 interrupted 且不入队", async () => {
    const gate = deferred<BatchImportTask>()
    mocks.cacheTaskSource.mockImplementationOnce(() => gate.promise)
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    const oldScheduler = mocks.schedulers[0]
    const creating = store.getState().createBatch([candidate("长夜.txt"), candidate("星河.txt")])
    await waitFor(() => mocks.cacheTaskSource.mock.calls.length === 1)

    await store.getState().initializeProject(PROJECT_B)
    const copying = mocks.cacheTaskSource.mock.calls[0][0] as BatchImportTask
    gate.resolve({ ...copying, cachedSourcePath: "cache/source", sourceSha256: "sha" })
    await creating

    expect(mocks.saveBatchImportTask).toHaveBeenCalledWith(expect.objectContaining({
      id: copying.id,
      status: "interrupted",
      error: expect.stringContaining("项目已切换"),
    }))
    expect(oldScheduler.enqueue).not.toHaveBeenCalled()
  })

  it("取消等待期间切项目不会把旧项目结果写入新项目内存", async () => {
    const oldTask = makeTask("same-id", { status: "queued" })
    const newTask = makeTask("same-id", { projectPath: PROJECT_B, status: "queued" })
    mocks.loadBatchImportTasks.mockImplementation((path: string) => Promise.resolve(path === PROJECT_A ? [oldTask] : [newTask]))
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    const gate = deferred<void>()
    mocks.schedulers[0].cancelTask.mockReturnValueOnce(gate.promise)
    const cancelling = store.getState().cancelTask(oldTask.id)
    await waitFor(() => mocks.schedulers[0].cancelTask.mock.calls.length === 1)

    await store.getState().initializeProject(PROJECT_B)
    gate.resolve()
    await cancelling

    expect(store.getState().tasks[0]).toMatchObject({ projectPath: PROJECT_B, status: "queued" })
  })

  it("completed 任务 regenerate 后再次 completed 会再次递增 revision", async () => {
    const completed = makeTask("again", { status: "completed" })
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    const scheduler = mocks.schedulers[0]
    scheduler.emit([completed])
    expect(store.getState().revision).toBe(1)

    await store.getState().regenerateTask(completed.id)
    scheduler.emit([{ ...completed, status: "splitting" }])
    scheduler.emit([completed])
    expect(store.getState().revision).toBe(2)
  })

  it("批次先保存，任务先保存 queued 再保存 copying，之后才缓存源文件", async () => {
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    await store.getState().createBatch([candidate("顺序.txt")])

    const batchOrder = mocks.saveBatchImportBatch.mock.invocationCallOrder[0]
    const queuedCall = mocks.saveBatchImportTask.mock.calls.findIndex(([task]) => task.status === "queued")
    const copyingCall = mocks.saveBatchImportTask.mock.calls.findIndex(([task]) => task.status === "copying")
    expect(batchOrder).toBeLessThan(mocks.saveBatchImportTask.mock.invocationCallOrder[queuedCall])
    expect(mocks.saveBatchImportTask.mock.invocationCallOrder[queuedCall]).toBeLessThan(
      mocks.saveBatchImportTask.mock.invocationCallOrder[copyingCall],
    )
    expect(mocks.saveBatchImportTask.mock.invocationCallOrder[copyingCall]).toBeLessThan(
      mocks.cacheTaskSource.mock.invocationCallOrder[0],
    )
  })

  it("interrupted 任务仅在显式 continue 时注册并继续", async () => {
    const interrupted = makeTask("resume", { status: "interrupted" })
    mocks.loadBatchImportTasks.mockResolvedValue([interrupted])
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    const scheduler = mocks.schedulers[0]
    expect(scheduler.enqueue).not.toHaveBeenCalled()

    await store.getState().continueTask(interrupted.id)
    expect(scheduler.enqueue).toHaveBeenCalledWith([interrupted])
    expect(scheduler.continueTask).toHaveBeenCalledWith(interrupted.id)
  })

  it("持久 queued 批次 cancelAll 会逐项持久化取消并委托调度器", async () => {
    const first = makeTask("queued-1", { status: "queued", batchId: "batch-old" })
    const second = makeTask("queued-2", { status: "queued", batchId: "batch-old" })
    mocks.loadBatchImportTasks.mockResolvedValue([first, second])
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)

    await store.getState().cancelAllQueued("batch-old")

    expect(store.getState().tasks.map((task) => task.status)).toEqual(["cancelled", "cancelled"])
    expect(mocks.schedulers[0].cancelAllQueued).toHaveBeenCalledWith("batch-old")
  })

  it("并发创建的跨批次同名作品按 store 队列串行保留名称", async () => {
    let hashIndex = 0
    mocks.cacheTaskSource.mockImplementation(async (task: BatchImportTask) => ({
      ...task,
      cachedSourcePath: `cache/${task.id}`,
      sourceSha256: `sha-${++hashIndex}`,
    }))
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)

    await Promise.all([
      store.getState().createBatch([candidate("长夜.txt")]),
      store.getState().createBatch([candidate("长夜.txt")]),
    ])

    expect(store.getState().tasks.map((task) => task.finalTitle)).toEqual(["长夜", "长夜（2）"])
  })
  it("切换项目后 cacheTaskSource reject 会保存 interrupted 而不是 failed", async () => {
    const gate = deferred<never>()
    mocks.cacheTaskSource.mockImplementationOnce(() => gate.promise)
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    const oldScheduler = mocks.schedulers[0]
    const creating = store.getState().createBatch([candidate("缓存失败.txt"), candidate("不应继续.txt")])
    await waitFor(() => mocks.cacheTaskSource.mock.calls.length === 1)
    const copying = mocks.cacheTaskSource.mock.calls[0][0] as BatchImportTask

    await store.getState().initializeProject(PROJECT_B)
    gate.resolve(Promise.reject(new Error("旧项目缓存失败")) as never)
    await creating

    const savedStates = mocks.saveBatchImportTask.mock.calls
      .map(([task]) => task as BatchImportTask)
      .filter((task) => task.id === copying.id)
    expect(savedStates.at(-1)).toMatchObject({
      status: "interrupted",
      error: expect.stringContaining("项目已切换"),
    })
    expect(savedStates.some((task) => task.status === "failed")).toBe(false)
    expect(mocks.cacheTaskSource).toHaveBeenCalledTimes(1)
    expect(oldScheduler.enqueue).not.toHaveBeenCalled()
    expect(store.getState().projectPath).toBe(PROJECT_B)
  })

  it("切换项目后查重 reject 会保存 interrupted 而不是 failed", async () => {
    const gate = deferred<never>()
    mocks.findBookLibraryEntryBySha256.mockImplementationOnce(() => gate.promise)
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    const oldScheduler = mocks.schedulers[0]
    const creating = store.getState().createBatch([candidate("查重失败.txt"), candidate("不应继续.txt")])
    await waitFor(() => mocks.findBookLibraryEntryBySha256.mock.calls.length === 1)
    const copying = mocks.cacheTaskSource.mock.calls[0][0] as BatchImportTask

    await store.getState().initializeProject(PROJECT_B)
    gate.resolve(Promise.reject(new Error("旧项目查重失败")) as never)
    await creating

    const savedStates = mocks.saveBatchImportTask.mock.calls
      .map(([task]) => task as BatchImportTask)
      .filter((task) => task.id === copying.id)
    expect(savedStates.at(-1)).toMatchObject({
      status: "interrupted",
      error: expect.stringContaining("项目已切换"),
    })
    expect(savedStates.some((task) => task.status === "failed")).toBe(false)
    expect(mocks.cacheTaskSource).toHaveBeenCalledTimes(1)
    expect(oldScheduler.enqueue).not.toHaveBeenCalled()
    expect(store.getState().projectPath).toBe(PROJECT_B)
  })
  it("failed 状态保存阻塞期间切换项目会以 interrupted 收尾且不继续旧批次", async () => {
    const failedSaveGate = deferred<void>()
    mocks.findBookLibraryEntryBySha256.mockRejectedValueOnce(new Error("当前项目查重失败"))
    mocks.saveBatchImportTask.mockImplementation((task: BatchImportTask) => (
      task.status === "failed" ? failedSaveGate.promise : Promise.resolve()
    ))
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    const oldScheduler = mocks.schedulers[0]

    const creating = store.getState().createBatch([candidate("查重失败.txt"), candidate("不应继续.txt")])
    await waitFor(() => mocks.saveBatchImportTask.mock.calls.some(([task]) => task.status === "failed"))
    const failedTask = mocks.saveBatchImportTask.mock.calls.find(([task]) => task.status === "failed")?.[0] as BatchImportTask
    const switching = store.getState().initializeProject(PROJECT_B)
    await switching
    failedSaveGate.resolve()
    await creating

    const savedStates = mocks.saveBatchImportTask.mock.calls
      .map(([task]) => task as BatchImportTask)
      .filter((task) => task.id === failedTask.id)
    expect(savedStates.at(-1)).toMatchObject({
      status: "interrupted",
      error: expect.stringContaining("项目已切换"),
    })
    expect(oldScheduler.enqueue).not.toHaveBeenCalled()
    expect(mocks.cacheTaskSource).toHaveBeenCalledTimes(1)
    expect(store.getState().projectPath).toBe(PROJECT_B)
  })
  it("cancelAllQueued 保存阻塞期间拒绝 continue 和 regenerate 启动同任务", async () => {
    const queued = makeTask("queued-race", { status: "queued", batchId: "batch-race" })
    const saveGate = deferred<void>()
    mocks.loadBatchImportTasks.mockResolvedValue([queued])
    mocks.saveBatchImportTask.mockImplementation((task: BatchImportTask) => (
      task.id === queued.id && task.status === "cancelled" ? saveGate.promise : Promise.resolve()
    ))
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    const scheduler = mocks.schedulers[0]

    const cancellingAll = store.getState().cancelAllQueued(queued.batchId)
    await waitFor(() => mocks.saveBatchImportTask.mock.calls.some(([task]) => task.id === queued.id && task.status === "cancelled"))
    const continuing = store.getState().continueTask(queued.id)
    const regenerating = store.getState().regenerateTask(queued.id)

    await Promise.all([
      expect(continuing).rejects.toThrow("任务正在取消"),
      expect(regenerating).rejects.toThrow("任务正在取消"),
    ])
    expect(scheduler.enqueue).not.toHaveBeenCalled()
    expect(scheduler.continueTask).not.toHaveBeenCalled()
    expect(scheduler.regenerateTask).not.toHaveBeenCalled()
    saveGate.resolve()
    await cancellingAll
    expect(store.getState().tasks[0].status).toBe("cancelled")
  })

  it("批次保存阻塞期间切换项目后只持久化 interrupted 且不处理旧任务", async () => {
    const batchGate = deferred<void>()
    mocks.saveBatchImportBatch.mockReturnValueOnce(batchGate.promise).mockResolvedValue(undefined)
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    const oldScheduler = mocks.schedulers[0]

    const creating = store.getState().createBatch([candidate("旧一.txt"), candidate("旧二.txt")])
    await waitFor(() => mocks.saveBatchImportBatch.mock.calls.length === 1)
    const switching = store.getState().initializeProject(PROJECT_B)
    batchGate.resolve()
    await Promise.all([creating, switching])

    const oldTaskSaves = mocks.saveBatchImportTask.mock.calls
      .map(([task]) => task as BatchImportTask)
      .filter((task) => task.projectPath === PROJECT_A)
    expect(oldTaskSaves).toHaveLength(2)
    expect(oldTaskSaves.every((task) => task.status === "interrupted")).toBe(true)
    expect(mocks.cacheTaskSource).not.toHaveBeenCalled()
    expect(oldScheduler.enqueue).not.toHaveBeenCalled()
  })

  it("copying 状态保存失败仅隔离当前文件并继续下一文件", async () => {
    mocks.saveBatchImportTask.mockImplementation((task: BatchImportTask) => (
      task.originalFileName === "坏复制.txt" && task.status === "copying"
        ? Promise.reject(new Error("copying 写盘失败"))
        : Promise.resolve()
    ))
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)

    await store.getState().createBatch([candidate("坏复制.txt"), candidate("好复制.txt")])

    expect(store.getState().tasks.map((task) => task.status)).toEqual(["failed", "queued"])
    expect(mocks.cacheTaskSource).toHaveBeenCalledTimes(1)
    expect((mocks.cacheTaskSource.mock.calls[0][0] as BatchImportTask).originalFileName).toBe("好复制.txt")
    expect(mocks.schedulers[0].enqueue).toHaveBeenCalledWith([store.getState().tasks[1]])
  })

  it("初始 queued 与 fallback failed 都保存失败时从批次和内存排除缺失任务", async () => {
    mocks.saveBatchImportTask.mockImplementation((task: BatchImportTask) => (
      task.originalFileName === "双写失败.txt" && (task.status === "queued" || task.status === "failed")
        ? Promise.reject(new Error("任务双写失败"))
        : Promise.resolve()
    ))
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)

    await store.getState().createBatch([candidate("双写失败.txt"), candidate("正常.txt")])

    expect(store.getState().tasks.map((task) => task.originalFileName)).toEqual(["正常.txt"])
    expect(store.getState().batches[0].taskIds).toEqual([store.getState().tasks[0].id])
    expect(mocks.saveBatchImportBatch).toHaveBeenCalledTimes(2)
    expect((mocks.saveBatchImportBatch.mock.calls[1][0] as BatchImportBatch).taskIds).toEqual([store.getState().tasks[0].id])
  })
  it("当前项目查重错误仍标记 failed 且继续处理下一任务", async () => {
    mocks.findBookLibraryEntryBySha256
      .mockRejectedValueOnce(new Error("当前项目查重失败"))
      .mockResolvedValueOnce(undefined)
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)

    await store.getState().createBatch([candidate("失败.txt"), candidate("继续.txt")])

    expect(store.getState().tasks.map((task) => task.status)).toEqual(["failed", "queued"])
    expect(store.getState().tasks[0].error).toContain("缓存源文件失败")
    expect(mocks.schedulers[0].enqueue).toHaveBeenCalledWith([store.getState().tasks[1]])
  })

  it("删除失败任务后同步清理内存批次并让调度器忘记任务", async () => {
    const failed = makeTask("failed-task", { status: "failed", error: "导入失败", completedAt: 200 })
    const batch = { ...persistedBatch(PROJECT_A), id: failed.batchId, taskIds: [failed.id] }
    mocks.loadBatchImportTasks.mockResolvedValue([failed])
    mocks.loadBatchImportBatches.mockResolvedValue([batch])
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)

    await store.getState().deleteFailedTask(failed.id)

    expect(mocks.deleteFailedBatchImportTask).toHaveBeenCalledWith(PROJECT_A, failed.id)
    expect(mocks.schedulers[0].forgetTerminalTask).toHaveBeenCalledWith(failed.id)
    expect(store.getState().tasks).toEqual([])
    expect(store.getState().batches).toEqual([])
  })

  it("重命名已完成任务时同步作品名称、任务记录并增加 revision", async () => {
    const completed = makeTask("completed-task", {
      status: "completed",
      finalTitle: "旧名字",
      completedAt: 200,
    })
    mocks.loadBatchImportTasks.mockResolvedValue([completed])
    const onRevision = vi.fn()
    const store = createBookAnalysisImportStore({ onRevision })
    await store.getState().initializeProject(PROJECT_A)

    await store.getState().renameCompletedTask(completed.id, "  新名字  ")

    expect(mocks.renameBookLibraryEntry).toHaveBeenCalledWith(PROJECT_A, completed.bookId, "新名字")
    expect(mocks.saveBatchImportTask).toHaveBeenCalledWith(expect.objectContaining({
      id: completed.id,
      finalTitle: "新名字",
    }))
    expect(mocks.schedulers[0].syncTerminalTask).toHaveBeenCalledWith(expect.objectContaining({ finalTitle: "新名字" }))
    expect(store.getState().tasks[0].finalTitle).toBe("新名字")
    expect(store.getState().revision).toBe(1)
    expect(onRevision).toHaveBeenCalledOnce()
  })

  it("任务记录重命名保存失败时回滚作品名称", async () => {
    const completed = makeTask("completed-task", {
      status: "completed",
      finalTitle: "旧名字",
      completedAt: 200,
    })
    mocks.loadBatchImportTasks.mockResolvedValue([completed])
    const store = createBookAnalysisImportStore()
    await store.getState().initializeProject(PROJECT_A)
    mocks.saveBatchImportTask.mockRejectedValueOnce(new Error("任务保存失败"))

    await expect(store.getState().renameCompletedTask(completed.id, "新名字")).rejects.toThrow("任务保存失败")

    expect(mocks.renameBookLibraryEntry.mock.calls.map(([, , title]) => title)).toEqual(["新名字", "旧名字"])
    expect(store.getState().tasks[0].finalTitle).toBe("旧名字")
  })
})
