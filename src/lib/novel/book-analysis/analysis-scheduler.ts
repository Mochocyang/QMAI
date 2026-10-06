import { LlmRequestTraceCollector, copyLlmRequestCacheTrace, type LlmRequestCacheTrace } from "@/lib/llm-request-trace"
import { createAnalysisStageCache, type AnalysisStageCache, type AnalysisStageCacheInput } from "./analysis-stage-cache"
import type { LlmConfig } from "@/stores/wiki-store"
import { withWritingWakeLock } from "@/lib/writing-wake-lock"
import { resolveRuntimeLocalCliConfig } from "@/lib/local-cli-config"
import { createAnalysisResultCache, type AnalysisResultCache, type AnalysisResultCacheInput } from "./analysis-result-cache"
import {
  loadAnalysisChunkResult,
  saveAnalysisChunk,
  saveAnalysisTask,
  saveCompletedChunk,
} from "./analysis-pipeline-storage"
import {
  ANALYSIS_SKILL_ORDER,
  analysisProgressKey,
  normalizeSelectedSkills,
  type AnalysisChunkRecord,
  type AnalysisEvidenceSnippet,
  type AnalysisModuleState,
  type AnalysisRuntimeProgress,
  type AnalysisSkill,
  type BookAnalysisPipelineTask,
} from "./analysis-pipeline-types"
import type {
  AnalysisChunkOutput,
  AnalysisSkillAdapter,
  AnalysisSkillContext,
} from "./analysis-skill-adapter"

export interface AnalysisSchedulerSnapshot {
  tasks: BookAnalysisPipelineTask[]
  chunks: AnalysisChunkRecord[]
  progresses: Record<string, AnalysisRuntimeProgress>
}

export interface AnalysisScheduler {
  initialize(tasks: BookAnalysisPipelineTask[], chunks: AnalysisChunkRecord[]): void
  registerTask(task: BookAnalysisPipelineTask, chunks?: AnalysisChunkRecord[]): Promise<void>
  enqueue(task: BookAnalysisPipelineTask, chunks: AnalysisChunkRecord[]): Promise<void>
  pauseTask(taskId: string): Promise<void>
  continueTask(taskId: string): Promise<void>
  retryFailedChunk(taskId: string, skill: AnalysisSkill, chunkId: string): Promise<void>
  cancelTask(taskId: string): Promise<void>
  recordRequestTrace(task: BookAnalysisPipelineTask, trace: LlmRequestCacheTrace): Promise<void>
  getSnapshot(): AnalysisSchedulerSnapshot
  subscribe(listener: (snapshot: AnalysisSchedulerSnapshot) => void): () => void
  whenIdle(): Promise<void>
  dispose(): Promise<void>
}

interface AnalysisSchedulerOptions {
  adapters: Record<AnalysisSkill, AnalysisSkillAdapter>
  /**
   * 模型解析。传函数时会拿到当前任务，用于让每个任务用回自己选定的 `task.modelKey`；
   * 暂停/继续和并行任务都靠这个保证模型不会串。
   */
  llmConfig: LlmConfig | ((task: BookAnalysisPipelineTask) => LlmConfig)
  concurrency?: number
  saveTask?: typeof saveAnalysisTask
  saveChunk?: typeof saveAnalysisChunk
  saveCompletedChunk?: typeof saveCompletedChunk
  loadChunkResult?: typeof loadAnalysisChunkResult
  resultCache?: AnalysisResultCache
  stageCache?: AnalysisStageCache
  now?: () => number
}

function chunkKey(chunk: Pick<AnalysisChunkRecord, "taskId" | "skill" | "id">): string {
  return `${chunk.taskId}:${chunk.skill}:${chunk.id}`
}

function copyTask(task: BookAnalysisPipelineTask): BookAnalysisPipelineTask {
  return {
    ...task,
    ...(task.workbenchRequest ? { workbenchRequest: structuredClone(task.workbenchRequest) } : {}),
    selectedSkills: [...task.selectedSkills],
    requestTraces: task.requestTraces?.map(copyLlmRequestCacheTrace),
    requestTraceIds: task.requestTraceIds ? [...task.requestTraceIds] : undefined,
    requestUsageTotals: task.requestUsageTotals ? { ...task.requestUsageTotals } : undefined,
    resultReuse: task.resultReuse ? { ...task.resultReuse } : undefined,
    range: task.range ? { ...task.range } : null,
    recognizedCharacters: task.recognizedCharacters?.map((character) => ({
      ...character,
      aliases: [...character.aliases],
      chapterIndices: [...character.chapterIndices],
    })),
    targetCharacters: task.targetCharacters?.map((character) => ({
      ...character,
      aliases: [...character.aliases],
      chapterIndices: [...character.chapterIndices],
    })),
    modules: Object.fromEntries(ANALYSIS_SKILL_ORDER.map((skill) => [skill, {
      ...task.modules[skill],
      range: { ...task.modules[skill].range },
      chunkIds: [...task.modules[skill].chunkIds],
      completedChunkIds: [...task.modules[skill].completedChunkIds],
    }])) as BookAnalysisPipelineTask["modules"],
  }
}

function copyChunk(chunk: AnalysisChunkRecord): AnalysisChunkRecord {
  return { ...chunk, chapterIds: [...chunk.chapterIds], ...(chunk.segments ? { segments: chunk.segments.map((s) => ({ ...s })) } : {}) }
}

function clampProgress(progress: AnalysisRuntimeProgress): AnalysisRuntimeProgress {
  return {
    stageLabel: progress.stageLabel,
    percentage: Math.max(0, Math.min(100, Math.round(progress.percentage))),
    ...(progress.currentItem ? { currentItem: progress.currentItem } : {}),
  }
}

export function createAnalysisScheduler(options: AnalysisSchedulerOptions): AnalysisScheduler {
  // 全局 chunk 并发：从默认 2 提升到 4，配合「多任务并行」——同一作品的角色/故事/文风
  // 可各自推进区块，而非互相等待。仍允许调用方通过 options.concurrency 覆盖。
  const concurrency = Math.max(1, Math.min(6, Math.floor(options.concurrency ?? 4)))
  const persistTask = options.saveTask ?? saveAnalysisTask
  const persistChunk = options.saveChunk ?? saveAnalysisChunk
  const persistCompletedChunk = options.saveCompletedChunk ?? saveCompletedChunk
  const readChunkResult = options.loadChunkResult ?? loadAnalysisChunkResult
  const now = options.now ?? Date.now
  const resultCache = options.resultCache ?? createAnalysisResultCache({ now })
  const stageCache = options.stageCache ?? createAnalysisStageCache({ now })
  const collectors = new Map<string, LlmRequestTraceCollector>()
  const taskWrites = new Map<string, Promise<void>>()
  const tasks = new Map<string, BookAnalysisPipelineTask>()
  const chunks = new Map<string, AnalysisChunkRecord>()
  const progresses = new Map<string, AnalysisRuntimeProgress>()
  const taskRuns = new Map<string, Promise<void>>()
  const chunkRuns = new Map<string, Promise<void>>()
  const controllers = new Map<string, AbortController>()
  const pauseRequested = new Set<string>()
  const cancelRequested = new Set<string>()
  const listeners = new Set<(snapshot: AnalysisSchedulerSnapshot) => void>()
  let disposed = false
  let activeChunks = 0
  const permitWaiters: Array<() => void> = []

  function snapshot(): AnalysisSchedulerSnapshot {
    return {
      tasks: [...tasks.values()].map(copyTask),
      chunks: [...chunks.values()].map(copyChunk),
      progresses: Object.fromEntries(
        [...progresses.entries()].map(([key, progress]) => [key, { ...progress }]),
      ),
    }
  }

  function notify(): void {
    if (disposed) return
    const value = snapshot()
    for (const listener of listeners) listener(value)
  }

  function reportProgress(key: string, progress: AnalysisRuntimeProgress): void {
    const next = clampProgress(progress)
    const prev = progresses.get(key)
    if (
      prev
      && prev.stageLabel === next.stageLabel
      && prev.currentItem === next.currentItem
      && Math.abs(prev.percentage - next.percentage) < 1
    ) {
      return
    }
    progresses.set(key, next)
    notify()
  }

  function clearProgress(key: string): void {
    if (!progresses.delete(key)) return
    notify()
  }

  function clearProgressesForTask(taskId: string): void {
    let changed = false
    for (const key of [...progresses.keys()]) {
      if (key.startsWith(`${taskId}:`)) {
        progresses.delete(key)
        changed = true
      }
    }
    if (changed) notify()
  }

  function resolveLlmConfig(task: BookAnalysisPipelineTask): LlmConfig {
    return typeof options.llmConfig === "function" ? options.llmConfig(task) : options.llmConfig
  }

  async function acquirePermit(): Promise<void> {
    if (activeChunks < concurrency) {
      activeChunks += 1
      return
    }
    await new Promise<void>((resolve) => permitWaiters.push(resolve))
    activeChunks += 1
  }

  function releasePermit(): void {
    activeChunks = Math.max(0, activeChunks - 1)
    permitWaiters.shift()?.()
  }

  function collectorFor(task: BookAnalysisPipelineTask): LlmRequestTraceCollector {
    let collector = collectors.get(task.id)
    if (!collector) {
      collector = new LlmRequestTraceCollector(task.requestUsageTotals ? {
        requests: task.requestTraces ?? [], omittedRequestCount: task.omittedRequestTraceCount ?? 0,
        usageTotals: task.requestUsageTotals, requestIds: task.requestTraceIds,
      } : undefined)
      collectors.set(task.id, collector)
    }
    return collector
  }

  function queueTaskWrite(taskId: string): Promise<void> {
    const pending = (taskWrites.get(taskId) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const latest = tasks.get(taskId)
      if (latest) await persistTask(copyTask(latest))
    })
    taskWrites.set(taskId, pending)
    const clear = () => { if (taskWrites.get(taskId) === pending) taskWrites.delete(taskId) }
    void pending.then(clear, clear)
    return pending
  }

  async function updateTask(task: BookAnalysisPipelineTask): Promise<void> {
    const latest = tasks.get(task.id)
    const collector = collectors.get(task.id)
    const ledger = collector?.snapshot()
    tasks.set(task.id, {
      ...task,
      resultReuse: latest?.resultReuse ?? task.resultReuse,
      ...(ledger ? { requestTraces: ledger.requests, requestTraceIds: ledger.requestIds, requestUsageTotals: ledger.usageTotals,
        omittedRequestTraceCount: ledger.omittedRequestCount } : {}),
    })
    await queueTaskWrite(task.id)
    notify()
  }

  async function recordRequestTrace(task: BookAnalysisPipelineTask, trace: LlmRequestCacheTrace): Promise<void> {
    const current = tasks.get(task.id)
    // 项目切换只停止界面通知；已发出的后台校验仍须落到它所属的旧任务账本。
    if (disposed && !current) return
    // 识别阶段尚未 enqueue；进入运行后始终保留最新状态，后台回调不回写旧任务副本。
    const latest = current && (taskRuns.has(task.id) || current.updatedAt >= task.updatedAt) ? current : task
    const collector = collectorFor(latest)
    collector.record(trace)
    const ledger = collector.snapshot()
    tasks.set(task.id, { ...latest, requestTraces: ledger.requests, requestTraceIds: ledger.requestIds, requestUsageTotals: ledger.usageTotals,
      omittedRequestTraceCount: ledger.omittedRequestCount })
    notify()
    await queueTaskWrite(task.id)
  }

  function recordReuse(taskId: string, stage: "chunk" | "aggregate", hit: boolean): void {
    const task = tasks.get(taskId)
    if (!task) return
    const reuse = { chunkChecks: 0, chunkHits: 0, aggregateChecks: 0, aggregateHits: 0, ...task.resultReuse }
    if (stage === "chunk") { reuse.chunkChecks += 1; if (hit) reuse.chunkHits += 1 }
    else { reuse.aggregateChecks += 1; if (hit) reuse.aggregateHits += 1 }
    tasks.set(taskId, { ...task, resultReuse: reuse })
  }

  async function registerTask(task: BookAnalysisPipelineTask, nextChunks?: AnalysisChunkRecord[]): Promise<void> {
    if (disposed) return
    if (nextChunks) {
      const nextKeys = new Set(nextChunks.map((chunk) => chunkKey(chunk)))
      for (const [key, chunk] of chunks) {
        if (chunk.taskId === task.id && !nextKeys.has(key)) chunks.delete(key)
      }
      for (const chunk of nextChunks) chunks.set(chunkKey(chunk), copyChunk(chunk))
    }
    await updateTask(copyTask(task))
  }

  function contextFor(task: BookAnalysisPipelineTask, skill: AnalysisSkill, stage = "chunk"): AnalysisSkillContext {
    return {
      task: copyTask(task),
      skill,
      bookPath: task.bookPath,
      projectPath: task.projectPath,
      llmConfig: resolveLlmConfig(task),
      onRequestTrace: (trace) => {
        void recordRequestTrace(task, { ...trace, surface: "book-analysis", stage: trace.stage ?? `${skill}:${stage}` })
          .catch(() => console.warn("拆书请求用量保存失败，内存中的统计仍保留"))
      },
    }
  }

  async function cacheInputFor(
    task: BookAnalysisPipelineTask,
    skill: AnalysisSkill,
    chunk: AnalysisChunkRecord,
  ): Promise<AnalysisResultCacheInput> {
    const context = contextFor(task, skill, "chunk")
    context.llmConfig = await resolveRuntimeLocalCliConfig(context.llmConfig)
    return { ...context, chunk }
  }

  async function runChunk(task: BookAnalysisPipelineTask, skill: AnalysisSkill, chunk: AnalysisChunkRecord): Promise<void> {
    const key = chunkKey(chunk)
    const existing = chunkRuns.get(key)
    if (existing) return existing

    const operation = (async () => {
      await acquirePermit()
      if (disposed || pauseRequested.has(task.id) || cancelRequested.has(task.id)) {
        releasePermit()
        return
      }
      const controller = new AbortController()
      controllers.set(key, controller)
      const startedAt = now()
      const running: AnalysisChunkRecord = {
        ...chunk,
        status: "running",
        attempts: chunk.attempts + 1,
        error: null,
        startedAt,
        completedAt: null,
        updatedAt: startedAt,
      }
      chunks.set(key, running)
      reportProgress(key, { stageLabel: "准备分析区块…", percentage: 1 })
      await persistChunk(task.bookPath, running)
      notify()

      try {
        const input = await cacheInputFor(task, skill, running)
        let cacheKey: string | null = null
        let output: AnalysisChunkOutput | null = null
        try {
          cacheKey = await resultCache.createKey(input)
          if (cacheKey && !input.task.forceRefresh && !controller.signal.aborted) {
            output = await resultCache.read(input, cacheKey)
            if (output) {
              const current = await cacheInputFor(tasks.get(task.id) ?? task, skill, running)
              if (await resultCache.createKey(current) !== cacheKey) {
                output = null
                cacheKey = null
              }
            }
          }
        } catch {
          // 内容哈希或缓存读取失败只影响复用，不影响正常分析。
          output = null
          cacheKey = null
        }
        if (controller.signal.aborted) throw new Error("分析任务已取消")
        const reused = output !== null
        if (cacheKey) recordReuse(task.id, "chunk", reused)
        if (!output) {
          output = await options.adapters[skill].runChunk({
            ...input,
            signal: controller.signal,
            onProgress: (progress) => reportProgress(key, progress),
          })
        } else {
          reportProgress(key, { stageLabel: "复用已完成的区块分析", percentage: 95 })
        }
        if (controller.signal.aborted) throw new Error("分析任务已取消")
        const completed = await persistCompletedChunk(task.bookPath, running, output)
        if (!reused && cacheKey && !controller.signal.aborted) {
          try {
            const current = await cacheInputFor(tasks.get(task.id) ?? task, skill, running)
            if (await resultCache.createKey(current) === cacheKey && !controller.signal.aborted) {
              await resultCache.write(input, cacheKey, output, controller.signal)
            }
          } catch {
            // 原文或有效配置在运行中变化、缓存落盘失败时，不写旧 key。
          }
        }
        chunks.set(key, completed)
        clearProgress(key)
        notify()
      } catch (error) {
        const failedAt = now()
        const aborted = controller.signal.aborted || cancelRequested.has(task.id)
        const failed: AnalysisChunkRecord = {
          ...running,
          status: aborted ? "cancelled" : "failed",
          error: aborted ? "用户取消分析" : (error instanceof Error ? error.message : "章节区块分析失败"),
          completedAt: null,
          updatedAt: failedAt,
        }
        chunks.set(key, failed)
        clearProgress(key)
        await persistChunk(task.bookPath, failed)
        notify()
        throw error
      } finally {
        controllers.delete(key)
        releasePermit()
      }
    })().finally(() => chunkRuns.delete(key))
    chunkRuns.set(key, operation)
    return operation
  }

  function chunksFor(taskId: string, skill: AnalysisSkill): AnalysisChunkRecord[] {
    return [...chunks.values()]
      .filter((chunk) => chunk.taskId === taskId && chunk.skill === skill)
      .sort((left, right) => left.startOrder - right.startOrder)
  }

  async function markTaskStopped(task: BookAnalysisPipelineTask, status: "paused" | "cancelled"): Promise<void> {
    const stoppedAt = now()
    clearProgressesForTask(task.id)
    await updateTask({
      ...task,
      status,
      error: status === "cancelled" ? "用户取消分析" : null,
      currentSkill: status === "cancelled" ? null : task.currentSkill,
      completedAt: status === "cancelled" ? stoppedAt : null,
      updatedAt: stoppedAt,
    })
  }

  async function runTaskInternal(taskId: string): Promise<void> {
    let task = tasks.get(taskId)
    if (!task || disposed) return
    collectorFor(task)
    const startedAt = task.startedAt ?? now()
    task = {
      ...task,
      selectedSkills: normalizeSelectedSkills(task.selectedSkills),
      status: "running",
      error: null,
      startedAt,
      completedAt: null,
      updatedAt: now(),
    }
    await updateTask(task)

    try {
      for (const skill of task.selectedSkills) {
        task = tasks.get(taskId) ?? task
        if (cancelRequested.has(taskId)) {
          await markTaskStopped(task, "cancelled")
          return
        }
        if (pauseRequested.has(taskId)) {
          await markTaskStopped(task, "paused")
          return
        }
        if (task.modules[skill].status === "completed") continue

        const runningModule: AnalysisModuleState = {
          ...task.modules[skill],
          status: "running" as const,
          failedChunkId: null,
          updatedAt: now(),
        }
        task = {
          ...task,
          currentSkill: skill,
          modules: { ...task.modules, [skill]: runningModule },
          updatedAt: now(),
        }
        await updateTask(task)

        while (true) {
          if (cancelRequested.has(taskId)) {
            await markTaskStopped(tasks.get(taskId) ?? task, "cancelled")
            return
          }
          if (pauseRequested.has(taskId)) {
            await markTaskStopped(tasks.get(taskId) ?? task, "paused")
            return
          }
          const expectedIds = new Set(task.modules[skill].chunkIds)
          // 只调度 pending；failed 需 continue/retry 显式重置后再跑，避免同轮无限重试
          const pending = chunksFor(taskId, skill)
            .filter((chunk) => expectedIds.has(chunk.id) && chunk.status === "pending")
            .slice(0, concurrency)
          if (pending.length === 0) break
          await Promise.allSettled(pending.map((chunk) => runChunk(task!, skill, chunk)))
        }

        const expectedIds = new Set(task.modules[skill].chunkIds)
        const completedChunks = chunksFor(taskId, skill).filter(
          (chunk) => expectedIds.has(chunk.id) && chunk.status === "completed",
        )
        const failedChunks = chunksFor(taskId, skill).filter(
          (chunk) => expectedIds.has(chunk.id) && (chunk.status === "failed" || chunk.status === "cancelled"),
        )
        if (completedChunks.length === 0) {
          throw new Error(failedChunks[0]?.error || "章节区块尚未全部完成，无法汇总")
        }
        if (task.workbenchVersion === 2 && completedChunks.length !== expectedIds.size) {
          throw new Error(`所选区块尚未全部成功（${completedChunks.length}/${expectedIds.size}），请重试失败区块后汇总`)
        }

        const outputs: AnalysisChunkOutput[] = []
        for (const chunk of completedChunks) {
          const output = await readChunkResult<AnalysisChunkOutput>(chunk)
          if (!output) throw new Error(`第 ${chunk.startOrder}～${chunk.endOrder} 章结果缺失，无法汇总`)
          outputs.push(output)
        }
        const aggregateController = new AbortController()
        const aggregateKey = analysisProgressKey(taskId, skill, "aggregate")
        controllers.set(aggregateKey, aggregateController)
        reportProgress(aggregateKey, { stageLabel: "正在汇总…", percentage: 92 })
        let result: unknown
        try {
          const context = contextFor(task, skill, "aggregate")
          context.llmConfig = await resolveRuntimeLocalCliConfig(context.llmConfig)
          const prepareCacheInput = async (): Promise<AnalysisStageCacheInput | null> => {
            if (outputs.some((output) => output.result && typeof output.result === "object"
              && "cacheable" in output.result && output.result.cacheable === false)) return null
            const sourceKeys = await Promise.all(completedChunks.map(async (chunk) =>
              resultCache.createKey(await cacheInputFor(tasks.get(taskId) ?? task!, skill, chunk))))
            if (sourceKeys.some((value) => !value)) return null
            const evidenceIds = outputs.flatMap((output) => output.evidence.map((item) => item.id))
            return { bookPath: task!.bookPath, projectPath: task!.projectPath, llmConfig: context.llmConfig,
              stage: `aggregate-${skill}`,
              materials: { sourceKeys, chunks: JSON.parse(JSON.stringify(outputs.map((output) => output.result), (key, value) => {
                if (["createdAt", "updatedAt", "generatedAt", "taskId"].includes(key)) return undefined
                if (typeof value === "string" && evidenceIds.includes(value)) return `@evidence-${evidenceIds.indexOf(value)}`
                return value
              })) },
            }
          }
          let cacheInput: AnalysisStageCacheInput | null = null
          let aggregateCacheKey: string | null = null
          let cached: { result: unknown; evidenceIds: string[] } | null = null
          try {
            cacheInput = await prepareCacheInput()
            aggregateCacheKey = cacheInput ? await stageCache.createKey(cacheInput) : null
            if (cacheInput && aggregateCacheKey && !task.forceRefresh) {
              cached = await stageCache.read(cacheInput, aggregateCacheKey)
              const current = await prepareCacheInput()
              if (!current || await stageCache.createKey(current) !== aggregateCacheKey) cached = null
            }
          } catch { cached = null }
          const evidenceIds = outputs.flatMap((output) => output.evidence.map((item) => item.id))
          if (cached && (!Array.isArray(cached.evidenceIds) || cached.evidenceIds.length !== evidenceIds.length || cached.result == null)) cached = null
          if (aggregateCacheKey) recordReuse(taskId, "aggregate", cached !== null)
          if (aggregateController.signal.aborted) throw new Error("分析任务已取消")
          if (cached) {
            const oldIds = cached.evidenceIds
            result = JSON.parse(JSON.stringify(cached.result, (_key, value) =>
              typeof value === "string" && oldIds.includes(value) ? evidenceIds[oldIds.indexOf(value)] : value))
            reportProgress(aggregateKey, { stageLabel: "复用已完成的汇总", percentage: 95 })
          } else {
            result = await options.adapters[skill].aggregate({
              ...context, chunks: outputs.map((output) => output.result), signal: aggregateController.signal,
              onProgress: (progress) => reportProgress(aggregateKey, progress),
            })
            if (cacheInput && aggregateCacheKey && !aggregateController.signal.aborted
              && !(result && typeof result === "object" && "cacheable" in result && result.cacheable === false)) {
              try {
                const current = await prepareCacheInput()
                if (current && await stageCache.createKey(current) === aggregateCacheKey) {
                  await stageCache.write(cacheInput, aggregateCacheKey, { result, evidenceIds }, aggregateController.signal)
                }
              } catch { /* 缓存失败不影响汇总。 */ }
            }
          }
          if (aggregateController.signal.aborted) throw new Error("分析任务已取消")
        } finally {
          controllers.delete(aggregateKey)
          clearProgress(aggregateKey)
        }
        const evidence: AnalysisEvidenceSnippet[] = outputs.flatMap((output) => output.evidence)
        const publishController = new AbortController()
        const publishKey = analysisProgressKey(taskId, skill, "publish")
        controllers.set(publishKey, publishController)
        reportProgress(publishKey, { stageLabel: "正在发布结果…", percentage: 96 })
        let resultPath: string
        try {
          resultPath = await options.adapters[skill].publish({
            ...contextFor(task, skill, "publish"),
            result,
            evidence,
            signal: publishController.signal,
            onProgress: (progress) => reportProgress(publishKey, progress),
          })
        } finally {
          controllers.delete(publishKey)
          clearProgress(publishKey)
        }

        task = tasks.get(taskId) ?? task
        const completedAt = now()
        const partialSummary = failedChunks.length > 0
          ? `已用 ${completedChunks.length}/${expectedIds.size} 个成功区块完成汇总；${failedChunks.length} 个区块失败已跳过`
          : undefined
        task = {
          ...task,
          modules: {
            ...task.modules,
            [skill]: {
              ...task.modules[skill],
              status: "completed",
              completedChunkIds: completedChunks.map((chunk) => chunk.id),
              failedChunkId: failedChunks[0]?.id ?? null,
              resultPath,
              summary: partialSummary ?? task.modules[skill].summary,
              updatedAt: completedAt,
            },
          },
          updatedAt: completedAt,
        }
        await updateTask(task)
      }

      const completedAt = now()
      clearProgressesForTask(taskId)
      await updateTask({
        ...(tasks.get(taskId) ?? task),
        status: "completed",
        currentSkill: null,
        error: null,
        completedAt,
        updatedAt: completedAt,
      })
    } catch (error) {
      task = tasks.get(taskId) ?? task
      if (cancelRequested.has(taskId)) {
        await markTaskStopped(task, "cancelled")
        return
      }
      if (pauseRequested.has(taskId)) {
        await markTaskStopped(task, "paused")
        return
      }
      const failedSkill = task.currentSkill
      const failedAt = now()
      clearProgressesForTask(taskId)
      await updateTask({
        ...task,
        status: "failed",
        error: error instanceof Error ? error.message : "分析任务失败",
        modules: failedSkill ? {
          ...task.modules,
          [failedSkill]: {
            ...task.modules[failedSkill],
            status: "failed",
            failedChunkId: chunksFor(taskId, failedSkill).find((chunk) => chunk.status === "failed")?.id ?? null,
            updatedAt: failedAt,
          },
        } : task.modules,
        updatedAt: failedAt,
      })
    }
  }

  function runTask(taskId: string): Promise<void> {
    if (disposed) return Promise.resolve()
    const existing = taskRuns.get(taskId)
    if (existing) return existing
    const operation = withWritingWakeLock(true, () => runTaskInternal(taskId)).finally(() => {
      taskRuns.delete(taskId)
      pauseRequested.delete(taskId)
      cancelRequested.delete(taskId)
    })
    taskRuns.set(taskId, operation)
    return operation
  }

  return {
    initialize(nextTasks, nextChunks) {
      tasks.clear()
      collectors.clear()
      chunks.clear()
      progresses.clear()
      for (const task of nextTasks) tasks.set(task.id, copyTask(task))
      for (const chunk of nextChunks) chunks.set(chunkKey(chunk), copyChunk(chunk))
      notify()
    },
    recordRequestTrace,
    registerTask,
    async enqueue(task, nextChunks) {
      await registerTask(task, nextChunks)
      await runTask(task.id)
    },
    async pauseTask(taskId) {
      const task = tasks.get(taskId)
      if (!task || task.status === "completed" || task.status === "cancelled") return
      pauseRequested.add(taskId)
      const running = taskRuns.get(taskId)
      if (running) await running
      else await markTaskStopped(task, "paused")
    },
    async continueTask(taskId) {
      const task = tasks.get(taskId)
      if (!task || task.status === "completed") return
      pauseRequested.delete(taskId)
      cancelRequested.delete(taskId)
      // 断点继续：把失败/取消区块重置为 pending，并恢复失败 Skill
      for (const chunk of [...chunks.values()].filter((item) => item.taskId === taskId)) {
        if (chunk.status !== "failed" && chunk.status !== "cancelled") continue
        const reset = {
          ...chunk,
          status: "pending" as const,
          error: null,
          startedAt: null,
          completedAt: null,
          updatedAt: now(),
        }
        chunks.set(chunkKey(chunk), reset)
        await persistChunk(task.bookPath, reset)
      }
      if (task.status === "failed") {
        const failedSkill = task.currentSkill
          ?? ANALYSIS_SKILL_ORDER.find((skill) => task.modules[skill].status === "failed")
          ?? null
        await updateTask({
          ...task,
          status: "queued",
          error: null,
          modules: failedSkill ? {
            ...task.modules,
            [failedSkill]: {
              ...task.modules[failedSkill],
              status: "pending",
              failedChunkId: null,
              updatedAt: now(),
            },
          } : task.modules,
          updatedAt: now(),
        })
      }
      notify()
      await runTask(taskId)
    },
    async retryFailedChunk(taskId, skill, chunkId) {
      const task = tasks.get(taskId)
      if (!task) throw new Error("未找到分析任务")
      const key = `${taskId}:${skill}:${chunkId}`
      const chunk = chunks.get(key)
      if (!chunk || (chunk.status !== "failed" && chunk.status !== "cancelled")) {
        throw new Error("未找到可重试的失败区块")
      }
      const reset = { ...chunk, status: "pending" as const, error: null, startedAt: null, completedAt: null, updatedAt: now() }
      chunks.set(key, reset)
      await persistChunk(task.bookPath, reset)
      await runTask(taskId)
    },
    async cancelTask(taskId) {
      const task = tasks.get(taskId)
      if (!task || task.status === "completed" || task.status === "cancelled") return
      cancelRequested.add(taskId)
      for (const [key, controller] of controllers) {
        if (key.startsWith(`${taskId}:`)) controller.abort()
      }
      const running = taskRuns.get(taskId)
      if (running) await running
      else await markTaskStopped(task, "cancelled")
    },
    getSnapshot: snapshot,
    subscribe(listener) {
      listeners.add(listener)
      listener(snapshot())
      return () => listeners.delete(listener)
    },
    async whenIdle() {
      while (taskRuns.size > 0) await Promise.allSettled([...taskRuns.values()])
      await Promise.allSettled([...taskWrites.values()])
    },
    async dispose() {
      disposed = true
      for (const controller of controllers.values()) controller.abort()
      await Promise.allSettled([...taskRuns.values()])
      await Promise.allSettled([...taskWrites.values()])
      progresses.clear()
      listeners.clear()
      permitWaiters.splice(0).forEach((resolve) => resolve())
    },
  }
}
