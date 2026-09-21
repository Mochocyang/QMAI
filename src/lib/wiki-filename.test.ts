/**
 * Regression suite for chapter filename generation. These tests pin
 * the chapter file-naming policy used by the writing workspace.
 */
import { describe, it, expect } from "vitest"
import { makeChapterFileName, makeChapterFileStem, makeDefaultChapterTitle } from "./wiki-filename"

describe("makeChapterFileName", () => {
  it("uses chapter number plus title without timestamps", () => {
    expect(makeChapterFileName("马皇后", 12)).toBe("第12章-马皇后.md")
  })

  it("does not duplicate an existing chapter prefix from the title", () => {
    expect(makeChapterFileName("第12章 马皇后", 12)).toBe("第12章-马皇后.md")
    expect(makeChapterFileName("第12章：马皇后", 12)).toBe("第12章-马皇后.md")
    expect(makeChapterFileName("第12章-马皇后", 12)).toBe("第12章-马皇后.md")
  })

  it("replaces a stale chapter prefix with the target chapter number", () => {
    expect(makeChapterFileName("第10章-活档", 11)).toBe("第11章-活档.md")
    expect(makeDefaultChapterTitle(11, "第十章-活档")).toBe("第11章-活档")
    expect(makeChapterFileName("第10章", 11)).toBe("第11章.md")
  })

  it("uses only the chapter prefix when the title has no extra name", () => {
    expect(makeChapterFileStem("第12章", 12)).toBe("第12章")
    expect(makeChapterFileName("第12章", 12)).toBe("第12章.md")
  })

  it("builds default chapter titles with a separator", () => {
    expect(makeDefaultChapterTitle(2)).toBe("第2章")
    expect(makeDefaultChapterTitle(2, "章节名称")).toBe("第2章-章节名称")
  })
})