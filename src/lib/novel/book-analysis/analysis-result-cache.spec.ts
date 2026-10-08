import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import { normalizeGlobalUserMemoryConfig, loadGlobalUserMemoryConfig } from "@/lib/user-memory/store"
import type { GlobalUserMemoryConfig } from "@/lib/user-memory/types"
import type { AnalysisChunkRecord, AnalysisModuleState, AnalysisSkill, BookAnalysisPipelineTask } from "./analysis-pipeline-types"
import type { AnalysisChunkOutput, AnalysisSkillAdapter } from "./analysis-skill-adapter"
import { saveCompletedChunk } from "./analysis-pipeline-storage"
import { createAnalysisScheduler } from "./analysis-scheduler"
import { createAnalysisResultCache, type AnalysisResultCacheInput } from "./analysis-result-cache"
import * as providers from "@/lib/llm-providers"

const fs = vi.hoisted(() => {
  const files = new Map<string, string>()
  return {
    files,
    createDirectory: vi.fn(async () => undefined),
    fileExists: vi.fn(async (path: string) => files.has(path)),
    readFile: vi.fn(async (path: string) => {
      const content = files.get(path)
      if (content === undefined) throw new Error("模拟文件不存在")
      return content
    }),
    writeFileAtomic: vi.fn(async (path: string, content: string) => { files.set(path, content) }),
  }
})

vi.mock("@/commands/fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/commands/fs")>(),
  ...fs,
}))
vi.mock("@/lib/user-memory/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/user-memory/store")>(),
  loadGlobalUserMemoryConfig: vi.fn(),
}))
vi.mock("@/lib/local-cli-config", () => ({
  resolveRuntimeLocalCliConfig: vi.fn(async (config: LlmConfig) => config),
}))

const projectPath = "C:/cache-fixture"
const bookPath = `${projectPath}/book-analysis/book-1`
const chapterPath = `${bookPath}/chapters/ch-0001.md`
const body = `${"开篇材料".repeat(4000)}中间关键情节${"收尾材料".repeat(4000)}`
const source = `---\ntitle: 第一章\norder: 1\n---\n${body}`
let memory: GlobalUserMemoryConfig

function config(): LlmConfig {
  return {
    provider: "custom",
    model: "fixture-model",
    apiKey: "不得写入缓存的模拟密钥",
    customEndpoint: "https://fixture.invalid/v1",
    ollamaUrl: "http://localhost:11434",
    apiMode: "chat_completions",
    maxContextSize: 262144,
    maxOutputTokens: 4096,
    reasoning: { mode: "off" },
  }
}

function task(id = "task-1", skill: AnalysisSkill = "style"): BookAnalysisPipelineTask {
  const range = { startOrder: 1, endOrder: 1 }
  const moduleState = (key: AnalysisSkill): AnalysisModuleState => ({
    skill: key, status: key === skill ? "pending" : "skipped", range,
    chunkIds: key === skill ? ["chunk-1"] : [], completedChunkIds: [],
    failedChunkId: null, resultPath: null, analysisVersion: 1, updatedAt: 1,
  })
  return {
    version: 1, id, batchId: null, projectPath, bookId: "book-1", bookPath,
    selectedSkills: [skill], range, status: "queued", currentSkill: null,
    modules: {
      characters: moduleState("characters"),
      story: moduleState("story"),
      style: moduleState("style"),
    },
    targetCharacters: skill === "characters" ? [{
      id: "char-linyuan", name: "林远", aliases: ["小林"], appearances: 2,
      chapterIndices: [0], importanceScore: 90, category: "主角", sourceBook: "样本作品",
    }] : undefined,
    error: null, createdAt: 1, startedAt: null, completedAt: null, updatedAt: 1,
  }
}

function chunk(value: BookAnalysisPipelineTask): AnalysisChunkRecord {
  const skill = value.selectedSkills[0]
  return {
    version: 1, id: value.modules[skill].chunkIds[0], taskId: value.id, skill,
    chapterIds: ["ch-0001"], startOrder: 1, endOrder: 1, wordCount: body.length,
    status: "pending", attempts: 0, resultPath: null, error: null,
    startedAt: null, completedAt: null, updatedAt: 1,
  }
}

function outputFor(value: BookAnalysisPipelineTask, record: AnalysisChunkRecord): AnalysisChunkOutput {
  const id = `evidence-${value.id}-${record.skill}-${record.id}-0`
  const profile = {
    schemaVersion: 1, generatedAt: 1, sampledChapterIds: [...record.chapterIds],
    narrativeDensity: "紧凑", descriptionWeight: "克制", emotionRendering: "动作呈现",
    sentenceStyle: "短句", rhetoricDensity: "稀疏", transitionStyle: "动作转场",
    narrativeVoice: "第三人称", dialogueStyle: "简短", thematicHabits: "成长",
    constitution: "以动作推进", samples: ["举杯道别。"], evidenceIds: [id],
  }
  const result = record.skill === "style"
    ? { raw: "完整文风分析", profile }
    : record.skill === "characters"
      ? { characters: [{ id: "char-linyuan", name: "林远", aliases: ["小林"], description: "独立的行旅者" }] }
      : { map: { schemaVersion: 1, bookId: value.bookId, chapters: record.chapterIds.map((id) => ({ id, order: 1, mainEvents: [{ label: "出发" }] })) }, rangeChapterIds: record.chapterIds }
  return {
    result,
    evidence: [{
      version: 1, id, bookId: value.bookId, skill: record.skill, taskId: value.id,
      chapterId: record.chapterIds[0], chapterOrder: record.startOrder, text: "举杯道别。",
      tags: ["动作"], reason: "动作推动情节", purpose: "分析依据",
      enabled: true, userPinned: false, createdAt: 1, updatedAt: 1,
    }],
  }
}

function harness(options: {
  config?: LlmConfig | (() => LlmConfig)
  run?: (input: Parameters<AnalysisSkillAdapter["runChunk"]>[0]) => Promise<AnalysisChunkOutput>
} = {}) {
  const runChunk = vi.fn(async (input: Parameters<AnalysisSkillAdapter["runChunk"]>[0]) => (
    options.run ? options.run(input) : outputFor(input.task, input.chunk)
  ))
  const aggregate = vi.fn(async ({ chunks }: Parameters<AnalysisSkillAdapter["aggregate"]>[0]) => chunks[0])
  const publish = vi.fn(async ({ bookPath, skill }: Parameters<AnalysisSkillAdapter["publish"]>[0]) => `${bookPath}/${skill}.json`)
  // 必须保留 saveCompletedChunk 的泛型签名：调度器的 saveCompletedChunk 选项就是该泛型函数类型，
  // 换成非泛型的窄签名无法赋值。泛型实参在 mock.calls 中被擦成 unknown，因此下面按调度器
  // 的真实契约（只持久化 AnalysisChunkOutput）在取值处标注具体类型。
  const persistCompleted = vi.fn(saveCompletedChunk)
  const adapterFor = (skill: AnalysisSkill): AnalysisSkillAdapter => ({ skill, runChunk, aggregate, publish })
  const scheduler = createAnalysisScheduler({
    adapters: {
      characters: adapterFor("characters"),
      story: adapterFor("story"),
      style: adapterFor("style"),
    },
    llmConfig: options.config ?? config(),
    saveCompletedChunk: persistCompleted,
    now: () => 200,
  })
  return {
    scheduler, runChunk, aggregate, publish, persistCompleted,
    run: async (value = task(), record = chunk(value)) => {
      await scheduler.enqueue(value, [record])
      await scheduler.whenIdle()
    },
  }
}

function cacheFiles(): Array<[string, string]> {
  return [...fs.files].filter(([path]) => path.includes("/analysis/result-cache/"))
}

afterEach(() => { vi.restoreAllMocks() })

beforeEach(() => {
  vi.clearAllMocks()
  fs.files.clear()
  fs.fileExists.mockImplementation(async (path) => fs.files.has(path))
  fs.readFile.mockImplementation(async (path) => {
    const text = fs.files.get(path)
    if (text === undefined) throw new Error("模拟文件不存在")
    return text
  })
  fs.writeFileAtomic.mockImplementation(async (path, text) => { fs.files.set(path, text) })
  fs.files.set(chapterPath, source)
  fs.files.set(`${bookPath}/metadata.json`, JSON.stringify({ title: "样本作品", author: "测试作者", updatedAt: 1 }))
  memory = normalizeGlobalUserMemoryConfig({
    enabled: true, autoRead: true,
    rules: [{ id: "rule-1", rule: "证据使用中文", category: "manual", source: "manual", surfaces: ["all"], updatedAt: 1 }],
  })
  vi.mocked(loadGlobalUserMemoryConfig).mockImplementation(() => memory)
})

describe("拆书成功结果按内容复用", () => {
  it("新工作台的需求、实际章节选择、目标与分段位置参与缓存键", async () => {
    const value = task("workbench", "characters")
    value.workbenchVersion = 2
    value.workbenchRequest = { selectedChapterIds: ["ch-0001"], requirements: { characters: "处事方式" } }
    const record = chunk(value)
    record.segments = [{ chapterId: "ch-0001", order: 1, start: 0, end: 100, sourceHash: "a".repeat(64) }]
    const input: AnalysisResultCacheInput = { task: value, chunk: record, skill: "characters", bookPath, projectPath, llmConfig: config() }
    const cache = createAnalysisResultCache()
    const original = await cache.createKey(input)
    expect(original).not.toBeNull()
    for (const change of [
      (next: AnalysisResultCacheInput) => { next.task.workbenchRequest!.requirements.characters = "只研究关心亲友" },
      (next: AnalysisResultCacheInput) => { next.task.workbenchRequest!.selectedChapterIds.push("ch-0002") },
      (next: AnalysisResultCacheInput) => { next.task.targetCharacters![0].name = "另一人物" },
      (next: AnalysisResultCacheInput) => { next.chunk.segments![0].start = 20 },
    ]) {
      const next = structuredClone(input)
      change(next)
      expect(await cache.createKey(next)).not.toBe(original)
    }
  })
  it.each(["characters", "story", "style"] as const)("%s 同内容跨任务复用区块与汇总，仍持久化当前区块并发布", async (skill) => {
    const cold = harness()
    await cold.run(task("task-old", skill))
    expect(cold.runChunk).toHaveBeenCalledTimes(1)
    const warm = harness()
    const next = task("task-new", skill)
    next.batchId = "another-batch"
    next.createdAt = 100
    next.updatedAt = 100
    next.modules[skill].analysisVersion = 9
    next.modules[skill].chunkIds = ["new-chunk-id"]
    const nextChunk = { ...chunk(next), attempts: 3, updatedAt: 100 }
    await warm.run(next, nextChunk)

    expect(warm.runChunk).not.toHaveBeenCalled()
    expect(warm.persistCompleted).toHaveBeenCalledTimes(1)
    expect(warm.persistCompleted.mock.calls[0][1]).toMatchObject({ taskId: next.id, id: "new-chunk-id" })
    expect(cold.aggregate).toHaveBeenCalledTimes(1)
    expect(warm.aggregate).not.toHaveBeenCalled()
    const persisted = warm.persistCompleted.mock.calls[0][2] as AnalysisChunkOutput
    expect(warm.publish.mock.calls[0][0].result).toEqual(persisted.result)
    expect(warm.publish).toHaveBeenCalledTimes(1)
    expect(warm.scheduler.getSnapshot().tasks[0]).toMatchObject({ status: "completed" })
    expect(warm.scheduler.getSnapshot().tasks[0].modules[skill].completedChunkIds).toEqual(["new-chunk-id"])
    expect(warm.scheduler.getSnapshot().progresses).toEqual({})
    expect(cacheFiles()).toHaveLength(1)
  })

  it("命中重绑定当前 taskId、证据 ID 和结果内的 evidenceIds，不污染旧结果", async () => {
    const cold = harness()
    await cold.run(task("old-task"))
    const cachedBefore = cacheFiles().map(([, text]) => text)
    const warm = harness()
    await warm.run(task("new-task"))
    expect(warm.runChunk).not.toHaveBeenCalled()
    const saved = warm.persistCompleted.mock.calls[0][2] as AnalysisChunkOutput<{ profile: { evidenceIds: string[] } }>
    expect(saved.evidence[0]).toMatchObject({
      id: "evidence-new-task-style-chunk-1-0", taskId: "new-task", bookId: "book-1", skill: "style",
      chapterId: "ch-0001", chapterOrder: 1, enabled: true, userPinned: false,
    })
    expect(saved.evidence[0].createdAt).not.toBe(1)
    expect(saved.result.profile.evidenceIds).toEqual([saved.evidence[0].id])
    expect(warm.publish.mock.calls[0][0].evidence).toEqual(saved.evidence)
    expect(cacheFiles().map(([, text]) => text)).toEqual(cachedBefore)
  })

  it("重绑定保留 AnalysisChunkOutput 与证据上额外的统计字段", async () => {
    const cold = harness({ run: async (input) => {
      const output = outputFor(input.task, input.chunk)
      return {
        ...output,
        usage: { inputTokens: 42, requestCount: 1 },
        evidence: output.evidence.map((item) => ({ ...item, sourceKind: "model" })),
      }
    } })
    await cold.run()
    const warm = harness()
    await warm.run(task("task-2"))
    expect(warm.runChunk).not.toHaveBeenCalled()
    expect(warm.persistCompleted.mock.calls[0][2]).toMatchObject({
      usage: { inputTokens: 42, requestCount: 1 },
      evidence: [expect.objectContaining({ taskId: "task-2", sourceKind: "model" })],
    })
  })

  it("同任务重新设置相同范围及递增 analysisVersion 仍可复用", async () => {
    const run = harness()
    await run.run()
    const next = task()
    next.modules.style.analysisVersion += 1
    run.runChunk.mockClear()
    await run.run(next)
    expect(run.runChunk).not.toHaveBeenCalled()
  })

  it.each([0, 16004, source.length - 1])("完整正文位置 %i 改动后失效，而非只比较头尾采样", async (offset) => {
    await harness().run()
    expect(cacheFiles()).toHaveLength(1)
    fs.files.set(chapterPath, `${source.slice(0, offset)}改${source.slice(offset + 1)}`)
    const next = harness()
    await next.run(task("task-2"))
    expect(next.runChunk).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["model", "another-model"], ["provider", "openai"], ["apiMode", "responses"],
    ["customEndpoint", "https://another.invalid/v1"], ["maxContextSize", 524288],
    ["maxOutputTokens", 8192], ["reasoning", { mode: "high" }],
  ])("有效模型配置 %s 改动后失效", async (key, value) => {
    await harness().run()
    expect(cacheFiles()).toHaveLength(1)
    const next = harness({ config: { ...config(), [key as string]: value } })
    await next.run(task("task-2"))
    expect(next.runChunk).toHaveBeenCalledTimes(1)
  })

  it("只变更密钥不失效，缓存与文件名均不保存正文或敏感配置", async () => {
    await harness().run()
    const next = harness({ config: { ...config(), apiKey: "另一模拟密钥" } })
    await next.run(task("task-2"))
    expect(next.runChunk).not.toHaveBeenCalled()
    const entries = cacheFiles()
    expect(entries).toHaveLength(1)
    expect(entries[0][0]).toMatch(/\/[a-f0-9]{64}\.json$/)
    expect(entries[0][1]).not.toContain(body)
    expect(entries[0][1]).not.toContain(config().apiKey)
    expect(entries[0][1]).not.toContain(config().customEndpoint)
    expect(entries[0][1]).not.toContain(memory.rules[0].rule)
  })

  it.each(["name", "aliases", "importanceScore", "chapterIndices"])("所选人物配置 %s 改动后失效", async (field) => {
    await harness().run(task("task-1", "characters"))
    expect(cacheFiles()).toHaveLength(1)
    const nextTask = task("task-2", "characters")
    Object.assign(nextTask.targetCharacters![0], {
      [field]: { name: "叶青", aliases: ["老林"], importanceScore: 70, chapterIndices: [1] }[field],
    })
    const next = harness()
    await next.run(nextTask)
    expect(next.runChunk).toHaveBeenCalledTimes(1)
  })

  it("用户有效偏好变化后失效，但 usageCount、lastUsedAt 和配置更新时间不影响复用", async () => {
    await harness().run()
    memory = { ...memory, updatedAt: 999, rules: memory.rules.map((rule) => ({ ...rule, usageCount: 8, lastUsedAt: 999 })) }
    const unchanged = harness()
    await unchanged.run(task("task-2"))
    expect(unchanged.runChunk).not.toHaveBeenCalled()
    memory = { ...memory, rules: memory.rules.map((rule) => ({ ...rule, rule: "证据按章节分组" })) }
    const changed = harness()
    await changed.run(task("task-3"))
    expect(changed.runChunk).toHaveBeenCalledTimes(1)
  })

  it("不同书籍即使全文相同也不共享结果", async () => {
    await harness().run()
    expect(cacheFiles()).toHaveLength(1)
    const other = { ...task("task-2"), bookId: "book-2", bookPath: `${projectPath}/book-analysis/book-2` }
    fs.files.set(`${other.bookPath}/chapters/ch-0001.md`, source)
    fs.files.set(`${other.bookPath}/metadata.json`, fs.files.get(`${bookPath}/metadata.json`)!)
    const next = harness()
    await next.run(other)
    expect(next.runChunk).toHaveBeenCalledTimes(1)
    expect(cacheFiles()).toHaveLength(2)
  })

  it("显式 forceRefresh 跳过复用，成功后可供后续普通任务复用", async () => {
    await harness().run()
    expect(cacheFiles()).toHaveLength(1)
    const refreshed = harness()
    await refreshed.run({ ...task("refresh-task"), forceRefresh: true })
    expect(refreshed.runChunk).toHaveBeenCalledTimes(1)
    const next = harness()
    await next.run(task("task-3"))
    expect(next.runChunk).not.toHaveBeenCalled()
  })

  it("失败不缓存，失败任务继续时才重新调用 adapter", async () => {
    let fail = true
    const run = harness({ run: async (input) => {
      if (fail) throw new Error("模拟分析失败")
      return outputFor(input.task, input.chunk)
    } })
    await run.run()
    expect(run.scheduler.getSnapshot().tasks[0].status).toBe("failed")
    expect(cacheFiles()).toHaveLength(0)
    fail = false
    await run.scheduler.continueTask("task-1")
    expect(run.runChunk).toHaveBeenCalledTimes(2)
    expect(cacheFiles()).toHaveLength(1)
  })

  it("取消中的 adapter 即使返回结果也不能缓存或持久化为成功", async () => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    const run = harness({ run: async (input) => {
      started()
      await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }))
      return outputFor(input.task, input.chunk)
    } })
    const active = run.run()
    await ready
    await run.scheduler.cancelTask("task-1")
    await active
    expect(run.persistCompleted).not.toHaveBeenCalled()
    expect(cacheFiles()).toHaveLength(0)
    expect(run.scheduler.getSnapshot().tasks[0].status).toBe("cancelled")
    const next = harness()
    await next.run(task("task-2"))
    expect(next.runChunk).toHaveBeenCalledTimes(1)
    expect(cacheFiles()).toHaveLength(1)
  })

  it.each(["损坏 JSON", "缺结果", "版本不符"])("%s 的缓存安全回源", async (reason) => {
    await harness().run()
    expect(cacheFiles()).toHaveLength(1)
    const [path, text] = cacheFiles()[0]
    const parsed = JSON.parse(text)
    fs.files.set(path, reason === "损坏 JSON" ? "{broken" : JSON.stringify({
      ...parsed,
      ...(reason === "缺结果" ? { output: { evidence: [] } } : { version: -1 }),
    }))
    const next = harness()
    await next.run(task("task-2"))
    expect(next.runChunk).toHaveBeenCalledTimes(1)
    expect(next.scheduler.getSnapshot().tasks[0].status).toBe("completed")
  })

  it.each(["读取", "写入"])("缓存%s异常不会阻断分析和后处理", async (operation) => {
    if (operation === "读取") {
      await harness().run()
      expect(cacheFiles()).toHaveLength(1)
      fs.readFile.mockImplementation(async (path) => {
        if (path.includes("/analysis/result-cache/")) throw new Error("模拟缓存读取失败")
        return fs.files.get(path)!
      })
    } else {
      fs.writeFileAtomic.mockImplementation(async (path, text) => {
        if (path.includes("/analysis/result-cache/")) throw new Error("模拟缓存写入失败")
        fs.files.set(path, text)
      })
    }
    const run = harness()
    await run.run(task("task-2"))
    expect(run.runChunk).toHaveBeenCalledTimes(1)
    expect(run.scheduler.getSnapshot().tasks[0].status).toBe("completed")
    expect(run.publish).toHaveBeenCalledTimes(1)
    if (operation === "写入") expect(cacheFiles()).toHaveLength(0)
  })

  it("执行期间正文变化时不把新结果写到旧材料 key", async () => {
    const changed = harness({ run: async (input) => {
      fs.files.set(chapterPath, source.replace("中间关键情节", "中间完全改变"))
      return outputFor(input.task, input.chunk)
    } })
    await changed.run()
    expect(changed.scheduler.getSnapshot().tasks[0].status).toBe("completed")
    expect(cacheFiles()).toHaveLength(0)
    fs.files.set(chapterPath, source)
    const next = harness()
    await next.run(task("task-2"))
    expect(next.runChunk).toHaveBeenCalledTimes(1)
    expect(cacheFiles()).toHaveLength(1)
  })

  it.each(["章节顺序", "区块范围", "任务范围", "模块范围", "skill"])("%s 不同的任务不能复用", async (change) => {
    const original = task()
    original.range = { startOrder: 1, endOrder: 2 }
    original.modules.style.range = original.range
    const originalChunk = { ...chunk(original), chapterIds: ["ch-0001", "ch-0002"], endOrder: 2 }
    fs.files.set(`${bookPath}/chapters/ch-0002.md`, source.replace("order: 1", "order: 2"))
    await harness().run(original, originalChunk)
    expect(cacheFiles()).toHaveLength(1)
    const changed = { ...original, id: "task-2", modules: structuredClone(original.modules) }
    const changedChunk = { ...originalChunk, taskId: changed.id, chapterIds: [...originalChunk.chapterIds] }
    if (change === "章节顺序") changedChunk.chapterIds.reverse()
    if (change === "区块范围") changedChunk.endOrder = 3
    if (change === "任务范围") changed.range = { startOrder: 1, endOrder: 3 }
    if (change === "模块范围") changed.modules.style.range = { startOrder: 1, endOrder: 3 }
    if (change === "skill") {
      changed.selectedSkills = ["story"]
      changed.modules.story = { ...changed.modules.style, skill: "story" }
      changedChunk.skill = "story"
    }
    const next = harness()
    await next.run(changed, changedChunk)
    expect(next.runChunk).toHaveBeenCalledTimes(1)
  })

  it("算法版本不匹配时安全回源", async () => {
    await harness().run()
    expect(cacheFiles()).toHaveLength(1)
    const [path, text] = cacheFiles()[0]
    fs.files.set(path, JSON.stringify({ ...JSON.parse(text), algorithmVersion: "obsolete" }))
    const next = harness()
    await next.run(task("task-2"))
    expect(next.runChunk).toHaveBeenCalledTimes(1)
  })

  it.each(["result", "evidence"])("缺少 %s 的输出不能写入缓存", async (missing) => {
    const incomplete = harness({ run: async (input) => ({ ...outputFor(input.task, input.chunk), [missing]: null }) })
    await incomplete.run()
    expect(cacheFiles()).toHaveLength(0)
    const next = harness()
    await next.run(task("task-2"))
    expect(next.runChunk).toHaveBeenCalledTimes(1)
    expect(cacheFiles()).toHaveLength(1)
  })

  it("角色提取漏掉已选目标时保留旧处理，但不缓存不完整结果", async () => {
    const value = task("partial-task", "characters")
    value.targetCharacters!.push({ ...value.targetCharacters![0], id: "char-other", name: "叶青", aliases: [] })
    const partial = harness()
    await partial.run(value)
    expect(partial.scheduler.getSnapshot().tasks[0].status).toBe("completed")
    expect(cacheFiles()).toHaveLength(0)
    const complete = harness()
    await complete.run(task("complete-task", "characters"))
    expect(cacheFiles()).toHaveLength(1)
  })

  it("无目标清单的旧人物任务无法证明提取完整，保守回源", async () => {
    const value = task("legacy-task", "characters")
    value.targetCharacters = undefined
    await harness().run(value)
    expect(cacheFiles()).toHaveLength(0)
    await harness().run(task("modern-task", "characters"))
    expect(cacheFiles()).toHaveLength(1)
  })

  it("读取缓存期间取消，不调用模型也不把命中持久化成成功", async () => {
    await harness().run()
    expect(cacheFiles()).toHaveLength(1)
    let started!: () => void
    let release!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    fs.readFile.mockImplementation(async (path) => {
      if (path.includes("/analysis/result-cache/")) { started(); await gate }
      return fs.files.get(path)!
    })
    const warm = harness()
    const running = warm.run(task("cancelled-task"))
    await ready
    const cancelling = warm.scheduler.cancelTask("cancelled-task")
    release()
    await Promise.all([running, cancelling])
    expect(warm.runChunk).not.toHaveBeenCalled()
    expect(warm.persistCompleted).not.toHaveBeenCalled()
    expect(warm.scheduler.getSnapshot().tasks[0].status).toBe("cancelled")
    expect(cacheFiles()).toHaveLength(1)
  })

  it.each(["模型", "偏好"])("执行期间%s变化时不向旧配置 key 写入结果", async (change) => {
    let current = config()
    const run = harness({ config: () => current, run: async (input) => {
      if (change === "模型") current = { ...current, model: "changed-model" }
      else memory.rules[0].rule = "新的输出规则"
      return outputFor(input.task, input.chunk)
    } })
    await run.run()
    expect(cacheFiles()).toHaveLength(0)
    expect(run.scheduler.getSnapshot().tasks[0].status).toBe("completed")
    const next = harness({ config: current })
    await next.run(task("task-2"))
    expect(next.runChunk).toHaveBeenCalledTimes(1)
    expect(cacheFiles()).toHaveLength(1)
  })
})

function cacheInput(value = task()): AnalysisResultCacheInput {
  return { task: value, chunk: chunk(value), skill: value.selectedSkills[0], bookPath: value.bookPath, projectPath: value.projectPath, llmConfig: config() }
}

describe("分析缓存依赖注入与完整性防线", () => {
  it("完整读取每章并通过 Web Crypto SHA-256 计算内容及最终键", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest")
    const cache = createAnalysisResultCache({ io: fs, loadUserMemory: () => memory })
    const key = await cache.createKey(cacheInput())
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    expect(digest.mock.calls.every(([algorithm]) => algorithm === "SHA-256")).toBe(true)
    expect(digest.mock.calls.some(([, data]) => new TextDecoder().decode(data) === source)).toBe(true)
    const payload = digest.mock.calls.at(-1)![1]
    expect(key).toBe(createHash("sha256").update(new TextDecoder().decode(payload)).digest("hex"))
  })

  it("算法版本属于 key，但 onRequestTrace 回调身份不属于 key", async () => {
    const first = createAnalysisResultCache({ io: fs, loadUserMemory: () => memory, algorithmVersion: "algorithm-1" })
    const second = createAnalysisResultCache({ io: fs, loadUserMemory: () => memory, algorithmVersion: "algorithm-2" })
    const input = { ...cacheInput(), onRequestTrace: vi.fn() }
    const key = await first.createKey(input)
    expect(key).not.toBeNull()
    expect(await first.createKey({ ...input, onRequestTrace: vi.fn() })).toBe(key)
    expect(await second.createKey(input)).not.toBe(key)
    expect(input.onRequestTrace).not.toHaveBeenCalled()
  })

  it("真实 provider buildBody 的采样参数进入稳定摘要", async () => {
    const actual = providers.getProviderConfig
    let temperature = 0.1
    vi.spyOn(providers, "getProviderConfig").mockImplementation((config) => {
      const provider = actual(config)
      return { ...provider, buildBody: (...args) => ({ ...provider.buildBody(...args) as object, temperature }) }
    })
    const cache = createAnalysisResultCache({ io: fs, loadUserMemory: () => memory })
    const key = await cache.createKey(cacheInput())
    temperature = 0.8
    expect(await cache.createKey(cacheInput())).not.toBe(key)
  })

  it("端点中的认证字段不存储，也不把同端点换密钥当成模型变化", async () => {
    const cache = createAnalysisResultCache({ io: fs, loadUserMemory: () => memory })
    const input = cacheInput()
    input.llmConfig.customEndpoint = "https://user:password@fixture.invalid/v1/chat/completions?token=one&route=a"
    const first = await cache.createKey(input)
    input.llmConfig.customEndpoint = "https://someone:changed@fixture.invalid/v1/chat/completions?token=two&route=a"
    expect(await cache.createKey(input)).toBe(first)
    input.llmConfig.customEndpoint = "https://fixture.invalid/v1/chat/completions?route=b"
    expect(await cache.createKey(input)).not.toBe(first)
  })

  it("项目外书籍路径或越界章节 ID 不生成缓存键", async () => {
    const cache = createAnalysisResultCache({ io: fs, loadUserMemory: () => memory })
    const input = cacheInput()
    expect(await cache.createKey({ ...input, bookPath: "C:/other-project/book-1" })).toBeNull()
    expect(await cache.createKey({ ...input, bookPath: `${projectPath}/../book-1` })).toBeNull()
    expect(await cache.createKey({ ...input, chunk: { ...input.chunk, chapterIds: ["../outside"] } })).toBeNull()
    expect(cacheFiles()).toHaveLength(0)
  })

  it("语法完整但负载被修改的 JSON 因结果 SHA-256 不匹配而回源", async () => {
    await harness().run()
    const [path, text] = cacheFiles()[0]
    const entry = JSON.parse(text)
    entry.output.result.profile.constitution = "被修改的结果"
    fs.files.set(path, JSON.stringify(entry))
    const next = harness()
    await next.run(task("task-2"))
    expect(next.runChunk).toHaveBeenCalledTimes(1)
  })

  it.each(["越界章节", "缺证据引用"])("%s 的完整 JSON 即使摘要匹配也不复用", async (caseName) => {
    await harness().run()
    const [path, text] = cacheFiles()[0]
    const entry = JSON.parse(text)
    if (caseName === "越界章节") entry.output.evidence[0].chapterId = "outside-chapter"
    else entry.output.result.profile.evidenceIds = ["missing-evidence"]
    entry.outputHash = createHash("sha256").update(JSON.stringify(entry.output)).digest("hex")
    fs.files.set(path, JSON.stringify(entry))
    const next = harness()
    await next.run(task("task-2"))
    expect(next.runChunk).toHaveBeenCalledTimes(1)
  })

  it("两个所选人物别名重叠时，一份人物结果不能冒充全部成功", async () => {
    const value = task("partial-alias", "characters")
    value.targetCharacters!.push({ ...value.targetCharacters![0], id: "other", name: "叶青", aliases: ["小林"] })
    await harness().run(value)
    expect(cacheFiles()).toHaveLength(0)
  })

  it("写入时拒绝属于其他任务的证据", async () => {
    const cache = createAnalysisResultCache({ io: fs, loadUserMemory: () => memory })
    const input = cacheInput()
    const key = (await cache.createKey(input))!
    const output = outputFor(input.task, input.chunk)
    output.evidence[0].taskId = "unrelated-task"
    await cache.write(input, key, output)
    expect(cacheFiles()).toHaveLength(0)
  })
})
