/**
 * wiki/tracking/ Markdown 文件读写层
 * 提供上下文.md、伏笔.md、角色状态.md、时间线.md 的读写和自动初始化
 */

import { readFile, writeFile, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import {
  type CharacterState,
  type CharacterStateStore,
} from "./character-state"
import {
  type Foreshadowing,
  type ForeshadowingStore,
} from "./foreshadowing-tracker"
import { type TimelineEntry } from "./timeline"
import type { WritingProgress, ResolvedForeshadowingRecord } from "./tracking-types"

/** 追踪文件路径 */
function trackingDir(projectPath: string): string {
  return `${normalizePath(projectPath)}/wiki/tracking`
}

function contextMdPath(projectPath: string): string {
  return `${trackingDir(projectPath)}/上下文.md`
}

function foreshadowingMdPath(projectPath: string): string {
  return `${trackingDir(projectPath)}/伏笔.md`
}

function characterStateMdPath(projectPath: string): string {
  return `${trackingDir(projectPath)}/角色状态.md`
}

function timelineMdPath(projectPath: string): string {
  return `${trackingDir(projectPath)}/时间线.md`
}

// ─── 上下文.md ───────────────────────────────────────

function serializeContextMd(progress: WritingProgress): string {
  const lines: string[] = [
    "# 写作进度追踪",
    "",
    "| 项目 | 内容 |",
    "|---|---|",
    `| 最近完成章节 | 第${progress.lastCompletedChapter}章：${progress.lastCompletedChapterTitle} |`,
    `| 最后更新 | ${progress.lastUpdated} |`,
    `| 当前剧情阶段 | ${progress.currentArc} |`,
    `| 活跃伏笔数 | ${progress.activeForeshadowingCount}条 |`,
  ]

  if (progress.keyPendingForeshadowing.length > 0) {
    lines.push(`| 关键待回收伏笔 | ${progress.keyPendingForeshadowing.join("、")} |`)
  }
  lines.push(`| 当前关系状态 | ${progress.relationshipStatus} |`)
  lines.push("")

  if (progress.nextChapterGuidance) {
    lines.push("## 下一章指引")
    lines.push(progress.nextChapterGuidance)
    lines.push("")
  }

  if (progress.notes.length > 0) {
    lines.push("## 注意事项")
    for (const note of progress.notes) {
      lines.push(`- ${note}`)
    }
  }

  return lines.join("\n")
}

function parseContextMd(content: string): WritingProgress {
  const progress: WritingProgress = {
    lastCompletedChapter: 0,
    lastCompletedChapterTitle: "",
    lastUpdated: "",
    currentArc: "",
    activeForeshadowingCount: 0,
    keyPendingForeshadowing: [],
    relationshipStatus: "",
    nextChapterGuidance: "",
    notes: [],
  }

  // 解析表格行
  const tableLineRegex = /\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/
  for (const line of content.split("\n")) {
    const m = tableLineRegex.exec(line)
    if (!m) continue
    const key = m[1].trim()
    const value = m[2].trim()
    if (key === "最近完成章节") {
      const match = value.match(/第(\d+)章[：:]\s*(.+)/)
      if (match) {
        progress.lastCompletedChapter = parseInt(match[1], 10)
        progress.lastCompletedChapterTitle = match[2]
      }
    } else if (key === "最后更新") {
      progress.lastUpdated = value
    } else if (key === "当前剧情阶段") {
      progress.currentArc = value
    } else if (key === "活跃伏笔数") {
      const n = value.match(/(\d+)/)
      if (n) progress.activeForeshadowingCount = parseInt(n[1], 10)
    } else if (key === "关键待回收伏笔") {
      progress.keyPendingForeshadowing = value.split(/[、,，]\s*/).filter(Boolean)
    } else if (key === "当前关系状态") {
      progress.relationshipStatus = value
    }
  }

  // 解析下一章指引
  const guidanceMatch = content.match(/## 下一章指引\n([\s\S]*?)(?:\n## |$)/)
  if (guidanceMatch) {
    progress.nextChapterGuidance = guidanceMatch[1].trim()
  }

  // 解析注意事项
  const notesMatch = content.match(/## 注意事项\n([\s\S]*?)$/)
  if (notesMatch) {
    const noteLines = notesMatch[1].split("\n").map((l) => l.replace(/^- /, "").trim()).filter(Boolean)
    progress.notes = noteLines.slice(0, 10)
  }

  return progress
}

// ─── 伏笔.md ──────────────────────────────────────────

function serializeForeshadowingMd(
  items: Foreshadowing[],
  resolved: ResolvedForeshadowingRecord[],
): string {
  const active = items.filter((f) => f.status !== "resolved" && f.status !== "abandoned")
  const abandoned = items.filter((f) => f.status === "abandoned")
  const resolvedItems = resolved.length > 0
    ? resolved
    : items.filter((f) => f.status === "resolved").map((f) => ({
        id: f.id,
        resolvedInChapter: f.resolvedChapter ?? 0,
        resolution: `伏笔「${f.name}」在第${f.resolvedChapter}章回收`,
      }))

  const statusLabelOf = (status: string): string => {
    if (status === "planted") return "已埋设"
    if (status === "advanced") return "推进中"
    if (status === "abandoned") return "已放弃"
    return "推进中"
  }

  const lines: string[] = [
    "# 伏笔追踪",
    "",
    "## 活跃伏笔",
    "| ID | 伏笔内容 | 埋设章节 | 预计回收章节 | 状态 | 重要度 | 相关角色 | 备注 |",
    "|---|---|---|---|---|---|---|---|",
  ]

  for (const f of active) {
    const importance = f.importance ?? "medium"
    const statusLabel = statusLabelOf(f.status)
    const expectedChapter = f.expectedResolveChapter ? `第${f.expectedResolveChapter}章` : "待定"
    const relatedChars = (f.relatedCharacters || []).join("、")
    const content = f.description || f.name
    lines.push(
      `| ${f.id} | ${content} | 第${f.plantedChapter}章 | ${expectedChapter} | ${statusLabel} | ${importance} | ${relatedChars} | ${f.notes} |`,
    )
  }

  lines.push("", "## 已回收伏笔", "| ID | 伏笔内容 | 埋设章节 | 回收章节 | 回收方式 |", "|---|---|---|---|---|")

  for (const r of resolvedItems) {
    const f = items.find((fi) => fi.id === r.id)
    const plantedChapter = f?.plantedChapter ?? "?"
    const content = f?.description || f?.name || ""
    lines.push(`| ${r.id} | ${content} | 第${plantedChapter}章 | 第${r.resolvedInChapter}章 | ${r.resolution} |`)
  }

  lines.push("", "## 已放弃伏笔", "| ID | 伏笔内容 | 埋设章节 | 状态 | 备注 |", "|---|---|---|---|---|")
  for (const f of abandoned) {
    const content = f.description || f.name
    lines.push(`| ${f.id} | ${content} | 第${f.plantedChapter}章 | 已放弃 | ${f.notes} |`)
  }

  return lines.join("\n")
}

function parseForeshadowingMd(content: string, existingStore: ForeshadowingStore, resolved: ResolvedForeshadowingRecord[]): { store: ForeshadowingStore; resolved: ResolvedForeshadowingRecord[] } {
  const items: Foreshadowing[] = []
  const resolvedRecords: ResolvedForeshadowingRecord[] = [...resolved]

  const lines = content.split("\n")
  let inActive = false
  let inResolved = false
  const statusMap: Record<string, "planted" | "advanced" | "resolved" | "abandoned"> = {
    "已埋设": "planted",
    "推进中": "advanced",
    "已放弃": "abandoned",
  }
  let inAbandoned = false

  for (const line of lines) {
    if (line.startsWith("## 活跃伏笔")) {
      inActive = true
      inResolved = false
      inAbandoned = false
      continue
    }
    if (line.startsWith("## 已回收伏笔")) {
      inActive = false
      inResolved = true
      inAbandoned = false
      continue
    }
    if (line.startsWith("## 已放弃伏笔")) {
      inActive = false
      inResolved = false
      inAbandoned = true
      continue
    }

    if (inActive && line.startsWith("|") && !line.startsWith("|---")) {
      const parts = line.split("|").map((p) => p.trim()).filter(Boolean)
      if (parts.length >= 8) {
        const id = parts[0]
        const statusLabel = parts[4]
        const importanceLabel = parts[5]
        const existing = existingStore.items.find((f) => f.id === id)
        const item: Foreshadowing = existing
          ? { ...existing }
          : {
              id,
              name: parts[1].slice(0, 20),
              description: parts[1],
              status: "planted",
              plantedChapter: 1,
              advancedChapters: [],
              relatedCharacters: [],
              relatedEvents: [],
              notes: "",
            }
        item.description = parts[1]
        item.status = statusMap[statusLabel] ?? "planted"
        const chapterMatch = parts[2].match(/(\d+)/)
        if (chapterMatch) item.plantedChapter = parseInt(chapterMatch[1], 10)
        const expectedMatch = parts[3].match(/(\d+)/)
        if (expectedMatch) item.expectedResolveChapter = parseInt(expectedMatch[1], 10)
        item.importance = importanceLabel === "高" ? "high" : importanceLabel === "低" ? "low" : "medium"
        if (parts[6]) item.relatedCharacters = parts[6].split(/[、,，]/).filter(Boolean)
        if (parts[7]) item.notes = parts[7]
        items.push(item)
      }
    }

    if (inResolved && line.startsWith("|") && !line.startsWith("|---")) {
      const parts = line.split("|").map((p) => p.trim()).filter(Boolean)
      if (parts.length >= 3) {
        const id = parts[0]
        if (!resolvedRecords.some((r) => r.id === id)) {
          const chapterMatch = parts[3].match(/(\d+)/)
          resolvedRecords.push({
            id,
            resolvedInChapter: chapterMatch ? parseInt(chapterMatch[1], 10) : 0,
            resolution: parts[4] ?? "",
          })
        }
      }
    }

    if (inAbandoned && line.startsWith("|") && !line.startsWith("|---")) {
      const parts = line.split("|").map((p) => p.trim()).filter(Boolean)
      if (parts.length >= 4 && parts[0] !== "ID") {
        const id = parts[0]
        const existing = existingStore.items.find((f) => f.id === id)
        const item: Foreshadowing = existing
          ? { ...existing, status: "abandoned" }
          : {
              id,
              name: (parts[1] || "").slice(0, 20),
              description: parts[1] || "",
              status: "abandoned",
              plantedChapter: 1,
              advancedChapters: [],
              relatedCharacters: [],
              relatedEvents: [],
              notes: parts[4] || "",
            }
        const chapterMatch = parts[2]?.match(/(\d+)/)
        if (chapterMatch) item.plantedChapter = parseInt(chapterMatch[1], 10)
        if (parts[4]) item.notes = parts[4]
        item.status = "abandoned"
        if (!items.some((f) => f.id === id)) items.push(item)
      }
    }
  }

  // 将已回收但不在活跃表中的伏笔标记为resolved
  for (const r of resolvedRecords) {
    const item = items.find((f) => f.id === r.id)
    if (item && item.status !== "resolved") {
      item.status = "resolved"
      item.resolvedChapter = r.resolvedInChapter
    }
  }

  return { store: { items, lastUpdated: new Date().toISOString() }, resolved: resolvedRecords }
}

// ─── 角色状态.md ──────────────────────────────────────

function serializeCharacterStateMd(store: CharacterStateStore): string {
  const lines: string[] = [
    "# 角色状态快照",
    "",
  ]

  let maxChapter = 0
  for (const c of store.characters) {
    if (c.lastUpdatedChapter > maxChapter) maxChapter = c.lastUpdatedChapter
  }

  if (maxChapter > 0) {
    lines.push(`> 最后更新：第${maxChapter}章`)
    lines.push("")
  }

  for (const c of store.characters) {
    lines.push(`## ${c.characterName}`)
    lines.push(`- **当前位置**：${c.currentLocation || "未知"}`)
    lines.push(`- **状态**：${c.status || "正常"}`)
    if (c.publicImage) lines.push(`- **公众形象**：${c.publicImage}`)
    if (c.pendingForeshadowing && c.pendingForeshadowing.length > 0) {
      lines.push(`- **待回收伏笔**：${c.pendingForeshadowing.join("、")}`)
    }
    if (c.stateChangeHistory && c.stateChangeHistory.length > 0) {
      lines.push("")
      lines.push("### 状态变更记录（最近10条）")
      for (const record of c.stateChangeHistory) {
        lines.push(`- 第${record.chapter}章：${record.change}`)
      }
    }
    lines.push("")
  }

  return lines.join("\n")
}

function parseCharacterStateMd(content: string): CharacterStateStore {
  const characters: CharacterState[] = []
  const lines = content.split("\n")
  let currentChar: Partial<CharacterState> | null = null
  const history: Array<{ chapter: number; change: string }> = []
  let inHistory = false

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)/)
    if (headerMatch) {
      if (currentChar && currentChar.characterName) {
        if (history.length > 0) {
          currentChar.stateChangeHistory = history.map((h) => ({
            chapter: h.chapter,
            change: h.change,
            timestamp: new Date().toISOString(),
          }))
        }
        characters.push(currentChar as CharacterState)
      }
      currentChar = {
        characterName: headerMatch[1].trim(),
        equipment: [],
        abilities: [],
        relationships: {},
        lastUpdatedChapter: 0,
        lastUpdatedAt: new Date().toISOString(),
      }
      history.length = 0
      inHistory = false
      continue
    }

    if (!currentChar) continue

    if (line.includes("### 状态变更记录")) {
      inHistory = true
      continue
    }

    if (inHistory) {
      const recordMatch = line.match(/[-*]\s*第(\d+)章[：:]\s*(.+)/)
      if (recordMatch) {
        history.push({
          chapter: parseInt(recordMatch[1], 10),
          change: recordMatch[2].trim(),
        })
      }
      continue
    }

    // 解析字段
    const locationMatch = line.match(/\*\*当前位置\*\*[：:]\s*(.+)/)
    if (locationMatch) {
      currentChar.currentLocation = locationMatch[1].trim()
      continue
    }
    const statusMatch = line.match(/\*\*状态\*\*[：:]\s*(.+)/)
    if (statusMatch) {
      currentChar.status = statusMatch[1].trim()
      continue
    }
    const publicImageMatch = line.match(/\*\*公众形象\*\*[：:]\s*(.+)/)
    if (publicImageMatch) {
      currentChar.publicImage = publicImageMatch[1].trim()
      continue
    }
    const pendingMatch = line.match(/\*\*待回收伏笔\*\*[：:]\s*(.+)/)
    if (pendingMatch) {
      currentChar.pendingForeshadowing = pendingMatch[1].split(/[、,，]/).filter(Boolean)
      continue
    }
  }

  // 保存最后一个角色
  if (currentChar && currentChar.characterName) {
    if (history.length > 0) {
      currentChar.stateChangeHistory = history.map((h) => ({
        chapter: h.chapter,
        change: h.change,
        timestamp: new Date().toISOString(),
      }))
    }
    characters.push(currentChar as CharacterState)
  }

  return { characters, lastUpdated: new Date().toISOString() }
}

// ─── 时间线.md ────────────────────────────────────────

function serializeTimelineMd(entries: TimelineEntry[]): string {
  const lines: string[] = ["# 时间线", "", "| 章节 | 事件 |", "|---|---|"]
  const sorted = [...entries].sort((a, b) => a.chapterNumber - b.chapterNumber)
  for (const e of sorted) {
    lines.push(`| 第${e.chapterNumber}章 | ${e.event} |`)
  }
  return lines.join("\n")
}

// ─── 写入函数 ────────────────────────────────────────

/**
 * 写入上下文.md
 */
export async function writeContextMd(projectPath: string, progress: WritingProgress): Promise<void> {
  await createDirectory(trackingDir(projectPath))
  await writeFile(contextMdPath(projectPath), serializeContextMd(progress))
}

/**
 * 写入伏笔.md
 */
export async function writeForeshadowingMd(
  projectPath: string,
  items: Foreshadowing[],
  resolved: ResolvedForeshadowingRecord[],
): Promise<void> {
  await createDirectory(trackingDir(projectPath))
  await writeFile(foreshadowingMdPath(projectPath), serializeForeshadowingMd(items, resolved))
}

/**
 * 写入角色状态.md
 */
export async function writeCharacterStateMd(projectPath: string, store: CharacterStateStore): Promise<void> {
  await createDirectory(trackingDir(projectPath))
  await writeFile(characterStateMdPath(projectPath), serializeCharacterStateMd(store))
}

/**
 * 写入时间线.md
 */
export async function writeTimelineMd(projectPath: string, entries: TimelineEntry[]): Promise<void> {
  await createDirectory(trackingDir(projectPath))
  await writeFile(timelineMdPath(projectPath), serializeTimelineMd(entries))
}

// ─── 读取函数 ────────────────────────────────────────

/**
 * 读取上下文.md
 */
export async function readContextMd(projectPath: string): Promise<WritingProgress | null> {
  try {
    const content = await readFile(contextMdPath(projectPath))
    return parseContextMd(content)
  } catch {
    return null
  }
}

/**
 * 读取伏笔.md（合并现有数据）
 */
export async function readForeshadowingMd(
  projectPath: string,
  existingStore: ForeshadowingStore,
  resolved: ResolvedForeshadowingRecord[],
): Promise<{ store: ForeshadowingStore; resolved: ResolvedForeshadowingRecord[] }> {
  try {
    const content = await readFile(foreshadowingMdPath(projectPath))
    return parseForeshadowingMd(content, existingStore, resolved)
  } catch {
    return { store: existingStore, resolved }
  }
}

/**
 * 读取角色状态.md
 */
export async function readCharacterStateMd(projectPath: string): Promise<CharacterStateStore | null> {
  try {
    const content = await readFile(characterStateMdPath(projectPath))
    return parseCharacterStateMd(content)
  } catch {
    return null
  }
}