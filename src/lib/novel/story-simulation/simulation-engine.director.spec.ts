import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  DirectorEvaluation,
  ExtractionResult,
  NovelAgent,
  StoryFramework,
} from "@/lib/novel/story-simulation/types"
import { runSimulation } from "@/lib/novel/story-simulation/simulation-engine"

let mockRun: any
let mockDirectorEvaluate: any
let mockShouldInjectEvent: any

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
  embed: vi.fn().mockResolvedValue([1, 0, 0]),
  cosineSimilarity: vi.fn().mockReturnValue(0),
}))

vi.mock("@/lib/novel/story-simulation/director-agent", () => ({
  directorEvaluate: (...args: unknown[]) => mockDirectorEvaluate(...args),
  shouldInjectEvent: (evaluation: unknown) => mockShouldInjectEvent(evaluation),
}))

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
    worldRules: "世界规则",
    powerSystem: "",
    foreshadowing: null,
    timeline: [],
    outlineContent: "",
    soulDoc: "",
  }
}

/** 两个节点：导演只会在非末节点（index 0）之后评估。 */
function makeFramework(): StoryFramework {
  return {
    id: "fw",
    title: "测试框架",
    premise: "测试",
    targetWords: 10000,
    simulationMode: "event-driven",
    sourceChapters: 1,
    createdAt: "2026-07-06T00:00:00.000Z",
    nodes: [
      {
        index: 0,
        phase: "起",
        title: "开端",
        coreConflict: "冲突",
        involvedCharacters: ["甲"],
        goal: "继续开端",
        causeFromPrev: "无",
        expectedOutcome: "完成开端",
      },
      {
        index: 1,
        phase: "承",
        title: "推进",
        coreConflict: "冲突",
        involvedCharacters: ["甲"],
        goal: "推进剧情",
        causeFromPrev: "开端",
        expectedOutcome: "完成推进",
      },
    ],
  }
}

/**
 * totalScore 是 7 个维度的平均值（1-5），与 director-agent 的 calcTotalScore 保持一致。
 */
function makeDirectorEvaluation(injectEvent?: string): DirectorEvaluation {
  return {
    scores: {
      tension: 5,
      pace: 4,
      characterUtilization: 4,
      characterArc: 4,
      infoDensity: 4,
      emotionalResonance: 5,
      logicConsistency: 4,
    },
    totalScore: 4.3,
    highlights: ["张力充足"],
    issues: [],
    suggestion: "继续保持",
    shouldInjectEvent: !!injectEvent,
    injectEvent,
  }
}

interface RunOptions {
  directorEnabled?: boolean
  directorEvaluation?: DirectorEvaluation
  shouldInject?: boolean
}

async function run(options: RunOptions = {}) {
  const onDirectorEvaluation = vi.fn()

  await runSimulation(
    {
      agents: [makeAgent()],
      framework: makeFramework(),
      mode: "event-driven",
      wordBudget: 10000,
      llmConfig: {} as any,
      maxRoundsPerNode: 1,
      ...(options.directorEnabled === undefined
        ? {}
        : { directorEnabled: options.directorEnabled }),
    } as any,
    makeExtraction(),
    {
      onEvent: () => {},
      onProgress: () => {},
      onComplete: () => {},
      onError: () => {},
      onDirectorEvaluation,
    },
  )

  return { onDirectorEvaluation }
}

describe("runSimulation director agent", () => {
  beforeEach(() => {
    // 0.99 高于所有模式的 randomEventChance，避免随机事件干扰断言
    vi.spyOn(Math, "random").mockReturnValue(0.99)
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
    mockDirectorEvaluate = vi.fn().mockResolvedValue(makeDirectorEvaluation())
    mockShouldInjectEvent = vi.fn().mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("calls directorEvaluate when the caller explicitly enables it", async () => {
    // event-driven 的模式配置里 directorEnabled 为 false，
    // 显式入参必须覆盖模式配置。
    const { onDirectorEvaluation } = await run({ directorEnabled: true })

    expect(mockDirectorEvaluate).toHaveBeenCalledTimes(1)
    expect(onDirectorEvaluation).toHaveBeenCalledTimes(1)
    expect(onDirectorEvaluation.mock.calls[0][0]).toMatchObject({
      totalScore: 4.3,
    })
  })

  it("does not call directorEvaluate when the caller explicitly disables it", async () => {
    const { onDirectorEvaluation } = await run({ directorEnabled: false })

    expect(mockDirectorEvaluate).not.toHaveBeenCalled()
    expect(onDirectorEvaluation).not.toHaveBeenCalled()
  })

  it("falls back to the mode config when the flag is omitted", async () => {
    // 未传 directorEnabled 时回退到模式配置，event-driven 默认为关闭。
    await run({})

    expect(mockDirectorEvaluate).not.toHaveBeenCalled()
  })

  it("injects the director event into the next node's first round", async () => {
    mockDirectorEvaluate = vi
      .fn()
      .mockResolvedValue(makeDirectorEvaluation("导演注入：地震"))
    mockShouldInjectEvent = vi.fn().mockReturnValue(true)

    await run({ directorEnabled: true })

    const userTexts: string[] = []
    for (const call of mockRun.mock.calls as unknown[][]) {
      const messages = (call[2] as { role: string; content: string }[]) ?? []
      for (const message of messages) {
        if (message?.role === "user") {
          userTexts.push(String(message.content))
        }
      }
    }

    expect(userTexts.some((text) => text.includes("导演注入：地震"))).toBe(true)
  })
})
