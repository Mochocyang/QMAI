import { describe, expect, it } from "vitest"
import {
  buildPolishSelectionMessages,
  rebuildChapterBody,
  replaceChapterBodySelection,
  replaceWholeChapterBody,
  splitChapterHeading,
} from "./chapter-selection"

describe("chapter-selection", () => {
  it("splits the chapter heading from the writing body", () => {
    expect(splitChapterHeading("# 第一章\n\n正文内容")).toEqual({
      heading: "第一章",
      body: "正文内容",
    })
  })

  it("rebuilds a chapter body with its heading", () => {
    expect(rebuildChapterBody("第一章", "正文内容")).toBe("# 第一章\n\n正文内容")
  })

  it("replaces the selected body slice when the snapshot is still current", () => {
    const result = replaceChapterBodySelection(
      "第一段。\n第二段。",
      {
        start: 4,
        end: 8,
        text: "\n第二段",
        bodySnapshot: "第一段。\n第二段。",
      },
      "\n这是替换后的第二段",
    )

    expect(result).toEqual({
      ok: true,
      body: "第一段。\n这是替换后的第二段。",
    })
  })

  it("refuses to replace when the body changed after the selection snapshot", () => {
    const result = replaceChapterBodySelection(
      "第一段。\n第二段（已修改）。",
      {
        start: 4,
        end: 8,
        text: "\n第二段",
        bodySnapshot: "第一段。\n第二段。",
      },
      "\n替换内容",
    )

    expect(result).toEqual({ ok: false, reason: "changed" })
  })

  it("builds a polish prompt that returns only the polished segment", () => {
    const messages = buildPolishSelectionMessages("她推门走了进去。")
    expect(messages[0]?.role).toBe("system")
    expect(messages[1]?.content).toContain("输出仅返回润色后的正文片段")
  })

  it("preserves chapter frontmatter and heading when replacing the whole chapter body", () => {
    const currentMarkdown = [
      "---",
      'title: "第1章-天钧令牌"',
      "type: chapter",
      "chapter_number: 1",
      "chapter_status: draft",
      "---",
      "",
      "# 第1章-天钧令牌",
      "",
      "原始正文第一段。",
      "原始正文第二段。",
    ].join("\n")

    const result = replaceWholeChapterBody(
      currentMarkdown,
      "去AI味后的正文第一段。\n去AI味后的正文第二段。",
    )

    expect(result).toContain('title: "第1章-天钧令牌"')
    expect(result).toContain("chapter_status: draft")
    expect(result).toContain("# 第1章-天钧令牌")
    expect(result).toContain("去AI味后的正文第一段。")
    expect(result).toContain("去AI味后的正文第二段。")
    expect(result).not.toContain("原始正文第一段。")
  })
})
