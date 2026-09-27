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
  /** 当前章就是全书最新章，而且这章作为最新草稿已经提示过。再次点开不再提示。 */
  latestAlreadyHinted: boolean
  currentlyVisible: boolean
}): boolean {
  if (!input.enabled || !input.isChapter || input.status !== "draft" || input.wordCount <= 0 || input.dismissed || input.extracting) {
    return false
  }
  if (input.arrival === "select" && input.latestAlreadyHinted && !input.currentlyVisible) return false
  if (input.arrival === "stay") return input.currentlyVisible
  return true
}

export interface ChapterTreeNode {
  name: string
  path: string
  is_dir: boolean
  children?: ChapterTreeNode[]
}

export function chapterOrdersFromTree(nodes: ChapterTreeNode[] | undefined): number[] {
  const orders: number[] = []
  const walk = (list: ChapterTreeNode[]) => {
    for (const node of list) {
      if (node.is_dir) {
        if (node.children?.length) walk(node.children)
        continue
      }
      const normalized = node.path.replace(/\\/g, "/")
      if (!normalized.includes("/wiki/chapters/") || !normalized.endsWith(".md")) continue
      const order = chapterOrderFromFileName(node.name)
      if (order != null) orders.push(order)
    }
  }
  if (nodes?.length) walk(nodes)
  return orders
}

export function chapterOrderFromFileName(name: string): number | null {
  const match = name.match(/第\s*(\d+)\s*章/)
  if (!match?.[1]) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function maxChapterOrder(values: Array<number | null | undefined>): number | null {
  let max: number | null = null
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue
    max = max == null ? value : Math.max(max, value)
  }
  return max
}

/** 再次点开全书最新草稿，且这章已经提示过。 */
export function isLatestDraftReopen(input: {
  chapterNumber: number | null
  maxChapterNumber: number | null
  hintedLatestChapter: number | null
}): boolean {
  if (input.chapterNumber == null || input.hintedLatestChapter == null) return false
  const latest = input.maxChapterNumber ?? input.chapterNumber
  return input.chapterNumber === latest && input.hintedLatestChapter === input.chapterNumber
}
