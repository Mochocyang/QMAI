import { describe, expect, it } from "vitest"
import { renderPersonaMarkdown } from "./persona-markdown-view"
import { readPersonaDocumentFields } from "./persona-skill-profile"

/**
 * H2 的核心不变量：**MD 是可编辑的视图，不是第二份真源**。
 *
 * 所以「表格 → MD → 表格」必须能走通：用户在 MD 里改一句，反解回字段后
 * 再重新渲染，得到的内容要与用户改的那份一致。这条往返一旦断掉，
 * 用户就会看到「MD 里改了、表格没变」或者「保存后改动凭空消失」。
 */
describe("renderPersonaMarkdown", () => {
  const base = {
    characterName: "杨寒",
    roleType: "主角",
    fields: {
      性别: "男",
      年龄: "二十上下",
      势力组织: "地下回收队",
      性格: "- 性格标签：毒舌、嘴硬心软\n- 绑定灵魂：严肃沉稳",
      怎么说话: "短句，爱反问，极少用敬语。",
      怎么想: "先算退路，再决定要不要动手。",
      关系网: "沈砚：旧识（互相提防）",
      当前状态: "左肩受伤未愈",
    } as Record<string, string>,
  }

  it("与 SKILL.md 同构：有值的字段各写一个 ## 段", () => {
    const md = renderPersonaMarkdown(base)
    expect(md).toContain("# 杨寒 · 人物 Skill")
    expect(md).toContain("> 定位：主角")
    expect(md).toContain("## 怎么说话\n\n短句，爱反问，极少用敬语。")
    expect(md).toContain("## 当前状态\n\n左肩受伤未愈")
    // 没填的不能写成空标题（会让正文被十几个空标题稀释）
    expect(md).not.toContain("## 外貌\n\n\n")
  })

  it("没填的字段汇总成文末一行，名字一个不少", () => {
    const md = renderPersonaMarkdown(base)
    expect(md).toContain("## 还没填的字段")
    const summary = md.slice(md.indexOf("## 还没填的字段"))
    for (const name of ["外貌", "背景", "动机", "能力", "成长轨迹", "怎么判断", "什么不做", "知道局限", "备注"]) {
      expect(summary, name).toContain(name)
    }
  })

  it("全部字段都有值时，不出现汇总区", () => {
    const full = { ...base.fields }
    for (const name of [
      "性别", "年龄", "势力组织", "外貌", "性格", "背景", "动机", "能力", "成长轨迹",
      "关系网", "怎么说话", "怎么想", "怎么判断", "什么不做", "知道局限",
      "当前状态", "出场组织", "认知变化", "关系变化", "备注",
    ]) {
      full[name] = "已填"
    }
    const md = renderPersonaMarkdown({ ...base, fields: full })
    expect(md).not.toContain("## 还没填的字段")
  })

  it("空的字段反解回来仍是空（汇总行不会被当成字段值）", () => {
    const md = renderPersonaMarkdown({ ...base, fields: { ...base.fields, 外貌: "" } })
    const fields = readPersonaDocumentFields(md)
    expect(fields["外貌"]).toBeUndefined()
    expect(fields["备注"]).toBeUndefined()
  })

  it("往返：MD 里改一句，反解回字段能读到那句", () => {
    const md = renderPersonaMarkdown(base)
    const edited = md.replace("短句，爱反问，极少用敬语。", "几乎不说话，只用眼神。")
    const fields = readPersonaDocumentFields(edited)
    expect(fields["怎么说话"]).toBe("几乎不说话，只用眼神。")
    expect(fields["怎么想"]).toBe("先算退路，再决定要不要动手。")
  })

  it("往返：改完再渲染一次，内容与用户改的那份一致（不丢改动）", () => {
    const md = renderPersonaMarkdown(base)
    const edited = md.replace("短句，爱反问，极少用敬语。", "几乎不说话，只用眼神。")
    const fields = readPersonaDocumentFields(edited)
    const again = renderPersonaMarkdown({ ...base, fields })
    expect(again).toContain("几乎不说话，只用眼神。")
    expect(again).not.toContain("短句，爱反问，极少用敬语。")
    expect(again).toContain("先算退路，再决定要不要动手。")
    expect(again).toContain("沈砚：旧识（互相提防）")
  })

  it("往返：在汇总区里补一个字段段，反解后出现在表格里", () => {
    const md = renderPersonaMarkdown(base)
    const edited = md.replace("## 还没填的字段", "## 什么不做\n\n不碰小孩的东西。\n\n## 还没填的字段")
    const fields = readPersonaDocumentFields(edited)
    expect(fields["什么不做"]).toBe("不碰小孩的东西。")
  })
})
