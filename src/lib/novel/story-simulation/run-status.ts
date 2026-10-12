/**
 * 推演过程的状态汇总（P2-1：「推演过程常驻状态条」）。
 *
 * 推演跑到一半时，界面只有一条百分比进度条和一行文案，看不出「现在在哪个节点、
 * 第几轮、产生了多少事件、花了多少次调用」。这些数据其实一直都在
 * `onDebugTrace` 的记录里，只是没被汇总出来。
 *
 * 做成纯函数：既能直接断言，也不必去渲染那个内联在 2900 行 view 里的面板。
 */

import type {
  SimulationDebugTrace,
  StoryFramework,
  TimelineEvent,
} from "./types"

export interface RunStatus {
  /** 当前节点标题 */
  nodeTitle: string
  /** 当前节点序号（1 基，供展示） */
  nodeNumber: number
  /** 框架里的节点总数；框架缺失时为 null */
  totalNodes: number | null
  /** 当前轮次（1 基，供展示） */
  round: number
  /** 已发生的事件数 */
  eventCount: number
  /** 已发生的角色决策次数 */
  decisionCount: number
}

/**
 * 汇总当前推演进度。没有任何轨迹时返回 null —— 那说明推演还没真正开始，
 * 此时显示「节点 1 第 1 轮」是编的。
 */
export function summarizeRunStatus(input: {
  debugTraces: SimulationDebugTrace[] | undefined
  framework: StoryFramework | null | undefined
  events: TimelineEvent[]
}): RunStatus | null {
  const traces = input.debugTraces ?? []
  if (traces.length === 0) return null

  const lastTrace = traces[traces.length - 1]
  const nodeIndex = lastTrace.nodeIndex

  // 标题优先用框架里的（权威），轨迹自带的是兜底 —— 只跑过部分节点、
  // 或框架被重新生成过时，轨迹里的标题可能已经过时。
  const frameworkNode = input.framework?.nodes.find((n) => n.index === nodeIndex)
  const nodeTitle = frameworkNode?.title || lastTrace.nodeTitle || `节点${nodeIndex + 1}`

  let decisionCount = 0
  for (const trace of traces) {
    if (trace.type !== "round-plan") continue
    decisionCount += trace.selectedAgents?.length ?? 0
  }

  return {
    nodeTitle,
    nodeNumber: nodeIndex + 1,
    totalNodes: input.framework ? input.framework.nodes.length : null,
    round: lastTrace.round + 1,
    eventCount: input.events.length,
    decisionCount,
  }
}
