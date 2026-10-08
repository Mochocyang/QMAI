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
  SETTING_OUTLINE_TEMPLATE_READY,
  attachSettingOutlineHtml,
  extractSettingOutlineData,
  getSettingOutlineTemplate,
  isSettingOutlineFileType,
  normalizeSettingOutlineData,
  primeSettingOutlineTemplate,
  renderSettingOutlineForContent,
  renderSettingOutlineHtml,
  resetSettingOutlineTemplateForTest,
  resolveSettingSpecByTitle,
  resolveSettingSpecForRequest,
  settingOutlineDataFromMarkdown,
} from "./setting-outline-template"

/**
 * attachSettingOutlineHtml 的入参在生产侧是泛型约束（fileType / content / 可选的 htmlContent 等）。
 * 把对象字面量内联进调用时，T 会被推成「不含 htmlContent」的窄类型，
 * 于是读返回值上的 htmlContent 会报 TS2339。这里按生产签名显式标注请求类型，T 才带上 htmlContent。
 * referencedSkills 取自生产 OutlineSaveRequest，函数只透传、不消费，所以此处可选。
 */
type SettingOutlineRequest = Parameters<typeof attachSettingOutlineHtml>[0] & {
  referencedSkills?: string[]
}

beforeEach(() => {
  fsMock.fileExists.mockReset().mockResolvedValue(false)
  fsMock.readFile.mockReset().mockResolvedValue("")
  fsMock.getExecutableDir.mockReset().mockResolvedValue("C:/App")
  fsMock.getResourceDir.mockReset().mockResolvedValue("C:/App/_up_")
  resetSettingOutlineTemplateForTest()
})

describe("setting-outline-template", () => {
  it("内置模板包含全部占位符", () => {
    expect(SETTING_OUTLINE_TEMPLATE_READY).toBe(true)
    const template = getSettingOutlineTemplate()
    expect(template).toContain("__SETTING_CARDS__")
    expect(template).toContain("__SETTING_OVERVIEW__")
  })

  it("按标题匹配设定分项规格", () => {
    expect(resolveSettingSpecByTitle("人物小传")?.id).toBe("characterBriefs")
    expect(resolveSettingSpecByTitle("组织势力设定")?.id).toBe("organizationsOutline")
    expect(resolveSettingSpecByTitle("力量体系")?.id).toBe("powerSystem")
    expect(resolveSettingSpecByTitle("伏笔计划")?.id).toBe("foreshadowingPlan")
    expect(resolveSettingSpecByTitle("地点设定")?.id).toBe("locationsOutline")
    expect(resolveSettingSpecByTitle("金手指设定")?.id).toBe("goldenFinger")
    expect(resolveSettingSpecByTitle("背景设定")?.id).toBe("backgroundSetting")
    expect(resolveSettingSpecByTitle("地理设定")?.id).toBe("geographySetting")
    // 卷纲/章纲走专用分支，不应命中设定规格
    expect(resolveSettingSpecByTitle("章节细纲")).toBeNull()
  })

  it("别名也命中对应规格（提示词与 attach 分派共用同一套关键词）", () => {
    expect(resolveSettingSpecByTitle("门派设定")?.id).toBe("organizationsOutline")
    expect(resolveSettingSpecByTitle("家族设定")?.id).toBe("organizationsOutline")
    expect(resolveSettingSpecByTitle("系统设定")?.id).toBe("goldenFinger")
    expect(resolveSettingSpecByTitle("世界观设定")?.id).toBe("backgroundSetting")
    expect(resolveSettingSpecByTitle("地图设定")?.id).toBe("geographySetting")
    // 无设定特征的普通模块不应被误判
    expect(resolveSettingSpecByTitle("故事大纲")).toBeNull()
    expect(resolveSettingSpecByTitle("大纲质量检查")).toBeNull()
  })

  it("isSettingOutlineFileType 只放行设定类", () => {
    for (const fileType of ["character", "setting", "organization", "foreshadowing", "outline"]) {
      expect(isSettingOutlineFileType(fileType)).toBe(true)
    }
    expect(isSettingOutlineFileType("volume-outline")).toBe(false)
    expect(isSettingOutlineFileType("chapter-outline")).toBe(false)
    expect(isSettingOutlineFileType("quality-report")).toBe(false)
  })

  it("resolveSettingSpecForRequest 按「数据标题→正文标题→文件名→folder」细分 setting", () => {
    // 同为 fileType=setting，靠线索区分，避免张冠李戴
    expect(resolveSettingSpecForRequest({ fileType: "setting", dataTitle: "力量体系" }).id).toBe("powerSystem")
    expect(resolveSettingSpecForRequest({ fileType: "setting", content: "# 背景设定\n## 时代风貌\n- 民国" }).id).toBe("backgroundSetting")
    expect(resolveSettingSpecForRequest({ fileType: "setting", fileName: "地理设定.md" }).id).toBe("geographySetting")
    expect(resolveSettingSpecForRequest({ fileType: "setting", targetFolder: "地点设定" }).id).toBe("locationsOutline")
    expect(resolveSettingSpecForRequest({ fileType: "setting", sourceIntent: "生成力量体系设定" }).id).toBe("powerSystem")
    // 无任何线索时退回中性「设定」兜底，而不是某个具体分项
    expect(resolveSettingSpecForRequest({ fileType: "setting", content: "# 九转玄功" }).id).toBe("generic-setting")
    expect(resolveSettingSpecForRequest({ fileType: "outline" }).id).toBe("generic-outline")
  })

  it("attachSettingOutlineHtml 对 fileType=setting 的不同分项给出正确 eyebrow", () => {
    const request: SettingOutlineRequest = {
      fileType: "setting",
      fileName: "背景设定.md",
      targetFolder: "设定",
      content: "# 时代风貌\n- 民国初年",
    }
    const background = attachSettingOutlineHtml(request, "# 时代风貌\n- 民国初年")
    expect(background.htmlContent).toContain("背景设定 · 卡片流")
    expect(background.htmlContent).not.toContain("力量体系 · 卡片流")
  })

  it("normalizeSettingOutlineData 容错解析 cards/sections/items", () => {
    const data = normalizeSettingOutlineData({
      settingOutlineData: {
        title: "人物小传",
        cards: [
          {
            badge: "男主",
            title: "林辰",
            tags: ["主角"],
            sections: [{ heading: "定位与身份", items: [{ label: "身份", text: "宗门弟子" }, "孤儿出身"] }],
          },
        ],
      },
    })
    expect(data).not.toBeNull()
    expect(data!.cards).toHaveLength(1)
    expect(data!.cards[0].sections[0].items[1].text).toBe("孤儿出身")
  })

  it("extractSettingOutlineData 从 json 围栏解析", () => {
    const text = [
      "正文…",
      "```json",
      JSON.stringify({ settingOutlineData: { title: "力量体系", cards: [{ title: "灵力", sections: [{ heading: "规则", items: [{ label: "等级", text: "九阶" }] }] }] } }),
      "```",
    ].join("\n")
    const data = extractSettingOutlineData(text)
    expect(data?.title).toBe("力量体系")
  })

  it("🔴 JSON 路径也清洗 markdown 加粗：不成对的 **（label/text/title）不许上屏", () => {
    const text = "```json\n" + JSON.stringify({
      settingOutlineData: {
        title: "**地理设定",
        intro: "**表里割裂的现世秩序：**简述",
        cards: [
          {
            badge: "**区域",
            title: "**蓝现世",
            sections: [
              {
                heading: "**社会结构",
                items: [
                  { label: "**表层社会", text: "** 蓝现世的城市表面上维持着现代化运转。" },
                  { label: "**成对示例", text: "**重要**：成对加粗剥壳。" },
                  { label: "**空值字段", text: "**" },
                ],
              },
            ],
          },
        ],
      },
    }) + "\n```"
    const data = extractSettingOutlineData(text)
    expect(data?.title).toBe("地理设定")
    expect(data?.intro).toBe("表里割裂的现世秩序：简述")
    const card = data!.cards[0]
    expect(card.badge).toBe("区域")
    expect(card.title).toBe("蓝现世")
    const section = card.sections[0]
    expect(section.heading).toBe("社会结构")
    expect(section.items[0].label).toBe("表层社会")
    expect(section.items[0].text).toBe("蓝现世的城市表面上维持着现代化运转。")
    expect(section.items[1].text).toBe("重要：成对加粗剥壳。")
    expect(section.items[2].text).toBe("")
    const html = renderSettingOutlineHtml({ ...data!, eyebrow: "测试 · 卡片流" })
    expect(html).not.toContain("**")
  })

  it("🔴 MD 路径：`**标签：** 值`（冒号在加粗对内部）拆开后各剩半个 **，也要清干净", () => {
    const md = [
      "# 蓝现世",
      "## 社会结构",
      "**表层社会：** 蓝现世的城市表面上维持着现代化运转。",
      "**底层网络：** 在光鲜的城市街道背阴处，存在着地下香油血管。",
      "**功能分区：**",
    ].join("\n")
    const data = settingOutlineDataFromMarkdown(md)
    expect(data?.cards).toHaveLength(1)
    const card = data!.cards[0]
    expect(card.title).toBe("蓝现世")
    const items = card.sections[0].items
    expect(items[0]).toEqual({ label: "表层社会", text: "蓝现世的城市表面上维持着现代化运转。" })
    expect(items[1].label).toBe("底层网络")
    expect(items[2].text).toBe("")
    const html = renderSettingOutlineHtml({ ...data!, eyebrow: "测试 · 卡片流" })
    expect(html).not.toContain("**")
  })

  it("settingOutlineDataFromMarkdown 解析 H1 卡片 + H2 分区 + 列表/字段条目", () => {
    const md = [
      "# 青云门",
      "## 阵营目标",
      "- 维护正道秩序",
      "- 寻找上古至宝",
      "## 掌握资源",
      "**掌门**：玉虚真人",
      "**镇派之宝**：诛仙剑",
    ].join("\n")
    const data = settingOutlineDataFromMarkdown(md)
    expect(data?.cards).toHaveLength(1)
    const card = data!.cards[0]
    expect(card.title).toBe("青云门")
    expect(card.sections.map((section) => section.heading)).toEqual(["阵营目标", "掌握资源"])
    expect(card.sections[0].items.map((item) => item.text)).toEqual(["维护正道秩序", "寻找上古至宝"])
    expect(card.sections[1].items[0]).toEqual({ label: "掌门", text: "玉虚真人" })
  })

  it("settingOutlineDataFromMarkdown 兼容人物小传多 Agent 的 H2 单卡格式", () => {
    const md = [
      "## 林辰（男主）",
      "### 基本信息",
      "- 年龄：十九",
      "- 身份：外门弟子",
      "### 人物动机",
      "**核心目标**：为家族复仇",
    ].join("\n")
    const data = settingOutlineDataFromMarkdown(md)
    expect(data?.cards).toHaveLength(1)
    expect(data!.cards[0].title).toBe("林辰（男主）")
    expect(data!.cards[0].sections.map((section) => section.heading)).toEqual(["基本信息", "人物动机"])
  })

  it("settingOutlineDataFromMarkdown 解析 Markdown 表格为条目", () => {
    const md = [
      "# 伏笔计划",
      "## 伏笔清单",
      "| 名称 | 埋设 | 回收 | 风险 |",
      "| --- | --- | --- | --- |",
      "| 断剑 | 第3章 | 第12章 | 低 |",
      "| 玉佩 | 第5章 | 第20章 | 中 |",
    ].join("\n")
    const data = settingOutlineDataFromMarkdown(md)
    const items = data!.cards[0].sections[0].items
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ label: "断剑", text: "埋设：第3章 · 回收：第12章 · 风险：低" })
  })

  it("attachSettingOutlineHtml：已存在真正的 HTML 文档时原样保留", () => {
    const request = {
      fileType: "character",
      content: "# 林辰\n## 定位\n- 男主",
      htmlContent: "<!DOCTYPE html><html><body>自定义</body></html>",
    }
    expect(attachSettingOutlineHtml(request, "x").htmlContent).toContain("自定义")
  })

  it("settingOutlineDataFromMarkdown 剥离 frontmatter 后再解析", () => {
    const md = ["---", "outline_type: outline", "title: 人物小传", "---", "# 林辰", "## 定位", "- 男主"].join("\n")
    const data = settingOutlineDataFromMarkdown(md)
    expect(data?.cards.map((card) => card.title)).toEqual(["林辰"])
  })

  it("settingOutlineDataFromMarkdown 无有效内容时返回 null", () => {
    expect(settingOutlineDataFromMarkdown("")).toBeNull()
    expect(settingOutlineDataFromMarkdown("---\ntitle: x\n---")).toBeNull()
  })

  it("renderSettingOutlineHtml 转义内容并渲染卡片", () => {
    const html = renderSettingOutlineHtml({
      eyebrow: "人物小传 · 卡片流",
      title: "<script>alert(1)</script>",
      cards: [{ title: "林辰", sections: [{ heading: "定位", items: [{ text: "<b>危险</b>" }] }] }],
    })
    expect(html).toContain("人物小传 · 卡片流")
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).toContain("&lt;b&gt;危险&lt;/b&gt;")
    expect(html).toContain("林辰")
    expect(html).toContain("details class=\"cc\"")
  })

  it("attachSettingOutlineHtml：单卡片 JSON 优先", () => {
    const source = "```json\n" + JSON.stringify({ settingOutlineData: { title: "金手指", cards: [{ title: "系统面板", sections: [{ heading: "规则", items: [{ label: "激活", text: "遇险时" }] }] }] } }) + "\n```"
    const request: SettingOutlineRequest = {
      fileType: "setting",
      content: "# 金手指\n一些正文",
      referencedSkills: [],
      sourceIntent: "",
    }
    const result = attachSettingOutlineHtml(request, source)
    expect(result.htmlContent).toContain("系统面板")
  })

  it("attachSettingOutlineHtml：多卡片 JSON + per-item 正文时按本文件正文渲染", () => {
    const source = "```json\n" + JSON.stringify({
      settingOutlineData: {
        title: "组织势力",
        cards: [
          { title: "青云门", sections: [{ heading: "阵营目标", items: [{ text: "正道之首" }] }] },
          { title: "魔教", sections: [{ heading: "阵营目标", items: [{ text: "打破封印" }] }] },
        ],
      },
    }) + "\n```"
    const request: SettingOutlineRequest = {
      fileType: "organization",
      content: "# 青云门\n## 阵营目标\n- 正道之首",
      referencedSkills: [],
      sourceIntent: "",
    }
    const result = attachSettingOutlineHtml(request, source)
    expect(result.htmlContent).toContain("青云门")
    expect(result.htmlContent).not.toContain("魔教")
  })

  it("attachSettingOutlineHtml：无结构化数据时用 MD 兜底；非设定类型原样返回", () => {
    const fallbackRequest: SettingOutlineRequest = {
      fileType: "character",
      content: "# 林辰\n## 定位\n- 男主",
      referencedSkills: [],
      sourceIntent: "",
    }
    const fallback = attachSettingOutlineHtml(fallbackRequest, "没有任何 JSON")
    expect(fallback.htmlContent).toContain("林辰")

    const chapter = { fileType: "chapter-outline", content: "x" }
    expect(attachSettingOutlineHtml(chapter, "x")).toBe(chapter)
  })

  it("renderSettingOutlineForContent 从 MD 直接产出 HTML", () => {
    const html = renderSettingOutlineForContent("# 林辰\n## 定位\n- 男主", "character")
    expect(html).toContain("林辰")
    expect(renderSettingOutlineForContent("", "character")).toBeNull()
  })

  it("primeSettingOutlineTemplate 读取项目覆盖模板，读取失败回退内置", async () => {
    fsMock.fileExists.mockResolvedValue(true)
    fsMock.readFile.mockResolvedValue("CUSTOM __SETTING_CARDS__ __SETTING_TITLE__ __SETTING_EYEBROW__ __SETTING_INTRO__ __SETTING_CHIPS__ __SETTING_OVERVIEW__ __SETTING_NAV__")
    await primeSettingOutlineTemplate("E:/Novel")
    expect(getSettingOutlineTemplate()).toContain("CUSTOM")

    resetSettingOutlineTemplateForTest()
    fsMock.fileExists.mockResolvedValue(false)
    await primeSettingOutlineTemplate("E:/Novel")
    expect(getSettingOutlineTemplate()).not.toContain("CUSTOM")
  })
})
