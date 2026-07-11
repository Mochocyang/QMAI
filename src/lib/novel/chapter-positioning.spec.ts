import { describe, expect, it } from "vitest"
import {
  checkChapterPositioningDistribution,
  checkAdjacentEmotionClustering,
  parsePositionTableFromMarkdown,
  type ChapterPosition,
  type GenrePositioningBaseline,
} from "./chapter-positioning"
import { getChapterPositionsFromOutline } from "./chapter-positioning-fs"

// ==================== 辅助工厂函数 ====================

function makePos(overrides: Partial<ChapterPosition> & { chapterNumber: number }): ChapterPosition {
  return {
    type: "development",
    pressureLevel: 2,
    emotionIntensity: 5,
    note: "",
    ...overrides,
  }
}

// ==================== checkAdjacentEmotionClustering ====================

describe("checkAdjacentEmotionClustering", () => {
  it("returns empty when less than 3 positions", () => {
    expect(checkAdjacentEmotionClustering([makePos({ chapterNumber: 1 })])).toEqual([])
    expect(checkAdjacentEmotionClustering([makePos({ chapterNumber: 1 }), makePos({ chapterNumber: 2 })])).toEqual([])
  })

  it("warns when 3 consecutive chapters have same type and emotionIntensity > 7", () => {
    const positions = [
      makePos({ chapterNumber: 1, type: "climax", emotionIntensity: 9 }),
      makePos({ chapterNumber: 2, type: "climax", emotionIntensity: 8 }),
      makePos({ chapterNumber: 3, type: "climax", emotionIntensity: 9 }),
    ]
    const warnings = checkAdjacentEmotionClustering(positions)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("第1、2、3章")
    expect(warnings[0]).toContain("climax")
  })

  it("does not warn when emotionIntensity is <= 7", () => {
    const positions = [
      makePos({ chapterNumber: 1, type: "climax", emotionIntensity: 7 }),
      makePos({ chapterNumber: 2, type: "climax", emotionIntensity: 7 }),
      makePos({ chapterNumber: 3, type: "climax", emotionIntensity: 7 }),
    ]
    expect(checkAdjacentEmotionClustering(positions)).toEqual([])
  })

  it("does not warn when types differ", () => {
    const positions = [
      makePos({ chapterNumber: 1, type: "climax", emotionIntensity: 9 }),
      makePos({ chapterNumber: 2, type: "development", emotionIntensity: 9 }),
      makePos({ chapterNumber: 3, type: "climax", emotionIntensity: 9 }),
    ]
    expect(checkAdjacentEmotionClustering(positions)).toEqual([])
  })
})

// ==================== checkChapterPositioningDistribution ====================

describe("checkChapterPositioningDistribution", () => {
  it("returns empty for empty positions", () => {
    expect(checkChapterPositioningDistribution([])).toEqual([])
  })

  it("warns when high-pressure chapters exceed 30%", () => {
    const positions = [
      makePos({ chapterNumber: 1, type: "climax" }),
      makePos({ chapterNumber: 2, type: "turn" }),
      makePos({ chapterNumber: 3, type: "climax" }),
      makePos({ chapterNumber: 4, type: "climax" }),
      makePos({ chapterNumber: 5, type: "climax" }),
      makePos({ chapterNumber: 6, type: "climax" }),
    ]
    // 6 chapters, 6 are high-pressure: 100% > 30%
    const warnings = checkChapterPositioningDistribution(positions)
    expect(warnings.some((w) => w.includes("高压章"))).toBe(true)
  })

  it("warns when resolution chapters exceed 10%", () => {
    const positions = [
      makePos({ chapterNumber: 1, type: "resolution" }),
      makePos({ chapterNumber: 2, type: "resolution" }),
      makePos({ chapterNumber: 3, type: "resolution" }),
      makePos({ chapterNumber: 4, type: "development" }),
      makePos({ chapterNumber: 5, type: "development" }),
      makePos({ chapterNumber: 6, type: "development" }),
    ]
    // 6 chapters, 3 resolution: 50% > 10%
    const warnings = checkChapterPositioningDistribution(positions)
    expect(warnings.some((w) => w.includes("收束章"))).toBe(true)
  })

  it("warns when distribution deviates from baseline by more than 15%", () => {
    const positions = [
      makePos({ chapterNumber: 1, type: "opening" }),
      makePos({ chapterNumber: 2, type: "opening" }),
      makePos({ chapterNumber: 3, type: "opening" }),
      makePos({ chapterNumber: 4, type: "opening" }),
      makePos({ chapterNumber: 5, type: "opening" }),
      makePos({ chapterNumber: 6, type: "opening" }),
      makePos({ chapterNumber: 7, type: "opening" }),
      makePos({ chapterNumber: 8, type: "opening" }),
      makePos({ chapterNumber: 9, type: "opening" }),
      makePos({ chapterNumber: 10, type: "opening" }),
    ]
    // 10 chapters, all opening: 100% opening, baseline is 10%, deviation = 90% > 15%
    const warnings = checkChapterPositioningDistribution(positions)
    expect(warnings.some((w) => w.includes("opening"))).toBe(true)
  })

  it("passes with reasonable distribution", () => {
    const positions = [
      makePos({ chapterNumber: 1, type: "opening", emotionIntensity: 4 }),
      makePos({ chapterNumber: 2, type: "development", emotionIntensity: 5 }),
      makePos({ chapterNumber: 3, type: "development", emotionIntensity: 5 }),
      makePos({ chapterNumber: 4, type: "buildup", emotionIntensity: 6 }),
      makePos({ chapterNumber: 5, type: "turn", emotionIntensity: 7 }),
      makePos({ chapterNumber: 6, type: "development", emotionIntensity: 5 }),
      makePos({ chapterNumber: 7, type: "buildup", emotionIntensity: 6 }),
      makePos({ chapterNumber: 8, type: "climax", emotionIntensity: 8 }),
      makePos({ chapterNumber: 9, type: "development", emotionIntensity: 5 }),
      makePos({ chapterNumber: 10, type: "resolution", emotionIntensity: 4 }),
    ]
    // 10 chapters: 1 climax + 1 turn = 20% (<=30%), 1 resolution = 10% (<=10%)
    // distribution: opening=10%(baseline 10%, dev 0), development=40%(baseline 30%, dev 10% <=15%)
    // buildup=20%(baseline 25%, dev 5% <=15%), turn=10%(baseline 15%, dev 5% <=15%)
    // climax=10%(baseline 15%, dev 5% <=15%), resolution=10%(baseline 5%, dev 5% <=15%)
    const warnings = checkChapterPositioningDistribution(positions)
    // No clustering issue: types vary
    const noClusterWarnings = warnings.filter((w) => !w.includes("连续3章"))
    expect(noClusterWarnings).toEqual([])
  })

  it("accepts custom baseline", () => {
    const customBaseline: GenrePositioningBaseline = {
      opening: 50, // 开篇占50%
      development: 20,
      buildup: 10,
      turn: 10,
      climax: 5,
      resolution: 5,
    }
    const positions = [
      makePos({ chapterNumber: 1, type: "opening" }),
      makePos({ chapterNumber: 2, type: "opening" }),
      makePos({ chapterNumber: 3, type: "opening" }),
      makePos({ chapterNumber: 4, type: "development" }),
      makePos({ chapterNumber: 5, type: "development" }),
    ]
    // 5 chapters: 3 opening = 60%, baseline 50%, dev 10% <= 15% → no warning
    const warnings = checkChapterPositioningDistribution(positions, customBaseline)
    const openingWarnings = warnings.filter((w) => w.includes("opening"))
    expect(openingWarnings).toEqual([])
  })
})

// ==================== parsePositionTableFromMarkdown ====================

describe("parsePositionTableFromMarkdown", () => {
  it("parses a valid positioning table", () => {
    const md = `## 章节定位分布表

| 章 | 定位 | 压力级(1-5) | 情绪强度(1-10) | 说明 |
| --- | --- | --- | --- | --- |
| 1 | 开场 | 2 | 5 | 介绍世界观 |
| 2 | 发展 | 3 | 6 | 主角登场 |
| 3 | 高潮 | 5 | 9 | 首次冲突 |
`

    const result = parsePositionTableFromMarkdown(md)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({
      chapterNumber: 1,
      type: "opening",
      pressureLevel: 2,
      emotionIntensity: 5,
      note: "介绍世界观",
    })
    expect(result[1].type).toBe("development")
    expect(result[2].type).toBe("climax")
    expect(result[2].pressureLevel).toBe(5)
    expect(result[2].emotionIntensity).toBe(9)
  })

  it("returns empty array when no table found", () => {
    expect(parsePositionTableFromMarkdown("# 无表格")).toEqual([])
  })

  it("handles incomplete table rows gracefully", () => {
    const md = `| 章 | 定位 | 压力级(1-5) | 情绪强度(1-10) | 说明 |
| --- | --- | --- | --- | --- |
| 1 | 开场 | 2 | 5 | 正常 |
| 不完整行 |
| 3 | 高潮 | 5 | 9 | 跳过非数字章号 |
`
    const result = parsePositionTableFromMarkdown(md)
    expect(result).toHaveLength(2)
    expect(result[0].chapterNumber).toBe(1)
    expect(result[1].chapterNumber).toBe(3)
  })

  it("handles full volume outline markdown", () => {
    const md = `# 卷纲_第1卷

## 核心信息表

| 项目 | 内容 |
| --- | --- |
| 章节范围 | 第1-5章 |

## 章节定位分布表

| 章 | 定位 | 压力级(1-5) | 情绪强度(1-10) | 说明 |
| --- | --- | --- | --- | --- |
| 1 | 开场 | 1 | 4 | 宁静日常 |
| 2 | 发展 | 2 | 5 | 初步探索 |
| 3 | 铺垫 | 3 | 6 | 暗流涌动 |
| 4 | 转折 | 4 | 8 | 真相揭露 |
| 5 | 高潮 | 5 | 9 | 激烈冲突 |
`

    const result = parsePositionTableFromMarkdown(md)
    expect(result).toHaveLength(5)
    expect(result[4].type).toBe("climax")
    expect(result[4].pressureLevel).toBe(5)
    expect(result[4].emotionIntensity).toBe(9)
  })
})

// ==================== getChapterPositionsFromOutline ====================

describe("getChapterPositionsFromOutline", () => {
  it("returns empty array when file does not exist", () => {
    const result = getChapterPositionsFromOutline("/nonexistent/path", 1)
    expect(result).toEqual([])
  })
})
