/**
 * 历史结果列表的摘要（P2-3：「历史结果列表做成一等公民」）。
 *
 * 原先列表只显示时间、摘要前 40 字和一个「草稿」标签 —— 用户没法在列表层面
 * 比较几次推演。这里把「分支数、角色数、实际发生的角色决策次数、导演均分、
 * 是否已有草稿」一并算出来，让列表本身就能承担比较的职责。
 *
 * 做成纯函数是为了能直接断言，不必去渲染 2897 行的 view 或走真实磁盘读取。
 */

import type { DirectorEvaluation, SimulationDebugTrace } from "./types"
import type { SimulationResultRecord } from "./framework-store"

/**
 * 导演评分的平均值，保留一位小数（与 `calculateBranchScore` 口径一致）。
 *
 * 没有评估时返回 **null 而不是 3.0**：分支评分拿 3.0 当兜底是合理的（要算总分），
 * 但摆进历史列表会被读成「这次推演导演打了 3.0 分」，而事实是导演根本没启用。
 * 「没有数据」和「中性评价」必须能区分，这正是本分支在修的那类问题。
 */
export function averageDirectorScore(
  evaluations: DirectorEvaluation[],
): number | null {
  if (evaluations.length === 0) return null
  const sum = evaluations.reduce((acc, e) => acc + e.totalScore, 0)
  return Math.round((sum / evaluations.length) * 10) / 10
}

/**
 * 实际发生的角色决策次数 = 每轮参与 agent 数之和。
 *
 * 只数 `round-plan` 轨迹：`event-recorded` 记的是同一轮的另一件事，
 * 两边都数会把每轮算成两倍。
 */
export function countAgentDecisions(
  traces: SimulationDebugTrace[] | undefined,
): number {
  if (!traces || traces.length === 0) return 0
  let total = 0
  for (const trace of traces) {
    if (trace.type !== "round-plan") continue
    total += trace.selectedAgents?.length ?? 0
  }
  return total
}

export interface SimulationResultSummary {
  branchCount: number
  characterCount: number
  /** 角色决策次数（不含报告与草稿的调用） */
  decisionCount: number
  /** 导演均分；未启用导演或旧存档为 null */
  directorAverageScore: number | null
  /** 参与均值的导演评估次数（0 表示未启用或旧存档） */
  directorEvaluationCount: number
  hasDraft: boolean
}

export function summarizeSimulationResult(
  record: SimulationResultRecord,
): SimulationResultSummary {
  return {
    branchCount: record.report.branches.length,
    characterCount: record.report.characterAnalyses.length,
    decisionCount: countAgentDecisions(record.debugTraces),
    directorAverageScore: record.report.directorAverageScore ?? null,
    directorEvaluationCount: record.report.directorEvaluationCount ?? 0,
    hasDraft: !!record.draft,
  }
}
