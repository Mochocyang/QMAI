import { readFileSync } from "node:fs"
import { resolve } from "node:path"
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

  it("句式组禁掉二分对照壳与冒号模板，并给路标词加配额", () => {
    expect(DE_AI_GENERATION_RULES).toContain("不是 A，而是 B")
    expect(DE_AI_GENERATION_RULES).toContain("概念：解释")
    // 配额必须说清是「段落结构词」用法，否则会把正常的「最后他还是走了」也判违规。
    expect(DE_AI_GENERATION_RULES).toMatch(/路标词/)
    expect(DE_AI_GENERATION_RULES).toContain("段落结构词")
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

  it("是纯常量：模块零依赖、无随机源", () => {
    // 注意：`await import()` 拿到的是同一个已缓存的 ESM namespace，**不会二次求值**，
    // 所以「再 import 一次仍然相等」是恒真的，证明不了纯净性（旧版断言即此缺陷，已替换）。
    // 真正能证明纯净性的是「模块没有任何依赖、也没有非确定来源」：
    // 零 import ⇒ 不可能读文件 / 用 i18n / 拿时钟；再显式挡住非确定 API。
    const source = readFileSync(resolve(__dirname, "de-ai-generation-rules.ts"), "utf8")
    expect(source, "规则模块必须零依赖（不得 import 任何东西）").not.toMatch(/^\s*import\s/m)
    for (const forbidden of ["Math.random", "Date.now", "process.env", "performance.now"]) {
      expect(source, `规则模块不应依赖 ${forbidden}`).not.toContain(forbidden)
    }
    // 且两个导出都是非空 string（求值确实发生且结果稳定）。
    expect(typeof DE_AI_GENERATION_RULES).toBe("string")
    expect(typeof DE_AI_REVISION_BOUNDARY).toBe("string")
    expect(DE_AI_GENERATION_RULES.length).toBeGreaterThan(0)
    expect(DE_AI_REVISION_BOUNDARY.length).toBeGreaterThan(0)
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
