import { describe, expect, it } from "vitest"
import { summarizeRunStatus } from "@/lib/novel/story-simulation/run-status"
import type {
  SimulationDebugTrace,
  StoryFramework,
  TimelineEvent,
} from "@/lib/novel/story-simulation/types"

function framework(nodeCount: number): StoryFramework {
  return {
    id: "fw",
    title: "测试框架",
    premise: "测试",
    targetWords: 10000,
    simulationMode: "hybrid",
    sourceChapters: 1,
    createdAt: "2026-07-06T00:00:00.000Z",
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      index: i,
      phase: "起",
      title: `节点${i + 1}`,
      coreConflict: "冲突",
      involvedCharacters: ["甲"],
      goal: "推进",
      causeFromPrev: "无",
      expectedOutcome: "完成",
    })),
  }
}

function trace(
  nodeIndex: number,
  nodeTitle: string,
  round: number,
  selectedCount: number,
  type: SimulationDebugTrace["type"] = "round-plan",
): SimulationDebugTrace {
  return {
    id: `t${nodeIndex}-${round}-${type}`,
    type,
    nodeIndex,
    nodeTitle,
    round,
    candidateAgents: [],
    selectedAgents: Array.from({ length: selectedCount }, (_, i) => ({
      agentId: `a${i}`,
      name: `角色${i}`,
    })) as never,
    blackboard: {
      allAgentCount: selectedCount,
      activeAgentCount: selectedCount,
      totalEventCount: 0,
      publicEventCount: 0,
      rumorCount: 0,
    },
    visibilityByAgent: [],
    rumors: [],
    activeAgents: new Map(),
    timestamp: "2026-07-06T00:00:00.000Z",
  }
}

function event(nodeIndex: number): TimelineEvent {
  return {
    id: `e${nodeIndex}-${Math.random()}`,
    round: 0,
    nodeIndex,
    actorId: "a",
    actorName: "甲",
    actionType: "speak",
    content: "内容",
    observableBy: [],
    impacts: [],
    timestamp: "2026-07-06T00:00:00.000Z",
  }
}

/**
 * 推演过程此前只有一条百分比进度条和一行文案 —— 跑到一半时看不出「现在在哪
 * 个节点、第几轮、已经产生了多少事件、花了多少次调用」。数据其实一直都在
 * `onDebugTrace` 里，只是没被汇总出来展示。
 */
describe("summarizeRunStatus", () => {
  it("从最后一条轨迹取当前节点与轮次（1 基展示）", () => {
    const status = summarizeRunStatus({
      debugTraces: [
        trace(0, "节点1", 0, 5),
        trace(0, "节点1", 1, 5),
        trace(1, "节点2", 0, 3),
      ],
      framework: framework(3),
      events: [],
    })

    expect(status?.nodeTitle).toBe("节点2")
    expect(status?.nodeNumber).toBe(2)
    expect(status?.totalNodes).toBe(3)
    expect(status?.round).toBe(1)
  })

  it("统计已发生事件数与角色决策次数", () => {
    const status = summarizeRunStatus({
      debugTraces: [trace(0, "节点1", 0, 5), trace(0, "节点1", 1, 3)],
      framework: framework(3),
      events: [event(0), event(0), event(0)],
    })

    expect(status?.eventCount).toBe(3)
    expect(status?.decisionCount).toBe(8)
  })

  it("只数 round-plan 轨迹，避免把同一轮算成两倍", () => {
    const status = summarizeRunStatus({
      debugTraces: [
        trace(0, "节点1", 0, 5),
        trace(0, "节点1", 0, 5, "event-recorded"),
      ],
      framework: framework(1),
      events: [],
    })

    expect(status?.decisionCount).toBe(5)
  })

  it("还没有任何轨迹时返回 null（推演尚未真正开始）", () => {
    expect(
      summarizeRunStatus({ debugTraces: [], framework: framework(3), events: [] }),
    ).toBeNull()
  })

  it("没有框架信息时仍能给出轮次与计数（不因为缺框架就整条不显示）", () => {
    const status = summarizeRunStatus({
      debugTraces: [trace(0, "节点1", 2, 4)],
      framework: null,
      events: [event(0)],
    })

    expect(status).not.toBeNull()
    expect(status?.round).toBe(3)
    expect(status?.decisionCount).toBe(4)
    // 节点序号在缺框架时用轨迹自带的 index 兜底
    expect(status?.nodeNumber).toBe(1)
    expect(status?.totalNodes).toBeNull()
  })

  it("框架里查不到该节点时用轨迹自带的标题兜底", () => {
    const status = summarizeRunStatus({
      debugTraces: [trace(9, "节点X", 0, 1)],
      framework: framework(2),
      events: [],
    })

    expect(status?.nodeTitle).toBe("节点X")
    expect(status?.nodeNumber).toBe(10)
  })
})
