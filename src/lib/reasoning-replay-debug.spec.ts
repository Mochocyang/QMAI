import { afterEach, describe, expect, it, vi } from "vitest"

const invokeMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))
vi.mock("./platform", () => ({ isTauri: () => true }))

import {
  formatReasoningReplayRiskForError,
  isReasoningContentRequiredError,
  logReasoningReplay,
  summarizeReasoningReplayRisk,
} from "./reasoning-replay-debug"

afterEach(() => {
  invokeMock.mockClear()
  vi.restoreAllMocks()
})

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

  it("forwards collection diagnostics without using the frontend error channel", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})

    logReasoningReplay("stream.collected", {
      model: "deepseek/deepseek-v4-flash",
      contentCharsEmitted: 499,
      reasoningCharsObserved: 469,
    })

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("log_diagnostic", {
        message: expect.stringContaining("[reasoning-replay] stream.collected"),
      })
    })
    expect(invokeMock).not.toHaveBeenCalledWith("log_error", expect.anything())
  })
})
