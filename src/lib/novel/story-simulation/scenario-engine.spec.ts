import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatMessage } from "@/lib/llm-client"
import { streamChat } from "@/lib/llm-client"
import {
  buildCharacterSystemPrompt,
  buildCharacterTurnPrompt,
  buildScenarioSession,
  continueScenario,
  createScenarioSetup,
  runScenario,
} from "./scenario-engine"
import {
  SCENARIO_MODERATOR_USER_ID,
  SCENARIO_MODERATOR_USER_NAME,
  type ScenarioFormat,
  type ScenarioParticipant,
} from "./scenario-types"

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(),
}))

const mockStream = vi.mocked(streamChat)

const mockLlmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "test-key",
  model: "test-model",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 4096,
}

function makeCharacter(id: string, isModerator = false): ScenarioParticipant {
  return {
    id,
    name: id,
    isModerator,
    auraId: null,
    auraName: null,
    profile: `${id}的档案`,
    personality: ["刚直"],
    speakingStyle: "简短有力",
    knowledgeScope: ["知道甲事"],
    doesNotKnow: ["乙事"],
  }
}

function makeUserModerator(): ScenarioParticipant {
  return {
    id: SCENARIO_MODERATOR_USER_ID,
    name: SCENARIO_MODERATOR_USER_NAME,
    isModerator: true,
  }
}

function makeSetup(
  participants: ScenarioParticipant[],
  overrides: Partial<{
    format: ScenarioFormat
    rounds: number
    reference: string
  }> = {},
) {
  return createScenarioSetup({
    title: "论中庸",
    rules: {
      directive: "生成一场关于《中庸》这本书的辩论",
      scene: "在书院的讲堂内",
      reference: overrides.reference ?? "《中庸》",
    },
    format: overrides.format ?? "debate",
    rounds: overrides.rounds ?? 2,
    participants,
    sourceChapters: 4,
  })
}

let capturedCalls: ChatMessage[][]

beforeEach(() => {
  capturedCalls = []
  mockStream.mockReset()
  mockStream.mockImplementation(async (_cfg, messages, callbacks) => {
    capturedCalls.push(messages as ChatMessage[])
    callbacks.onToken("这是发言内容")
    callbacks.onDone()
  })
})

describe("buildCharacterSystemPrompt / buildCharacterTurnPrompt", () => {
  it("系统提示词包含角色名与铁律", () => {
    const setup = makeSetup([makeUserModerator(), makeCharacter("子思")])
    const prompt = buildCharacterSystemPrompt(setup, makeCharacter("子思"))
    expect(prompt).toContain("子思")
    expect(prompt).toContain("有来有回")
  })

  it("发言指令携带参考点与已有对话", () => {
    const setup = makeSetup([makeUserModerator(), makeCharacter("子思")])
    const prompt = buildCharacterTurnPrompt(
      setup,
      makeCharacter("子思"),
      "【孔子】你好",
      3,
    )
    expect(prompt).toContain("《中庸》")
    expect(prompt).toContain("已有对话")
    expect(prompt).toContain("第 3 轮")
  })
})

describe("runScenario", () => {
  it("用户担任主持人时：开场取用户要求，角色按轮发言", async () => {
    const setup = makeSetup(
      [makeUserModerator(), makeCharacter("甲"), makeCharacter("乙"), makeCharacter("丙")],
      { rounds: 2 },
    )
    const { messages, cancelled } = await runScenario({
      setup,
      llmConfig: mockLlmConfig,
    })
    expect(cancelled).toBe(false)
    const moderators = messages.filter((m) => m.kind === "moderator")
    const chars = messages.filter((m) => m.kind === "character")
    expect(moderators).toHaveLength(1)
    expect(moderators[0].content).toContain("《中庸》")
    expect(chars).toHaveLength(6) // 3 角色 × 2 轮
  })

  it("角色担任主持人时：生成开场与收束", async () => {
    const setup = makeSetup(
      [
        makeCharacter("主礼", true),
        makeCharacter("甲"),
        makeCharacter("乙"),
        makeCharacter("丙"),
      ],
      { rounds: 1 },
    )
    const { messages } = await runScenario({ setup, llmConfig: mockLlmConfig })
    expect(messages.map((m) => m.kind)).toEqual([
      "moderator", // 开场
      "character",
      "character",
      "character",
      "moderator", // 收束
    ])
  })

  it("轮转起始发言者，避免每轮同一角色先开口", async () => {
    const setup = makeSetup(
      [makeUserModerator(), makeCharacter("甲"), makeCharacter("乙"), makeCharacter("丙")],
      { rounds: 2 },
    )
    const { messages } = await runScenario({ setup, llmConfig: mockLlmConfig })
    const chars = messages.filter((m) => m.kind === "character")
    const r1 = chars.filter((m) => m.round === 1).map((m) => m.speakerName)
    const r2 = chars.filter((m) => m.round === 2).map((m) => m.speakerName)
    expect(r1).toEqual(["甲", "乙", "丙"])
    expect(r2[0]).not.toBe("甲")
  })

  it("参考点会传递给每次 LLM 调用", async () => {
    const setup = makeSetup(
      [makeUserModerator(), makeCharacter("甲"), makeCharacter("乙"), makeCharacter("丙")],
      { rounds: 1 },
    )
    await runScenario({ setup, llmConfig: mockLlmConfig })
    expect(capturedCalls.length).toBeGreaterThan(0)
    for (const call of capturedCalls) {
      const text = call.map((m) => m.content).join("\n")
      expect(text).toContain("《中庸》")
    }
  })

  it("信号已中止时立即结束并标记 cancelled", async () => {
    const setup = makeSetup(
      [makeUserModerator(), makeCharacter("甲"), makeCharacter("乙"), makeCharacter("丙")],
      { rounds: 2 },
    )
    const controller = new AbortController()
    controller.abort()
    const { cancelled, messages } = await runScenario({
      setup,
      llmConfig: mockLlmConfig,
      signal: controller.signal,
    })
    expect(cancelled).toBe(true)
    // 仅保留用户主持人的开场
    expect(messages.filter((m) => m.kind === "character")).toHaveLength(0)
  })

  it("onProgress 会报告完成数", async () => {
    const setup = makeSetup(
      [makeUserModerator(), makeCharacter("甲"), makeCharacter("乙"), makeCharacter("丙")],
      { rounds: 1 },
    )
    const progress: [number, number][] = []
    await runScenario({
      setup,
      llmConfig: mockLlmConfig,
      onProgress: (done, total) => progress.push([done, total]),
    })
    expect(progress.at(-1)).toEqual([progress.at(-1)![1], progress.at(-1)![1]])
  })
})

describe("continueScenario", () => {
  it("记录用户插话并追加一轮角色发言", async () => {
    const participants = [
      makeUserModerator(),
      makeCharacter("甲"),
      makeCharacter("乙"),
      makeCharacter("丙"),
    ]
    const setup = makeSetup(participants, { rounds: 1 })
    const { messages: first } = await runScenario({
      setup,
      llmConfig: mockLlmConfig,
    })
    const session = buildScenarioSession(setup, first)

    const { messages } = await continueScenario({
      session,
      llmConfig: mockLlmConfig,
      userInput: "请把讨论聚焦到「诚」这个概念上",
      rounds: 1,
    })

    const userMsgs = messages.filter((m) => m.kind === "user")
    expect(userMsgs).toHaveLength(1)
    expect(userMsgs[0].content).toContain("诚")
    // 原 1 条开场 + 3 条角色 + 1 条用户插话 + 新增 3 条角色
    expect(messages.filter((m) => m.kind === "character")).toHaveLength(6)
  })
})
