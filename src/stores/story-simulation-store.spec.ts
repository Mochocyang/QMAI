import { beforeEach, describe, expect, it } from "vitest"

import { useStorySimulationStore } from "./story-simulation-store"
import type { SimulationDebugTrace } from "@/lib/novel/story-simulation/types"

function makeTrace(id: string): SimulationDebugTrace {
  return {
    id,
    type: "round-plan",
    nodeIndex: 0,
    nodeTitle: "开端",
    round: 0,
    strategy: "all-agents",
    candidateAgents: [{ agentId: "a", agentName: "甲" }],
    selectedAgents: [{ agentId: "a", agentName: "甲", reason: "模式要求全部角色参与" }],
    blackboard: {
      allAgentCount: 1,
      activeAgentCount: 1,
      totalEventCount: 0,
      publicEventCount: 0,
    },
    visibilityByAgent: [
      {
        agentId: "a",
        agentName: "甲",
        visibleEventCount: 0,
        recentEvents: [],
      },
    ],
    timestamp: "2026-07-03T00:00:00.000Z",
  }
}

describe("story simulation store debug traces", () => {
  beforeEach(() => {
    useStorySimulationStore.setState({
      debugTraces: [],
      timelineEvents: [],
      phase: "idle",
    })
  })

  it("stores simulation debug traces in insertion order", () => {
    const first = makeTrace("trace-1")
    const second = makeTrace("trace-2")

    useStorySimulationStore.getState().setDebugTraces([first])
    useStorySimulationStore.getState().addDebugTrace(second)

    expect(useStorySimulationStore.getState().debugTraces.map((trace) => trace.id)).toEqual([
      "trace-1",
      "trace-2",
    ])
  })

  it("clears simulation debug traces when resetting the story simulation state", () => {
    useStorySimulationStore.getState().addDebugTrace(makeTrace("trace-1"))

    useStorySimulationStore.getState().reset()

    expect(useStorySimulationStore.getState().debugTraces).toEqual([])
  })
})
