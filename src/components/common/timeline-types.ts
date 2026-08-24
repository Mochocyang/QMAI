import type { ToolCallStatus } from "@/lib/agent/types"

export type TimelineToolCategory = "read" | "write" | "action" | "virtual"

const WRITE_TOOLS = new Set([
  "write_chapter",
  "write_outline_node",
  "write_memory",
  "write_chapter_outline",
])
const READ_TOOLS = new Set([
  "list_chapters", "list_outlines", "list_memories", "list_deductions",
  "read_chapter", "read_outline", "read_memory", "read_deduction",
  "read_chat_history", "read_outline_history", "search_chapters",
  "chapter_context", "chapter_previous_analysis", "load_context", "trim_context",
  "web_search", "read_web_page",
])
const ACTION_TOOLS = new Set(["route_task", "apply_skill", "summarize_search_results"])

export function getTimelineToolCategory(name: string): TimelineToolCategory {
  if (WRITE_TOOLS.has(name)) return "write"
  if (READ_TOOLS.has(name)) return "read"
  if (ACTION_TOOLS.has(name)) return "action"
  return "virtual"
}

export function compareToolCallsByStartedAt(
  a: { id: string; startedAt?: number },
  b: { id: string; startedAt?: number },
): number {
  const aStart = a.startedAt ?? Number.MAX_SAFE_INTEGER
  const bStart = b.startedAt ?? Number.MAX_SAFE_INTEGER
  if (aStart !== bStart) return aStart - bStart
  return a.id.localeCompare(b.id)
}

/**
 * 隐藏已有子步骤的父工具（如 run_chapter_workflow），避免父级一直「运行中」置顶、与子步骤双轨重复。
 * 尚无子步骤时仍展示父级，作为工作流刚启动的占位。
 */
export function filterToolCallsForDisplay<T extends { id: string; parentCallId?: string }>(
  calls: T[],
): T[] {
  const parentIdsWithChildren = new Set<string>()
  for (const call of calls) {
    if (call.parentCallId) parentIdsWithChildren.add(call.parentCallId)
  }
  if (parentIdsWithChildren.size === 0) return calls
  return calls.filter((call) => !parentIdsWithChildren.has(call.id))
}

export interface ToolCallEventItem {
  id: string
  name: string
  description: string
  category: TimelineToolCategory
  status: ToolCallStatus
  params?: Record<string, unknown>
  result?: string
  error?: string
  startedAt?: number
  finishedAt?: number
}

export interface ThinkingEventItem {
  id: string
  content: string
  streaming: boolean
}

export type TimelineToolGroupKind = "chapters" | "context"

export interface ToolCallGroupItem {
  id: string
  kind: TimelineToolGroupKind
  label: string
  items: ToolCallEventItem[]
  durationMs?: number
}

export type TimelineEvent =
  | { kind: "thinking"; data: ThinkingEventItem }
  | { kind: "tool_call"; data: ToolCallEventItem }
  | { kind: "tool_group"; data: ToolCallGroupItem }

export function interleaveThinkingWithToolCalls(
  thinkingText: string,
  thinkingStreaming: boolean,
  toolCalls: ToolCallEventItem[],
  thinkingIdPrefix: string,
): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const trimmedThinking = thinkingText.trim()

  if (trimmedThinking) {
    events.push({
      kind: "thinking",
      data: {
        id: `${thinkingIdPrefix}-0`,
        content: trimmedThinking,
        streaming: thinkingStreaming,
      },
    })
  }

  for (const call of toolCalls) {
    events.push({ kind: "tool_call", data: call })
  }

  return events
}

interface StreamingEventBuilder {
  update: (
    thinkingText: string,
    toolCalls: ToolCallEventItem[],
    thinkingStreaming: boolean,
  ) => TimelineEvent[]
  reset: () => void
}

export function createStreamingEventBuilder(thinkingIdPrefix: string): StreamingEventBuilder {
  const thinkingId = `${thinkingIdPrefix}-current`

  return {
    update(thinkingText, toolCalls, thinkingStreaming) {
      const events: TimelineEvent[] = []
      const trimmedThinking = thinkingText.trim()

      if (trimmedThinking) {
        events.push({
          kind: "thinking",
          data: {
            id: thinkingId,
            content: trimmedThinking,
            streaming: thinkingStreaming,
          },
        })
      } else if (thinkingStreaming && toolCalls.length === 0) {
        events.push({
          kind: "thinking",
          data: {
            id: thinkingId,
            content: "",
            streaming: true,
          },
        })
      }

      for (const call of toolCalls) {
        events.push({ kind: "tool_call", data: call })
      }

      return events
    },

    reset() {},
  }
}
