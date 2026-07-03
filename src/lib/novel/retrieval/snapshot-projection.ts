import type { ChapterSnapshot } from "../chapter-ingest"
import type { RetrievalEntry } from "./types"

export function projectSnapshotToEntry(
  snapshot: ChapterSnapshot,
  options: {
    filePath: string
    volumeName: string
    sourceHash?: string
  }
): RetrievalEntry {
  const { filePath, volumeName, sourceHash = "" } = options

  const summary = truncateToWords(snapshot.summary || "", 300)
  const characterStates = formatStateList(snapshot.characterStateChanges || [])
  const foreshadowingChanges = formatForeshadowingList(snapshot.foreshadowingChanges || [])
  const timelineEvents = formatTimelineList(snapshot.timelineEvents || [])

  return {
    chapterNumber: snapshot.chapterNumber,
    chapterTitle: snapshot.chapterTitle || `第${snapshot.chapterNumber}章`,
    filePath,
    volumeName,
    summary,
    characterStates,
    foreshadowingChanges,
    timelineEvents,
    sourceHash,
    indexStatus: sourceHash ? "valid" : "maybe_outdated",
    manualNotes: "",
    manualReminders: "",
  }
}

export function updateEntryFromSnapshot(
  entry: RetrievalEntry,
  snapshot: ChapterSnapshot,
  options: { sourceHash?: string } = {}
): RetrievalEntry {
  const summary = truncateToWords(snapshot.summary || "", 300)
  const characterStates = formatStateList(snapshot.characterStateChanges || [])
  const foreshadowingChanges = formatForeshadowingList(snapshot.foreshadowingChanges || [])
  const timelineEvents = formatTimelineList(snapshot.timelineEvents || [])

  return {
    ...entry,
    chapterTitle: snapshot.chapterTitle || entry.chapterTitle,
    summary,
    characterStates,
    foreshadowingChanges,
    timelineEvents,
    sourceHash: options.sourceHash ?? entry.sourceHash,
    indexStatus: options.sourceHash ? "valid" : entry.indexStatus,
  }
}

function truncateToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/)
  if (words.length <= maxWords) return text.trim()
  return words.slice(0, maxWords).join(" ") + "..."
}

function formatStateList(items: string[]): string {
  if (!items.length) return "无明显变化"
  return items.slice(0, 5).join("；")
}

function formatForeshadowingList(items: string[]): string {
  if (!items.length) return "无"
  return items.slice(0, 5).join("；")
}

function formatTimelineList(items: string[]): string {
  if (!items.length) return "无"
  return items.slice(0, 5).join("；")
}

export function validateEntryConsistency(entry: RetrievalEntry): {
  valid: boolean
  issues: string[]
} {
  const issues: string[] = []

  if (!entry.chapterNumber || entry.chapterNumber <= 0) {
    issues.push("章节号无效")
  }
  if (!entry.filePath) {
    issues.push("文件路径缺失")
  }
  if (!entry.summary.trim()) {
    issues.push("摘要为空")
  }

  return {
    valid: issues.length === 0,
    issues,
  }
}
