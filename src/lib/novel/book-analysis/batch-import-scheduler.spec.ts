import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BatchImportTask } from "./batch-import-types"

const mocks = vi.hoisted(() => ({
  runBatchImportTask: vi.fn(),
  saveBatchImportTask: vi.fn<(task: BatchImportTask) => Promise<void>>(),
  resetBatchImportTask: vi.fn<(projectPath: string, taskId: string) => Promise<BatchImportTask>>(),
}))

vi.mock("./batch-import-engine", () => ({
  runBatchImportTask: mocks.runBatchImportTask,
}))

vi.mock("./batch-import-storage", () => ({
  saveBatchImportTask: mocks.saveBatchImportTask,
  resetBatchImportTask: mocks.resetBatchImportTask,
}))

import { createBatchImportScheduler } from "./batch-import-scheduler"

const PROJECT_PATH = "E:/Novel"

function makeTask(id: string, overrides: Partial<BatchImportTask> = {}): BatchImportTask {
  return {
    version: 1,
    id,
    batchId: "batch-1",
    projectPath: PROJECT_PATH,
    originalPath: `E:/Sources/${id}.txt`,
    originalFileName: `${id}.txt`,
    cachedSourcePath: `${PROJECT_PATH}/book-analysis/import-tasks/${id}/source.txt`,
    sourceSha256: `sha-${id}`,
    requestedTitle: id,
    finalTitle: null,
    bookId: `book-${id}`,
    status: "queued",
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

function completed(task: BatchImportTask): BatchImportTask {
  return {
    ...task,
    status: "completed",
    completedAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function success(task: BatchImportTask) {
  return {
    task: completed(task),
    metadata: {},
    chapters: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("等待调度器状态更新超时")
}

function latestTasks(scheduler: ReturnType<typeof createBatchImportScheduler>) {
  let tasks: BatchImportTask[] = []
  scheduler.subscribe((nextTasks) => {
    tasks = nextTasks
  })
  return () => tasks
}

describe("createBatchImportScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.saveBatchImportTask.mockResolvedValue(undefined)
  })

  it("默认并发数为两个任务", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<void>>>()
    mocks.runBatchImportTask.mockImplementation(async (task: BatchImportTask) => {
      const gate = deferred<void>()
      gates.set(task.id, gate)
      await gate.promise
      return success(task)
    })
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    scheduler.enqueue([makeTask("task-1"), makeTask("task-2"), makeTask("task-3")])

    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 2)
    expect(mocks.runBatchImportTask.mock.calls.map(([task]) => task.id)).toEqual(["task-1", "task-2"])
    gates.get("task-1")?.resolve()
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 3)
    gates.get("task-2")?.resolve()
    gates.get("task-3")?.resolve()
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "非有限并发值 %s 回退为默认并发 2",
    async (invalidConcurrency) => {
      const gate = deferred<void>()
      mocks.runBatchImportTask.mockImplementation(async (task: BatchImportTask) => {
        await gate.promise
        return success(task)
      })
      const scheduler = createBatchImportScheduler({
        projectPath: PROJECT_PATH,
        concurrency: invalidConcurrency,
      })
      scheduler.enqueue([makeTask("task-1"), makeTask("task-2"), makeTask("task-3")])

      await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 2)
      expect(mocks.runBatchImportTask).toHaveBeenCalledTimes(2)
      gate.resolve()
    },
  )

  it("持久化完成前不通知新状态，完成后通知与持久化一致的状态", async () => {
    const saveGate = deferred<void>()
    const runGate = deferred<ReturnType<typeof success>>()
    mocks.saveBatchImportTask
      .mockReturnValueOnce(saveGate.promise)
      .mockResolvedValue(undefined)
    mocks.runBatchImportTask.mockReturnValue(runGate.promise)
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    const listener = vi.fn()
    scheduler.subscribe(listener)
    scheduler.enqueue([makeTask("task-1")])

    await waitFor(() => mocks.saveBatchImportTask.mock.calls.length === 1)
    const persistedRunningTask = mocks.saveBatchImportTask.mock.calls[0][0]
    expect(persistedRunningTask.status).toBe("splitting")
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0]).toEqual([])
    expect(mocks.runBatchImportTask).not.toHaveBeenCalled()

    saveGate.resolve()
    await waitFor(() => listener.mock.calls.length === 2)
    expect(listener.mock.calls[1][0]).toEqual([persistedRunningTask])
    expect(mocks.runBatchImportTask).toHaveBeenCalledWith(
      persistedRunningTask,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    runGate.resolve(success(persistedRunningTask))
    await waitFor(() => listener.mock.calls.some(([tasks]) => (
      tasks.some((task: BatchImportTask) => task.status === "completed")
    )))
  })

  it("重复 enqueue 同一数组、等待任务和运行任务都只运行一次", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<void>>>()
    mocks.runBatchImportTask.mockImplementation(async (task: BatchImportTask) => {
      const gate = deferred<void>()
      gates.set(task.id, gate)
      await gate.promise
      return success(task)
    })
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH, concurrency: 1 })
    const getTasks = latestTasks(scheduler)
    const task1 = makeTask("task-1")
    const task2 = makeTask("task-2")
    const batch = [task1, task2]

    scheduler.enqueue(batch)
    scheduler.enqueue(batch)
    scheduler.enqueue([task1, task2])
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 1)
    scheduler.enqueue(batch)
    scheduler.enqueue([task1])
    expect(mocks.runBatchImportTask.mock.calls.map(([task]) => task.id)).toEqual(["task-1"])

    gates.get("task-1")?.resolve()
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 2)
    scheduler.enqueue(batch)
    scheduler.enqueue([task2])
    expect(mocks.runBatchImportTask.mock.calls.map(([task]) => task.id)).toEqual(["task-1", "task-2"])
    gates.get("task-2")?.resolve()
    await waitFor(() => getTasks().filter((task) => task.status === "completed").length === 2)
    expect(mocks.runBatchImportTask).toHaveBeenCalledTimes(2)
  })
  it("传入超过上限的并发数时仍最多同时运行两个任务", async () => {
    let active = 0
    let maxActive = 0
    const gates = new Map<string, ReturnType<typeof deferred<void>>>()
    mocks.runBatchImportTask.mockImplementation(async (task: BatchImportTask) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      const gate = deferred<void>()
      gates.set(task.id, gate)
      await gate.promise
      active -= 1
      return success(task)
    })
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH, concurrency: 99 })
    const getTasks = latestTasks(scheduler)
    scheduler.enqueue(Array.from({ length: 5 }, (_, index) => makeTask(`task-${index + 1}`)))

    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 2)
    expect(maxActive).toBe(2)
    gates.get("task-1")?.resolve()
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 3)
    gates.get("task-2")?.resolve()
    gates.get("task-3")?.resolve()
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 5)
    gates.get("task-4")?.resolve()
    gates.get("task-5")?.resolve()
    await waitFor(() => getTasks().every((task) => task.status === "completed"))
    expect(maxActive).toBe(2)
  })

  it("引擎已提交 completed 后不二次持久化且订阅异常不影响内存状态", async () => {
    mocks.saveBatchImportTask.mockImplementation(async (task: BatchImportTask) => {
      if (task.status === "completed") throw new Error("不允许二次保存 completed")
    })
    mocks.runBatchImportTask.mockImplementation(async (task: BatchImportTask) => success(task))
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    const healthySnapshots: BatchImportTask[][] = []
    scheduler.subscribe((tasks) => {
      if (tasks.some((task) => task.status === "completed")) {
        throw new Error("订阅者渲染失败")
      }
    })
    scheduler.subscribe((tasks) => {
      healthySnapshots.push(tasks)
    })
    scheduler.enqueue([makeTask("task-1")])

    await waitFor(() => (
      healthySnapshots.some((tasks) => tasks.some((task) => task.status === "completed"))
      || mocks.saveBatchImportTask.mock.calls.some(([task]) => task.status === "failed")
    ))

    expect(healthySnapshots.at(-1)?.find((task) => task.id === "task-1")?.status).toBe("completed")
    expect(mocks.saveBatchImportTask.mock.calls.map(([task]) => task.status)).toEqual(["splitting"])
    expect(mocks.saveBatchImportTask.mock.calls.some(([task]) => (
      task.status === "completed" || task.status === "failed" || task.status === "cancelled"
    ))).toBe(false)
  })
  it("按 FIFO 顺序启动等待任务", async () => {
    const started: string[] = []
    const gates = new Map<string, ReturnType<typeof deferred<void>>>()
    mocks.runBatchImportTask.mockImplementation(async (task: BatchImportTask) => {
      started.push(task.id)
      const gate = deferred<void>()
      gates.set(task.id, gate)
      await gate.promise
      return success(task)
    })
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    scheduler.enqueue([makeTask("task-1"), makeTask("task-2"), makeTask("task-3"), makeTask("task-4")])

    await waitFor(() => started.length === 2)
    expect(started).toEqual(["task-1", "task-2"])
    gates.get("task-2")?.resolve()
    await waitFor(() => started.length === 3)
    expect(started).toEqual(["task-1", "task-2", "task-3"])
    gates.get("task-1")?.resolve()
    await waitFor(() => started.length === 4)
    expect(started).toEqual(["task-1", "task-2", "task-3", "task-4"])
    gates.get("task-3")?.resolve()
    gates.get("task-4")?.resolve()
  })

  it("单本失败后标记中文错误并继续下一个任务", async () => {
    mocks.runBatchImportTask
      .mockRejectedValueOnce(new Error("章节识别失败"))
      .mockImplementation(async (task: BatchImportTask) => success(task))
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH, concurrency: 1 })
    const getTasks = latestTasks(scheduler)
    scheduler.enqueue([makeTask("task-1"), makeTask("task-2")])

    await waitFor(() => getTasks().find((task) => task.id === "task-2")?.status === "completed")
    expect(mocks.runBatchImportTask).toHaveBeenCalledTimes(2)
    expect(getTasks().find((task) => task.id === "task-1")).toMatchObject({
      status: "failed",
      error: "章节识别失败",
    })
  })

  it("重复点击继续只运行一次", async () => {
    const gate = deferred<void>()
    mocks.runBatchImportTask.mockImplementation(async (task: BatchImportTask) => {
      await gate.promise
      return success(task)
    })
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    scheduler.enqueue([makeTask("task-1", { status: "interrupted" })])

    const first = scheduler.continueTask("task-1")
    const second = scheduler.continueTask("task-1")
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 1)
    expect(mocks.runBatchImportTask).toHaveBeenCalledTimes(1)
    gate.resolve()
    await Promise.all([first, second])
  })

  it("引擎在 Abort 后抛出取消错误时持久化 cancelled", async () => {
    let engineExited = false
    mocks.runBatchImportTask.mockImplementation((_task: BatchImportTask, options: { signal: AbortSignal }) => (
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          engineExited = true
          reject(new Error("用户取消导入"))
        }, { once: true })
      })
    ))
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    const getTasks = latestTasks(scheduler)
    scheduler.enqueue([makeTask("task-1")])
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 1)

    await scheduler.cancelTask("task-1")

    expect(engineExited).toBe(true)
    expect(getTasks().find((task) => task.id === "task-1")?.status).toBe("cancelled")
    const lastSaved = mocks.saveBatchImportTask.mock.calls.at(-1)?.[0]
    expect(lastSaved?.status).toBe("cancelled")
  })

  it("取消单个等待任务后不会运行它", async () => {
    const gate = deferred<void>()
    mocks.runBatchImportTask.mockImplementation(async (task: BatchImportTask) => {
      await gate.promise
      return success(task)
    })
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH, concurrency: 1 })
    const getTasks = latestTasks(scheduler)
    scheduler.enqueue([makeTask("task-1"), makeTask("task-2")])
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 1)

    await scheduler.cancelTask("task-2")
    gate.resolve()
    await waitFor(() => getTasks().find((task) => task.id === "task-1")?.status === "completed")
    expect(mocks.runBatchImportTask.mock.calls.map(([task]) => task.id)).toEqual(["task-1"])
    expect(getTasks().find((task) => task.id === "task-2")?.status).toBe("cancelled")
  })

  it("取消批次等待任务时不 Abort 同批次运行任务", async () => {
    const gate = deferred<void>()
    let runningSignal: AbortSignal | undefined
    mocks.runBatchImportTask.mockImplementation(async (task: BatchImportTask, options: { signal: AbortSignal }) => {
      runningSignal = options.signal
      await gate.promise
      return success(task)
    })
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH, concurrency: 1 })
    const getTasks = latestTasks(scheduler)
    scheduler.enqueue([
      makeTask("running", { batchId: "batch-a" }),
      makeTask("cancel-me", { batchId: "batch-a" }),
      makeTask("keep-me", { batchId: "batch-b" }),
    ])
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 1)

    await scheduler.cancelAllQueued("batch-a")

    expect(runningSignal?.aborted).toBe(false)
    expect(getTasks().find((task) => task.id === "running")?.status).toBe("splitting")
    expect(getTasks().find((task) => task.id === "cancel-me")?.status).toBe("cancelled")
    expect(getTasks().find((task) => task.id === "keep-me")?.status).toBe("queued")
    gate.resolve()
  })

  it("Abort 后引擎 resolve completed 时以引擎提交结果为准", async () => {
    mocks.runBatchImportTask.mockImplementation((task: BatchImportTask, options: { signal: AbortSignal }) => (
      new Promise((resolve) => {
        options.signal.addEventListener("abort", () => resolve(success(task)), { once: true })
      })
    ))
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    const getTasks = latestTasks(scheduler)
    scheduler.enqueue([makeTask("task-1")])
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 1)

    await scheduler.cancelTask("task-1")

    expect(getTasks().find((task) => task.id === "task-1")?.status).toBe("completed")
    expect(mocks.saveBatchImportTask.mock.calls.map(([task]) => task.status)).toEqual(["splitting"])
    expect(mocks.saveBatchImportTask.mock.calls.some(([task]) => (
      task.status === "completed" || task.status === "cancelled" || task.status === "failed"
    ))).toBe(false)
  })

  it("Abort 后引擎 resolve 非 completed 结果时持久化 cancelled", async () => {
    mocks.runBatchImportTask.mockImplementation((task: BatchImportTask, options: { signal: AbortSignal }) => (
      new Promise((resolve) => {
        options.signal.addEventListener("abort", () => resolve({
          ...success(task),
          task: { ...task, status: "splitting" },
        }), { once: true })
      })
    ))
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    const getTasks = latestTasks(scheduler)
    scheduler.enqueue([makeTask("task-1")])
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 1)

    await scheduler.cancelTask("task-1")

    expect(getTasks().find((task) => task.id === "task-1")?.status).toBe("cancelled")
    expect(mocks.saveBatchImportTask.mock.calls.at(-1)?.[0].status).toBe("cancelled")
  })
  it.each(["completed", "skipped", "failed", "cancelled", "splitting", "copying"] as const)(
    "continueTask 仅允许 interrupted，拒绝 %s",
    async (status) => {
      const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
      scheduler.enqueue([makeTask("task-1", { status })])
      await scheduler.continueTask("task-1")
      expect(mocks.saveBatchImportTask).not.toHaveBeenCalled()
      expect(mocks.runBatchImportTask).not.toHaveBeenCalled()
    },
  )

  it.each(["completed", "skipped"] as const)("regenerateTask 拒绝终态 %s", async (status) => {
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    scheduler.enqueue([makeTask("task-1", { status })])
    await scheduler.regenerateTask("task-1")
    expect(mocks.resetBatchImportTask).not.toHaveBeenCalled()
    expect(mocks.saveBatchImportTask).not.toHaveBeenCalled()
    expect(mocks.runBatchImportTask).not.toHaveBeenCalled()
  })

  it("continueTask 持久化 queued 期间取消时保留取消意图且不启动引擎", async () => {
    const queuedSave = deferred<void>()
    mocks.saveBatchImportTask.mockImplementation((task: BatchImportTask) => (
      task.status === "queued" ? queuedSave.promise : Promise.resolve()
    ))
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    const getTasks = latestTasks(scheduler)
    scheduler.enqueue([makeTask("task-1", { status: "interrupted" })])
    const continuing = scheduler.continueTask("task-1")
    await waitFor(() => mocks.saveBatchImportTask.mock.calls.some(([task]) => task.status === "queued"))
    const cancelling = scheduler.cancelTask("task-1")
    queuedSave.resolve()
    await Promise.all([continuing, cancelling])
    expect(getTasks().find((task) => task.id === "task-1")?.status).toBe("cancelled")
    expect(mocks.saveBatchImportTask.mock.calls.at(-1)?.[0].status).toBe("cancelled")
    expect(mocks.runBatchImportTask).not.toHaveBeenCalled()
  })

  it("显式取消的 cancelled 持久化失败会向调用方 reject", async () => {
    const runningGate = deferred<void>()
    mocks.runBatchImportTask.mockImplementationOnce(async (task: BatchImportTask) => {
      await runningGate.promise
      return success(task)
    })
    mocks.saveBatchImportTask.mockImplementation((task: BatchImportTask) => (
      task.id === "task-2" && task.status === "cancelled"
        ? Promise.reject(new Error("取消状态写盘失败"))
        : Promise.resolve()
    ))
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH, concurrency: 1 })
    scheduler.enqueue([makeTask("task-1"), makeTask("task-2")])
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 1)
    await expect(scheduler.cancelTask("task-2")).rejects.toThrow("取消状态写盘失败")
    runningGate.resolve()
  })
  it("await dispose 后 cancelTask 和 cancelAllQueued 不再保存旧项目状态", async () => {
    mocks.runBatchImportTask.mockImplementation((task: BatchImportTask, options: { signal: AbortSignal }) => (
      new Promise((resolve) => options.signal.addEventListener("abort", () => resolve(success(task)), { once: true }))
    ))
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH, concurrency: 1 })
    scheduler.enqueue([makeTask("task-1"), makeTask("task-2")])
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 1)
    await scheduler.dispose()
    const savesBeforeCancel = mocks.saveBatchImportTask.mock.calls.length

    await scheduler.cancelTask("task-2")
    await scheduler.cancelAllQueued("batch-1")

    expect(mocks.saveBatchImportTask).toHaveBeenCalledTimes(savesBeforeCancel)
  })

  it("dispose 进行中时 cancelTask 和 cancelAllQueued 不新增状态写入", async () => {
    const resetGate = deferred<BatchImportTask>()
    mocks.resetBatchImportTask.mockReturnValue(resetGate.promise)
    mocks.runBatchImportTask.mockImplementation((task: BatchImportTask, options: { signal: AbortSignal }) => (
      new Promise((resolve) => options.signal.addEventListener("abort", () => resolve(success(task)), { once: true }))
    ))
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH, concurrency: 1 })
    scheduler.enqueue([
      makeTask("task-1"),
      makeTask("task-2"),
      makeTask("task-3", { status: "failed" }),
    ])
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 1)
    const regenerating = scheduler.regenerateTask("task-3")
    await waitFor(() => mocks.resetBatchImportTask.mock.calls.length === 1)
    const disposing = scheduler.dispose()
    const savesBeforeCancel = mocks.saveBatchImportTask.mock.calls.length

    await scheduler.cancelTask("task-2")
    await scheduler.cancelAllQueued("batch-1")

    expect(mocks.saveBatchImportTask).toHaveBeenCalledTimes(savesBeforeCancel)
    resetGate.resolve(makeTask("task-3"))
    await Promise.all([regenerating, disposing])
  })
  it("dispose 等待 regenerate 的 deferred reset 完成", async () => {
    const resetGate = deferred<BatchImportTask>()
    mocks.resetBatchImportTask.mockReturnValue(resetGate.promise)
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    scheduler.enqueue([makeTask("task-1", { status: "failed" })])
    const regenerating = scheduler.regenerateTask("task-1")
    await waitFor(() => mocks.resetBatchImportTask.mock.calls.length === 1)

    let disposed = false
    const disposing = scheduler.dispose().then(() => { disposed = true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(disposed).toBe(false)
    resetGate.resolve(makeTask("task-1"))
    await Promise.all([regenerating, disposing])
    expect(disposed).toBe(true)
  })

  it.each(["cancelTask", "cancelAllQueued"] as const)("dispose 等待 %s 的 queued cancelled 保存完成", async (action) => {
    const cancelSaveGate = deferred<void>()
    mocks.runBatchImportTask.mockImplementation((task: BatchImportTask, options: { signal: AbortSignal }) => (
      new Promise((resolve) => options.signal.addEventListener("abort", () => resolve(success(task)), { once: true }))
    ))
    mocks.saveBatchImportTask.mockImplementation((task: BatchImportTask) => (
      task.id === "task-2" && task.status === "cancelled" ? cancelSaveGate.promise : Promise.resolve()
    ))
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH, concurrency: 1 })
    scheduler.enqueue([makeTask("task-1"), makeTask("task-2")])
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 1)
    const mutation = action === "cancelTask"
      ? scheduler.cancelTask("task-2")
      : scheduler.cancelAllQueued("batch-1")
    await waitFor(() => mocks.saveBatchImportTask.mock.calls.some(([task]) => task.id === "task-2" && task.status === "cancelled"))

    let disposed = false
    const disposing = scheduler.dispose().then(() => { disposed = true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(disposed).toBe(false)
    cancelSaveGate.resolve()
    await Promise.all([mutation, disposing])
    expect(disposed).toBe(true)
  })

  it("后台 failed 终态保存失败时通知 interrupted 中文错误并停止运行", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.runBatchImportTask.mockRejectedValue(new Error("引擎失败"))
    mocks.saveBatchImportTask.mockImplementation((task: BatchImportTask) => (
      task.status === "failed" ? Promise.reject(new Error("失败状态写盘失败")) : Promise.resolve()
    ))
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    const getTasks = latestTasks(scheduler)
    scheduler.enqueue([makeTask("task-1")])

    await waitFor(() => getTasks().some((task) => task.status === "interrupted"))
    const task = getTasks().find((item) => item.id === "task-1")
    expect(task).toMatchObject({
      status: "interrupted",
      error: "任务失败状态保存失败，请重新打开项目后继续",
    })
    expect(mocks.runBatchImportTask).toHaveBeenCalledTimes(1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.runBatchImportTask).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith("批量导入：任务终态持久化失败", expect.any(Error))
  })
  it("重新生成只重置并重新排入当前任务", async () => {
    const original = makeTask("task-1", { status: "failed", error: "旧错误" })
    const reset = makeTask("task-1")
    mocks.resetBatchImportTask.mockResolvedValue(reset)
    mocks.runBatchImportTask.mockImplementation(async (task: BatchImportTask) => success(task))
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    const getTasks = latestTasks(scheduler)
    scheduler.enqueue([original, makeTask("task-2", { status: "failed" })])

    await scheduler.regenerateTask("task-1")
    await waitFor(() => getTasks().find((task) => task.id === "task-1")?.status === "completed")

    expect(mocks.resetBatchImportTask).toHaveBeenCalledWith(PROJECT_PATH, "task-1")
    expect(mocks.runBatchImportTask.mock.calls.map(([task]) => task.id)).toEqual(["task-1"])
    expect(getTasks().find((task) => task.id === "task-2")?.status).toBe("failed")
  })

  it("dispose 后引擎 resolve completed 时保留提交结果且取消订阅", async () => {
    let signal: AbortSignal | undefined
    let engineResolved = false
    mocks.runBatchImportTask.mockImplementation((task: BatchImportTask, options: { signal: AbortSignal }) => {
      signal = options.signal
      return new Promise((resolve) => {
        options.signal.addEventListener("abort", () => {
          engineResolved = true
          resolve(success(task))
        }, { once: true })
      })
    })
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    const listener = vi.fn()
    scheduler.subscribe(listener)
    scheduler.enqueue([makeTask("task-1")])
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 1)
    const callsBeforeDispose = listener.mock.calls.length

    scheduler.dispose()
    await waitFor(() => engineResolved)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(signal?.aborted).toBe(true)
    expect(listener).toHaveBeenCalledTimes(callsBeforeDispose)
    expect(mocks.saveBatchImportTask.mock.calls.map(([task]) => task.status)).toEqual(["splitting"])
    expect(mocks.saveBatchImportTask.mock.calls.some(([task]) => (
      task.status === "completed" || task.status === "cancelled" || task.status === "failed"
    ))).toBe(false)
  })

  it("dispose 后引擎抛出取消错误时持久化 cancelled", async () => {
    mocks.runBatchImportTask.mockImplementation((_task: BatchImportTask, options: { signal: AbortSignal }) => (
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("用户取消导入")), { once: true })
      })
    ))
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    scheduler.enqueue([makeTask("task-1")])
    await waitFor(() => mocks.runBatchImportTask.mock.calls.length === 1)

    scheduler.dispose()
    await waitFor(() => mocks.saveBatchImportTask.mock.calls.some(([task]) => task.status === "cancelled"))

    expect(mocks.saveBatchImportTask.mock.calls.at(-1)?.[0].status).toBe("cancelled")
    expect(mocks.saveBatchImportTask.mock.calls.some(([task]) => task.status === "completed")).toBe(false)
  })

  it("可同步重命名终态任务并彻底忘记已删除任务", () => {
    const scheduler = createBatchImportScheduler({ projectPath: PROJECT_PATH })
    const getTasks = latestTasks(scheduler)
    const completed = makeTask("task-1", { status: "completed", finalTitle: "旧名字" })
    scheduler.enqueue([completed])

    scheduler.syncTerminalTask({ ...completed, finalTitle: "新名字" })
    expect(getTasks()[0].finalTitle).toBe("新名字")

    scheduler.forgetTerminalTask(completed.id)
    expect(getTasks()).toEqual([])
  })
})
