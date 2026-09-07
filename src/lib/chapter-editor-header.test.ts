import { describe, expect, it } from "vitest"
import { buildChapterEditorHeader } from "./chapter-editor-header"

describe("buildChapterEditorHeader", () => {
  it("returns heading text, status label, word count label, and title input width", () => {
    const markdown = [
      "---",
      'title: "你好呀！"',
      "type: chapter",
      "chapter_status: draft",
      "---",
      "",
      "# 你好呀！",
      "",
      "这是正文。",
      "第二句。",
    ].join("\n")

    expect(buildChapterEditorHeader(markdown)).toEqual({
      heading: "你好呀！",
      status: "draft",
      statusLabel: "草稿",
      wordCountLabel: `${"这是正文。第二句。".length}字`,
      titleInputWidthCh: 8,
    })
  })

  it("falls back to the frontmatter title when the chapter body has no heading yet", () => {
    const markdown = [
      "---",
      'title: "第2章"',
      "type: chapter",
      "chapter_status: draft",
      "---",
      "",
    ].join("\n")

    expect(buildChapterEditorHeader(markdown)).toEqual({
      heading: "第2章",
      status: "draft",
      statusLabel: "草稿",
      wordCountLabel: "0字",
      titleInputWidthCh: 5,
    })
  })
})
