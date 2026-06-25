import { describe, expect, it } from "vitest"
import { getProviderConfig } from "./llm-providers"
import { resolveUserVisibleReasoning } from "./user-visible-reasoning"
import type { LlmConfig } from "@/stores/wiki-store"

function customAutoConfig(): LlmConfig {
  return {
    provider: "custom",
    apiKey: "sk-test",
    model: "qwen3-235b-a22b",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "https://example.test/v1",
    maxContextSize: 204800,
    apiMode: "chat_completions",
    reasoning: { mode: "auto" },
  }
}

describe("user visible reasoning", () => {
  it("keeps auto reasoning as auto for visible AI chat generation", () => {
    expect(resolveUserVisibleReasoning({ mode: "auto" })).toEqual({ mode: "auto" })
    expect(resolveUserVisibleReasoning(undefined)).toEqual({ mode: "auto" })
  })

  it("keeps explicit reasoning settings unchanged", () => {
    expect(resolveUserVisibleReasoning({ mode: "off" })).toEqual({ mode: "off" })
    expect(resolveUserVisibleReasoning({ mode: "medium" })).toEqual({ mode: "medium" })
    expect(resolveUserVisibleReasoning({ mode: "custom", budgetTokens: 6000 })).toEqual({
      mode: "custom",
      budgetTokens: 6000,
    })
  })

  it("leaves auto as auto on the OpenAI-compatible wire (no explicit thinking request)", () => {
    const config = customAutoConfig()
    const body = getProviderConfig(config).buildBody(
      [{ role: "user", content: "继续写下一章" }],
      { reasoning: resolveUserVisibleReasoning(config.reasoning) },
    ) as Record<string, unknown>

    expect(body.reasoning_effort).toBeUndefined()
    expect(body.chat_template_kwargs).toBeUndefined()
  })
})
