import { describe, expect, it } from "vitest"
import { accumulateToolCalls } from "./tool-call-parser"
import type { ToolCallDelta } from "./types"

describe("accumulateToolCalls", () => {
  it("accumulates streaming deltas into complete tool calls", () => {
    const deltas: ToolCallDelta[] = [
      { index: 0, id: "call_1" },
      { index: 0, name: "read_chapter" },
      { index: 0, arguments: '{"name"' },
      { index: 0, arguments: ':"第1章"}' },
    ]
    const result = accumulateToolCalls(deltas)
    expect(result).toEqual([
      {
        id: "call_1",
        type: "function",
        function: {
          name: "read_chapter",
          arguments: '{"name":"第1章"}',
        },
      },
    ])
  })

  it("handles multiple tool calls in sequence", () => {
    const deltas: ToolCallDelta[] = [
      { index: 0, id: "call_1", name: "read_chapter" },
      { index: 0, arguments: '{"name":"第1章"}' },
      { index: 1, id: "call_2", name: "read_memory" },
      { index: 1, arguments: '{"name":"曙光"}' },
    ]
    const result = accumulateToolCalls(deltas)
    expect(result).toHaveLength(2)
    expect(result[0].function.arguments).toEqual('{"name":"第1章"}')
    expect(result[1].function.arguments).toEqual('{"name":"曙光"}')
  })

  it("handles empty deltas", () => {
    expect(accumulateToolCalls([])).toEqual([])
  })

  it("preserves malformed JSON in arguments", () => {
    const deltas: ToolCallDelta[] = [
      { index: 0, id: "call_1" },
      { index: 0, arguments: "not json" },
    ]
    const result = accumulateToolCalls(deltas)
    expect(result[0].function.arguments).toBe("not json")
  })
})
