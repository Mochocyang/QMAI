import { describe, expect, it } from "vitest"
import { SKILL_ROUTE_CATEGORY_IDS } from "./skill-route"
import { DEFAULT_SKILL_HUB_SKILLS } from "./skill-hub-seed"

describe("SkillHub seed", () => {
  it("loads SkillHub files as built-in routed skills", () => {
    expect(DEFAULT_SKILL_HUB_SKILLS.length).toBe(72)
    expect(new Set(DEFAULT_SKILL_HUB_SKILLS.map((skill) => skill.name)).size).toBe(72)
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
})
