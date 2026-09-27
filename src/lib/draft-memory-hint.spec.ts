import { describe, expect, it } from "vitest"
import { resolveDraftMemoryHint, type DraftMemoryHintArrival } from "./draft-memory-hint"

function hint(overrides: Partial<Parameters<typeof resolveDraftMemoryHint>[0]> = {}) {
  return resolveDraftMemoryHint({
    isChapter: true,
    status: "draft",
    wordCount: 12,
    arrival: "select",
    dismissed: false,
    extracting: false,
    currentlyVisible: false,
    ...overrides,
  })
}

describe("草稿提取记忆提示", () => {
  it("点进已有正文的草稿章会显示", () => {
    expect(hint({ arrival: "select" })).toBe(true)
  })

  it("空正文第一次保存成功后显示", () => {
    expect(hint({ arrival: "first-save" as DraftMemoryHintArrival, wordCount: 8 })).toBe(true)
    expect(hint({ arrival: "first-save", wordCount: 0 })).toBe(false)
  })

  it("同一章后续保存不重新打开已关掉的提示", () => {
    expect(hint({ arrival: "stay", currentlyVisible: false })).toBe(false)
    expect(hint({ arrival: "stay", currentlyVisible: true })).toBe(true)
  })

  it("正式章节、非章节、已关闭和提取中都不显示", () => {
    expect(hint({ status: "final" })).toBe(false)
    expect(hint({ status: "revised" })).toBe(false)
    expect(hint({ isChapter: false })).toBe(false)
    expect(hint({ dismissed: true })).toBe(false)
    expect(hint({ extracting: true })).toBe(false)
  })
})
