import { describe, expect, it, vi } from "vitest"
import type {
  ExtractionResult,
  NovelAgent,
  StoryFramework,
  TimelineEvent,
} from "@/lib/novel/story-simulation/types"
import { runSimulation } from "@/lib/novel/story-simulation/simulation-engine"

let mockRun: any

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

function makePreviousEvent(): TimelineEvent {
  return {
    id: "previous",
    round: 0,
    nodeIndex: 0,
    actorId: "a",
    actorName: "甲",
    actionType: "speak",
    content: "既有事件",
    observableBy: ["a"],
    impacts: [],
    timestamp: "2026-07-06T00:00:00.000Z",
  }
}

describe("runSimulation resume", () => {
  it("continues from the saved node and round while keeping previous timeline events", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99)
    mockRun = vi.fn().mockResolvedValue({
      toolCalls: [],
      roundsUsed: 1,
      finalText: JSON.stringify({
        type: "speak",
        content: "续跑事件",
        visibility: "all",
        motivation: "继续推进",
        plot_push: "补完当前节点",
      }),
    })

    const timelineEvents: TimelineEvent[] = []

    await runSimulation(
      {
        agents: [makeAgent()],
        framework: makeFramework(),
        mode: "event-driven",
        wordBudget: 10000,
        llmConfig: {} as any,
        maxRoundsPerNode: 2,
        resume: {
          nextNodeIndex: 0,
          nextRound: 1,
          timelineEvents: [makePreviousEvent()],
        },
      } as any,
      makeExtraction(),
      {
        onEvent: () => {},
        onProgress: () => {},
        onComplete: () => {},
        onError: () => {},
        onTimelineEvent: (event) => timelineEvents.push(event),
      },
    )

    expect(timelineEvents.slice(0, 2).map((event) => event.content)).toEqual([
      "既有事件",
      "续跑事件",
    ])
    expect(timelineEvents[1].nodeIndex).toBe(0)
    expect(timelineEvents[1].round).toBe(1)
  })
})
