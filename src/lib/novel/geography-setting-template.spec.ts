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
  GEOGRAPHY_PROFILE_TEMPLATE_READY,
  attachGeographyProfileHtml,
  extractGeographyProfiles,
  geographyProfileFromMarkdown,
  getGeographyProfileTemplate,
  primeGeographyProfileTemplate,
  renderGeographyProfileForContent,
  renderGeographyProfileHtml,
  resetGeographyProfileTemplateForTest,
} from "./geography-setting-template"

/**
 * attachGeographyProfileHtml<T extends { fileType: string; htmlContent?: string; content: string }> 返回 T，
 * 因此入参必须显式带上可选的 htmlContent 字段，返回值才暴露 htmlContent（与生产调用方
 * outline-save-request.ts 中的请求类型一致）。
 */
type GeographyProfileSaveRequest = {
  fileType: string
  content: string
  htmlContent?: string
}

beforeEach(() => {
  fsMock.fileExists.mockReset().mockResolvedValue(false)
  fsMock.readFile.mockReset().mockResolvedValue("")
  fsMock.getExecutableDir.mockReset().mockResolvedValue("C:/App")
  fsMock.getResourceDir.mockReset().mockResolvedValue("C:/App/_up_")
  resetGeographyProfileTemplateForTest()
})

describe("geography-setting-template", () => {
  it("内置模板包含全部占位符", () => {
    expect(GEOGRAPHY_PROFILE_TEMPLATE_READY).toBe(true)
    const template = getGeographyProfileTemplate()
    expect(template).toContain("__PROFILE_SECTIONS__")
    expect(template).toContain(".pcard.map")
  })

  it("extractGeographyProfiles 解析单个与数组", () => {
    const single = "```json\n" + JSON.stringify({
      geographyProfileData: {
        name: "九霄大陆",
        tag: "大陆",
        sections: [
          { kind: "kv", heading: "地理概览", items: [{ label: "世界格局", text: "三洲一海" }] },
          { kind: "table", heading: "区域划分", head: ["区域", "类型"], rows: [["东荒", "荒原"]] },
        ],
      },
    }) + "\n```"
    const one = extractGeographyProfiles(single)
    expect(one).toHaveLength(1)
    expect(one[0].name).toBe("九霄大陆")

    const many = "```json\n" + JSON.stringify({
      geographyProfiles: ["东荒", "西漠"].map((name) => ({
        name, sections: [{ heading: "区域划分", head: ["区域"], rows: [["x"]] }],
      })),
    }) + "\n```"
    expect(extractGeographyProfiles(many).map((doc) => doc.name)).toEqual(["东荒", "西漠"])
  })

  it("geographyProfileFromMarkdown 解析区域划分 / 重要地点 / 势力分布", () => {
    const md = [
      "# 地理设定：九霄大陆",
      "",
      "三洲一海，灵气东盛西衰。",
      "",
      "## 地理概览",
      "- 世界格局：三洲一海",
      "- 核心资源：灵脉",
      "",
      "## 区域划分",
      "| 区域 | 类型 | 地域特征 | 所属势力 |",
      "| --- | --- | --- | --- |",
      "| 东荒 | 荒原 | 灵气稀薄 | 青云门 |",
      "| 中州 | 平原 | 灵脉密集 | 天机阁 |",
      "",
      "## 势力分布",
      "| 势力 | 控制区域 | 影响力 |",
      "| --- | --- | --- |",
      "| 青云门 | 东荒 | 高 |",
    ].join("\n")
    const doc = geographyProfileFromMarkdown(md)
    expect(doc?.name).toBe("九霄大陆")
    expect(doc?.sections.map((section) => section.heading)).toEqual(["地理概览", "区域划分", "势力分布"])
    const regions = doc?.sections[1]
    expect(regions).toMatchObject({ kind: "table", head: ["区域", "类型", "地域特征", "所属势力"] })
    if (regions?.kind === "table") expect(regions.rows).toHaveLength(2)
  })

  it("renderGeographyProfileHtml 对区域类分区附加 map 样式类", () => {
    const html = renderGeographyProfileHtml({
      name: "九霄大陆",
      tag: "大陆",
      sections: [
        { kind: "table", heading: "区域划分", head: ["区域", "类型"], rows: [["东荒", "荒原"]] },
        { kind: "table", heading: "势力分布", head: ["势力", "控制区域"], rows: [["青云门", "东荒"]] },
        { kind: "kv", heading: "地理概览", items: [{ label: "世界格局", text: "三洲一海" }] },
      ],
    })
    expect(html).toContain("地理设定 · 地理卡")
    expect(html).toContain("pcard wide map")
    expect(html).toContain("pcard map")
  })

  it("attachGeographyProfileHtml 渲染地理卡；无数据原样返回；真 HTML 保留", () => {
    const source = "# 地理设定\n## 区域划分\n| 区域 | 类型 |\n| --- | --- |\n| 东荒 | 荒原 |"
    const attached: GeographyProfileSaveRequest = { fileType: "setting", content: source }
    expect(attachGeographyProfileHtml(attached, source).htmlContent).toContain("地理卡")

    const empty: GeographyProfileSaveRequest = { fileType: "setting", content: "" }
    expect(attachGeographyProfileHtml(empty, "")).toBe(empty)

    const kept: GeographyProfileSaveRequest = { fileType: "setting", content: "x", htmlContent: "<!DOCTYPE html><html></html>" }
    expect(attachGeographyProfileHtml(kept, "x").htmlContent).toContain("<!DOCTYPE html>")
  })

  it("renderGeographyProfileForContent 与 prime 回退", async () => {
    expect(renderGeographyProfileForContent("# 地理设定\n## 区域划分\n| 区域 | 类型 |\n| --- | --- |\n| 东荒 | 荒原 |"))
      .toContain("地理卡")
    expect(renderGeographyProfileForContent("")).toBeNull()

    fsMock.fileExists.mockResolvedValue(true)
    fsMock.readFile.mockResolvedValue(
      "CUSTOM __PROFILE_NAME__ __PROFILE_ROLE__ __PROFILE_EYEBROW__ __PROFILE_CHIPS__ __PROFILE_TAGLINE__ __PROFILE_OVERVIEW__ __PROFILE_SECTIONS__",
    )
    await primeGeographyProfileTemplate("E:/Novel")
    expect(getGeographyProfileTemplate()).toContain("CUSTOM")
  })
})
