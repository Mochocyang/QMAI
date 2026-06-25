import { useReviewStore } from "@/stores/review-store"
import { useChatStore } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { saveReviewItems, saveChatHistory } from "./persist"
import { isTauri } from "@/lib/platform"

let reviewTimer: ReturnType<typeof setTimeout> | null = null
let chatTimer: ReturnType<typeof setTimeout> | null = null

export function setupAutoSave(): void {
  useReviewStore.subscribe((state) => {
    const project = useWikiStore.getState().project
    if (reviewTimer) clearTimeout(reviewTimer)
    reviewTimer = setTimeout(() => {
      if (project && isTauri()) {
        saveReviewItems(project.path, state.items).catch((err) => console.error("自动保存失败:", err))
      }
    }, 1000)
  })

  useChatStore.subscribe((state) => {
    if (Object.keys(state.streamingContents).length > 0) return
    const project = useWikiStore.getState().project
    if (chatTimer) clearTimeout(chatTimer)
    chatTimer = setTimeout(() => {
      if (project && isTauri()) {
        saveChatHistory(project.path, state.conversations, state.messages, useChatStore.getState().maxHistoryMessages).catch((err) => console.error("自动保存失败:", err))
      }
    }, 2000)
  })
}
