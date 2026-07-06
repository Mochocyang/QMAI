import { describe, expect, it } from "vitest"
import { transformHandcraftZonesForReader } from "./handcraft-zone"

describe("transformHandcraftZonesForReader", () => {
  it("高亮带说明括号的作者手搓留白标题", () => {
    const markdown = [
      "### 作者手搓留白（标注哪些地方需要用人设卡/文风/玩梗手工填充）",
      "- 对话设计交给作者。",
      "",
      "### 下一段",
      "继续正文。",
    ].join("\n")

    const result = transformHandcraftZonesForReader(markdown)

    expect(result).toContain("> **作者手搓留白**")
    expect(result).toContain("> - 对话设计交给作者。")
    expect(result).toContain("### 下一段")
  })
})
