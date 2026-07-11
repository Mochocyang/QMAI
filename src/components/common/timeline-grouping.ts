import type {
  TimelineEvent,
  TimelineToolGroupKind,
  ToolCallEventItem,
  ToolCallGroupItem,
} from "./timeline-types"

const CONTEXT_READ_TOOLS = new Set([
  "list_chapters",
  "list_outlines",
  "list_memories",
  "list_deductions",
  "read_outline",
  "read_memory",
  "read_deduction",
  "read_chat_history",
  "read_outline_history",
  "search_chapters",
  "chapter_context",
  "chapter_previous_analysis",
  "load_context",
  "trim_context",
])

function getGroupKind(item: ToolCallEventItem): TimelineToolGroupKind | null {
  if (item.status !== "done" || item.category !== "read") return null
  if (item.name === "read_chapter") return "chapters"
  if (CONTEXT_READ_TOOLS.has(item.name)) return "context"
  return null
}

function createGroup(kind: TimelineToolGroupKind, items: ToolCallEventItem[]): TimelineEvent {
  const durationMs = items.reduce((total, item) => {
    if (item.startedAt === undefined || item.finishedAt === undefined) return total
    const duration = item.finishedAt - item.startedAt
    return duration > 0 ? total + duration : total
  }, 0)
  const data: ToolCallGroupItem = {
    id: `tool-group:${JSON.stringify([kind, ...items.map((item) => item.id)])}`,
    kind,
    label: kind === "chapters" ? "已读取章节" : "已读取资料与记忆",
    items,
    ...(durationMs > 0 ? { durationMs } : {}),
  }

  return { kind: "tool_group", data }
}

export function groupTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  const groupedEvents: TimelineEvent[] = []
  let index = 0

  while (index < events.length) {
    const event = events[index]
    if (event.kind !== "tool_call") {
      groupedEvents.push(event)
      index += 1
      continue
    }

    const groupKind = getGroupKind(event.data)
    if (!groupKind) {
      groupedEvents.push(event)
      index += 1
      continue
    }

    const items = [event.data]
    let nextIndex = index + 1
    while (nextIndex < events.length) {
      const nextEvent = events[nextIndex]
      if (nextEvent.kind !== "tool_call" || getGroupKind(nextEvent.data) !== groupKind) break
      items.push(nextEvent.data)
      nextIndex += 1
    }

    if (items.length >= 2) {
      groupedEvents.push(createGroup(groupKind, items))
      index = nextIndex
    } else {
      groupedEvents.push(event)
      index += 1
    }
  }

  return groupedEvents
}
