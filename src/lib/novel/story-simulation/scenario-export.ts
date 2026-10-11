/**
 * 「舞台情景」导出
 *
 * 将会话导出为 Markdown 文件，保存到项目目录；同时提供一个纯函数
 * scenarioToMarkdown 以便测试与复制。
 */

import { createDirectory, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { ScenarioSession } from "./scenario-types"
import { SCENARIO_FORMAT_INFO } from "./scenario-types"

const SIM_ROOT = ".qmai/simulations"
const SCENARIOS_DIR = `${SIM_ROOT}/scenarios`

function scenariosDir(projectPath: string): string {
  return `${normalizePath(projectPath)}/${SCENARIOS_DIR}`
}

function scenarioFilePath(projectPath: string, title: string, timestamp: string): string {
  const safeName = (title || "舞台情景").replace(/[\\/:*?"<>|]/g, "_")
  const safeTs = timestamp.replace(/[:.]/g, "-")
  return `${scenariosDir(projectPath)}/${safeName}_${safeTs}.md`
}

function speakerLabel(kind: string, speakerName: string): string {
  if (kind === "moderator") return `【主持人·${speakerName}】`
  if (kind === "user") return "【作者】"
  if (kind === "system") return "（旁白）"
  return `【${speakerName}】`
}

/** 将会话渲染为 Markdown 文本（纯函数）。 */
export function scenarioToMarkdown(session: ScenarioSession): string {
  const { setup, messages } = session
  const formatName = SCENARIO_FORMAT_INFO[setup.format]?.name ?? setup.format
  const lines: string[] = []

  lines.push(`# 舞台情景：${setup.title}`)
  lines.push("")
  lines.push(`> 对话形式：${formatName}`)
  lines.push(`> 计划轮数：${setup.rounds}`)
  if (setup.rules.reference) {
    lines.push(`> 参考点：${setup.rules.reference}`)
  }
  if (setup.rules.scene || setup.rules.location || setup.rules.time) {
    const sceneParts = [setup.rules.scene, setup.rules.location, setup.rules.time]
      .filter(Boolean)
      .join("；")
    lines.push(`> 情景设定：${sceneParts}`)
  }
  if (setup.rules.directive) {
    lines.push(`> 主持人要求：${setup.rules.directive}`)
  }
  lines.push(
    `> 出场：${setup.participants.map((p) => `${p.name}${p.isModerator ? "（主持）" : ""}`).join("、")}`,
  )
  lines.push(`> 导出时间：${new Date().toLocaleString("zh-CN")}`)
  lines.push("")
  lines.push("---")
  lines.push("")

  let lastRound = -1
  for (const msg of messages) {
    if (msg.kind === "moderator" && msg.round === 0) {
      lines.push(`## 开场`)
      lines.push("")
    } else if (msg.round !== lastRound && msg.kind !== "system") {
      lines.push(`## 第 ${msg.round} 轮`)
      lines.push("")
    }
    if (msg.kind !== "system") lastRound = msg.round

    lines.push(`**${speakerLabel(msg.kind, msg.speakerName)}**`)
    lines.push("")
    lines.push(msg.content.trim())
    lines.push("")
  }

  lines.push("---")
  lines.push("")
  return lines.join("\n")
}

/**
 * 将会话导出为 Markdown 文件。
 * @returns 导出的文件路径
 */
export async function exportScenario(
  projectPath: string,
  session: ScenarioSession,
): Promise<string> {
  const dir = scenariosDir(projectPath)
  await createDirectory(dir)

  const timestamp = new Date().toISOString()
  const filePath = scenarioFilePath(projectPath, session.title, timestamp)
  await writeFileAtomic(filePath, scenarioToMarkdown(session))
  return filePath
}
