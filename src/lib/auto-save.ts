import { useReviewStore } from "@/stores/review-store"
import { useChatStore } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { saveReviewItems, saveChatHistory } from "./persist"
import { isTauri } from "@/lib/platform"

let reviewTimer: ReturnType<typeof setTimeout> | null = null
let chatTimer: ReturnType<typeof setTimeout> | null = null

export function setupAutoSave(): void {
  useReviewStore.subscribe(() => {
    if (reviewTimer) clearTimeout(reviewTimer)
    reviewTimer = setTimeout(() => {
      const project = useWikiStore.getState().project
      if (project && isTauri()) {
        const state = useReviewStore.getState()
        saveReviewItems(project.path, state.items).catch((err) => console.error("自动保存失败:", err))
      }
    }, 1000)
  })

  useChatStore.subscribe(() => {
    const state = useChatStore.getState()
    // 正在流式生成时不保存，避免保存不完整的数据
    if (Object.keys(state.streamingContents).length > 0) return
    if (chatTimer) clearTimeout(chatTimer)
    chatTimer = setTimeout(() => {
      // 在回调中重新获取最新状态，避免闭包捕获陈旧数据
      const latestState = useChatStore.getState()
      const project = useWikiStore.getState().project
      // 只在有会话数据时才保存，防止清空 store 时误写入空数据覆盖历史
      if (project && isTauri() && latestState.conversations.length > 0) {
        saveChatHistory(project.path, latestState.conversations, latestState.messages, latestState.maxHistoryMessages).catch((err) => console.error("自动保存失败:", err))
      }
    }, 2000)
  })
}
