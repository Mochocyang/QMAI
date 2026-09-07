import { describe, expect, it } from "vitest"
import { formatAppTitle } from "./app-title"

describe("应用标题", () => {
  it("有项目名称时使用竖线追加项目名称", () => {
    expect(formatAppTitle("我的长篇小说")).toBe("青幕AI写作｜我的长篇小说")
  })

  it("有项目名称和总字数时在项目名称后追加总字数", () => {
    expect(formatAppTitle("将乱天下", 17637)).toBe("青幕AI写作｜将乱天下｜总字数：17637字")
  })

  it("没有项目名称时仅显示应用名称", () => {
    expect(formatAppTitle("   ")).toBe("青幕AI写作")
    expect(formatAppTitle(null)).toBe("青幕AI写作")
  })
})
