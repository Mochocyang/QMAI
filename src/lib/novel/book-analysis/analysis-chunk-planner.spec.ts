import { describe, expect, it } from "vitest"
import { CHAPTER_BODY_EXCERPT_MAX_CHARS } from "@/lib/novel/chapter-excerpts"
import {
  buildAnalysisChunkPlan,
  computeAnalysisChunkCharLimit,
  validateAnalysisRange,
} from "./analysis-chunk-planner"

/** 重生巴比伦获得钢铁洪流系统 前 8 章的真实字数：按原文预算会切 7 片，按截断后预算应是 3 片。 */
const babylonWordCounts = [9683, 20060, 26139, 21322, 50165, 60700, 25222, 20085]

const chapters = Array.from({ length: 120 }, (_, index) => ({
  id: `ch-${String(index + 1).padStart(4, "0")}`,
  order: index + 1,
  wordCount: index === 14 ? 50000 : 2000,
}))

describe("analysis chunk planner", () => {
  it("拒绝无效范围和超过 100 章的单次任务", () => {
    expect(() => validateAnalysisRange(chapters, { startOrder: 0, endOrder: 10 }))
      .toThrow("起始章节")
    expect(() => validateAnalysisRange(chapters, { startOrder: 20, endOrder: 10 }))
      .toThrow("结束章节")
    expect(() => validateAnalysisRange(chapters, { startOrder: 1, endOrder: 101 }))
      .toThrow("单次最多分析 100 章")
  })

  it("拒绝包含缺失章节的范围", () => {
    const withGap = chapters.filter((chapter) => chapter.order !== 12)

    expect(() => validateAnalysisRange(withGap, { startOrder: 10, endOrder: 15 }))
      .toThrow("未找到第 12 章")
  })

  it("默认每 10 章切块，单片不超过目标章数", () => {
    const plan = buildAnalysisChunkPlan(
      chapters,
      { startOrder: 1, endOrder: 30 },
      { targetChapterCount: 10, maxChunkChars: 40000 },
    )

    expect(plan.flatMap((chunk) => chunk.chapterIds)).toHaveLength(30)
    expect(plan.every((chunk) => chunk.chapterIds.length <= 10)).toBe(true)
    // 第 15 章原文 50000，截断后按 12000 计，不再单独成块
    expect(plan.some((chunk) => chunk.startOrder <= 15 && chunk.endOrder >= 15 && chunk.chapterIds.length > 1)).toBe(true)
  })

  it("超长章节按截断上限计入预算，不再逐章成片", () => {
    const babylon = babylonWordCounts.map((wordCount, index) => ({
      id: `ch-${String(index + 1).padStart(4, "0")}`,
      order: index + 1,
      wordCount,
    }))
    const plan = buildAnalysisChunkPlan(
      babylon,
      { startOrder: 1, endOrder: 8 },
      { maxChunkChars: 40000 },
    )

    expect(plan.map((chunk) => `${chunk.startOrder}-${chunk.endOrder}`)).toEqual(["1-3", "4-6", "7-8"])
    expect(plan[1].wordCount).toBe(21322 + 50165 + 60700)
  })

  it("单章原文超过 40000 但截断后仍能与相邻章合片", () => {
    const plan = buildAnalysisChunkPlan(
      [
        { id: "ch-0001", order: 1, wordCount: 50000 },
        { id: "ch-0002", order: 2, wordCount: 2000 },
      ],
      { startOrder: 1, endOrder: 2 },
      { maxChunkChars: 40000 },
    )

    expect(plan).toHaveLength(1)
    expect(plan[0].chapterIds).toEqual(["ch-0001", "ch-0002"])
    expect(plan[0].wordCount).toBe(52000)
    expect(CHAPTER_BODY_EXCERPT_MAX_CHARS + 2000).toBeLessThan(40000)
  })

  it("按模型上下文计算保守字数上限", () => {
    expect(computeAnalysisChunkCharLimit(10000)).toBe(8000)
    expect(computeAnalysisChunkCharLimit(60000)).toBe(27000)
    expect(computeAnalysisChunkCharLimit(200000)).toBe(40000)
  })
})
