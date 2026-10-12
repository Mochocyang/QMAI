import { describe, expect, it } from "vitest"
import {
  SCENARIO_CHARACTER_DEFAULT,
  SCENARIO_CHARACTER_MAX,
  SCENARIO_CHARACTER_MIN,
  SCENARIO_CHARACTER_PRESETS,
  SCENARIO_MODERATOR_USER_ID,
  clampScenarioCharacterCount,
  clampScenarioRounds,
  estimateScenarioMessages,
  hasRoleModerator,
  lastSpokenRound,
  remainingScenarioRounds,
  type ScenarioMessage,
  type ScenarioParticipant,
} from "./scenario-types"

function char(id: string): ScenarioParticipant {
  return { id, name: id, isModerator: false }
}
function userModerator(): ScenarioParticipant {
  return {
    id: SCENARIO_MODERATOR_USER_ID,
    name: "主持人（你）",
    isModerator: true,
  }
}
function roleModerator(id: string): ScenarioParticipant {
  return { id, name: id, isModerator: true }
}

describe("clampScenarioRounds", () => {
  it("夹取到 [1,100] 并取整", () => {
    expect(clampScenarioRounds(-5)).toBe(1)
    expect(clampScenarioRounds(0)).toBe(1)
    expect(clampScenarioRounds(20.4)).toBe(20)
    expect(clampScenarioRounds(9999)).toBe(100)
  })

  it("非法输入回退默认值", () => {
    expect(clampScenarioRounds(Number.NaN)).toBe(20)
  })
})

describe("hasRoleModerator", () => {
  it("无参与者或仅用户主持人时为 false", () => {
    expect(hasRoleModerator([])).toBe(false)
    expect(hasRoleModerator([userModerator(), char("甲")])).toBe(false)
  })

  it("有角色担任主持人时为 true", () => {
    expect(hasRoleModerator([roleModerator("甲"), char("乙")])).toBe(true)
  })
})

describe("estimateScenarioMessages", () => {
  it("用户主持：开场 1 + 每轮每位角色 1，无收束", () => {
    const participants = [userModerator(), char("甲"), char("乙"), char("丙")]
    expect(estimateScenarioMessages(participants, 1, 5)).toBe(4) // 1 + 3
    expect(estimateScenarioMessages(participants, 2, 5)).toBe(7) // 1 + 6
  })

  it("角色主持：开场 + 每轮角色 + 收束", () => {
    const participants = [roleModerator("主礼"), char("甲"), char("乙"), char("丙")]
    expect(estimateScenarioMessages(participants, 1, 5)).toBe(5) // 1 + 3 + 1
  })

  it("角色主持：按间隔计入串场（首轮不算）", () => {
    const participants = [roleModerator("主礼"), char("甲"), char("乙"), char("丙")]
    // 6 轮：开场 1 + 18 + 串场（第 6 轮 1 次）+ 收束 1 = 21
    expect(estimateScenarioMessages(participants, 6, 5)).toBe(21)
  })

  it("间隔为 0 时不串场", () => {
    const participants = [roleModerator("主礼"), char("甲"), char("乙")]
    // 2 名角色 × 4 轮 = 8；开场 1 + 收束 1
    expect(estimateScenarioMessages(participants, 4, 0)).toBe(1 + 8 + 1)
  })

  it("轮数非法时按至少 1 轮计", () => {
    const participants = [userModerator(), char("甲"), char("乙"), char("丙")]
    expect(estimateScenarioMessages(participants, Number.NaN, 5)).toBe(4)
  })
})

describe("lastSpokenRound / remainingScenarioRounds", () => {
  function message(round: number, kind: ScenarioMessage["kind"] = "character"): ScenarioMessage {
    return {
      id: `m${round}-${kind}`,
      kind,
      speakerId: "甲",
      speakerName: "甲",
      round,
      content: "……",
      timestamp: "2026-10-11T00:00:00.000Z",
    }
  }

  it("取已发生过的最大轮次", () => {
    expect(lastSpokenRound([])).toBe(0)
    expect(lastSpokenRound([message(1), message(3), message(2)])).toBe(3)
  })

  it("开场与收束记在第 0 轮，不影响进度", () => {
    // 角色主持的情景跑完后，最后一条正是记在第 0 轮的收束
    const messages = [message(0, "moderator"), message(1), message(2), message(0, "moderator")]
    expect(lastSpokenRound(messages)).toBe(2)
  })

  it("按计划轮数算出还剩多少轮", () => {
    const setup = { rounds: 50 } as never
    expect(remainingScenarioRounds(setup, [message(1), message(12)])).toBe(38)
  })

  it("刚好跑完时为 0，绝不返回负数", () => {
    const setup = { rounds: 3 } as never
    expect(remainingScenarioRounds(setup, [message(3)])).toBe(0)
    // 兜底：即使出现超出计划的轮次也不给负数
    expect(remainingScenarioRounds(setup, [message(9)])).toBe(0)
  })

  it("一条发言都还没有时，剩余就是全部计划轮数", () => {
    const setup = { rounds: 20 } as never
    expect(remainingScenarioRounds(setup, [])).toBe(20)
  })
})

describe("角色数量常量", () => {
  it("上限放宽到 10，下限仍是 3", () => {
    expect(SCENARIO_CHARACTER_MIN).toBe(3)
    expect(SCENARIO_CHARACTER_MAX).toBe(10)
  })

  it("一键预设是 3/4/5，且都落在合法区间内", () => {
    expect([...SCENARIO_CHARACTER_PRESETS]).toEqual([3, 4, 5])
    for (const n of SCENARIO_CHARACTER_PRESETS) {
      expect(n).toBeGreaterThanOrEqual(SCENARIO_CHARACTER_MIN)
      expect(n).toBeLessThanOrEqual(SCENARIO_CHARACTER_MAX)
    }
  })

  it("默认值仍是 3（不回退）", () => {
    expect(SCENARIO_CHARACTER_DEFAULT).toBe(3)
  })
})

describe("clampScenarioCharacterCount", () => {
  it("区间内原样返回", () => {
    expect(clampScenarioCharacterCount(7)).toBe(7)
    expect(clampScenarioCharacterCount(3)).toBe(3)
    expect(clampScenarioCharacterCount(10)).toBe(10)
  })

  it("低于下限夹到下限，高于上限夹到上限", () => {
    expect(clampScenarioCharacterCount(1)).toBe(SCENARIO_CHARACTER_MIN)
    expect(clampScenarioCharacterCount(99)).toBe(SCENARIO_CHARACTER_MAX)
  })

  it("非数字不返回 NaN", () => {
    expect(clampScenarioCharacterCount(Number.NaN)).toBe(SCENARIO_CHARACTER_DEFAULT)
    expect(clampScenarioCharacterCount(Number.POSITIVE_INFINITY)).toBe(
      SCENARIO_CHARACTER_MAX,
    )
  })

  it("小数四舍五入", () => {
    expect(clampScenarioCharacterCount(4.4)).toBe(4)
    expect(clampScenarioCharacterCount(4.6)).toBe(5)
  })
})

describe("既有的轮数夹取不被牵连", () => {
  it("轮数上限仍是 100", () => {
    expect(clampScenarioRounds(9999)).toBe(100)
    expect(clampScenarioRounds(20)).toBe(20)
  })
})
