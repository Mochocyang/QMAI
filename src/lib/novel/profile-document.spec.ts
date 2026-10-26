/**
 * 共享内核（profile-document）的关键行为测试。
 * 重点是「多对象场景挑出本文件对应那份档案」——per_item 分项（势力/地点/背景/伏笔…）
 * 一次会生成多个对象并拆成多个文件保存，挑错或挑不到都会让卡片信息量大幅下降。
 */

import { describe, expect, it } from "vitest"
import {
  extractProfileDocuments,
  normalizeProfileDocument,
  pickProfileDocument,
  profileDocumentFromMarkdown,
  profileSectionExtraClass,
  renderProfileDocumentHtml,
  renderProfileDocumentMarkdown,
  type ProfileDocument,
} from "./profile-document"

/** 仅含占位符的最小模板，用于验证渲染结果（不需要 prime / mock fs）。 */
const MIN_TEMPLATE =
  "<html><head><title>t</title></head><body>__PROFILE_EYEBROW__ __PROFILE_NAME__ __PROFILE_ROLE__ " +
  "__PROFILE_CHIPS__ __PROFILE_TAGLINE__ __PROFILE_OVERVIEW__ __PROFILE_SECTIONS__</body></html>"

function doc(name: string, heading = "基本信息"): ProfileDocument {
  return {
    name,
    tag: "类型",
    sections: [{ kind: "kv", heading, items: [{ label: "字段", text: name + " 的内容" }] }],
  }
}

describe("pickProfileDocument（多对象场景）", () => {
  it("没有档案数据时返回 null（由调用方回退 MD 解析）", () => {
    expect(pickProfileDocument([], { fileName: "势力-青云门.md", content: "# 青云门" })).toBeNull()
  })

  it("单份档案直接用（AI 通常只给一份且对应本文件）", () => {
    const only = doc("青云门")
    expect(pickProfileDocument([only], { fileName: "势力-青云门.md" })).toBe(only)
  })

  it("多份档案按文件名挑选（势力-青云门.md → 青云门）", () => {
    const docs = [doc("幽冥教"), doc("青云门"), doc("散修盟")]
    const hit = pickProfileDocument(docs, { fileName: "势力-青云门.md", content: "# 青云门" })
    expect(hit?.name).toBe("青云门")
  })

  it("多份档案能剥掉文件名前缀（角色-男主-林辰.md → 林辰）", () => {
    const docs = [doc("苏清月"), doc("林辰")]
    const hit = pickProfileDocument(docs, { fileName: "角色-男主-林辰.md" })
    expect(hit?.name).toBe("林辰")
  })

  it("文件名匹配不到时改用正文首标题", () => {
    const docs = [doc("幽冥教"), doc("青云峰")]
    const hit = pickProfileDocument(docs, {
      fileName: "地点-01.md",
      content: "# 青云峰\n\n## 地点定位\n- 所处区域：截云州",
    })
    expect(hit?.name).toBe("青云峰")
  })

  it("标题带括号徽章也能匹配（青云门（正道魁首））", () => {
    const docs = [doc("幽冥教"), doc("青云门")]
    const hit = pickProfileDocument(docs, { fileName: "x.md", content: "# 青云门（正道魁首）" })
    expect(hit?.name).toBe("青云门")
  })

  it("🔴 匹配不到时返回 null，绝不张冠李戴（回退 MD，不拿别的对象）", () => {
    const docs = [doc("幽冥教"), doc("散修盟")]
    const hit = pickProfileDocument(docs, {
      fileName: "势力-青云门.md",
      content: "# 青云门\n\n## 基本信息",
    })
    expect(hit).toBeNull()
  })
})

describe("表格渲染健壮性", () => {
  it("head 与 rows 列数不一致时补齐，避免整张表错位", () => {
    const html = renderProfileDocumentHtml(
      {
        name: "测试对象",
        tag: "类型",
        sections: [
          {
            kind: "table",
            heading: "测试表",
            head: ["A", "B", "C"],
            // 第 2 行少了 1 列、第 3 行多了 1 列 —— AI 输出表格时很常见
            rows: [
              ["1", "2", "3"],
              ["1", "2"],
              ["1", "2", "3", "4"],
            ],
          },
        ],
      },
      MIN_TEMPLATE,
      "测试 · 卡",
    )
    // 列数统一为 4（最大列数）：3 行 × 4 列
    expect((html.match(/<td/g) ?? []).length).toBe(12)
    // 注意：`<thead>` 也会被 /<th/ 命中，故用 `<th ` 精确计数表头单元格
    expect((html.match(/<th /g) ?? []).length).toBe(4)
  })

  it("只剩行标签的空行不进 HTML（与 MD 反推同口径）", () => {
    /*
     * MD 反推（`sectionMarkdownBody` 的 `hasBody`）会剔掉「首列之外全空」的表格行，
     * 而 HTML 侧以前不剔：同一份数据导出的 .md 没有这一行、.html 却画出一条
     * 只有边框的空行，用户点开 HTML 版看着像渲染坏了。
     */
    const html = renderProfileDocumentHtml(
      {
        name: "测试对象",
        sections: [
          {
            kind: "table",
            heading: "成长节奏",
            head: ["章", "变化"],
            rows: [
              ["第一章", ""],   // 只剩行标签 -> 不画
              ["第二章", "觉醒"], // 有正文 -> 保留
              ["", ""],         // 整行全空 -> 不画
            ],
          },
        ],
      },
      MIN_TEMPLATE,
      "测试 · 卡",
    )
    expect(html).toContain("第二章")
    expect(html).toContain("觉醒")
    expect(html).not.toContain("第一章")
    // 不许留下空单元格（一条只有边框的空行）
    expect(html).not.toMatch(/<td[^>]*>\s*<\/td>/)
    // 分区标题的「N 行」与表里实际行数一致：写「3 行」而表里只有 1 行同样是错
    expect(html).toContain("1 行")
    expect(html).not.toContain("3 行")
  })

  it("表头缺失时不渲染 thead，但单元格仍按最大列数补齐", () => {
    const html = renderProfileDocumentHtml(
      {
        name: "测试对象",
        sections: [{ kind: "table", heading: "无表头表", head: [], rows: [["a"], ["a", "b"]] }],
      },
      MIN_TEMPLATE,
      "测试 · 卡",
    )
    expect(html).not.toContain("<thead>")
    expect((html.match(/<td/g) ?? []).length).toBe(4)
  })
})

describe("markdown 加粗残留清洗（`**` 绝不许上屏）", () => {
  it("MD 路径：`**标签：** 值`（冒号在加粗对内部）拆开后各剩半个 **，也要清干净", () => {
    const md = [
      "# 测试势力",
      "",
      "## 社会结构",
      "",
      "**表层社会：** 蓝现世的城市表面上维持着现代化运转。",
      "**底层网络：** 在光鲜的城市街道背阴处，存在着由秘密实验室流转水线。",
      "",
    ].join("\n")
    const doc = profileDocumentFromMarkdown(md)
    expect(doc).not.toBeNull()
    const section = doc!.sections[0]
    expect(section.kind).toBe("kv")
    if (section.kind !== "kv") return
    expect(section.items.map((item) => item.label)).toEqual(["表层社会", "底层网络"])
    expect(section.items[0].text).toBe("蓝现世的城市表面上维持着现代化运转。")
    expect(section.items[1].text).toContain("在光鲜的城市街道背阴处")
  })

  it("MD 路径：值为孤立 ** 的字段清洗后为空，渲染成占位符而不是星号", () => {
    const md = ["# 测试地点", "", "## 基本信息", "", "**功能分区：**", ""].join("\n")
    const doc = profileDocumentFromMarkdown(md)
    expect(doc).not.toBeNull()
    const section = doc!.sections[0]
    if (section.kind !== "kv") return
    expect(section.items[0].text).toBe("")
    const html = renderProfileDocumentHtml(doc!, MIN_TEMPLATE, "测试 · 卡")
    expect(html).not.toContain("**")
    expect(html).toContain(">—</span>")
  })

  it("JSON 路径：label/text/tag 里不成对的 ** 同样清掉（成对 **加粗** 照常剥壳）", () => {
    const payload = {
      characterProfile: {
        name: "**林辰",
        tag: "**男主",
        sections: [
          {
            heading: "基本信息",
            items: [
              { label: "**表层社会", text: "** 蓝现世的城市表面上维持着现代化运转。" },
              { label: "**成对示例", text: "**重要**：这是成对加粗。" },
              { label: "**空值字段", text: "**" },
            ],
          },
        ],
      },
    }
    const text = "```json\n" + JSON.stringify(payload) + "\n```"
    const docs = extractProfileDocuments(text, { single: "characterProfile" })
    expect(docs).toHaveLength(1)
    expect(docs[0].name).toBe("林辰")
    expect(docs[0].tag).toBe("男主")
    const section = docs[0].sections[0]
    expect(section.kind).toBe("kv")
    if (section.kind !== "kv") return
    expect(section.items[0].label).toBe("表层社会")
    expect(section.items[0].text).toBe("蓝现世的城市表面上维持着现代化运转。")
    expect(section.items[1].text).toBe("重要：这是成对加粗。")
    expect(section.items[1].label).toBe("成对示例")
    expect(section.items[2].text).toBe("")
    const html = renderProfileDocumentHtml(docs[0], MIN_TEMPLATE, "测试 · 卡")
    expect(html).not.toContain("**")
  })

  it("表格单元格里的 ** 残留（AI 写 `**区域名` 当首列）同样清洗", () => {
    const payload = {
      factionProfile: {
        name: "测试组织",
        sections: [
          {
            heading: "地理分布",
            kind: "table",
            head: ["**区域", "**特征"],
            rows: [["**管区与净区", "**高墙电网、探头密布"]],
          },
        ],
      },
    }
    const text = "```json\n" + JSON.stringify(payload) + "\n```"
    const docs = extractProfileDocuments(text, { single: "factionProfile" })
    expect(docs).toHaveLength(1)
    const html = renderProfileDocumentHtml(docs[0], MIN_TEMPLATE, "测试 · 卡")
    expect(html).not.toContain("**")
    expect(html).toContain("管区与净区")
    expect(html).toContain("高墙电网、探头密布")
  })
})

describe("profileSectionExtraClass（语义样式类）", () => {
  it("按分区标题附加样式类", () => {
    expect(profileSectionExtraClass("等级阶梯")).toContain("ladder")
    expect(profileSectionExtraClass("代价与限制")).toContain("matrix")
    expect(profileSectionExtraClass("外部关系")).toContain("roster")
    expect(profileSectionExtraClass("伏笔状态表")).toContain("threads")
    expect(profileSectionExtraClass("回收日志")).toContain("payoff")
    expect(profileSectionExtraClass("已解锁能力")).toContain("unlock")
    expect(profileSectionExtraClass("区域划分")).toContain("map")
    expect(profileSectionExtraClass("空间规则")).toContain("place")
    expect(profileSectionExtraClass("历史沿革")).toContain("lore")
  })

  it("可同时命中多个类（危险区域与风险 → map + matrix）", () => {
    const cls = profileSectionExtraClass("危险区域与风险")
    expect(cls).toContain("map")
    expect(cls).toContain("matrix")
  })

  it("无关键词时返回空串", () => {
    expect(profileSectionExtraClass("氛围与感官")).toBe("")
  })
})

/**
 * 数据 → Markdown 的反推必须能和 Markdown → 数据 对齐。
 *
 * 这条链路是「模型不再写第二遍正文」的地基：模型只吐 JSON，落盘的 .md 全由这里生成，
 * 之后 HTML 渲染、角色/势力/地点卡又都要从这份 .md 或原 JSON 再解析回来。
 * 反推格式一旦跑偏（标题层级、表头分隔行、竖线转义），用户看到的就是丢字段的档案。
 */
describe("结构化数据 → Markdown 反推", () => {
  const doc: ProfileDocument = {
    name: "楚白",
    tag: "主角",
    tagline: "一个把债还完就想收手的掮客",
    sections: [
      { kind: "kv", heading: "基本信息", items: [{ label: "职业", text: "废品站的掮客" }, { text: "从不赊账" }] },
      { kind: "list", heading: "角色定位", items: ["替读者第一次看到城里的规矩", "被老秦的债拖住"] },
      {
        kind: "table",
        heading: "语言风格",
        head: ["对象与场景", "措辞与节奏", "示例对白"],
        rows: [["对老秦", "短句|先答应再讲条件", "「三万七我认，别催。」"]],
      },
      { kind: "mixed", heading: "关系网络", blocks: [{ kind: "kv", heading: "", items: [{ label: "老秦", text: "债主与旧识" }] }] },
    ],
  }

  it("标题、徽章、导语与三类载体都按原样展开", () => {
    const md = renderProfileDocumentMarkdown(doc)
    expect(md).toContain("# 楚白（主角）")
    expect(md).toContain("一个把债还完就想收手的掮客")
    expect(md).toContain("## 基本信息")
    expect(md).toContain("- 职业：废品站的掮客")
    expect(md).toContain("- 从不赊账")
    expect(md).toContain("- 替读者第一次看到城里的规矩")
    expect(md).toContain("| 对象与场景 | 措辞与节奏 | 示例对白 |")
    expect(md).toContain("| --- | --- | --- |")
  })

  it("单元格里的竖线被转义，解析回来不会错列", () => {
    const round = profileDocumentFromMarkdown(renderProfileDocumentMarkdown(doc))!
    const table = round.sections.find((section) => section.heading === "语言风格")!
    expect(table.kind).toBe("table")
    if (table.kind !== "table") return
    expect(table.head).toEqual(["对象与场景", "措辞与节奏", "示例对白"])
    expect(table.rows[0][1]).toBe("短句|先答应再讲条件")
  })

  it("反推再解析得到同一份分区（名字/徽章/分区顺序一致）", () => {
    const round = profileDocumentFromMarkdown(renderProfileDocumentMarkdown(doc))!
    expect(round.name).toBe("楚白")
    expect(round.tag).toBe("主角")
    expect(round.sections.map((section) => section.heading)).toEqual(["基本信息", "角色定位", "语言风格", "关系网络"])
    expect(round.sections[0]).toMatchObject({ kind: "kv", items: [{ label: "职业", text: "废品站的掮客" }, { text: "从不赊账" }] })
  })

  it("没有徽章时标题不写成「名字（）」", () => {
    const md = renderProfileDocumentMarkdown({ name: "老秦", sections: [{ kind: "kv", heading: "基本信息", items: [{ label: "职业", text: "废品站老板" }] }] })
    expect(md.startsWith("# 老秦\n")).toBe(true)
    expect(md).not.toContain("（）")
  })

  it("空分区不会留下孤立标题", () => {
    const md = renderProfileDocumentMarkdown({ name: "老秦", sections: [{ kind: "kv", heading: "关系网络", items: [] }] })
    expect(md).not.toContain("## 关系网络")
  })

  /**
   * 往返一致性是「HTML 视图靠解析 MD 补渲染」这条路径的地基：
   * 新保存的 .md 一旦缺了伴生 .html（被删 / 从备份恢复 / 跨机器拷贝），
   * `renderOutlineHtmlForPath` 就会把 MD 解析回来再套模板。这时任何字段丢失
   * 都不会报错，只是卡片上少一截 —— 用户以为数据本来就长这样。
   */
  it("四种载体混排的档案往返后逐值不丢（同分区列表+表格、值带中文冒号与竖线）", () => {
    const full: ProfileDocument = {
      name: "青云会",
      tag: "势力",
      tagline: "城中最会算账的江湖组织",
      sections: [
        {
          heading: "基本信息",
          kind: "kv",
          items: [
            { label: "创立时间", text: "大业三年" },
            // 值里带中文冒号：解析时必须只在第一个冒号处切，后半截不能被当成标签
            { label: "宗旨", text: "算账先算人心；其次才是银子" },
            // 值里带竖线：不转义就会让整张表的列错位
            { label: "势力范围", text: "城南 | 城北 | 码头" },
          ],
        },
        {
          heading: "结构",
          kind: "table",
          head: ["职位", "姓名", "职责"],
          // 中间留一个空单元格：不能因此让整行塌掉
          rows: [["会长", "沈砚", "统筹一切"], ["打手", "", "动手"]],
        },
        { heading: "行事风格", kind: "list", items: ["先礼后兵", "账目从不作假，但从不给人看全"] },
        {
          heading: "与其他势力",
          kind: "mixed",
          blocks: [
            { kind: "list", items: ["与漕帮井水不犯河水"] },
            { kind: "table", head: ["势力", "关系"], rows: [["漕帮", "互不干涉"]] },
          ],
        },
      ],
    }
    const md = renderProfileDocumentMarkdown(full)
    // mixed 块之间必须有空行，否则两张表会被 Markdown 粘成一张
    expect(md).toContain("- 与漕帮井水不犯河水\n\n| 势力 | 关系 |")
    const back = profileDocumentFromMarkdown(md)!
    expect(back.name).toBe("青云会")
    expect(back.tag).toBe("势力")
    expect(back.sections.map((section) => section.heading)).toEqual([
      "基本信息", "结构", "行事风格", "与其他势力",
    ])

    const info = back.sections.find((section) => section.heading === "基本信息")!
    if (info.kind !== "kv") throw new Error("基本信息 应解析为 kv")
    expect(info.items).toEqual([
      { label: "创立时间", text: "大业三年" },
      { label: "宗旨", text: "算账先算人心；其次才是银子" },
      { label: "势力范围", text: "城南 | 城北 | 码头" },
    ])

    const structure = back.sections.find((section) => section.heading === "结构")!
    if (structure.kind !== "table") throw new Error("结构 应解析为 table")
    expect(structure.head).toEqual(["职位", "姓名", "职责"])
    expect(structure.rows).toEqual([["会长", "沈砚", "统筹一切"], ["打手", "", "动手"]])

    const mixed = back.sections.find((section) => section.heading === "与其他势力")!
    if (mixed.kind !== "mixed") throw new Error("与其他势力 应解析为 mixed")
    expect(mixed.blocks).toHaveLength(2)
    const mixedTable = mixed.blocks.find((block) => block.kind === "table")
    if (!mixedTable || mixedTable.kind !== "table") throw new Error("mixed 里的表格丢了")
    // 两张表没有被合并成一张（合并后这里会多出「与漕帮井水不犯河水」这一行）
    expect(mixedTable.rows).toEqual([["漕帮", "互不干涉"]])
  })
})

/** 落盘质量：空字段与空表没有信息量，不能变成噪声行。 */
describe("档案反推：空内容不导出", () => {
  it("空 kv 值不写成「- 债务：」，空表整块不出", () => {
    const md = renderProfileDocumentMarkdown({
      name: "老秦",
      sections: [
        { kind: "kv", heading: "基本信息", items: [{ label: "职业", text: "废品站老板" }, { label: "债务", text: "" }, { label: "住处", text: "   " }] },
        {
          kind: "table",
          heading: "关系网络",
          head: ["对象", "公开关系", "利益与依赖"],
          rows: [["楚白", "", ""], ["柳三", "", ""]],
        },
      ],
    })
    expect(md).toContain("- 职业：废品站老板")
    expect(md).not.toContain("- 债务：")
    expect(md).not.toContain("- 住处：")
    // 只剩行标签的空表不导出
    expect(md).not.toContain("## 关系网络")
    expect(md).not.toContain("| 对象 | 公开关系 | 利益与依赖 |")
    expect(md).not.toMatch(/\n\n\n/)
  })

  it("表格里有一列有内容就整表保留（不能把真数据当空表丢）", () => {
    const md = renderProfileDocumentMarkdown({
      name: "老秦",
      sections: [{
        kind: "table",
        heading: "关系网络",
        head: ["对象", "公开关系", "利益与依赖"],
        rows: [["楚白", "", ""], ["柳三", "同乡", ""]],
      }],
    })
    // 第一行右侧全空 → 只留标签没有意义，仍按行丢弃；第二行有内容 → 保留
    expect(md).toContain("| 柳三 | 同乡 |  |")
    expect(md).not.toContain("| 楚白 |")
  })

  it("正文不夹带 JSON 符号", () => {
    const md = renderProfileDocumentMarkdown({
      name: "楚白",
      tag: "主角",
      tagline: "一个把债还完就想收手的掮客",
      sections: [
        { kind: "kv", heading: "基本信息", items: [{ label: "职业", text: "掮客" }] },
        { kind: "table", heading: "语言风格", head: ["对象", "示例对白"], rows: [["老秦", "「三万七我认。」"]] },
      ],
    })
    expect(md).not.toMatch(/[{}]/)
    expect(md).not.toContain("```")
    expect(md).not.toMatch(/"\s*:/)
    expect(md).not.toContain('"kind"')
    expect(md).not.toContain("sections")
  })
})

describe("摊平式档案输出（模型自创顶层键）", () => {
  // 结构取自一条真实模型输出：内容完全正确，但没包进 sections，
  // 而是摊成 meta / overview / stages / costs / … 共 16 个顶层键。
  // 旧实现只读 payload.sections，于是 sections 为空，界面报
  // 「未包含档案数据（sections 为空），请重新生成」，用户的内容全丢。
  const flat = {
    name: "基因锁七重体系·第四重",
    tag: "编号派核心成果层",
    tagline: "把未来向度削平",
    meta: [{ k: "档案对象", v: "第四重专项细化" }, { k: "正文时点", v: "第20章末" }],
    overview: [{ k: "官面名", v: "无念境" }, { k: "真名", v: "灭欲" }],
    stages: {
      columns: ["阶段", "可观察能力"],
      rows: [["四重初段", "私人欲望开始钝化"], ["四重中段", "只剩任务清单"]],
    },
    costs: { columns: ["代价", "表现"], rows: [["未来向度自我被削平", "不再生成私人愿望"]] },
    storyUses: ["让四重体在群战中充当指令锚点", "用空场期制造救人时间窗"],
    writingRules: ["严禁在没有使命锚解释的情况下让人进入四重"],
  }

  it("没有 sections 时按结构还原成分区，而不是判失败", () => {
    const doc = normalizeProfileDocument(flat)
    expect(doc).not.toBeNull()
    expect(doc!.name).toBe("基因锁七重体系·第四重")
    expect(doc!.tagline).toBe("把未来向度削平")
    expect(doc!.sections.map((section) => section.heading))
      .toEqual(["档案信息", "概览", "阶段", "代价", "剧情用法", "写作规则"])
    expect(doc!.sections.map((section) => section.kind))
      .toEqual(["kv", "kv", "table", "table", "list", "list"])
  })

  it("columns 当作表头（契约里叫 head，AI 习惯写 columns）", () => {
    const doc = normalizeProfileDocument(flat)!
    expect(doc.sections.find((section) => section.heading === "阶段"))
      .toMatchObject({ kind: "table", head: ["阶段", "可观察能力"] })
  })

  it("sections 合法时不混入摊平键，避免内容翻倍", () => {
    const doc = normalizeProfileDocument({
      name: "老秦",
      sections: [{ kind: "kv", heading: "基本信息", items: [{ label: "职业", text: "掮客" }] }],
      meta: [{ k: "不该出现", v: "被忽略" }],
    })!
    expect(doc.sections).toHaveLength(1)
    expect(doc.sections[0]!.heading).toBe("基本信息")
  })

  it("摊平后仍渲染不出空档案", () => {
    const doc = normalizeProfileDocument(flat)!
    const html = renderProfileDocumentHtml(doc, MIN_TEMPLATE)
    expect(html).not.toContain("未包含档案数据")
    expect(html).toContain("阶段")
  })
})
