import { expect, test } from "vitest"
import { formatChapterWriting } from "./chapter-formatting"

test("inserts spaces between CJK and Latin on normal paragraphs", () => {
  const result = formatChapterWriting("中文English中文")

  expect(result).toBe("　　中文 English 中文")
})

test("keeps full-width first-line indent", () => {
  const result = formatChapterWriting("　　纯中文段落")

  expect(result).toBe("　　纯中文段落")
  expect(result.startsWith("　　")).toBe(true)
})

test("does not alter fenced code content", () => {
  const markdown = ["```", "中文English中文", "```"].join("\n")
  const result = formatChapterWriting(markdown)

  expect(result).toBe(markdown)
})

test("does not alter structural line text (no pangu spacing)", () => {
  const markdown = ["# 标题English", "- 列表English", "> 引用English"].join("\n")
  const result = formatChapterWriting(markdown)

  expect(result).toContain("# 标题English")
  expect(result).toContain("- 列表English")
  expect(result).toContain("> 引用English")
  expect(result).not.toContain("标题 English")
  expect(result).not.toContain("列表 English")
  expect(result).not.toContain("引用 English")
})

test("preserves frontmatter and spaces body prose", () => {
  const markdown = [
    "---",
    "title: 第一章",
    "---",
    "",
    "他说Hello World",
  ].join("\n")

  const result = formatChapterWriting(markdown)

  expect(result.startsWith("---\ntitle: 第一章\n---\n")).toBe(true)
  expect(result).toContain("　　他说 Hello World")
})
