import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  ExtractionResult,
  NovelAgent,
  SimulationMode,
  StoryFramework,
  TimelineEvent,
} from "@/lib/novel/story-simulation/types"
import { runSimulation } from "@/lib/novel/story-simulation/simulation-engine"

let mockRun: any
let mockStreamChat: any

/**
 * 主循环默认走普通路径（`agentDecideAndAct` → `streamChat`），只在可见历史超出
 * 内联窗口时才升级到 ReAct。这些用例的轮次都很短（可见事件数远小于窗口），
 * 因此每次「角色决策」都对应一次 streamChat 调用 —— 用它来数实际轮数。
 */
vi.mock("@/lib/llm-client", () => ({
  streamChat: (...args: unknown[]) => mockStreamChat(...args),
}))

vi.mock("@/lib/agent/runner", () => ({
  AgentRunner: class {
    run(...args: unknown[]) {
      return mockRun(...args)
    }
  },
  ModelDoesNotSupportToolsError: class extends Error {
    constructor() {
      super("当前模型不支持工具调用")
      this.name = "ModelDoesNotSupportToolsError"
    }
  },
}))

vi.mock("@/lib/embedding-client", () => ({
  // 相似度恒为 1（远超 0.75 阈值）：只要引擎去问「节点目标达成了吗」，
  // 得到的答案就是「达成了」，于是 strictNodeProgression 的行为差异才看得见。
  embed: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: vi.fn(() => 1),
}))

import { embed } from "@/lib/embedding-client"

function makeAgent(): NovelAgent {
  return {
    characterId: "a",
    name: "甲",
    profile: "甲的档案",
    aura: null,
    cognition: null,
    soul: "",
    currentGoal: "完成当前目标",
    emotionalState: "neutral",
    knownFacts: new Set(),
    relationships: new Map(),
    powerLevel: "normal",
    memory: {
      observedEvents: [],
      knownSecrets: new Set(),
      sentiments: new Map(),
      recentDecisions: [],
      rumorCredibility: 0.5,
    },
    knowledgeScope: [],
    personality: [],
    speakingStyle: "",
  }
}

function makeExtraction(): ExtractionResult {
  return {
    characters: [],
    chapterContents: [],
    memoryData: {
      characterStates: "",
      characterCognition: null,
      foreshadowingTracker: null,
      timeline: [],
      canonFacts: "",
      conflicts: "",
    },
    worldRules: "",
    powerSystem: "",
    foreshadowing: null,
    timeline: [],
    outlineContent: "",
    soulDoc: "",
  }
}

/** 单节点框架：轮次数量即节点内实际执行的轮数。 */
function makeFramework(): StoryFramework {
  return {
    id: "fw",
    title: "测试框架",
    premise: "测试",
    targetWords: 10000,
    simulationMode: "hybrid",
    sourceChapters: 1,
    createdAt: "2026-07-06T00:00:00.000Z",
    nodes: [
      {
        index: 0,
        phase: "起",
        title: "开端",
        coreConflict: "冲突",
        involvedCharacters: ["甲"],
        goal: "推进剧情",
        causeFromPrev: "无",
        expectedOutcome: "完成开端",
      },
    ],
  }
}

async function runMode(mode: SimulationMode, maxRoundsPerNode: number) {
  mockStreamChat = vi.fn(
    async (
      _config: unknown,
      _messages: unknown,
      callbacks: { onToken: (token: string) => void },
    ) => {
      callbacks.onToken(
        JSON.stringify({
          type: "speak",
          content: "推进事件",
          visibility: "all",
          motivation: "推进剧情",
          plot_push: "推进",
        }),
      )
    },
  )
  mockRun = vi.fn().mockResolvedValue({
    toolCalls: [],
    roundsUsed: 1,
    finalText: JSON.stringify({
      type: "speak",
      content: "推进事件",
      visibility: "all",
      motivation: "推进剧情",
      plot_push: "推进",
    }),
  })

  const timeline: TimelineEvent[] = []
  await runSimulation(
    {
      agents: [makeAgent()],
      framework: makeFramework(),
      mode,
      wordBudget: 10000,
      llmConfig: {} as any,
      maxRoundsPerNode,
    } as any,
    makeExtraction(),
    {
      onEvent: () => {},
      onProgress: () => {},
      onComplete: () => {},
      onError: () => {},
      onTimelineEvent: (event) => timeline.push(event),
    },
  )

  return {
    // 普通路径的每次调用 = 一次角色决策
    agentRuns: mockStreamChat.mock.calls.length + mockRun.mock.calls.length,
    goalChecks: vi.mocked(embed).mock.calls.filter(
      ([text]) => text === "完成开端",
    ).length,
  }
}

/**
 * `strictNodeProgression` 此前是死配置：全库只有定义处和测试字面量命中，
 * 没有任何运行时读取，于是模式卡片上「严格按节点目标推进剧情」与
 * 「不强制节点目标，剧情自然涌现」这条对比不产生任何行为差异。
 */
describe("strictNodeProgression 真正生效", () => {
  beforeEach(() => {
    // 高于所有模式的 randomEventChance，避免随机事件干扰轮数统计
    vi.spyOn(Math, "random").mockReturnValue(0.99)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("strict 模式（event-driven）按节点目标达成提前结束节点", async () => {
    const result = await runMode("event-driven", 4)

    // 模式乘数 0.8 → maxRounds = round(4 × 0.8) = 3。
    // 目标判定在**每轮末尾**执行，此时本轮事件已写入 nodeTimelineEvents，
    // 于是第 0 轮末尾就判定「已达成」并 break —— 只跑 1 轮，远未跑满 3 轮。
    expect(result.goalChecks).toBeGreaterThan(0)
    expect(result.agentRuns).toBe(1)
  })

  it("非 strict 模式（free-emergence）不据目标达成提前截断，跑满轮数", async () => {
    const result = await runMode("free-emergence", 4)

    // 模式乘数 1.5 → maxRounds = round(4 × 1.5) = 6，全部跑完。
    expect(result.agentRuns).toBe(6)
    // 目标判定根本不该被调用 —— 既兑现了「不强制节点目标」，
    // 也顺带省掉这些模式下的 embedding 调用。
    expect(result.goalChecks).toBe(0)
  })

  it("同为非 strict 的 hybrid 也跑满轮数", async () => {
    const result = await runMode("hybrid", 2)

    // 模式乘数 1.2 → maxRounds = round(2 × 1.2) = 2，全部跑完。
    expect(result.agentRuns).toBe(2)
    expect(result.goalChecks).toBe(0)
  })
})
