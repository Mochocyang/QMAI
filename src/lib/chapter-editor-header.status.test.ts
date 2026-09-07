import { describe, expect, it } from "vitest"
import { buildChapterEditorHeader } from "./chapter-editor-header"

describe("buildChapterEditorHeader status metadata", () => {
  it("returns the final-chapter label next to word count metadata", () => {
    const markdown = [
      "---",
      'title: "第1章-无我绝响"',
      "type: chapter",
      "chapter_status: final",
      "---",
      "",
      "# 第1章-无我绝响",
      "",
      "这是正文。",
    ].join("\n")

    expect(buildChapterEditorHeader(markdown)).toMatchObject({
      heading: "第1章-无我绝响",
      statusLabel: "正式章节",
      wordCountLabel: `${"这是正文。".length}字`,
    })
  })

  it("returns the draft label for draft chapters", () => {
    const markdown = [
      "---",
      'title: "第2章-回来"',
      "type: chapter",
      "chapter_status: draft",
      "---",
      "",
      "# 第2章-回来",
      "",
      "草稿内容。",
    ].join("\n")

    expect(buildChapterEditorHeader(markdown)).toMatchObject({
      heading: "第2章-回来",
      statusLabel: "草稿",
      wordCountLabel: `${"草稿内容。".length}字`,
    })
  })
})
