import { describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { AnalysisSkill, BookAnalysisPipelineTask } from "./analysis-pipeline-types"
import { createStoryAnalysisAdapter } from "./story-analysis-adapter"

function task(): BookAnalysisPipelineTask {
  const module = (skill: AnalysisSkill) => ({
    skill,
    status: "pending" as const,
    range: { startOrder: 1, endOrder: 20 },
    chunkIds: ["chunk-0001-0010", "chunk-0011-0020"],
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
    selectedSkills: ["story"],
    range: { startOrder: 1, endOrder: 20 },
    status: "running",
    currentSkill: "story",
    modules: { characters: module("characters"), story: module("story"), style: module("style") },
    error: null,
    createdAt: 1,
    startedAt: 1,
    completedAt: null,
    updatedAt: 1,
  }
}

const metadata = {
  title: "测试作品",
  totalChapters: 20,
  totalWords: 20000,
  sourceType: "file" as const,
  createdAt: 1,
  updatedAt: 1,
}

describe("story analysis adapter", () => {
  it("只选故事时临时识别人物但不会发布角色结果", async () => {
    const recognizeCharacters = vi.fn(async () => [{
      id: "character-1",
      name: "林远",
      aliases: ["小远"],
      appearances: 1,
      chapterIndices: [0],
      importanceScore: 90,
      category: "主角" as const,
      sourceBook: "测试作品",
    }])
    const mapJson = JSON.stringify({
      mainLineLabel: "成长主线",
      mainSummary: "主角一路推进",
      chapters: [{
        id: "ch-0001",
        order: 1,
        title: "第一章",
        summary: "林远推门而入",
        mainEvents: [{ label: "夜探老宅", beats: ["潜入", "发现线索"], characters: ["林远"] }],
        branches: [{ id: "b1", kind: "foreshadow", label: "老宅秘密", triggeredBy: "夜探老宅", events: [] }],
      }],
    })
    const callModel = vi.fn(async () => mapJson)
    const adapter = createStoryAnalysisAdapter({
      recognizeCharacters,
      callModel,
      loadMetadata: vi.fn(async () => metadata),
      loadChapters: vi.fn(async () => [{ id: "ch-0001", title: "第一章", order: 1, content: "林远推门而入。" }]),
      now: () => 10,
    })
    const inputTask = task()
    const output = await adapter.runChunk({
      task: inputTask,
      skill: "story",
      bookPath: inputTask.bookPath,
      projectPath: inputTask.projectPath,
      llmConfig: {} as LlmConfig,
      chunk: {
        version: 1,
        id: "chunk-0001-0001",
        taskId: inputTask.id,
        skill: "story",
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
      },
      signal: new AbortController().signal,
    })

    expect(recognizeCharacters).toHaveBeenCalledTimes(1)
    expect(callModel.mock.calls[0][0][1].content).toContain("临时人物线索")
    expect(callModel.mock.calls[0][0][1].content).toContain("禁止输出角色 Skill")
    expect(output.result.map.chapters[0].id).toBe("ch-0001")
    expect(output.result.map.chapters[0].branches[0].kind).toBe("foreshadow")
    expect(output.evidence[0].skill).toBe("story")
  })

  it("故事汇总只保留已完成区块的用户章节范围", async () => {
    const mergedJson = JSON.stringify({
      mainLineLabel: "主线",
      chapters: [{ id: "ch-0001", order: 1, summary: "s", mainEvents: [{ label: "e" }] }],
    })
    const callModel = vi.fn(async () => mergedJson)
    const adapter = createStoryAnalysisAdapter({ callModel })
    const inputTask = task()
    const makeMap = (chapterId: string, order: number) => ({
      schemaVersion: 1 as const,
      bookId: inputTask.bookId,
      bookTitle: "测试作品",
      mainLineLabel: "主线",
      mainSummary: "",
      createdAt: 1,
      chapters: [{
        id: chapterId,
        order,
        title: `第${order}章`,
        summary: "s",
        mainEvents: [{ label: "e", beats: [], characters: [] }],
        branches: [],
      }],
    })
    const result = await adapter.aggregate({
      task: inputTask,
      skill: "story",
      bookPath: inputTask.bookPath,
      projectPath: inputTask.projectPath,
      llmConfig: {} as LlmConfig,
      chunks: [
        { map: makeMap("ch-0001", 1), rangeChapterIds: ["ch-0001", "ch-0002"] },
        { map: makeMap("ch-0011", 11), rangeChapterIds: ["ch-0011", "ch-0012"] },
      ],
      signal: new AbortController().signal,
    })

    expect(result.rangeChapterIds).toEqual(["ch-0001", "ch-0002", "ch-0011", "ch-0012"])
    expect(callModel).toHaveBeenCalledTimes(1)
    expect(result.map.chapters[0].id).toBe("ch-0001")
  })

  it("检测到旧版四段区块时明确报错，提示重新提取", async () => {
    const adapter = createStoryAnalysisAdapter({ callModel: vi.fn(async () => "{}") })
    const inputTask = task()
    await expect(adapter.aggregate({
      task: inputTask,
      skill: "story",
      bookPath: inputTask.bookPath,
      projectPath: inputTask.projectPath,
      llmConfig: {} as LlmConfig,
      chunks: [
        { markdown: "区块一", rangeChapterIds: ["ch-0001"] } as never,
        { markdown: "区块二", rangeChapterIds: ["ch-0011"] } as never,
      ],
      signal: new AbortController().signal,
    })).rejects.toThrow("旧版四段格式")
  })

  it("AI 输出漏掉区块最后一章时明确报错，不静默保存不完整导图", async () => {
    const allChapters = Array.from({ length: 10 }, (_, i) => {
      const order = 21 + i
      const id = `ch-${String(order).padStart(4, "0")}`
      return { id, title: `第${order}章`, order, content: `第${order}章正文。` }
    })
    // AI 只输出前 9 章，漏掉 ch-0030（第 30 章），模拟输出截断丢最后一章
    const mapJson = JSON.stringify({
      mainLineLabel: "主线",
      mainSummary: "摘要",
      chapters: allChapters.slice(0, 9).map((chapter) => ({
        id: chapter.id,
        order: chapter.order,
        title: chapter.title,
        summary: "s",
        mainEvents: [{ label: "e", beats: [], characters: [] }],
      })),
    })
    const adapter = createStoryAnalysisAdapter({
      callModel: vi.fn(async () => mapJson),
      loadMetadata: vi.fn(async () => metadata),
      loadChapters: vi.fn(async () => allChapters),
      recognizeCharacters: vi.fn(async () => []),
      now: () => 10,
    })
    const inputTask = task()
    await expect(adapter.runChunk({
      task: inputTask,
      skill: "story",
      bookPath: inputTask.bookPath,
      projectPath: inputTask.projectPath,
      llmConfig: {} as LlmConfig,
      chunk: {
        version: 1,
        id: "chunk-0021-0030",
        taskId: inputTask.id,
        skill: "story",
        chapterIds: allChapters.map((chapter) => chapter.id),
        startOrder: 21,
        endOrder: 30,
        wordCount: 1000,
        status: "running",
        attempts: 1,
        resultPath: null,
        error: null,
        startedAt: 1,
        completedAt: null,
        updatedAt: 1,
      },
      signal: new AbortController().signal,
    })).rejects.toThrow("缺少第 30 章")
  })
})
