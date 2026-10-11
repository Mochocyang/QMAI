/**
 * 「舞台情景」导入到章节库
 *
 * 将一场舞台情景的对白写入项目的 wiki/chapters/ 目录，作为一章**草稿**，
 * 方便作者在其基础上直接改写正文。仿 draft-importer.ts 的写法：
 * 自动分配下一个可用章节号，覆盖前自动备份。
 */

import {
  createDirectory,
  writeFileAtomic,
  fileExists,
  readFile,
} from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { getNextChapterNumber } from "@/lib/novel/chapter-utils"
import { backupChapterFile } from "@/lib/novel/chapter-backup"
import type { ScenarioSession } from "./scenario-types"
import { SCENARIO_FORMAT_INFO } from "./scenario-types"

/** 将一场舞台情景渲染为可编辑的「脚本式」章节正文（纯函数）。 */
export function buildScenarioChapterBody(session: ScenarioSession): string {
  const { setup, messages } = session
  const formatName = SCENARIO_FORMAT_INFO[setup.format]?.name ?? setup.format
  const lines: string[] = []

  lines.push(`> 舞台情景：${setup.title}（${formatName}）`)
  if (setup.rules.reference) {
    lines.push(`> 参考点：${setup.rules.reference}`)
  }
  const sceneParts = [
    setup.rules.scene,
    setup.rules.location,
    setup.rules.time,
  ].filter(Boolean)
  if (sceneParts.length > 0) {
    lines.push(`> 情景：${sceneParts.join("；")}`)
  }
  lines.push("")

  if (messages.length === 0) {
    lines.push("（本场情景没有对话内容）")
    return lines.join("\n")
  }

  for (const msg of messages) {
    if (msg.kind === "system") {
      lines.push(`（${msg.content.trim()}）`)
    } else if (msg.kind === "moderator") {
      lines.push(`主持人·${msg.speakerName}：${msg.content.trim()}`)
    } else if (msg.kind === "user") {
      lines.push(`作者（主持人）：${msg.content.trim()}`)
    } else {
      lines.push(`${msg.speakerName}：${msg.content.trim()}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

export interface ScenarioImportResult {
  chapterNumber: number
  chapterPath: string
  backedUp: boolean
}

/**
 * 将一场舞台情景导入为一章草稿。
 * @returns 章节号、文件路径与是否发生备份
 */
export async function importScenarioToChapter(
  projectPath: string,
  session: ScenarioSession,
  options?: { overwrite?: boolean },
): Promise<ScenarioImportResult> {
  const pp = normalizePath(projectPath)
  const chapterDir = `${pp}/wiki/chapters`
  await createDirectory(chapterDir)

  const chapterNumber = await getNextChapterNumber(pp)
  const fileName = `chapter-${String(chapterNumber).padStart(3, "0")}.md`
  const chapterPath = `${chapterDir}/${fileName}`
  const now = new Date()
  const dateStr = now.toISOString().split("T")[0]

  let backedUp = false
  const exists = await fileExists(chapterPath)
  if (exists) {
    if (!options?.overwrite) {
      throw new Error(
        `章节文件已存在：${fileName}。请先删除已有章节或选择覆盖模式。`,
      )
    }
    try {
      const originalContent = await readFile(chapterPath)
      await backupChapterFile({
        projectPath: pp,
        chapterPath,
        chapterNumber,
        content: originalContent,
        now,
      })
      backedUp = true
    } catch {
      // 备份失败不阻塞导入
      console.warn(`[scenario-import] 备份 ${fileName} 失败，继续覆盖`)
    }
  }

  const rawTitle = session.title || "舞台情景"
  const fullTitle = rawTitle.startsWith("第")
    ? rawTitle
    : `第${chapterNumber}章 ${rawTitle}`

  const content = [
    "---",
    "type: chapter",
    `chapter_number: ${chapterNumber}`,
    "chapter_status: draft",
    `title: "${fullTitle.replace(/"/g, '\\"')}"`,
    "source: stage-scenario",
    `scenario_id: "${session.id}"`,
    `created: ${dateStr}`,
    "---",
    "",
    `# ${fullTitle}`,
    "",
    buildScenarioChapterBody(session),
    "",
  ].join("\n")

  await writeFileAtomic(chapterPath, content)

  return { chapterNumber, chapterPath, backedUp }
}
