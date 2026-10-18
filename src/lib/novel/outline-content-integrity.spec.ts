/**
 * 内容转换的完整性不变量。
 *
 * 结构化-only 之后 `.md` 全由数据反推，字段是模型给的**自由文本**：
 * 里面可能有换行、以 `- ` / `#` 开头的行、`|`、反斜线。反推器如果原样拼进
 * `- 字段：值` 或表格单元格，解析回来就换了结构 —— 文件照样生成成功，
 * 只是内容被撕成两截或少了几个字符，没有任何界面会报错。
 *
 * 这里逐条钉住四个反推器和解析器之间的往返：
 *   1. 换行拍平，不把一条值拆成两条；
 *   2. 值本身以 `- ` / `#` 开头时，反推写 `\-` / `\#`，解析还原成原文；
 *   3. 反斜线与竖线在表格里成对转义，不破列、不少字符；
 *   4. 模型手写的残缺正文不能顶掉数据里剩下的分区。
 */
import { describe, expect, it } from "vitest"
import { escapeMarkdownCell, markdownInline, unescapeMarkdownInline } from "./markdown-inline"
import { profileDocumentFromMarkdown, renderProfileDocumentHtml, renderProfileDocumentMarkdown, type ProfileDocument } from "./profile-document"
import { normalizeVolumeOutlineData, renderVolumeOutlineMarkdown } from "./volume-outline-template"
import { normalizeChapterOutlineData, renderChapterOutlineMarkdown } from "./chapter-outline-template"
import { normalizeEventOutlineData, renderEventOutlineMarkdown } from "./event-outline"
import { parseOutlineSaveRequests } from "./outline-save-request"
import { SETTING_PROFILE_SECTIONS } from "./setting-profile-contracts"

describe("行内转义工具", () => {
  it("换行拍平成一行，空行不留下双空格", () => {
    expect(markdownInline("第一行\n\n第二行\n")).toBe("第一行 第二行")
  })

  it("行首的列表符 / 标题符转义后能原样还原", () => {
    for (const value of ["- 甲", "* 乙", "+ 丙", "# 丁", "> 戊", "1. 己"]) {
      const escaped = markdownInline(value)
      expect(escaped, `${value} 应被转义`).not.toBe(value)
      expect(unescapeMarkdownInline(escaped)).toBe(value)
    }
  })

  it("行内（非行首）的符号不动", () => {
    expect(markdownInline("甲 - 乙 # 丙")).toBe("甲 - 乙 # 丙")
  })

  it("反斜线翻倍后能原样还原", () => {
    expect(unescapeMarkdownInline(markdownInline("C:\\path\\|x"))).toBe("C:\\path\\|x")
  })

  it("表格单元格：竖线与反斜线都转义", () => {
    expect(escapeMarkdownCell("a|b")).toBe("a\\|b")
    expect(escapeMarkdownCell("x\\|y")).toBe("x\\\\\\|y")
    expect(escapeMarkdownCell("换\n行")).toBe("换 行")
  })
})

describe("档案：一条值不会被撕成两条", () => {
  const build = (items: Array<{ label?: string; text: string }>): ProfileDocument => ({
    name: "测试",
    tag: "徽章",
    sections: [{ heading: "基本信息", kind: "kv", items }],
  })

  it("值里的换行 + 列表符不产生第二个条目", () => {
    const doc = build([{ label: "要点", text: "- 第一条\n- 第二条" }])
    const back = profileDocumentFromMarkdown(renderProfileDocumentMarkdown(doc))
    const section = back?.sections[0]
    expect(section?.kind).toBe("kv")
    if (section?.kind !== "kv") return
    expect(section.items).toHaveLength(1)
    expect(section.items[0].label).toBe("要点")
    expect(section.items[0].text).toContain("第一条")
    expect(section.items[0].text).toContain("第二条")
  })

  it("值里以 `- ` / `#` 开头时字符不丢", () => {
    const back = profileDocumentFromMarkdown(renderProfileDocumentMarkdown(build([
      { label: "列表样", text: "- 不是列表" },
      { label: "标题样", text: "# 不是标题" },
    ])))
    const section = back?.sections[0]
    if (section?.kind !== "kv") throw new Error("应为 kv")
    expect(section.items.map((item) => item.text)).toEqual(["- 不是列表", "# 不是标题"])
  })

  it("列表项多行同理", () => {
    const doc: ProfileDocument = { name: "测试", sections: [{ heading: "清单", kind: "list", items: ["- 甲\n- 乙"] }] }
    const back = profileDocumentFromMarkdown(renderProfileDocumentMarkdown(doc))
    const section = back?.sections[0]
    if (section?.kind !== "list") throw new Error("应为 list")
    expect(section.items).toHaveLength(1)
    expect(section.items[0]).toBe("- 甲 - 乙")
  })

  it("表格单元格的竖线与反斜线不破列", () => {    const doc: ProfileDocument = {
      name: "测试",
      sections: [{
        heading: "语言风格",
        kind: "table",
        head: ["A", "B"],
        rows: [["a|b", "c\nd"], ["x\\|y", "z"]],
      }],
    }
    const md = renderProfileDocumentMarkdown(doc)
    const back = profileDocumentFromMarkdown(md)
    const section = back?.sections[0]
    if (section?.kind !== "table") throw new Error("应为 table")
    expect(section.rows).toEqual([["a|b", "c d"], ["x\\|y", "z"]])
    // 每行列数必须一致：破列会多出空单元格
    for (const row of section.rows) expect(row).toHaveLength(2)
  })
})

const TEMPLATE = [
  "<div>__PROFILE_NAME__</div>",
  "__PROFILE_ROLE__",
  "__PROFILE_TAGLINE__",
  "__PROFILE_CHIPS__",
  "__PROFILE_EYEBROW__",
  "__PROFILE_SECTIONS__",
].join("")

describe("空值项：MD 与 HTML 同口径", () => {
  it("只有标签没有值的条目两侧都不渲染", () => {
    const doc: ProfileDocument = {
      name: "测试",
      sections: [{
        heading: "基本信息",
        kind: "kv",
        items: [{ label: "职业", text: "掮客" }, { label: "债务", text: "" }],
      }],
    }
    const md = renderProfileDocumentMarkdown(doc)
    const html = renderProfileDocumentHtml(doc, TEMPLATE, "眉标")
    expect(md).not.toContain("债务")
    expect(html, "HTML 里多出「债务 —」就是两载体不一致").not.toContain("债务")
    expect(md).toContain("掮客")
    expect(html).toContain("掮客")
    // 分区标题的「N 条」也只算有值的
    expect(html).toContain("1 条")
  })

  it("全是空值的分区退化成提示，不留下空列表", () => {
    const doc: ProfileDocument = {
      name: "测试",
      sections: [
        { heading: "基本信息", kind: "kv", items: [{ label: "债务", text: "" }] },
        { heading: "清单", kind: "list", items: ["", "  "] },
      ],
    }
    const html = renderProfileDocumentHtml(doc, TEMPLATE, "眉标")
    expect(html).not.toContain("<ul class=\"clist\"></ul>")
    expect(html).not.toContain("债务")
    expect((html.match(/<div class="kv">/g) ?? [])).toHaveLength(0)
  })
})

describe("卷纲 / 章纲 / 细纲：多行值不分裂", () => {  it("卷纲环节要点里的换行不产生第二个要点", () => {
    const data = normalizeVolumeOutlineData({
      title: "卷一",
      stories: [{ id: 1, title: "雨夜", st: [{ stage: "起①", who: "楚白", p: ["- 甲\n- 乙"] }] }],
    })!
    const md = renderVolumeOutlineMarkdown(data)
    const stageLines = md.split("\n").filter((line) => line.startsWith("- "))
    // 人物一行 + 要点一行；如果 `- 乙` 没被转义就会多出第三行
    expect(stageLines.filter((line) => line.includes("乙"))).toHaveLength(1)
  })

  it("章纲 kv 值里的换行不产生第二个字段", () => {
    const data = normalizeChapterOutlineData({
      title: "章纲",
      chapters: [{ n: 7, title: "竹哨", digest: "- 甲\n- 乙" }],
    })!
    const md = renderChapterOutlineMarkdown(data)
    const digestLines = md.split("\n").filter((line) => line.includes("甲") || line.includes("乙"))
    expect(digestLines).toHaveLength(1)
    expect(digestLines[0]).toContain("甲")
    expect(digestLines[0]).toContain("乙")
  })

  it("细纲抓手里的换行不产生第二条抓手", () => {
    const data = normalizeEventOutlineData({
      chapterNumber: 1,
      events: [{ id: 1, title: "事件", points: ["- 甲\n- 乙"] }],
    })!
    const md = renderEventOutlineMarkdown(data)
    const pointLines = md.split("\n").filter((line) => line.startsWith("- "))
    expect(pointLines).toHaveLength(1)
  })
})

describe("模型手写正文只在不残缺时才替代数据", () => {
  const sections = SETTING_PROFILE_SECTIONS.characterBriefs.map((spec, index) => (
    spec.kind === "table"
      ? { kind: "table", heading: spec.heading, head: spec.head, rows: [spec.head!.map(() => `C${index}`)] }
      : { kind: spec.kind, heading: spec.heading, items: [{ label: `L${index}`, text: `T${index}` }] }
  ))
  const request = {
    targetFolder: "人物小传", fileName: "楚白.md", fileType: "character",
    writeMode: "create", referencedSkills: [], sourceIntent: "", content: "",
  }
  const reply = (body: string) => [
    body, "", "```json",
    JSON.stringify({ characterProfileData: { name: "楚白", tag: "主角", sections } }),
    "```", "", "```json", JSON.stringify({ outlineSaveRequest: request }), "```",
  ].join("\n")

  it("只写了两个分区时，用数据补齐其余分区", () => {
    const partial = ["# 楚白（主角）", "", "## 基本信息", "", "- 职业：掮客", "", "## 关系网络", "", "- 老秦：债主"].join("\n")
    const content = parseOutlineSaveRequests(reply(partial)).requests[0]?.content ?? ""
    for (const spec of SETTING_PROFILE_SECTIONS.characterBriefs) {
      expect(content, `缺分区：${spec.heading}`).toContain(`## ${spec.heading}`)
    }
  })

  it("六个分区都写了时，保留模型自己写的原文", () => {
    const own = [
      "# 楚白（主角）", "",
      ...SETTING_PROFILE_SECTIONS.characterBriefs.flatMap((spec) => [`## ${spec.heading}`, "", "- x：y", ""]),
      "模型自己写的一段话。",
    ].join("\n")
    expect(parseOutlineSaveRequests(reply(own)).requests[0]?.content).toBe(own.trim())
  })
})
