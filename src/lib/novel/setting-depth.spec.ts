import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { SETTING_OUTLINE_SPECS } from "./setting-outline-template"
import { profileDocumentFromMarkdown, renderProfileDocumentHtml } from "./profile-document"

const templates = [
  "JueseSkill/character-design/profile.html",
  "SheDingSkill/faction-system/profile.html",
  "SheDingSkill/power-system/profile.html",
  "SheDingSkill/power-system/golden-finger.html",
  "SheDingSkill/world-rules/background.html",
  "SheDingSkill/map-progression/profile.html",
  "SheDingSkill/foreshadowing-suspense/profile.html",
  "SheDingSkill/map-progression/location.html",
]
const template = readFileSync("skills/SkillHub/" + templates[1], "utf8")
const renderMd = (md: string) => renderProfileDocumentHtml(profileDocumentFromMarkdown(md)!, template, "组织势力")

describe("八类设定的正文可用深度", () => {
  const requirements: Record<string, string[]> = {
    characterBriefs: ["生计", "住所", "成长经历", "创伤", "认知", "不知道", "对白", "关系", "伤病"],
    organizationsOutline: ["客户", "成本", "利润", "分配", "成员居住", "补给", "招募", "继任", "敌对", "断供"],
    powerSystem: ["实战", "不能", "耗时", "失败", "恢复", "越级", "普通人", "垄断"],
    goldenFinger: ["来源", "触发", "消耗", "冷却", "信息可信度", "暴露", "反制", "自主选择"],
    backgroundSetting: ["生产", "货币", "司法", "教育", "阶层", "医疗", "历史", "认知"],
    geographySetting: ["方位", "尺度", "耗时", "季节", "贸易", "边界", "补给", "迁移"],
    foreshadowingPlan: ["真相", "误导", "知情", "强化", "触发", "后果", "计划", "已发生", "证据"],
    locationsOutline: ["布局", "住所", "食宿", "补给", "入口", "出口", "感官", "触发", "变化"],
  }
  for (const [id, words] of Object.entries(requirements)) {
    it(`${id} 覆盖写正文所需的关键维度`, () => {
      const spec = SETTING_OUTLINE_SPECS.find(item => item.id === id)!
      expect(spec.sections.length).toBeGreaterThanOrEqual(10)
      const hints = spec.sections.map(section => section.hint).join("\n")
      for (const word of words) expect(hints, `${id} 缺少 ${word}`).toContain(word)
      for (const section of spec.sections) expect(section.hint.length, section.heading).toBeGreaterThanOrEqual(45)
    })
  }
})

describe("详细设定不能因 Markdown 混排丢失正文", () => {
  it("保留表格前后说明与两张不同的表，并维持顺序", () => {
    const html = renderMd("# 青云商会\n## 经济来源\n开场说明：商会依赖北境订单。\n\n| 业务 | 客户 |\n| --- | --- |\n| 药材 | 军营 |\n\n运输中断会使利润转负。\n\n| 成本 | 支付周期 |\n| --- | --- |\n| 护卫 | 每月 |\n\n结尾说明：冬季必须借款。")
    const words = ["商会依赖北境订单", "药材", "运输中断会使利润转负", "护卫", "冬季必须借款"]
    const positions = words.map(word => html.indexOf(word))
    expect(positions.every(pos => pos >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(html.match(/<table /g)).toHaveLength(2)
  })
  it("键值、普通叙述和无标签列表混合时逐条保留", () => {
    const html = renderMd("# 林辰\n## 内在分析\n- 动机：赎回祖宅\n- 不肯向旧敌借钱\n\n每逢雨夜都会失眠。\n\n- 底线：不伤害无辜者")
    for (const text of ["赎回祖宅", "不肯向旧敌借钱", "每逢雨夜都会失眠", "不伤害无辜者"]) expect(html).toContain(text)
  })
  it("转义管道符不拆列，正文管道符不误识别成表格", () => {
    const html = renderMd("# 商会\n## 经济来源\n| 业务 | 规则 |\n| --- | --- |\n| 药材 | 陆路\\|水路二选一 |\n\n风险 A | B 均须记录。")
    expect(html).toContain("陆路|水路二选一")
    expect(html).toContain("风险 A | B 均须记录")
  })
})

describe("八类专属模板的阅读布局", () => {
  for (const relative of templates) {
    it(`${relative} 支持窄屏、打印及正文层级`, () => {
      const html = readFileSync("skills/SkillHub/" + relative, "utf8")
      expect(html).toContain("@media (max-width: 760px)")
      expect(html).toContain("@media print")
      expect(html).toContain(".section-body")
      expect(html).toContain(":focus-visible")
    })
  }
  it("分区可用原生控件展开收起，表格携带窄屏字段名", () => {
    const html = renderMd("# 商会\n## 经济来源\n| 收入 | 客户 |\n| --- | --- |\n| 药材 | 军营 |")
    expect(html).toContain("<details")
    expect(html).toContain("<summary")
    expect(html).toContain('data-label="收入"')
    expect(html).not.toContain("<script")
  })
})
import { buildSettingProfileOutputRules, SETTING_PROFILE_QUALITY_RULES, SETTING_PROFILE_SECTIONS, type SettingProfileKey } from "./setting-profile-contracts"

describe("内容契约接入与跨文件一致性", () => {
  const skills: Record<SettingProfileKey, string> = {
    characterBriefs: "JueseSkill/character-design/SKILL.md",
    organizationsOutline: "SheDingSkill/faction-system/SKILL.md",
    powerSystem: "SheDingSkill/power-system/SKILL.md",
    goldenFinger: "SheDingSkill/power-system/SKILL.md",
    backgroundSetting: "SheDingSkill/world-rules/SKILL.md",
    geographySetting: "SheDingSkill/map-progression/SKILL.md",
    foreshadowingPlan: "SheDingSkill/foreshadowing-suspense/SKILL.md",
    locationsOutline: "SheDingSkill/map-progression/SKILL.md",
  }
  for (const key of Object.keys(skills) as SettingProfileKey[]) {
    it(`${key} 的入口、提示词、标准和技能使用相同完整内容`, () => {
      const sections = SETTING_PROFILE_SECTIONS[key]
      const rules = buildSettingProfileOutputRules(key)
      const json = JSON.parse(rules.split("\n").find(line => line.startsWith("{"))!)
      const profile = Object.values(json)[0] as { sections: Array<{ heading: string; kind: string; head?: string[] }> }
      expect(profile.sections.map(section => section.heading)).toEqual(sections.map(section => section.heading))
      expect(rules).toContain(SETTING_PROFILE_QUALITY_RULES)
      const skill = readFileSync("skills/SkillHub/" + skills[key], "utf8")
      const standard = readFileSync("skills/SkillHub/" + (key === "characterBriefs" ? "JueseSkill/CHARACTER_PROFILE_STANDARD.md" : "SheDingSkill/SETTING_PROFILE_STANDARD.md"), "utf8")
      for (const section of sections) {
        expect(rules).toContain(section.hint)
        expect(skill).toContain(section.hint)
        expect(standard).toContain(section.hint)
        if (section.kind === "table") expect(section.head!.length).toBeGreaterThanOrEqual(4)
      }
      expect(readFileSync("src/components/sources/outline-chat-panel.tsx", "utf8")).toContain(`return buildSettingProfileOutputRules("${key}")`)
    })
  }
  it("不把知识缺失或尚未写到的节点编造成已发生事实", () => {
    for (const text of ["设计提案", "已确认", "待确认", "计划", "已发生", "依据", "认知边界", "不强行", "内容等价"]) {
      expect(SETTING_PROFILE_QUALITY_RULES + SETTING_PROFILE_SECTIONS.organizationsOutline.map(s => s.hint).join("\n")).toContain(text)
    }
  })
})

describe("详细正文中的导语及安全性", () => {
  it("多段导语不因摘要上限被截掉", () => {
    const html = renderMd("# 商会\n" + "这是一段完整的组织缘起。".repeat(15) + "\n\n第二段导语说明垄断形成的原因。\n\n## 经济来源\n- 主营：药材贸易")
    expect(html).toContain("第二段导语说明垄断形成的原因")
  })
  it("混排文字及移动端表头属性都经过 HTML 转义", () => {
    const html = renderMd('# 商会\n## 经济来源\n<script>alert(1)</script>\n\n| "+onmouseover="evil | 规则 |\n| --- | --- |\n| <img src=x onerror=evil> | 安全 |\n\n结尾 <iframe src=x>')
    expect(html).not.toContain("<script>")
    expect(html).not.toContain("<img src=x")
    expect(html).not.toContain("<iframe src=x>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain('data-label="&quot;+onmouseover=&quot;evil"')
  })
})
