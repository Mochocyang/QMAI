import { expect, test } from "vitest"
import { formatChapterWriting } from "./chapter-formatting"

test("inserts spaces between CJK and Latin on normal paragraphs", () => {
  const result = formatChapterWriting("中文English中文")

  expect(result).toBe("　　中文 English 中文")
})

test("preserves compact CJK equipment model designations", () => {
  const result = formatChapterWriting("苏-35与道尔-M1、米格-31B和山毛榉-M1")

  expect(result).toBe("　　苏-35 与道尔-M1、米格-31B 和山毛榉-M1")
})

test("preserves the original middle-dot characters", () => {
  const result = formatChapterWriting("阿卜杜拉·萨利赫与让•皮埃尔、安德烈‧伊万诺夫")

  expect(result).toBe("　　阿卜杜拉·萨利赫与让•皮埃尔、安德烈‧伊万诺夫")
})

test("still spaces hyphen operators and preserves explicit negative numbers", () => {
  const result = formatChapterWriting(["中文-英文", "气温 -35℃"].join("\n"))

  expect(result).toBe(["　　中文 - 英文", "　　气温 -35℃"].join("\n"))
})

test("keeps protected model and middle-dot formatting idempotent", () => {
  const once = formatChapterWriting("苏-35与阿卜杜拉·萨利赫")

  expect(formatChapterWriting(once)).toBe(once)
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
