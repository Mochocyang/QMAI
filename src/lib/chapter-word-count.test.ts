import { describe, expect, it } from "vitest"
import { countChapterBodyWords } from "./chapter-word-count"

describe("countChapterBodyWords", () => {
  it("counts chapter body text without frontmatter or heading", () => {
    const markdown = [
      "---",
      'title: "第3章 你好"',
      "type: chapter",
      "---",
      "",
      "# 第3章 你好",
      "",
      "　　这是正文第一段。",
      "第二段。",
    ].join("\n")

    expect(countChapterBodyWords(markdown)).toBe("这是正文第一段。第二段。".length)
  })

  it("returns zero when a chapter only has a heading", () => {
    expect(countChapterBodyWords("# 第1章\n\n")).toBe(0)
  })
})
