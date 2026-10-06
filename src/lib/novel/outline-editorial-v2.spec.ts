import { describe, expect, it } from "vitest"
import { JSDOM } from "jsdom"
import { readFileSync } from "node:fs"
import { normalizeProfileDocument, renderProfileDocumentHtml, type ProfileDocument } from "./profile-document"
import { attachOutlineHtml } from "./outline-save-request"
import { buildSettingProfileOutputRules } from "./setting-profile-contracts"
import { applyDocumentAppearance } from "../html-document-appearance"

const paths = ["JueseSkill/character-design/profile.html", "SheDingSkill/faction-system/profile.html", "SheDingSkill/power-system/profile.html", "SheDingSkill/power-system/golden-finger.html", "SheDingSkill/world-rules/background.html", "SheDingSkill/map-progression/profile.html", "SheDingSkill/foreshadowing-suspense/profile.html", "SheDingSkill/map-progression/location.html"]
const template = () => readFileSync("skills/SkillHub/" + paths[5], "utf8")
const data = () => ({name: "星陨盆地", tag: "科幻 / 设计提案", tagline: "不是任何示例小说的地图", sections: [
  {kind: "table", heading: "区域划分", head: ["区域", "环境", "控制者"], rows: [["北部观测站", "风蚀岩台", "科考队"], ["南侧营地", "低洼冻土", "营地议会"]]},
  {kind: "kv", heading: "写作约束", items: [{label: "信息", text: "行程只在满足补给条件时成立。"}]},
], diagram: {
  kind: "map", title: "星陨盆地关系图", note: "设计提案；相对位置示意，非比例测绘；距离以路线记录为准。",
  regions: [{id: "plateau", label: "风蚀台地", terrain: "mountain", points: [[5,5],[45,5],[45,45],[5,45]], description: "观测站所在高地"}],
  nodes: [{id: "north", label: "北部观测站", x: 25, y: 25, description: "位于风蚀台地，远离营地"}, {id: "south", label: "南侧营地", x: 65, y: 75, description: "居民与补给中心"}],
  routes: [{from: "north", to: "south", label: "冻土驮道", mode: "land", detail: "步行两日；冰暴时关闭"}],
}})
function normalized() { return normalizeProfileDocument(data())! }

// ---------------------------------------------------------------------------
// 配色体系：模板自带色彩令牌，预览注入按皮肤重写同一批令牌
// ---------------------------------------------------------------------------

/** 模板样式表原文。 */
function styleOf(path: string): string {
  const html = readFileSync("skills/SkillHub/" + path, "utf8")
  return html.match(/<style>([\s\S]*?)<\/style>/)![1]
}

/** 合并某个选择器的全部声明（模板里同一选择器可能出现在基础层与配色层）。 */
function declarationsOf(css: string, selector: string): string {
  const wanted = selector.trim()
  const found: string[] = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((item) => item.trim())
    if (selectors.includes(wanted)) found.push(match[2])
  }
  return found.join(";")
}

/** 某个选择器上某条属性的最终取值（取最后一条声明，贴近层叠结果）。 */
function propertyValue(css: string, selector: string, property: string): string | null {
  const declarations = declarationsOf(css, selector)
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]*)`, "g")
  let value: string | null = null
  for (const match of declarations.matchAll(pattern)) value = match[1]
  return value
}

function rulesAfterTokens(css: string): string {
  return css.replace(/:root\s*\{[^}]*\}/g, "")
}

function definedTokens(css: string): string[] {
  return [...css.matchAll(/:root\s*\{([^}]*)\}/g)].flatMap((match) =>
    [...match[1].matchAll(/(--[a-z0-9-]+)\s*:/g)].map((token) => token[1]),
  )
}

/** 分区卡片必须带底色的元素。 */
const TINTED_ELEMENTS: Array<[string, string]> = [
  [".document-top", "background"],
  [".profile-rail", "background"],
  [".pnav .navlink", "background"],
  [".hero", "background"],
  [".hero .chip", "background"],
  [".pcard", "background"],
  [".pcard h3 .no", "background"],
  [".kv", "background"],
  [".entry", "background"],
  [".clist li", "background"],
  [".semantic-card", "background"],
  [".mxwrap", "background"],
  ["table.mx thead th", "background"],
  [".tag", "background"],
]

const EXTRA_TOKENS = [
  "--card",
  "--card-head",
  "--zebra",
  "--rail-bg",
  "--line-strong",
  "--tint-gold",
  "--tint-jade",
  "--tint-rose",
  "--tint-sand",
  "--shadow-1",
  "--shadow-2",
]

describe("第二版批准方案：运行时渲染而不是硬编码样稿", () => {
  for (const path of paths) it(`${path} 提供常驻目录、纸面版式与窄屏阅读`, () => {
    const html = readFileSync("skills/SkillHub/" + path, "utf8")
    expect(html).toContain('data-qmai-layout="editorial-v2"')
    expect(html).toContain('class="profile-rail"')
    expect(html).toContain("position:sticky")
    expect(html).toContain('lang="zh-CN"')
    expect(html).toContain("@media (max-width: 760px)")
    expect(html).toContain("@media print")
    for (const s of ["雾海灯书", "沈砚", "白帆港", "index.html", "http://", "https://"]) expect(html).not.toContain(s)
  })
  it("真正的地理保存链路保留数据并输出可读SVG与图例", () => {
    const source = "```json\n" + JSON.stringify({geographyProfileData: data()}) + "\n```"
    const saved = attachOutlineHtml({fileType: "setting", fileName: "地理设定-星陨盆地.md", content: "# 地理设定：星陨盆地\n## 区域划分\n北部观测站与南侧营地"}, source)
    const doc = new JSDOM(saved.htmlContent).window.document
    expect(doc.querySelector('svg[data-profile-diagram="map"]')).not.toBeNull()
    expect(doc.querySelector('.diagram-legend')?.textContent).toContain("冻土驮道")
    expect(doc.querySelector('.profile-diagram')?.textContent).toContain("步行两日")
    expect(doc.querySelector('.profile-diagram')?.textContent).not.toContain("雾海")
    for (const a of doc.querySelectorAll('a[href^="#"]')) expect(doc.getElementById(a.getAttribute("href")!.slice(1))).not.toBeNull()
    expect(doc.querySelectorAll("#psec-1")).toHaveLength(1)
    expect(doc.querySelector(".profile-rail nav")).not.toBeNull()
    expect(doc.querySelector('title')?.textContent).toContain("星陨盆地")
  })
  it("地点图使用实际提供的房间范围，门和通路不凭空生成", () => {
    const raw = data(); raw.diagram.kind = "floorplan"; raw.diagram.regions = []
    raw.diagram.nodes = [
      {id: "entry", label: "入口", x: 10, y: 10, width: 20, height: 20, description: "需登记"},
      {id: "vault", label: "资料室", x: 50, y: 10, width: 30, height: 40, description: "双钥匙"},
    ] as typeof raw.diagram.nodes
    raw.diagram.routes = [{from:"entry", to:"vault", label:"登记通道", mode:"land", detail:"仅开放日可走"}]
    const html = renderProfileDocumentHtml(normalizeProfileDocument(raw)!, template(), "地点设定")
    expect(html).toContain('data-profile-diagram="floorplan"')
    expect(html).toContain('class="diagram-room"')
    expect(html).toContain("双钥匙")
    expect(html).not.toContain("暗梯")
  })
  it("没有图形信息时不画虚构地图，正文完整保留", () => {
    const raw = data(); delete (raw as {diagram?: unknown}).diagram
    const html = renderProfileDocumentHtml(normalizeProfileDocument(raw)!, template(), "地理")
    expect(html).not.toContain("data-profile-diagram=")
    expect(html).toContain("北部观测站")
    expect(html).toContain("行程只在满足补给条件时成立")
  })
  it("等级与历史有语义展示，完整表格可展开查阅，不删长单元格", () => {
    const doc: ProfileDocument = {name:"尺度体系",sections:[
      {kind:"table",heading:"等级阶梯",head:["阶段","能做什么","不能做什么"],rows:[["感知","察觉百步外连续扰动","不能在噪声超过阈值时分辨来源，必须先撤离并重新验证。"]]},
      {kind:"table",heading:"组织历史",head:["时期","事件","后果"],rows:[["开拓年","发现矿区","运输合同改变了人口流向"]]},
    ]}
    const dom = new JSDOM(renderProfileDocumentHtml(doc,template(),"体系")).window.document
    expect(dom.querySelector('.profile-ranks')).not.toBeNull()
    expect(dom.querySelector('.profile-timeline')).not.toBeNull()
    expect(dom.querySelectorAll('.profile-source-table table')).toHaveLength(2)
    expect(dom.querySelector('.profile-ranks')?.textContent).toContain("必须先撤离并重新验证")
  })
  it("旧自定义模板不被强制增加新结构，依旧无未替换占位符", () => {
    const old = '<html><body>__PROFILE_EYEBROW__ __PROFILE_NAME__ __PROFILE_ROLE__ __PROFILE_TAGLINE__ __PROFILE_CHIPS__ __PROFILE_OVERVIEW__ __PROFILE_SECTIONS__</body></html>'
    const html = renderProfileDocumentHtml(normalized(),old,"地理")
    expect(html).toContain("星陨盆地")
    expect(html).not.toContain("__PROFILE_")
    expect(html).not.toContain("profile-rail")
  })
  it("浅深皮肤注入仍保留图形、目录与语义对比色", () => {
    const html = applyDocumentAppearance(renderProfileDocumentHtml(normalized(),template(),"地理"),"xing")
    expect(html).toContain('data-profile-diagram="map"')
    expect(html).toContain("var(--brand-text)")
    expect(html).toContain("var(--surface)")
  })
  it("两个地图分项的生成提示要求完整图形数据与MD等价，不要求模型写SVG", () => {
    for(const key of ["geographySetting","locationsOutline"] as const){
      const rules=buildSettingProfileOutputRules(key)
      expect(rules).toContain("diagram")
      expect(rules).toContain("regions")
      expect(rules).toContain("routes")
      expect(rules).toContain("不输出原始SVG")
      expect(rules).toContain("设计提案")
    }
  })
  for(const path of ["DagangSkill/juangangzhedieshu/template.html","ZhanggangSkill/zhanggangjiegouhua/template.html"]){
    it(`${path} 对齐阅读样式但不移除原有占位符`,()=>{
      const html=readFileSync("skills/SkillHub/"+path,"utf8")
      expect(html).toContain('data-qmai-layout="editorial-v2"')
      expect(html).toContain("--font-heading:")
      expect(html).toMatch(/__VOLUME_TREE__|__CHAPTER_CARDS__/)
    })
  }
})

describe("档案模板的配色体系", () => {
  for (const path of paths) {
    it(`${path} 定义色彩令牌，且每个令牌都真的用上`, () => {
      const css = styleOf(path)
      const defined = definedTokens(css)
      const used = rulesAfterTokens(css)
      for (const token of EXTRA_TOKENS) {
        expect(defined, `${token} 未在 :root 定义`).toContain(token)
        expect(used.includes(`var(${token})`), `${token} 定义了却没有规则使用`).toBe(true)
      }
      // 与预览皮肤同名的语义色也要有模板默认值，单独打开文件时不会失效
      for (const token of ["--qi", "--cheng", "--zhuan", "--day"]) {
        expect(defined, `${token} 未在 :root 定义`).toContain(token)
      }
    })

    it(`${path} 的颜色一律走令牌，深色皮肤不会失效`, () => {
      const rules = rulesAfterTokens(styleOf(path))
      expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(rules).not.toMatch(/\b(?:rgba?|hsla?)\(/)
    })

    it(`${path} 的分区、字段与表格都有底色`, () => {
      const css = styleOf(path)
      for (const [selector, property] of TINTED_ELEMENTS) {
        const value = propertyValue(css, selector, property)
        expect(value, `${selector} 没有声明 ${property}`).not.toBeNull()
        expect(value, `${selector} 的 ${property} 没有走色令牌`).toContain("var(--")
      }
    })

    it(`${path} 的分区序号轮转强调色，不再从头到尾一个色`, () => {
      const css = styleOf(path)
      const rotation = [...css.matchAll(/\.profile \.pcard:nth-child\(6n\+\d\)\{/g)]
      expect(rotation.length).toBeGreaterThanOrEqual(4)
      for (let index = 2; index <= rotation.length; index += 1) {
        expect(declarationsOf(css, `.profile .pcard:nth-child(6n+${index})`)).toContain("--sec:")
      }
    })
  }
})
