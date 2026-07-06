export function isWorkspaceView(view: "wiki" | "sources" | "search" | "graph" | "lint" | "review" | "characterAura" | "settings" | "trash"): boolean {
  return view === "wiki" || view === "trash"
}

export function clampSidebarWidth(width: number): number {
  return Math.max(150, Math.min(400, width))
}

export function clampChatHeight(height: number): number {
  return Math.max(180, Math.min(520, height))
}

const CHAT_MIN_WIDTH = 280
const CHAT_OLD_DEFAULT_WIDTH = 360
export const CHAT_DOCK_DEFAULT_WIDTH = 640
export const CHAT_DOCK_MAX_VIEWPORT_RATIO = 0.5

function resolveViewportWidth(viewportWidth?: number): number {
  if (typeof viewportWidth === "number" && Number.isFinite(viewportWidth) && viewportWidth > 0) {
    return viewportWidth
  }
  if (typeof window !== "undefined" && Number.isFinite(window.innerWidth) && window.innerWidth > 0) {
    return window.innerWidth
  }
  return 1040
}

export function getMaxChatWidth(viewportWidth?: number): number {
  return Math.max(CHAT_MIN_WIDTH, Math.floor(resolveViewportWidth(viewportWidth) * CHAT_DOCK_MAX_VIEWPORT_RATIO))
}

export function clampChatWidth(width: number, viewportWidth?: number): number {
  return Math.max(CHAT_MIN_WIDTH, Math.min(getMaxChatWidth(viewportWidth), width))
}

export function getInitialChatWidth(storedWidth?: number | null, viewportWidth?: number): number {
  if (typeof storedWidth === "number" && Number.isFinite(storedWidth) && storedWidth > CHAT_OLD_DEFAULT_WIDTH) {
    return clampChatWidth(storedWidth, viewportWidth)
  }
  return clampChatWidth(CHAT_DOCK_DEFAULT_WIDTH, viewportWidth)
}

export function shouldUseCompactChapterToolbar(width: number): boolean {
  return width < 720
}

export function getPreviewContentContainerClass(immersiveChapter: boolean): string {
  return immersiveChapter
    ? "flex-1 min-w-0 overflow-hidden"
    : "flex-1 min-w-0 overflow-auto"
}

export function getConversationTabTitle(title: string, maxLength = 12): string {
  if (title.length <= maxLength) return title
  return `${title.slice(0, Math.max(1, maxLength - 1))}…`
}

export interface ConversationToolbarItem {
  id: string
  updatedAt: number
}

export const MAX_TOP_CONVERSATIONS = 3

export function sortConversationsByUpdatedAt<T extends ConversationToolbarItem>(conversations: T[]): T[] {
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function isTodayConversation(conv: ConversationToolbarItem, now = new Date()): boolean {
  return new Date(conv.updatedAt).toDateString() === now.toDateString()
}

export function splitConversationToolbarItems<T extends ConversationToolbarItem>(
  conversations: T[],
  activeConversationId: string | null,
  isWorkingConversation: (convId: string) => boolean,
): {
  sorted: T[]
  topConversations: T[]
  historyConversations: T[]
} {
  const sorted = sortConversationsByUpdatedAt(conversations)
  const activeConversation = sorted.find((conv) => conv.id === activeConversationId) ?? null
  const topConversationCandidates = [
    ...(activeConversation ? [activeConversation] : []),
    ...sorted.filter((conv) => conv.id !== activeConversationId && isWorkingConversation(conv.id)),
    ...sorted.filter((conv) => conv.id !== activeConversationId && !isWorkingConversation(conv.id) && isTodayConversation(conv)),
  ]
  const seenTopConversationIds = new Set<string>()
  const topConversations = topConversationCandidates
    .filter((conv) => {
      if (seenTopConversationIds.has(conv.id)) return false
      seenTopConversationIds.add(conv.id)
      return true
    })
    .slice(0, MAX_TOP_CONVERSATIONS)
  const topConversationIds = new Set(topConversations.map((conv) => conv.id))
  const historyConversations = sorted.filter((conv) => !topConversationIds.has(conv.id))

  return { sorted, topConversations, historyConversations }
}
