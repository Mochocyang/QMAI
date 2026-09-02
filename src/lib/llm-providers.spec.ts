import { describe, expect, it } from "vitest"
import { getCustomCompatibleHeaders, getProviderConfig, parseGoogleLine, parseOpenAiSseError, withCustomOriginHeader } from "./llm-providers"
import { filterDeAiOutput } from "./novel/de-ai-output"
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

describe("OpenAI SSE error lines", () => {
  it("reads cursor-api-proxy agent_exit errors instead of treating them as empty content", () => {
    expect(
      parseOpenAiSseError(
        'data: {"error":{"message":"The Cursor agent process exited with code 1. See server logs for details.","code":"cursor_cli_error"}}',
      ),
    ).toBe("The Cursor agent process exited with code 1. See server logs for details.")
    expect(parseOpenAiSseError("data: [DONE]")).toBeNull()
    expect(parseOpenAiSseError('data: {"choices":[{"delta":{"content":"hi"}}]}')).toBeNull()
  })
})

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

  it("defaults Anthropic max_tokens to the window-fraction reserve, not 4096", () => {
    const body = getProviderConfig(customConfig({
      apiMode: "anthropic_messages",
      maxContextSize: 204_800,
    })).buildBody(
      [{ role: "user", content: "请回答。" }],
    ) as { max_tokens: number }

    expect(body.max_tokens).toBe(30_720)
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

  it("omits empty assistant reasoning_content instead of replaying an empty string", () => {
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

    expect(body.messages[1]).not.toHaveProperty("reasoning_content")
  })

  it("replays non-empty assistant reasoning_content", () => {
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
        reasoning_content: "先读章节",
      },
    ]) as { messages: Array<{ reasoning_content?: string }> }

    expect(body.messages[1]?.reasoning_content).toBe("先读章节")
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

  it("leaves max_tokens absent for MiMo thinking when the caller did not set one", () => {
    const body = requestBody(customConfig({
      model: "mimo-v2.5-pro",
      reasoning: { mode: "high" },
    }))

    expect(body).not.toHaveProperty("max_tokens")
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true })
  })

  it("leaves max_tokens absent for MiMo detected by endpoint", () => {
    const body = requestBody(customConfig({
      model: "custom-alias",
      customEndpoint: "https://token-plan-cn.xiaomimimo.com/v1",
      reasoning: { mode: "medium" },
    }))

    expect(body).not.toHaveProperty("max_tokens")
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true })
  })

  it("never rewrites an explicit max_tokens for MiMo thinking", () => {
    const bodyWithOverride = getProviderConfig(customConfig({
      model: "mimo-v2.5-pro",
      reasoning: { mode: "high" },
    })).buildBody(
      [{ role: "user", content: "test" }],
      { max_tokens: 32000 },
    ) as Record<string, unknown>

    expect(bodyWithOverride.max_tokens).toBe(32000)
    expect(bodyWithOverride.chat_template_kwargs).toEqual({ enable_thinking: true })
  })

  it("turns MiMo thinking off when the planned output cannot hold it", () => {
    const body = getProviderConfig(customConfig({
      model: "mimo-v2.5-pro",
      reasoning: { mode: "high" },
    })).buildBody(
      [{ role: "user", content: "test" }],
      { max_tokens: 2048 },
    ) as Record<string, unknown>

    expect(body.max_tokens).toBe(2048)
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
    expect(body).not.toHaveProperty("reasoning_effort")
  })

  it("turns GLM-5 thinking off when the planned output cannot hold it", () => {
    const body = getProviderConfig(customConfig({
      model: "glm-5-plus",
      customEndpoint: "https://open.bigmodel.cn/api/paas/v4",
      reasoning: { mode: "high" },
    })).buildBody(
      [{ role: "user", content: "test" }],
      { max_tokens: 2048 },
    ) as Record<string, unknown>

    expect(body.max_tokens).toBe(2048)
    expect(body.thinking).toEqual({ type: "disabled" })
    expect(body).not.toHaveProperty("reasoning_effort")
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

  it("leaves max_tokens absent for Qwen3 thinking at medium level", () => {
    const body = requestBody(customConfig({
      model: "qwen3-235b-a22b",
      reasoning: { mode: "medium" },
    }))

    expect(body).not.toHaveProperty("max_tokens")
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true })
  })

  it("leaves max_tokens absent for DeepSeek thinking at low level", () => {
    const body = requestBody(customConfig({
      model: "deepseek-v4-flash",
      reasoning: { mode: "low" },
    }))

    expect(body.thinking).toEqual({ type: "enabled" })
    expect(body).not.toHaveProperty("max_tokens")
  })

  it("turns DeepSeek thinking off when the planned output cannot hold it", () => {
    const body = getProviderConfig(customConfig({
      model: "deepseek-v4-flash",
      reasoning: { mode: "high" },
    })).buildBody(
      [{ role: "user", content: "test" }],
      { max_tokens: 2048 },
    ) as Record<string, unknown>

    expect(body.max_tokens).toBe(2048)
    expect(body.thinking).toEqual({ type: "disabled" })
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

describe("Qwen3.5/3.6 leading system coalesce", () => {
  const dualSystem = [
    { role: "system" as const, content: "软件规则" },
    { role: "system" as const, content: "## 任务契约\n写下一章" },
    { role: "user" as const, content: "开始写" },
  ]

  function rolesAndContent(config: LlmConfig, messages = dualSystem) {
    const body = getProviderConfig(config).buildBody(messages) as {
      messages?: Array<{ role: string; content: unknown }>
      input?: Array<{ role: string; content: unknown }>
    }
    return body.messages ?? body.input ?? []
  }

  it("does not invent a system message for user-only Qwen3.6 requests", () => {
    const messages = rolesAndContent(
      customConfig({ model: "qwen3.6-35b-q4km:latest" }),
      [{ role: "user", content: "写第一章" }],
    )
    expect(messages).toEqual([{ role: "user", content: "写第一章" }])
  })

  it("leaves a single leading system in place", () => {
    const messages = rolesAndContent(
      customConfig({ model: "qwen3.6-plus" }),
      [
        { role: "system", content: "软件规则" },
        { role: "user", content: "开始写" },
      ],
    )
    expect(messages).toEqual([
      { role: "system", content: "软件规则" },
      { role: "user", content: "开始写" },
    ])
  })

  it("merges consecutive leading systems for Qwen3.6 OpenAI-compatible requests", () => {
    const messages = rolesAndContent(customConfig({ model: "qwen3.6-35b-q4km:latest" }))
    expect(messages).toEqual([
      { role: "system", content: "软件规则\n\n## 任务契约\n写下一章" },
      { role: "user", content: "开始写" },
    ])
  })

  it("merges a mid-conversation system into the leading system for Qwen3.6", () => {
    const messages = rolesAndContent(
      customConfig({ model: "qwen/qwen3.6-27b" }),
      [
        { role: "system", content: "软件规则" },
        { role: "user", content: "写" },
        { role: "assistant", content: "好" },
        { role: "system", content: "必须调用工具" },
      ],
    )
    expect(messages.map((message) => message.role)).toEqual(["system", "user", "assistant"])
    expect(messages[0]?.content).toBe("软件规则\n\n必须调用工具")
    expect(messages[1]?.content).toBe("写")
    expect(messages[2]?.content).toBe("好")
  })

  it("moves a non-leading system to the front for Qwen3.5", () => {
    const messages = rolesAndContent(
      customConfig({ model: "qwen3.5:397b" }),
      [
        { role: "user", content: "写" },
        { role: "system", content: "软件规则" },
      ],
    )
    expect(messages).toEqual([
      { role: "system", content: "软件规则" },
      { role: "user", content: "写" },
    ])
  })

  it("keeps cache-prefixed system text before later system content", () => {
    const messages = rolesAndContent(
      customConfig({ model: "qwen3.6-plus" }),
      [
        {
          role: "system",
          content: [
            { type: "text", text: "软件规则" },
            { type: "text", text: "稳定项目核心", cacheControl: true },
          ],
        },
        { role: "system", content: "任务契约" },
        { role: "user", content: "写" },
      ],
    )
    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({
      role: "system",
      content: "软件规则稳定项目核心\n\n任务契约",
    })
    expect(messages[1]?.role).toBe("user")
  })

  it("also coalesces Qwen3.6 on the native ollama provider", () => {
    const messages = rolesAndContent(customConfig({
      provider: "ollama",
      model: "qwen3.6-35b-q4km:latest",
    }))
    expect(messages.map((message) => message.role)).toEqual(["system", "user"])
    expect(messages[0]?.content).toContain("软件规则")
    expect(messages[0]?.content).toContain("任务契约")
  })

  it("coalesces Qwen3.6 Responses API input the same way", () => {
    const messages = rolesAndContent(customConfig({
      apiMode: "responses",
      model: "qwen3.6-plus",
    }))
    expect(messages).toEqual([
      { role: "system", content: "软件规则\n\n## 任务契约\n写下一章" },
      { role: "user", content: "开始写" },
    ])
  })

  it("does not coalesce dual systems for gpt-4o on openai or custom", () => {
    for (const config of [
      customConfig({ provider: "openai", model: "gpt-4o" }),
      customConfig({ model: "gpt-4o" }),
    ]) {
      const messages = rolesAndContent(config)
      expect(messages.map((message) => message.role)).toEqual(["system", "system", "user"])
      expect(messages[0]?.content).toBe("软件规则")
      expect(messages[1]?.content).toBe("## 任务契约\n写下一章")
    }
  })

  it("does not coalesce dual systems for DeepSeek", () => {
    const messages = rolesAndContent(customConfig({
      model: "deepseek-chat",
      customEndpoint: "https://api.deepseek.com/v1",
    }))
    expect(messages.map((message) => message.role)).toEqual(["system", "system", "user"])
  })

  it("does not coalesce dual systems for plain Qwen3", () => {
    const messages = rolesAndContent(customConfig({ model: "qwen3-235b-a22b" }))
    expect(messages.map((message) => message.role)).toEqual(["system", "system", "user"])
  })

  it("does not coalesce dual systems for Qwen3-Coder or Qwen2.5", () => {
    for (const model of ["qwen3-coder-plus", "qwen2.5-72b"]) {
      const messages = rolesAndContent(customConfig({ model }))
      expect(messages.map((message) => message.role), model).toEqual(["system", "system", "user"])
    }
  })

  it("does not coalesce gpt Responses API input", () => {
    const messages = rolesAndContent(customConfig({
      apiMode: "responses",
      model: "gpt-5.4",
    }))
    expect(messages.map((message) => message.role)).toEqual(["system", "system", "user"])
  })
})

describe("Gemini thought summaries", () => {
  function googleConfig(overrides: Partial<LlmConfig> = {}): LlmConfig {
    return customConfig({
      provider: "google",
      model: "gemini-3.7-flash-preview",
      ...overrides,
    })
  }

  function googleLine(...parts: string[]): string {
    return `data: ${JSON.stringify({
      candidates: [{ content: { parts: parts.map((text) => ({ text })) } }],
    })}`
  }

  it("does not return thought:true parts as visible content", () => {
    const line = 'data: {"candidates":[{"content":{"parts":[{"text":"先拆章纲","thought":true},{"text":"雨还在下。"}]}}]}'
    expect(parseGoogleLine(line)).toBe("雨还在下。")
  })

  it("does not return unmarked thought-summary parts as visible content", () => {
    const dump = "**Defining the Request**\\n\\nThe user wants the full text for Chapter 14."
    const line = `data: {"candidates":[{"content":{"parts":[{"text":"${dump}"},{"text":"雨还在下。"}]}}]}`
    expect(parseGoogleLine(line)).toBe("雨还在下。")
  })

  it("filters a thought summary split across Gemini SSE events and parts at the completed-result boundary", () => {
    const body = "地下暗轨深处，空气沉得像一汪死水。叶刃没有回头。"
    const lines = [
      googleLine(
        "I'm currently focused on defining the project scope, prioritizing ",
        "the objective: refining the novel snippet to align with the \"去 AI 味\" skill's instructions.",
      ),
      googleLine(
        "\n\n**Examining the Narrative Details**\n\n",
        "I'm now diving deep into analyzing the source text and preserving its key conflicts.",
      ),
      googleLine(
        "\n\n**Analyzing the Conflict's Dynamics**\n\n",
        "I've been mapping out the escalating conflict within the narrative's framework.",
      ),
      googleLine(`\n\n${body}`),
    ]

    // parseGoogleLine is stateless, so a single event or part cannot reliably
    // identify a summary whose evidence is spread across the completed payload.
    // Do not constrain how much the provider can discard eagerly; the business
    // boundary must still guarantee that only the revised body survives.
    const completed = lines
      .map((line) => parseGoogleLine(line))
      .filter((text): text is string => text !== null)
      .join("")

    expect(filterDeAiOutput(completed)).toBe(body)
  })

  it("hides thought summaries on Gemini 3.x even in auto reasoning mode", () => {
    const body = getProviderConfig(googleConfig()).buildBody(
      [{ role: "user", content: "写第14章" }],
    ) as { generationConfig?: { thinkingConfig?: Record<string, unknown> } }

    expect(body.generationConfig?.thinkingConfig).toEqual({ includeThoughts: false })
  })

  it("keeps thinkingBudget:0 and still hides thoughts when reasoning is off", () => {
    const body = getProviderConfig(googleConfig({ reasoning: { mode: "off" } })).buildBody(
      [{ role: "user", content: "写第14章" }],
    ) as { generationConfig?: { thinkingConfig?: Record<string, unknown> } }

    expect(body.generationConfig?.thinkingConfig).toEqual({
      thinkingBudget: 0,
      includeThoughts: false,
    })
  })

  it("does not send thinkingConfig for models that do not support it", () => {
    const body = getProviderConfig(googleConfig({ model: "gemini-1.5-pro" })).buildBody(
      [{ role: "user", content: "写第14章" }],
    ) as Record<string, unknown>

    expect(body.generationConfig).toBeUndefined()
  })
})
