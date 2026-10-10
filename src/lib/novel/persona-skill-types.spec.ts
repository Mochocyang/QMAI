import { describe, expect, it } from "vitest"
import {
  PERSONA_ARCHIVED_GAP_CHAPTERS,
  PERSONA_DORMANT_GAP_CHAPTERS,
  normalizePersonaName,
  planPersonaSkillRound,
  resolvePersonaStatus,
  resolvePersonaTier,
  type PersonaSkillPlanInput,
} from "./persona-skill-types"

function input(overrides: Partial<PersonaSkillPlanInput> = {}): PersonaSkillPlanInput {
  return {
    characterName: "林清越",
    aliases: [],
    roleType: "男主",
    appearanceCount: 1,
    hasSkill: false,
    pinned: false,
    lastLearnedChapter: 0,
    ...overrides,
  }
}

describe("resolvePersonaTier", () => {
  it("主要定位进 major，次要定位进 minor", () => {
    expect(resolvePersonaTier("男主", false)).toBe("major")
    expect(resolvePersonaTier("反派", false)).toBe("major")
    expect(resolvePersonaTier("配角", false)).toBe("minor")
    expect(resolvePersonaTier("盟友", false)).toBe("minor")
  })

  it("没有定位时保守按 minor 处理", () => {
    expect(resolvePersonaTier("", false)).toBe("minor")
  })

  it("绿勾一票升级成 major", () => {
    expect(resolvePersonaTier("配角", true)).toBe("major")
  })
})

describe("planPersonaSkillRound", () => {
  it("主要人物第一次出场就建档", () => {
    const plans = planPersonaSkillRound([input({ appearanceCount: 1 })], 1)
    expect(plans).toHaveLength(1)
    expect(plans[0].mode).toBe("create")
    expect(plans[0].withResearch).toBe(false)
  })

  it("次要人物第一次出场不建档，第二次才建档", () => {
    expect(planPersonaSkillRound([input({ roleType: "配角", appearanceCount: 1 })], 1)).toHaveLength(0)
    const plans = planPersonaSkillRound([input({ roleType: "配角", appearanceCount: 2 })], 2)
    expect(plans).toHaveLength(1)
    expect(plans[0].mode).toBe("create")
  })

  it("没有定位的人物要第三次出场才建档", () => {
    expect(planPersonaSkillRound([input({ roleType: "", appearanceCount: 2 })], 2)).toHaveLength(0)
    expect(planPersonaSkillRound([input({ roleType: "", appearanceCount: 3 })], 3)).toHaveLength(1)
  })

  it("绿勾人物第一次出场就建档，并且是唯一产出研究文件的一类", () => {
    const plans = planPersonaSkillRound([input({ roleType: "配角", pinned: true, appearanceCount: 1 })], 1)
    expect(plans).toHaveLength(1)
    expect(plans[0].tier).toBe("major")
    expect(plans[0].withResearch).toBe(true)
  })

  it("已有档案的主要人物每次出场都完善", () => {
    const plans = planPersonaSkillRound(
      [input({ hasSkill: true, appearanceCount: 2, lastLearnedChapter: 1 })],
      2,
    )
    expect(plans).toHaveLength(1)
    expect(plans[0].mode).toBe("refine")
  })

  it("已有档案的次要人物第三次出场才完善", () => {
    const base = { roleType: "配角", hasSkill: true, lastLearnedChapter: 1 }
    expect(planPersonaSkillRound([input({ ...base, appearanceCount: 2 })], 2)).toHaveLength(0)
    expect(planPersonaSkillRound([input({ ...base, appearanceCount: 3 })], 3)).toHaveLength(1)
  })

  it("同一章重复摄取不会二次烧模型（lastLearnedChapter 已到当前章）", () => {
    const plans = planPersonaSkillRound(
      [input({ hasSkill: true, appearanceCount: 2, lastLearnedChapter: 2 })],
      2,
    )
    expect(plans).toHaveLength(0)
  })

  it("从来没有出场过的人物不产生任何计划", () => {
    expect(planPersonaSkillRound([input({ roleType: "", appearanceCount: 0 })], 5)).toHaveLength(0)
  })
})

describe("resolvePersonaStatus", () => {
  it("刚出场是 active", () => {
    expect(resolvePersonaStatus(5, 5, false)).toBe("active")
  })

  it("连续 10 章未出场转 dormant", () => {
    expect(resolvePersonaStatus(5, 5 + PERSONA_DORMANT_GAP_CHAPTERS, false)).toBe("dormant")
  })

  it("连续 30 章未出场转 archived", () => {
    expect(resolvePersonaStatus(5, 5 + PERSONA_ARCHIVED_GAP_CHAPTERS, false)).toBe("archived")
  })

  it("绿勾人物永远 active，不会被自动归档", () => {
    expect(resolvePersonaStatus(5, 500, true)).toBe("active")
  })
})

describe("normalizePersonaName", () => {
  it("去空白与标点、折叠大小写、NFKC 归一", () => {
    expect(normalizePersonaName(" Lin Qing-Yue ")).toBe("linqingyue")
    expect(normalizePersonaName("林清越")).toBe("林清越")
    expect(normalizePersonaName("林 清 越")).toBe("林清越")
  })
})
