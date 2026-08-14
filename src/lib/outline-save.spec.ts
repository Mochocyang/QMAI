import { describe, expect, it } from "vitest"
import {
  buildClassifiedOutlineSaveRequest,
  isSaveableOutlineDeliverable,
  prepareOutlineSaveDraft,
  prepareOutlineSaveSourceContent,
} from "./outline-save"

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

  it("prepareOutlineSaveSourceContent 保留 markdown 围栏中的大纲正文", () => {
    const source = prepareOutlineSaveSourceContent([
      "好的，以下是完整大纲：",
      "",
      "```markdown",
      "# 修仙界总纲",
      "",
      "## 世界观",
      "灵气复苏，门派林立。",
      "```",
      "",
      "```json",
      JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "大纲",
          fileName: "总纲.md",
          fileType: "outline",
          writeMode: "create",
          referencedSkills: [],
          sourceIntent: "生成总纲",
        },
      }),
      "```",
    ].join("\n"))

    expect(source).toContain("修仙界总纲")
    expect(source).toContain("灵气复苏")
    expect(source).not.toContain("outlineSaveRequest")
    expect(source).not.toContain("```")
  })

  it("完整章纲即使引用卷纲节拍也判定为可保存章纲", () => {
    const content = [
      "# 章纲-第46章：第一次冷处理",
      "",
      "## 上层依据",
      "- **卷纲节拍：** 终局期",
      "",
      "## 本章目标",
      "男主第一次被公司冷处理，被迫从执行者转成旁观者。",
      "",
      "## 核心事件",
      "1. 早会被点名缺席关键项目。",
      "2. 直属领导改口称他先休息。",
      "3. 同事开始绕开他同步进度。",
      "",
      "## 场景顺序",
      "公司早会 → 茶水间 → 回家。",
    ].join("\n")

    expect(isSaveableOutlineDeliverable(content)).toBe(true)
    expect(buildClassifiedOutlineSaveRequest({
      content,
      sourceIntent: "生成完成后自动保存",
      sourceHint: "编写第 46 章章纲",
    })).toMatchObject({
      classification: {
        fileType: "chapter-outline",
        targetFolder: "章纲",
      },
      request: {
        fileType: "chapter-outline",
        targetFolder: "章纲",
        sourceIntent: "生成完成后自动保存",
      },
    })
  })

  it("短问答不视为可保存大纲", () => {
    expect(isSaveableOutlineDeliverable("第46章可以按卷纲节拍写冷处理。")).toBe(false)
    expect(isSaveableOutlineDeliverable("好的，我明白了。")).toBe(false)
  })
})
