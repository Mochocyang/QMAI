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
  modelName: string
  sourceContent: string
}

export interface DeAiTaskState {
  tasks: DeAiTask[]
  reviewOpen: boolean
  reviewChapterId: string | null
  startTask: (input: DeAiTaskStartInput) => string
  updateTask: (taskId: string, patch: Partial<DeAiTask>) => void
  finishTask: (taskId: string, candidateContent: string) => void
  failTask: (taskId: string, error: string) => void
  cancelTask: (taskId: string) => void
  confirmTask: (taskId: string) => void
  removeTask: (taskId: string) => void
  clearConfirmed: () => void
  openReview: (taskId?: string) => void
  closeReview: () => void
  setReviewChapter: (taskId: string | null) => void
  isChapterProcessing: (chapterPath: string) => boolean
}

let deAiTaskCounter = 0

export const useDeAiTaskStore = create<DeAiTaskState>((set, get) => ({
  tasks: [],
  reviewOpen: false,
  reviewChapterId: null,

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
      const tasks = state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, status: "ready" as const, candidateContent, updatedAt: now }
          : task
      )
      const hasReady = tasks.some((t) => t.status === "ready")
      const shouldOpenReview = hasReady && !state.reviewOpen
      return {
        tasks,
        reviewOpen: shouldOpenReview ? true : state.reviewOpen,
        reviewChapterId: shouldOpenReview ? taskId : state.reviewChapterId,
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
    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== taskId),
      reviewChapterId: state.reviewChapterId === taskId ? null : state.reviewChapterId,
    }))
  },

  clearConfirmed: () => {
    set((state) => ({
      tasks: state.tasks.filter((task) => task.status !== "confirmed"),
    }))
  },

  openReview: (taskId) => {
    const tasks = get().tasks
    const firstReady = tasks.find((t) => t.status === "ready")
    set({
      reviewOpen: true,
      reviewChapterId: taskId ?? firstReady?.id ?? tasks[0]?.id ?? null,
    })
  },

  closeReview: () => {
    set((state) => ({
      reviewOpen: false,
      // 关闭时清除已确认的任务
      tasks: state.tasks.filter((task) => task.status !== "confirmed"),
    }))
  },

  setReviewChapter: (taskId) => set({ reviewChapterId: taskId }),

  isChapterProcessing: (chapterPath) => {
    const normalized = normalizePath(chapterPath)
    return get().tasks.some(
      (task) => task.chapterPath === normalized && task.status === "processing"
    )
  },
}))
