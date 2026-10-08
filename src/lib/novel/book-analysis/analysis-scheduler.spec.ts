import { describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type {
  AnalysisChunkRecord,
  AnalysisModuleState,
  AnalysisSkill,
  BookAnalysisPipelineTask,
} from "./analysis-pipeline-types"
import type { AnalysisSkillAdapter } from "./analysis-skill-adapter"
import { createAnalysisScheduler } from "./analysis-scheduler"
import type { AnalysisStageCache } from "./analysis-stage-cache"
import type { LlmRequestCacheTrace } from "@/lib/llm-request-trace"
import type { AnalysisResultCache } from "./analysis-result-cache"

function moduleState(skill: AnalysisSkill, chunkIds: string[]): AnalysisModuleState {
  return {
    skill,
    status: "pending",
    range: { startOrder: 1, endOrder: chunkIds.length * 10 },
    chunkIds,
    completedChunkIds: [],
    failedChunkId: null,
    resultPath: null,
    analysisVersion: 1,
    updatedAt: 1,
  }
}

function task(selectedSkills: AnalysisSkill[], chunkIds = ["chunk-1", "chunk-2"], taskId = "task-1"): BookAnalysisPipelineTask {
  return {
    version: 1,
    id: taskId,
    batchId: null,
    projectPath: "E:/Novel",
    bookId: "book-1",
    bookPath: "E:/Novel/book-analysis/book-1",
    selectedSkills,
    range: { startOrder: 1, endOrder: chunkIds.length * 10 },
    status: "queued",
    currentSkill: null,
    modules: {
      characters: moduleState("characters", chunkIds),
      story: moduleState("story", chunkIds),
      style: moduleState("style", chunkIds),
    },
    error: null,
    createdAt: 1,
    startedAt: null,
    completedAt: null,
    updatedAt: 1,
  }
}

function chunks(skills: AnalysisSkill[], count = 2): AnalysisChunkRecord[] {
  return skills.flatMap((skill) => Array.from({ length: count }, (_, index) => ({
    version: 1 as const,
    id: `chunk-${index + 1}`,
    taskId: "task-1",
    skill,
    chapterIds: [`ch-${index * 10 + 1}`],
    startOrder: index * 10 + 1,
    endOrder: index * 10 + 10,
    wordCount: 1000,
    status: "pending" as const,
    attempts: 0,
    resultPath: null,
    error: null,
    startedAt: null,
    completedAt: null,
    updatedAt: 1,
  })))
}

type SchedulerOptions = Parameters<typeof createAnalysisScheduler>[0]
type LoadChunkResult = NonNullable<SchedulerOptions["loadChunkResult"]>

/** 按 Skill 逐项组装适配器，保证 skill 字段与键名都是 AnalysisSkill 而不是 string。 */
function adaptersFor(
  build: (skill: AnalysisSkill) => Omit<AnalysisSkillAdapter, "skill">,
): Record<AnalysisSkill, AnalysisSkillAdapter> {
  return {
    characters: { skill: "characters", ...build("characters") },
    story: { skill: "story", ...build("story") },
    style: { skill: "style", ...build("style") },
  }
}

/** 用内存表代替落盘读取，签名与 createAnalysisScheduler 要求的加载器一致。 */
function loadChunkResultStub(load: (chunk: AnalysisChunkRecord) => unknown): LoadChunkResult {
  const stub = async <T>(chunk: AnalysisChunkRecord): Promise<T | null> => {
    const value: unknown = load(chunk)
    return (value ?? null) as T | null
  }
  return stub
}

function createHarness(options: {
  onRun?: (skill: AnalysisSkill, chunkId: string, signal: AbortSignal) => Promise<void>
  concurrency?: number
  resultCache?: AnalysisResultCache
  stageCache?: AnalysisStageCache
} = {}) {
  const calls: string[] = []
  let running = 0
  let maxRunning = 0
  const adapters = adaptersFor((skill) => ({
    async runChunk({ chunk, signal }) {
      calls.push(`${skill}:${chunk.id}:start`)
      running += 1
      maxRunning = Math.max(maxRunning, running)
      await options.onRun?.(skill, chunk.id, signal)
      running -= 1
      calls.push(`${skill}:${chunk.id}:done`)
      return { result: { skill, chunkId: chunk.id }, evidence: [] }
    },
    async aggregate() {
      calls.push(`${skill}:aggregate`)
      return { skill }
    },
    async publish() {
      calls.push(`${skill}:publish`)
      return `${skill}.json`
    },
  }))
  const savedResults = new Map<string, unknown>()
  const savedTasks: BookAnalysisPipelineTask[] = []
  const scheduler = createAnalysisScheduler({
    adapters,
    llmConfig: {} as LlmConfig,
    concurrency: options.concurrency,
    resultCache: options.resultCache,
    stageCache: options.stageCache,
    saveTask: vi.fn(async (value) => { savedTasks.push(JSON.parse(JSON.stringify(value))) }),
    saveChunk: vi.fn(async () => {}),
    saveCompletedChunk: vi.fn(async (_bookPath, chunk, result) => {
      const resultPath = `${chunk.skill}-${chunk.id}.result.json`
      savedResults.set(resultPath, result)
      return { ...chunk, status: "completed", resultPath, completedAt: 10, updatedAt: 10 }
    }),
    loadChunkResult: loadChunkResultStub((chunk) => chunk.resultPath ? savedResults.get(chunk.resultPath) ?? null : null),
    now: () => 10,
  })
  return { scheduler, calls, adapters, savedTasks, getMaxRunning: () => maxRunning }
}

describe("analysis scheduler", () => {
  it("新流程不把部分成功区块发布成完整结果，旧流程不受影响", async () => {
    const harness = createHarness({ onRun: async (_skill, id) => { if (id === "chunk-2") throw new Error("分段失败") } })
    const input = { ...task(["story"]), workbenchVersion: 2 as const }
    harness.scheduler.initialize([input], chunks(["story"]))
    await harness.scheduler.continueTask(input.id)
    expect(harness.scheduler.getSnapshot().tasks[0].status).toBe("failed")
    expect(harness.calls).not.toContain("story:aggregate")
    expect(harness.calls).not.toContain("story:publish")
  })
  it("只执行所选 Skill 并按角色、故事、文风串行", async () => {
    const harness = createHarness()
    harness.scheduler.initialize([task(["style", "characters"])], chunks(["characters", "style"]))

    await harness.scheduler.continueTask("task-1")
    await harness.scheduler.whenIdle()

    expect(harness.calls).not.toContain(expect.stringContaining("story"))
    expect(harness.calls.indexOf("characters:publish")).toBeLessThan(harness.calls.indexOf("style:chunk-1:start"))
    expect(harness.calls.at(-1)).toBe("style:publish")
  })

  it("在并发受限时，同一 Skill 的区块并发受 concurrency 限制", async () => {
    const harness = createHarness({
      onRun: async () => new Promise((resolve) => setTimeout(resolve, 1)),
      concurrency: 2,
    })
    harness.scheduler.initialize([task(["characters"], ["chunk-1", "chunk-2", "chunk-3"])], chunks(["characters"], 3))

    await harness.scheduler.continueTask("task-1")
    await harness.scheduler.whenIdle()

    expect(harness.getMaxRunning()).toBe(2)
  })

  it("多个任务（角色/故事）并行运行，而非互相等待", async () => {
    const harness = createHarness({
      onRun: async () => new Promise((resolve) => setTimeout(resolve, 1)),
      concurrency: 4,
    })
    // 两个独立任务：角色任务 chunk-a、故事任务 chunk-c；id 各不相同以区分任务
    const charactersTask = task(["characters"], ["chunk-a"], "task-char")
    const storyTask = task(["story"], ["chunk-c"], "task-story")
    const charChunks = chunks(["characters"]).map((chunk, index) => ({
      ...chunk,
      id: index === 0 ? "chunk-a" : `chunk-a${index}`,
      taskId: "task-char",
    })).slice(0, 1)
    const storyChunks = chunks(["story"]).map((chunk, index) => ({
      ...chunk,
      id: index === 0 ? "chunk-c" : `chunk-c${index}`,
      taskId: "task-story",
    })).slice(0, 1)
    harness.scheduler.initialize([charactersTask, storyTask], [...charChunks, ...storyChunks])

    await Promise.all([
      harness.scheduler.continueTask("task-char"),
      harness.scheduler.continueTask("task-story"),
    ])
    await harness.scheduler.whenIdle()

    // 两个任务的区块都在并发池内并行推进，同一时刻同时运行
    expect(harness.getMaxRunning()).toBeGreaterThan(1)
  })

  it("继续任务时跳过已完成区块", async () => {
    const harness = createHarness()
    const taskValue = task(["characters"], ["chunk-1", "chunk-2"])
    const chunkValues = chunks(["characters"])
    chunkValues[0] = { ...chunkValues[0], status: "completed", resultPath: "existing.json" }
    taskValue.modules.characters.completedChunkIds = ["chunk-1"]
    harness.scheduler.initialize([taskValue], chunkValues)

    await harness.scheduler.continueTask("task-1")
    await harness.scheduler.whenIdle()

    expect(harness.calls).not.toContain("characters:chunk-1:start")
    expect(harness.calls).toContain("characters:chunk-2:start")
  })

  it("暂停后不再派发新的区块并可继续", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const harness = createHarness({ onRun: async () => gate, concurrency: 2 })
    harness.scheduler.initialize([task(["characters"], ["chunk-1", "chunk-2", "chunk-3"])], chunks(["characters"], 3))

    const continuing = harness.scheduler.continueTask("task-1")
    await new Promise((resolve) => setTimeout(resolve, 0))
    const pausing = harness.scheduler.pauseTask("task-1")
    release()
    await Promise.all([continuing, pausing])

    expect(harness.calls).not.toContain("characters:chunk-3:start")
    expect(harness.scheduler.getSnapshot().tasks[0].status).toBe("paused")

    await harness.scheduler.continueTask("task-1")
    await harness.scheduler.whenIdle()
    expect(harness.calls).toContain("characters:chunk-3:start")
  })

  it("同批部分区块失败时用已完成区块继续汇总并标记任务成功", async () => {
    const harness = createHarness({
      onRun: async (_skill, chunkId) => {
        if (chunkId === "chunk-1") throw new Error("模拟区块失败")
        await new Promise((resolve) => setTimeout(resolve, 1))
      },
    })
    harness.scheduler.initialize([task(["characters"])], chunks(["characters"]))

    await harness.scheduler.continueTask("task-1")
    await harness.scheduler.whenIdle()

    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.tasks[0].status).toBe("completed")
    expect(snapshot.chunks.find((chunk) => chunk.id === "chunk-1")?.status).toBe("failed")
    expect(snapshot.chunks.find((chunk) => chunk.id === "chunk-2")?.status).toBe("completed")
    expect(snapshot.tasks[0].modules.characters.summary).toContain("失败已跳过")
    expect(harness.calls).toContain("characters:aggregate")
    expect(harness.calls).toContain("characters:publish")
  })

  it("全部区块失败时任务失败；continue 会重置失败区块后重试", async () => {
    let failAll = true
    const harness = createHarness({
      onRun: async () => {
        if (failAll) throw new Error("模拟全部失败")
      },
    })
    harness.scheduler.initialize([task(["characters"], ["chunk-1"])], chunks(["characters"], 1))

    await harness.scheduler.continueTask("task-1")
    expect(harness.scheduler.getSnapshot().tasks[0].status).toBe("failed")

    failAll = false
    await harness.scheduler.continueTask("task-1")
    await harness.scheduler.whenIdle()
    expect(harness.scheduler.getSnapshot().tasks[0].status).toBe("completed")
    expect(harness.calls.filter((call) => call === "characters:chunk-1:start")).toHaveLength(2)
  })

  it("区块 onProgress 会进入 snapshot.progresses，完成后清除", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const adapters = adaptersFor((skill) => ({
      async runChunk({ chunk, onProgress }) {
        onProgress?.({ stageLabel: "识别角色中", percentage: 40, currentItem: "第一章" })
        await gate
        onProgress?.({ stageLabel: "区块完成", percentage: 100 })
        return { result: { chunkId: chunk.id }, evidence: [] }
      },
      async aggregate({ onProgress }) {
        onProgress?.({ stageLabel: "正在合并角色候选…", percentage: 93 })
        return { skill }
      },
      async publish({ onProgress }) {
        onProgress?.({ stageLabel: "正在保存角色结果…", percentage: 97 })
        return `${skill}.json`
      },
    }))
    const savedResults = new Map<string, unknown>()
    const scheduler = createAnalysisScheduler({
      adapters,
      llmConfig: {} as LlmConfig,
      saveTask: vi.fn(async () => {}),
      saveChunk: vi.fn(async () => {}),
      saveCompletedChunk: vi.fn(async (_bookPath, chunk, result) => {
        const resultPath = `${chunk.skill}-${chunk.id}.result.json`
        savedResults.set(resultPath, result)
        return { ...chunk, status: "completed", resultPath, completedAt: 10, updatedAt: 10 }
      }),
      loadChunkResult: loadChunkResultStub((chunk) => chunk.resultPath ? savedResults.get(chunk.resultPath) ?? null : null),
      now: () => 10,
    })
    scheduler.initialize([task(["characters"], ["chunk-1"])], chunks(["characters"], 1))

    const running = scheduler.continueTask("task-1")
    await new Promise((resolve) => setTimeout(resolve, 0))
    const mid = scheduler.getSnapshot().progresses["task-1:characters:chunk-1"]
    expect(mid).toMatchObject({ stageLabel: "识别角色中", percentage: 40, currentItem: "第一章" })

    release()
    await running
    await scheduler.whenIdle()

    expect(scheduler.getSnapshot().progresses).toEqual({})
    expect(scheduler.getSnapshot().tasks[0].status).toBe("completed")
  })

  it("enqueue 会移除同任务下不在新列表中的 orphan 区块，且不调度它们", async () => {
    const harness = createHarness()
    const orphan: AnalysisChunkRecord = {
      ...chunks(["characters"], 1)[0],
      id: "chunk-orphan",
      startOrder: 99,
      endOrder: 100,
      status: "completed",
      resultPath: "orphan.result.json",
    }
    harness.scheduler.initialize(
      [task(["characters"], ["chunk-1"])],
      [...chunks(["characters"], 1), orphan],
    )

    await harness.scheduler.enqueue(task(["characters"], ["chunk-1"]), chunks(["characters"], 1))
    await harness.scheduler.whenIdle()

    const snapshot = harness.scheduler.getSnapshot()
    expect(snapshot.chunks.map((item) => item.id)).toEqual(["chunk-1"])
    expect(harness.calls).not.toContain("characters:chunk-orphan:start")
    expect(snapshot.tasks[0].status).toBe("completed")
  })

  it("即使内存残留 orphan completed，汇总仍只使用 expectedIds 内区块", async () => {
    const harness = createHarness()
    const taskValue = task(["characters"], ["chunk-1"])
    const expected = chunks(["characters"], 1)[0]
    const orphan: AnalysisChunkRecord = {
      ...expected,
      id: "chunk-orphan",
      startOrder: 50,
      endOrder: 60,
      status: "completed",
      resultPath: "orphan.result.json",
    }
    // 先 initialize 带 orphan，再手动塞回 orphan（绕过 enqueue 清理），验证汇总防线
    harness.scheduler.initialize([taskValue], [expected, orphan])
    await harness.scheduler.continueTask("task-1")
    await harness.scheduler.whenIdle()

    expect(harness.scheduler.getSnapshot().tasks[0].status).toBe("completed")
    expect(harness.calls).toContain("characters:aggregate")
    expect(harness.calls).not.toContain("characters:chunk-orphan:start")
  })

  it("snapshot.progresses 为浅拷贝，外部修改不影响内部状态", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const adapters = adaptersFor((skill) => ({
      async runChunk({ chunk, onProgress }) {
        onProgress?.({ stageLabel: "进行中", percentage: 40 })
        await gate
        return { result: { chunkId: chunk.id }, evidence: [] }
      },
      async aggregate() { return { skill } },
      async publish() { return `${skill}.json` },
    }))
    const scheduler = createAnalysisScheduler({
      adapters,
      llmConfig: {} as LlmConfig,
      saveTask: vi.fn(async () => {}),
      saveChunk: vi.fn(async () => {}),
      saveCompletedChunk: vi.fn(async (_bookPath, chunk) => ({
        ...chunk,
        status: "completed",
        resultPath: `${chunk.id}.result.json`,
        completedAt: 10,
        updatedAt: 10,
      })),
      loadChunkResult: loadChunkResultStub(() => ({ result: {}, evidence: [] })),
      now: () => 10,
    })
    scheduler.initialize([task(["characters"], ["chunk-1"])], chunks(["characters"], 1))
    const running = scheduler.continueTask("task-1")
    await new Promise((resolve) => setTimeout(resolve, 0))
    const snap = scheduler.getSnapshot()
    const key = "task-1:characters:chunk-1"
    snap.progresses[key].percentage = 1
    expect(scheduler.getSnapshot().progresses[key].percentage).toBe(40)
    release()
    await running
  })

  it("取消聚合时中止聚合请求并把任务标记为已取消", async () => {
    let aggregateSignal: AbortSignal | null = null
    let notifyAggregateStarted!: () => void
    // 通过读取函数取值，避免控制在流分析里把外层变量收窄成初始的 null。
    const aggregateSignalSeen = (): AbortSignal | null => aggregateSignal
    const aggregateStarted = new Promise<void>((resolve) => { notifyAggregateStarted = resolve })
    const adapters = adaptersFor((skill) => ({
      async runChunk({ chunk }) {
        return { result: { chunkId: chunk.id }, evidence: [] }
      },
      async aggregate({ signal }) {
        aggregateSignal = signal
        notifyAggregateStarted()
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("已取消")), { once: true })
        })
        return {}
      },
      async publish() {
        return `${skill}.json`
      },
    }))
    const savedResults = new Map<string, unknown>()
    const scheduler = createAnalysisScheduler({
      adapters,
      llmConfig: {} as LlmConfig,
      saveTask: vi.fn(async () => {}),
      saveChunk: vi.fn(async () => {}),
      saveCompletedChunk: vi.fn(async (_bookPath, chunk, result) => {
        const resultPath = `${chunk.skill}-${chunk.id}.result.json`
        savedResults.set(resultPath, result)
        return { ...chunk, status: "completed", resultPath, completedAt: 10, updatedAt: 10 }
      }),
      loadChunkResult: loadChunkResultStub((chunk) => chunk.resultPath ? savedResults.get(chunk.resultPath) ?? null : null),
      now: () => 10,
    })
    scheduler.initialize([task(["characters"], ["chunk-1"])], chunks(["characters"], 1))

    const running = scheduler.continueTask("task-1")
    await aggregateStarted
    await scheduler.cancelTask("task-1")
    await running

    expect(aggregateSignalSeen()?.aborted).toBe(true)
    expect(scheduler.getSnapshot().tasks[0].status).toBe("cancelled")
  })

  it("llmConfig 传函数时按任务解析，adapter 拿到该任务选定的模型", async () => {
    const seenModels: string[] = []
    const adapters = adaptersFor((skill) => ({
      async runChunk({ chunk, llmConfig }) {
        seenModels.push(llmConfig.model)
        return { result: { chunkId: chunk.id }, evidence: [] }
      },
      async aggregate() {
        return { skill }
      },
      async publish() {
        return `${skill}.json`
      },
    }))
    const savedResults = new Map<string, unknown>()
    const scheduler = createAnalysisScheduler({
      adapters,
      llmConfig: (target) => ({ model: target.modelKey ?? "default-model" }) as LlmConfig,
      saveTask: vi.fn(async () => {}),
      saveChunk: vi.fn(async () => {}),
      saveCompletedChunk: vi.fn(async (_bookPath, chunk, result) => {
        const resultPath = `${chunk.skill}-${chunk.id}.result.json`
        savedResults.set(resultPath, result)
        return { ...chunk, status: "completed", resultPath, completedAt: 10, updatedAt: 10 }
      }),
      loadChunkResult: loadChunkResultStub((chunk) => chunk.resultPath ? savedResults.get(chunk.resultPath) ?? null : null),
      now: () => 10,
    })
    const configured = { ...task(["style"], ["chunk-1"]), modelKey: "openai/gpt-4o-mini" }
    scheduler.initialize([configured], chunks(["style"], 1))

    await scheduler.continueTask("task-1")
    await scheduler.whenIdle()

    expect(seenModels).toEqual(["openai/gpt-4o-mini"])
  })
})

describe("analysis scheduler 缓存与重试语义", () => {
  it.each(["continue", "retry"])("forceRefresh 的失败任务经 %s 后仍绕过结果复用", async (operation) => {
    const resultCache: AnalysisResultCache = {
      createKey: vi.fn(async () => "a".repeat(64)),
      read: vi.fn(async () => ({ result: { cached: true }, evidence: [] })),
      write: vi.fn(async () => undefined),
    }
    let fail = true
    const run = createHarness({ resultCache, onRun: async () => {
      if (fail) throw new Error("模拟失败")
    } })
    const value = { ...task(["characters"], ["chunk-1"]), forceRefresh: true }
    await run.scheduler.enqueue(value, chunks(["characters"], 1))
    expect(run.scheduler.getSnapshot().tasks[0].status).toBe("failed")
    expect(resultCache.write).not.toHaveBeenCalled()
    fail = false
    if (operation === "continue") await run.scheduler.continueTask(value.id)
    else await run.scheduler.retryFailedChunk(value.id, "characters", "chunk-1")
    expect(run.calls.filter((call) => call === "characters:chunk-1:start")).toHaveLength(2)
    expect(resultCache.read).not.toHaveBeenCalled()
    expect(resultCache.write).toHaveBeenCalledTimes(1)
    expect(run.scheduler.getSnapshot().tasks[0].status).toBe("completed")
  })

  it.each(["createKey", "read", "write"] as const)("注入的缓存 %s 抛错不会改变正常调度后处理", async (method) => {
    const resultCache: AnalysisResultCache = {
      createKey: vi.fn(async () => "a".repeat(64)),
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
    }
    vi.mocked(resultCache[method]).mockRejectedValue(new Error("模拟缓存故障"))
    const run = createHarness({ resultCache })
    await run.scheduler.enqueue(task(["characters"], ["chunk-1"]), chunks(["characters"], 1))
    expect(run.calls.filter((call) => call === "characters:chunk-1:start")).toHaveLength(1)
    expect(run.calls).toContain("characters:aggregate")
    expect(run.calls).toContain("characters:publish")
    expect(run.scheduler.getSnapshot().tasks[0].status).toBe("completed")
  })
})


describe("拆书全流程用量与后处理复用", () => {
  const request = (id: string): LlmRequestCacheTrace => ({
    requestId: id, provider: "openai", model: "fixture", apiMode: "chat_completions",
    startedAt: 1, finishedAt: 2, durationMs: 1, status: "success",
    inputTokens: 100, outputTokens: 10, cacheReadTokens: 80,
  })

  it("分块、汇总、发布后的后台验证全部计数，重复转发去重且不会倒退完成状态", async () => {
    const harness = createHarness()
    let background: ((trace: LlmRequestCacheTrace) => void) | undefined
    harness.adapters.style.runChunk = async ({ onRequestTrace }) => {
      onRequestTrace?.(request("chunk")); onRequestTrace?.(request("chunk"))
      return { result: { style: true }, evidence: [] }
    }
    harness.adapters.style.aggregate = async ({ onRequestTrace }) => {
      onRequestTrace?.(request("aggregate")); return { style: true }
    }
    harness.adapters.style.publish = async ({ onRequestTrace }) => { background = onRequestTrace; return "style.json" }
    harness.scheduler.initialize([task(["style"], ["chunk-1"])], chunks(["style"], 1))
    await harness.scheduler.continueTask("task-1")
    background?.({ ...request("verification"), stage: "verification" })
    await harness.scheduler.whenIdle()
    const finished = harness.scheduler.getSnapshot().tasks[0]
    expect(finished.status).toBe("completed")
    expect(finished.requestUsageTotals).toMatchObject({ requestCount: 3, inputTokens: 300, cachedInputTokens: 240 })
    expect(finished.requestTraces?.map((value) => value.stage)).toEqual(["style:chunk", "style:aggregate", "verification"])
    expect(harness.savedTasks.at(-1)).toMatchObject({ status: "completed", requestUsageTotals: { requestCount: 3 } })
  })

  it("任务总账隔离，续跑不会丢掉已落盘的用量", async () => {
    const harness = createHarness()
    const first = task(["style"], ["chunk-1"])
    const second = task(["style"], ["chunk-1"], "task-2")
    harness.scheduler.initialize([first, second], [])
    await harness.scheduler.recordRequestTrace(first, { ...request("recognize"), stage: "recognition" })
    await harness.scheduler.recordRequestTrace(second, request("other-book"))
    const saved = harness.scheduler.getSnapshot()
    const next = createHarness()
    next.scheduler.initialize(saved.tasks, [])
    await next.scheduler.recordRequestTrace(saved.tasks[0], request("next"))
    expect(next.scheduler.getSnapshot().tasks.map((value) => value.requestUsageTotals?.requestCount)).toEqual([2, 1])
  })

  it("重复任务复用区块后的汇总，明确强刷时仍调用汇总", async () => {
    const entries = new Map<string, unknown>()
    const stageCache: AnalysisStageCache = {
      createKey: async (input) => JSON.stringify(input.materials),
      read: async (_input, key) => structuredClone(entries.get(key) ?? null) as never,
      write: async (_input, key, value) => { entries.set(key, structuredClone(value)) },
    }
    const resultCache: AnalysisResultCache = {
      createKey: async (input) => `source-${input.chunk.id}`,
      read: async () => ({ result: { stable: true }, evidence: [] }),
      write: async () => {},
    }
    const harness = createHarness({ stageCache, resultCache })
    for (const id of ["first", "second", "refresh"]) {
      const value = task(["style"], ["chunk-1"], id)
      if (id === "refresh") value.forceRefresh = true
      await harness.scheduler.enqueue(value, chunks(["style"], 1).map((chunk) => ({ ...chunk, taskId: id })))
    }
    expect(harness.calls.filter((value) => value === "style:aggregate")).toHaveLength(2)
    expect(harness.scheduler.getSnapshot().tasks.find((value) => value.id === "second")?.resultReuse).toMatchObject({ chunkHits: 1, aggregateHits: 1 })
  })
})


it("降级的区块结果即使允许发布，也不写入成功汇总缓存", async () => {
  const write = vi.fn(async () => {})
  const harness = createHarness({
    resultCache: { createKey: async () => "source", read: async () => null, write: async () => {} },
    stageCache: { createKey: async () => "stage", read: async () => null, write },
  })
  harness.adapters.characters.runChunk = async () => ({ result: { characters: [], cacheable: false }, evidence: [] })
  harness.adapters.characters.aggregate = async () => []
  await harness.scheduler.enqueue(task(["characters"], ["chunk-1"]), chunks(["characters"], 1))
  expect(write).not.toHaveBeenCalled()
})


it("切项目销毁调度器后，已发出的后台验证仍归入原任务账本而不通知新项目", async () => {
  const harness = createHarness()
  let lateTrace: ((trace: LlmRequestCacheTrace) => void) | undefined
  const trace: LlmRequestCacheTrace = { requestId: "late-verification", provider: "openai", model: "fixture", apiMode: "chat_completions",
    startedAt: 1, finishedAt: 2, durationMs: 1, status: "success", inputTokens: 100, outputTokens: 10 }
  harness.adapters.style.publish = async ({ onRequestTrace }) => { lateTrace = onRequestTrace; return "style.json" }
  await harness.scheduler.enqueue(task(["style"], ["chunk-1"]), chunks(["style"], 1))
  const listener = vi.fn(); harness.scheduler.subscribe(listener)
  await harness.scheduler.dispose(); listener.mockClear()
  lateTrace?.(trace)
  await harness.scheduler.whenIdle()
  expect(harness.savedTasks.at(-1)).toMatchObject({ id: "task-1", status: "completed", requestUsageTotals: { requestCount: 1, inputTokens: 100 } })
  expect(listener).not.toHaveBeenCalled()
})


it("持久化拆书总账的去重ID不随32条明细丢失", async () => {
  const first = createHarness()
  const value = task(["style"], ["chunk-1"])
  first.scheduler.initialize([value], [])
  const request = (id: number): LlmRequestCacheTrace => ({ requestId: `restore-${id}`, provider: "openai", model: "fixture", apiMode: "chat_completions",
    startedAt: id, finishedAt: id + 1, durationMs: 1, status: "success", inputTokens: 100 })
  for (let index = 0; index < 40; index += 1) await first.scheduler.recordRequestTrace(value, request(index))
  const restoredTask = first.savedTasks.at(-1)!
  expect(restoredTask.requestTraces).toHaveLength(32)
  expect(restoredTask.requestTraceIds).toHaveLength(40)
  const second = createHarness()
  second.scheduler.initialize([restoredTask], [])
  await second.scheduler.recordRequestTrace(restoredTask, request(0))
  expect(second.savedTasks.at(-1)?.requestUsageTotals).toMatchObject({ requestCount: 40, inputTokens: 4000 })
})
