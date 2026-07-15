import { create } from "zustand"
import { normalizePath } from "@/lib/path-utils"

export type DeAiTaskStatus = "processing" | "ready" | "confirmed" | "failed" | "cancelled"

export interface DeAiTask {
  id: string
  projectPath: string
  chapterPath: string
  chapterTitle: string
  status: DeAiTaskStatus
  skillId: string | null
  skillName: string
  skillContent: string
  modelName: string
  sourceContent: string
  candidateContent: string
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface DeAiTaskStartInput {
  projectPath: string
  chapterPath: string
  chapterTitle: string
  skillId: string | null
  skillName: string
  skillContent: string
  modelName: string
  sourceContent: string
}

export interface DeAiProjectReviewState {
  open: boolean
  chapterId: string | null
}

export interface DeAiTaskState {
  tasks: DeAiTask[]
  reviewByProject: Record<string, DeAiProjectReviewState>
  startTask: (input: DeAiTaskStartInput) => string
  updateTask: (taskId: string, patch: Partial<DeAiTask>) => void
  finishTask: (taskId: string, candidateContent: string) => void
  failTask: (taskId: string, error: string) => void
  cancelTask: (taskId: string) => void
  confirmTask: (taskId: string) => void
  removeTask: (taskId: string) => void
  clearConfirmed: (projectPath: string) => void
  openReview: (projectPath: string, taskId?: string) => void
  closeReview: (projectPath: string) => void
  setReviewChapter: (projectPath: string, taskId: string | null) => void
  isChapterProcessing: (chapterPath: string) => boolean
}

let deAiTaskCounter = 0

function normalizedProjectPath(path: string): string {
  const normalized = normalizePath(path).replace(/\/$/, "")
  const isWindowsPath = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")
  return isWindowsPath ? normalized.toLowerCase() : normalized
}

const CLOSED_PROJECT_REVIEW: DeAiProjectReviewState = {
  open: false,
  chapterId: null,
}

export function selectProjectDeAiTasks(tasks: DeAiTask[], projectPath?: string | null): DeAiTask[] {
  if (!projectPath) return []
  const projectKey = normalizedProjectPath(projectPath)
  return tasks.filter((task) => normalizedProjectPath(task.projectPath) === projectKey)
}

export function selectProjectDeAiReview(
  state: Pick<DeAiTaskState, "reviewByProject">,
  projectPath?: string | null,
): DeAiProjectReviewState {
  if (!projectPath) return CLOSED_PROJECT_REVIEW
  return state.reviewByProject[normalizedProjectPath(projectPath)] ?? CLOSED_PROJECT_REVIEW
}

export const useDeAiTaskStore = create<DeAiTaskState>((set, get) => ({
  tasks: [],
  reviewByProject: {},

  startTask: (input) => {
    const now = Date.now()
    const id = `de-ai-task-${++deAiTaskCounter}-${now}`
    const normalizedPath = normalizePath(input.chapterPath)
    set((state) => ({
      tasks: [
        {
          ...input,
          chapterPath: normalizedPath,
          id,
          status: "processing" as const,
          candidateContent: "",
          error: null,
          createdAt: now,
          updatedAt: now,
        },
        ...state.tasks.filter((t) => t.chapterPath !== normalizedPath),
      ],
    }))
    return id
  },

  updateTask: (taskId, patch) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId ? { ...task, ...patch, updatedAt: Date.now() } : task
      ),
    }))
  },

  finishTask: (taskId, candidateContent) => {
    const now = Date.now()
    set((state) => {
      const finishedTask = state.tasks.find((task) => task.id === taskId)
      const tasks = state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, status: "ready" as const, candidateContent, updatedAt: now }
          : task
      )
      if (!finishedTask) return { tasks }
      const projectKey = normalizedProjectPath(finishedTask.projectPath)
      const currentReview = state.reviewByProject[projectKey] ?? CLOSED_PROJECT_REVIEW
      return {
        tasks,
        reviewByProject: {
          ...state.reviewByProject,
          [projectKey]: currentReview.open
            ? currentReview
            : { open: true, chapterId: taskId },
        },
      }
    })
  },

  failTask: (taskId, error) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, status: "failed" as const, error, updatedAt: Date.now() }
          : task
      ),
    }))
  },

  cancelTask: (taskId) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, status: "cancelled" as const, updatedAt: Date.now() }
          : task
      ),
    }))
  },

  confirmTask: (taskId) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, status: "confirmed" as const, updatedAt: Date.now() }
          : task
      ),
    }))
  },

  removeTask: (taskId) => {
    set((state) => {
      const task = state.tasks.find((item) => item.id === taskId)
      if (!task) return state
      const projectKey = normalizedProjectPath(task.projectPath)
      const currentReview = state.reviewByProject[projectKey]
      return {
        tasks: state.tasks.filter((item) => item.id !== taskId),
        reviewByProject: currentReview?.chapterId === taskId
          ? {
              ...state.reviewByProject,
              [projectKey]: { ...currentReview, chapterId: null },
            }
          : state.reviewByProject,
      }
    })
  },

  clearConfirmed: (projectPath) => {
    const projectKey = normalizedProjectPath(projectPath)
    set((state) => ({
      tasks: state.tasks.filter((task) =>
        task.status !== "confirmed" || normalizedProjectPath(task.projectPath) !== projectKey
      ),
    }))
  },

  openReview: (projectPath, taskId) => {
    const projectKey = normalizedProjectPath(projectPath)
    const tasks = selectProjectDeAiTasks(get().tasks, projectPath)
    const firstReady = tasks.find((t) => t.status === "ready")
    const requestedTask = taskId ? tasks.find((task) => task.id === taskId) : null
    set((state) => ({
      reviewByProject: {
        ...state.reviewByProject,
        [projectKey]: {
          open: true,
          chapterId: requestedTask?.id ?? firstReady?.id ?? tasks[0]?.id ?? null,
        },
      },
    }))
  },

  closeReview: (projectPath) => {
    const projectKey = normalizedProjectPath(projectPath)
    set((state) => ({
      reviewByProject: {
        ...state.reviewByProject,
        [projectKey]: CLOSED_PROJECT_REVIEW,
      },
      tasks: state.tasks.filter((task) =>
        task.status !== "confirmed" || normalizedProjectPath(task.projectPath) !== projectKey
      ),
    }))
  },

  setReviewChapter: (projectPath, taskId) => {
    const projectKey = normalizedProjectPath(projectPath)
    set((state) => ({
      reviewByProject: {
        ...state.reviewByProject,
        [projectKey]: {
          open: state.reviewByProject[projectKey]?.open ?? true,
          chapterId: taskId,
        },
      },
    }))
  },

  isChapterProcessing: (chapterPath) => {
    const normalized = normalizePath(chapterPath)
    return get().tasks.some(
      (task) => task.chapterPath === normalized && task.status === "processing"
    )
  },
}))
