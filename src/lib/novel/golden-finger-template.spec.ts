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
  GOLDEN_FINGER_PROFILE_TEMPLATE_READY,
  attachGoldenFingerHtml,
  extractGoldenFingerProfiles,
  getGoldenFingerProfileTemplate,
  goldenFingerProfileFromMarkdown,
  primeGoldenFingerProfileTemplate,
  renderGoldenFingerProfileForContent,
  renderGoldenFingerProfileHtml,
  resetGoldenFingerProfileTemplateForTest,
} from "./golden-finger-template"

beforeEach(() => {
  fsMock.fileExists.mockReset().mockResolvedValue(false)
  fsMock.readFile.mockReset().mockResolvedValue("")
  fsMock.getExecutableDir.mockReset().mockResolvedValue("C:/App")
  fsMock.getResourceDir.mockReset().mockResolvedValue("C:/App/_up_")
  resetGoldenFingerProfileTemplateForTest()
})

describe("golden-finger-template", () => {
  it("内置模板包含全部占位符", () => {
    expect(GOLDEN_FINGER_PROFILE_TEMPLATE_READY).toBe(true)
    const template = getGoldenFingerProfileTemplate()
    expect(template).toContain("__PROFILE_SECTIONS__")
    expect(template).toContain(".pcard.unlock")
    expect(template).toContain(".pcard.matrix")
  })

  it("extractGoldenFingerProfiles 解析单个与数组", () => {
    const single = "```json\n" + JSON.stringify({
      goldenFingerProfileData: {
        name: "识海系统",
        tag: "系统",
        sections: [
          { kind: "kv", heading: "机制", items: [{ label: "绑定方式", text: "濒死激活" }] },
          { kind: "table", heading: "已解锁能力", head: ["解锁章节", "能力"], rows: [["第1章", "识海"]] },
        ],
      },
    }) + "\n```"
    const one = extractGoldenFingerProfiles(single)
    expect(one).toHaveLength(1)
    expect(one[0].name).toBe("识海系统")
    expect(one[0].tag).toBe("系统")

    const many = "```json\n" + JSON.stringify({
      goldenFingerProfiles: ["识海", "剑意传承"].map((name) => ({
        name,
        sections: [{ heading: "机制", items: [{ label: "获取", text: "x" }] }],
      })),
    }) + "\n```"
    expect(extractGoldenFingerProfiles(many).map((doc) => doc.name)).toEqual(["识海", "剑意传承"])
  })

  it("goldenFingerProfileFromMarkdown 解析机制 / 已解锁能力 / 边界与代价", () => {
    const md = [
      "# 金手指：识海系统",
      "",
      "濒死时激活的意识空间。",
      "",
      "## 机制",
      "- 绑定方式：主角濒死时自动激活",
      "- 触发条件：意识濒临消散",
      "",
      "## 已解锁能力",
      "| 解锁章节 | 能力 | 来源 | 限制 |",
      "| --- | --- | --- | --- |",
      "| 第1章 | 识海推演 | 系统初始 | 每日三次 |",
      "",
      "## 边界与代价",
      "- 能解决的问题：推演战局",
      "- 使用代价：精神力透支",
    ].join("\n")
    const doc = goldenFingerProfileFromMarkdown(md)
    expect(doc?.name).toBe("识海系统")
    expect(doc?.sections.map((section) => section.heading)).toEqual(["机制", "已解锁能力", "边界与代价"])
    const unlock = doc?.sections[1]
    expect(unlock).toMatchObject({ kind: "table", head: ["解锁章节", "能力", "来源", "限制"] })
    if (unlock?.kind === "table") expect(unlock.rows).toEqual([["第1章", "识海推演", "系统初始", "每日三次"]])
  })

  it("renderGoldenFingerProfileHtml 对「已解锁能力」附加系统面板样式类", () => {
    const html = renderGoldenFingerProfileHtml({
      name: "识海系统",
      tag: "系统",
      sections: [
        { kind: "table", heading: "已解锁能力", head: ["解锁章节", "能力"], rows: [["第1章", "识海推演"]] },
        { kind: "kv", heading: "边界与代价", items: [{ label: "代价", text: "精神力透支" }] },
      ],
    })
    expect(html).toContain("金手指 · 能力卡")
    expect(html).toContain("pcard wide unlock")
    expect(html).toContain("pcard matrix")
  })

  it("attachGoldenFingerHtml 渲染能力卡；无数据原样返回；真 HTML 保留", () => {
    const source = "# 金手指设定\n## 机制\n- 绑定方式：濒死激活"
    // 请求形状对齐生产类型 OutlineSaveRequest：htmlContent 是可选的伴生 HTML 字段
    const request: { fileType: string; content: string; htmlContent?: string } = {
      fileType: "setting",
      content: source,
    }
    const attached = attachGoldenFingerHtml(request, source)
    expect(attached.htmlContent).toContain("能力卡")

    const empty = { fileType: "setting", content: "" }
    expect(attachGoldenFingerHtml(empty, "")).toBe(empty)

    const kept = { fileType: "setting", content: "x", htmlContent: "<!DOCTYPE html><html></html>" }
    expect(attachGoldenFingerHtml(kept, "x").htmlContent).toContain("<!DOCTYPE html>")
  })

  it("renderGoldenFingerProfileForContent 与 prime 回退", async () => {
    expect(renderGoldenFingerProfileForContent("# 金手指设定\n## 机制\n- 绑定方式：濒死激活")).toContain("能力卡")
    expect(renderGoldenFingerProfileForContent("")).toBeNull()

    fsMock.fileExists.mockResolvedValue(true)
    fsMock.readFile.mockResolvedValue(
      "CUSTOM __PROFILE_NAME__ __PROFILE_ROLE__ __PROFILE_EYEBROW__ __PROFILE_CHIPS__ __PROFILE_TAGLINE__ __PROFILE_OVERVIEW__ __PROFILE_SECTIONS__",
    )
    await primeGoldenFingerProfileTemplate("E:/Novel")
    expect(getGoldenFingerProfileTemplate()).toContain("CUSTOM")
  })
})
