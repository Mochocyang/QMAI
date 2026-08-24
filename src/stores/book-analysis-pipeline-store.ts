import { create } from "zustand"
import { normalizePath } from "@/lib/path-utils"
import { useWikiStore } from "./wiki-store"
import { loadChapterList } from "@/lib/novel/book-analysis/analysis-engine"
import {
  buildAnalysisChunkPlan,
  computeAnalysisChunkCharLimit,
} from "@/lib/novel/book-analysis/analysis-chunk-planner"
import {
  loadAndRecoverAnalysisTasks,
  replaceAnalysisTaskChunks,
  saveAnalysisTask,
} from "@/lib/novel/book-analysis/analysis-pipeline-storage"
import {
  ANALYSIS_SKILL_ORDER,
  normalizeSelectedSkills,
  type AnalysisChapterRange,
  type AnalysisChunkRecord,
  type AnalysisRuntimeProgress,
  type AnalysisSkill,
  type BookAnalysisPipelineTask,
} from "@/lib/novel/book-analysis/analysis-pipeline-types"
import type { RecognizedCharacter } from "@/lib/novel/book-analysis/types"
import { createAnalysisScheduler, type AnalysisScheduler } from "@/lib/novel/book-analysis/analysis-scheduler"
import { characterAnalysisAdapter } from "@/lib/novel/book-analysis/character-analysis-adapter"
import { storyAnalysisAdapter } from "@/lib/novel/book-analysis/story-analysis-adapter"
import { styleAnalysisAdapter } from "@/lib/novel/book-analysis/style-analysis-adapter"
import { clearActiveAnalysisSnapshot, setActiveAnalysisSnapshot } from "@/lib/novel/book-analysis/analysis-active-registry"
import { resolveDefaultModel } from "@/lib/novel/model-resolver"
import { hasUsableLlm } from "@/lib/has-usable-llm"

let taskCounter = 0

function safeTaskId(batchId: string | null, bookId: string, forceNew: boolean): string {
  const base = `analysis-${batchId ?? "manual"}-${bookId}`.replace(/[^A-Za-z0-9_-]/g, "-")
  if (!forceNew) return base
  taskCounter += 1
  return `${base}-${Date.now().toString(36)}-${taskCounter.toString(36)}`
}

function initialTask(input: {
  projectPath: string
  bookId: string
  bookPath: string
  batchId: string | null
  selectedSkills: AnalysisSkill[]
  forceNew: boolean
}): BookAnalysisPipelineTask {
  const now = Date.now()
  const selectedSkills = normalizeSelectedSkills(input.selectedSkills)
  const placeholder = { startOrder: 1, endOrder: 1 }
  return {
    version: 1,
    id: safeTaskId(input.batchId, input.bookId, input.forceNew),
    batchId: input.batchId,
    projectPath: input.projectPath,
    bookId: input.bookId,
    bookPath: input.bookPath,
    selectedSkills,
    range: null,
    status: "awaiting-range",
    currentSkill: null,
    modules: Object.fromEntries(ANALYSIS_SKILL_ORDER.map((skill) => [skill, {
      skill,
      status: selectedSkills.includes(skill) ? "pending" : "skipped",
      range: placeholder,
      chunkIds: [],
      completedChunkIds: [],
      failedChunkId: null,
      resultPath: null,
      analysisVersion: 1,
      updatedAt: now,
    }])) as unknown as BookAnalysisPipelineTask["modules"],
    error: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
  }
}

interface BookAnalysisPipelineState {
  projectPath: string | null
  tasks: BookAnalysisPipelineTask[]
  chunks: AnalysisChunkRecord[]
  progresses: Record<string, AnalysisRuntimeProgress>
  dismissedBatchIds: string[]
  initializeProject(projectPath: string): Promise<void>
  createAwaitingRangeTask(input: {
    batchId?: string | null
    bookId: string
    bookPath: string
    selectedSkills: AnalysisSkill[]
    forceNew?: boolean
  }): Promise<BookAnalysisPipelineTask | null>
  configureTaskRange(taskId: string, range: AnalysisChapterRange, selectedSkills?: AnalysisSkill[]): Promise<void>
  setTaskRecognizedCharacters(taskId: string, characters: RecognizedCharacter[]): Promise<void>
  failTask(taskId: string, error: string): Promise<void>
  confirmCharacterSelection(taskId: string, selectedIds: string[]): Promise<void>
  /** 写入运行时进度（如角色识别）；scheduler 快照不会覆盖以 `:recognition` 结尾的 key */
  setRuntimeProgress(key: string, progress: AnalysisRuntimeProgress | null): void
  startTask(taskId: string): Promise<void>
  pauseTask(taskId: string): Promise<void>
  continueTask(taskId: string): Promise<void>
  retryFailedChunk(taskId: string, skill: AnalysisSkill, chunkId: string): Promise<void>
  cancelTask(taskId: string): Promise<void>
  dismissBatch(batchId: string): void
  dispose(): Promise<void>
}

function isRecognitionProgressKey(key: string): boolean {
  return key.endsWith(":recognition")
}

export function createBookAnalysisPipelineStore() {
  let scheduler: AnalysisScheduler | null = null
  let unsubscribe: (() => void) | null = null
  let generation = 0

  return create<BookAnalysisPipelineState>((set, get) => ({
    projectPath: null,
    tasks: [],
    chunks: [],
    progresses: {},
    dismissedBatchIds: [],
    async initializeProject(rawPath) {
      const projectPath = normalizePath(rawPath).replace(/\/+$/, "")
      if (!projectPath) throw new Error("项目路径不能为空")
      // 同项目已初始化且调度器仍在运行时，跳过重新初始化，
      // 避免组件卸载-重挂时清空进度、停止正在运行的分析任务
      if (get().projectPath === projectPath && scheduler) return
      generation += 1
      const token = generation
      unsubscribe?.()
      unsubscribe = null
      await scheduler?.dispose()
      scheduler = null
      set({ projectPath, tasks: [], chunks: [], progresses: {}, dismissedBatchIds: [] })
      const recovered = await loadAndRecoverAnalysisTasks(projectPath)
      if (token !== generation || get().projectPath !== projectPath) return
      const currentState = get()
      const mergedTasks = [...new Map(
        [...recovered.tasks, ...currentState.tasks].map((task) => [task.id, task]),
      ).values()]
      const mergedChunks = [...new Map(
        [...recovered.chunks, ...currentState.chunks].map((chunk) => [
          `${chunk.taskId}:${chunk.skill}:${chunk.id}`,
          chunk,
        ]),
      ).values()]
      const nextScheduler = createAnalysisScheduler({
        adapters: {
          characters: characterAnalysisAdapter,
          story: storyAnalysisAdapter,
          style: styleAnalysisAdapter,
        },
        llmConfig: () => resolveDefaultModel(useWikiStore.getState().llmConfig),
      })
      scheduler = nextScheduler
      nextScheduler.initialize(mergedTasks, mergedChunks)
      set({ tasks: mergedTasks, chunks: mergedChunks, progresses: {} })
      setActiveAnalysisSnapshot(projectPath, mergedTasks)
      unsubscribe = nextScheduler.subscribe((snapshot) => {
        if (token !== generation || scheduler !== nextScheduler) return
        set((state) => {
          const preserved = Object.fromEntries(
            Object.entries(state.progresses).filter(([key]) => isRecognitionProgressKey(key)),
          )
          return {
            tasks: snapshot.tasks,
            chunks: snapshot.chunks,
            progresses: { ...preserved, ...snapshot.progresses },
          }
        })
        setActiveAnalysisSnapshot(projectPath, snapshot.tasks)
      })
    },
    async createAwaitingRangeTask(input) {
      const projectPath = get().projectPath
      if (!projectPath) throw new Error("请先初始化拆书分析项目")
      const selectedSkills = normalizeSelectedSkills(input.selectedSkills)
      if (selectedSkills.length === 0) return null
      if (!input.forceNew) {
        const existing = get().tasks.find((task) => task.batchId === (input.batchId ?? null) && task.bookId === input.bookId)
        if (existing) return existing
      }
      const task = initialTask({
        projectPath,
        bookId: input.bookId,
        bookPath: normalizePath(input.bookPath),
        batchId: input.batchId ?? null,
        selectedSkills,
        forceNew: input.forceNew ?? false,
      })
      await saveAnalysisTask(task)
      set((state) => ({ tasks: [...state.tasks, task] }))
      setActiveAnalysisSnapshot(projectPath, [...get().tasks])
      return task
    },
    async configureTaskRange(taskId, range, nextSkills) {
      const task = get().tasks.find((item) => item.id === taskId)
      if (!task) throw new Error("未找到分析任务")
      const selectedSkills = normalizeSelectedSkills(nextSkills ?? task.selectedSkills)
      if (selectedSkills.length === 0) throw new Error("请至少选择一个提取项目")
      const chapters = await loadChapterList(task.bookPath)
      const llmConfig = resolveDefaultModel(useWikiStore.getState().llmConfig)
      const plan = buildAnalysisChunkPlan(
        chapters.map((chapter) => ({ id: chapter.chapterId, order: chapter.order, wordCount: chapter.wordCount })),
        range,
        { maxChunkChars: computeAnalysisChunkCharLimit(llmConfig.maxContextSize) },
      )
      const now = Date.now()
      const needsCharacterSelection = selectedSkills.includes("characters")
      const configured: BookAnalysisPipelineTask = {
        ...task,
        selectedSkills,
        range,
        status: needsCharacterSelection ? "awaiting-character-selection" : "queued",
        currentSkill: null,
        error: null,
        recognizedCharacters: undefined,
        targetCharacters: undefined,
        modules: Object.fromEntries(ANALYSIS_SKILL_ORDER.map((skill) => [skill, {
          ...task.modules[skill],
          status: selectedSkills.includes(skill) ? "pending" : "skipped",
          range,
          chunkIds: selectedSkills.includes(skill) ? plan.map((chunk) => chunk.id) : [],
          completedChunkIds: [],
          failedChunkId: null,
          resultPath: selectedSkills.includes(skill) ? null : task.modules[skill].resultPath,
          analysisVersion: task.modules[skill].analysisVersion + (selectedSkills.includes(skill) ? 1 : 0),
          updatedAt: now,
        }])) as unknown as BookAnalysisPipelineTask["modules"],
        updatedAt: now,
      }
      const chunks = selectedSkills.flatMap((skill) => plan.map((chunk): AnalysisChunkRecord => ({
        ...chunk,
        version: 1,
        taskId,
        skill,
        status: "pending",
        attempts: 0,
        resultPath: null,
        error: null,
        startedAt: null,
        completedAt: null,
        updatedAt: now,
      })))
      await saveAnalysisTask(configured)
      await replaceAnalysisTaskChunks(task.bookPath, taskId, chunks)
      set((state) => ({
        tasks: state.tasks.map((item) => item.id === taskId ? configured : item),
        chunks: [...state.chunks.filter((chunk) => chunk.taskId !== taskId), ...chunks],
      }))
      setActiveAnalysisSnapshot(task.projectPath, get().tasks)
    },
    async setTaskRecognizedCharacters(taskId, characters) {
      const task = get().tasks.find((item) => item.id === taskId)
      if (!task) throw new Error("未找到分析任务")
      if (task.status !== "awaiting-character-selection") {
        throw new Error("当前任务不在待选择角色状态")
      }
      const updated: BookAnalysisPipelineTask = {
        ...task,
        recognizedCharacters: characters,
        error: null,
        updatedAt: Date.now(),
      }
      await saveAnalysisTask(updated)
      set((state) => ({
        tasks: state.tasks.map((item) => item.id === taskId ? updated : item),
      }))
      setActiveAnalysisSnapshot(task.projectPath, get().tasks)
    },
    async failTask(taskId, error) {
      const task = get().tasks.find((item) => item.id === taskId)
      if (!task) throw new Error("未找到分析任务")
      const updated: BookAnalysisPipelineTask = {
        ...task,
        status: "failed",
        error,
        updatedAt: Date.now(),
      }
      await saveAnalysisTask(updated)
      set((state) => ({
        tasks: state.tasks.map((item) => item.id === taskId ? updated : item),
      }))
      setActiveAnalysisSnapshot(task.projectPath, get().tasks)
    },
    async confirmCharacterSelection(taskId, selectedIds) {
      const task = get().tasks.find((item) => item.id === taskId)
      if (!task) throw new Error("未找到分析任务")
      if (task.status !== "awaiting-character-selection") {
        throw new Error("当前任务不在待选择角色状态")
      }
      const recognized = task.recognizedCharacters ?? []
      if (recognized.length === 0) throw new Error("尚未完成角色识别")
      const idSet = new Set(selectedIds)
      const targetCharacters = recognized.filter((character) => idSet.has(character.id))
      if (targetCharacters.length === 0) throw new Error("请至少选择一个角色")
      const updated: BookAnalysisPipelineTask = {
        ...task,
        targetCharacters,
        status: "queued",
        error: null,
        updatedAt: Date.now(),
      }
      await saveAnalysisTask(updated)
      set((state) => ({
        tasks: state.tasks.map((item) => item.id === taskId ? updated : item),
      }))
      setActiveAnalysisSnapshot(task.projectPath, get().tasks)
    },
    setRuntimeProgress(key, progress) {
      set((state) => {
        if (progress === null) {
          if (!(key in state.progresses)) return state
          const next = { ...state.progresses }
          delete next[key]
          return { progresses: next }
        }
        return {
          progresses: {
            ...state.progresses,
            [key]: {
              stageLabel: progress.stageLabel,
              percentage: Math.max(0, Math.min(100, Math.round(progress.percentage))),
              ...(progress.currentItem ? { currentItem: progress.currentItem } : {}),
            },
          },
        }
      })
    },
    async startTask(taskId) {
      const current = scheduler
      const task = get().tasks.find((item) => item.id === taskId)
      if (!current || !task) throw new Error("分析任务尚未初始化")
      if (!task.range || task.status === "awaiting-range") throw new Error("请先选择章节范围")
      if (task.status === "awaiting-character-selection") {
        throw new Error("请先选择要深度分析的角色")
      }
      const wikiState = useWikiStore.getState()
      if (!hasUsableLlm(resolveDefaultModel(wikiState.llmConfig), wikiState.providerConfigs)) {
        throw new Error("未配置可用模型，请先在设置中配置默认模型")
      }
      await current.enqueue(task, get().chunks.filter((chunk) => chunk.taskId === taskId))
    },
    async pauseTask(taskId) {
      if (!scheduler) throw new Error("分析任务尚未初始化")
      await scheduler.pauseTask(taskId)
    },
    async continueTask(taskId) {
      if (!scheduler) throw new Error("分析任务尚未初始化")
      await scheduler.continueTask(taskId)
    },
    async retryFailedChunk(taskId, skill, chunkId) {
      if (!scheduler) throw new Error("分析任务尚未初始化")
      await scheduler.retryFailedChunk(taskId, skill, chunkId)
    },
    async cancelTask(taskId) {
      const task = get().tasks.find((item) => item.id === taskId)
      if (!task) throw new Error("未找到分析任务")
      if (task.status === "awaiting-range" || task.status === "awaiting-character-selection") {
        const updated: BookAnalysisPipelineTask = {
          ...task,
          status: "cancelled",
          error: null,
          updatedAt: Date.now(),
        }
        await saveAnalysisTask(updated)
        set((state) => ({
          tasks: state.tasks.map((item) => item.id === taskId ? updated : item),
        }))
        setActiveAnalysisSnapshot(task.projectPath, get().tasks)
        return
      }
      if (!scheduler) throw new Error("分析任务尚未初始化")
      await scheduler.cancelTask(taskId)
    },
    dismissBatch(batchId) {
      set((state) => ({ dismissedBatchIds: [...new Set([...state.dismissedBatchIds, batchId])] }))
    },
    async dispose() {
      generation += 1
      const projectPath = get().projectPath
      unsubscribe?.()
      unsubscribe = null
      await scheduler?.dispose()
      scheduler = null
      if (projectPath) clearActiveAnalysisSnapshot(projectPath)
      set({ projectPath: null, tasks: [], chunks: [], progresses: {}, dismissedBatchIds: [] })
    },
  }))
}

export const useBookAnalysisPipelineStore = createBookAnalysisPipelineStore()
