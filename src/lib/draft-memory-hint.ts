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
  /** 这本书的文件夹里已经提示过一次。 */
  bookHintSeen: boolean
  /** 点开时，同一本书里已经有更大章号。不看后一章是草稿还是正式。 */
  hasLaterChapter: boolean
  currentlyVisible: boolean
}): boolean {
  if (!input.enabled || !input.isChapter || input.status !== "draft" || input.wordCount <= 0 || input.dismissed || input.extracting) {
    return false
  }
  if (input.arrival === "stay") return input.currentlyVisible
  // 同一次打开里刚记下「本书已提示」，不要把正在显示的提示收掉。
  if (input.currentlyVisible) return true
  if (input.bookHintSeen && !(input.hasLaterChapter && input.arrival === "select")) return false
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

/** 章节目录里是否已有比当前章号更大的章节文件。 */
export function chapterHasLaterChapter(chapterNumber: number | null, orders: Array<number | null | undefined>): boolean {
  if (chapterNumber == null) return false
  return orders.some((order) => order != null && order > chapterNumber)
}
