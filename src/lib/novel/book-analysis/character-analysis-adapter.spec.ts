import { describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { AnalysisSkill, BookAnalysisPipelineTask } from "./analysis-pipeline-types"
import { createCharacterAnalysisAdapter, mergeCharacterChunkResults } from "./character-analysis-adapter"
import type { ExtractedCharacter } from "./types"

function character(overrides: Partial<ExtractedCharacter>): ExtractedCharacter {
  return {
    id: "character-1",
    name: "林远",
    aliases: [],
    importance: 8,
    category: "protagonist",
    firstAppearance: 1,
    lastAppearance: 10,
    appearanceCount: 3,
    description: "主角",
    personality: "克制",
    speechStyle: "短句",
    relationships: [],
    keyEvents: [],
    ...overrides,
  }
}

function task(): BookAnalysisPipelineTask {
  const module = (skill: AnalysisSkill) => ({
    skill,
    status: "running" as const,
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
    selectedSkills: ["characters"],
    range: { startOrder: 1, endOrder: 20 },
    status: "running",
    currentSkill: "characters",
    modules: { characters: module("characters"), story: module("story"), style: module("style") },
    error: null,
    createdAt: 1,
    startedAt: 1,
    completedAt: null,
    updatedAt: 1,
  }
}

describe("character analysis adapter", () => {
  it("合并同一人物的别名、章节、关系、动机和成长弧", () => {
    const merged = mergeCharacterChunkResults([
      [character({ name: "林远", aliases: ["小远"], firstAppearance: 1, lastAppearance: 10, motivation: "保护家人" })],
      [character({ id: "character-2", name: "小远", aliases: ["林远"], firstAppearance: 11, lastAppearance: 20, growthArc: "从退让到承担" })],
    ])

    expect(merged).toHaveLength(1)
    expect([merged[0].name, ...merged[0].aliases]).toEqual(expect.arrayContaining(["林远", "小远"]))
    expect(merged[0].firstAppearance).toBe(1)
    expect(merged[0].lastAppearance).toBe(20)
    expect(merged[0].motivation).toBe("保护家人")
    expect(merged[0].growthArc).toContain("从退让到承担")
  })

  it("发布时只保存角色信息，等待用户选择角色后再生成 Skill", async () => {
    const persistCharacter = vi.fn(async () => {})
    const generateSkills = vi.fn(async () => [])
    const replaceEvidence = vi.fn(async () => ({ version: 1 as const, bookId: "book-1", snippets: [], updatedAt: 1 }))
    const saveManifest = vi.fn(async () => {})
    const rebuildContextIndex = vi.fn(async () => ({ version: 1 as const, books: [], updatedAt: 1 }))
    const adapter = createCharacterAnalysisAdapter({
      persistCharacter,
      generateSkills,
      replaceEvidence,
      saveManifest,
      rebuildContextIndex,
      loadManifest: vi.fn(async () => null),
      loadMetadata: vi.fn(async () => ({
        title: "测试作品",
        totalChapters: 20,
        totalWords: 20000,
        sourceType: "file" as const,
        createdAt: 1,
        updatedAt: 1,
      })),
      now: () => 10,
    })
    const inputTask = task()
    const evidence = [{
      version: 1 as const,
      id: "evidence-1",
      bookId: "book-1",
      skill: "characters" as const,
      taskId: "task-1",
      chapterId: "ch-0001",
      chapterOrder: 1,
      text: "代表性台词",
      tags: ["林远"],
      reason: "体现语言模式",
      purpose: "角色塑造",
      enabled: true,
      userPinned: false,
      createdAt: 1,
      updatedAt: 1,
    }]

    await adapter.publish({
      task: inputTask,
      skill: "characters",
      bookPath: inputTask.bookPath,
      projectPath: inputTask.projectPath,
      llmConfig: {} as LlmConfig,
      result: [character({})],
      evidence,
      signal: new AbortController().signal,
    })

    expect(persistCharacter).toHaveBeenCalledTimes(1)
    expect(generateSkills).not.toHaveBeenCalled()
    expect(replaceEvidence).toHaveBeenCalledWith(inputTask.bookPath, "characters", evidence)
    expect(saveManifest).toHaveBeenCalledTimes(1)
    expect(rebuildContextIndex).toHaveBeenCalledWith(inputTask.projectPath)
  })

  it("所有区块都没有可提取角色时给出明确失败原因", async () => {
    const adapter = createCharacterAnalysisAdapter()
    const inputTask = task()

    await expect(adapter.aggregate({
      task: inputTask,
      skill: "characters",
      bookPath: inputTask.bookPath,
      projectPath: inputTask.projectPath,
      llmConfig: {} as LlmConfig,
      chunks: [{ characters: [] }, { characters: [] }],
      signal: new AbortController().signal,
    })).rejects.toThrow("未识别到可提取角色")
  })
})
