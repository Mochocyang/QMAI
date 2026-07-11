import type { ToolCallStatus } from "@/lib/agent/types"

export type TimelineToolCategory = "read" | "write" | "action" | "virtual"

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

export interface EventStreamProps {
  events: TimelineEvent[]
  isStreaming: boolean
  totalDurationMs?: number
  totalTokens?: number
}

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

export interface StreamingEventBuilder {
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
