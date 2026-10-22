import { describe, expect, it } from "vitest"
import {
  applyPersonaProfileEdits,
  parsePersonaRelations,
  readPersonaDocumentFields,
  readPersonaSupplement,
  splitPersonaSkillDocument,
} from "./persona-skill-profile"

const DOC = [
  "---",
  "character: 林清越",
  "role: 男主",
  "---",
  "",
  "# 林清越 · 人物 Skill",
  "",
  "## 性别",
  "",
  "男",
  "",
  "## 势力组织",
  "",
  "青云会",
  "",
  "## 怎么说话",
  "",
  "句子短，爱反问。",
  "",
  "## 口头禅速查",
  "",
  "用户自己加的段。",
  "",
  "## 补充（截至第 3 章）",
  "",
  "右肩有旧伤。",
  "",
].join("\n")

describe("splitPersonaSkillDocument", () => {
  it("拆出 frontmatter / 标题 / 已知字段 / 未知分区", () => {
    const parsed = splitPersonaSkillDocument(DOC)
    expect(parsed.frontmatter).toContain("character: 林清越")
    expect(parsed.title).toBe("林清越 · 人物 Skill")
    expect(parsed.fields["性别"]).toBe("男")
    expect(parsed.fields["势力组织"]).toBe("青云会")
    expect(parsed.fields["怎么说话"]).toBe("句子短，爱反问。")
    // 未知分区不进 fields，但也不能丢 —— 它进 extras
    expect(parsed.extras.map((block) => block.heading)).toEqual([
      "口头禅速查",
      "补充（截至第 3 章）",
    ])
  })

  it("同名分区出现多次时拼起来（老档案会留多个「补充」段）", () => {
    const parsed = splitPersonaSkillDocument("## 怎么说话\n\n甲。\n\n## 怎么说话\n\n乙。\n")
    expect(parsed.fields["怎么说话"]).toBe("甲。\n乙。")
  })

  it("没有 frontmatter 的旧文档也能拆", () => {
    const parsed = splitPersonaSkillDocument("# 某人\n\n## 性格\n\n谨慎。\n")
    expect(parsed.frontmatter).toBe("")
    expect(parsed.title).toBe("某人")
    expect(parsed.fields["性格"]).toBe("谨慎。")
  })
})

describe("applyPersonaProfileEdits", () => {
  it("已知字段按固定顺序重排，frontmatter / 标题 / 未知分区 / 补充段全部保留", () => {
    const next = applyPersonaProfileEdits(DOC, {
      性别: "男",
      势力组织: "青云会",
      性格: "沉得住气。",
      怎么说话: "句子短，爱反问。",
    })

    expect(next.startsWith("---\ncharacter: 林清越")).toBe(true)
    expect(next).toContain("# 林清越 · 人物 Skill")
    expect(next).toContain("## 性格")
    expect(next).toContain("沉得住气。")
    // 用户手写的自定义分区与 AI 追加段都还在
    expect(next).toContain("## 口头禅速查")
    expect(next).toContain("用户自己加的段。")
    expect(next).toContain("## 补充（截至第 3 章）")
    expect(next).toContain("右肩有旧伤。")
    // 与档案字段的先后顺序一致：性格在前、怎么说话在后
    expect(next.indexOf("## 性格")).toBeLessThan(next.indexOf("## 怎么说话"))
  })

  it("清空一个字段 = 整段删除，不留空标题", () => {
    const next = applyPersonaProfileEdits(DOC, { 性别: "", 势力组织: "青云会" })
    expect(next).not.toContain("## 性别")
    expect(next).toContain("## 势力组织")
  })

  it("备注里的空行不被折叠", () => {
    const next = applyPersonaProfileEdits(DOC, { 备注: "第一段。\n\n第二段。" })
    expect(next).toContain("第一段。\n\n第二段。")
  })

  it("未传的字段保留原值（按页签局部提交不会误删别的段）", () => {
    const next = applyPersonaProfileEdits(DOC, { 性格: "沉得住气。" })
    expect(next).toContain("## 性格")
    expect(next).toContain("## 势力组织")
    expect(next).toContain("青云会")
    expect(next).toContain("## 怎么说话")
  })

  it("传空串 = 用户清空该字段，整段删除", () => {
    const next = applyPersonaProfileEdits(DOC, { 性别: "" })
    expect(next).not.toContain("## 性别")
    expect(next).toContain("## 势力组织")
  })

  it("重建结果能被自己再拆一遍（写读闭环）", () => {
    const next = applyPersonaProfileEdits(DOC, { 性别: "男", 外貌: "瘦高。" })
    const parsed = splitPersonaSkillDocument(next)
    expect(parsed.fields["外貌"]).toBe("瘦高。")
    expect(parsed.fields["怎么说话"]).toBe("句子短，爱反问。")
    expect(readPersonaSupplement(next)).toContain("右肩有旧伤。")
  })
})

describe("readPersonaDocumentFields", () => {
  it("只回填已知字段", () => {
    const fields = readPersonaDocumentFields(DOC)
    expect(fields["性别"]).toBe("男")
    expect(fields["口头禅速查"]).toBeUndefined()
    expect(fields["补充（截至第 3 章）"]).toBeUndefined()
  })
})

describe("parsePersonaRelations", () => {
  it("认「对象：关系（性质）」", () => {
    expect(parsePersonaRelations("陆云飞：竞争对手（权力斗争）")).toEqual([
      { name: "陆云飞", relation: "竞争对手", nature: "权力斗争" },
    ])
  })

  it("认列表前缀与破折号写法", () => {
    expect(parsePersonaRelations("- 沈砚：旧识（互相提防）\n苏晚 - 师妹")).toEqual([
      { name: "沈砚", relation: "旧识", nature: "互相提防" },
      { name: "苏晚", relation: "师妹", nature: "" },
    ])
  })

  it("解析不出来的行不丢：整行当人名交回界面", () => {
    expect(parsePersonaRelations("一帮说不清的关系")).toEqual([
      { name: "一帮说不清的关系", relation: "", nature: "" },
    ])
  })

  it("空行跳过", () => {
    expect(parsePersonaRelations("\n\n  \n")).toEqual([])
  })
})
