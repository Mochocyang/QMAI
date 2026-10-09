import { describe, expect, it } from "vitest"
import { SKILL_ROUTE_CATEGORY_IDS } from "./skill-route"
import { DEFAULT_SKILL_HUB_SKILLS } from "./skill-hub-seed"
import { FANFIC_WRITING_RULES } from "./fanfic-canon"

describe("SkillHub seed", () => {
  it("loads SkillHub files as built-in routed skills", () => {
    expect(DEFAULT_SKILL_HUB_SKILLS.length).toBe(73)
    expect(new Set(DEFAULT_SKILL_HUB_SKILLS.map((skill) => skill.name)).size).toBe(73)
    expect(DEFAULT_SKILL_HUB_SKILLS.every((skill) => skill.source === "built-in")).toBe(true)
  })

  it("routes key outline, topic and setting skills to stable folders", () => {
    expect(DEFAULT_SKILL_HUB_SKILLS.find((skill) => skill.name === "outline-master-builder")?.categoryId)
      .toBe(SKILL_ROUTE_CATEGORY_IDS.outline)
    expect(DEFAULT_SKILL_HUB_SKILLS.find((skill) => skill.name === "male-xuanhuan-xianxia")?.categoryId)
      .toBe(SKILL_ROUTE_CATEGORY_IDS.topic)
    expect(DEFAULT_SKILL_HUB_SKILLS.find((skill) => skill.name === "world-rules")?.categoryId)
      .toBe(SKILL_ROUTE_CATEGORY_IDS.worldbuilding)
    expect(DEFAULT_SKILL_HUB_SKILLS.find((skill) => skill.name === "faction-system")?.categoryId)
      .toBe(SKILL_ROUTE_CATEGORY_IDS.faction)
  })

  it("keeps English machine names while exposing Chinese display names", () => {
    expect(DEFAULT_SKILL_HUB_SKILLS.every((skill) => skill.displayName.trim().length > 0)).toBe(true)
    expect(DEFAULT_SKILL_HUB_SKILLS.every((skill) => /[\u4e00-\u9fa5]/.test(skill.displayName))).toBe(true)
    expect(DEFAULT_SKILL_HUB_SKILLS.every((skill) => skill.id === `skillhub:${skill.name}`)).toBe(true)
    expect(DEFAULT_SKILL_HUB_SKILLS.find((skill) => skill.name === "chapter-emotion-curve")?.displayName)
      .toBe("情绪曲线")
  })

  it("loads newly added topic, chapter-outline and quality skills for AI outline routing", () => {
    expect(DEFAULT_SKILL_HUB_SKILLS.find((skill) => skill.name === "male-beast-taming")?.categoryId)
      .toBe(SKILL_ROUTE_CATEGORY_IDS.topic)
    expect(DEFAULT_SKILL_HUB_SKILLS.find((skill) => skill.name === "female-book-transmigration")?.categoryId)
      .toBe(SKILL_ROUTE_CATEGORY_IDS.topic)
    expect(DEFAULT_SKILL_HUB_SKILLS.find((skill) => skill.name === "short-public-trial-face-slap")?.categoryId)
      .toBe(SKILL_ROUTE_CATEGORY_IDS.topic)
    expect(DEFAULT_SKILL_HUB_SKILLS.find((skill) => skill.name === "chapter-outline-builder")?.categoryId)
      .toBe(SKILL_ROUTE_CATEGORY_IDS.outline)
    const chapterOutlineBuilder = DEFAULT_SKILL_HUB_SKILLS.find((skill) => skill.name === "chapter-outline-builder")
    expect(chapterOutlineBuilder?.content).toContain("用户要求连续生成多章章纲时")
    expect(chapterOutlineBuilder?.content).toContain("主动建议分成两章章纲")
    expect(chapterOutlineBuilder?.content).toContain("不要等用户再说「连续生成」")
    expect(DEFAULT_SKILL_HUB_SKILLS.find((skill) => skill.name === "outline-quality-check")?.categoryId)
      .toBe(SKILL_ROUTE_CATEGORY_IDS.outline)
  })

  it("loads the fanfic topic skill so 同人 requests can resolve it by name", () => {
    const fanfic = DEFAULT_SKILL_HUB_SKILLS.find((skill) => skill.name === "fanfic-derivative")

    expect(fanfic).toBeDefined()
    expect(fanfic?.categoryId).toBe(SKILL_ROUTE_CATEGORY_IDS.topic)
    expect(fanfic?.displayName).toBe("同人衍生")
    // 同人 Skill 必须把正典卡、四种模式和六条硬规则写进内容，否则模型会写成原创
    expect(fanfic?.content).toContain("原作正典卡")
    expect(fanfic?.content).toContain("原作正典是权威")
    expect(fanfic?.content).toContain("原作未交代")
    for (const mode of ["canon", "au", "ooc", "cp"]) {
      expect(fanfic?.content).toContain(mode)
    }
  })

  it("同人 Skill 与提示词里的六条硬规则保持同源，防止两处漂移", () => {
    const content = DEFAULT_SKILL_HUB_SKILLS.find((skill) => skill.name === "fanfic-derivative")?.content ?? ""

    // 硬规则既用于组装提示词（fanfic-canon.ts），也写在 Skill 里给模型读；
    // 两处必须逐条一致，否则模型会拿到互相矛盾的要求。
    for (const rule of FANFIC_WRITING_RULES) {
      expect(content).toContain(rule)
    }
  })
})
