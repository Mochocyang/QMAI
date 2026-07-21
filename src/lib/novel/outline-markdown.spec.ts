import { describe, expect, it } from "vitest"
import { buildPureOutlineMarkdown, stripOutlineFrontmatter } from "./outline-markdown"

describe("纯 Markdown 大纲", () => {
  it("移除历史 YAML 并保留正文 Markdown 符号", () => {
    const result = stripOutlineFrontmatter([
      "---",
      "type: outline",
      "outline_type: chapter-outline",
      "source_intent: \"生成章纲\"",
      "---",
      "",
      "# 第001章章纲",
      "",
      "- 主角进入旧城",
      "- **关键伏笔**浮现",
    ].join("\n"))

    expect(result).toBe("# 第001章章纲\n\n- 主角进入旧城\n- **关键伏笔**浮现\n")
    expect(result).not.toContain("type: outline")
    expect(result).not.toContain("---")
  })

  it("正文没有一级标题时补充标题", () => {
    expect(buildPureOutlineMarkdown("故事总纲", "## 第一卷\n\n正文")).toBe(
      "# 故事总纲\n\n## 第一卷\n\n正文\n",
    )
  })

  it("正文已有一级标题时不重复添加", () => {
    expect(buildPureOutlineMarkdown("不会重复", "# 已有标题\n\n正文\n\n")).toBe(
      "# 已有标题\n\n正文\n",
    )
  })
})
