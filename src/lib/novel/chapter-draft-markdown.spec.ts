import { describe, expect, it } from "vitest"
import { parseFrontmatter } from "@/lib/frontmatter"
import { buildDraftChapterMarkdown } from "@/lib/novel/chapter-draft-markdown"

describe("buildDraftChapterMarkdown", () => {
  it("字段顺序固定，标题只进 frontmatter、正文不带 H1", () => {
    const markdown = buildDraftChapterMarkdown(12, "第十二章 雨夜递刀", "　　雨停在子时。")

    expect(markdown.startsWith([
      "---",
      "type: chapter",
      "chapter_number: 12",
      "chapter_status: draft",
      'title: "第十二章 雨夜递刀"',
    ].join("\n"))).toBe(true)
    expect(markdown.endsWith("---\n　　雨停在子时。\n"), "frontmatter 之后直接接正文，不留空行").toBe(true)
    // 正文里不得再出现一次章名（否则章节头会把章名显示两遍）
    expect(markdown).not.toMatch(/^#\s/m)
  })

  it("chapter_status 是字面量 draft：没有开关能产出 final", () => {
    const markdown = buildDraftChapterMarkdown(1, "第一章", "正文")

    expect(markdown).toContain("chapter_status: draft")
    expect(markdown).not.toMatch(/chapter_status:\s*final/)
    // 三个参数里没有一个能把它翻成 final（草稿隔离的落点就在这一句字面量上）
    expect(markdown).toBe([
      "---",
      "type: chapter",
      "chapter_number: 1",
      "chapter_status: draft",
      'title: "第一章"',
      `created: ${new Date().toISOString().slice(0, 10)}`,
      "---",
      "正文",
      "",
    ].join("\n"))
  })

  it("标题里的引号与反斜杠必须转义，否则整段 frontmatter 读不回来", () => {
    const markdown = buildDraftChapterMarkdown(3, '他说"别回头"\\ 然后走了', "正文")

    expect(markdown).toContain('title: "他说\\"别回头\\"\\\\ 然后走了"')
    const { frontmatter, body } = parseFrontmatter(markdown)
    expect(frontmatter?.title, "转义之后标题必须能原样解析回来").toBe('他说"别回头"\\ 然后走了')
    // 这一层解析器把标量一律读成字符串（与 chapter-meta 的 parseChapterNumber 同一前提）
    expect(String(frontmatter?.chapter_number)).toBe("3")
    expect(frontmatter?.chapter_status).toBe("draft")
    expect(frontmatter?.type).toBe("chapter")
    expect(body, "正文原样保留（parseFrontmatter 不吞掉正文末尾的换行）").toBe("正文\n")
  })

  it("created 是一个 YYYY-MM-DD 日期，正文末尾恰好一个换行", () => {
    const markdown = buildDraftChapterMarkdown(7, "第七章", "　　正文。")
    const { frontmatter } = parseFrontmatter(markdown)

    expect(String(frontmatter?.created)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(markdown.endsWith("\n")).toBe(true)
    expect(markdown.endsWith("\n\n")).toBe(false)
  })
})
