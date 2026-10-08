/**
 * 共享内核（profile-document）的关键行为测试。
 * 重点是「多对象场景挑出本文件对应那份档案」——per_item 分项（势力/地点/背景/伏笔…）
 * 一次会生成多个对象并拆成多个文件保存，挑错或挑不到都会让卡片信息量大幅下降。
 */

import { describe, expect, it } from "vitest"
import {
  extractProfileDocuments,
  pickProfileDocument,
  profileDocumentFromMarkdown,
  profileSectionExtraClass,
  renderProfileDocumentHtml,
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
