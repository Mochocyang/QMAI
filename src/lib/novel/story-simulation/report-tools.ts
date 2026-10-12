/**
 * 报告分析师的只读取证工具（P1-7）。
 *
 * 与 `sim-agent-tools.ts` **刻意分开**：那套是「角色视角」的，`recall` /
 * `observe` 只返回该角色可见的事件，语义绑定在扮演上。报告分析师要的是全局
 * 只读取证 —— 复用会污染角色工具语义，所以独立一套。
 *
 * 全部标为 `read`：报告阶段只是分析，不该有任何写副作用。
 *
 * 每条输出都逐字保留 `content`，因为报告的硬要求是引用 agent 原话，而引文要
 * 能被 `verifyEvidence` 校验通过 —— 只要工具输出的原话没被改写，模型照抄就能
 * 通过校验。工具与校验共用 `toReportRecords`，保证「查得到」与「算数」一致。
 */

import { ToolRegistry } from "@/lib/agent/registry"
import type { Tool } from "@/lib/agent/types"
import type { StoryNode, SimulationEvent } from "./types"
import { toReportRecords, type ReportRecord } from "./report-evidence"

const DEFAULT_QUERY_LIMIT = 30

function describeRecord(record: ReportRecord): string {
  const nodeLabel = record.nodeIndex >= 0 ? `节点${record.nodeIndex + 1}` : "未知节点"
  return `- [${nodeLabel} 第${record.round + 1}轮] ${record.actorName}：${record.content}`
}

function renderRecords(records: ReportRecord[]): string {
  if (records.length === 0) return "没有符合条件的事件记录。"
  return records.map(describeRecord).join("\n")
}

function asLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_QUERY_LIMIT
  return Math.min(Math.floor(n), 200)
}

function asNodeIndex(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * 节点筛选按** 1 基**（与 `list_nodes` 输出的「节点1、节点2」一致）转成内部 0 基索引。
 *
 * 这里刻意**不**同时接受 0 基：两种口径都收会让 `nodeIndex: 1` 同时命中第 1 和第 2
 * 个节点，静默多返回一堆无关事件 —— 对取证工具来说，宁可查空让模型改用
 * `list_nodes` 确认序号，也不要悄悄给错范围的数据。
 */
function matchesNode(record: ReportRecord, wanted: number): boolean {
  return record.nodeIndex === wanted - 1
}

export function createReportTools(
  events: SimulationEvent[],
  frameworkNodes: StoryNode[],
): ToolRegistry {
  const records = toReportRecords(events)
  const registry = new ToolRegistry()

  const listNodesTool: Tool = {
    name: "list_nodes",
    description: "列出本次推演的全部故事节点（标题、阶段、目标、预期结果），用于确认分析范围。",
    category: "read",
    parameters: {},
    execute: async () => {
      if (frameworkNodes.length === 0) return "本次推演没有节点信息。"
      return frameworkNodes
        .map(
          (n) =>
            `- 节点${n.index + 1}「${n.phase}」${n.title}：目标「${n.goal}」，预期结果「${n.expectedOutcome ?? ""}」`,
        )
        .join("\n")
    },
  }

  const queryEventsTool: Tool = {
    name: "query_events",
    description:
      "按角色、节点或关键词检索推演事件记录，返回角色原话（逐字）。写报告前应当用它取证，引用时照抄 content。",
    category: "read",
    parameters: {
      characterName: {
        type: "string",
        description: "只看某个角色的行为，传角色名。省略则不限角色。",
        required: false,
      },
      nodeIndex: {
        type: "integer",
        description: "只看某个节点内的事件，传节点序号（从 1 开始）。省略则不限节点。",
        required: false,
      },
      keyword: {
        type: "string",
        description: "按关键词过滤事件内容。省略则不按关键词过滤。",
        required: false,
      },
      limit: {
        type: "integer",
        description: `最多返回多少条（默认${DEFAULT_QUERY_LIMIT}，上限200）。`,
        required: false,
      },
    },
    execute: async (params) => {
      const characterName =
        typeof params.characterName === "string" ? params.characterName.trim() : ""
      const keyword = typeof params.keyword === "string" ? params.keyword.trim() : ""
      const nodeIndex = asNodeIndex(params.nodeIndex)
      const limit = asLimit(params.limit)

      let matched = records
      if (characterName) {
        matched = matched.filter(
          (r) => r.actorName === characterName || r.actorName.includes(characterName),
        )
      }
      if (nodeIndex !== null) {
        matched = matched.filter((r) => matchesNode(r, nodeIndex))
      }
      if (keyword) {
        matched = matched.filter((r) => r.content.includes(keyword))
      }

      if (matched.length === 0) {
        return "没有符合条件的事件记录。请调整筛选条件，或改用 report_stats 查看整体规模。"
      }

      const shown = matched.slice(0, limit)
      const hidden = matched.length - shown.length
      const parts = [renderRecords(shown)]
      if (hidden > 0) {
        parts.push(`（共 ${matched.length} 条，已显示前 ${shown.length} 条，未显示 ${hidden} 条）`)
      }
      return parts.join("\n")
    },
  }

  const characterTimelineTool: Tool = {
    name: "character_timeline",
    description: "按时间顺序查看某个角色的全部行为与原话（逐字），用于分析人物弧线与一致性。",
    category: "read",
    parameters: {
      name: {
        type: "string",
        description: "角色名",
        required: true,
      },
      limit: {
        type: "integer",
        description: `最多返回多少条（默认${DEFAULT_QUERY_LIMIT}，上限200）。`,
        required: false,
      },
    },
    execute: async (params) => {
      const name = typeof params.name === "string" ? params.name.trim() : ""
      if (!name) return "请提供角色名。"

      const matched = records.filter(
        (r) => r.actorName === name || r.actorName.includes(name),
      )
      if (matched.length === 0) {
        const known = Array.from(new Set(records.map((r) => r.actorName))).join("、")
        return known
          ? `没有找到角色「${name}」的事件记录。已出场角色：${known}`
          : `没有找到角色「${name}」的事件记录。`
      }

      const limit = asLimit(params.limit)
      const shown = matched.slice(0, limit)
      const hidden = matched.length - shown.length
      const parts = [renderRecords(shown)]
      if (hidden > 0) {
        parts.push(`（共 ${matched.length} 条，已显示前 ${shown.length} 条，未显示 ${hidden} 条）`)
      }
      return parts.join("\n")
    },
  }

  const statsTool: Tool = {
    name: "report_stats",
    description: "汇总事件记录的整体规模：总数、每个角色各多少条、每个节点各多少条。用于判断取证是否充分。",
    category: "read",
    parameters: {},
    execute: async () => {
      if (records.length === 0) return "没有任何事件记录。"

      const byActor = new Map<string, number>()
      const byNode = new Map<number, number>()
      for (const r of records) {
        byActor.set(r.actorName, (byActor.get(r.actorName) ?? 0) + 1)
        byNode.set(r.nodeIndex, (byNode.get(r.nodeIndex) ?? 0) + 1)
      }

      const actorLines = Array.from(byActor.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `- ${name}：${count} 条`)
      const nodeLines = Array.from(byNode.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([index, count]) =>
          index >= 0 ? `- 节点${index + 1}：${count} 条` : `- 未知节点：${count} 条`,
        )

      return [
        `事件记录共 ${records.length} 条。`,
        "按角色：",
        ...actorLines,
        "按节点：",
        ...nodeLines,
      ].join("\n")
    },
  }

  registry.register(listNodesTool)
  registry.register(queryEventsTool)
  registry.register(characterTimelineTool)
  registry.register(statsTool)

  return registry
}
