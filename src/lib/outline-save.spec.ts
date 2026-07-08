import { describe, expect, it } from "vitest"
import { prepareOutlineSaveDraft } from "./outline-save"

describe("outline save draft", () => {
  it("ignores frontmatter when deriving an outline title", () => {
    const draft = prepareOutlineSaveDraft(
      [
        "---",
        "type: outline-17",
        "title: \"旧标题\"",
        "---",
        "",
        "# 新的大纲标题",
        "",
        "大纲正文",
      ].join("\n"),
      [],
    )

    expect(draft.title).toBe("新的大纲标题")
    expect(draft.content).not.toContain("type: outline-17")
  })

  it("changes the title when it already exists in the outline library", () => {
    const draft = prepareOutlineSaveDraft("# 第1章\n\n新的章纲", ["第1章"])

    expect(draft.title).not.toBe("第1章")
    expect(draft.title).toBe("第1章-AI生成")
  })

  it("normalizes fenced and escaped markdown before saving", () => {
    const draft = prepareOutlineSaveDraft(
      [
        "```markdown",
        "\\# 将乱天下总纲",
        "",
        "\\## 一句话梗概",
        "",
        "\\- 主角用化学戏法立足乱世。",
        "```",
      ].join("\n"),
      [],
    )

    expect(draft.title).toBe("将乱天下总纲")
    expect(draft.content).toContain("# 将乱天下总纲")
    expect(draft.content).toContain("## 一句话梗概")
    expect(draft.content).toContain("- 主角用化学戏法立足乱世。")
    expect(draft.content).not.toContain("```markdown")
    expect(draft.content).not.toContain("\\#")
  })
})
