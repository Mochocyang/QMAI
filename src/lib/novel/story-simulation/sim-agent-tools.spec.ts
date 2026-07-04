import { describe, expect, it } from "vitest"
import type { NovelAgent, TimelineEvent } from "@/lib/novel/story-simulation/types"
import {
  createSimulationBlackboard,
  recordBlackboardEvent,
  type SimulationBlackboard,
} from "@/lib/novel/story-simulation/multi-agent-orchestrator"
import { createSimAgentTools } from "@/lib/novel/story-simulation/sim-agent-tools"

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

function makeTimelineEvent(
  id: string,
  round: number,
  actorId: string,
  actorName: string,
  observableBy: string[],
  content: string,
): TimelineEvent {
  return {
    id,
    round,
    nodeIndex: 0,
    actorId,
    actorName,
    actionType: "speak",
    content,
    observableBy,
    impacts: [],
    timestamp: "2026-07-04T00:00:00.000Z",
  }
}

function setupTwoAgents(): {
  agentA: NovelAgent
  agentB: NovelAgent
  blackboard: SimulationBlackboard
} {
  const agentA = makeAgent("a", "甲")
  const agentB = makeAgent("b", "乙")
  const blackboard = createSimulationBlackboard({ agents: [agentA, agentB] })
  return { agentA, agentB, blackboard }
}

describe("createSimAgentTools", () => {
  it("creates a registry with 5 tools", () => {
    const { agentA, blackboard } = setupTwoAgents()
    const registry = createSimAgentTools(agentA, blackboard)
    expect(registry.has("recall")).toBe(true)
    expect(registry.has("observe")).toBe(true)
    expect(registry.has("inquire")).toBe(true)
    expect(registry.has("introspect")).toBe(true)
    expect(registry.has("investigate")).toBe(true)
    expect(registry.list().length).toBe(5)
  })
})

describe("recall tool", () => {
  it("returns visible events for the agent", async () => {
    const { agentA, blackboard } = setupTwoAgents()

    const event1 = makeTimelineEvent("e1", 0, "b", "乙", ["a", "b"], "你好甲")
    const event2 = makeTimelineEvent("e2", 0, "a", "甲", ["a", "b"], "你好乙")
    const event3 = makeTimelineEvent("e3", 0, "b", "乙", ["b"], "我私下想")

    recordBlackboardEvent(blackboard, event1)
    recordBlackboardEvent(blackboard, event2)
    recordBlackboardEvent(blackboard, event3)

    const registry = createSimAgentTools(agentA, blackboard)
    const tool = registry.get("recall")!
    const result = await tool.execute({})

    expect(result).toContain("乙")
    expect(result).toContain("你好甲")
    expect(result).toContain("你好乙")
    expect(result).not.toContain("我私下想")
  })

  it("respects the limit parameter", async () => {
    const { agentA, blackboard } = setupTwoAgents()

    for (let i = 0; i < 10; i++) {
      const evt = makeTimelineEvent(`e${i}`, 0, "b", "乙", ["a", "b"], `事件${i}`)
      recordBlackboardEvent(blackboard, evt)
    }

    const registry = createSimAgentTools(agentA, blackboard)
    const tool = registry.get("recall")!
    const result = await tool.execute({ limit: 3 })

    const lines = result.split("\n").filter((l) => l.startsWith("- "))
    expect(lines.length).toBe(3)
  })

  it("returns empty message when no events", async () => {
    const { agentA, blackboard } = setupTwoAgents()
    const registry = createSimAgentTools(agentA, blackboard)
    const tool = registry.get("recall")!
    const result = await tool.execute({})

    expect(result).toContain("暂无可见事件")
  })
})

describe("observe tool", () => {
  it("returns public events from current round excluding self", async () => {
    const { agentA, blackboard } = setupTwoAgents()

    const round0Public = makeTimelineEvent("e1", 0, "b", "乙", ["a", "b"], "公开言论")
    const round0Self = makeTimelineEvent("e2", 0, "a", "甲", ["a", "b"], "自己说的话")
    const round1Public = makeTimelineEvent("e3", 1, "b", "乙", ["a", "b"], "下一轮的话")

    recordBlackboardEvent(blackboard, round0Public)
    recordBlackboardEvent(blackboard, round0Self)
    recordBlackboardEvent(blackboard, round1Public)

    const registry = createSimAgentTools(agentA, blackboard)
    const tool = registry.get("observe")!
    const result = await tool.execute({})

    expect(result).toContain("公开言论")
    expect(result).not.toContain("自己说的话")
    expect(result).not.toContain("下一轮的话")
  })

  it("returns empty when no public events in current round", async () => {
    const { agentA, blackboard } = setupTwoAgents()
    const registry = createSimAgentTools(agentA, blackboard)
    const tool = registry.get("observe")!
    const result = await tool.execute({})

    expect(result).toContain("暂无可见事件")
  })
})

describe("inquire tool", () => {
  it("writes an event to the blackboard targeted at another agent", async () => {
    const { agentA, blackboard } = setupTwoAgents()
    const registry = createSimAgentTools(agentA, blackboard)
    const tool = registry.get("inquire")!

    const beforeCount = blackboard.events.length
    const result = await tool.execute({ target: "乙", question: "你今天好吗？" })

    expect(result).toContain("乙")
    expect(result).toContain("你今天好吗？")
    expect(blackboard.events.length).toBe(beforeCount + 1)

    const lastEvent = blackboard.events[blackboard.events.length - 1]
    expect(lastEvent.actorId).toBe("a")
    expect(lastEvent.actorName).toBe("甲")
    expect(lastEvent.targetName).toBe("乙")
    expect(lastEvent.content).toBe("你今天好吗？")
    expect(lastEvent.observableBy).toContain("a")
    expect(lastEvent.observableBy).toContain("b")
  })

  it("returns error when target or question is missing", async () => {
    const { agentA, blackboard } = setupTwoAgents()
    const registry = createSimAgentTools(agentA, blackboard)
    const tool = registry.get("inquire")!

    const result1 = await tool.execute({ target: "乙" })
    expect(result1).toContain("错误")

    const result2 = await tool.execute({ question: "你好" })
    expect(result2).toContain("错误")
  })
})

describe("introspect tool", () => {
  it("returns the agent's internal state", async () => {
    const agent = makeAgent("a", "甲")
    agent.currentGoal = "寻找真相"
    agent.emotionalState = "curious"
    agent.personality = ["机智", "冷静"]
    agent.speakingStyle = "简洁明了"
    agent.knowledgeScope = ["知道一些秘密"]
    agent.memory.recentDecisions = ["决定调查"]

    const blackboard = createSimulationBlackboard({ agents: [agent] })
    const registry = createSimAgentTools(agent, blackboard)
    const tool = registry.get("introspect")!
    const result = await tool.execute({})

    expect(result).toContain("内心审视")
    expect(result).toContain("寻找真相")
    expect(result).toContain("curious")
    expect(result).toContain("机智")
    expect(result).toContain("简洁明了")
    expect(result).toContain("知道一些秘密")
    expect(result).toContain("决定调查")
  })

  it("includes sentiments toward other agents", async () => {
    const agentA = makeAgent("a", "甲")
    const agentB = makeAgent("b", "乙")
    agentA.memory.sentiments.set("b", 20)

    const blackboard = createSimulationBlackboard({ agents: [agentA, agentB] })
    const registry = createSimAgentTools(agentA, blackboard)
    const tool = registry.get("introspect")!
    const result = await tool.execute({})

    expect(result).toContain("对他人的情感")
    expect(result).toContain("20")
  })
})
