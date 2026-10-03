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
  FACTION_PROFILE_TEMPLATE_READY,
  attachFactionProfileHtml,
  extractFactionProfiles,
  factionProfileFromMarkdown,
  getFactionProfileTemplate,
  primeFactionProfileTemplate,
  renderFactionProfileForContent,
  renderFactionProfileHtml,
  resetFactionProfileTemplateForTest,
} from "./faction-profile-template"

beforeEach(() => {
  fsMock.fileExists.mockReset().mockResolvedValue(false)
  fsMock.readFile.mockReset().mockResolvedValue("")
  fsMock.getExecutableDir.mockReset().mockResolvedValue("C:/App")
  fsMock.getResourceDir.mockReset().mockResolvedValue("C:/App/_up_")
  resetFactionProfileTemplateForTest()
})

describe("faction-profile-template", () => {
  it("内置模板包含全部占位符", () => {
    expect(FACTION_PROFILE_TEMPLATE_READY).toBe(true)
    const template = getFactionProfileTemplate()
    expect(template).toContain("__PROFILE_SECTIONS__")
    expect(template).toContain("__PROFILE_ROLE__")
  })

  it("extractFactionProfiles 解析单个 factionProfileData 与数组 factionProfiles", () => {
    const single = "```json\n" + JSON.stringify({
      factionProfileData: {
        name: "青云门",
        tag: "门派",
        tagline: "正道之首",
        sections: [
          { kind: "kv", heading: "基本信息", items: [{ label: "代表人物", text: "玉虚真人" }] },
          { kind: "table", heading: "外部关系", head: ["对象", "关系"], rows: [["魔教", "敌对"]] },
        ],
      },
    }) + "\n```"
    const one = extractFactionProfiles(single)
    expect(one).toHaveLength(1)
    expect(one[0].name).toBe("青云门")
    expect(one[0].tag).toBe("门派")
    expect(one[0].sections.map((section) => section.kind)).toEqual(["kv", "table"])

    const many = "```json\n" + JSON.stringify({
      factionProfiles: [
        { name: "青云门", sections: [{ heading: "基本信息", items: [{ label: "类型", text: "门派" }] }] },
        { name: "魔教", sections: [{ heading: "基本信息", items: [{ label: "类型", text: "邪教" }] }] },
      ],
    }) + "\n```"
    expect(extractFactionProfiles(many).map((doc) => doc.name)).toEqual(["青云门", "魔教"])
  })

  it("factionProfileFromMarkdown 剥离「势力：」前缀并从基本信息补 tag", () => {
    const md = [
      "# 势力：青云门",
      "",
      "正道之首。",
      "",
      "## 基本信息",
      "- 类型：门派",
      "- 代表人物：玉虚真人",
      "",
      "## 外部关系",
      "| 对象 | 关系 | 冲突/合作点 |",
      "| --- | --- | --- |",
      "| 魔教 | 敌对 | 封印之争 |",
    ].join("\n")
    const doc = factionProfileFromMarkdown(md)
    expect(doc?.name).toBe("青云门")
    expect(doc?.tag).toBe("门派")
    expect(doc?.tagline).toContain("正道之首")
    expect(doc?.sections.map((section) => section.heading)).toEqual(["基本信息", "外部关系"])
    const external = doc?.sections[1]
    expect(external).toMatchObject({ kind: "table", head: ["对象", "关系", "冲突/合作点"] })
    if (external?.kind === "table") expect(external.rows).toEqual([["魔教", "敌对", "封印之争"]])
  })

  it("renderFactionProfileHtml 渲染头图、徽章、表格并转义", () => {
    const html = renderFactionProfileHtml({
      name: "<script>x</script>",
      tag: "门派",
      tagline: "定位",
      sections: [
        { kind: "kv", heading: "基本信息", items: [{ label: "类型", text: "<b>门派</b>" }] },
        { kind: "table", heading: "外部关系", head: ["对象", "关系"], rows: [["魔教", "敌对"]] },
      ],
    })
    expect(html).toContain('class="hero"')
    expect(html).toContain('<span class="role">门派</span>')
    expect(html).not.toContain("<script>x</script>")
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;")
    expect(html).toContain("table class=\"mx\"")
    expect(html).toContain("魔教")
  })

  it("attachFactionProfileHtml：单势力 JSON 优先；fileType 由调用方判定（不再自查）；真 HTML 保留；多势力用 MD", () => {
    const source = "```json\n" + JSON.stringify({ factionProfileData: { name: "青云门", sections: [{ heading: "基本信息", items: [{ label: "类型", text: "门派" }] }] } }) + "\n```"
    const attached = attachFactionProfileHtml({ fileType: "organization", content: "# 别的\n## 基本信息\n- 类型：x" }, source)
    expect(attached.htmlContent).toContain("青云门")

    // 不再自查 fileType：即使是 setting，只要能解析出势力数据就渲染（由调用方决定是否调用）
    const setting = { fileType: "setting", content: "# 青云门\n## 阵营目标\n- 维护正道秩序" }
    expect(attachFactionProfileHtml(setting, "").htmlContent).toContain("组织势力 · 势力卡")

    // 无任何可解析数据时原样返回
    const empty = { fileType: "setting", content: "" }
    expect(attachFactionProfileHtml(empty, "")).toBe(empty)

    const kept = { fileType: "organization", content: "x", htmlContent: "<!DOCTYPE html><html></html>" }
    expect(attachFactionProfileHtml(kept, "x").htmlContent).toContain("<!DOCTYPE html>")

    const multi = "```json\n" + JSON.stringify({
      factionProfiles: [
        { name: "青云门", sections: [{ heading: "基本信息", items: [{ label: "类型", text: "门派" }] }] },
        { name: "魔教", sections: [{ heading: "基本信息", items: [{ label: "类型", text: "邪教" }] }] },
      ],
    }) + "\n```"
    const byMd = attachFactionProfileHtml({ fileType: "organization", content: "# 势力：青云门\n## 基本信息\n- 类型：门派" }, multi)
    expect(byMd.htmlContent).toContain("青云门")
    expect(byMd.htmlContent).not.toContain("魔教")
  })

  it("renderFactionProfileForContent 从 MD 直接产出势力卡", () => {
    const html = renderFactionProfileForContent("# 势力：青云门\n## 基本信息\n- 类型：门派")
    expect(html).toContain("青云门")
    expect(renderFactionProfileForContent("")).toBeNull()
  })

  it("JSON 里的 Markdown 行内标记会被清洗，不再原样显示 **", () => {
    const source = "```json\n" + JSON.stringify({
      factionProfileData: {
        name: "**救世组织**",
        tag: "**官方机构**",
        tagline: "**一句话定位**",
        sections: [
          { kind: "kv", heading: "**基本信息**", items: [{ label: "**组织名称**", text: "**救世组织 (The Salvage Council)**" }] },
          { kind: "table", heading: "**外部关系**", head: ["**对象**", "关系"], rows: [["**天机阁**", "表面*盟友*"]] },
          { kind: "list", heading: "写作约束", items: ["**禁止**写成万能组织", "`代码`标记也要去掉"] },
        ],
      },
    }) + "\n```"
    const attached = attachFactionProfileHtml({ fileType: "organization", content: "# 别的" }, source)
    const html = attached.htmlContent ?? ""
    expect(html).not.toContain("**")
    expect(html).not.toContain("`")
    expect(html).toContain("组织名称")
    expect(html).toContain("救世组织 (The Salvage Council)")
    expect(html).toContain("天机阁")
    expect(html).toContain("表面盟友")
  })

  it("tag 只含不可见字符时不渲染空白徽章", () => {
    const source = "```json\n" + JSON.stringify({
      factionProfileData: {
        name: "救世组织",
        tag: "\u200b",
        tagline: "\ufeff",
        sections: [{ kind: "kv", heading: "基本信息", items: [{ label: "规模", text: "三千人" }] }],
      },
    }) + "\n```"
    const html = attachFactionProfileHtml({ fileType: "organization", content: "# 别的" }, source).htmlContent ?? ""
    expect(html).not.toContain('class="role"')
    expect(html).toContain("1 个分区")
  })

  it("势力卡渲染扩充后的 11 个分区（含架构 / 人员 / 经济 / 历史）", () => {
    const headings = [
      "基本信息", "组织使命", "地理位置与作用", "组织架构", "人员构成",
      "经济来源", "组织历史", "内部派系与矛盾", "外部关系", "剧情作用", "写作约束",
    ]
    const html = renderFactionProfileHtml({
      name: "救世组织",
      tag: "官方机构",
      sections: headings.map((heading, index) =>
        index < 3
          ? { kind: "kv" as const, heading, items: [{ label: "字段", text: "值" }] }
          : heading === "剧情作用" || heading === "写作约束"
            ? { kind: "list" as const, heading, items: ["条目"] }
            : { kind: "table" as const, heading, head: ["列一", "列二"], rows: [["a", "b"]] },
      ),
    })
    for (const heading of headings) expect(html).toContain(heading)
    expect(html).toContain("11 个分区")
    // 组织历史走时间线首列（lore），架构/人员/派系/关系走名册调（roster）
    expect(html).toContain("pcard wide lore")
    expect(html).toContain("pcard wide roster")
  })

  it("primeFactionProfileTemplate 支持项目覆盖与回退", async () => {    fsMock.fileExists.mockResolvedValue(true)
    fsMock.readFile.mockResolvedValue(
      "CUSTOM __PROFILE_NAME__ __PROFILE_ROLE__ __PROFILE_EYEBROW__ __PROFILE_CHIPS__ __PROFILE_TAGLINE__ __PROFILE_OVERVIEW__ __PROFILE_SECTIONS__",
    )
    await primeFactionProfileTemplate("E:/Novel")
    expect(getFactionProfileTemplate()).toContain("CUSTOM")

    resetFactionProfileTemplateForTest()
    fsMock.fileExists.mockResolvedValue(false)
    await primeFactionProfileTemplate("E:/Novel")
    expect(getFactionProfileTemplate()).not.toContain("CUSTOM")
  })
})
