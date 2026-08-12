import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat } from "./llm-client"
import { estimateChatMessagesTokens } from "./chat-request-budget"
import type { ChatMessage } from "./llm-providers"
import { LlmContextBudgetError } from "./context-budget"

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

vi.mock("./tauri-fetch", () => ({
  getHttpFetch: vi.fn(async () => mocks.fetch),
  isFetchNetworkError: vi.fn(() => false),
}))

vi.mock("./local-cli-config", () => ({
  resolveRuntimeLocalCliConfig: vi.fn(async (config: LlmConfig) => config),
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

    await streamChat(config, [{ role: "user", content: "测试" }], {
      onToken: vi.fn(),
      onUsage,
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

  it("发送前按 token 预算裁剪并保持系统与当前请求非空", async () => {
    mocks.fetch.mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"完成"}}]}',
      "data: [DONE]",
      "",
    ].join("\n"), { status: 200 }))

    await streamChat({ ...config, maxContextSize: 4_096 }, [
      { role: "system", content: "系统".repeat(450) },
      { role: "user", content: `任务目标：续写。${"正文".repeat(450)}结尾限制：保持人物关系。` },
    ], {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    })

    const request = mocks.fetch.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(request.body)) as {
      messages: ChatMessage[]
      max_tokens: number
    }
    expect(estimateChatMessagesTokens(body.messages)).toBeLessThanOrEqual(512)
    expect(body.max_tokens).toBe(512)
    expect(String(body.messages[0]?.content).trim()).not.toBe("")
    expect(body.messages.at(-1)?.content).toContain("任务目标")
    expect(body.messages.at(-1)?.content).toContain("保持人物关系")
  })

  it("上下文无法容纳最小输出时明确失败且不调用供应商", async () => {
    await expect(streamChat({ ...config, maxContextSize: 2_000 }, [
      { role: "system", content: "系统约束" },
      { role: "user", content: "生成第一卷完整大纲" },
    ], {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    })).rejects.toBeInstanceOf(LlmContextBudgetError)

    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
