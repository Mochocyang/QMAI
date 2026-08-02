import { describe, expect, it } from "vitest"
import {
  formatReasoningReplayRiskForError,
  isReasoningContentRequiredError,
  summarizeReasoningReplayRisk,
} from "./reasoning-replay-debug"

describe("reasoning replay debug", () => {
  it("detects the DeepSeek/Kimi reasoning_content 400 message", () => {
    expect(isReasoningContentRequiredError(
      'HTTP 400: Bad Request — {"error":{"message":"The reasoning_content in the thinking mode must be passed back to the API."}}',
    )).toBe(true)
  })

  it("flags tool-call assistants missing reasoning_content", () => {
    const summary = summarizeReasoningReplayRisk([
      { role: "user", content: "写第一章" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "read_chapter", arguments: "{}" },
        }],
      },
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call_2",
          type: "function",
          function: { name: "read_outline", arguments: "{}" },
        }],
        reasoning_content: "",
      },
    ])

    expect(summary.assistantWithTools).toBe(2)
    expect(summary.missingReasoningOnToolAssistants).toBe(1)
    expect(summary.emptyReasoningOnToolAssistants).toBe(1)
    expect(formatReasoningReplayRiskForError(summary)).toContain("missing=1")
    expect(formatReasoningReplayRiskForError(summary)).toContain("reasoning=MISSING")
  })
})
