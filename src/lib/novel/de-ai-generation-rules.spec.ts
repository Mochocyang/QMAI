import { describe, expect, it } from "vitest"
import { DE_AI_GENERATION_RULES, DE_AI_REVISION_BOUNDARY } from "./de-ai-generation-rules"

/**
 * 这段规则是要拼进每一次正文生成调用里的常量，所以除了「内容对不对」，
 * 还要钉住两件事：字符数上限（每次调用都要付的 token），
 * 以及「它是生成期约束、不是改写手册」（设计 §2.1 的核心决策）。
 */
describe("DE_AI_GENERATION_RULES", () => {
  it("非空", () => {
    expect(DE_AI_GENERATION_RULES.trim().length).toBeGreaterThan(0)
  })

  it("涵盖四个分组", () => {
    for (const group of ["### 词法", "### 句式", "### 叙事", "### 正面替换"]) {
      expect(DE_AI_GENERATION_RULES).toContain(group)
    }
  })

  it("词法组点名了每一类禁用词与 cliché 清单", () => {
    // 六类禁用词：少一类都等于把 .md 的分类悄悄丢掉。
    for (const kind of ["总结腔", "解释腔", "模板句首", "空洞形容", "转折", "AI 特征词"]) {
      expect(DE_AI_GENERATION_RULES).toContain(kind)
    }
    // 具体到句子这一层的烂句表：泛规则拦不住它们，用户抱怨的正是这些。
    for (const cliche of ["目光交汇的瞬间", "空气仿佛凝固", "心中五味杂陈", "眼神变得坚定"]) {
      expect(DE_AI_GENERATION_RULES).toContain(cliche)
    }
  })

  it("句式组禁掉二分对照壳、点名冒号模板与路标词配额", () => {
    expect(DE_AI_GENERATION_RULES).toContain("不是 A，而是 B")
    expect(DE_AI_GENERATION_RULES).toContain("概念：解释")
    expect(DE_AI_GENERATION_RULES).toContain("路标词配额")
  })

  it("叙事组覆盖解释动机、总结情绪、段尾结论、无效热闹与单手法循环", () => {
    for (const item of ["不解释动机", "不总结情绪", "段尾不补抽象结论", "无效热闹", "单手法循环"]) {
      expect(DE_AI_GENERATION_RULES).toContain(item)
    }
  })

  it("正面替换组给出抽象→动作、断句与对话毛边", () => {
    expect(DE_AI_GENERATION_RULES).toContain("他拍桌而起")
    expect(DE_AI_GENERATION_RULES).toContain("对话留毛边")
  })

  it("保留小说适配边界，不把正文压成非虚构腔", () => {
    // .md:144-148 的教训：硬删副词/「似乎/仿佛/缓缓」会把小说写坏，
    // 而 :162 的「不刻意反 AI」是同一件事的另一面。缺了这一段，规则会反向伤害文本。
    expect(DE_AI_GENERATION_RULES).toContain("小说适配边界")
    expect(DE_AI_GENERATION_RULES).toContain("不要硬删")
    expect(DE_AI_GENERATION_RULES).toContain("似乎/仿佛/缓缓")
    expect(DE_AI_GENERATION_RULES).toContain("不刻意反 AI")
  })

  it("不含改写流程指令（它是生成约束，不是那份 177 行手册的复制）", () => {
    for (const processOnly of ["逐句检查", "修补顺序", "参考资源", "执行流程", "最终检查", "必删内容"]) {
      expect(DE_AI_GENERATION_RULES).not.toContain(processOnly)
    }
  })

  it("是纯常量：模块可重复求值且逐字节相同（缓存前缀不能被它抖掉）", async () => {
    // 重新求值一次模块：若里面混了读文件 / i18n / 随机数，这里就会不等。
    const again = await import("./de-ai-generation-rules")
    expect(again.DE_AI_GENERATION_RULES).toBe(DE_AI_GENERATION_RULES)
    expect(again.DE_AI_REVISION_BOUNDARY).toBe(DE_AI_REVISION_BOUNDARY)
  })

  it("控制在 1200 字符以内", () => {
    // 上限来自设计 §4/§6.4：它进每一次初稿/扩写/返修调用，而且过长会稀释注意力、降低遵守率。
    expect(DE_AI_GENERATION_RULES.length).toBeLessThanOrEqual(1200)
  })
})

describe("DE_AI_REVISION_BOUNDARY", () => {
  it("是一句边界：不引入新 AI 腔，且不越出问题清单改段落", () => {
    expect(DE_AI_REVISION_BOUNDARY.trim().length).toBeGreaterThan(0)
    expect(DE_AI_REVISION_BOUNDARY).toContain("不引入新的 AI 腔")
    expect(DE_AI_REVISION_BOUNDARY).toContain("问题清单之外")
    expect(DE_AI_REVISION_BOUNDARY).not.toContain("\n")
  })
})
