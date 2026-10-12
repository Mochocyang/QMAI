/**
 * 「最近」时间线 —— 把剧情推演室的三类历史合并成一条列表。
 *
 * 为什么需要它：改造前，剧推室的左侧栏（`StorySimulationSidebarPanel`）里有一份
 * 「故事框架」列表 + 「历史推演结果」列表，这是用户回到上次工作的唯一入口。
 * 那个左栏因为「双栏结构不合理」被删掉了（见 `full-window-views.ts`），
 * 于是「继续上次」的能力也跟着没了 —— 本模块 + 落地页的「最近」区块把它补回来，
 * 并且仍然满足整窗单栏。
 *
 * 三类数据来自**三个各自独立的存储**，格式与排序依据都不一样：
 * - 故事框架：`framework-store.loadFrameworks()`，按 `createdAt` 降序
 * - 舞台情景：`scenario-store.loadScenarios()`，按 `updatedAt` 降序
 * - 推演结果：`framework-store.loadLatestSimulationResult()`，按文件名（时间戳）降序
 *
 * 所以这里不能简单地拼接，必须重新按时间归并排序。抽成不依赖 React 的纯函数，
 * 是为了让这条归并规则**可被行为测试**（`recent-activity.spec.ts`）。
 */

import type { ScenarioSession } from "./scenario-types"
import type { StoryFramework } from "./types"

export type RecentActivityKind = "framework" | "scenario" | "result"

export interface RecentActivityItem {
  kind: RecentActivityKind
  id: string
  /**
   * 结果所属的框架 id（只有 `kind === "result"` 有值）。
   * 点击结果时要先把对应框架设为当前框架，报告页才有上下文。
   */
  frameworkId?: string
  /** 可能为空串（没有标题时）；展示层的兜底文案由 UI 决定。 */
  title: string
  /** ISO 时间字符串，用于排序与展示。 */
  time: string
  /** 框架：剧情节点数。 */
  nodeCount?: number
  /** 情景：已生成的发言条数。 */
  messageCount?: number
}

/**
 * 一条推演结果的最小输入。
 *
 * 只带展示与定位所需字段；**完整结果对象由调用方自己留**，点击时用它重放
 * 报告页（反序列化 agent 快照等），这样这里不必依赖 store 的类型。
 */
export interface RecentResultInput {
  frameworkId: string
  resultId: string
  /** 结果标题，通常取 `report.recommendation`。 */
  title: string
  createdAt: string
}

export interface RecentActivityInput {
  frameworks?: readonly StoryFramework[]
  scenarios?: readonly ScenarioSession[]
  /**
   * 推演结果。⚠️ 调用方**必须**先把扫描范围压下来（见落地页里的框架数上限）——
   * 结果的读取成本远高于框架/情景。
   */
  results?: readonly RecentResultInput[]
  /** 截断条数；`<= 0` 表示不截断。默认 `RECENT_ACTIVITY_LIMIT`。 */
  limit?: number
}

/** 落地页最多展示几条。 */
export const RECENT_ACTIVITY_LIMIT = 5

/**
 * 时间戳解析。解析不出来的一律排到最后，而不是当成 0（1970）——
 * 否则一个坏时间戳会挤掉所有正常记录。
 */
function toTimestamp(iso: string | undefined): number {
  const parsed = Date.parse(iso ?? "")
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

/**
 * 归并三类历史，按时间降序取前 `limit` 条。
 */
export function buildRecentActivity({
  frameworks = [],
  scenarios = [],
  results = [],
  limit = RECENT_ACTIVITY_LIMIT,
}: RecentActivityInput = {}): RecentActivityItem[] {
  const items: RecentActivityItem[] = [
    ...frameworks.map((framework) => ({
      kind: "framework" as const,
      id: framework.id,
      title: framework.title?.trim() || framework.shortTitle?.trim() || "",
      time: framework.createdAt,
      nodeCount: framework.nodes?.length ?? 0,
    })),
    ...scenarios.map((session) => ({
      kind: "scenario" as const,
      id: session.id,
      title: session.title?.trim() || "",
      time: session.updatedAt || session.createdAt,
      messageCount: session.messages?.length ?? 0,
    })),
    ...results.map((result) => ({
      kind: "result" as const,
      id: result.resultId,
      frameworkId: result.frameworkId,
      title: result.title?.trim() || "",
      time: result.createdAt,
    })),
  ]

  // 时间降序。Array.prototype.sort 在现代引擎里是稳定的，
  // 所以时间完全相同时保持「框架 → 情景 → 结果」的插入顺序，不会随机跳动。
  items.sort((a, b) => toTimestamp(b.time) - toTimestamp(a.time))

  return limit > 0 ? items.slice(0, limit) : items
}
