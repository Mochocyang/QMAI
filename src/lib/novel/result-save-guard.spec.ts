import { describe, expect, it } from "vitest"
import { validateChapterBeforeSave } from "./result-save-guard"

describe("result save guard", () => {
  it("blocks empty chapter content before confirming a draft save", () => {
    const result = validateChapterBeforeSave("")

    expect(result.ok).toBe(false)
    expect(result.message).toContain("章节结果校验未通过")
    expect(result.trace.valid).toBe(false)
  })

  it("allows chapter content that passes result-parser validation", () => {
    const result = validateChapterBeforeSave("# 第一章 测试\n\n这是一个用于校验的章节正文，包含足够的中文内容，避免因为字数过少之外的问题被阻断。这里继续补充剧情内容，让正文结构保持可保存状态。")

    expect(result.ok).toBe(true)
    expect(result.trace.valid).toBe(true)
  })
})
