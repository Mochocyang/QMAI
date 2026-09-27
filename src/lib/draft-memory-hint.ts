import type { ChapterStatus } from "@/lib/novel/chapter-meta"

/** 刚点进本章，或本章从空正文第一次保存成功。同一章后续保存为 stay。 */
export type DraftMemoryHintArrival = "select" | "first-save" | "stay"

export const DRAFT_MEMORY_HINT_MESSAGE =
  "这一章还是草稿。点击「提取记忆」会先保存为正式章节，再提取这章记忆。"

export function resolveDraftMemoryHint(input: {
  isChapter: boolean
  status: ChapterStatus | null
  wordCount: number
  arrival: DraftMemoryHintArrival
  dismissed: boolean
  extracting: boolean
  enabled: boolean
  currentlyVisible: boolean
}): boolean {
  if (!input.enabled || !input.isChapter || input.status !== "draft" || input.wordCount <= 0 || input.dismissed || input.extracting) {
    return false
  }
  if (input.arrival === "stay") return input.currentlyVisible
  return true
}
