import { expect, test, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import {
  isTruncationFinishReason,
  parseAnthropicFinishReason,
  parseGoogleFinishReason,
  parseOpenAiFinishReason,
  parseResponsesFinishReason,
} from "./llm-providers"

vi.mock("./tauri-fetch", () => ({
  getHttpFetch: async () => mockFetch,
  isFetchNetworkError: () => false,
}))

let mockFetch: (url: string, init?: RequestInit) => Promise<Response> = async () => {
  throw new Error("mockFetch not configured")
}

function sseResponse(lines: string[]): Response {
  return new Response(lines.map((line) => `${line}\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}

function buildConfig(): LlmConfig {
  return {
    provider: "custom",
    apiKey: "test-key",
    model: "test-model",
    ollamaUrl: "",
    customEndpoint: "https://example.com/v1",
    maxContextSize: 100_000,
  } as LlmConfig
}

test("parseOpenAiFinishReason reads choices[0].finish_reason", () => {
  expect(
    parseOpenAiFinishReason('data: {"choices":[{"delta":{},"finish_reason":"length"}]}'),
  ).toBe("length")
  expect(
    parseOpenAiFinishReason('data: {"choices":[{"delta":{"content":"x"},"finish_reason":null}]}'),
  ).toBe(null)
  expect(parseOpenAiFinishReason("data: [DONE]")).toBe(null)
  expect(parseOpenAiFinishReason("event: ping")).toBe(null)
})

test("parseAnthropicFinishReason reads message_delta stop_reason", () => {
  expect(
    parseAnthropicFinishReason('data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}'),
  ).toBe("max_tokens")
  expect(
    parseAnthropicFinishReason('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}'),
  ).toBe(null)
})

test("parseGoogleFinishReason reads candidates[0].finishReason", () => {
  expect(
    parseGoogleFinishReason('data: {"candidates":[{"content":{"parts":[{"text":"x"}]},"finishReason":"MAX_TOKENS"}]}'),
  ).toBe("MAX_TOKENS")
  expect(
    parseGoogleFinishReason('data: {"candidates":[{"content":{"parts":[{"text":"x"}]}}]}'),
  ).toBe(null)
})

test("parseResponsesFinishReason reads incomplete_details.reason", () => {
  expect(
    parseResponsesFinishReason('data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}'),
  ).toBe("max_output_tokens")
  expect(
    parseResponsesFinishReason('data: {"type":"response.output_text.delta","delta":"x"}'),
  ).toBe(null)
})

test("isTruncationFinishReason only matches token-limit reasons", () => {
  expect(isTruncationFinishReason("length")).toBe(true)
  expect(isTruncationFinishReason("max_tokens")).toBe(true)
  expect(isTruncationFinishReason("MAX_TOKENS")).toBe(true)
  expect(isTruncationFinishReason("max_output_tokens")).toBe(true)
  expect(isTruncationFinishReason("stop")).toBe(false)
  expect(isTruncationFinishReason("end_turn")).toBe(false)
  expect(isTruncationFinishReason(null)).toBe(false)
  expect(isTruncationFinishReason(undefined)).toBe(false)
})

test("streamChat surfaces finish_reason=length as a tolerable truncation error", async () => {
  const { streamChat, isOutputTruncatedError } = await import("./llm-client")
  mockFetch = async () => sseResponse([
    'data: {"choices":[{"delta":{"content":"第一段"},"finish_reason":null}]}',
    "",
    'data: {"choices":[{"delta":{"content":"第二段"},"finish_reason":"length"}]}',
    "",
    "data: [DONE]",
  ])

  const tokens: string[] = []
  let doneCalled = false
  let error: Error | null = null
  await streamChat(
    buildConfig(),
    [{ role: "user", content: "写一章" }],
    {
      onToken: (token) => tokens.push(token),
      onDone: () => { doneCalled = true },
      onError: (err) => { error = err },
    },
    undefined,
    { skipUserMemory: true },
  )

  expect(tokens.join("")).toBe("第一段第二段")
  expect(doneCalled).toBe(false)
  expect(error).not.toBeNull()
  expect(error!.message).toContain("输出被截断")
  expect(error!.message).toContain("最大输出 token")
  expect(isOutputTruncatedError(error)).toBe(true)
})

test("streamChat with finish_reason=stop ends normally", async () => {
  const { streamChat } = await import("./llm-client")
  mockFetch = async () => sseResponse([
    'data: {"choices":[{"delta":{"content":"完整回答"},"finish_reason":null}]}',
    "",
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    "",
    "data: [DONE]",
  ])

  const tokens: string[] = []
  let doneCalled = false
  let error: Error | null = null
  await streamChat(
    buildConfig(),
    [{ role: "user", content: "问个问题" }],
    {
      onToken: (token) => tokens.push(token),
      onDone: () => { doneCalled = true },
      onError: (err) => { error = err },
    },
    undefined,
    { skipUserMemory: true },
  )

  expect(tokens.join("")).toBe("完整回答")
  expect(doneCalled).toBe(true)
  expect(error).toBeNull()
})
