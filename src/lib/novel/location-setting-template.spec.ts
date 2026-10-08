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
  LOCATION_PROFILE_TEMPLATE_READY,
  attachLocationProfileHtml,
  extractLocationProfiles,
  getLocationProfileTemplate,
  locationProfileFromMarkdown,
  primeLocationProfileTemplate,
  renderLocationProfileForContent,
  renderLocationProfileHtml,
  resetLocationProfileTemplateForTest,
} from "./location-setting-template"

/**
 * attachLocationProfileHtml<T extends { fileType: string; htmlContent?: string; content: string; ... }> 返回 T，
 * 因此入参必须显式带上可选的 htmlContent 字段，返回值才暴露 htmlContent（与生产调用方
 * outline-save-request.ts 中的请求类型一致）。
 */
type LocationProfileSaveRequest = {
  fileType: string
  content: string
  htmlContent?: string
}

beforeEach(() => {
  fsMock.fileExists.mockReset().mockResolvedValue(false)
  fsMock.readFile.mockReset().mockResolvedValue("")
  fsMock.getExecutableDir.mockReset().mockResolvedValue("C:/App")
  fsMock.getResourceDir.mockReset().mockResolvedValue("C:/App/_up_")
  resetLocationProfileTemplateForTest()
})

describe("location-setting-template", () => {
  it("内置模板包含全部占位符与地点样式", () => {
    expect(LOCATION_PROFILE_TEMPLATE_READY).toBe(true)
    const template = getLocationProfileTemplate()
    expect(template).toContain("__PROFILE_SECTIONS__")
    expect(template).toContain(".pcard.place")
  })

  it("extractLocationProfiles 解析单个与数组", () => {
    const single = "```json\n" + JSON.stringify({
      locationProfileData: {
        name: "青云峰",
        tag: "宗门驻地",
        sections: [
          { kind: "kv", heading: "地点定位", items: [{ label: "所处区域", text: "东荒" }] },
          { kind: "table", heading: "空间规则", head: ["规则", "说明"], rows: [["剑冢禁地", "非掌门不得入"]] },
        ],
      },
    }) + "\n```"
    const one = extractLocationProfiles(single)
    expect(one).toHaveLength(1)
    expect(one[0].name).toBe("青云峰")

    const many = "```json\n" + JSON.stringify({
      locationProfiles: ["清风镇", "黑风寨"].map((name) => ({
        name, sections: [{ kind: "table", heading: "可触发事件", head: ["事件"], rows: [["x"]] }],
      })),
    }) + "\n```"
    expect(extractLocationProfiles(many).map((doc) => doc.name)).toEqual(["清风镇", "黑风寨"])
  })

  it("locationProfileFromMarkdown 解析空间规则 / 可触发事件", () => {
    const md = [
      "# 地点设定：青云峰",
      "",
      "宗门所在主峰，常年云雾。",
      "",
      "## 地点定位",
      "- 所处区域：东荒",
      "- 意义：青云门门户",
      "",
      "## 空间规则",
      "| 规则 | 说明 | 违反后果 |",
      "| --- | --- | --- |",
      "| 御剑限高 | 峰顶百丈禁飞 | 剑气反噬 |",
      "",
      "## 可触发事件",
      "| 事件 | 触发条件 | 影响 |",
      "| --- | --- | --- |",
      "| 剑冢开启 | 月圆之夜 | 主角得传承 |",
    ].join("\n")
    const doc = locationProfileFromMarkdown(md)
    expect(doc?.name).toBe("青云峰")
    expect(doc?.sections.map((section) => section.heading)).toEqual(["地点定位", "空间规则", "可触发事件"])
    const rules = doc?.sections[1]
    expect(rules).toMatchObject({ kind: "table", head: ["规则", "说明", "违反后果"] })
    if (rules?.kind === "table") expect(rules.rows).toHaveLength(1)
  })

  it("renderLocationProfileHtml 对地点类分区附加 place 样式类", () => {
    const html = renderLocationProfileHtml({
      name: "青云峰",
      tag: "宗门驻地",
      sections: [
        { kind: "table", heading: "空间规则", head: ["规则"], rows: [["御剑限高"]] },
        { kind: "table", heading: "可触发事件", head: ["事件"], rows: [["剑冢开启"]] },
        { kind: "kv", heading: "地点定位", items: [{ label: "所处区域", text: "东荒" }] },
      ],
    })
    expect(html).toContain("地点设定 · 地点卡")
    expect(html).toContain("pcard wide place")
    expect(html).toContain("pcard place")
  })

  it("attachLocationProfileHtml 渲染地点卡；无数据原样返回；真 HTML 保留", () => {
    const source = "# 地点设定\n## 空间规则\n| 规则 | 说明 |\n| --- | --- |\n| 御剑限高 | 峰顶禁飞 |"
    const request: LocationProfileSaveRequest = { fileType: "setting", content: source }
    const attached = attachLocationProfileHtml(request, source)
    expect(attached.htmlContent).toContain("地点卡")

    const empty: LocationProfileSaveRequest = { fileType: "setting", content: "" }
    expect(attachLocationProfileHtml(empty, "")).toBe(empty)

    const kept: LocationProfileSaveRequest = {
      fileType: "setting",
      content: "x",
      htmlContent: "<!DOCTYPE html><html></html>",
    }
    expect(attachLocationProfileHtml(kept, "x").htmlContent).toContain("<!DOCTYPE html>")
  })

  it("renderLocationProfileForContent 与 prime 回退", async () => {
    expect(renderLocationProfileForContent("# 地点设定\n## 空间规则\n| 规则 | 说明 |\n| --- | --- |\n| 御剑限高 | 峰顶禁飞 |"))
      .toContain("地点卡")
    expect(renderLocationProfileForContent("")).toBeNull()

    fsMock.fileExists.mockResolvedValue(true)
    fsMock.readFile.mockResolvedValue(
      "CUSTOM __PROFILE_NAME__ __PROFILE_ROLE__ __PROFILE_EYEBROW__ __PROFILE_CHIPS__ __PROFILE_TAGLINE__ __PROFILE_OVERVIEW__ __PROFILE_SECTIONS__",
    )
    await primeLocationProfileTemplate("E:/Novel")
    expect(getLocationProfileTemplate()).toContain("CUSTOM")
  })
})
