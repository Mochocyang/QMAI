import { describe, expect, it } from "vitest"
import {
  SCENARIO_MODERATOR_USER_ID,
  clampScenarioRounds,
  estimateScenarioMessages,
  hasRoleModerator,
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
