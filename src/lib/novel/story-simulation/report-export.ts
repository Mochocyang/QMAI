/**
 * 推演报告导出
 * 将 SimulationReport 导出为完整的 Markdown 文件。
 */

import { createDirectory, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type {
  SimulationReport,
  StoryFramework,
  TimelineEvent,
} from "./types"

const SIM_ROOT = ".qmai/simulations"
const EXPORTS_DIR = `${SIM_ROOT}/exports`

function exportsDir(projectPath: string): string {
  return `${normalizePath(projectPath)}/${EXPORTS_DIR}`
}

function reportFilePath(
  projectPath: string,
  frameworkTitle: string,
  timestamp: string,
): string {
  const safeTitle = frameworkTitle
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 30)
  const safeTs = timestamp.replace(/[:.]/g, "-")
  return `${exportsDir(projectPath)}/推演报告_${safeTitle}_${safeTs}.md`
}

function probabilityLabel(p: string): string {
  switch (p) {
    case "high":
      return "高"
    case "medium":
      return "中"
    case "low":
      return "低"
    default:
      return p
  }
}

function actionTypeLabel(type: string): string {
  const map: Record<string, string> = {
    evaluate: "评价",
    pushPlot: "推动事态",
    observe: "观察",
    react: "反应",
    speak: "对话",
    ally: "示好",
    confront: "对抗",
    conceal: "隐瞒",
    investigate: "调查",
    act: "行动",
    decide: "决策",
    conflict: "冲突",
    cooperate: "合作",
    withhold: "隐瞒",
  }
  return map[type] || type
}

/**
 * 导出推演报告为 Markdown。
 * @returns 导出的文件路径
 */
export async function exportReport(
  projectPath: string,
  framework: StoryFramework,
  report: SimulationReport,
  timelineEvents?: TimelineEvent[],
): Promise<string> {
  const dir = exportsDir(projectPath)
  await createDirectory(dir)

  const now = new Date()
  const timestamp = now.toISOString()
  const filePath = reportFilePath(projectPath, framework.shortTitle || framework.title, timestamp)

  const content = buildReportMarkdown(framework, report, timelineEvents, now)
  await writeFileAtomic(filePath, content)
  return filePath
}

/**
 * 把报告渲染成 Markdown。
 *
 * 从 `exportReport` 里抽出来是为了能直接断言正文内容 —— 原来它和 `writeFileAtomic`
 * 混在一起，只能靠真实落盘来测。
 */
export function buildReportMarkdown(
  framework: StoryFramework,
  report: SimulationReport,
  timelineEvents: TimelineEvent[] | undefined,
  now: Date,
): string {
  const lines: string[] = []
  lines.push(`# 故事推演报告：${framework.title}`)
  lines.push("")
  lines.push(`> 推演时间：${now.toLocaleString("zh-CN")}`)
  lines.push(`> 仿真模式：${framework.simulationMode}`)
  lines.push(`> 目标字数：${framework.targetWords}`)
  if (framework.shortTitle) {
    lines.push(`> 简短标题：${framework.shortTitle}`)
  }
  lines.push("")
  lines.push("---")
  lines.push("")

  // 故事前提
  lines.push("## 故事前提")
  lines.push("")
  lines.push(framework.premise || "（无）")
  lines.push("")

  // 综合推荐
  if (report.recommendation) {
    lines.push("## 综合推荐")
    lines.push("")
    lines.push(report.recommendation)
    lines.push("")
  }

  // 剧情事件时间线
  if (timelineEvents && timelineEvents.length > 0) {
    lines.push("## 剧情事件时间线")
    lines.push("")
    const byNode = new Map<number, TimelineEvent[]>()
    for (const ev of timelineEvents) {
      const arr = byNode.get(ev.nodeIndex) || []
      arr.push(ev)
      byNode.set(ev.nodeIndex, arr)
    }
    const nodeIndices = Array.from(byNode.keys()).sort((a, b) => a - b)
    for (const ni of nodeIndices) {
      const node = framework.nodes.find(n => n.index === ni)
      const nodeEvents = byNode.get(ni) || []
      lines.push(`### 节点${ni + 1}【${node?.phase || ""}】${node?.title || ""}`)
      lines.push("")
      for (const ev of nodeEvents) {
        const targetStr = ev.targetName ? ` → ${ev.targetName}` : ""
        lines.push(`- **R${ev.round + 1}** ${ev.actorName} ${actionTypeLabel(ev.actionType)}${targetStr}：${ev.content}`)
      }
      lines.push("")
    }
  }

  // 角色分析
  if (report.characterAnalyses.length > 0) {
    lines.push("## 角色行为分析")
    lines.push("")
    for (const char of report.characterAnalyses) {
      lines.push(`### ${char.name}`)
      lines.push("")
      lines.push(`- 一致性评分：${char.consistencyScore}/100`)
      if (char.behaviors.length > 0) {
        lines.push("")
        lines.push("**关键行为：**")
        for (const b of char.behaviors) {
          lines.push(`- [${b.node}] ${b.action} — 动机：${b.motivation}`)
        }
      }
      if (char.stateChanges.length > 0) {
        lines.push("")
        lines.push("**状态变化：**")
        for (const s of char.stateChanges) {
          lines.push(`- ${s}`)
        }
      }
      if (char.evidence && char.evidence.length > 0) {
        lines.push("")
        lines.push("**原话依据：**")
        for (const quote of char.evidence) {
          lines.push(`> ${quote}`)
        }
      }
      lines.push("")
    }
  }

  // 故事走向分支
  if (report.branches.length > 0) {
    lines.push("## 故事走向分支")
    lines.push("")
    for (let i = 0; i < report.branches.length; i++) {
      const branch = report.branches[i]
      lines.push(`### 分支${i + 1}：${branch.title}`)
      lines.push("")
      lines.push(`- 概率：${probabilityLabel(branch.probability)}`)
      if (branch.recommendation) {
        lines.push(`- **推荐分支**`)
      }
      lines.push(`- 摘要：${branch.summary}`)
      if (branch.keyEvents.length > 0) {
        lines.push("- 关键事件：")
        for (const e of branch.keyEvents) {
          lines.push(`  - ${e}`)
        }
      }
      if (branch.pros) {
        lines.push(`- 优势：${branch.pros}`)
      }
      if (branch.cons) {
        lines.push(`- 风险：${branch.cons}`)
      }
      if (branch.evidence && branch.evidence.length > 0) {
        lines.push("- 原话依据：")
        for (const quote of branch.evidence) {
          lines.push(`  > ${quote}`)
        }
      }
      lines.push("")
    }
  }

  // 取证审计：引文是否真的逐字来自事件记录
  if (report.evidenceAudit) {
    lines.push("## 取证审计")
    lines.push("")
    lines.push(
      `- 引文共 ${report.evidenceAudit.total} 条，逐字核对通过 ${report.evidenceAudit.verified} 条`,
    )
    lines.push(
      report.evidenceAudit.toolCalls > 0
        ? `- 取证过程调用工具 ${report.evidenceAudit.toolCalls} 次`
        : "- 本次未使用取证工具（单次生成）",
    )
    if (report.evidenceAudit.unverified.length > 0) {
      lines.push(
        `- **警告**：下列 ${report.evidenceAudit.unverified.length} 条引文在事件记录中找不到原文，可能是改写或编造，请勿当作依据：`,
      )
      for (const quote of report.evidenceAudit.unverified) {
        lines.push(`  - 「${quote}」`)
      }
    }
    lines.push("")
  }

  return lines.join("\n")
}
