import { describe, expect, it } from "vitest"
import {
  isChatEditRequest,
  parseStructuredChapterEdits,
  resolveChatEditTarget,
  validateStructuredChapterEditResult,
} from "./chat-edit-mode"

describe("isChatEditRequest", () => {
  it("detects edit requests and ignores normal chat", () => {
    expect(isChatEditRequest("帮我修改这章内容")).toBe(true)
    expect(isChatEditRequest("帮我润色第一章")).toBe(true)
    expect(isChatEditRequest("这一章节奏怎么样")).toBe(false)
  })
})

describe("resolveChatEditTarget", () => {
  it("defaults to the selected chapter when the user asks to modify this chapter", () => {
    const result = resolveChatEditTarget({
      userRequest: "帮我修改这章内容，让节奏更紧一些",
      selectedChapterNumber: 20,
    })

    expect(result).toEqual({
      ok: true,
      target: {
        chapterNumbers: [20],
        mode: "single",
      },
    })
  })

  it("resolves chapter 1 when the user explicitly asks to modify chapter 1", () => {
    const result = resolveChatEditTarget({
      userRequest: "帮我修改第一章内容",
      selectedChapterNumber: 20,
    })

    expect(result).toEqual({
      ok: true,
      target: {
        chapterNumbers: [1],
        mode: "single",
      },
    })
  })

  it("resolves the previous 10 chapters from the selected chapter anchor", () => {
    const result = resolveChatEditTarget({
      userRequest: "帮我修改前10章内容",
      selectedChapterNumber: 20,
    })

    expect(result).toEqual({
      ok: true,
      target: {
        chapterNumbers: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
        mode: "batch",
      },
    })
  })

  it("returns an error when no chapter is selected for an implicit chapter edit", () => {
    const result = resolveChatEditTarget({
      userRequest: "帮我修改这章内容",
      selectedChapterNumber: null,
    })

    expect(result).toEqual({
      ok: false,
      message: "请先选择要修改的章节。",
    })
  })
})

describe("parseStructuredChapterEdits", () => {
  it("parses structured multi-chapter output into per-chapter content", () => {
    const result = parseStructuredChapterEdits(`
【第11章】
第十一章修改后的正文

【第12章】
第十二章修改后的正文
`)

    expect(Array.from(result.entries())).toEqual([
      [11, "第十一章修改后的正文"],
      [12, "第十二章修改后的正文"],
    ])
  })
})

describe("validateStructuredChapterEditResult", () => {
  it("accepts matching multi-chapter results", () => {
    const result = validateStructuredChapterEditResult({
      content: `
【第11章】
---
chapter_number: 11
title: "第11章"
---
# 第11章

正文1

【第12章】
---
chapter_number: 12
title: "第12章"
---
# 第12章

正文2
`,
      targetChapterNumbers: [11, 12],
    })

    expect(result).toEqual({
      ok: true,
      files: [
        {
          chapterNumber: 11,
          content: expect.stringContaining("正文1"),
        },
        {
          chapterNumber: 12,
          content: expect.stringContaining("正文2"),
        },
      ],
    })
  })

  it("rejects when returned chapter count does not match targets", () => {
    const result = validateStructuredChapterEditResult({
      content: `
【第11章】
---
chapter_number: 11
title: "第11章"
---
# 第11章

正文1
`,
      targetChapterNumbers: [11, 12],
    })

    expect(result).toEqual({
      ok: false,
      message: "修改结果章节数量与目标章节数量不一致，已停止写回。",
    })
  })

  it("rejects when one target chapter block is missing", () => {
    const result = validateStructuredChapterEditResult({
      content: `
【第11章】
---
chapter_number: 11
title: "第11章"
---
# 第11章

正文1

【第13章】
---
chapter_number: 13
title: "第13章"
---
# 第13章

正文3
`,
      targetChapterNumbers: [11, 12],
    })

    expect(result).toEqual({
      ok: false,
      message: "第12章缺少修改结果，已停止写回。",
    })
  })
})
