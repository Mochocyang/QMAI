import { describe, expect, it } from "vitest"
import { getCustomCompatibleHeaders, getProviderConfig, withCustomOriginHeader } from "./llm-providers"
import type { LlmConfig, ReasoningMode } from "@/stores/wiki-store"

function customConfig(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    provider: "custom",
    apiKey: "sk-test",
    model: "gpt-5.4",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "https://example.test/v1",
    maxContextSize: 204800,
    apiMode: "chat_completions",
    reasoning: { mode: "auto" },
    ...overrides,
  }
}

function requestBody(config: LlmConfig): Record<string, unknown> {
  return getProviderConfig(config).buildBody([
    { role: "user", content: "请回答。" },
  ]) as Record<string, unknown>
}

describe("llm provider reasoning options", () => {
  it("sends reasoning_effort for explicit custom OpenAI-compatible reasoning mode", () => {
    const body = requestBody(customConfig({ reasoning: { mode: "high" } }))

    expect(body.reasoning_effort).toBe("high")
  })

  it("enables Qwen3 thinking when explicit reasoning is enabled", () => {
    const body = requestBody(customConfig({
      model: "qwen3-235b-a22b",
      reasoning: { mode: "high" },
    }))

    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true })
    expect(body.reasoning_effort).toBe("high")
  })

  it("keeps Qwen3 thinking disabled when reasoning is off", () => {
    const body = requestBody(customConfig({
      model: "qwen3-235b-a22b",
      reasoning: { mode: "off" },
    }))

    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
    expect(body).not.toHaveProperty("reasoning_effort")
  })

  it.each<ReasoningMode>(["max", "custom"])("maps Responses API %s reasoning to high effort", (mode) => {
    const body = requestBody(customConfig({
      apiMode: "responses",
      customEndpoint: "https://example.test/v1",
      reasoning: mode === "custom" ? { mode, budgetTokens: 12000 } : { mode },
    }))

    expect(body.reasoning).toEqual({ effort: "high" })
  })
})

describe("custom provider headers", () => {
  it("clears Origin for remote custom gateways", () => {
    expect(getCustomCompatibleHeaders("sk-test", "https://example.test/v1/chat/completions")).toMatchObject({
      Authorization: "Bearer sk-test",
      Origin: "",
    })
  })

  it("keeps localhost Origin only for local endpoints", () => {
    expect(getCustomCompatibleHeaders("", "http://localhost:11434/v1/chat/completions")).toMatchObject({
      Origin: "http://localhost",
    })
  })

  it("preserves existing auth headers when clearing Origin", () => {
    expect(withCustomOriginHeader({ "x-api-key": "sk-test" }, "https://example.test/v1/messages")).toEqual({
      "x-api-key": "sk-test",
      Origin: "",
    })
  })

  it("clears Origin for actual custom OpenAI-compatible chat requests", () => {
    expect(getProviderConfig(customConfig()).headers).toMatchObject({
      Authorization: "Bearer sk-test",
      Origin: "",
    })
  })

  it("clears Origin for actual custom Responses API requests", () => {
    expect(getProviderConfig(customConfig({ apiMode: "responses" })).headers).toMatchObject({
      Authorization: "Bearer sk-test",
      Origin: "",
    })
  })

  it("clears Origin for actual custom Anthropic-compatible requests", () => {
    expect(getProviderConfig(customConfig({ apiMode: "anthropic_messages" })).headers).toMatchObject({
      "x-api-key": "sk-test",
      Origin: "",
    })
  })
})

describe("prompt caching cache_control breakpoints", () => {
  const cachedMessage = [{
    role: "user" as const,
    content: [
      { type: "text" as const, text: "STABLE_PREFIX", cacheControl: true },
      { type: "text" as const, text: "STAGE_SPECIFIC" },
    ],
  }]

  it("emits Anthropic cache_control on the flagged prefix block and leaves the rest plain", () => {
    const body = getProviderConfig(customConfig({ apiMode: "anthropic_messages" }))
      .buildBody(cachedMessage) as Record<string, unknown>
    const messages = body.messages as Array<{ role: string; content: unknown }>

    expect(messages[0].content).toEqual([
      { type: "text", text: "STABLE_PREFIX", cache_control: { type: "ephemeral" } },
      { type: "text", text: "STAGE_SPECIFIC" },
    ])
  })

  it("collapses the same blocks to a byte-identical string for OpenAI-compatible wires (cache marker ignored)", () => {
    const body = getProviderConfig(customConfig({ apiMode: "chat_completions" }))
      .buildBody(cachedMessage) as Record<string, unknown>
    const messages = body.messages as Array<{ role: string; content: unknown }>

    // OpenAI/DeepSeek 走自动前缀缓存：纯文本块折叠回与原字符串逐字节一致的内容。
    expect(messages[0].content).toBe("STABLE_PREFIXSTAGE_SPECIFIC")
  })

  it("keeps the legacy string-collapse path when no block is flagged for caching", () => {
    const plainBlocks = [{
      role: "user" as const,
      content: [
        { type: "text" as const, text: "A" },
        { type: "text" as const, text: "B" },
      ],
    }]
    const body = getProviderConfig(customConfig({ apiMode: "anthropic_messages" }))
      .buildBody(plainBlocks) as Record<string, unknown>
    const messages = body.messages as Array<{ role: string; content: unknown }>

    expect(messages[0].content).toBe("AB")
  })
})
