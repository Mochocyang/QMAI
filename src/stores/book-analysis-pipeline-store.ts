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
  saveAnalysisChunk,
  saveAnalysisTask,
} from "@/lib/novel/book-analysis/analysis-pipeline-storage"
import {
  ANALYSIS_SKILL_ORDER,
  normalizeSelectedSkills,
  type AnalysisChapterRange,
  type AnalysisChunkRecord,
  type AnalysisSkill,
  type BookAnalysisPipelineTask,
} from "@/lib/novel/book-analysis/analysis-pipeline-types"
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

export interface BookAnalysisPipelineState {
  projectPath: string | null
  tasks: BookAnalysisPipelineTask[]
  chunks: AnalysisChunkRecord[]
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
  startTask(taskId: string): Promise<void>
  pauseTask(taskId: string): Promise<void>
  continueTask(taskId: string): Promise<void>
  retryFailedChunk(taskId: string, skill: AnalysisSkill, chunkId: string): Promise<void>
  cancelTask(taskId: string): Promise<void>
  dismissBatch(batchId: string): void
  dispose(): Promise<void>
}

export function createBookAnalysisPipelineStore() {
  let scheduler: AnalysisScheduler | null = null
  let unsubscribe: (() => void) | null = null
  let generation = 0

  return create<BookAnalysisPipelineState>((set, get) => ({
    projectPath: null,
    tasks: [],
    chunks: [],
    dismissedBatchIds: [],
    async initializeProject(rawPath) {
      generation += 1
      const token = generation
      unsubscribe?.()
      unsubscribe = null
      await scheduler?.dispose()
      scheduler = null
      const projectPath = normalizePath(rawPath).replace(/\/+$/, "")
      if (!projectPath) throw new Error("项目路径不能为空")
      set({ projectPath, tasks: [], chunks: [], dismissedBatchIds: [] })
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
      set({ tasks: mergedTasks, chunks: mergedChunks })
      setActiveAnalysisSnapshot(projectPath, mergedTasks)
      unsubscribe = nextScheduler.subscribe((snapshot) => {
        if (token !== generation || scheduler !== nextScheduler) return
        set({ tasks: snapshot.tasks, chunks: snapshot.chunks })
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
      const configured: BookAnalysisPipelineTask = {
        ...task,
        selectedSkills,
        range,
        status: "queued",
        currentSkill: null,
        error: null,
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
      for (const chunk of chunks) await saveAnalysisChunk(task.bookPath, chunk)
      set((state) => ({
        tasks: state.tasks.map((item) => item.id === taskId ? configured : item),
        chunks: [...state.chunks.filter((chunk) => chunk.taskId !== taskId), ...chunks],
      }))
      setActiveAnalysisSnapshot(task.projectPath, get().tasks)
    },
    async startTask(taskId) {
      const current = scheduler
      const task = get().tasks.find((item) => item.id === taskId)
      if (!current || !task) throw new Error("分析任务尚未初始化")
      if (!task.range || task.status === "awaiting-range") throw new Error("请先选择章节范围")
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
      set({ projectPath: null, tasks: [], chunks: [], dismissedBatchIds: [] })
    },
  }))
}

export const useBookAnalysisPipelineStore = createBookAnalysisPipelineStore()
