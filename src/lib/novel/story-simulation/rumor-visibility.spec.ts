import { describe, expect, it } from "vitest"

import type { NovelAgent, RumorEvent } from "@/lib/novel/story-simulation/types"
import {
  createSimulationBlackboard,
  getBlackboardVisibleRumors,
  recordRumorEvent,
} from "@/lib/novel/story-simulation/multi-agent-orchestrator"

function makeAgent(id: string, name: string): NovelAgent {
  return {
    characterId: id,
    name,
    profile: `${name} profile`,
    aura: null,
    cognition: null,
    soul: "",
    currentGoal: "完成当前节点目标",
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

function makeRumorEvent(id: string, observableBy: string[]): RumorEvent {
  return {
    id,
    round: 0,
    nodeIndex: 0,
    sourceId: null,
    content: id,
    distortion: 0.5,
    observableBy,
    believedBy: [],
    verifiedBy: [],
    timestamp: "2026-07-04T00:00:00.000Z",
  }
}

describe("recordRumorEvent", () => {
  it("writes rumor to blackboard and visibleRumorsByAgent", () => {
    const agents = [makeAgent("a", "甲"), makeAgent("b", "乙"), makeAgent("c", "丙")]
    const blackboard = createSimulationBlackboard({ agents })
    const rumor = makeRumorEvent("rumor-1", ["a", "b"])

    recordRumorEvent(blackboard, rumor)

    expect(blackboard.rumors.map((r) => r.id)).toEqual(["rumor-1"])
    expect(blackboard.visibleRumorsByAgent.get("a")?.map((r) => r.id)).toEqual(["rumor-1"])
    expect(blackboard.visibleRumorsByAgent.get("b")?.map((r) => r.id)).toEqual(["rumor-1"])
    expect(blackboard.visibleRumorsByAgent.get("c")).toEqual([])
  })

  it("initializes visibleRumorsByAgent for agents not in the map yet", () => {
    const agents = [makeAgent("a", "甲")]
    const blackboard = createSimulationBlackboard({ agents })
    const rumor = makeRumorEvent("rumor-1", ["b"])

    recordRumorEvent(blackboard, rumor)

    expect(blackboard.visibleRumorsByAgent.has("b")).toBe(true)
    expect(blackboard.visibleRumorsByAgent.get("b")?.map((r) => r.id)).toEqual(["rumor-1"])
  })
})

describe("getBlackboardVisibleRumors", () => {
  it("returns only rumors visible to the requested agent", () => {
    const agents = [makeAgent("a", "甲"), makeAgent("b", "乙")]
    const visible = makeRumorEvent("visible", ["a"])
    const hidden = makeRumorEvent("hidden", ["b"])
    const blackboard = createSimulationBlackboard({ agents })
    recordRumorEvent(blackboard, visible)
    recordRumorEvent(blackboard, hidden)

    expect(getBlackboardVisibleRumors(blackboard, "a").map((r) => r.id)).toEqual(["visible"])
  })

  it("returns empty array for agent with no visible rumors", () => {
    const agents = [makeAgent("a", "甲")]
    const blackboard = createSimulationBlackboard({ agents })

    expect(getBlackboardVisibleRumors(blackboard, "a")).toEqual([])
  })

  it("keeps the newest visible rumors when a limit is provided", () => {
    const agents = [makeAgent("a", "甲")]
    const blackboard = createSimulationBlackboard({ agents })
    recordRumorEvent(blackboard, makeRumorEvent("old", ["a"]))
    recordRumorEvent(blackboard, makeRumorEvent("middle", ["a"]))
    recordRumorEvent(blackboard, makeRumorEvent("new", ["a"]))

    expect(getBlackboardVisibleRumors(blackboard, "a", 2).map((r) => r.id)).toEqual([
      "middle",
      "new",
    ])
  })

  it("returns all visible rumors when limit is not provided or larger than count", () => {
    const agents = [makeAgent("a", "甲")]
    const blackboard = createSimulationBlackboard({ agents })
    recordRumorEvent(blackboard, makeRumorEvent("r1", ["a"]))
    recordRumorEvent(blackboard, makeRumorEvent("r2", ["a"]))

    expect(getBlackboardVisibleRumors(blackboard, "a")).toHaveLength(2)
    expect(getBlackboardVisibleRumors(blackboard, "a", 10)).toHaveLength(2)
  })

  it("认知边界：不在 observableBy 的角色看不到传闻", () => {
    const agents = [makeAgent("a", "甲"), makeAgent("b", "乙"), makeAgent("c", "丙")]
    const blackboard = createSimulationBlackboard({ agents })
    const secretRumor = makeRumorEvent("secret", ["a", "b"])
    recordRumorEvent(blackboard, secretRumor)

    const agentCRumors = getBlackboardVisibleRumors(blackboard, "c")
    expect(agentCRumors).toEqual([])
  })
})
