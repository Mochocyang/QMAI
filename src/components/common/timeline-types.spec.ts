import { describe, expect, it } from "vitest"
import {
  createStreamingEventBuilder,
  interleaveThinkingWithToolCalls,
  type ToolCallEventItem,
} from "./timeline-types"

function createToolCall(
  id: string,
  status: ToolCallEventItem["status"],
): ToolCallEventItem {
  return {
    id,
    name: "read_chapter",
    description: "读取章节",
    category: "read",
    status,
  }
}

describe("createStreamingEventBuilder", () => {
  it("keeps both tool ids in order while replacing the second running call with done", () => {
    const builder = createStreamingEventBuilder("thinking")
    const firstCall = createToolCall("call-1", "running")
    const secondCall = createToolCall("call-2", "running")
    const doneSecondCall = { ...secondCall, status: "done" as const, result: "完成" }

    builder.update("正在读取章节", [firstCall, secondCall], true)
    const doneEvents = builder.update("正在读取章节", [firstCall, doneSecondCall], false)

    expect(doneEvents.slice(1).map((event) => event.data.id)).toEqual(["call-1", "call-2"])
    expect(doneEvents[2]).toEqual({ kind: "tool_call", data: doneSecondCall })
    expect(doneEvents[2]?.data).toBe(doneSecondCall)
  })

  it("keeps both tool ids in order while replacing the first running call with error", () => {
    const builder = createStreamingEventBuilder("thinking")
    const firstCall = createToolCall("call-1", "running")
    const secondCall = createToolCall("call-2", "running")
    const errorFirstCall = { ...firstCall, status: "error" as const, error: "读取失败" }

    builder.update("正在读取章节", [firstCall, secondCall], true)
    const errorEvents = builder.update("正在读取章节", [errorFirstCall, secondCall], false)

    expect(errorEvents.slice(1).map((event) => event.data.id)).toEqual(["call-1", "call-2"])
    expect(errorEvents[1]).toEqual({ kind: "tool_call", data: errorFirstCall })
    expect(errorEvents[1]?.data).toBe(errorFirstCall)
  })

  it("keeps all thinking content in one real block instead of slicing around tools", () => {
    const builder = createStreamingEventBuilder("thinking")
    const thinkingText = "先分析用户目标。再读取章节。最后整理结果。"
    const toolCalls = [
      createToolCall("call-1", "done"),
      createToolCall("call-2", "running"),
    ]

    const events = builder.update(thinkingText, toolCalls, true)
    const thinkingEvents = events.filter((event) => event.kind === "thinking")

    expect(events.map((event) => event.kind)).toEqual([
      "thinking",
      "tool_call",
      "tool_call",
    ])
    expect(thinkingEvents).toEqual([
      {
        kind: "thinking",
        data: {
          id: "thinking-current",
          content: thinkingText,
          streaming: true,
        },
      },
    ])
  })

  it("keeps the thinking id stable across content updates", () => {
    const builder = createStreamingEventBuilder("thinking")

    const firstEvents = builder.update("第一段", [], true)
    const secondEvents = builder.update("第一段和第二段", [], true)

    expect(firstEvents[0]?.data.id).toBe("thinking-current")
    expect(secondEvents[0]?.data.id).toBe("thinking-current")
  })

  it("keeps the thinking id stable after reset", () => {
    const builder = createStreamingEventBuilder("thinking")

    const firstEvents = builder.update("第一轮", [], true)
    builder.reset()
    const secondEvents = builder.update("第二轮", [], true)

    expect(firstEvents[0]?.data.id).toBe("thinking-current")
    expect(secondEvents[0]?.data.id).toBe("thinking-current")
  })

  it("returns an empty thinking placeholder while streaming without content or tools", () => {
    const builder = createStreamingEventBuilder("thinking")

    expect(builder.update("", [], true)).toEqual([
      {
        kind: "thinking",
        data: {
          id: "thinking-current",
          content: "",
          streaming: true,
        },
      },
    ])
  })
})

describe("interleaveThinkingWithToolCalls", () => {
  it("keeps non-empty thinking in one complete block before all tools", () => {
    const thinkingText = "先分析用户目标。再读取章节。最后整理结果。"
    const toolCalls = [
      createToolCall("call-1", "done"),
      createToolCall("call-2", "running"),
    ]

    const events = interleaveThinkingWithToolCalls(
      thinkingText,
      true,
      toolCalls,
      "thinking",
    )

    expect(events).toEqual([
      {
        kind: "thinking",
        data: {
          id: "thinking-0",
          content: thinkingText,
          streaming: true,
        },
      },
      { kind: "tool_call", data: toolCalls[0] },
      { kind: "tool_call", data: toolCalls[1] },
    ])
  })

  it("returns only tools for empty thinking", () => {
    const toolCalls = [
      createToolCall("call-1", "done"),
      createToolCall("call-2", "running"),
    ]

    expect(interleaveThinkingWithToolCalls("  ", false, toolCalls, "thinking")).toEqual([
      { kind: "tool_call", data: toolCalls[0] },
      { kind: "tool_call", data: toolCalls[1] },
    ])
  })
})
