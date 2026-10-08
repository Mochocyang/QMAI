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
  FORESHADOWING_PROFILE_TEMPLATE_READY,
  attachForeshadowingProfileHtml,
  extractForeshadowingProfiles,
  foreshadowingProfileFromMarkdown,
  getForeshadowingProfileTemplate,
  primeForeshadowingProfileTemplate,
  renderForeshadowingProfileForContent,
  renderForeshadowingProfileHtml,
  resetForeshadowingProfileTemplateForTest,
} from "./foreshadowing-plan-template"

/** 生产 attachForeshadowingProfileHtml 的入参契约（htmlContent 可选，函数内补全）。 */
type ForeshadowingProfileSaveRequest = Parameters<typeof attachForeshadowingProfileHtml>[0]

beforeEach(() => {
  fsMock.fileExists.mockReset().mockResolvedValue(false)
  fsMock.readFile.mockReset().mockResolvedValue("")
  fsMock.getExecutableDir.mockReset().mockResolvedValue("C:/App")
  fsMock.getResourceDir.mockReset().mockResolvedValue("C:/App/_up_")
  resetForeshadowingProfileTemplateForTest()
})

describe("foreshadowing-plan-template", () => {
  it("内置模板包含全部占位符", () => {
    expect(FORESHADOWING_PROFILE_TEMPLATE_READY).toBe(true)
    const template = getForeshadowingProfileTemplate()
    expect(template).toContain("__PROFILE_SECTIONS__")
    expect(template).toContain(".pcard.threads")
    expect(template).toContain(".pcard.payoff")
  })

  it("extractForeshadowingProfiles 解析单个与数组", () => {
    const single = "```json\n" + JSON.stringify({
      foreshadowingProfileData: {
        name: "伏笔计划",
        tag: "主线",
        sections: [
          { kind: "kv", heading: "伏笔总览", items: [{ label: "伏笔总数", text: "2" }] },
          { kind: "table", heading: "伏笔状态表", head: ["ID", "状态"], rows: [["F001", "已埋"]] },
        ],
      },
    }) + "\n```"
    const one = extractForeshadowingProfiles(single)
    expect(one).toHaveLength(1)
    expect(one[0].name).toBe("伏笔计划")

    const many = "```json\n" + JSON.stringify({
      foreshadowingProfiles: [{ name: "主线伏笔" }, { name: "支线伏笔" }].map((item) => ({
        ...item,
        sections: [{ heading: "伏笔状态表", head: ["ID"], rows: [["F1"]] }],
      })),
    }) + "\n```"
    expect(extractForeshadowingProfiles(many).map((doc) => doc.name)).toEqual(["主线伏笔", "支线伏笔"])
  })

  it("foreshadowingProfileFromMarkdown 解析状态表 / 回收日志 / 过期风险", () => {
    const md = [
      "# 伏笔追踪",
      "",
      "## 伏笔状态表",
      "| ID | 伏笔内容 | 埋设章节 | 预计回收 | 状态 | 重要度 |",
      "| --- | --- | --- | --- | --- | --- |",
      "| F001 | 断剑来历 | 第3章 | 第12章 | 已埋 | 高 |",
      "| F002 | 玉佩刻字 | 第5章 | 第20章 | 推进中 | 中 |",
      "",
      "## 回收日志",
      "| 章节 | 回收伏笔 | 回收方式 | 后果 |",
      "| --- | --- | --- | --- |",
      "| 第12章 | 断剑来历 | 揭示 | 主角获得传承 |",
      "",
      "## 过期或风险伏笔",
      "| ID | 问题 | 处理方式 |",
      "| --- | --- | --- |",
      "| F009 | 埋设后未推进 | 转长线 |",
    ].join("\n")
    const doc = foreshadowingProfileFromMarkdown(md)
    expect(doc?.sections.map((section) => section.heading)).toEqual(["伏笔状态表", "回收日志", "过期或风险伏笔"])
    const status = doc?.sections[0]
    expect(status).toMatchObject({ kind: "table" })
    if (status?.kind === "table") expect(status.rows).toHaveLength(2)
  })

  it("renderForeshadowingProfileHtml 附加 threads/payoff 样式类并把状态渲染成彩色徽章", () => {
    const html = renderForeshadowingProfileHtml({
      name: "伏笔计划",
      sections: [
        { kind: "table", heading: "伏笔状态表", head: ["ID", "状态", "重要度"], rows: [["F001", "已回收", "高"]] },
        { kind: "table", heading: "回收日志", head: ["章节", "回收方式"], rows: [["第12章", "揭示"]] },
      ],
    })
    expect(html).toContain("伏笔计划 · 伏笔台账")
    expect(html).toContain("pcard wide threads")
    expect(html).toContain("pcard wide payoff")
    // 状态 / 重要度徽章使用主题变量，深色下不能残留浅色底。
    expect(html).toContain("已回收")
    expect(html).toContain("background:var(--ok-soft)")
    expect(html).toContain("background:var(--danger-soft)")
  })

  it("attachForeshadowingProfileHtml：fileType 由调用方判定（不再自查）；真 HTML 保留；无数据原样返回", () => {
    const source = "# 伏笔追踪\n## 伏笔状态表\n| ID | 状态 |\n| --- | --- |\n| F001 | 已埋 |"
    const request: ForeshadowingProfileSaveRequest = { fileType: "foreshadowing", content: source }
    const attached = attachForeshadowingProfileHtml(request, source)
    expect(attached.htmlContent).toContain("伏笔台账")

    // 不再自查 fileType：即使是 setting，只要能解析出伏笔数据就渲染（由调用方决定是否调用）
    const setting: ForeshadowingProfileSaveRequest = { fileType: "setting", content: source }
    expect(attachForeshadowingProfileHtml(setting, source).htmlContent).toContain("伏笔台账")

    const empty = { fileType: "setting", content: "" }
    expect(attachForeshadowingProfileHtml(empty, "")).toBe(empty)

    const kept = { fileType: "foreshadowing", content: "x", htmlContent: "<!DOCTYPE html><html></html>" }
    expect(attachForeshadowingProfileHtml(kept, "x").htmlContent).toContain("<!DOCTYPE html>")
  })

  it("renderForeshadowingProfileForContent 与 prime 回退", async () => {
    expect(renderForeshadowingProfileForContent("# 伏笔追踪\n## 伏笔状态表\n| ID | 状态 |\n| --- | --- |\n| F001 | 已埋 |"))
      .toContain("伏笔台账")
    expect(renderForeshadowingProfileForContent("")).toBeNull()

    fsMock.fileExists.mockResolvedValue(true)
    fsMock.readFile.mockResolvedValue(
      "CUSTOM __PROFILE_NAME__ __PROFILE_ROLE__ __PROFILE_EYEBROW__ __PROFILE_CHIPS__ __PROFILE_TAGLINE__ __PROFILE_OVERVIEW__ __PROFILE_SECTIONS__",
    )
    await primeForeshadowingProfileTemplate("E:/Novel")
    expect(getForeshadowingProfileTemplate()).toContain("CUSTOM")
  })
})
