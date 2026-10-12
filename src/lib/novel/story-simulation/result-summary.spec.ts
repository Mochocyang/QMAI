import { describe, expect, it } from "vitest"
import {
  averageDirectorScore,
  countAgentDecisions,
  summarizeSimulationResult,
} from "@/lib/novel/story-simulation/result-summary"
import type {
  DirectorEvaluation,
  SimulationDebugTrace,
  SimulationReport,
} from "@/lib/novel/story-simulation/types"
import type { SimulationResultRecord } from "@/lib/novel/story-simulation/framework-store"

function evaluation(totalScore: number): DirectorEvaluation {
  return {
    scores: {
      tension: 4,
      pace: 4,
      characterUtilization: 4,
      characterArc: 4,
      infoDensity: 4,
      emotionalResonance: 4,
      logicConsistency: 4,
    },
    totalScore,
    highlights: [],
    issues: [],
    suggestion: "",
    shouldInjectEvent: false,
  }
}

function trace(selectedCount: number, type: SimulationDebugTrace["type"] = "round-plan"): SimulationDebugTrace {
  return {
    id: `t${Math.random()}`,
    type,
    nodeIndex: 0,
    nodeTitle: "开端",
    round: 0,
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

function report(overrides: Partial<SimulationReport> = {}): SimulationReport {
  return {
    frameworkId: "fw",
    mode: "hybrid",
    characterAnalyses: [],
    branches: [],
    recommendation: "推荐",
    createdAt: "2026-07-06T00:00:00.000Z",
    ...overrides,
  }
}

function record(overrides: Partial<SimulationResultRecord> = {}): SimulationResultRecord {
  return {
    id: "r1",
    report: report(),
    status: "complete",
    ...overrides,
  }
}

describe("averageDirectorScore", () => {
  it("没有评估时返回 null，而不是伪造一个中性分", () => {
    // 分支评分的兜底值 3.0 用于打分是合理的，但摆进历史列表会被读成
    // 「这次推演导演给了 3.0 分」，而事实是导演根本没跑。这里必须区分开。
    expect(averageDirectorScore([])).toBeNull()
  })

  it("取平均值并保留一位小数", () => {
    expect(averageDirectorScore([evaluation(4.0), evaluation(4.3)])).toBe(4.2)
    expect(averageDirectorScore([evaluation(3)])).toBe(3)
  })

  it("多位小数只保留一位（与分支评分口径一致）", () => {
    expect(averageDirectorScore([evaluation(4), evaluation(4), evaluation(5)])).toBe(4.3)
  })
})

describe("countAgentDecisions", () => {
  it("累加每轮实际参与的 agent 数 —— 这就是角色决策调用次数", () => {
    expect(countAgentDecisions([trace(5), trace(3), trace(4)])).toBe(12)
  })

  it("只统计 round-plan 轨迹，不把 event-recorded 重复计入", () => {
    expect(
      countAgentDecisions([trace(5, "round-plan"), trace(5, "event-recorded")]),
    ).toBe(5)
  })

  it("没有轨迹时返回 0（旧存档没有 debugTraces）", () => {
    expect(countAgentDecisions(undefined)).toBe(0)
    expect(countAgentDecisions([])).toBe(0)
  })
})

describe("summarizeSimulationResult", () => {
  it("汇总历史列表要展示的字段", () => {
    const summary = summarizeSimulationResult(
      record({
        report: report({
          characterAnalyses: [
            { characterId: "a", name: "甲", behaviors: [], stateChanges: [], consistencyScore: 80 },
            { characterId: "b", name: "乙", behaviors: [], stateChanges: [], consistencyScore: 70 },
          ],
          branches: [
            { title: "一", summary: "", keyEvents: [], probability: "high", pros: "", cons: "", recommendation: true },
            { title: "二", summary: "", keyEvents: [], probability: "low", pros: "", cons: "", recommendation: false },
          ],
          directorAverageScore: 4.2,
          directorEvaluationCount: 3,
        }),
        debugTraces: [trace(5), trace(5), trace(3)],
        draft: { branchId: "b", frameworkId: "fw", chapters: [], totalWords: 100, createdAt: "x" },
      }),
    )

    expect(summary.branchCount).toBe(2)
    expect(summary.characterCount).toBe(2)
    expect(summary.decisionCount).toBe(13)
    expect(summary.directorAverageScore).toBe(4.2)
    expect(summary.directorEvaluationCount).toBe(3)
    expect(summary.hasDraft).toBe(true)
  })

  it("没有导演数据时 directorAverageScore 为 null（旧存档与未启用导演）", () => {
    const summary = summarizeSimulationResult(record())

    expect(summary.directorAverageScore).toBeNull()
    expect(summary.hasDraft).toBe(false)
    expect(summary.decisionCount).toBe(0)
  })

  it("draft 为 null 与 undefined 都算「没有草稿」", () => {
    expect(summarizeSimulationResult(record({ draft: null })).hasDraft).toBe(false)
  })
})
