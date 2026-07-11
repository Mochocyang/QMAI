import { useReviewStore } from "@/stores/review-store"
import { useChatStore } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { saveReviewItems, saveChatHistory } from "./persist"
import { isTauri } from "@/lib/platform"

let reviewTimer: ReturnType<typeof setTimeout> | null = null
let chatTimer: ReturnType<typeof setTimeout> | null = null
let periodicTimer: ReturnType<typeof setInterval> | null = null

/** 兜底保存间隔：30 秒 */
const PERIODIC_SAVE_INTERVAL_MS = 30_000

/**
 * 执行一次聊天历史兜底保存。
 * 仅在项目已打开、有会话数据且无流式生成时执行。
 */
function doPeriodicSave(): void {
  const project = useWikiStore.getState().project
  if (!project || !isTauri()) return
  const state = useChatStore.getState()
  if (Object.keys(state.streamingContents).length > 0) return
  if (state.conversations.length === 0) return
  saveChatHistory(project.path, state.conversations, state.messages, state.maxHistoryMessages, state.runStates)
    .catch((err) => console.error("兜底保存失败:", err))
}

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
        saveChatHistory(project.path, latestState.conversations, latestState.messages, latestState.maxHistoryMessages, latestState.runStates).catch((err) => console.error("自动保存失败:", err))
      }
    }, 2000)
  })

  // 定期兜底保存，防止变更触发保存因各种原因未执行
  periodicTimer = setInterval(doPeriodicSave, PERIODIC_SAVE_INTERVAL_MS)
}

/**
 * 清理所有定时器。在应用卸载或需要重置时调用。
 */
export function teardownAutoSave(): void {
  if (reviewTimer) { clearTimeout(reviewTimer); reviewTimer = null }
  if (chatTimer) { clearTimeout(chatTimer); chatTimer = null }
  if (periodicTimer) { clearInterval(periodicTimer); periodicTimer = null }
}
