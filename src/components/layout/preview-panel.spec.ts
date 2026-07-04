import { describe, expect, it } from "vitest"
import { shouldSkipEmptyChapterFlush } from "./preview-panel"

describe("shouldSkipEmptyChapterFlush", () => {
  it("skips flushing empty markdown when disk snapshot still has content", () => {
    expect(shouldSkipEmptyChapterFlush("", "---\ntype: chapter\n---\n\n# 第1章\n\n正文")).toBe(true)
  })

  it("allows flushing intentional empty edits when nothing was loaded", () => {
    expect(shouldSkipEmptyChapterFlush("", "")).toBe(false)
  })

  it("allows flushing non-empty markdown", () => {
    expect(shouldSkipEmptyChapterFlush("# 第1章\n\n正文", "")).toBe(false)
  })
})
