import { beforeEach, describe, expect, it } from "vitest"

import { useStorySimulationStore } from "./story-simulation-store"
import type {
  DirectorEvaluation,
  NovelAgent,
  SimulationDebugTrace,
  StoryFramework,
  TimelineEvent,
} from "@/lib/novel/story-simulation/types"

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
      rumorCount: 0,
    },
    visibilityByAgent: [
      {
        agentId: "a",
        agentName: "甲",
        visibleEventCount: 0,
        recentEvents: [],
      },
    ],
    rumors: [],
    activeAgents: new Map(),
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
    ],
  }
}

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

function makeTimelineEvent(): TimelineEvent {
  return {
    id: "event-1",
    round: 0,
    nodeIndex: 0,
    actorId: "a",
    actorName: "甲",
    actionType: "speak",
    content: "推进事件",
    observableBy: ["a"],
    impacts: [],
    timestamp: "2026-07-06T00:00:00.000Z",
  }
}

/**
 * totalScore 是 7 个维度的平均值（1-5），与 director-agent 的 calcTotalScore 一致。
 * 4.2 与无评估时的中性默认值 3.0 明显不同，便于断言真实评估已生效。
 */
function makeDirectorEvaluation(): DirectorEvaluation {
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
    totalScore: 4.2,
    highlights: ["张力充足"],
    issues: [],
    suggestion: "继续保持",
    shouldInjectEvent: false,
  }
}

describe("story simulation store director evaluations", () => {
  beforeEach(() => {
    useStorySimulationStore.setState({
      branches: [],
      activeBranchId: null,
      compareBranchIds: [],
      timelineEvents: [],
      directorEvaluations: [],
      currentAgents: new Map(),
      currentFramework: null,
    })
  })

  it("records director evaluations into the saved branch", () => {
    useStorySimulationStore.setState({
      currentFramework: makeFramework(),
      currentAgents: new Map([["a", makeAgent()]]),
      timelineEvents: [makeTimelineEvent()],
      directorEvaluations: [makeDirectorEvaluation()],
    })

    useStorySimulationStore.getState().saveCurrentAsBranch("分支A")

    const branch = useStorySimulationStore.getState().branches[0]
    expect(branch.directorEvaluations).toHaveLength(1)
    expect(branch.directorEvaluations[0].totalScore).toBe(4.2)
  })

  it("scores the branch from the director evaluations instead of the neutral default", () => {
    useStorySimulationStore.setState({
      currentFramework: makeFramework(),
      currentAgents: new Map([["a", makeAgent()]]),
      timelineEvents: [makeTimelineEvent()],
      directorEvaluations: [makeDirectorEvaluation()],
    })

    useStorySimulationStore.getState().saveCurrentAsBranch("分支A")

    const branch = useStorySimulationStore.getState().branches[0]
    // 4.2 来自真实评估；若导演评估未接通，这里会是中性默认值 3.0。
    expect(branch.scoreDetails.avgDirectorScore).toBe(4.2)
    expect(branch.overallScore).toBeGreaterThan(0)
  })

  it("accumulates director evaluations and clears them with the simulation state", () => {
    const store = useStorySimulationStore.getState()
    store.addDirectorEvaluation(makeDirectorEvaluation())
    store.addDirectorEvaluation(makeDirectorEvaluation())

    expect(useStorySimulationStore.getState().directorEvaluations).toHaveLength(2)

    useStorySimulationStore.getState().reset()

    expect(useStorySimulationStore.getState().directorEvaluations).toEqual([])
  })
})
