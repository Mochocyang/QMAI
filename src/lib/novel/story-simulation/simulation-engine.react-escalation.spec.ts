import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  ExtractionResult,
  NovelAgent,
  StoryFramework,
  TimelineEvent,
} from "@/lib/novel/story-simulation/types"
import {
  INLINE_VISIBLE_EVENT_LIMIT,
  runSimulation,
  shouldEscalateToReact,
} from "@/lib/novel/story-simulation/simulation-engine"

const order: string[] = []

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  streamChat: vi.fn(),
}))

vi.mock("@/lib/agent/runner", () => ({
  AgentRunner: class {
    run(...args: unknown[]) {
      return mocks.run(...args)
    }
  },
  ModelDoesNotSupportToolsError: class extends Error {
    constructor() {
      super("当前模型不支持工具调用")
      this.name = "ModelDoesNotSupportToolsError"
    }
  },
}))

vi.mock("@/lib/llm-client", () => ({
  streamChat: (...args: unknown[]) => mocks.streamChat(...args),
}))

import { ModelDoesNotSupportToolsError } from "@/lib/agent/runner"

const ACTION_JSON = JSON.stringify({
  type: "speak",
  content: "推进事件",
  visibility: "all",
  motivation: "推进剧情",
  plot_push: "推进",
})

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

function makeFramework(): StoryFramework {
  return {
    id: "fw",
    title: "测试框架",
    premise: "测试",
    targetWords: 10000,
    simulationMode: "free-emergence",
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

async function run(maxRoundsPerNode: number) {
  const timeline: TimelineEvent[] = []
  await runSimulation(
    {
      agents: [makeAgent()],
      framework: makeFramework(),
      mode: "free-emergence",
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
  return timeline
}

/**
 * `simulation-engine.ts:1082` 的每角色每轮 1~3 次调用是主推演最大的成本项。
 * 改造前**每一轮都先走 ReAct**，只有在模型不支持工具时才降级 —— 方向反了：
 * 绝大多数轮次并不需要主动检索，却都付了 2~3 倍的调用代价。
 */
describe("shouldEscalateToReact", () => {
  it("可见事件在内联窗口内时不升级（普通路径 1 次调用就够）", () => {
    expect(shouldEscalateToReact(0)).toBe(false)
    expect(shouldEscalateToReact(5)).toBe(false)
    expect(shouldEscalateToReact(INLINE_VISIBLE_EVENT_LIMIT)).toBe(false)
  })

  it("可见事件超出内联窗口时才升级（普通路径看不全，需要主动检索）", () => {
    expect(shouldEscalateToReact(INLINE_VISIBLE_EVENT_LIMIT + 1)).toBe(true)
    expect(shouldEscalateToReact(100)).toBe(true)
  })
})

describe("主循环的 ReAct 升级策略", () => {
  beforeEach(() => {
    order.length = 0
    mocks.run.mockReset()
    mocks.streamChat.mockReset()
    vi.spyOn(Math, "random").mockReturnValue(0.99)

    mocks.run.mockImplementation(async () => {
      order.push("react")
      return { toolCalls: [], roundsUsed: 1, finalText: ACTION_JSON }
    })
    mocks.streamChat.mockImplementation(
      async (_config: unknown, _messages: unknown, callbacks: { onToken: (t: string) => void }) => {
        order.push("plain")
        callbacks.onToken(ACTION_JSON)
      },
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("开局先走普通路径，不为一轮决策付 ReAct 的多次调用", async () => {
    await run(2)

    expect(order.length).toBeGreaterThan(0)
    expect(order[0]).toBe("plain")
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("可见历史超出内联窗口后自动升级到 ReAct", async () => {
    // free-emergence 乘数 1.5 → 8 × 1.5 = 12 轮；单角色每轮产生 1 条可见事件
    await run(8)

    // 前 11 轮（事件数 0..10）走普通路径，第 12 轮起事件数 11 > 10 才升级
    expect(mocks.run).toHaveBeenCalled()
    expect(order[0]).toBe("plain")
    expect(order.indexOf("react")).toBeGreaterThan(0)
  })

  it("升级后仍然正常产出事件（两条路径语义一致）", async () => {
    const timeline = await run(8)

    expect(timeline.length).toBeGreaterThan(INLINE_VISIBLE_EVENT_LIMIT)
    for (const event of timeline) {
      expect(event.content).toBe("推进事件")
    }
  })

  it("需要检索但模型不支持工具时，降级回普通路径而不是中断推演", async () => {
    mocks.run.mockRejectedValue(new ModelDoesNotSupportToolsError())

    const timeline = await run(8)

    // 升级尝试过，但每次都回退到普通路径，轮次仍全部完成
    expect(mocks.run).toHaveBeenCalled()
    expect(order.filter((o) => o === "plain").length).toBeGreaterThan(
      INLINE_VISIBLE_EVENT_LIMIT,
    )
    expect(timeline.length).toBeGreaterThan(INLINE_VISIBLE_EVENT_LIMIT)
  })
})
