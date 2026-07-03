import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import type {
  ModeConfig,
  NovelAgent,
  SimulationState,
  StoryNode,
  TimelineEvent,
} from "@/lib/novel/story-simulation/types"
import {
  createSimulationBlackboard,
  createBlackboardDebugTrace,
  getBlackboardVisibleEvents,
  planMultiAgentRound,
  recordBlackboardEvent,
  selectNodeAgentCandidates,
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

function makeTimelineEvent(
  id: string,
  observableBy: string[],
): TimelineEvent {
  return {
    id,
    round: 0,
    nodeIndex: 0,
    actorId: "a",
    actorName: "甲",
    actionType: "speak",
    content: id,
    observableBy,
    impacts: [],
    timestamp: "2026-07-03T00:00:00.000Z",
  }
}

function makeNode(): StoryNode {
  return {
    index: 0,
    phase: "起",
    title: "开端",
    coreConflict: "冲突",
    involvedCharacters: ["甲", "乙", "丙"],
    goal: "推进剧情",
    causeFromPrev: "无",
    expectedOutcome: "完成开端",
  }
}

function makeModeConfig(agentSubsetRatio: number): ModeConfig {
  return {
    roundsMultiplier: 1,
    behaviorHint: "",
    randomEventChance: 0,
    agentSubsetRatio,
    strictNodeProgression: true,
  }
}

function makeState(agents: NovelAgent[]): SimulationState {
  return {
    currentRound: 0,
    timelineEvents: [],
    activeAgents: new Map(agents.map((agent) => [agent.characterId, agent])),
    worldState: {},
  }
}

describe("createSimulationBlackboard", () => {
  it("indexes active agents and initial timeline events by visibility", () => {
    const agents = [makeAgent("a", "甲"), makeAgent("b", "乙"), makeAgent("c", "丙")]
    const publicEvent = makeTimelineEvent("public", ["a", "b", "c"])
    const privateEvent = makeTimelineEvent("private", ["a", "b"])

    const blackboard = createSimulationBlackboard({
      agents,
      timelineEvents: [publicEvent, privateEvent],
    })

    expect([...blackboard.activeAgents.keys()]).toEqual(["a", "b", "c"])
    expect(blackboard.events.map((event) => event.id)).toEqual(["public", "private"])
    expect(blackboard.publicEvents.map((event) => event.id)).toEqual(["public"])
    expect(blackboard.visibleEventsByAgent.get("a")?.map((event) => event.id)).toEqual([
      "public",
      "private",
    ])
    expect(blackboard.visibleEventsByAgent.get("c")?.map((event) => event.id)).toEqual([
      "public",
    ])
  })

  it("keeps the full agent roster separate from the current active agents", () => {
    const agents = [makeAgent("a", "甲"), makeAgent("b", "乙"), makeAgent("c", "丙")]

    const blackboard = createSimulationBlackboard({ agents })
    blackboard.activeAgents = new Map([["a", agents[0]]])

    expect([...blackboard.allAgents.keys()]).toEqual(["a", "b", "c"])
    expect([...blackboard.activeAgents.keys()]).toEqual(["a"])
  })

  it("records later events into shared and per-agent blackboard state", () => {
    const agents = [makeAgent("a", "甲"), makeAgent("b", "乙")]
    const blackboard = createSimulationBlackboard({ agents })
    const event = makeTimelineEvent("later", ["b"])

    recordBlackboardEvent(blackboard, event)

    expect(blackboard.events.map((item) => item.id)).toEqual(["later"])
    expect(blackboard.publicEvents).toEqual([])
    expect(blackboard.visibleEventsByAgent.get("a")).toEqual([])
    expect(blackboard.visibleEventsByAgent.get("b")?.map((item) => item.id)).toEqual([
      "later",
    ])
  })
})

describe("selectNodeAgentCandidates", () => {
  it("selects node participants from the full agent roster instead of current active agents", () => {
    const agents = [makeAgent("a", "甲"), makeAgent("b", "乙"), makeAgent("c", "丙")]
    const blackboard = createSimulationBlackboard({ agents })
    blackboard.activeAgents = new Map([["a", agents[0]]])
    const node = {
      ...makeNode(),
      involvedCharacters: ["丙"],
    }

    const candidates = selectNodeAgentCandidates(blackboard, node)

    expect(candidates.map((agent) => agent.characterId)).toEqual(["c"])
  })

  it("falls back to all agents when a node does not match any participant names", () => {
    const agents = [makeAgent("a", "甲"), makeAgent("b", "乙")]
    const blackboard = createSimulationBlackboard({ agents })
    const node = {
      ...makeNode(),
      involvedCharacters: ["不存在的人"],
    }

    const candidates = selectNodeAgentCandidates(blackboard, node)

    expect(candidates.map((agent) => agent.characterId)).toEqual(["a", "b"])
  })
})

describe("getBlackboardVisibleEvents", () => {
  it("returns only events visible to the requested agent", () => {
    const agents = [makeAgent("a", "甲"), makeAgent("b", "乙")]
    const visible = makeTimelineEvent("visible", ["a"])
    const hidden = makeTimelineEvent("hidden", ["b"])
    const blackboard = createSimulationBlackboard({
      agents,
      timelineEvents: [visible, hidden],
    })

    expect(getBlackboardVisibleEvents(blackboard, "a").map((event) => event.id)).toEqual([
      "visible",
    ])
  })

  it("keeps the newest visible events when a limit is provided", () => {
    const agents = [makeAgent("a", "甲")]
    const blackboard = createSimulationBlackboard({
      agents,
      timelineEvents: [
        makeTimelineEvent("old", ["a"]),
        makeTimelineEvent("middle", ["a"]),
        makeTimelineEvent("new", ["a"]),
      ],
    })

    expect(getBlackboardVisibleEvents(blackboard, "a", 2).map((event) => event.id)).toEqual([
      "middle",
      "new",
    ])
  })
})

describe("createBlackboardDebugTrace", () => {
  it("summarizes round planning and blackboard visibility without exposing mutable maps", () => {
    const agents = [makeAgent("a", "甲"), makeAgent("b", "乙"), makeAgent("c", "丙")]
    const publicEvent = makeTimelineEvent("public", ["a", "b", "c"])
    const privateEvent = makeTimelineEvent("private", ["a", "b"])
    const blackboard = createSimulationBlackboard({
      agents,
      timelineEvents: [publicEvent, privateEvent],
    })
    const node = makeNode()
    const plan = planMultiAgentRound({
      node,
      state: makeState(agents),
      candidateAgents: [agents[0], agents[2]],
      modeConfig: makeModeConfig(1),
      round: 1,
    })

    const trace = createBlackboardDebugTrace(blackboard, {
      type: "round-plan",
      node,
      round: 1,
      candidateAgents: [agents[0], agents[2]],
      plan,
      timestamp: "2026-07-03T01:00:00.000Z",
    })

    expect(trace.type).toBe("round-plan")
    expect(trace.nodeIndex).toBe(0)
    expect(trace.nodeTitle).toBe("开端")
    expect(trace.round).toBe(1)
    expect(trace.strategy).toBe("all-agents")
    expect(trace.blackboard).toEqual({
      allAgentCount: 3,
      activeAgentCount: 3,
      totalEventCount: 2,
      publicEventCount: 1,
    })
    expect(trace.candidateAgents.map((agent) => agent.agentId)).toEqual(["a", "c"])
    expect(trace.selectedAgents.map((agent) => agent.agentId)).toEqual(["a", "c"])
    expect(trace.selectedAgents[0].reason).toBe("模式要求全部角色参与")
    expect(trace.visibilityByAgent.find((agent) => agent.agentId === "a")).toMatchObject({
      agentName: "甲",
      visibleEventCount: 2,
    })
    expect(
      trace.visibilityByAgent.find((agent) => agent.agentId === "c")!.recentEvents!.map(
        (event) => event.id,
      ),
    ).toEqual(["public"])
    expect(Object.prototype.hasOwnProperty.call(trace, "activeAgents")).toBe(false)
  })

  it("limits each agent recent visible event summaries to the newest events", () => {
    const agents = [makeAgent("a", "甲")]
    const blackboard = createSimulationBlackboard({
      agents,
      timelineEvents: [
        makeTimelineEvent("old", ["a"]),
        makeTimelineEvent("middle", ["a"]),
        makeTimelineEvent("new", ["a"]),
      ],
    })

    const trace = createBlackboardDebugTrace(blackboard, {
      type: "event-recorded",
      node: makeNode(),
      round: 0,
      latestEvent: makeTimelineEvent("new", ["a"]),
      visibleEventLimit: 2,
      timestamp: "2026-07-03T01:00:00.000Z",
    })

    expect(trace.latestEvent?.id).toBe("new")
    expect(trace.visibilityByAgent[0].recentEvents!.map((event) => event.id)).toEqual([
      "middle",
      "new",
    ])
  })
})

describe("planMultiAgentRound", () => {
  it("schedules all candidate agents in order when the mode uses the full agent set", () => {
    const agents = [makeAgent("a", "甲"), makeAgent("b", "乙"), makeAgent("c", "丙")]

    const plan = planMultiAgentRound({
      node: makeNode(),
      state: makeState(agents),
      candidateAgents: agents,
      modeConfig: makeModeConfig(1),
      round: 2,
    })

    expect(plan.round).toBe(2)
    expect(plan.nodeIndex).toBe(0)
    expect(plan.turns.map((turn) => turn.agentId)).toEqual(["a", "b", "c"])
    expect(plan.turns.map((turn) => turn.agentName)).toEqual(["甲", "乙", "丙"])
  })

  it("schedules only a mode-sized subset when the mode uses partial agents", () => {
    const agents = [makeAgent("a", "甲"), makeAgent("b", "乙"), makeAgent("c", "丙")]

    const plan = planMultiAgentRound({
      node: makeNode(),
      state: makeState(agents),
      candidateAgents: agents,
      modeConfig: makeModeConfig(0.5),
      round: 0,
      random: () => 0.9,
    })

    expect(plan.turns).toHaveLength(2)
    expect(plan.turns.every((turn) => ["a", "b", "c"].includes(turn.agentId))).toBe(true)
  })

  it("returns an empty plan when there are no candidate agents", () => {
    const plan = planMultiAgentRound({
      node: makeNode(),
      state: makeState([]),
      candidateAgents: [],
      modeConfig: makeModeConfig(1),
      round: 0,
    })

    expect(plan.turns).toEqual([])
  })
})

describe("simulation-engine integration", () => {
  it("delegates round planning and blackboard recording to the orchestrator module", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/novel/story-simulation/simulation-engine.ts"),
      "utf8",
    )

    expect(source).toContain("planMultiAgentRound")
    expect(source).toContain("recordBlackboardEvent")
    expect(source).toContain("selectNodeAgentCandidates")
    expect(source).toContain("getBlackboardVisibleEvents")
    expect(source).toContain("createBlackboardDebugTrace")
    expect(source).toContain("onDebugTrace?:")
    expect(source).toContain("callbacks.onDebugTrace?.")
    expect(source).not.toContain("Math.random() - 0.5")
    expect(source).not.toContain("state.timelineEvents,\n    10,")
  })
})
