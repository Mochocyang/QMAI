import type { Conversation } from "@/stores/chat-store"

export function isWorkspaceView(view: "wiki" | "sources" | "search" | "graph" | "lint" | "review" | "characterAura" | "settings" | "trash"): boolean {
  return view === "wiki" || view === "trash"
}

export function clampSidebarWidth(width: number): number {
  return Math.max(150, Math.min(400, width))
}

export function clampChatHeight(height: number): number {
  return Math.max(180, Math.min(520, height))
}

export function clampChatWidth(width: number): number {
  return Math.max(280, Math.min(520, width))
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

export function sortConversationsByUpdatedAt(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
}
