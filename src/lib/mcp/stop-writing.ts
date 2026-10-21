import { createConversationRunRegistry } from "@/lib/conversation-run-registry"
import { normalizePath } from "@/lib/path-utils"

export const STOPPED_GENERATION_TEXT = "已停止生成。"

const IDLE_TEXT = "当前没有正在进行的写作生成。"

export const writingRunRegistry = createConversationRunRegistry()

type ChatStopHandler = (projectPath: string) => boolean

let chatStopHandler: ChatStopHandler | null = null

export function registerChatGenerationStop(handler: ChatStopHandler): () => void {
  chatStopHandler = handler
  return () => {
    if (chatStopHandler === handler) chatStopHandler = null
  }
}

export function stopProjectWriting(projectPath: string): string {
  const normalized = normalizePath(projectPath)
  const mcpStopped = writingRunRegistry.abort(normalized)
  const uiStopped = chatStopHandler?.(normalized) ?? false
  return mcpStopped || uiStopped ? STOPPED_GENERATION_TEXT : IDLE_TEXT
}

export function isWritingStopped(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  if (!(error instanceof Error)) return false
  return error.name === "AbortError" || error.message === "操作已取消"
}
