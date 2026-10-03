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
  CHARACTER_PROFILE_TEMPLATE_READY,
  attachCharacterProfileHtml,
  buildCharacterProfileHtmlForDraft,
  characterProfileDataFromMarkdown,
  extractCharacterProfiles,
  getCharacterProfileTemplate,
  primeCharacterProfileTemplate,
  renderCharacterProfileForContent,
  renderCharacterProfileHtml,
  resetCharacterProfileTemplateForTest,
} from "./character-profile-template"

beforeEach(() => {
  fsMock.fileExists.mockReset().mockResolvedValue(false)
  fsMock.readFile.mockReset().mockResolvedValue("")
  fsMock.getExecutableDir.mockReset().mockResolvedValue("C:/App")
  fsMock.getResourceDir.mockReset().mockResolvedValue("C:/App/_up_")
  resetCharacterProfileTemplateForTest()
})

describe("character-profile-template", () => {
  it("内置模板包含全部占位符", () => {
    expect(CHARACTER_PROFILE_TEMPLATE_READY).toBe(true)
    const template = getCharacterProfileTemplate()
    expect(template).toContain("__PROFILE_SECTIONS__")
    expect(template).toContain("__PROFILE_NAME__")
    expect(template).toContain("__PROFILE_ROLE__")
  })

  it("extractCharacterProfiles 解析单个 characterProfileData", () => {
    const text = "```json\n" + JSON.stringify({
      characterProfileData: {
        name: "林辰",
        roleType: "男主",
        tagline: "复仇者",
        sections: [
          { kind: "kv", heading: "基本信息", items: [{ label: "身份", text: "外门弟子" }] },
          { kind: "table", heading: "关系网络", head: ["角色", "关系"], rows: [["苏晚", "对手"]] },
          { kind: "list", heading: "写作使用规则", items: ["不许崩人设"] },
        ],
      },
    }) + "\n```"
    const profiles = extractCharacterProfiles(text)
    expect(profiles).toHaveLength(1)
    expect(profiles[0].name).toBe("林辰")
    expect(profiles[0].sections.map((section) => section.kind)).toEqual(["kv", "table", "list"])
  })

  it("extractCharacterProfiles 支持多角色数组", () => {
    const text = "```json\n" + JSON.stringify({
      characterProfiles: [
        { name: "林辰", sections: [{ heading: "基本信息", items: [{ label: "身份", text: "x" }] }] },
        { name: "苏晚", sections: [{ heading: "基本信息", items: [{ label: "身份", text: "y" }] }] },
      ],
    }) + "\n```"
    const profiles = extractCharacterProfiles(text)
    expect(profiles.map((profile) => profile.name)).toEqual(["林辰", "苏晚"])
  })

  it("characterProfileDataFromMarkdown 解析 frontmatter + H2 分区（含表格）", () => {
    const md = [
      "---",
      "name: 林辰",
      "role_type: 男主",
      "---",
      "",
      "# 林辰",
      "",
      "从外门弃徒到执剑者。",
      "",
      "## 1. 基本信息",
      "",
      "- 身份：青云门外门弟子",
      "- 阵营：自立",
      "",
      "## 2. 关系网络",
      "",
      "| 角色 | 当前关系 | 最近变化 |",
      "| --- | --- | --- |",
      "| 苏晚 | 对手 | 联手破阵 |",
    ].join("\n")
    const data = characterProfileDataFromMarkdown(md)
    expect(data?.name).toBe("林辰")
    expect(data?.roleType).toBe("男主")
    expect(data?.tagline).toContain("外门弃徒")
    expect(data?.sections.map((section) => section.heading)).toEqual(["基本信息", "关系网络"])
    expect(data?.sections[0]).toMatchObject({ kind: "kv" })
    const relations = data?.sections[1]
    expect(relations).toMatchObject({ kind: "table", head: ["角色", "当前关系", "最近变化"] })
    if (relations?.kind === "table") expect(relations.rows).toEqual([["苏晚", "对手", "联手破阵"]])
  })

  it("characterProfileDataFromMarkdown 兼容多 Agent 的 H2 起始格式", () => {
    const md = [
      "## 林辰（男主）",
      "### 基本信息",
      "- 身份：外门弟子",
      "### 关系网络",
      "| 角色 | 关系 |",
      "| --- | --- |",
      "| 苏晚 | 对手 |",
    ].join("\n")
    const data = characterProfileDataFromMarkdown(md)
    expect(data?.name).toBe("林辰")
    expect(data?.roleType).toBe("男主")
    expect(data?.sections.map((section) => section.heading)).toEqual(["基本信息", "关系网络"])
    expect(data?.sections[1]).toMatchObject({ kind: "table" })
  })

  it("renderCharacterProfileHtml 渲染角色头图、分区与表格并转义", () => {
    const html = renderCharacterProfileHtml({
      name: "<script>x</script>",
      roleType: "男主",
      tagline: "定位",
      sections: [
        { kind: "kv", heading: "基本信息", items: [{ label: "身份", text: "<b>危险</b>" }] },
        { kind: "table", heading: "关系网络", head: ["角色", "关系"], rows: [["苏晚", "对手"]] },
      ],
    })
    expect(html).toContain('class="hero"')
    expect(html).toContain('<span class="role">男主</span>')
    expect(html).not.toContain("<script>x</script>")
    expect(html).not.toContain("<b>危险</b>")
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;")
    expect(html).toContain("table class=\"mx\"")
    expect(html).toContain("苏晚")
  })

  it("attachCharacterProfileHtml：单角色 JSON 优先；fileType 由调用方判定（不再自查）；真 HTML 保留", () => {
    const source = "```json\n" + JSON.stringify({ characterProfileData: { name: "林辰", sections: [{ heading: "基本信息", items: [{ label: "身份", text: "x" }] }] } }) + "\n```"
    const attached = attachCharacterProfileHtml({ fileType: "character", content: "# 别的\n## 基本信息\n- 身份：y" }, source)
    expect(attached.htmlContent).toContain("林辰")

    // 不再自查 fileType：即使是 setting，只要能解析出角色数据就渲染（由调用方决定是否调用）
    const setting = { fileType: "setting", content: "# 林辰\n## 基本信息\n- 身份：外门弟子" }
    expect(attachCharacterProfileHtml(setting, "").htmlContent).toContain("人物小传 · 角色卡")

    // 无任何可解析数据时原样返回
    const empty = { fileType: "setting", content: "" }
    expect(attachCharacterProfileHtml(empty, "")).toBe(empty)

    const kept = { fileType: "character", content: "x", htmlContent: "<!DOCTYPE html><html></html>" }
    expect(attachCharacterProfileHtml(kept, "x").htmlContent).toContain("<!DOCTYPE html>")
  })

  it("attachCharacterProfileHtml：多角色 JSON 时按本文件 MD 渲染", () => {
    const source = "```json\n" + JSON.stringify({
      characterProfiles: [
        { name: "林辰", sections: [{ heading: "基本信息", items: [{ label: "身份", text: "a" }] }] },
        { name: "苏晚", sections: [{ heading: "基本信息", items: [{ label: "身份", text: "b" }] }] },
      ],
    }) + "\n```"
    const attached = attachCharacterProfileHtml(
      { fileType: "character", content: "# 林辰\n## 基本信息\n- 身份：外门弟子" },
      source,
    )
    expect(attached.htmlContent).toContain("林辰")
    expect(attached.htmlContent).not.toContain("苏晚")
  })

  it("renderCharacterProfileForContent 从 MD 直接产出角色卡", () => {
    const html = renderCharacterProfileForContent("# 林辰\n## 基本信息\n- 身份：外门弟子")
    expect(html).toContain("林辰")
    expect(renderCharacterProfileForContent("")).toBeNull()
  })

  it("buildCharacterProfileHtmlForDraft 优先按名字匹配 JSON，其次回退 MD", () => {
    const source = "```json\n" + JSON.stringify({
      characterProfiles: [
        { name: "林辰", roleType: "男主", sections: [{ heading: "基本信息", items: [{ label: "身份", text: "外门弟子" }] }] },
        { name: "苏晚", roleType: "女主", sections: [{ heading: "基本信息", items: [{ label: "身份", text: "内门首席" }] }] },
      ],
    }) + "\n```"
    const byJson = buildCharacterProfileHtmlForDraft({ name: "苏晚", content: "# 苏晚", sourceText: source })
    expect(byJson).toContain("内门首席")
    expect(byJson).not.toContain("外门弟子")

    // 无匹配 JSON 时回退该草稿 MD
    const byMd = buildCharacterProfileHtmlForDraft({ name: "路人", content: "# 路人\n## 基本信息\n- 身份：店小二" })
    expect(byMd).toContain("店小二")
  })

  it("批量场景按名字挑本角色档案：名字带括号 / 文件名带前缀也能匹配", () => {
    const profiles = [
      { name: "苏清月", sections: [{ kind: "kv" as const, heading: "基本信息", items: [{ label: "身份", text: "师姐" }] }] },
      { name: "林辰（男主）", sections: [{ kind: "kv" as const, heading: "基本信息", items: [{ label: "身份", text: "外门弟子" }] }] },
    ]
    const html = buildCharacterProfileHtmlForDraft({
      name: "林辰",
      content: "# 林辰\n\n## 基本信息\n- 身份：外门弟子",
      fileName: "角色-男主-林辰.md",
      profiles,
    })
    expect(html).toContain("外门弟子")
    // 不能张冠李戴拿到另一个角色的档案
    expect(html).not.toContain("苏清月")
  })

  it("批量场景匹配不到时不硬套，回退 MD 解析", () => {
    const profiles = [
      { name: "苏清月", sections: [{ kind: "kv" as const, heading: "基本信息", items: [{ label: "身份", text: "师姐" }] }] },
      { name: "玉虚真人", sections: [{ kind: "kv" as const, heading: "基本信息", items: [{ label: "身份", text: "长老" }] }] },
    ]
    const html = buildCharacterProfileHtmlForDraft({
      name: "林辰",
      content: "# 林辰\n\n## 基本信息\n- 身份：外门弟子",
      fileName: "角色-男主-林辰.md",
      profiles,
    })
    // 走 MD 兜底渲染，而不是拿别人的档案
    expect(html).toContain("外门弟子")
    expect(html).not.toContain("师姐")
  })

  it("primeCharacterProfileTemplate 支持项目覆盖与回退", async () => {
    fsMock.fileExists.mockResolvedValue(true)
    fsMock.readFile.mockResolvedValue(
      "CUSTOM __PROFILE_NAME__ __PROFILE_ROLE__ __PROFILE_EYEBROW__ __PROFILE_CHIPS__ __PROFILE_TAGLINE__ __PROFILE_OVERVIEW__ __PROFILE_SECTIONS__",
    )
    await primeCharacterProfileTemplate("E:/Novel")
    expect(getCharacterProfileTemplate()).toContain("CUSTOM")

    resetCharacterProfileTemplateForTest()
    fsMock.fileExists.mockResolvedValue(false)
    await primeCharacterProfileTemplate("E:/Novel")
    expect(getCharacterProfileTemplate()).not.toContain("CUSTOM")
  })
})
