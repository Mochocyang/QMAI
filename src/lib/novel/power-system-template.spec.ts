import { beforeEach, describe, expect, it, vi } from "vitest"

const fsMock = {
  fileExists: vi.fn(async () => false),
  readFile: vi.fn(async () => ""),
  getExecutableDir: vi.fn(async () => "C:/App"),
  getResourceDir: vi.fn(async () => "C:/App/_up_"),
}

vi.mock("@/commands/fs", () => ({
  fileExists: (...args: unknown[]) => fsMock.fileExists(...(args as [])),
  readFile: (...args: unknown[]) => fsMock.readFile(...(args as [])),
  getExecutableDir: (...args: unknown[]) => fsMock.getExecutableDir(...(args as [])),
  getResourceDir: (...args: unknown[]) => fsMock.getResourceDir(...(args as [])),
}))

import {
  POWER_PROFILE_TEMPLATE_READY,
  attachPowerSystemHtml,
  extractPowerProfiles,
  getPowerProfileTemplate,
  powerProfileFromMarkdown,
  primePowerProfileTemplate,
  renderPowerProfileForContent,
  renderPowerProfileHtml,
  resetPowerProfileTemplateForTest,
} from "./power-system-template"

beforeEach(() => {
  fsMock.fileExists.mockReset().mockResolvedValue(false)
  fsMock.readFile.mockReset().mockResolvedValue("")
  fsMock.getExecutableDir.mockReset().mockResolvedValue("C:/App")
  fsMock.getResourceDir.mockReset().mockResolvedValue("C:/App/_up_")
  resetPowerProfileTemplateForTest()
})

describe("power-system-template", () => {
  it("内置模板包含全部占位符", () => {
    expect(POWER_PROFILE_TEMPLATE_READY).toBe(true)
    const template = getPowerProfileTemplate()
    expect(template).toContain("__PROFILE_SECTIONS__")
    expect(template).toContain(".pcard.ladder")
    expect(template).toContain(".pcard.matrix")
  })

  it("extractPowerProfiles 解析单个与数组", () => {
    const single = "```json\n" + JSON.stringify({
      powerProfileData: {
        name: "九转玄功",
        tag: "修真",
        sections: [
          { kind: "kv", heading: "体系概览", items: [{ label: "力量本质", text: "灵力" }] },
          { kind: "table", heading: "等级阶梯", head: ["等级", "名称"], rows: [["1", "引气"]] },
        ],
      },
    }) + "\n```"
    const one = extractPowerProfiles(single)
    expect(one).toHaveLength(1)
    expect(one[0].name).toBe("九转玄功")
    expect(one[0].tag).toBe("修真")

    const many = "```json\n" + JSON.stringify({
      powerProfiles: [
        { name: "灵力", sections: [{ heading: "体系概览", items: [{ label: "本质", text: "a" }] }] },
        { name: "体修", sections: [{ heading: "体系概览", items: [{ label: "本质", text: "b" }] }] },
      ],
    }) + "\n```"
    expect(extractPowerProfiles(many).map((doc) => doc.name)).toEqual(["灵力", "体修"])
  })

  it("powerProfileFromMarkdown 解析等级阶梯与代价表", () => {
    const md = [
      "# 力量体系：九转玄功",
      "",
      "以灵力为基。",
      "",
      "## 体系概览",
      "- 力量本质：灵力",
      "- 获取方式：天赋 + 传承",
      "",
      "## 等级阶梯",
      "| 等级 | 名称 | 突破条件 | 战力特征 |",
      "| --- | --- | --- | --- |",
      "| 一阶 | 引气 | 感应灵气 | 可驱物 |",
      "| 二阶 | 凝气 | 打通经脉 | 战力倍增 |",
      "",
      "## 代价与限制",
      "| 等级 | 代价 | 风险 | 反制 |",
      "| --- | --- | --- | --- |",
      "| 二阶 | 经脉受损 | 走火入魔 | 断其灵脉 |",
    ].join("\n")
    const doc = powerProfileFromMarkdown(md)
    expect(doc?.name).toBe("九转玄功")
    expect(doc?.sections.map((section) => section.heading)).toEqual(["体系概览", "等级阶梯", "代价与限制"])
    const ladder = doc?.sections[1]
    expect(ladder).toMatchObject({ kind: "table", head: ["等级", "名称", "突破条件", "战力特征"] })
    if (ladder?.kind === "table") expect(ladder.rows).toHaveLength(2)
  })

  it("renderPowerProfileHtml 按分区语义附加 ladder / matrix 样式类", () => {
    const html = renderPowerProfileHtml({
      name: "九转玄功",
      tag: "修真",
      sections: [
        { kind: "table", heading: "等级阶梯", head: ["等级", "名称"], rows: [["一阶", "引气"]] },
        { kind: "table", heading: "代价与限制", head: ["等级", "代价"], rows: [["一阶", "经脉受损"]] },
        { kind: "kv", heading: "体系概览", items: [{ label: "本质", text: "灵力" }] },
      ],
    })
    expect(html).toContain("力量体系 · 体系卡")
    expect(html).toContain("pcard wide ladder")
    expect(html).toContain("pcard wide matrix")
  })

  it("attachPowerSystemHtml 渲染体系卡；无数据时原样返回；真 HTML 保留", () => {
    const source = "# 力量体系\n## 等级阶梯\n| 等级 | 名称 |\n| --- | --- |\n| 一阶 | 引气 |"
    // 请求形状对齐生产类型 OutlineSaveRequest：htmlContent 是可选的伴生 HTML 字段
    const request: { fileType: string; content: string; htmlContent?: string } = {
      fileType: "setting",
      content: source,
    }
    const attached = attachPowerSystemHtml(request, source)
    expect(attached.htmlContent).toContain("体系卡")

    const empty = { fileType: "setting", content: "" }
    expect(attachPowerSystemHtml(empty, "")).toBe(empty)

    const kept = { fileType: "setting", content: "x", htmlContent: "<!DOCTYPE html><html></html>" }
    expect(attachPowerSystemHtml(kept, "x").htmlContent).toContain("<!DOCTYPE html>")
  })

  it("renderPowerProfileForContent 从 MD 直接产出；空内容返回 null", () => {
    expect(renderPowerProfileForContent("# 力量体系：九转玄功\n## 等级阶梯\n| 等级 | 名称 |\n| --- | --- |\n| 一阶 | 引气 |"))
      .toContain("九转玄功")
    expect(renderPowerProfileForContent("")).toBeNull()
  })

  it("primePowerProfileTemplate 支持项目覆盖与回退", async () => {
    fsMock.fileExists.mockResolvedValue(true)
    fsMock.readFile.mockResolvedValue(
      "CUSTOM __PROFILE_NAME__ __PROFILE_ROLE__ __PROFILE_EYEBROW__ __PROFILE_CHIPS__ __PROFILE_TAGLINE__ __PROFILE_OVERVIEW__ __PROFILE_SECTIONS__",
    )
    await primePowerProfileTemplate("E:/Novel")
    expect(getPowerProfileTemplate()).toContain("CUSTOM")

    resetPowerProfileTemplateForTest()
    fsMock.fileExists.mockResolvedValue(false)
    await primePowerProfileTemplate("E:/Novel")
    expect(getPowerProfileTemplate()).not.toContain("CUSTOM")
  })
})
