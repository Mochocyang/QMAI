import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8").replace(/\r\n/g, "\n")

describe("写作上下文注入人物 Skill", () => {
  const contextEngine = read("./context-engine.ts")

  it("静态引入 persona-skill-context（它不拖重依赖）", () => {
    expect(contextEngine).toContain('import { buildPersonaSkillContext } from "./persona-skill-context"')
  })

  it("character-aura 仍然只能动态 import（bundle 边界不变）", () => {
    expect(contextEngine).not.toContain('from "./character-aura"')
    expect(contextEngine).toContain('await import("./character-aura")')
  })

  it("两个匹配共用同一段 matchingText", () => {
    expect(contextEngine).toContain("const personaMatchingText = joinNonEmpty([")
    expect(contextEngine).toContain("matchingText: personaMatchingText")
    expect(contextEngine).toContain("buildPersonaSkillContext(context.projectPath, personaMatchingText)")
  })

  it("走独立的 personaSkills 字段，绝不并进 characterAuras", () => {
    // characterAuras 有一条硬不变量：有 portablePersonalities 时必须完整进入提示词，
    // 否则 contextPackToPrompt 直接抛错停止生成。人物 Skill 文本很长，
    // 并进去会把它挤出预算、触发一个跟人格规则无关的误导性报错。
    expect(contextEngine).toContain("personaSkills?: string")
    expect(contextEngine).toContain("personaSkills: 10.5,")
    expect(contextEngine).toContain('fieldKey: "personaSkills"')
    expect(contextEngine).toContain("...(personaSkillContext ? { personaSkills: personaSkillContext } : {}),")
    // 原样保留：characterAuras 仍然只装角色灵魂
    expect(contextEngine).toContain("characterAuras: soulContext.text,")
  })

  it("注入失败不能弄挂写作", () => {
    expect(contextEngine).toContain(
      'buildPersonaSkillContext(context.projectPath, personaMatchingText).catch(() => "")',
    )
  })
})
