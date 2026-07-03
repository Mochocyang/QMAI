import type { RetrievalEntry, IndexStatus } from "./types"
import {
  AUTO_START_MARKER,
  AUTO_END_MARKER,
  MANUAL_START_MARKER,
  MANUAL_END_MARKER,
} from "./types"

export function serializeEntryToMarkdown(entry: RetrievalEntry): string {
  const autoSection = [
    AUTO_START_MARKER,
    `- 文件路径：${entry.filePath}`,
    `- 章节号：${entry.chapterNumber}`,
    `- 所属卷：${entry.volumeName}`,
    `- 摘要：${entry.summary}`,
    `- 人物状态变化：${entry.characterStates}`,
    `- 伏笔变化：${entry.foreshadowingChanges}`,
    `- 时间线事件：${entry.timelineEvents}`,
    `- sourceHash：${entry.sourceHash}`,
    `- 索引状态：${indexStatusToText(entry.indexStatus)}`,
    AUTO_END_MARKER,
  ].join("\n")

  const manualSection = [
    MANUAL_START_MARKER,
    `- 人工备注：${entry.manualNotes || ""}`,
    `- 后续提醒：${entry.manualReminders || ""}`,
    MANUAL_END_MARKER,
  ].join("\n")

  return [
    `## 第${entry.chapterNumber}章 - ${entry.chapterTitle}`,
    "",
    autoSection,
    "",
    manualSection,
    "",
  ].join("\n")
}

export function deserializeEntryFromMarkdown(markdown: string): RetrievalEntry | null {
  const titleMatch = markdown.match(/^## 第(\d+)章[ -]+(.+)$/m)
  if (!titleMatch) return null

  const chapterNumber = parseInt(titleMatch[1], 10)
  const chapterTitle = titleMatch[2].trim()

  const autoContent = extractSection(markdown, AUTO_START_MARKER, AUTO_END_MARKER)
  const manualContent = extractSection(markdown, MANUAL_START_MARKER, MANUAL_END_MARKER)

  if (!autoContent) return null

  const filePath = extractField(autoContent, "文件路径")
  const volumeName = extractField(autoContent, "所属卷") || "第一卷"
  const summary = extractField(autoContent, "摘要")
  const characterStates = extractField(autoContent, "人物状态变化")
  const foreshadowingChanges = extractField(autoContent, "伏笔变化")
  const timelineEvents = extractField(autoContent, "时间线事件")
  const sourceHash = extractField(autoContent, "sourceHash")
  const indexStatusText = extractField(autoContent, "索引状态")
  const indexStatus = textToIndexStatus(indexStatusText)

  const manualNotes = extractField(manualContent || "", "人工备注")
  const manualReminders = extractField(manualContent || "", "后续提醒")

  return {
    chapterNumber,
    chapterTitle,
    filePath,
    volumeName,
    summary,
    characterStates,
    foreshadowingChanges,
    timelineEvents,
    sourceHash,
    indexStatus,
    manualNotes,
    manualReminders,
  }
}

export function parseVolumeEntries(volumeMarkdown: string): RetrievalEntry[] {
  const entryBlocks = splitVolumeIntoEntries(volumeMarkdown)
  const entries: RetrievalEntry[] = []
  for (const block of entryBlocks) {
    const entry = deserializeEntryFromMarkdown(block)
    if (entry) entries.push(entry)
  }
  return entries
}

export function serializeVolumeEntries(entries: RetrievalEntry[], volumeName: string): string {
  const sorted = [...entries].sort((a, b) => a.chapterNumber - b.chapterNumber)
  const body = sorted.map((e) => serializeEntryToMarkdown(e)).join("\n")
  return `# ${volumeName}\n\n${body}`
}

function extractSection(content: string, startMarker: string, endMarker: string): string | null {
  const startIdx = content.indexOf(startMarker)
  if (startIdx === -1) return null
  const endIdx = content.indexOf(endMarker, startIdx + startMarker.length)
  if (endIdx === -1) return null
  return content.slice(startIdx + startMarker.length, endIdx).trim()
}

function extractField(content: string, fieldName: string): string {
  const regex = new RegExp(`^-\\s*${escapeRegExp(fieldName)}：[ \\t]*(.*)$`, "im")
  const match = content.match(regex)
  return match ? match[1].trim() : ""
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function indexStatusToText(status: IndexStatus): string {
  switch (status) {
    case "valid": return "有效"
    case "maybe_outdated": return "可能过期"
    case "conflict": return "与正文冲突"
    default: return "可能过期"
  }
}

function textToIndexStatus(text: string): IndexStatus {
  const normalized = text.trim()
  if (normalized === "有效") return "valid"
  if (normalized === "与正文冲突") return "conflict"
  return "maybe_outdated"
}

function splitVolumeIntoEntries(volumeMarkdown: string): string[] {
  const lines = volumeMarkdown.split("\n")
  const blocks: string[] = []
  let currentBlock: string[] = []
  let inEntry = false

  for (const line of lines) {
    if (/^## 第\d+章/.test(line)) {
      if (inEntry && currentBlock.length > 0) {
        blocks.push(currentBlock.join("\n"))
      }
      currentBlock = [line]
      inEntry = true
    } else if (inEntry) {
      currentBlock.push(line)
    }
  }

  if (inEntry && currentBlock.length > 0) {
    blocks.push(currentBlock.join("\n"))
  }

  return blocks
}
