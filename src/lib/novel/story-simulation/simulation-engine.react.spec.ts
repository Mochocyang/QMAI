import { describe, expect, it, vi } from "vitest"
import type { NovelAgent, SimulationState, StoryNode, ExtractionResult } from "@/lib/novel/story-simulation/types"
import {
  createSimulationBlackboard,
} from "@/lib/novel/story-simulation/multi-agent-orchestrator"
import { agentDecideAndActWithReact } from "@/lib/novel/story-simulation/simulation-engine"
import { ModelDoesNotSupportToolsError } from "@/lib/agent/runner"

let mockRun: any

vi.mock("@/lib/agent/runner", () => ({
  AgentRunner: class {
    run(...args: any[]) {
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

function makeAgent(id: string, name: string): NovelAgent {
  return {
    characterId: id,
    name,
    profile: `${name}的档案`,
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
    },
    knowledgeScope: [],
    personality: [],
    speakingStyle: "",
  }
}

function makeNode(): StoryNode {
  return {
    index: 0,
    phase: "起",
    title: "开端",
    coreConflict: "冲突",
    involvedCharacters: ["甲", "乙"],
    goal: "推进剧情",
    causeFromPrev: "无",
    expectedOutcome: "完成开端",
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

function makeState(agents: NovelAgent[]): SimulationState {
  return {
    currentRound: 0,
    timelineEvents: [],
    activeAgents: new Map(agents.map((a) => [a.characterId, a])),
    worldState: {},
    directorEnabled: false,
    nextNodeInjectionMap: new Map(),
  }
}

describe("agentDecideAndActWithReact", () => {
  it("parses action from AgentRunner finalText and creates timeline event", async () => {
    const agentA = makeAgent("a", "甲")
    const agentB = makeAgent("b", "乙")
    const agents = [agentA, agentB]
    const node = makeNode()
    const state = makeState(agents)
    const extraction = makeExtraction()
    const blackboard = createSimulationBlackboard({ agents })

    mockRun = vi.fn().mockResolvedValue({
      toolCalls: [],
      roundsUsed: 1,
      finalText: JSON.stringify({
        type: "speak",
        content: "你好乙",
        target: "乙",
        visibility: "target_only",
        motivation: "打招呼",
        plot_push: "建立联系",
      }),
    })

    const result = await agentDecideAndActWithReact(
      agentA,
      node,
      state,
      {} as any,
      extraction,
      [],
      undefined,
      blackboard,
    )

    expect(result).not.toBeNull()
    expect(result!.parsed.action.type).toBe("speak")
    expect(result!.parsed.action.content).toBe("你好乙")
    expect(result!.parsed.action.target).toBe("乙")
    expect(result!.tlEvent.actorId).toBe("a")
    expect(result!.tlEvent.content).toBe("你好乙")

    expect(mockRun).toHaveBeenCalledTimes(1)
    const callArgs = mockRun.mock.calls[0]
    expect(callArgs[0].maxRounds).toBe(3)
    expect(callArgs[0].tools.length).toBe(5)
  })

  it("throws ModelDoesNotSupportToolsError when model does not support tools", async () => {
    const agentA = makeAgent("a", "甲")
    const agents = [agentA]
    const node = makeNode()
    const state = makeState(agents)
    const extraction = makeExtraction()
    const blackboard = createSimulationBlackboard({ agents })

    mockRun = vi.fn().mockImplementation(async (_config, _registry, _messages, callbacks) => {
      callbacks.onError(new ModelDoesNotSupportToolsError())
      return { toolCalls: [], roundsUsed: 0, finalText: "" }
    })

    await expect(
      agentDecideAndActWithReact(
        agentA,
        node,
        state,
        {} as any,
        extraction,
        [],
        undefined,
        blackboard,
      ),
    ).rejects.toThrow(ModelDoesNotSupportToolsError)
  })

  it("returns null when signal is aborted", async () => {
    const agentA = makeAgent("a", "甲")
    const agents = [agentA]
    const node = makeNode()
    const state = makeState(agents)
    const extraction = makeExtraction()
    const blackboard = createSimulationBlackboard({ agents })

    mockRun = vi.fn().mockResolvedValue({
      toolCalls: [],
      roundsUsed: 0,
      finalText: "",
    })

    const controller = new AbortController()
    controller.abort()

    const result = await agentDecideAndActWithReact(
      agentA,
      node,
      state,
      {} as any,
      extraction,
      [],
      undefined,
      blackboard,
      controller.signal,
    )

    expect(result).toBeNull()
  })

  it("handles malformed JSON gracefully with fallback", async () => {
    const agentA = makeAgent("a", "甲")
    const agents = [agentA]
    const node = makeNode()
    const state = makeState(agents)
    const extraction = makeExtraction()
    const blackboard = createSimulationBlackboard({ agents })

    mockRun = vi.fn().mockResolvedValue({
      toolCalls: [],
      roundsUsed: 1,
      finalText: "这不是有效的JSON格式",
    })

    const result = await agentDecideAndActWithReact(
      agentA,
      node,
      state,
      {} as any,
      extraction,
      [],
      undefined,
      blackboard,
    )

    expect(result).not.toBeNull()
    expect(result!.parsed.action.type).toBe("observe")
  })

  it("passes injectionEvent and modeHint to user message", async () => {
    const agentA = makeAgent("a", "甲")
    const agents = [agentA]
    const node = makeNode()
    const state = makeState(agents)
    const extraction = makeExtraction()
    const blackboard = createSimulationBlackboard({ agents })

    mockRun = vi.fn().mockResolvedValue({
      toolCalls: [],
      roundsUsed: 1,
      finalText: JSON.stringify({
        type: "observe",
        content: "观察周围",
        visibility: "self",
      }),
    })

    await agentDecideAndActWithReact(
      agentA,
      node,
      state,
      {} as any,
      extraction,
      [],
      "突发地震",
      blackboard,
      undefined,
      "主动出击",
    )

    expect(mockRun).toHaveBeenCalledTimes(1)
    const callArgs = mockRun.mock.calls[0]
    const messages = callArgs[2]
    const userMessage = messages.find((m: any) => m.role === "user")
    expect(userMessage.content).toContain("突发地震")
    expect(userMessage.content).toContain("主动出击")
  })
})
