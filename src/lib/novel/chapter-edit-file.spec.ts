import { describe, expect, it } from "vitest"
import { normalizeChapterEditFile } from "./chapter-edit-file"

const ORIGINAL_CHAPTER = `---
type: chapter
chapter_number: 12
chapter_status: draft
title: "第12章"
created: 2026-06-01
---

# 第12章

这里是原始正文。
`

describe("normalizeChapterEditFile", () => {
  it("forces chapter_number and title to match the target chapter", () => {
    const result = normalizeChapterEditFile({
      targetChapterNumber: 12,
      content: `---
chapter_number: 99
title: "第99章 错位标题"
chapter_status: draft
---

# 第99章 错位标题

这里是正文内容。
`,
    })

    expect(result).toEqual({
      ok: true,
      content: expect.stringContaining('chapter_number: 12'),
    })
    if (result.ok) {
      expect(result.content).toContain('title: "第12章"')
      expect(result.content).toContain('# 第12章')
    }
  })

  it("reattaches the original frontmatter when the model returns body-only content (issue #10)", () => {
    const result = normalizeChapterEditFile({
      targetChapterNumber: 12,
      content: `# 第12章\n\n这里是模型修改后的正文。`,
      originalContent: ORIGINAL_CHAPTER,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toContain("type: chapter")
      expect(result.content).toContain("chapter_number: 12")
      expect(result.content).toContain("created: 2026-06-01")
      expect(result.content).toContain("这里是模型修改后的正文。")
    }
  })

  it("synthesizes default chapter frontmatter when neither side has one", () => {
    const result = normalizeChapterEditFile({
      targetChapterNumber: 12,
      content: `# 第12章\n\n这里只有正文`,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toContain("type: chapter")
      expect(result.content).toContain("chapter_number: 12")
      expect(result.content).toContain('title: "第12章"')
    }
  })

  it("prepends a chapter heading when the modified body has none", () => {
    const result = normalizeChapterEditFile({
      targetChapterNumber: 12,
      content: `---
chapter_number: 12
title: "第12章"
---

这里只有正文，没有标题行`,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toContain("# 第12章\n\n这里只有正文，没有标题行")
    }
  })

  it("strips wrapping code fences and 【第N章】 markers from model output", () => {
    const result = normalizeChapterEditFile({
      targetChapterNumber: 12,
      content: "```markdown\n【第12章】\n修改后的正文从这里开始。\n```",
      originalContent: ORIGINAL_CHAPTER,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).not.toContain("```")
      expect(result.content).not.toContain("【第12章】")
      expect(result.content).toContain("修改后的正文从这里开始。")
    }
  })

  it("still rejects an empty modification result", () => {
    const result = normalizeChapterEditFile({
      targetChapterNumber: 12,
      content: "   ",
      originalContent: ORIGINAL_CHAPTER,
    })

    expect(result).toEqual({
      ok: false,
      message: "第12章返回内容缺少正文，已停止写回。",
    })
  })
})
