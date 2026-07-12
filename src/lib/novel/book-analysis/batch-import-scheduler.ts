import { runBatchImportTask } from "./batch-import-engine"
import {
  resetBatchImportTask,
  saveBatchImportTask,
} from "./batch-import-storage"
import type { BatchImportTask } from "./batch-import-types"

export interface BatchImportScheduler {
  enqueue(tasks: BatchImportTask[]): void
  continueTask(taskId: string): Promise<void>
  regenerateTask(taskId: string): Promise<void>
  cancelTask(taskId: string): Promise<void>
  cancelAllQueued(batchId: string): Promise<void>
  subscribe(listener: (tasks: BatchImportTask[]) => void): () => void
  dispose(): Promise<void>
}

export function createBatchImportScheduler(options: {
  projectPath: string
  concurrency?: number
}): BatchImportScheduler {
  const requestedConcurrency = options.concurrency ?? 2
  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.max(1, Math.min(2, Math.floor(requestedConcurrency)))
    : 2
  const tasks = new Map<string, BatchImportTask>()
  const queue: string[] = []
  const queuedIds = new Set<string>()
  const runningIds = new Set<string>()
  const controllers = new Map<string, AbortController>()
  const runPromises = new Map<string, Promise<void>>()
  const continuePromises = new Map<string, Promise<void>>()
  const cancelRequestedIds = new Set<string>()
  const mutationPromises = new Set<Promise<void>>()
  const listeners = new Set<(tasks: BatchImportTask[]) => void>()
  let disposed = false

  function snapshot(): BatchImportTask[] {
    return Array.from(tasks.values(), (task) => ({ ...task }))
  }

  function notify(): void {
    if (disposed) return
    const nextTasks = snapshot()
    for (const listener of listeners) {
      try {
        listener(nextTasks)
      } catch (error) {
        console.error("批量导入：任务状态订阅回调执行失败", error)
      }
    }
  }

  function updateAndNotify(task: BatchImportTask): void {
    tasks.set(task.id, task)
    notify()
  }

  async function persistAndNotify(task: BatchImportTask): Promise<void> {
    await saveBatchImportTask(task)
    updateAndNotify(task)
  }

  function removeFromQueue(taskId: string): void {
    queuedIds.delete(taskId)
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index] === taskId) queue.splice(index, 1)
    }
  }

  function queueTask(taskId: string): void {
    const task = tasks.get(taskId)
    if (
      disposed
      || !task
      || task.status !== "queued"
      || runningIds.has(taskId)
      || queuedIds.has(taskId)
    ) {
      return
    }
    queuedIds.add(taskId)
    queue.push(taskId)
  }

  function failureMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message
    return "批量导入任务失败"
  }

  async function executeTask(
    queuedTask: BatchImportTask,
    controller: AbortController,
  ): Promise<void> {
    const persistRunError = async (
      runningTask: BatchImportTask,
      error: unknown,
    ): Promise<void> => {
      const currentTask = tasks.get(queuedTask.id) ?? runningTask
      const finishedAt = Date.now()
      const failedTask: BatchImportTask = controller.signal.aborted || disposed
        ? {
            ...currentTask,
            status: "cancelled",
            error: null,
            completedAt: finishedAt,
            updatedAt: finishedAt,
          }
        : {
            ...currentTask,
            status: "failed",
            error: failureMessage(error),
            completedAt: finishedAt,
            updatedAt: finishedAt,
          }
      try {
        await persistAndNotify(failedTask)
      } catch (persistError) {
        updateAndNotify({
          ...failedTask,
          status: "interrupted",
          error: "任务失败状态保存失败，请重新打开项目后继续",
          completedAt: null,
          updatedAt: Date.now(),
        })
        throw persistError
      }
    }

    try {
      const now = Date.now()
      const runningTask: BatchImportTask = {
        ...queuedTask,
        status: "splitting",
        error: null,
        completedAt: null,
        startedAt: queuedTask.startedAt ?? now,
        updatedAt: now,
      }
      try {
        await persistAndNotify(runningTask)
      } catch (error) {
        await persistRunError(runningTask, error)
        return
      }

      let result: Awaited<ReturnType<typeof runBatchImportTask>>
      try {
        result = await runBatchImportTask(runningTask, {
          signal: controller.signal,
        })
      } catch (error) {
        await persistRunError(runningTask, error)
        return
      }

      // 真实契约：引擎 resolve completed 前已完成正式发布和持久化；scheduler 只能同步内存，绝不能二次落盘。
      if (result.task.status === "completed") {
        updateAndNotify(result.task)
      } else if (controller.signal.aborted || disposed) {
        const cancelledAt = Date.now()
        await persistAndNotify({
          ...runningTask,
          status: "cancelled",
          error: null,
          completedAt: cancelledAt,
          updatedAt: cancelledAt,
        })
      } else {
        await persistAndNotify(result.task)
      }
    } finally {
      runningIds.delete(queuedTask.id)
      controllers.delete(queuedTask.id)
      runPromises.delete(queuedTask.id)
      pump()
    }
  }
  function pump(): void {
    if (disposed) return
    while (runningIds.size < concurrency && queue.length > 0) {
      const taskId = queue.shift()
      if (!taskId) continue
      queuedIds.delete(taskId)
      const task = tasks.get(taskId)
      if (!task || task.status !== "queued" || runningIds.has(taskId)) continue

      const controller = new AbortController()
      runningIds.add(taskId)
      controllers.set(taskId, controller)
      const runPromise = executeTask(task, controller)
      runPromises.set(taskId, runPromise)
      void runPromise.catch((error) => {
        console.error("批量导入：任务终态持久化失败", error)
      })
    }
  }

  function enqueue(nextTasks: BatchImportTask[]): void {
    if (disposed) return
    for (const task of nextTasks) {
      if (tasks.has(task.id)) continue
      tasks.set(task.id, task)
      if (task.status === "queued") queueTask(task.id)
    }
    pump()
  }

  function continueTask(taskId: string): Promise<void> {
    if (disposed) return Promise.resolve()
    const continuing = continuePromises.get(taskId)
    if (continuing) return continuing
    const task = tasks.get(taskId)
    if (!task || task.status !== "interrupted" || runningIds.has(taskId)) return Promise.resolve()

    const operation = (async () => {
      try {
        const now = Date.now()
        await persistAndNotify({
          ...task,
          status: "queued",
          error: null,
          completedAt: null,
          updatedAt: now,
        })
        if (cancelRequestedIds.delete(taskId)) {
          const cancelledAt = Date.now()
          await persistAndNotify({
            ...(tasks.get(taskId) ?? task),
            status: "cancelled",
            error: null,
            completedAt: cancelledAt,
            updatedAt: cancelledAt,
          })
          return
        }
        queueTask(taskId)
        pump()
      } finally {
        continuePromises.delete(taskId)
        cancelRequestedIds.delete(taskId)
      }
    })()
    continuePromises.set(taskId, operation)
    return operation
  }

  async function cancelTask(taskId: string): Promise<void> {
    const continuing = continuePromises.get(taskId)
    if (continuing) {
      cancelRequestedIds.add(taskId)
      await continuing
      return
    }
    const task = tasks.get(taskId)
    if (!task) return

    const controller = controllers.get(taskId)
    if (controller) {
      controller.abort()
      await runPromises.get(taskId)
      return
    }
    if (task.status !== "queued") return

    removeFromQueue(taskId)
    const now = Date.now()
    await persistAndNotify({
      ...task,
      status: "cancelled",
      error: null,
      completedAt: now,
      updatedAt: now,
    })
  }

  async function regenerateTask(taskId: string): Promise<void> {
    if (disposed) return
    const task = tasks.get(taskId)
    if (!task || !["interrupted", "failed", "cancelled"].includes(task.status)) return

    removeFromQueue(taskId)
    const resetTask = await resetBatchImportTask(options.projectPath, taskId)
    if (disposed) return
    await persistAndNotify(resetTask)
    queueTask(taskId)
    pump()
  }
  async function cancelAllQueued(batchId: string): Promise<void> {
    if (!batchId) return
    const matchingTasks = Array.from(tasks.values()).filter((task) => (
      task.batchId === batchId
      && task.status === "queued"
      && !runningIds.has(task.id)
    ))
    for (const task of matchingTasks) removeFromQueue(task.id)
    for (const task of matchingTasks) {
      const now = Date.now()
      await persistAndNotify({
        ...task,
        status: "cancelled",
        error: null,
        completedAt: now,
        updatedAt: now,
      })
    }
  }

  function subscribe(listener: (tasks: BatchImportTask[]) => void): () => void {
    if (disposed) return () => undefined
    listeners.add(listener)
    listener(snapshot())
    return () => {
      listeners.delete(listener)
    }
  }

  function trackMutation(operation: () => Promise<void>): Promise<void> {
    const promise = operation()
    mutationPromises.add(promise)
    void promise.then(
      () => { mutationPromises.delete(promise) },
      () => { mutationPromises.delete(promise) },
    )
    return promise
  }
  async function dispose(): Promise<void> {
    if (!disposed) {
      disposed = true
      queue.length = 0
      queuedIds.clear()
      listeners.clear()
      for (const controller of controllers.values()) controller.abort()
    }
    await Promise.allSettled([
      ...runPromises.values(),
      ...continuePromises.values(),
      ...mutationPromises.values(),
    ])
  }

  return {
    enqueue,
    continueTask: (taskId) => trackMutation(() => continueTask(taskId)),
    regenerateTask: (taskId) => trackMutation(() => regenerateTask(taskId)),
    cancelTask: (taskId) => disposed ? Promise.resolve() : trackMutation(() => cancelTask(taskId)),
    cancelAllQueued: (batchId) => disposed ? Promise.resolve() : trackMutation(() => cancelAllQueued(batchId)),
    subscribe,
    dispose,
  }
}
