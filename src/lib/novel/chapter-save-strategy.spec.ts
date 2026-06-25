import { describe, expect, it } from "vitest"
import { decideChapterSaveStrategy, detectGeneratedTargetChapterNumber } from "./chapter-save-strategy"

describe("decideChapterSaveStrategy", () => {
  it("always saves to the next chapter when there is no explicit generated chapter target", () => {
    const result = decideChapterSaveStrategy({
      selectedChapterNumber: 1,
      selectedChapterHasBody: false,
      generatedTargetChapterNumber: null,
      generatedTargetExists: false,
    })

    expect(result).toEqual({
      action: "direct_next_chapter",
    })
  })

  it("still saves to the next chapter even when the selected chapter already has content", () => {
    const result = decideChapterSaveStrategy({
      selectedChapterNumber: 1,
      selectedChapterHasBody: true,
      generatedTargetChapterNumber: null,
      generatedTargetExists: false,
    })

    expect(result).toEqual({
      action: "direct_next_chapter",
    })
  })

  it("still creates the explicit target chapter when it does not yet exist", () => {
    const result = decideChapterSaveStrategy({
      selectedChapterNumber: 1,
      selectedChapterHasBody: true,
      generatedTargetChapterNumber: 7,
      generatedTargetExists: false,
    })

    expect(result).toEqual({
      action: "direct_explicit_target_new",
      targetChapterNumber: 7,
    })
  })

  it("falls back to the next chapter when the explicit target chapter already exists", () => {
    const result = decideChapterSaveStrategy({
      selectedChapterNumber: 1,
      selectedChapterHasBody: true,
      generatedTargetChapterNumber: 7,
      generatedTargetExists: true,
    })

    expect(result).toEqual({
      action: "direct_next_chapter",
    })
  })

  it("still falls back to the next chapter when the explicit generated target chapter already exists", () => {
    const result = decideChapterSaveStrategy({
      selectedChapterNumber: 1,
      selectedChapterHasBody: false,
      generatedTargetChapterNumber: 7,
      generatedTargetExists: true,
    })

    expect(result).toEqual({
      action: "direct_next_chapter",
    })
  })
})

describe("detectGeneratedTargetChapterNumber", () => {
  it("detects an explicit generated chapter number from the content", () => {
    expect(detectGeneratedTargetChapterNumber("# 第7章 夜雨旧屋\n\n正文内容")).toBe(7)
    expect(detectGeneratedTargetChapterNumber("普通正文，没有章节号")).toBeNull()
  })
})
