import { describe, expect, it } from "vitest"
import { DEFAULT_SKILL_HUB_SKILLS } from "./skill-hub-seed"
import {
  findSkillRouteByAlias,
  getOutlineSkillNames,
  getSkillRouteSkillNames,
  getWritingSkillNames,
  resolveAvailableSkillsByNames,
  resolveSkillReference,
  validateSkillRouteRegistry,
} from "./skill-route-registry"

describe("skill route registry", () => {
  it("keeps every canonical route name backed by SkillHub", () => {
    expect(validateSkillRouteRegistry(DEFAULT_SKILL_HUB_SKILLS.map((skill) => skill.name))).toEqual([])
  })

  it("routes chapter outline through the complete eight-skill chain", () => {
    expect(getOutlineSkillNames("把第236章章纲补充详细")).toEqual([
      "chapter-outline-builder",
      "chapter-attribute-positioning",
      "chapter-keyword-conditions",
      "chapter-four-beat-flow",
      "chapter-emotion-curve",
      "chapter-visual-detail",
      "chapter-foreshadow-hook",
      "chapter-outline-assembler",
    ])
  })

  it.each([
    ["人物小传", ["character-design", "supporting-cast", "relationship-emotion"]],
    ["组织势力设定", ["faction-system"]],
    ["力量体系", ["power-system"]],
    ["金手指设定", ["idea-market-positioning", "power-system"]],
    ["背景设定", ["world-rules"]],
    ["地点设定", ["world-rules", "map-progression"]],
    ["伏笔计划", ["foreshadowing-suspense"]],
    ["故事大纲", ["outline-master-builder", "outline-final-assembler"]],
    ["分卷大纲", ["story-goal-ladder", "outline-master-builder", "outline-final-assembler"]],
    ["大纲质量检查", ["outline-quality-check"]],
  ])("routes %s to canonical SkillHub names", (alias, expected) => {
    expect(getSkillRouteSkillNames(findSkillRouteByAlias(alias)!)).toEqual(expected)
  })

  it("routes long, short, combat, dialogue and anti-ai writing tasks", () => {
    expect(getWritingSkillNames("write_chapter", "写一个长篇战斗章，对话要有情绪，最后去AI味")).toEqual([
      "long-form-drafting",
      "combat-action",
      "dialogue-emotion",
      "anti-ai-polish",
    ])
    expect(getWritingSkillNames("write_chapter", "写知乎短篇正文")).toEqual(["short-form-drafting"])
  })

  it("uses exact id, exact name and controlled aliases without arbitrary substrings", () => {
    const skills = DEFAULT_SKILL_HUB_SKILLS
    expect(resolveSkillReference(skills, { name: "章节细纲" })?.name).toBe("chapter-outline-builder")
    expect(resolveSkillReference(skills, { name: "请应用章节细纲技能" })).toBeUndefined()
    expect(resolveSkillReference(skills, { name: "chapter-outline" })).toBeUndefined()
    expect(resolveSkillReference(skills, { id: "skillhub:long-form-drafting" })?.name).toBe("long-form-drafting")
  })

  it("reports disabled or missing required skills instead of forcing them", () => {
    const result = resolveAvailableSkillsByNames([], ["chapter-outline-builder"])
    expect(result.skills).toEqual([])
    expect(result.missingNames).toEqual(["chapter-outline-builder"])
  })
})
