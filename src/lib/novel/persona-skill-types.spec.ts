import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  PERSONA_ARCHIVED_GAP_CHAPTERS,
  PERSONA_DORMANT_GAP_CHAPTERS,
  PERSONA_MAJOR_FIELDS,
  PERSONA_MAJOR_ROLE_TYPES,
  PERSONA_MINOR_FIELDS,
  PERSONA_MINOR_ROLE_TYPES,
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
    hasResearch: false,
    pinned: false,
    lastLearnedChapter: 0,
    knownCharacter: false,
    ...overrides,
  }
}

describe("档位表与仓库既有角色定位枚举", () => {
  it("major ∪ minor 必须覆盖 CHARACTER_ROLE_TYPES 的全部定位（漏一个就是静默降档）", () => {
    // 用源码字符串断言，而不是 import character-multi-agent：
    // 那个模块拖着 character-save-extractor（Tauri 侧依赖），
    // 而本模块是零依赖叶子，测试也不该把它拖进来。
    const source = readFileSync(
      new URL("./character-multi-agent.ts", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n")
    const block = source.match(/export const CHARACTER_ROLE_TYPES = \[([\s\S]*?)\] as const/)
    expect(block, "没找到 CHARACTER_ROLE_TYPES 字面量，枚举可能被改名或搬走了").not.toBeNull()
    const declared = [...block![1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
    expect(declared.length).toBeGreaterThan(0)

    // 我们声明的档位表必须恰好覆盖它：既不漏（静默降档），也不多（多出一个没人认识的定位）。
    const ours = [...PERSONA_MAJOR_ROLE_TYPES, ...PERSONA_MINOR_ROLE_TYPES].sort()
    expect(ours).toEqual([...declared].sort())
  })
})

describe("字段表", () => {
  it("major 字段表与设计规格 07 节逐字一致", () => {
    // 字段表是数据驱动的：prompt / 渲染 / 注入三处都读这一个常量。
    // 所以它一旦被悄悄改掉，AI 学的、落盘的、注入的就同时换了内容 —— 钉死。
    expect([...PERSONA_MAJOR_FIELDS]).toEqual([
      "怎么说话",
      "怎么想",
      "怎么判断",
      "什么不做",
      "知道局限",
    ])
  })

  it("minor 字段表必须是 major 的子集（否则次要人物会写进一个不在档位里的字段）", () => {
    for (const field of PERSONA_MINOR_FIELDS) {
      expect(PERSONA_MAJOR_FIELDS).toContain(field)
    }
    // 真子集：次要人物拿到的必须更少，否则建档时按 minor 写、注入时按 major 读，
    // 两者理解不一致。
    expect(PERSONA_MINOR_FIELDS.length).toBeLessThan(PERSONA_MAJOR_FIELDS.length)
  })

  it("字段表不含研究文件专有的深度材料（那归 D6，只给绿勾人物）", () => {
    // 这些是研究文件的主题（关键关系 / 动机与弧光 / 禁忌与误区）。放进字段表就等于
    // 让所有 major 人物都免费拿到本该只给绿勾人物的内容，研究文件也白生成了。
    const researchOnly = ["关系网", "成长轨迹", "底线与逆鳞", "在意什么"]
    for (const field of researchOnly) {
      expect(PERSONA_MAJOR_FIELDS).not.toContain(field)
    }
  })
})

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

  it("绿勾但还没有研究文件时，完善这一轮顺手生成（点亮绿勾后第一次出场）", () => {
    const plans = planPersonaSkillRound(
      [input({ roleType: "配角", pinned: true, hasSkill: true, hasResearch: false, appearanceCount: 2, lastLearnedChapter: 1 })],
      2,
    )
    expect(plans).toHaveLength(1)
    expect(plans[0].withResearch).toBe(true)
  })

  it("已经有研究文件的绿勾人物不再重复生成（防覆盖：章节学习看不到旧研究文件）", () => {
    const plans = planPersonaSkillRound(
      [input({ roleType: "配角", pinned: true, hasSkill: true, hasResearch: true, appearanceCount: 3, lastLearnedChapter: 2 })],
      3,
    )
    expect(plans).toHaveLength(1)
    expect(plans[0].mode).toBe("refine")
    expect(plans[0].withResearch).toBe(false)
  })

  it("非绿勾人物永远不产出研究文件，哪怕没有研究文件", () => {
    const plans = planPersonaSkillRound(
      [input({ roleType: "配角", pinned: false, hasSkill: true, hasResearch: false, appearanceCount: 3, lastLearnedChapter: 2 })],
      3,
    )
    expect(plans[0].withResearch).toBe(false)
  })

  it("产出的 aliases 是拷贝，下游 push 不会改到调用方的数组", () => {
    const aliases = ["清越"]
    const plans = planPersonaSkillRound([input({ aliases })], 1)
    expect(plans[0].aliases).not.toBe(aliases)
    expect(plans[0].aliases).toEqual(["清越"])
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

  describe("已确认真实人物的兜底门槛（线上静默失效回归）", () => {
    // 定位只写在 wiki/characters/角色-<定位>-<名>.md 的文件名里，而那个目录
    // 只有跑过「人物」多智能体生成才有。实测项目里它不存在 → 所有人 roleType
    // 为空 → 一律要 3 次出场，而项目摄取到第 4 章时最高出场数才 2 →
    // 一个人都没建档。已知是真实人物（wiki/entities 有 tags:character 实体页）
    // 时门槛降回 1，这才是「第一章角色出现时 skill 基本就成型」的前提。
    it("未标注定位但已确认是真实人物：第一次出场就建档", () => {
      expect(
        planPersonaSkillRound([input({ roleType: "", knownCharacter: false, appearanceCount: 1 })], 1),
      ).toHaveLength(0)
      const plans = planPersonaSkillRound(
        [input({ roleType: "", knownCharacter: true, appearanceCount: 1 })],
        1,
      )
      expect(plans).toHaveLength(1)
      expect(plans[0].mode).toBe("create")
    })

    it("认出来只降低建档门槛，不改变档位（注入预算仍按 minor 给）", () => {
      const plans = planPersonaSkillRound(
        [input({ roleType: "", knownCharacter: true, appearanceCount: 1 })],
        1,
      )
      expect(plans[0].tier).toBe("minor")
    })

    it("未确认的路人仍然要 3 次出场（兜底不会把临时角色放进来）", () => {
      expect(
        planPersonaSkillRound([input({ roleType: "", knownCharacter: true, appearanceCount: 2 })], 2),
      ).toHaveLength(1)
      expect(
        planPersonaSkillRound([input({ roleType: "", knownCharacter: false, appearanceCount: 2 })], 2),
      ).toHaveLength(0)
    })

    it("已建档的人物走完善门槛，knownCharacter 不参与（不改变完善节奏）", () => {
      const base = { hasSkill: true, lastLearnedChapter: 1, roleType: "配角" }
      expect(
        planPersonaSkillRound([input({ ...base, knownCharacter: true, appearanceCount: 2 })], 2),
      ).toHaveLength(0)
      expect(
        planPersonaSkillRound([input({ ...base, knownCharacter: true, appearanceCount: 3 })], 3),
      ).toHaveLength(1)
    })
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
