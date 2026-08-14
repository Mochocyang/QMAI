import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat } from "./llm-client"
import { estimateChatMessagesTokens } from "./chat-request-budget"
import type { ChatMessage } from "./llm-providers"
import { thinkingMinMaxTokens } from "./llm-providers"
import {
  RESPONSE_RESERVE_FRAC,
  planLlmRequestBudget,
} from "./context-budget"
import { normalizeUserLlmMaxOutputTokens } from "./llm-context-size"

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  isFetchNetworkError: vi.fn(() => false),
  streamClaudeCodeCli: vi.fn(),
}))

vi.mock("./tauri-fetch", () => ({
  getHttpFetch: vi.fn(async () => mocks.fetch),
  isFetchNetworkError: (...args: unknown[]) => mocks.isFetchNetworkError(...args),
}))

vi.mock("./local-cli-config", () => ({
  resolveRuntimeLocalCliConfig: vi.fn(async (config: LlmConfig) => config),
}))

vi.mock("./claude-cli-transport", () => ({
  streamClaudeCodeCli: (...args: unknown[]) => mocks.streamClaudeCodeCli(...args),
}))

const config: LlmConfig = {
  provider: "openai",
  apiKey: "sk-test",
  model: "gpt-test",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 128_000,
}

describe("streamChat usage", () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.isFetchNetworkError.mockReset()
    mocks.isFetchNetworkError.mockReturnValue(false)
    mocks.streamClaudeCodeCli.mockReset()
  })

  it("requests and emits OpenAI stream usage once", async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          'data: {"choices":[{"delta":{"content":"完成"}}]}',
          'data: {"choices":[],"usage":{"prompt_tokens":1200,"completion_tokens":80,"total_tokens":1280,"prompt_tokens_details":{"cached_tokens":1024}}}',
          "data: [DONE]",
          "",
        ].join("\n")))
        controller.close()
      },
    })
    mocks.fetch.mockResolvedValue(new Response(body, { status: 200 }))
    const onUsage = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    const onRequestTrace = vi.fn()

    await streamChat(config, [
      {
        role: "system",
        content: [
          { type: "text", text: "固定规则" },
          { type: "text", text: "项目稳定核心", cacheControl: true },
          { type: "text", text: "动态任务" },
        ],
      },
      { role: "user", content: "测试" },
    ], {
      onToken: vi.fn(),
      onUsage,
      onRequestTrace,
      onDone,
      onError,
    })

    const request = mocks.fetch.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    })
    expect(onUsage).toHaveBeenCalledOnce()
    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 1200,
      outputTokens: 80,
      totalTokens: 1280,
      cachedInputTokens: 1024,
    })
    expect(onDone).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    expect(onRequestTrace).toHaveBeenCalledOnce()
    expect(onRequestTrace).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai",
      model: "gpt-test",
      prefixFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      inputTokens: 1200,
      outputTokens: 80,
      cacheReadTokens: 1024,
      status: "success",
    }))
  })

  it("同行 tool_calls 仍触发 onReasoningToken", async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          'data: {"choices":[{"delta":{"reasoning_content":"需要读章","tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_chapter","arguments":"{}"}}]}}]}',
          "data: [DONE]",
          "",
        ].join("\n")))
        controller.close()
      },
    })
    mocks.fetch.mockResolvedValue(new Response(body, { status: 200 }))
    const onReasoningToken = vi.fn()
    const onToolCallDelta = vi.fn()

    await streamChat(config, [{ role: "user", content: "写第一章" }], {
      onToken: vi.fn(),
      onReasoningToken,
      onToolCallDelta,
      onDone: vi.fn(),
      onError: vi.fn(),
    })

    expect(onReasoningToken).toHaveBeenCalledWith("需要读章")
    expect(onToolCallDelta).toHaveBeenCalledWith(expect.objectContaining({
      id: "call_1",
      name: "read_chapter",
    }))
  })

  it("does not treat reasoning plus tool calls as a reasoning-only failure", async () => {
    const thinking = "先列出大纲和章节再决定怎么写。".repeat(20)
    expect(thinking.length).toBeGreaterThan(200)
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          `data: {"choices":[{"delta":{"reasoning_content":${JSON.stringify(thinking)}}}]}`,
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"list_outlines","arguments":"{}"}}]}}]}',
          "data: [DONE]",
          "",
        ].join("\n")))
        controller.close()
      },
    })
    mocks.fetch.mockResolvedValue(new Response(body, { status: 200 }))
    const onError = vi.fn()
    const onToolCallDelta = vi.fn()
    const onDone = vi.fn()

    await streamChat(config, [{ role: "user", content: "写第45章" }], {
      onToken: vi.fn(),
      onToolCallDelta,
      onDone,
      onError,
    })

    expect(onToolCallDelta).toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
  })

  it("disables thinking and drops empty reasoning before a tool-follow-up request", async () => {
    mocks.fetch.mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"继续"}}]}',
      "data: [DONE]",
      "",
    ].join("\n"), { status: 200 }))
    const deepseekConfig: LlmConfig = {
      ...config,
      provider: "custom",
      model: "deepseek/deepseek-v4-flash",
      customEndpoint: "https://api.deepseek.com/v1",
      reasoning: { mode: "high" },
    }

    await streamChat(deepseekConfig, [
      { role: "user", content: "写第45章" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "list_outlines", arguments: "{}" },
        }],
        reasoning_content: "",
      },
      { role: "tool", content: "大纲列表", tool_call_id: "call_1", name: "list_outlines" },
    ], {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    })

    const request = mocks.fetch.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(request.body)) as {
      thinking?: { type: string }
      messages: Array<{ reasoning_content?: string }>
    }
    expect(body.thinking).toEqual({ type: "disabled" })
    expect(body.messages[1]).not.toHaveProperty("reasoning_content")
  })

  it("retries a reasoning_content 400 once with thinking disabled", async () => {
    const encoder = new TextEncoder()
    mocks.fetch
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          error: {
            message: "The reasoning_content in the thinking mode must be passed back to the API.",
            type: "invalid_request_error",
          },
        }),
        { status: 400 },
      ))
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode([
            'data: {"choices":[{"delta":{"content":"已继续"}}]}',
            "data: [DONE]",
            "",
          ].join("\n")))
          controller.close()
        },
      }), { status: 200 }))

    const deepseekConfig: LlmConfig = {
      ...config,
      provider: "custom",
      model: "deepseek/deepseek-v4-flash",
      customEndpoint: "https://api.deepseek.com/v1",
      reasoning: { mode: "high" },
    }
    const onToken = vi.fn()
    const onError = vi.fn()

    await streamChat(deepseekConfig, [
      { role: "user", content: "写第45章" },
      {
        role: "assistant",
        content: "先读大纲",
        reasoning_content: "看起来像思考但接口仍拒收",
      },
    ], {
      onToken,
      onDone: vi.fn(),
      onError,
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    const retryBody = JSON.parse(String((mocks.fetch.mock.calls[1][1] as RequestInit).body)) as {
      thinking?: { type: string }
    }
    expect(retryBody.thinking).toEqual({ type: "disabled" })
    expect(onToken).toHaveBeenCalledWith("已继续")
    expect(onError).not.toHaveBeenCalled()
  })

  it("发送前按 token 预算裁剪并保持系统与当前请求非空", async () => {
    mocks.fetch.mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"完成"}}]}',
      "data: [DONE]",
      "",
    ].join("\n"), { status: 200 }))

    // Window clamps to ≥204800; overflow with a large middle user turn so trim
    // must drop history while keeping the system + current-user ends intact.
    const windowTokens = 204_800
    const outputReserve = Math.floor(windowTokens * RESPONSE_RESERVE_FRAC)
    await streamChat({ ...config, maxContextSize: windowTokens }, [
      { role: "system", content: "系统".repeat(20_000) },
      { role: "user", content: "旧请求".repeat(90_000) },
      { role: "assistant", content: "旧回复".repeat(90_000) },
      { role: "user", content: `任务目标：续写。${"正文".repeat(40_000)}结尾限制：保持人物关系。` },
    ], {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    })

    const request = mocks.fetch.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(request.body)) as {
      messages: ChatMessage[]
      max_tokens?: number
    }
    expect(estimateChatMessagesTokens(body.messages)).toBeLessThanOrEqual(
      windowTokens - outputReserve,
    )
    expect(String(body.messages[0]?.content).trim()).not.toBe("")
    expect(body.messages.at(-1)?.content).toContain("任务目标")
    expect(body.messages.at(-1)?.content).toContain("保持人物关系")
  })

  it("超大受保护消息在归一化窗口下会被压缩后仍发送", async () => {
    // With maxContextSize clamped to ≥204800, the old "tiny window → hard fail"
    // path is unreachable through streamChat; protected ends are compressed
    // instead so the request can still leave.
    mocks.fetch.mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"完成"}}]}',
      "data: [DONE]",
      "",
    ].join("\n"), { status: 200 }))

    await streamChat({ ...config, maxContextSize: 204_800 }, [
      { role: "system", content: "系统".repeat(120_000) },
      { role: "user", content: "生成".repeat(120_000) },
    ], {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((mocks.fetch.mock.calls[0][1] as RequestInit).body)) as {
      messages: ChatMessage[]
    }
    expect(estimateChatMessagesTokens(body.messages)).toBeLessThan(204_800)
    expect(String(body.messages[0]?.content).trim()).not.toBe("")
    expect(String(body.messages.at(-1)?.content).trim()).not.toBe("")
  })

  it("调用方未传 max_tokens 时仍外发窗口比例预算", async () => {
    mocks.fetch.mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"完成"}}]}',
      "data: [DONE]",
      "",
    ].join("\n"), { status: 200 }))

    const planned = planLlmRequestBudget({
      maxContextSize: config.maxContextSize,
      desiredOutputTokens: Math.floor(
        Math.max(204_800, config.maxContextSize) * RESPONSE_RESERVE_FRAC,
      ),
      scaffoldReserveTokens: 0,
      minimumContextTokens: 64,
      maxOutputTokensCap: normalizeUserLlmMaxOutputTokens(config.maxOutputTokens),
    })

    await streamChat(config, [{ role: "user", content: "写第一章" }], {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    })

    const request = mocks.fetch.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      max_tokens: planned.outputTokens,
    })
  })

  it("reasoning.mode=auto 且调用方未传 max_tokens 时仍外发窗口比例预算", async () => {
    mocks.fetch.mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"完成"}}]}',
      "data: [DONE]",
      "",
    ].join("\n"), { status: 200 }))

    const planned = planLlmRequestBudget({
      maxContextSize: config.maxContextSize,
      desiredOutputTokens: Math.floor(
        Math.max(204_800, config.maxContextSize) * RESPONSE_RESERVE_FRAC,
      ),
      scaffoldReserveTokens: 0,
      minimumContextTokens: 64,
      maxOutputTokensCap: normalizeUserLlmMaxOutputTokens(config.maxOutputTokens),
    })

    await streamChat(
      { ...config, reasoning: { mode: "auto" } },
      [{ role: "user", content: "写第一章" }],
      { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
    )

    const request = mocks.fetch.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      max_tokens: planned.outputTokens,
    })
  })

  it("reasoning.mode=high 且调用方未传 max_tokens 时发送预算规划的 max_tokens", async () => {
    mocks.fetch.mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"完成"}}]}',
      "data: [DONE]",
      "",
    ].join("\n"), { status: 200 }))

    const reasoning = { mode: "high" as const }
    const thinkingFloorTokens = thinkingMinMaxTokens(reasoning)
    expect(thinkingFloorTokens).toBeGreaterThan(0)
    const windowTokens = Math.max(204_800, config.maxContextSize)
    const planned = planLlmRequestBudget({
      maxContextSize: windowTokens,
      desiredOutputTokens: Math.floor(windowTokens * RESPONSE_RESERVE_FRAC),
      scaffoldReserveTokens: 0,
      minimumContextTokens: 64,
      maxOutputTokensCap: normalizeUserLlmMaxOutputTokens(config.maxOutputTokens),
      thinkingFloorTokens,
    })

    await streamChat(
      { ...config, reasoning },
      [{ role: "user", content: "写第一章" }],
      { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
    )

    const request = mocks.fetch.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      max_tokens: planned.outputTokens,
    })
    expect(planned.outputTokens).toBeGreaterThanOrEqual(thinkingFloorTokens)
  })

  it("调用方显式传入的超大 max_tokens 收敛到输出上限", async () => {
    mocks.fetch.mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"完成"}}]}',
      "data: [DONE]",
      "",
    ].join("\n"), { status: 200 }))

    await streamChat(
      { ...config, maxContextSize: 1_000_000, maxOutputTokens: 65_536 },
      [{ role: "user", content: "写第一章" }],
      { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
      undefined,
      { max_tokens: 300_000 },
    )

    const request = mocks.fetch.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({ max_tokens: 65_536 })
  })

  it("本地 CLI 供应商不外发 max_tokens", async () => {
    mocks.streamClaudeCodeCli.mockImplementation(async (
      _config: LlmConfig,
      _messages: ChatMessage[],
      callbacks: { onToken: (token: string) => void; onDone: () => void },
      _signal?: AbortSignal,
      overrides?: { max_tokens?: number },
    ) => {
      expect(overrides).not.toHaveProperty("max_tokens")
      callbacks.onToken("ok")
      callbacks.onDone()
    })

    await streamChat(
      {
        ...config,
        provider: "claude-code",
        model: "claude-sonnet-5",
      },
      [{ role: "user", content: "写第一章" }],
      { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
      undefined,
      { max_tokens: 30_720 },
    )

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.streamClaudeCodeCli).toHaveBeenCalledTimes(1)
  })

  it("服务商回报 max_tokens 超限时按其上限重试一次", async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          error: {
            message: "max_tokens is too large: this model supports at most 8192 output tokens",
          },
        }),
        { status: 400 },
      ))
      .mockResolvedValueOnce(new Response([
        'data: {"choices":[{"delta":{"content":"完成"}}]}',
        "data: [DONE]",
        "",
      ].join("\n"), { status: 200 }))

    const onError = vi.fn()
    const onRequestTrace = vi.fn()
    await streamChat(config, [{ role: "user", content: "写第一章" }], {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onRequestTrace,
      onError,
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    const retryBody = JSON.parse(String((mocks.fetch.mock.calls[1][1] as RequestInit).body))
    expect(retryBody.max_tokens).toBe(8_192)
    expect(onError).not.toHaveBeenCalled()
    expect(onRequestTrace.mock.calls.map(([trace]) => trace.status)).toEqual(["error", "success"])
  })

  it("脏 SSE 行不会中断整轮流式响应", async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          'data: {"choices":[{"delta":{"content":"前半"}}]}',
          "data: {不是合法 JSON",
          'data: {"choices":[{"delta":{"content":"后半"}}]}',
          "data: [DONE]",
          "",
        ].join("\n")))
        controller.close()
      },
    })
    mocks.fetch.mockResolvedValue(new Response(body, { status: 200 }))
    const onToken = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()

    await streamChat(config, [{ role: "user", content: "写第一章" }], {
      onToken,
      onDone,
      onError,
    })

    expect(onToken).toHaveBeenCalledWith("前半")
    expect(onToken).toHaveBeenCalledWith("后半")
    expect(onDone).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
  })

  it("records a mid-stream network failure as network_error", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("connection dropped"))
      },
    })
    mocks.fetch.mockResolvedValue(new Response(body, { status: 200 }))
    mocks.isFetchNetworkError.mockReturnValue(true)
    const onRequestTrace = vi.fn()
    const onError = vi.fn()

    await streamChat(config, [{ role: "user", content: "测试网络中断" }], {
      onToken: vi.fn(),
      onRequestTrace,
      onDone: vi.fn(),
      onError,
    })

    expect(onRequestTrace).toHaveBeenCalledWith(expect.objectContaining({ status: "network_error" }))
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("流式响应读取中断"),
    }))
  })

  it("records an aborted supplier attempt as cancelled", async () => {
    mocks.fetch.mockRejectedValue(new DOMException("aborted", "AbortError"))
    const controller = new AbortController()
    controller.abort()
    const onRequestTrace = vi.fn()
    const onDone = vi.fn()

    await streamChat(config, [{ role: "user", content: "取消请求" }], {
      onToken: vi.fn(),
      onRequestTrace,
      onDone,
      onError: vi.fn(),
    }, controller.signal)

    expect(onRequestTrace).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }))
    expect(onDone).toHaveBeenCalledOnce()
  })
})
