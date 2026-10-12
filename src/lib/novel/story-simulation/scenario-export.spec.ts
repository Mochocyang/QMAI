import { describe, expect, it, vi } from "vitest"
import {
  SCENARIO_MODERATOR_USER_ID,
  SCENARIO_MODERATOR_USER_NAME,
  type ScenarioMessage,
  type ScenarioParticipant,
  type ScenarioSetup,
} from "./scenario-types"
import { exportScenario, scenarioToMarkdown } from "./scenario-export"

/** 记录每次实际写入的路径，用于验证文件名与落盘位置。 */
const written = vi.hoisted(() => [] as string[])

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}),
  writeFileAtomic: vi.fn(async (path: string) => {
    written.push(path)
  }),
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

/**
 * exportScenario 此前没有任何测试（本文件只覆盖纯函数 scenarioToMarkdown）。
 *
 * 这组是**特征测试**：它不改变行为，只是把那两条一直靠运气成立的性质钉住 ——
 * 文件名里的时间戳是「导出不会互相覆盖」的唯一依据，标题的字符清洗是「导出
 * 不会写出情景目录」的唯一依据。两者都很容易被一次「简化文件名」的重构悄悄
 * 抹掉，而抹掉之后不会有任何测试变红。
 */
describe("exportScenario · 落盘路径", () => {
  const SCENARIOS_DIR = "/proj/.qmai/simulations/scenarios/"

  /** 在指定时刻导出一场情景，返回实际写入的路径。 */
  async function exportAt(isoTime: string, title: string): Promise<string> {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(isoTime))
    try {
      return await exportScenario("/proj", {
        setup,
        messages: [],
        title,
      } as never)
    } finally {
      vi.useRealTimers()
    }
  }

  it("导出落在项目的 .qmai/simulations/scenarios 目录", async () => {
    const path = await exportAt("2026-10-12T00:00:00.000Z", "论中庸")
    expect(path.startsWith(SCENARIOS_DIR)).toBe(true)
  })

  it("文件名带时间戳，因此不同时刻的导出不会互相覆盖", async () => {
    const first = await exportAt("2026-10-12T00:00:00.000Z", "论中庸")
    const second = await exportAt("2026-10-12T00:00:01.000Z", "论中庸")

    expect(first).not.toBe(second)
    expect(first).toContain("2026-10-12T00-00-00-000Z")
    expect(second).toContain("2026-10-12T00-00-01-000Z")
  })

  it("标题里的路径分隔符被替换，导出不会越出情景目录", async () => {
    const path = await exportAt("2026-10-12T00:00:00.000Z", "../../etc/passwd")

    expect(path.startsWith(SCENARIOS_DIR)).toBe(true)
    // 关键：剥掉目录前缀后必须只剩一个文件名，不能再有分隔符
    expect(path.slice(SCENARIOS_DIR.length)).not.toContain("/")
    expect(path.slice(SCENARIOS_DIR.length)).not.toContain("\\")
  })

  it("标题里的 Windows 非法字符同样被替换", async () => {
    const path = await exportAt("2026-10-12T00:00:00.000Z", 'a<b>c:d"e|f?g*h')
    expect(path.slice(SCENARIOS_DIR.length)).toBe(
      "a_b_c_d_e_f_g_h_2026-10-12T00-00-00-000Z.md",
    )
  })
})
