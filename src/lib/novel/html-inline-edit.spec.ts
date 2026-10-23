// @vitest-environment jsdom

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { renderProfileDocumentHtml } from "./profile-document"
import {
  INLINE_EDITABLE_ATTR,
  INLINE_EDIT_STYLE_ID,
  extractEditedHtml,
  markEditableHtml,
} from "./html-inline-edit"

const DOC = [
  "<!DOCTYPE html>",
  '<html lang="zh-CN" data-qmai-layout="editorial-v2"><head><title>档案</title>',
  '<style id="qmai-document-appearance">body{color:#253a42}</style></head><body>',
  "<h1>失明之夜关键人物卡与阵营关系</h1>",
  "<table><thead><tr><th>人物</th><th>阵营</th></tr></thead>",
  "<tbody><tr><td>沈砚</td><td>北衙</td></tr></tbody></table>",
  '<ul class="clist"><li><p>要点一</p></li></ul>',
  '<p class="tagline">一句 <strong>加粗</strong> 说明</p>',
  '<div class="kv"><span>标签</span><span>值</span></div>',
  '<p><a href="#top">回到顶部</a></p>',
  '<div class="chip">仙侠</div>',
  '<div class="deco"></div>',
  "<svg><text>图注</text></svg>",
  "</body></html>",
].join("")

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html")
}

describe("markEditableHtml", () => {
  it("标题、段落、表格单元格都变成可编辑", () => {
    const doc = parse(markEditableHtml(DOC))
    for (const selector of ["h1", "td", "th", "li"]) {
      const element = doc.querySelector(selector)!
      expect(element.getAttribute("contenteditable"), selector).toBe("plaintext-only")
      expect(element.hasAttribute(INLINE_EDITABLE_ATTR), selector).toBe(true)
    }
    // 只有文字的 div/span 也算叶子文本，一并可改
    expect(doc.querySelector(".chip")!.getAttribute("contenteditable")).toBe("plaintext-only")
    expect(doc.querySelector(".kv span")!.getAttribute("contenteditable")).toBe("plaintext-only")
    // p 整体已可编辑，里面的 strong 不再单独标（见下一条的不嵌套用例）
    expect(doc.querySelector("strong")!.hasAttribute("contenteditable")).toBe(false)
  })

  it("不嵌套：外层已可编辑时不再标内层", () => {
    const doc = parse(markEditableHtml(DOC))
    const li = doc.querySelector("li")!
    expect(li.getAttribute("contenteditable")).toBe("plaintext-only")
    expect(li.querySelector("p")!.hasAttribute("contenteditable")).toBe(false)
    // h1 里若再套 span，也只标最外层
    const nested = parse(markEditableHtml("<html><body><h1>标题<span>副题</span></h1></body></html>"))
    expect(nested.querySelector("h1")!.getAttribute("contenteditable")).toBe("plaintext-only")
    expect(nested.querySelector("span")!.hasAttribute("contenteditable")).toBe(false)
  })

  it("链接、空装饰节点、SVG 里的文字不可编辑", () => {
    const doc = parse(markEditableHtml(DOC))
    expect(doc.querySelector("a")!.hasAttribute("contenteditable")).toBe(false)
    expect(doc.querySelector(".deco")!.hasAttribute("contenteditable")).toBe(false)
    expect(doc.querySelector("svg text")!.hasAttribute("contenteditable")).toBe(false)
  })

  it("章纲折叠树的 summary 整棵子树都不标，折叠功能不会被编辑态抢走", () => {
    const html = [
      "<!DOCTYPE html><html><body>",
      '<details class="cc"><summary><span>第1章</span> 开端</summary>',
      '<div class="cbody"><p>正文要点</p></div></details>',
      "</body></html>",
    ].join("")
    const doc = parse(markEditableHtml(html))
    const summary = doc.querySelector("summary")!
    expect(summary.hasAttribute("contenteditable")).toBe(false)
    expect(summary.querySelector("span")!.hasAttribute("contenteditable")).toBe(false)
    // 折叠体里的正文仍然可改
    expect(doc.querySelector(".cbody p")!.getAttribute("contenteditable")).toBe("plaintext-only")
  })

  it("样式块只注入一份，重复标记不会叠加", () => {
    const once = markEditableHtml(DOC)
    const twice = markEditableHtml(once)
    const doc = parse(twice)
    expect(doc.querySelectorAll(`#${INLINE_EDIT_STYLE_ID}`)).toHaveLength(1)
    expect((twice.match(new RegExp(INLINE_EDITABLE_ATTR, "g")) ?? []).length)
      .toBe((once.match(new RegExp(INLINE_EDITABLE_ATTR, "g")) ?? []).length)
    // 标记属性只出现一次（不是 contenteditable="plaintext-only" 叠成两遍）
    expect((twice.match(/contenteditable=/g) ?? []).length).toBe((once.match(/contenteditable=/g) ?? []).length)
  })

  it("保留原始文档结构与 doctype", () => {
    const html = markEditableHtml(DOC)
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true)
    expect(html).toContain('data-qmai-layout="editorial-v2"')
    expect(html).toContain("失明之夜关键人物卡与阵营关系")
  })
})

describe("extractEditedHtml", () => {
  it("取回时抹掉可编辑痕迹、编辑态样式与预览外观样式，保留改过的文字", () => {
    const editable = parse(markEditableHtml(DOC))
    const cell = editable.querySelectorAll("td")[1]!
    cell.textContent = "南衙"

    const saved = extractEditedHtml(editable)!
    expect(saved).toContain("南衙")
    expect(saved).not.toContain("北衙")
    expect(saved).not.toContain("contenteditable")
    expect(saved).not.toContain(INLINE_EDITABLE_ATTR)
    expect(saved).not.toContain(INLINE_EDIT_STYLE_ID)
    expect(saved).not.toContain("qmai-document-appearance")
    // 文档自带的内容与结构不能被顺手删掉
    expect(saved).toContain("失明之夜关键人物卡与阵营关系")
    expect(saved).toContain("data-qmai-layout")
    expect(saved.startsWith("<!DOCTYPE html>")).toBe(true)
  })

  it("取不到文档时返回 null，由调用方提示「预览未就绪」", () => {
    expect(extractEditedHtml(null)).toBeNull()
    expect(extractEditedHtml(undefined)).toBeNull()
  })
})

/**
 * 真实模板跑一遍：合成文档能过不代表真档案也能过 ——
 * 模板里有 `.mx` 卡片表、`clist`、页内锚点、装饰用的 span，
 * 任何一处标错（比如把 `<summary>` 标成可编辑）都会在真机上直接影响折叠/跳转。
 */
describe("真实人物卡模板（skills/SkillHub）", () => {
  const template = readFileSync("skills/SkillHub/JueseSkill/character-design/profile.html", "utf8")

  function realDocument(): string {
    return renderProfileDocumentHtml({
      name: "失明之夜关键人物卡与阵营关系",
      tag: "人物 · 设定档案",
      tagline: "失明之夜前后，三方势力的站位与人物关系。",
      sections: [
        { kind: "kv", heading: "基本信息", items: [{ label: "所属", text: "北衙提刑司" }] },
        { kind: "table", heading: "阵营关系", head: ["人物", "阵营"], rows: [["沈砚", "北衙"], ["陆九娘", "南库"]] },
      ],
    }, template, "人物档案")
  }

  it("标记后表格单元格可编辑，导航链接仍可点，装饰节点不动", () => {
    const doc = parse(markEditableHtml(realDocument()))
    const cells = Array.from(doc.querySelectorAll("td"))
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every((cell) => cell.getAttribute("contenteditable") === "plaintext-only")).toBe(true)
    expect(Array.from(doc.querySelectorAll("a")).every((link) => !link.hasAttribute("contenteditable"))).toBe(true)
    expect(doc.querySelector("h1")!.getAttribute("contenteditable")).toBe("plaintext-only")
  })

  it("改一格再取回，落盘内容里没有编辑痕迹、也没有预览皮肤", () => {
    const editable = parse(markEditableHtml(realDocument()))
    editable.querySelectorAll("td")[1]!.textContent = "南库（改）"
    const saved = extractEditedHtml(editable)!
    expect(saved).toContain("南库（改）")
    expect(saved).not.toContain("contenteditable")
    expect(saved).not.toContain(INLINE_EDITABLE_ATTR)
    expect(saved).not.toContain(INLINE_EDIT_STYLE_ID)
    expect(saved).not.toContain("qmai-document-appearance")
    expect(saved).toContain("失明之夜关键人物卡与阵营关系")
  })
})
