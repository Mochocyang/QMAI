export type ConversationRunStatus = "idle" | "running" | "completed_unread" | "failed" | "interrupted"
export interface ConversationRunState { status: ConversationRunStatus; updatedAt: number; error?: string; runId?: string }
export type ConversationRunStates = Record<string, ConversationRunState>
export const MAX_CONCURRENT_CONVERSATIONS = 3

export function countRunningConversations(states: ConversationRunStates): number {
  return Object.values(states).filter((state) => state.status === "running").length
}

export function canStartConversationRun(states: ConversationRunStates, id: string, limit = 3): boolean {
  return states[id]?.status !== "running" && countRunningConversations(states) < limit
}

export function finishConversationRun(id: string, activeId: string | null, updatedAt = Date.now()): ConversationRunState {
  return { status: id === activeId ? "idle" : "completed_unread", updatedAt }
}

export function stopConversationRun(updatedAt = Date.now()): ConversationRunState {
  return { status: "idle", updatedAt }
}

export function failConversationRun(error: string, updatedAt = Date.now()): ConversationRunState {
  return { status: "failed", error, updatedAt }
}

export function normalizeLoadedRunStates(states: ConversationRunStates | undefined, updatedAt = Date.now()): ConversationRunStates {
  return Object.fromEntries(Object.entries(states ?? {}).map(([id, state]) => [
    id,
    state.status === "running"
      ? { status: "interrupted", error: "任务在软件关闭前未完成。", updatedAt }
      : state,
  ]))
}
