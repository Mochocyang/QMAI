import { describe, expect, it } from "vitest"
import type { ChatMessage } from "./llm-providers"
import {
  hasUnreplayableToolAssistantReasoning,
  isReasoningDisabled,
  stripEmptyReasoningContent,
  withReasoningDisabled,
} from "./reasoning-retry"

const toolAssistant = (reasoning?: string): ChatMessage => ({
  role: "assistant",
  content: "",
  tool_calls: [{
    id: "call_1",
    type: "function",
    function: { name: "list_outlines", arguments: "{}" },
  }],
  ...(reasoning !== undefined ? { reasoning_content: reasoning } : {}),
})

describe("reasoning-retry", () => {
  it("treats missing or empty tool-assistant reasoning as unreplayable", () => {
    expect(hasUnreplayableToolAssistantReasoning([
      { role: "user", content: "写第45章" },
      toolAssistant(),
    ])).toBe(true)
    expect(hasUnreplayableToolAssistantReasoning([
      { role: "user", content: "写第45章" },
      toolAssistant(""),
    ])).toBe(true)
    expect(hasUnreplayableToolAssistantReasoning([
      { role: "user", content: "写第45章" },
      toolAssistant("   "),
    ])).toBe(true)
    expect(hasUnreplayableToolAssistantReasoning([
      { role: "user", content: "写第45章" },
      toolAssistant("先列大纲"),
    ])).toBe(false)
    expect(hasUnreplayableToolAssistantReasoning([
      { role: "user", content: "写第45章" },
      { role: "assistant", content: "直接写" },
    ])).toBe(false)
  })

  it("strips empty reasoning_content and keeps real thinking", () => {
    const stripped = stripEmptyReasoningContent([
      toolAssistant(""),
      toolAssistant("先列大纲"),
    ])
    expect(stripped[0]).not.toHaveProperty("reasoning_content")
    expect(stripped[1]?.reasoning_content).toBe("先列大纲")
  })

  it("withReasoningDisabled marks the next request as thinking off", () => {
    expect(isReasoningDisabled({ reasoning: { mode: "high" } })).toBe(false)
    const overrides = withReasoningDisabled({ reasoning: { mode: "high" } })
    expect(isReasoningDisabled({ reasoning: { mode: "high" } }, overrides)).toBe(true)
  })
})
