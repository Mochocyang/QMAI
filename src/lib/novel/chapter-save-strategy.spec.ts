import { describe, expect, it } from "vitest"
import { decideChapterSaveStrategy, detectGeneratedTargetChapterNumber } from "./chapter-save-strategy"

describe("decideChapterSaveStrategy", () => {
  it("没有写明章号时存到下一章", () => {
    expect(decideChapterSaveStrategy({
      generatedTargetChapterNumber: null,
    })).toEqual({
      action: "direct_next_chapter",
    })
  })

  it("写明了第 N 章就存到第 N 章，不管这一章是否已经有文件", () => {
    expect(decideChapterSaveStrategy({
      generatedTargetChapterNumber: 7,
    })).toEqual({
      action: "direct_explicit_target_new",
      targetChapterNumber: 7,
    })
  })
})

describe("detectGeneratedTargetChapterNumber", () => {
  it("detects an explicit generated chapter number from the content", () => {
    expect(detectGeneratedTargetChapterNumber("# 第7章 夜雨旧屋\n\n正文内容")).toBe(7)
    expect(detectGeneratedTargetChapterNumber("普通正文，没有章节号")).toBeNull()
  })
})
