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

function task(selectedSkills: AnalysisSkill[], chunkIds = ["chunk-1", "chunk-2"]): BookAnalysisPipelineTask {
  return {
    version: 1,
    id: "task-1",
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

function createHarness(options: {
  onRun?: (skill: AnalysisSkill, chunkId: string, signal: AbortSignal) => Promise<void>
} = {}) {
  const calls: string[] = []
  let running = 0
  let maxRunning = 0
  const adapters = Object.fromEntries(["characters", "story", "style"].map((skill) => [
    skill,
    {
      skill,
      async runChunk({ chunk, signal }) {
        calls.push(`${skill}:${chunk.id}:start`)
        running += 1
        maxRunning = Math.max(maxRunning, running)
        await options.onRun?.(skill as AnalysisSkill, chunk.id, signal)
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
    } satisfies AnalysisSkillAdapter,
  ])) as Record<AnalysisSkill, AnalysisSkillAdapter>
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
    loadChunkResult: vi.fn(async (chunk) => chunk.resultPath ? savedResults.get(chunk.resultPath) ?? null : null),
    now: () => 10,
  })
  return { scheduler, calls, getMaxRunning: () => maxRunning }
}

describe("analysis scheduler", () => {
  it("只执行所选 Skill 并按角色、故事、文风串行", async () => {
    const harness = createHarness()
    harness.scheduler.initialize([task(["style", "characters"])], chunks(["characters", "style"]))

    await harness.scheduler.continueTask("task-1")
    await harness.scheduler.whenIdle()

    expect(harness.calls).not.toContain(expect.stringContaining("story"))
    expect(harness.calls.indexOf("characters:publish")).toBeLessThan(harness.calls.indexOf("style:chunk-1:start"))
    expect(harness.calls.at(-1)).toBe("style:publish")
  })

  it("同一 Skill 的区块并发最多为 2", async () => {
    const harness = createHarness({ onRun: async () => new Promise((resolve) => setTimeout(resolve, 1)) })
    harness.scheduler.initialize([task(["characters"], ["chunk-1", "chunk-2", "chunk-3"])], chunks(["characters"], 3))

    await harness.scheduler.continueTask("task-1")
    await harness.scheduler.whenIdle()

    expect(harness.getMaxRunning()).toBe(2)
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
    const harness = createHarness({ onRun: async () => gate })
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
    const adapters = Object.fromEntries(["characters", "story", "style"].map((skill) => [
      skill,
      {
        skill,
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
      } satisfies AnalysisSkillAdapter,
    ])) as Record<AnalysisSkill, AnalysisSkillAdapter>
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
      loadChunkResult: vi.fn(async (chunk) => chunk.resultPath ? savedResults.get(chunk.resultPath) ?? null : null),
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
    const adapters = Object.fromEntries(["characters", "story", "style"].map((skill) => [
      skill,
      {
        skill,
        async runChunk({ chunk, onProgress }) {
          onProgress?.({ stageLabel: "进行中", percentage: 40 })
          await gate
          return { result: { chunkId: chunk.id }, evidence: [] }
        },
        async aggregate() { return { skill } },
        async publish() { return `${skill}.json` },
      } satisfies AnalysisSkillAdapter,
    ])) as Record<AnalysisSkill, AnalysisSkillAdapter>
    const scheduler = createAnalysisScheduler({
      adapters,
      llmConfig: {} as LlmConfig,
      saveTask: vi.fn(async () => {}),
      saveChunk: vi.fn(async () => {}),
      saveCompletedChunk: vi.fn(async (_bookPath, chunk, result) => ({
        ...chunk,
        status: "completed",
        resultPath: `${chunk.id}.result.json`,
        completedAt: 10,
        updatedAt: 10,
      })),
      loadChunkResult: vi.fn(async () => ({ result: {}, evidence: [] })),
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
    const aggregateStarted = new Promise<void>((resolve) => { notifyAggregateStarted = resolve })
    const adapters = Object.fromEntries(["characters", "story", "style"].map((skill) => [
      skill,
      {
        skill,
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
      } satisfies AnalysisSkillAdapter,
    ])) as Record<AnalysisSkill, AnalysisSkillAdapter>
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
      loadChunkResult: vi.fn(async (chunk) => chunk.resultPath ? savedResults.get(chunk.resultPath) ?? null : null),
      now: () => 10,
    })
    scheduler.initialize([task(["characters"], ["chunk-1"])], chunks(["characters"], 1))

    const running = scheduler.continueTask("task-1")
    await aggregateStarted
    await scheduler.cancelTask("task-1")
    await running

    expect(aggregateSignal?.aborted).toBe(true)
    expect(scheduler.getSnapshot().tasks[0].status).toBe("cancelled")
  })
})
