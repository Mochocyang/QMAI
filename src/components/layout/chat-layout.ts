import type { ChatDockPosition } from "@/stores/wiki-store"

export function getChatBarVisibility(chatExpanded: boolean, chatDockPosition: ChatDockPosition = "bottom") {
  return chatExpanded && chatDockPosition === "bottom" ? "expanded" : "hidden"
}

export function getNextChatExpanded(chatExpanded: boolean) {
  return !chatExpanded
}

export function shouldShowWritingChat(chatExpanded: boolean, chatDockPosition: ChatDockPosition = "bottom") {
  return chatExpanded && chatDockPosition === "bottom"
}

export function shouldShowRightDockChat(chatExpanded: boolean, chatDockPosition: ChatDockPosition = "bottom") {
  return chatExpanded && chatDockPosition === "right"
}

export function getChapterToolbarOrder() {
  return ["ai-session", "de-ai", "chapter-status"]
}
