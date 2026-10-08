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
  BACKGROUND_PROFILE_TEMPLATE_READY,
  attachBackgroundProfileHtml,
  backgroundProfileFromMarkdown,
  extractBackgroundProfiles,
  getBackgroundProfileTemplate,
  primeBackgroundProfileTemplate,
  renderBackgroundProfileForContent,
  renderBackgroundProfileHtml,
  resetBackgroundProfileTemplateForTest,
} from "./background-setting-template"

beforeEach(() => {
  fsMock.fileExists.mockReset().mockResolvedValue(false)
  fsMock.readFile.mockReset().mockResolvedValue("")
  fsMock.getExecutableDir.mockReset().mockResolvedValue("C:/App")
  fsMock.getResourceDir.mockReset().mockResolvedValue("C:/App/_up_")
  resetBackgroundProfileTemplateForTest()
})

/**
 * 背景设定保存请求的入参契约：与 outline-save-request 中 attachSettingFamilyHtml 的
 * 约束一致 —— htmlContent 可选，由渲染器补齐后再读取。
 */
type BackgroundProfileSaveRequest = {
  fileType: string
  content: string
  htmlContent?: string
}

describe("background-setting-template", () => {
  it("内置模板包含全部占位符与背景样式", () => {
    expect(BACKGROUND_PROFILE_TEMPLATE_READY).toBe(true)
    const template = getBackgroundProfileTemplate()
    expect(template).toContain("__PROFILE_SECTIONS__")
    expect(template).toContain(".pcard.lore")
  })

  it("extractBackgroundProfiles 解析单个与数组", () => {
    const single = "```json\n" + JSON.stringify({
      backgroundProfileData: {
        name: "大衍王朝",
        tag: "时代",
        sections: [
          { kind: "kv", heading: "世界观背景", items: [{ label: "世界前提", text: "灵气复苏" }] },
          { kind: "table", heading: "历史沿革", head: ["时期", "关键事件"], rows: [["开元", "立国"]] },
        ],
      },
    }) + "\n```"
    const one = extractBackgroundProfiles(single)
    expect(one).toHaveLength(1)
    expect(one[0].name).toBe("大衍王朝")

    const many = "```json\n" + JSON.stringify({
      backgroundProfiles: ["上古纪", "今世"].map((name) => ({
        name, sections: [{ kind: "list", heading: "文化习俗", items: ["x"] }],
      })),
    }) + "\n```"
    expect(extractBackgroundProfiles(many).map((doc) => doc.name)).toEqual(["上古纪", "今世"])
  })

  it("backgroundProfileFromMarkdown 解析历史沿革 / 核心设定规则", () => {
    const md = [
      "# 背景设定：大衍王朝",
      "",
      "礼崩乐坏后重建的集权王朝。",
      "",
      "## 世界观背景",
      "- 世界前提：灵气复苏",
      "- 根本矛盾：门阀与皇权",
      "",
      "## 历史沿革",
      "| 时期 | 关键事件 | 造成的影响 |",
      "| --- | --- | --- |",
      "| 开元 | 立国定鼎 | 门阀坐大 |",
      "",
      "## 核心设定规则",
      "| 规则 | 边界（能做/不能做） | 违反代价 |",
      "| --- | --- | --- |",
      "| 皇权天授 | 不可弑君 | 天谴 |",
    ].join("\n")
    const doc = backgroundProfileFromMarkdown(md)
    expect(doc?.name).toBe("大衍王朝")
    expect(doc?.sections.map((section) => section.heading)).toEqual(["世界观背景", "历史沿革", "核心设定规则"])
    const history = doc?.sections[1]
    expect(history).toMatchObject({ kind: "table", head: ["时期", "关键事件", "造成的影响"] })
    if (history?.kind === "table") expect(history.rows).toHaveLength(1)
  })

  it("renderBackgroundProfileHtml 对世界观类分区附加 lore 样式类", () => {
    const html = renderBackgroundProfileHtml({
      name: "大衍王朝",
      tag: "时代",
      sections: [
        { kind: "table", heading: "历史沿革", head: ["时期"], rows: [["开元"]] },
        { kind: "table", heading: "核心设定规则", head: ["规则"], rows: [["皇权天授"]] },
        { kind: "kv", heading: "世界观背景", items: [{ label: "世界前提", text: "灵气复苏" }] },
      ],
    })
    expect(html).toContain("背景设定 · 背景卡")
    expect(html).toContain("pcard wide lore")
    expect(html).toContain("pcard lore")
  })

  it("attachBackgroundProfileHtml 渲染背景卡；无数据原样返回；真 HTML 保留", () => {
    const source = "# 背景设定\n## 历史沿革\n| 时期 | 关键事件 |\n| --- | --- |\n| 开元 | 立国 |"
    const request: BackgroundProfileSaveRequest = { fileType: "setting", content: source }
    const attached = attachBackgroundProfileHtml(request, source)
    expect(attached.htmlContent).toContain("背景卡")

    const empty: BackgroundProfileSaveRequest = { fileType: "setting", content: "" }
    expect(attachBackgroundProfileHtml(empty, "")).toBe(empty)

    const kept: BackgroundProfileSaveRequest = { fileType: "setting", content: "x", htmlContent: "<!DOCTYPE html><html></html>" }
    expect(attachBackgroundProfileHtml(kept, "x").htmlContent).toContain("<!DOCTYPE html>")
  })

  it("renderBackgroundProfileForContent 与 prime 回退", async () => {
    expect(renderBackgroundProfileForContent("# 背景设定\n## 历史沿革\n| 时期 | 关键事件 |\n| --- | --- |\n| 开元 | 立国 |"))
      .toContain("背景卡")
    expect(renderBackgroundProfileForContent("")).toBeNull()

    fsMock.fileExists.mockResolvedValue(true)
    fsMock.readFile.mockResolvedValue(
      "CUSTOM __PROFILE_NAME__ __PROFILE_ROLE__ __PROFILE_EYEBROW__ __PROFILE_CHIPS__ __PROFILE_TAGLINE__ __PROFILE_OVERVIEW__ __PROFILE_SECTIONS__",
    )
    await primeBackgroundProfileTemplate("E:/Novel")
    expect(getBackgroundProfileTemplate()).toContain("CUSTOM")
  })
})
