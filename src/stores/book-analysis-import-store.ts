import { create } from "zustand"
import { normalizePath } from "@/lib/path-utils"
import {
  createBatchImportScheduler,
  type BatchImportScheduler,
} from "@/lib/novel/book-analysis/batch-import-scheduler"
import { reserveUniqueTitle } from "@/lib/novel/book-analysis/batch-import-hash"
import {
  cacheTaskSource,
  loadBatchImportBatches,
  loadBatchImportTasks,
  saveBatchImportBatch,
  saveBatchImportTask,
} from "@/lib/novel/book-analysis/batch-import-storage"
import type {
  BatchImportBatch,
  BatchImportCandidate,
  BatchImportTask,
} from "@/lib/novel/book-analysis/batch-import-types"
import {
  findBookLibraryEntryBySha256,
  loadBookLibrary,
} from "@/lib/novel/book-analysis/library-store"

const OPEN_PANEL_STATUSES = new Set(["queued", "copying", "splitting", "interrupted", "failed"])
const SWITCHED_PROJECT_ERROR = "项目已切换，导入任务已中断"
let idCounter = 0

function safeId(prefix: "batch" | "task"): string {
  idCounter += 1
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/[^A-Za-z0-9_-]/g, "")
    : Math.random().toString(36).slice(2)
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${random}`
}

function titleFromFile(fileName: string): string {
  return fileName.replace(/\.txt$/i, "").trim() || "未命名作品"
}

function shouldExpand(tasks: BatchImportTask[]): boolean {
  return tasks.some((task) => OPEN_PANEL_STATUSES.has(task.status))
}

function queuedTask(projectPath: string, batchId: string, candidate: BatchImportCandidate, now: number): BatchImportTask {
  const id = safeId("task")
  return {
    version: 1,
    id,
    batchId,
    projectPath,
    originalPath: normalizePath(candidate.sourcePath),
    originalFileName: candidate.fileName,
    cachedSourcePath: "",
    sourceSha256: null,
    requestedTitle: titleFromFile(candidate.fileName),
    finalTitle: null,
    bookId: `book-${id}`,
    status: "queued",
    completed: 0,
    total: 0,
    error: null,
    skipReason: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
  }
}

export interface BookAnalysisImportState {
  projectPath: string | null
  batches: BatchImportBatch[]
  tasks: BatchImportTask[]
  panelCollapsed: boolean
  panelTouched: boolean
  revision: number
  initializeProject(projectPath: string): Promise<void>
  createBatch(candidates: BatchImportCandidate[]): Promise<void>
  continueTask(taskId: string): Promise<void>
  regenerateTask(taskId: string): Promise<void>
  cancelTask(taskId: string): Promise<void>
  cancelAllQueued(batchId: string): Promise<void>
  setPanelCollapsed(collapsed: boolean): void
  dispose(): Promise<void>
}

export function createBookAnalysisImportStore(options: { onRevision?: () => void } = {}) {
  let scheduler: BatchImportScheduler | null = null
  let unsubscribeScheduler: (() => void) | null = null
  let generation = 0
  let schedulerTaskIds = new Set<string>()
  let completedTaskIds = new Set<string>()
  let createBatchChain: Promise<void> = Promise.resolve()
  let schedulerLifecycleChain: Promise<void> = Promise.resolve()
  const cancellingTaskIds = new Set<string>()

  function detachScheduler(): BatchImportScheduler | null {
    unsubscribeScheduler?.()
    unsubscribeScheduler = null
    const previousScheduler = scheduler
    scheduler = null
    schedulerTaskIds = new Set()
    completedTaskIds = new Set()
    return previousScheduler
  }

  return create<BookAnalysisImportState>((set, get) => {
    function isCurrent(token: number, projectPath: string, expectedScheduler?: BatchImportScheduler): boolean {
      return token === generation
        && get().projectPath === projectPath
        && (expectedScheduler === undefined || scheduler === expectedScheduler)
    }

    async function interruptTask(task: BatchImportTask): Promise<BatchImportTask> {
      const now = Date.now()
      const interrupted: BatchImportTask = {
        ...task,
        status: "interrupted",
        error: SWITCHED_PROJECT_ERROR,
        completedAt: null,
        updatedAt: now,
      }
      await saveBatchImportTask(interrupted)
      return interrupted
    }

    async function runCreateBatch(
      candidates: BatchImportCandidate[],
      projectPath: string,
      token: number,
      expectedScheduler: BatchImportScheduler,
    ): Promise<void> {
      if (!isCurrent(token, projectPath, expectedScheduler) || candidates.length === 0) return
      const library = await loadBookLibrary(projectPath)
      if (!isCurrent(token, projectPath, expectedScheduler)) return

      const reservedTitles = new Set(library.entries.map((entry) => entry.title))
      for (const task of get().tasks) {
        if (task.status !== "skipped" && task.status !== "cancelled" && task.finalTitle) {
          reservedTitles.add(task.finalTitle)
        }
      }
      const batchHashes = new Set<string>()
      const createdAt = Date.now()
      const batchId = safeId("batch")
      let tasks = candidates.map((candidate) => queuedTask(projectPath, batchId, candidate, createdAt))
      let batch: BatchImportBatch = {
        version: 1,
        id: batchId,
        projectPath,
        taskIds: tasks.map((task) => task.id),
        createdAt,
        updatedAt: createdAt,
      }

      await saveBatchImportBatch(batch)
      const persistedTasks: BatchImportTask[] = []
      for (const originalTask of tasks) {
        let persistedTask: BatchImportTask = isCurrent(token, projectPath, expectedScheduler)
          ? originalTask
          : {
              ...originalTask,
              status: "interrupted",
              error: SWITCHED_PROJECT_ERROR,
              completedAt: null,
              updatedAt: Date.now(),
            }
        try {
          await saveBatchImportTask(persistedTask)
        } catch (error) {
          const now = Date.now()
          persistedTask = isCurrent(token, projectPath, expectedScheduler)
            ? {
                ...originalTask,
                status: "failed",
                error: `创建导入任务失败：“${originalTask.originalFileName}”未能保存`,
                completedAt: now,
                updatedAt: now,
              }
            : {
                ...originalTask,
                status: "interrupted",
                error: SWITCHED_PROJECT_ERROR,
                completedAt: null,
                updatedAt: now,
              }
          try {
            await saveBatchImportTask(persistedTask)
          } catch (fallbackError) {
            console.error("批量导入：保存任务失败状态失败", fallbackError)
            continue
          }
        }
        if (!isCurrent(token, projectPath, expectedScheduler) && persistedTask.status !== "interrupted") {
          try {
            persistedTask = await interruptTask(persistedTask)
          } catch (error) {
            console.error("批量导入：保存项目切换中断状态失败", error)
          }
        }
        persistedTasks.push(persistedTask)
      }
      tasks = persistedTasks
      if (batch.taskIds.length !== tasks.length) {
        batch = { ...batch, taskIds: tasks.map((task) => task.id), updatedAt: Date.now() }
        await saveBatchImportBatch(batch)
      }
      if (!isCurrent(token, projectPath, expectedScheduler)) return

      const unavailableTaskIds = new Set<string>()
      for (let index = 0; index < tasks.length; index += 1) {
        if (!isCurrent(token, projectPath, expectedScheduler)) break
        if (tasks[index].status === "failed") continue
        let task: BatchImportTask = { ...tasks[index], status: "copying", updatedAt: Date.now() }
        try {
          await saveBatchImportTask(task)
          if (!isCurrent(token, projectPath, expectedScheduler)) {
            tasks[index] = await interruptTask(task)
            break
          }
          task = await cacheTaskSource(task)
          if (!isCurrent(token, projectPath, expectedScheduler)) {
            tasks[index] = await interruptTask(task)
            break
          }
          if (!task.sourceSha256) throw new Error("源文件哈希为空")
          const duplicateInBatch = batchHashes.has(task.sourceSha256)
          const duplicateInLibrary = duplicateInBatch
            ? undefined
            : await findBookLibraryEntryBySha256(projectPath, task.sourceSha256)
          if (!isCurrent(token, projectPath, expectedScheduler)) {
            tasks[index] = await interruptTask(task)
            break
          }
          const now = Date.now()
          if (duplicateInBatch || duplicateInLibrary) {
            task = {
              ...task,
              status: "skipped",
              skipReason: duplicateInBatch
                ? "与本批次已选择作品内容相同，已跳过"
                : `与作品库“${duplicateInLibrary?.title ?? "已有作品"}”存在相同内容，已跳过`,
              completedAt: now,
              updatedAt: now,
            }
          } else {
            batchHashes.add(task.sourceSha256)
            task = {
              ...task,
              finalTitle: reserveUniqueTitle(task.requestedTitle, reservedTitles),
              status: "queued",
              updatedAt: now,
            }
          }
          await saveBatchImportTask(task)
          if (!isCurrent(token, projectPath, expectedScheduler)) {
            if (task.status === "copying") tasks[index] = await interruptTask(task)
            break
          }
        } catch (error) {
          if (!isCurrent(token, projectPath, expectedScheduler)) {
            tasks[index] = await interruptTask(task)
            break
          }
          console.error(`批量导入：处理文件“${task.originalFileName}”失败`, error)
          const now = Date.now()
          task = {
            ...task,
            status: "failed",
            error: `缓存源文件失败：“${task.originalFileName}”未能创建导入任务`,
            completedAt: now,
            updatedAt: now,
          }
          try {
            await saveBatchImportTask(task)
          } catch (fallbackError) {
            console.error("批量导入：保存任务失败状态失败", fallbackError)
            unavailableTaskIds.add(task.id)
            continue
          }
          if (!isCurrent(token, projectPath, expectedScheduler)) {
            tasks[index] = await interruptTask(task)
            break
          }
        }
        tasks[index] = task
      }

      if (unavailableTaskIds.size > 0) {
        tasks = tasks.filter((task) => !unavailableTaskIds.has(task.id))
        batch = { ...batch, taskIds: tasks.map((task) => task.id), updatedAt: Date.now() }
        await saveBatchImportBatch(batch)
      }
      if (!isCurrent(token, projectPath, expectedScheduler)) return
      set((state) => {
        const nextTasks = [...state.tasks, ...tasks]
        return {
          batches: [...state.batches, { ...batch, updatedAt: Date.now() }],
          tasks: nextTasks,
          panelCollapsed: state.panelTouched ? state.panelCollapsed : !shouldExpand(nextTasks),
        }
      })
      const runnable = tasks.filter((task) => task.status === "queued")
      if (!isCurrent(token, projectPath, expectedScheduler) || runnable.length === 0) return
      runnable.forEach((task) => schedulerTaskIds.add(task.id))
      expectedScheduler.enqueue(runnable)
    }

    return {
      projectPath: null,
      batches: [],
      tasks: [],
      panelCollapsed: true,
      panelTouched: false,
      revision: 0,

      initializeProject: (rawPath) => {
        const projectPath = normalizePath(rawPath).replace(/\/+$/, "")
        if (!projectPath) return Promise.reject(new Error("项目路径不能为空"))
        generation += 1
        const token = generation
        const previousScheduler = detachScheduler()
        set({ projectPath, batches: [], tasks: [], panelCollapsed: true, panelTouched: false })

        const operation = schedulerLifecycleChain.then(async () => {
          await previousScheduler?.dispose()
          if (!isCurrent(token, projectPath)) return
          const [tasks, batches] = await Promise.all([
            loadBatchImportTasks(projectPath),
            loadBatchImportBatches(projectPath),
          ])
          if (!isCurrent(token, projectPath)) return
          completedTaskIds = new Set(tasks.filter((task) => task.status === "completed").map((task) => task.id))
          set({ tasks, batches, panelCollapsed: !shouldExpand(tasks), panelTouched: false })

          const currentScheduler = createBatchImportScheduler({ projectPath })
          scheduler = currentScheduler
          unsubscribeScheduler = currentScheduler.subscribe((next) => {
            if (!isCurrent(token, projectPath, currentScheduler)) return
            const updates = new Map(next.map((task) => [task.id, task]))
            const merged = get().tasks.map((task) => updates.get(task.id) ?? task)
            for (const task of next) {
              if (!merged.some((item) => item.id === task.id)) merged.push(task)
              if (task.status === "completed" && !completedTaskIds.has(task.id)) {
                completedTaskIds.add(task.id)
                set((state) => ({ revision: state.revision + 1 }))
                options.onRevision?.()
              }
            }
            set((state) => ({
              tasks: merged,
              panelCollapsed: state.panelTouched ? state.panelCollapsed : !shouldExpand(merged),
            }))
          })
        })
        schedulerLifecycleChain = operation.catch(() => undefined)
        return operation
      },
      createBatch: (candidates) => {
        const projectPath = get().projectPath
        const expectedScheduler = scheduler
        const token = generation
        if (!projectPath || !expectedScheduler) return Promise.reject(new Error("请先初始化拆书项目"))
        const operation = createBatchChain.then(() => runCreateBatch(candidates, projectPath, token, expectedScheduler))
        createBatchChain = operation.catch(() => undefined)
        return operation
      },

      continueTask: async (taskId) => {
        const current = scheduler
        if (!current) throw new Error("请先初始化拆书项目")
        if (cancellingTaskIds.has(taskId)) throw new Error("任务正在取消，请稍后重试")
        const task = get().tasks.find((item) => item.id === taskId)
        if (task && !schedulerTaskIds.has(taskId)) {
          schedulerTaskIds.add(taskId)
          current.enqueue([task])
        }
        await current.continueTask(taskId)
      },

      regenerateTask: async (taskId) => {
        const current = scheduler
        if (!current) throw new Error("请先初始化拆书项目")
        if (cancellingTaskIds.has(taskId)) throw new Error("任务正在取消，请稍后重试")
        const task = get().tasks.find((item) => item.id === taskId)
        if (task && !schedulerTaskIds.has(taskId)) {
          schedulerTaskIds.add(taskId)
          current.enqueue([task])
        }
        completedTaskIds.delete(taskId)
        await current.regenerateTask(taskId)
      },

      cancelTask: async (taskId) => {
        const current = scheduler
        const projectPath = get().projectPath
        const token = generation
        if (!current || !projectPath) throw new Error("请先初始化拆书项目")
        const task = get().tasks.find((item) => item.id === taskId)
        let cancelled: BatchImportTask | null = null
        if (task?.status === "queued" && !schedulerTaskIds.has(taskId)) {
          const now = Date.now()
          cancelled = { ...task, status: "cancelled", error: null, completedAt: now, updatedAt: now }
          await saveBatchImportTask(cancelled)
          if (!isCurrent(token, projectPath, current)) return
        }
        await current.cancelTask(taskId)
        if (!isCurrent(token, projectPath, current)) return
        if (cancelled) set((state) => ({ tasks: state.tasks.map((item) => item.id === taskId ? cancelled! : item) }))
      },

      cancelAllQueued: async (batchId) => {
        const current = scheduler
        const projectPath = get().projectPath
        const token = generation
        if (!current || !projectPath) throw new Error("请先初始化拆书项目")
        if (!batchId) throw new Error("批次 ID 不能为空")
        const matchingTasks = get().tasks.filter((task) => (
          task.batchId === batchId && task.status === "queued" && !schedulerTaskIds.has(task.id)
        ))
        matchingTasks.forEach((task) => cancellingTaskIds.add(task.id))
        try {
          const replacements = new Map<string, BatchImportTask>()
          for (const task of matchingTasks) {
            const now = Date.now()
            const cancelled: BatchImportTask = { ...task, status: "cancelled", error: null, completedAt: now, updatedAt: now }
            await saveBatchImportTask(cancelled)
            if (!isCurrent(token, projectPath, current)) return
            replacements.set(task.id, cancelled)
          }
          await current.cancelAllQueued(batchId)
          if (!isCurrent(token, projectPath, current)) return
          if (replacements.size > 0) {
            set((state) => ({ tasks: state.tasks.map((task) => replacements.get(task.id) ?? task) }))
          }
        } finally {
          matchingTasks.forEach((task) => cancellingTaskIds.delete(task.id))
        }
      },

      setPanelCollapsed: (panelCollapsed) => set({ panelCollapsed, panelTouched: true }),
      dispose: () => {
        generation += 1
        const previousScheduler = detachScheduler()
        set({ projectPath: null, batches: [], tasks: [], panelCollapsed: true, panelTouched: false })
        const operation = schedulerLifecycleChain.then(() => previousScheduler?.dispose())
        schedulerLifecycleChain = operation.catch(() => undefined)
        return operation
      },
    }
  })
}

export const useBookAnalysisImportStore = createBookAnalysisImportStore()
