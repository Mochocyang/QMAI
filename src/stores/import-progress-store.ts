import { create } from "zustand"
import { normalizePath } from "@/lib/path-utils"

export type ImportProgressKind = "chapter" | "outline" | "outline_generation" | "outline_refinement"
export type ImportProgressStatus = "running" | "done" | "cancelled" | "error"

export const MAX_SETTLED_IMPORT_TASKS = 3

export function isSettledImportProgressStatus(status: ImportProgressStatus): boolean {
  return status === "done" || status === "error" || status === "cancelled"
}

export function retainRecentImportProgressTasks(tasks: ImportProgressTask[]): ImportProgressTask[] {
  const running: ImportProgressTask[] = []
  const settled: ImportProgressTask[] = []
  for (const task of tasks) {
    if (task.status === "running") running.push(task)
    else if (isSettledImportProgressStatus(task.status)) settled.push(task)
  }
  settled.sort((a, b) => b.updatedAt - a.updatedAt)
  return [...running, ...settled.slice(0, MAX_SETTLED_IMPORT_TASKS)]
}

export interface ImportProgressTask {
  id: string
  projectPath: string
  kind: ImportProgressKind
  status: ImportProgressStatus
  completed: number
  total: number
  currentTitle: string
  activeTitles?: string[]
  /**
   * 正在提取记忆的章节**路径**（已规范化）。
   *
   * 为什么不能复用 `currentTitle` 判断「哪一章在提取」：标题会重名，
   * 同一本书里两章都叫「第3章 无名」并不罕见，按标题匹配会让两行同时显示
   * 「提取中」——而实际只提取了其中一章。路径是唯一的。
   */
  activeChapterPaths?: string[]
  concurrency?: number
  message?: string
  error?: string
  cancelling: boolean
  createdAt: number
  updatedAt: number
  abortController?: AbortController
}

interface StartImportProgressTaskInput {
  projectPath: string
  kind: ImportProgressKind
  total: number
  currentTitle?: string
  message?: string
  abortController?: AbortController
  activeTitles?: string[]
  activeChapterPaths?: string[]
  concurrency?: number
}

interface ImportProgressState {
  tasks: ImportProgressTask[]
  startTask: (input: StartImportProgressTaskInput) => string
  updateTask: (taskId: string, patch: Partial<ImportProgressTask>) => void
  finishTask: (
    taskId: string,
    status: Exclude<ImportProgressStatus, "running">,
    patch?: Partial<ImportProgressTask>,
  ) => void
  markCancelling: (taskId: string) => void
  cancelTask: (taskId: string) => void
  clearTask: (taskId: string) => void
  pruneSettledTasks: () => void
  getLatestTask: (projectPath: string, kind?: ImportProgressKind) => ImportProgressTask | null
}

let importTaskCounter = 0

export const useImportProgressStore = create<ImportProgressState>((set, get) => {
  function reconcileOutlineTasks(task: ImportProgressTask | undefined): void {
    if (task?.kind !== "outline" && task?.kind !== "outline_generation" && task?.kind !== "outline_refinement") return
    void import("@/lib/novel/outline-generation").then(({ reconcileStaleOutlineIngestTasks }) => {
      reconcileStaleOutlineIngestTasks(task.projectPath)
    })
  }

  return {
    tasks: [],
    startTask: (input) => {
      const now = Date.now()
      const id = `import-progress-${++importTaskCounter}`
      set((state) => ({
        tasks: retainRecentImportProgressTasks([
          {
            id,
            projectPath: normalizePath(input.projectPath),
            kind: input.kind,
            status: "running",
            completed: 0,
            total: input.total,
            currentTitle: input.currentTitle ?? "",
            message: input.message,
            activeTitles: input.activeTitles ?? [],
            activeChapterPaths: input.activeChapterPaths ?? [],
            concurrency: input.concurrency,
            cancelling: false,
            createdAt: now,
            updatedAt: now,
            abortController: input.abortController,
          },
          ...state.tasks,
        ]),
      }))
      return id
    },
    updateTask: (taskId, patch) => {
      set((state) => ({
        tasks: state.tasks.map((task) =>
          task.id === taskId
            ? { ...task, ...patch, updatedAt: Date.now() }
            : task,
        ),
      }))
    },
    finishTask: (taskId, status, patch = {}) => {
      const task = get().tasks.find((item) => item.id === taskId)
      /*
       * 结束时由 store 自己清空 activeChapterPaths，且排在 patch 之后（永远获胜）：
       * 不依赖每个调用点都记得清。漏清一次，那一行就会永远显示「提取中」，
       * 而它其实早就提取完了 —— 用户能看到的假状态比看不到状态更糟。
       */
      get().updateTask(taskId, { ...patch, status, cancelling: false, activeChapterPaths: [] })
      reconcileOutlineTasks(task)
      get().pruneSettledTasks()
    },
    markCancelling: (taskId) => {
      get().updateTask(taskId, { cancelling: true })
    },
    cancelTask: (taskId) => {
      const task = get().tasks.find((t) => t.id === taskId)
      if (!task) return
      task.abortController?.abort()
      get().updateTask(taskId, { status: "cancelled", cancelling: false, activeTitles: [], activeChapterPaths: [] })
      reconcileOutlineTasks(task)
      get().pruneSettledTasks()
    },
    clearTask: (taskId) => {
      set((state) => ({ tasks: state.tasks.filter((task) => task.id !== taskId) }))
    },
    pruneSettledTasks: () => {
      set((state) => ({ tasks: retainRecentImportProgressTasks(state.tasks) }))
    },
    getLatestTask: (projectPath, kind) => {
      const normalizedProjectPath = normalizePath(projectPath)
      return get().tasks
        .filter((task) => task.projectPath === normalizedProjectPath && (!kind || task.kind === kind))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
    },
  }
})
