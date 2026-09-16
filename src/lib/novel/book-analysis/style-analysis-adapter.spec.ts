import { describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { AnalysisChunkRecord, AnalysisSkill, BookAnalysisPipelineTask } from "./analysis-pipeline-types"
import {
  createStyleAnalysisAdapter,
  type StyleAnalysisChunkResult,
} from "./style-analysis-adapter"

function task(overrides: Partial<BookAnalysisPipelineTask> = {}): BookAnalysisPipelineTask {
  const module = (skill: AnalysisSkill) => ({
    skill,
    status: "pending" as const,
    range: { startOrder: 1, endOrder: 10 },
    chunkIds: ["chunk-0001-0010"],
    completedChunkIds: [],
    failedChunkId: null,
    resultPath: null,
    analysisVersion: 1,
    updatedAt: 1,
  })
  return {
    version: 1,
    id: "task-1",
    batchId: null,
    projectPath: "E:/Novel",
    bookId: "book-1",
    bookPath: "E:/Novel/book-analysis/book-1",
    selectedSkills: ["style"],
    range: { startOrder: 1, endOrder: 10 },
    status: "running",
    currentSkill: "style",
    modules: { characters: module("characters"), story: module("story"), style: module("style") },
    error: null,
    createdAt: 1,
    startedAt: 1,
    completedAt: null,
    updatedAt: 1,
    ...overrides,
  }
}

function chunk(overrides: Partial<AnalysisChunkRecord> = {}): AnalysisChunkRecord {
  return {
    version: 1,
    id: "chunk-0001-0001",
    taskId: "task-1",
    skill: "style",
    chapterIds: ["ch-0001"],
    startOrder: 1,
    endOrder: 1,
    wordCount: 100,
    status: "running",
    attempts: 1,
    resultPath: null,
    error: null,
    startedAt: 1,
    completedAt: null,
    updatedAt: 1,
    ...overrides,
  }
}

const metadata = {
  title: "测试作品",
  totalChapters: 1,
  totalWords: 100,
  sourceType: "file" as const,
  createdAt: 1,
  updatedAt: 1,
}

const CHAPTER_BODY = "这是代表性正文。他没有回头。\n\n“别过来。”她退了一步。"

const languageResponse = JSON.stringify({
  languageDna: "短句为主，平均句长偏低。",
  rhythmGuide: "一句一段用于转折。",
  narrativeDensity: "推进快",
  sentenceStyle: "短句",
  rhetoricDensity: "比喻少",
  dialogueStyle: "口语",
  vocabularyPreferences: ["口语化动词"],
  avoidPatterns: ["解释笑点"],
})

const structureResponse = JSON.stringify({
  structurePatterns: "推进章：冲突式开场 → 转折 → 钩子。",
  transitionStyle: "直接跳时间",
  descriptionWeight: "描写少",
  emotionRendering: "动作外显",
  thematicHabits: "不点题",
  samples: ["这是代表性正文。"],
  chapterMeta: [{
    chapterId: "ch-0001",
    hookType: "冲突式",
    structurePattern: "推进章",
    topicTags: ["宗门试炼", "炼丹"],
  }],
  evidence: [{
    chapterId: "ch-0001",
    text: "这是代表性正文。",
    tags: ["幽默对白"],
    reason: "反差",
    purpose: "对白节奏",
  }],
})

const cognitiveResponse = JSON.stringify({
  cognitiveFrame: "### 推进取舍（L3）\n能一句带过就不展开。",
  narrativeVoice: "冷静叙述者",
  pointOfView: "第三人称限知",
  humorMechanisms: ["一本正经地补刀"],
  highEnergyMechanisms: ["目标兑现前连续抬压"],
})

const integratedResponse = [
  "## 语言特征",
  "短句为主，平均句长 12 字。",
  "",
  "## 风格硬约束",
  "1. 环境描写控制在 2 句以内，因为作者用动作带出场景。",
  "2. 比喻只用日常喻体。",
].join("\n")

function makeAdapter(responses: string[], overrides: Record<string, unknown> = {}) {
  const callModel = vi.fn(async () => responses.shift() ?? "")
  const adapter = createStyleAnalysisAdapter({
    readFile: vi.fn(async () => `---\nid: ch-0001\ntitle: 第一章 试炼\n---\n${CHAPTER_BODY}`),
    loadMetadata: vi.fn(async () => metadata),
    callModel,
    now: () => 10,
    fallbackDepth: () => "full",
    ...overrides,
  })
  return { adapter, callModel }
}

function runChunkInput(inputTask: BookAnalysisPipelineTask) {
  return {
    task: inputTask,
    skill: "style" as const,
    bookPath: inputTask.bookPath,
    projectPath: inputTask.projectPath,
    llmConfig: {} as LlmConfig,
    chunk: chunk({ taskId: inputTask.id }),
    signal: new AbortController().signal,
  }
}

describe("style analysis adapter · runChunk", () => {
  it("full 深度跑三次 LLM，产出四层与旧维度", async () => {
    const { adapter, callModel } = makeAdapter([languageResponse, structureResponse, cognitiveResponse])
    const output = await adapter.runChunk(runChunkInput(task()))

    expect(callModel).toHaveBeenCalledTimes(3)
    expect(output.result.layers.languageDna).toBe("短句为主，平均句长偏低。")
    expect(output.result.layers.rhythmGuide).toBe("一句一段用于转折。")
    expect(output.result.layers.structurePatterns).toContain("推进章")
    expect(output.result.layers.cognitiveFrame).toContain("推进取舍")
    expect(output.result.legacy.humorMechanisms).toEqual(["一本正经地补刀"])
    expect(output.result.legacy.highEnergyMechanisms).toEqual(["目标兑现前连续抬压"])
    expect(output.result.legacy.pointOfView).toBe("第三人称限知")
    expect(output.result.legacy.vocabularyPreferences).toEqual(["口语化动词"])
  })

  it("统计指标由脚本算出，不依赖模型输出", async () => {
    const { adapter } = makeAdapter([languageResponse, structureResponse, cognitiveResponse])
    const output = await adapter.runChunk(runChunkInput(task()))

    expect(output.result.metrics.counts.chapters).toBe(1)
    expect(output.result.metrics.counts.sentences).toBeGreaterThan(0)
    expect(output.result.metrics.derived.avgSentenceChars).toBeGreaterThan(0)
    expect(output.result.metrics.counts.dialogueParagraphs).toBe(1)
  })

  it("把统计数字喂进 L1 prompt", async () => {
    const { adapter, callModel } = makeAdapter([languageResponse, structureResponse, cognitiveResponse])
    await adapter.runChunk(runChunkInput(task()))

    const firstPrompt = callModel.mock.calls[0][0][1].content as string
    expect(firstPrompt).toContain("脚本统计结果")
    expect(firstPrompt).toContain("平均句长")
    expect(firstPrompt).toContain("不要重新估算")
  })

  it("章节标注合并模型判断与脚本字段", async () => {
    const { adapter } = makeAdapter([languageResponse, structureResponse, cognitiveResponse])
    const output = await adapter.runChunk(runChunkInput(task()))

    expect(output.result.chapterMeta).toHaveLength(1)
    const entry = output.result.chapterMeta[0]
    expect(entry.chapterId).toBe("ch-0001")
    expect(entry.title).toBe("第一章 试炼")
    expect(entry.hookType).toBe("冲突式")
    expect(entry.topicTags).toEqual(["宗门试炼", "炼丹"])
    expect(entry.sceneCount).toBeGreaterThan(0)
    expect(entry.dialogueRatio).toBeGreaterThan(0)
  })

  it("从 L2 输出解析证据片段并绑定章节顺序", async () => {
    const { adapter } = makeAdapter([languageResponse, structureResponse, cognitiveResponse])
    const output = await adapter.runChunk(runChunkInput(task()))

    expect(output.evidence).toHaveLength(1)
    expect(output.evidence[0].tags).toContain("幽默对白")
    expect(output.evidence[0].chapterOrder).toBe(1)
    expect(output.evidence[0].skill).toBe("style")
  })

  it("fast 深度只调一次 LLM，样本与证据由脚本截取", async () => {
    const { adapter, callModel } = makeAdapter([languageResponse])
    const output = await adapter.runChunk(runChunkInput(task({ styleDepth: "fast" })))

    expect(callModel).toHaveBeenCalledTimes(1)
    expect(output.result.layers.languageDna).toBeTruthy()
    expect(output.result.layers.structurePatterns).toBe("")
    expect(output.result.layers.cognitiveFrame).toBe("")
    expect(output.result.samples.length).toBeGreaterThan(0)
    expect(output.evidence[0].tags).toContain("脚本抽取")
    // fast 模式没有模型标注，但脚本字段仍要落齐
    expect(output.result.chapterMeta[0].hookType).toBe("")
    expect(output.result.chapterMeta[0].sceneCount).toBeGreaterThan(0)
  })

  it("任务上的 styleDepth 覆盖兜底深度", async () => {
    const { adapter, callModel } = makeAdapter(
      [languageResponse, structureResponse, cognitiveResponse],
      { fallbackDepth: () => "fast" },
    )
    await adapter.runChunk(runChunkInput(task({ styleDepth: "full" })))

    expect(callModel).toHaveBeenCalledTimes(3)
  })

  it("任务没写 styleDepth 时用兜底深度（兼容旧任务）", async () => {
    const { adapter, callModel } = makeAdapter([languageResponse], { fallbackDepth: () => "fast" })
    await adapter.runChunk(runChunkInput(task()))

    expect(callModel).toHaveBeenCalledTimes(1)
  })

  it("模型返回非 JSON 时不抛错，走空值降级", async () => {
    const { adapter } = makeAdapter(["抱歉，我无法分析。", "也不行。", "还是不行。"])
    const output = await adapter.runChunk(runChunkInput(task()))

    expect(output.result.layers.languageDna).toBe("")
    expect(output.result.metrics.counts.chapters).toBe(1)
    expect(output.result.samples.length).toBeGreaterThan(0)
  })

  it("章节正文为空时报错", async () => {
    const { adapter } = makeAdapter([languageResponse], {
      readFile: vi.fn(async () => "---\nid: ch-0001\n---\n"),
    })
    await expect(adapter.runChunk(runChunkInput(task()))).rejects.toThrow("正文为空")
  })
})

function chunkResult(overrides: Partial<StyleAnalysisChunkResult> = {}): StyleAnalysisChunkResult {
  return {
    metrics: {
      schemaVersion: 1,
      segmenterAvailable: true,
      counts: {
        chapters: 1, chars: 100, latinChars: 0, sentences: 10, shortSentences: 8,
        longSentences: 1, sentenceCharTotal: 100, paragraphs: 5, oneSentenceParagraphs: 2,
        longParagraphs: 0, dialogueParagraphs: 2,
        punctuation: {
          dash: 1, ellipsis: 0, quote: 4, exclamation: 1,
          question: 0, comma: 10, semicolon: 0, colon: 0,
        },
      },
      derived: {
        avgSentenceChars: 10, shortSentenceRatio: 0.8, longSentenceRatio: 0.1,
        avgParagraphChars: 20, avgParagraphSentences: 2, oneSentenceParagraphRatio: 0.4,
        longParagraphRatio: 0, dialogueParagraphRatio: 0.4,
        punctuationPerThousand: {
          dash: 10, ellipsis: 0, quote: 40, exclamation: 10,
          question: 0, comma: 100, semicolon: 0, colon: 0,
        },
        latinCharRatio: 0,
      },
      topWords: [{ word: "回头", count: 3 }],
      topBigrams: [],
      topSentenceOpeners: [],
    },
    layers: {
      languageDna: "短句为主。",
      structurePatterns: "推进章骨架。",
      cognitiveFrame: "能一句带过就不展开。",
      rhythmGuide: "一句一段用于转折。",
    },
    samples: ["片段一"],
    chapterMeta: [{
      chapterId: "ch-0001", order: 1, title: "第一章", wordCount: 100,
      hookType: "冲突式", structurePattern: "推进章", sceneCount: 2,
      topicTags: ["宗门试炼"], dialogueRatio: 0.4, updatedAt: 10,
    }],
    sampledChapterIds: ["ch-0001"],
    legacy: {
      narrativeDensity: "推进快", sentenceStyle: "短句", rhetoricDensity: "比喻少",
      dialogueStyle: "口语", transitionStyle: "直接跳时间", descriptionWeight: "描写少",
      emotionRendering: "动作外显", thematicHabits: "不点题", narrativeVoice: "冷静",
      pointOfView: "第三人称限知",
      vocabularyPreferences: ["口语化动词"], avoidPatterns: ["解释笑点"],
      humorMechanisms: ["补刀"], highEnergyMechanisms: ["抬压"],
    },
    ...overrides,
  }
}

function aggregateInput(chunks: StyleAnalysisChunkResult[]) {
  const inputTask = task()
  return {
    task: inputTask,
    skill: "style" as const,
    bookPath: inputTask.bookPath,
    projectPath: inputTask.projectPath,
    llmConfig: {} as LlmConfig,
    chunks,
    signal: new AbortController().signal,
  }
}

describe("style analysis adapter · aggregate", () => {
  it("单分片只跑一次整合调用，不逐层汇总", async () => {
    const { adapter, callModel } = makeAdapter([integratedResponse])
    const result = await adapter.aggregate(aggregateInput([chunkResult()]))

    expect(callModel).toHaveBeenCalledTimes(1)
    expect(result.profile.schemaVersion).toBe(2)
    expect(result.profile.layers?.languageDna).toBe("短句为主。")
    expect(result.profile.integratedDna).toContain("语言特征")
    expect(result.profile.constitution).toContain("环境描写控制在 2 句以内")
  })

  it("统计按原始计数相加后重新派生，不是比率取平均", async () => {
    const heavy = chunkResult({
      metrics: {
        ...chunkResult().metrics,
        counts: {
          ...chunkResult().metrics.counts,
          chapters: 1, chars: 100, sentences: 10, shortSentences: 0, longSentences: 10,
        },
      },
    })
    const { adapter } = makeAdapter([
      "L1 合并", "L2 合并", "L3 合并", "L6 合并", integratedResponse,
    ])
    const result = await adapter.aggregate(aggregateInput([chunkResult(), heavy]))

    expect(result.profile.metrics?.counts.chapters).toBe(2)
    expect(result.profile.metrics?.counts.sentences).toBe(20)
    expect(result.profile.metrics?.derived.shortSentenceRatio).toBe(0.4)
    expect(result.profile.metrics?.derived.longSentenceRatio).toBe(0.55)
  })

  it("多分片时每层各汇总一次，再整合", async () => {
    const second = chunkResult({
      layers: {
        languageDna: "另一种语言描述。",
        structurePatterns: "另一种结构。",
        cognitiveFrame: "另一种认知。",
        rhythmGuide: "另一种节奏。",
      },
    })
    const { adapter, callModel } = makeAdapter([
      "L1 合并结果", "L2 合并结果", "L3 合并结果", "L6 合并结果", integratedResponse,
    ])
    const result = await adapter.aggregate(aggregateInput([chunkResult(), second]))

    // 四层各一次 + 整合一次
    expect(callModel).toHaveBeenCalledTimes(5)
    expect(result.profile.layers?.languageDna).toBe("L1 合并结果")
    expect(result.profile.layers?.rhythmGuide).toBe("L6 合并结果")
  })

  it("各分片同一层内容完全相同时不额外调模型", async () => {
    const { adapter, callModel } = makeAdapter([integratedResponse])
    await adapter.aggregate(aggregateInput([chunkResult(), chunkResult()]))
    expect(callModel).toHaveBeenCalledTimes(1)
  })

  it("整合返回空内容时回落到通用宪法", async () => {
    const { adapter } = makeAdapter([""])
    const result = await adapter.aggregate(aggregateInput([chunkResult()]))
    expect(result.profile.integratedDna).toBe("")
    expect(result.profile.constitution).toContain("叙事优先")
  })

  it("章节标注按 chapterId 去重并按顺序排列", async () => {
    const second = chunkResult({
      chapterMeta: [{
        chapterId: "ch-0002", order: 2, title: "第二章", wordCount: 200,
        hookType: "场景式", structurePattern: "过渡章", sceneCount: 1,
        topicTags: ["赶路"], dialogueRatio: 0.1, updatedAt: 10,
      }],
      sampledChapterIds: ["ch-0002"],
    })
    const { adapter } = makeAdapter([
      "L1", "L2", "L3", "L6", integratedResponse,
    ])
    const result = await adapter.aggregate(aggregateInput([second, chunkResult()]))

    expect(result.chapterMeta.map((item) => item.chapterId)).toEqual(["ch-0001", "ch-0002"])
    expect(result.profile.sampledChapterIds).toEqual(["ch-0002", "ch-0001"])
  })

  it("没有已完成分片时报错", async () => {
    const { adapter } = makeAdapter([])
    await expect(adapter.aggregate(aggregateInput([]))).rejects.toThrow("没有已完成的文风区块")
  })
})

describe("style analysis adapter · publish", () => {
  it("落盘整合文档、四份分层产物、style.md 与章节标注", async () => {
    const written = new Map<string, string>()
    const saveChapterMeta = vi.fn(async () => ({
      version: 1 as const, bookId: "book-1", entries: [], updatedAt: 10,
    }))
    const upsertPreset = vi.fn(async () => ({
      id: "style-1", name: "测试作品 · 文风", sourceBook: "测试作品",
      profile: chunkResult() as never, createdAt: 10, updatedAt: 10,
    }))
    const { adapter } = makeAdapter([integratedResponse], {
      writeFile: vi.fn(async (path: string, contents: string) => { written.set(path, contents) }),
      saveChapterMeta,
      upsertPreset,
      replaceEvidence: vi.fn(async () => ({
        version: 1 as const, bookId: "book-1", snippets: [], updatedAt: 10,
      })),
      loadManifest: vi.fn(async () => null),
      saveManifest: vi.fn(async () => undefined),
      rebuildContextIndex: vi.fn(async () => undefined),
    })

    const aggregated = await adapter.aggregate(aggregateInput([chunkResult()]))
    const inputTask = task()
    const resultPath = await adapter.publish({
      task: inputTask,
      skill: "style",
      bookPath: inputTask.bookPath,
      projectPath: inputTask.projectPath,
      llmConfig: {} as LlmConfig,
      result: aggregated,
      evidence: [],
      signal: new AbortController().signal,
    })

    expect(resultPath).toContain("style-profile.json")
    const names = [...written.keys()].map((path) => path.split("/").pop())
    expect(names).toContain("style-profile.json")
    expect(names).toContain("Writing-DNA.md")
    expect(names).toContain("语言DNA.md")
    expect(names).toContain("章节结构模板.md")
    expect(names).toContain("叙事视角与认知框架.md")
    expect(names).toContain("排版节奏指南.md")
    expect(names).toContain("style.md")
    expect(saveChapterMeta).toHaveBeenCalledTimes(1)
    expect(upsertPreset).toHaveBeenCalledTimes(1)
  })

  it("语言DNA.md 带上脚本统计表", async () => {
    const written = new Map<string, string>()
    const { adapter } = makeAdapter([integratedResponse], {
      writeFile: vi.fn(async (path: string, contents: string) => { written.set(path, contents) }),
      saveChapterMeta: vi.fn(async () => ({
        version: 1 as const, bookId: "book-1", entries: [], updatedAt: 10,
      })),
      upsertPreset: vi.fn(async () => ({
        id: "style-1", name: "n", sourceBook: "测试作品",
        profile: chunkResult() as never, createdAt: 10, updatedAt: 10,
      })),
      replaceEvidence: vi.fn(async () => ({
        version: 1 as const, bookId: "book-1", snippets: [], updatedAt: 10,
      })),
      loadManifest: vi.fn(async () => null),
      saveManifest: vi.fn(async () => undefined),
      rebuildContextIndex: vi.fn(async () => undefined),
    })

    const aggregated = await adapter.aggregate(aggregateInput([chunkResult()]))
    const inputTask = task()
    await adapter.publish({
      task: inputTask,
      skill: "style",
      bookPath: inputTask.bookPath,
      projectPath: inputTask.projectPath,
      llmConfig: {} as LlmConfig,
      result: aggregated,
      evidence: [],
      signal: new AbortController().signal,
    })

    const languageDna = [...written.entries()].find(([path]) => path.endsWith("语言DNA.md"))?.[1] ?? ""
    expect(languageDna).toContain("脚本统计")
    expect(languageDna).toContain("平均句长")
    expect(languageDna).toContain("短句为主。")
  })
})
