import { describe, expect, it } from "vitest"
import { groupTimelineEvents } from "./timeline-grouping"
import type {
  TimelineEvent,
  TimelineToolCategory,
  ToolCallEventItem,
} from "./timeline-types"

function toolCall(
  id: string,
  name: string,
  options: Partial<ToolCallEventItem> = {},
): ToolCallEventItem {
  return {
    id,
    name,
    description: name,
    category: "read",
    status: "done",
    ...options,
  }
}

function toolEvent(item: ToolCallEventItem): TimelineEvent {
  return { kind: "tool_call", data: item }
}

function thinkingEvent(id = "thinking-current"): TimelineEvent {
  return {
    kind: "thinking",
    data: { id, content: "分析过程", streaming: false },
  }
}

describe("groupTimelineEvents", () => {
  it("groups consecutive completed chapter reads with a stable id and summed positive duration", () => {
    const first = toolCall("call-1", "read_chapter", { startedAt: 10, finishedAt: 30 })
    const second = toolCall("call-2", "read_chapter", { startedAt: 50, finishedAt: 90 })
    const events = [toolEvent(first), toolEvent(second)]

    const firstResult = groupTimelineEvents(events)
    const secondResult = groupTimelineEvents(events)

    expect(firstResult).toEqual([
      {
        kind: "tool_group",
        data: {
          id: 'tool-group:["chapters","call-1","call-2"]',
          kind: "chapters",
          label: "已读取章节",
          items: [first, second],
          durationMs: 60,
        },
      },
    ])
    expect(secondResult[0]?.data.id).toBe(firstResult[0]?.data.id)
  })

  it("groups consecutive completed context reads under the resources and memory label", () => {
    const calls = [
      toolCall("call-1", "list_chapters"),
      toolCall("call-2", "read_memory"),
      toolCall("call-3", "search_chapters"),
      toolCall("call-4", "load_context"),
    ]

    expect(groupTimelineEvents(calls.map(toolEvent))).toEqual([
      {
        kind: "tool_group",
        data: {
          id: 'tool-group:["context","call-1","call-2","call-3","call-4"]',
          kind: "context",
          label: "已读取资料与记忆",
          items: calls,
        },
      },
    ])
  })

  it("uses every item id so groups with the same endpoints cannot collide", () => {
    const firstGroup = [
      toolCall("call-1", "read_chapter"),
      toolCall("call-middle-a", "read_chapter"),
      toolCall("call-3", "read_chapter"),
    ]
    const secondGroup = [
      toolCall("call-1", "read_chapter"),
      toolCall("call-middle-b", "read_chapter"),
      toolCall("call-3", "read_chapter"),
    ]

    const firstId = groupTimelineEvents(firstGroup.map(toolEvent))[0]?.data.id
    const repeatedFirstId = groupTimelineEvents(firstGroup.map(toolEvent))[0]?.data.id
    const secondId = groupTimelineEvents(secondGroup.map(toolEvent))[0]?.data.id

    expect(firstId).toBe(repeatedFirstId)
    expect(firstId).not.toBe(secondId)
  })

  it("keeps a single safe read as its original tool event", () => {
    const event = toolEvent(toolCall("call-1", "read_outline"))

    const result = groupTimelineEvents([event])

    expect(result).toEqual([event])
    expect(result[0]).toBe(event)
  })

  it("treats thinking and action tools as boundaries without changing them", () => {
    const firstRead = toolEvent(toolCall("call-1", "read_chapter"))
    const thinking = thinkingEvent()
    const secondRead = toolEvent(toolCall("call-2", "read_chapter"))
    const action = toolEvent(toolCall("call-3", "route_task", { category: "action" }))
    const thirdRead = toolEvent(toolCall("call-4", "read_chapter"))

    const events = [firstRead, thinking, secondRead, action, thirdRead]
    const result = groupTimelineEvents(events)

    expect(result).toEqual(events)
    result.forEach((event, index) => expect(event).toBe(events[index]))
  })

  it("keeps write tools and non-done read statuses unchanged as grouping boundaries", () => {
    const boundaryStatuses: ToolCallEventItem["status"][] = [
      "running",
      "error",
      "approval_required",
      "cancelled",
    ]
    const events: TimelineEvent[] = [
      toolEvent(toolCall("write-1", "write_chapter", {
        category: "write" satisfies TimelineToolCategory,
        status: "done",
      })),
      ...boundaryStatuses.map((status, index) => toolEvent(toolCall(
        `read-${index + 1}`,
        "read_chapter",
        { status },
      ))),
    ]

    const result = groupTimelineEvents(events)

    expect(result).toEqual(events)
    result.forEach((event, index) => expect(event).toBe(events[index]))
  })

  it("ignores zero and negative tool durations when calculating a group duration", () => {
    const first = toolCall("call-1", "read_chapter", { startedAt: 10, finishedAt: 40 })
    const zero = toolCall("call-2", "read_chapter", { startedAt: 50, finishedAt: 50 })
    const negative = toolCall("call-3", "read_chapter", { startedAt: 90, finishedAt: 60 })

    const result = groupTimelineEvents([
      toolEvent(first),
      toolEvent(zero),
      toolEvent(negative),
    ])

    expect(result[0]).toMatchObject({
      kind: "tool_group",
      data: { durationMs: 30 },
    })
  })
})
