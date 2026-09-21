import { afterEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import { isFetchNetworkError, streamChat } from "./llm-client"
import { resetHttpFetchForTests } from "./tauri-fetch"

afterEach(() => {
  resetHttpFetchForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("isFetchNetworkError cross-webview fetch failures", () => {
  it("recognises WebKit's Load failed error", () => {
    expect(isFetchNetworkError(new Error("Load failed"))).toBe(true)
  })

  it("recognises Chromium/Edge TypeError fetch failures", () => {
    expect(isFetchNetworkError(new TypeError("Failed to fetch"))).toBe(true)
  })

  it("recognises any TypeError as a Chromium fetch failure class", () => {
    expect(isFetchNetworkError(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true)
  })

  it("recognises messages containing network error", () => {
    expect(isFetchNetworkError(new Error("The network error occurred while reading"))).toBe(true)
  })

  it("recognises Tauri reqwest send failures", () => {
    expect(isFetchNetworkError(new Error("error sending request for url (https://freeapi.example/v1/chat/completions)"))).toBe(true)
  })

  it("recognises Tauri response body decoding failures", () => {
    expect(isFetchNetworkError(new Error("error decoding response body"))).toBe(true)
  })

  it("rejects AbortError because it means the user cancelled", () => {
    const e = new Error("The operation was aborted.")
    e.name = "AbortError"
    expect(isFetchNetworkError(e)).toBe(false)
  })

  it("rejects plain application errors", () => {
    expect(isFetchNetworkError(new Error("HTTP 401: Unauthorized"))).toBe(false)
  })

  it("rejects non-Error values", () => {
    expect(isFetchNetworkError("boom")).toBe(false)
    expect(isFetchNetworkError(null)).toBe(false)
    expect(isFetchNetworkError(undefined)).toBe(false)
    expect(isFetchNetworkError({ message: "Load failed" })).toBe(false)
  })
})

describe("streamChat network retry", () => {
  const config: LlmConfig = {
    provider: "custom",
    apiKey: "test-key",
    model: "test-model",
    ollamaUrl: "",
    customEndpoint: "https://freeapi.example/v1",
    maxContextSize: 120000,
    apiMode: "chat_completions",
  }

  it("waits and retries transient request-send failures before reporting an error", async () => {
    vi.useFakeTimers()
    const response = new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "重试成功" } }] })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n"), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("error sending request for url (https://freeapi.example/v1/chat/completions)"))
      .mockResolvedValueOnce(response)
    vi.stubGlobal("fetch", fetchMock)

    const tokens: string[] = []
    let done = false
    let error: Error | null = null
    const pending = streamChat(
      config,
      [{ role: "user", content: "生成第一章内容" }],
      {
        onToken: (token) => tokens.push(token),
        onDone: () => { done = true },
        onError: (err) => { error = err },
      },
    )

    await vi.runAllTimersAsync()
    await pending

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(tokens.join("")).toBe("重试成功")
    expect(done).toBe(true)
    expect(error).toBeNull()
  })

  it("reports a clear Chinese message after transient request-send failures are exhausted", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockRejectedValue(new Error("error sending request for url (https://freeapi.example/v1/chat/completions)"))
    vi.stubGlobal("fetch", fetchMock)

    let done = false
    let error: Error | null = null
    const pending = streamChat(
      config,
      [{ role: "user", content: "generate chapter" }],
      {
        onToken: () => {},
        onDone: () => { done = true },
        onError: (err) => { error = err },
      },
    )

    await vi.runAllTimersAsync()
    await pending

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(done).toBe(false)
    const errorMessage = (error as Error | null)?.message ?? ""
    expect(errorMessage).toContain("无法连接到模型接口")
    expect(errorMessage).toContain("已自动等待并重试约 5 分钟")
    expect(errorMessage).toContain("网络不稳定")
    expect(errorMessage).toContain("代理不可用")
  })

  it("keeps request-send retries alive until the five-minute retry window is exhausted", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockRejectedValue(new Error("error sending request for url (https://freeapi.example/v1/chat/completions)"))
    vi.stubGlobal("fetch", fetchMock)

    let done = false
    let error: Error | null = null
    const pending = streamChat(
      config,
      [{ role: "user", content: "generate chapter" }],
      {
        onToken: () => {},
        onDone: () => { done = true },
        onError: (err) => { error = err },
      },
    )

    await vi.advanceTimersByTimeAsync(299_999)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(done).toBe(false)
    expect(error).toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    await pending

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(done).toBe(false)
    expect((error as Error | null)?.message ?? "").toContain("已自动等待并重试约 5 分钟")
  })

  it("does not keep retrying after the user cancels during the retry wait", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("error sending request for url (https://freeapi.example/v1/chat/completions)"))
    vi.stubGlobal("fetch", fetchMock)

    let done = false
    let error: Error | null = null
    const pending = streamChat(
      config,
      [{ role: "user", content: "generate chapter" }],
      {
        onToken: () => {},
        onDone: () => { done = true },
        onError: (err) => { error = err },
      },
      controller.signal,
    )

    await vi.advanceTimersByTimeAsync(1)
    controller.abort()
    await vi.runAllTimersAsync()
    await pending

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(done).toBe(true)
    expect(error).toBeNull()
  })

  it("reports reasoning-only responses in Chinese", async () => {
    const response = new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning: "思考".repeat(120) } }] })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n"), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal("fetch", fetchMock)

    let done = false
    let error: Error | null = null
    await streamChat(
      config,
      [{ role: "user", content: "继续写下一章" }],
      {
        onToken: () => {},
        onDone: () => { done = true },
        onError: (err) => { error = err },
      },
    )

    expect(done).toBe(false)
    const errorMessage = (error as Error | null)?.message ?? ""
    expect(errorMessage).toContain("模型只输出了")
    expect(errorMessage).toContain("思考内容")
    expect(errorMessage).toContain("没有输出正文")
    expect(errorMessage).not.toContain("max_tokens")
  })

  it("reports input-length HTTP 400 errors in Chinese", async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          code: "InvalidParameter",
          message: "Input length 205467 exceeds the maximum length 202752.",
        },
      }),
      {
        status: 400,
        statusText: "Bad Request",
        headers: { "Content-Type": "application/json" },
      },
    )
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal("fetch", fetchMock)

    let error: Error | null = null
    await streamChat(
      config,
      [{ role: "user", content: "继续写下一章" }],
      {
        onToken: () => {},
        onDone: () => {},
        onError: (err) => { error = err },
      },
    )

    const errorMessage = (error as Error | null)?.message ?? ""
    expect(errorMessage).toContain("输入内容过长")
    expect(errorMessage).toContain("205467")
    expect(errorMessage).toContain("202752")
  })

  it("retries once with trimmed messages when the endpoint reports a smaller real input limit", async () => {
    const inputTooLong = new Response(
      JSON.stringify({
        error: {
          code: "InvalidParameter",
          message: "Input length 205467 exceeds the maximum length 202752.",
        },
      }),
      {
        status: 400,
        statusText: "Bad Request",
        headers: { "Content-Type": "application/json" },
      },
    )
    const success = new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n"), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(inputTooLong)
      .mockResolvedValueOnce(success)
    vi.stubGlobal("fetch", fetchMock)

    const tokens: string[] = []
    let done = false
    let error: Error | null = null
    await streamChat(
      { ...config, maxContextSize: 1_000_000 },
      [
        { role: "system", content: "system" },
        { role: "assistant", content: "a".repeat(205_000) },
        { role: "user", content: "continue next chapter" },
      ],
      {
        onToken: (token) => tokens.push(token),
        onDone: () => { done = true },
        onError: (err) => { error = err },
      },
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const retriedBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { messages: Array<{ content: string }> }
    const retriedLength = retriedBody.messages.reduce((sum, message) => sum + String(message.content).length, 0)
    expect(retriedLength).toBeLessThanOrEqual(Math.floor(202_752 * 0.85))
    expect(retriedBody.messages[retriedBody.messages.length - 1]?.content).toBe("continue next chapter")
    expect(tokens.join("")).toBe("ok")
    expect(done).toBe(true)
    expect(error).toBeNull()
  })
})
