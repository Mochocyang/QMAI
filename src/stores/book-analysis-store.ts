import { create } from "zustand"
import type {
  BookAnalysisTask,
  BookAnalysisConfig,
  BookAnalysisProgress,
  BookAnalysisMetadata,
  BookAnalysisResult,
  ExtractedCharacter,
  CharacterSkill,
  RecognizedCharacter,
} from "@/lib/novel/book-analysis/types"
import { normalizePath } from "@/lib/path-utils"

type BookAnalysisChapterSummary = NonNullable<BookAnalysisTask["chapters"]>[number]

export interface BookAnalysisState {
  tasks: BookAnalysisTask[]
  currentTaskId: string | null
  selectedResultPath: string | null
  currentResult: BookAnalysisResult | null
  showResultViewer: boolean

  // 角色识别（feature/character-recognition-and-simple-mode）
  recognitionStatus: "idle" | "heuristic" | "llm_scoring" | "done" | "error"
  recognizedCharacters: RecognizedCharacter[]
  selectedCharacterIds: string[]

  // 任务管理
  startTask: (projectPath: string, config: BookAnalysisConfig, abortController?: AbortController) => string
  updateTaskBookData: (taskId: string, bookId: string, chapters: BookAnalysisChapterSummary[]) => void
  updateTaskProgress: (taskId: string, progress: Partial<BookAnalysisProgress>) => void
  updateTaskMetadata: (taskId: string, metadata: BookAnalysisMetadata) => void
  updateTaskCharacters: (taskId: string, characters: ExtractedCharacter[]) => void
  updateTaskSkills: (taskId: string, skills: CharacterSkill[]) => void
  pauseTask: (taskId: string) => void
  resumeTask: (taskId: string) => void
  cancelTask: (taskId: string) => void
  completeTask: (taskId: string) => void
  errorTask: (taskId: string, error: string) => void
  removeTask: (taskId: string) => void

  // 结果查看
  setSelectedResult: (projectPath: string | null) => void
  setCurrentResult: (result: BookAnalysisResult | null) => void
  setShowResultViewer: (show: boolean) => void

  // 角色识别 actions（feature/character-recognition-and-simple-mode）
  setRecognitionStatus: (status: "idle" | "heuristic" | "llm_scoring" | "done" | "error") => void
  setRecognizedCharacters: (characters: RecognizedCharacter[]) => void
  setSelectedCharacterIds: (ids: string[]) => void
  clearRecognition: () => void

  // 查询
  getTask: (taskId: string) => BookAnalysisTask | null
  getTaskByProject: (projectPath: string) => BookAnalysisTask | null
  getCurrentTask: () => BookAnalysisTask | null
}

let taskIdCounter = 0

export const useBookAnalysisStore = create<BookAnalysisState>((set, get) => ({
  tasks: [],
  currentTaskId: null,
  selectedResultPath: null,
  currentResult: null,
  showResultViewer: false,

  // 角色识别初始 state（feature/character-recognition-and-simple-mode）
  recognitionStatus: "idle",
  recognizedCharacters: [],
  selectedCharacterIds: [],

  startTask: (projectPath: string, config: BookAnalysisConfig, abortController?: AbortController) => {
    const now = Date.now()
    const taskId = `book-analysis-${++taskIdCounter}-${now}`
    const normalizedPath = normalizePath(projectPath)

    // 生成 bookId（基于源文件路径的哈希或时间戳）
    const bookId = `book-${now}`

    const newTask: BookAnalysisTask = {
      id: taskId,
      projectPath: normalizedPath,
      bookId,
      config,
      progress: {
        stage: "reading_file",
        stageLabel: "读取文件中",
        completed: 0,
        total: 100,
        percentage: 0,
      },
      status: "running",
      startedAt: now,
      updatedAt: now,
      abortController,  // 存储 AbortController
      chapters: [],
      characters: [],
      skills: [],
    }

    set((state) => ({
      tasks: [newTask, ...state.tasks],
      currentTaskId: taskId,
    }))

    return taskId
  },

  updateTaskBookData: (taskId: string, bookId: string, chapters: BookAnalysisChapterSummary[]) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, bookId, chapters, updatedAt: Date.now() }
          : task
      ),
    }))
  },

  updateTaskProgress: (taskId: string, progressUpdate: Partial<BookAnalysisProgress>) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              progress: { ...task.progress, ...progressUpdate },
              updatedAt: Date.now(),
            }
          : task
      ),
    }))
  },

  updateTaskMetadata: (taskId: string, metadata: BookAnalysisMetadata) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, metadata, updatedAt: Date.now() }
          : task
      ),
    }))
  },

  updateTaskCharacters: (taskId: string, characters: ExtractedCharacter[]) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, characters, updatedAt: Date.now() }
          : task
      ),
    }))
  },

  updateTaskSkills: (taskId: string, skills: CharacterSkill[]) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, skills, updatedAt: Date.now() }
          : task
      ),
    }))
  },

  pauseTask: (taskId: string) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, status: "paused", updatedAt: Date.now() }
          : task
      ),
    }))
  },

  resumeTask: (taskId: string) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, status: "running", updatedAt: Date.now() }
          : task
      ),
      currentTaskId: taskId,
    }))
  },

  cancelTask: (taskId: string) => {
    set((state) => {
      const task = state.tasks.find((t) => t.id === taskId)
      if (task?.abortController) {
        task.abortController.abort()
      }
      return {
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: "error" as const,
                error: "用户取消分析",
                updatedAt: Date.now(),
              }
            : t
        ),
        currentTaskId: state.currentTaskId === taskId ? null : state.currentTaskId,
      }
    })
  },

  completeTask: (taskId: string) => {
    const now = Date.now()
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: "completed",
              progress: { ...task.progress, stage: "completed", percentage: 100 },
              completedAt: now,
              updatedAt: now,
            }
          : task
      ),
      currentTaskId: state.currentTaskId === taskId ? null : state.currentTaskId,
    }))
  },

  errorTask: (taskId: string, error: string) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: "error",
              error,
              progress: { ...task.progress, stage: "error" },
              updatedAt: Date.now(),
            }
          : task
      ),
      currentTaskId: state.currentTaskId === taskId ? null : state.currentTaskId,
    }))
  },

  removeTask: (taskId: string) => {
    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== taskId),
      currentTaskId: state.currentTaskId === taskId ? null : state.currentTaskId,
    }))
  },

  setSelectedResult: (projectPath: string | null) => {
    set({ selectedResultPath: projectPath ? normalizePath(projectPath) : null })
  },

  setCurrentResult: (result: BookAnalysisResult | null) => {
    set({ currentResult: result })
  },

  setShowResultViewer: (show: boolean) => {
    set({ showResultViewer: show })
  },

  // 角色识别 actions 实现（feature/character-recognition-and-simple-mode）
  setRecognitionStatus: (status) => set({ recognitionStatus: status }),
  setRecognizedCharacters: (characters) =>
    set({ recognizedCharacters: characters, recognitionStatus: "done" }),
  setSelectedCharacterIds: (ids) => set({ selectedCharacterIds: ids }),
  clearRecognition: () =>
    set({
      recognitionStatus: "idle",
      recognizedCharacters: [],
      selectedCharacterIds: [],
    }),

  getTask: (taskId: string) => {
    return get().tasks.find((task) => task.id === taskId) ?? null
  },

  getTaskByProject: (projectPath: string) => {
    const normalizedPath = normalizePath(projectPath)
    return (
      get().tasks
        .filter((task) => task.projectPath === normalizedPath)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
    )
  },

  getCurrentTask: () => {
    const { currentTaskId, tasks } = get()
    if (!currentTaskId) return null
    return tasks.find((task) => task.id === currentTaskId) ?? null
  },
}))
