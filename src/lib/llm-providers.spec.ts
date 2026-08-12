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
  it("keeps Anthropic thinking inside the caller's max_tokens budget", () => {
    const body = getProviderConfig(customConfig({
      apiMode: "anthropic_messages",
      reasoning: { mode: "high" },
    })).buildBody(
      [{ role: "user", content: "请回答。" }],
      { max_tokens: 4_096 },
    ) as {
      max_tokens: number
      thinking?: { type: string; budget_tokens: number }
    }

    expect(body.max_tokens).toBe(4_096)
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 3_584 })
  })

  it("does not inflate an Anthropic output budget too small for explicit thinking", () => {
    const body = getProviderConfig(customConfig({
      apiMode: "anthropic_messages",
      reasoning: { mode: "high" },
    })).buildBody(
      [{ role: "user", content: "请回答。" }],
      { max_tokens: 512 },
    ) as Record<string, unknown>

    expect(body.max_tokens).toBe(512)
    expect(body).not.toHaveProperty("thinking")
  })

  it("replays assistant reasoning_content including empty string", () => {
    const body = getProviderConfig(customConfig()).buildBody([
      { role: "user", content: "写第一章" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "read_chapter", arguments: "{}" },
        }],
        reasoning_content: "",
      },
      { role: "tool", content: "章节内容", tool_call_id: "call_1", name: "read_chapter" },
    ]) as { messages: Array<{ reasoning_content?: string }> }

    expect(body.messages[1]?.reasoning_content).toBe("")
  })

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

  it("enables MiMo thinking via model name when reasoning is enabled", () => {
    const body = requestBody(customConfig({
      model: "mimo-v2.5-pro",
      reasoning: { mode: "high" },
    }))

    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true })
  })

  it("disables MiMo thinking via model name when reasoning is off", () => {
    const body = requestBody(customConfig({
      model: "MiMo-v2-pro",
      reasoning: { mode: "off" },
    }))

    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
  })

  it("enables MiMo thinking via xiaomimimo.com endpoint even with custom model name", () => {
    const body = requestBody(customConfig({
      model: "custom-model-alias",
      customEndpoint: "https://api.xiaomimimo.com/v1",
      reasoning: { mode: "high" },
    }))

    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true })
  })

  it("disables MiMo thinking via xiaomimimo.com endpoint when reasoning is off", () => {
    const body = requestBody(customConfig({
      model: "some-alias",
      customEndpoint: "https://token-plan-cn.xiaomimimo.com/v1",
      reasoning: { mode: "off" },
    }))

    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
  })

  it("enables GLM-5 thinking on bigmodel.cn when reasoning is enabled", () => {
    const body = requestBody(customConfig({
      model: "glm-5-plus",
      customEndpoint: "https://open.bigmodel.cn/api/paas/v4",
      reasoning: { mode: "high" },
    }))

    expect(body.thinking).toEqual({ type: "enabled" })
  })

  it("disables GLM-5 thinking on bigmodel.cn when reasoning is off", () => {
    const body = requestBody(customConfig({
      model: "GLM-5",
      customEndpoint: "https://open.bigmodel.cn/api/paas/v4",
      reasoning: { mode: "off" },
    }))

    expect(body.thinking).toEqual({ type: "disabled" })
  })

  it("does not send GLM thinking object for non-Zhipu endpoints", () => {
    const body = requestBody(customConfig({
      model: "glm-5-self-hosted",
      customEndpoint: "https://my-vllm.example.com/v1",
      reasoning: { mode: "high" },
    }))

    expect(body).not.toHaveProperty("thinking")
  })

  it("boosts max_tokens for MiMo when thinking is enabled without explicit max_tokens", () => {
    const body = requestBody(customConfig({
      model: "mimo-v2.5-pro",
      reasoning: { mode: "high" },
    }))

    expect(body.max_tokens).toBe(16384)
  })

  it("boosts max_tokens for MiMo via endpoint detection", () => {
    const body = requestBody(customConfig({
      model: "custom-alias",
      customEndpoint: "https://token-plan-cn.xiaomimimo.com/v1",
      reasoning: { mode: "medium" },
    }))

    expect(body.max_tokens).toBe(8192)
  })

  it("does not override explicit larger max_tokens for MiMo thinking", () => {
    const body = requestBody(customConfig({
      model: "mimo-v2.5-pro",
      reasoning: { mode: "high" },
    }))
    // Build body with explicit max_tokens override
    const bodyWithOverride = getProviderConfig(customConfig({
      model: "mimo-v2.5-pro",
      reasoning: { mode: "high" },
    })).buildBody(
      [{ role: "user", content: "test" }],
      { max_tokens: 32000 },
    ) as Record<string, unknown>

    expect(bodyWithOverride.max_tokens).toBe(32000)
    expect(body.max_tokens).toBe(16384)
  })

  it("does not set max_tokens for MiMo when thinking is off", () => {
    const body = requestBody(customConfig({
      model: "mimo-v2.5-pro",
      reasoning: { mode: "off" },
    }))

    expect(body).not.toHaveProperty("max_tokens")
  })

  it("does not set max_tokens for MiMo in auto mode", () => {
    const body = requestBody(customConfig({
      model: "mimo-v2.5-pro",
      reasoning: { mode: "auto" },
    }))

    expect(body).not.toHaveProperty("max_tokens")
  })

  it("boosts max_tokens for Qwen3 thinking at medium level", () => {
    const body = requestBody(customConfig({
      model: "qwen3-235b-a22b",
      reasoning: { mode: "medium" },
    }))

    expect(body.max_tokens).toBe(8192)
  })

  it("boosts max_tokens for DeepSeek thinking at low level", () => {
    const body = requestBody(customConfig({
      model: "deepseek-v4-flash",
      reasoning: { mode: "low" },
    }))

    expect(body.thinking).toEqual({ type: "enabled" })
    expect(body.max_tokens).toBe(4096)
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

describe("internal request overrides", () => {
  it.each([
    ["OpenAI-compatible", customConfig()],
    ["Responses API", customConfig({ apiMode: "responses" })],
    ["Anthropic Messages", customConfig({ apiMode: "anthropic_messages" })],
    ["Gemini", customConfig({ provider: "google", model: "gemini-2.5-pro" })],
  ])("does not send user-memory control fields through %s", (_label, config) => {
    const body = getProviderConfig(config).buildBody(
      [{ role: "user", content: "测试请求" }],
      {
        temperature: 0.2,
        skipUserMemory: true,
        userMemorySurface: "ai-chat",
        userMemoryProjectKey: "project-1",
        userMemorySessionKey: "session-1",
      },
    ) as Record<string, unknown>
    const serialized = JSON.stringify(body)

    expect(serialized).not.toContain("skipUserMemory")
    expect(serialized).not.toContain("userMemorySurface")
    expect(serialized).not.toContain("userMemoryProjectKey")
    expect(serialized).not.toContain("userMemorySessionKey")
  })

  it("sends snake_case tool_choice without leaking camelCase toolChoice", () => {
    const tools = [{
      type: "function",
      function: {
        name: "read_chapter",
        description: "read",
        parameters: { type: "object", properties: {} },
      },
    }]
    const body = getProviderConfig(customConfig()).buildBody(
      [{ role: "user", content: "测试请求" }],
      {
        temperature: 0.2,
        tools,
        toolChoice: "auto",
      },
    ) as Record<string, unknown>

    expect(body.tools).toEqual(tools)
    expect(body.tool_choice).toBe("auto")
    expect(body).not.toHaveProperty("toolChoice")
    expect(JSON.stringify(body)).not.toContain("toolChoice")
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

  it("preserves a cache breakpoint in Anthropic top-level system content", () => {
    const body = getProviderConfig(customConfig({ apiMode: "anthropic_messages" }))
      .buildBody([{
        role: "system",
        content: [
          { type: "text", text: "软件规则\n" },
          { type: "text", text: "稳定项目核心", cacheControl: true },
          { type: "text", text: "\n动态上下文" },
        ],
      }]) as Record<string, unknown>

    expect(body.system).toEqual([
      { type: "text", text: "软件规则\n" },
      { type: "text", text: "稳定项目核心", cache_control: { type: "ephemeral" } },
      { type: "text", text: "\n动态上下文" },
    ])
  })

  it("keeps legacy Anthropic system strings unchanged without a breakpoint", () => {
    const body = getProviderConfig(customConfig({ apiMode: "anthropic_messages" }))
      .buildBody([{ role: "system", content: "原有系统提示词" }]) as Record<string, unknown>

    expect(body.system).toBe("原有系统提示词")
  })

  it("ignores cache markers safely on Gemini while preserving all text", () => {
    const body = getProviderConfig(customConfig({
      provider: "google",
      model: "gemini-2.5-pro",
    })).buildBody([{
      role: "system",
      content: [
        { type: "text", text: "稳定项目核心", cacheControl: true },
        { type: "text", text: "动态上下文" },
      ],
    }]) as Record<string, any>

    expect(body.systemInstruction.parts).toEqual([{ text: "稳定项目核心动态上下文" }])
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
