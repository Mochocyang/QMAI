import { describe, expect, it, vi } from "vitest"
import {
  SCENARIO_MODERATOR_USER_ID,
  SCENARIO_MODERATOR_USER_NAME,
  type ScenarioMessage,
  type ScenarioParticipant,
  type ScenarioSetup,
} from "./scenario-types"
import { scenarioToMarkdown } from "./scenario-export"

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}),
  writeFileAtomic: vi.fn(async () => {}),
}))

const participants: ScenarioParticipant[] = [
  {
    id: SCENARIO_MODERATOR_USER_ID,
    name: SCENARIO_MODERATOR_USER_NAME,
    isModerator: true,
  },
  { id: "甲", name: "甲", isModerator: false },
  { id: "乙", name: "乙", isModerator: false },
]

const setup: ScenarioSetup = {
  id: "s1",
  title: "论中庸",
  rules: {
    directive: "生成一场关于《中庸》的辩论",
    scene: "在书院讲堂",
    reference: "《中庸》",
  },
  format: "debate",
  rounds: 2,
  participants,
  sourceChapters: 4,
  createdAt: "2026-10-11T00:00:00.000Z",
}

function msg(over: Partial<ScenarioMessage>): ScenarioMessage {
  return {
    id: Math.random().toString(36).slice(2),
    kind: "character",
    speakerId: "甲",
    speakerName: "甲",
    round: 1,
    content: "我认为……",
    timestamp: "2026-10-11T00:00:00.000Z",
    ...over,
  }
}

describe("scenarioToMarkdown", () => {
  it("输出标题、元信息与出场名单", () => {
    const md = scenarioToMarkdown({ setup, messages: [] } as never)
    expect(md).toContain("# 舞台情景：论中庸")
    expect(md).toContain("参考点：《中庸》")
    expect(md).toContain("情景设定：在书院讲堂")
    expect(md).toContain("主持人要求：生成一场关于《中庸》的辩论")
    expect(md).toContain("辩论")
    expect(md).toContain("甲、乙")
  })

  it("按发言人渲染，主持人开场与角色轮次分节", () => {
    const messages: ScenarioMessage[] = [
      msg({
        kind: "moderator",
        speakerId: SCENARIO_MODERATOR_USER_ID,
        speakerName: SCENARIO_MODERATOR_USER_NAME,
        round: 0,
        content: "今日辩题：《中庸》",
      }),
      msg({ speakerName: "甲", round: 1, content: "天命之谓性。" }),
      msg({
        kind: "user",
        speakerId: "user",
        speakerName: "作者",
        round: 2,
        content: "请聚焦于「诚」。",
      }),
    ]
    const md = scenarioToMarkdown({ setup, messages } as never)
    expect(md).toContain("## 开场")
    expect(md).toContain(`【主持人·${SCENARIO_MODERATOR_USER_NAME}】`)
    expect(md).toContain("【甲】")
    expect(md).toContain("天命之谓性。")
    expect(md).toContain("## 第 2 轮")
    expect(md).toContain("【作者】")
    expect(md).toContain("请聚焦于「诚」。")
  })

  it("system 消息渲染为旁白而不是独立轮次标题", () => {
    const md = scenarioToMarkdown({
      setup,
      messages: [
        msg({ kind: "system", speakerName: "系统", round: 1, content: "场景切换" }),
      ],
    } as never)
    expect(md).toContain("（旁白）")
    expect(md).toContain("场景切换")
    expect(md).not.toContain("## 第 1 轮")
  })
})
