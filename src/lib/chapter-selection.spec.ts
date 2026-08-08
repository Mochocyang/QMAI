import { describe, expect, it } from "vitest"
import { extractDeAiChapterText, replaceWholeChapterBody } from "./chapter-selection"

describe("extractDeAiChapterText", () => {
  it("strips YAML frontmatter and chapter heading so compare uses body prose only", () => {
    const markdown = [
      "---",
      "type: chapter",
      "title: 第一章",
      "chapter_number: 1",
      "tags: [开篇, 主角]",
      "---",
      "",
      "# 第一章",
      "",
      "雨忽然停了。",
      "他抬起头。",
    ].join("\n")

    expect(extractDeAiChapterText(markdown)).toBe("雨忽然停了。\n他抬起头。")
  })

  it("strips wrapping markdown fences from model output", () => {
    expect(extractDeAiChapterText("```markdown\n改写后的正文\n```")).toBe("改写后的正文")
  })

  it("keeps plain prose unchanged", () => {
    expect(extractDeAiChapterText("只有正文")).toBe("只有正文")
  })

  it("matches the prose that replaceWholeChapterBody will write back", () => {
    const current = [
      "---",
      "type: chapter",
      "title: 第一章",
      "---",
      "# 第一章",
      "",
      "旧正文",
    ].join("\n")
    const candidate = [
      "---",
      "title: 不该写回",
      "---",
      "# 假标题",
      "",
      "新正文",
    ].join("\n")

    const written = replaceWholeChapterBody(current, candidate)
    expect(extractDeAiChapterText(current)).toBe("旧正文")
    expect(extractDeAiChapterText(candidate)).toBe("新正文")
    expect(written).not.toContain("旧正文")
    expect(written).toContain("新正文")
    expect(written).toContain("# 第一章")
    expect(written).not.toContain("不该写回")
  })
})
