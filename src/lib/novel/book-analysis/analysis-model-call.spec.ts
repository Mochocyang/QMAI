import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  REASONING_ONLY_ANALYSIS_MESSAGE,
  callAnalysisModelText,
} from "@/lib/novel/book-analysis/analysis-model-call"
import { isReasoningOnlyResponseError } from "@/lib/reasoning-retry"
import type { ChatMessage } from "@/lib/llm-client"

const mocks = vi.hoisted(() => ({ streamChat: vi.fn() }))

vi.mock("@/lib/llm-client", () => ({ streamChat: mocks.streamChat }))

/** 与 llm-client 实际抛出的文案同形（见 llm-client.ts:877-883 的拼装）。 */
function reasoningOnlyError() {
  return new Error("模型只输出了 17,331 字符的思考内容，但没有输出正文。")
}

const llmConfig = { model: "m", provider: "deepseek", apiKey: "k" } as never
const messages: ChatMessage[] = [{ role: "user", content: "分析这本小说" }]

type Handlers = {
  onToken?: (t: string) => void
  onDone?: () => void
  onError?: (e: Error) => void
}

/** 让某一次调用成功吐出 text。 */
function succeedWith(text: string) {
  return async (_c: unknown, _m: unknown, cb: Handlers) => {
    cb.onToken?.(text)
    cb.onDone?.()
  }
}

/** 让某一次调用报「只有思考、没有正文」。 */
function failReasoningOnly() {
  return async (_c: unknown, _m: unknown, cb: Handlers) => {
    cb.onError?.(reasoningOnlyError())
  }
}

/** 读取某一次调用的 requestOverrides（streamChat 的第 5 个参数）。 */
function overridesOf(index: number) {
  return mocks.streamChat.mock.calls[index][4] as
    | { reasoning?: { mode?: string } }
    | undefined
}

beforeEach(() => {
  mocks.streamChat.mockReset()
})

describe("callAnalysisModelText", () => {
  it("正常返回时只调用一次，并 trim 结果", async () => {
    mocks.streamChat.mockImplementationOnce(succeedWith("  正文  "))
    const text = await callAnalysisModelText(llmConfig, messages)
    expect(text).toBe("正文")
    expect(mocks.streamChat).toHaveBeenCalledTimes(1)
  })

  it("首次思考-only 时关掉思考重发一次，并返回重试结果", async () => {
    mocks.streamChat.mockImplementationOnce(failReasoningOnly())
    mocks.streamChat.mockImplementationOnce(succeedWith("重试后的正文"))
    const text = await callAnalysisModelText(llmConfig, messages)
    expect(text).toBe("重试后的正文")
    expect(mocks.streamChat).toHaveBeenCalledTimes(2)
    // 第一次不带 reasoning 覆盖（沿用调用点原样），第二次强制 off。
    expect(overridesOf(0)).toBeUndefined()
    expect(overridesOf(1)?.reasoning).toEqual({ mode: "off" })
  })

  it("两次都思考-only 时抛终态文案，且只重发一次", async () => {
    mocks.streamChat.mockImplementationOnce(failReasoningOnly())
    mocks.streamChat.mockImplementationOnce(failReasoningOnly())
    await expect(callAnalysisModelText(llmConfig, messages)).rejects.toThrow(
      REASONING_ONLY_ANALYSIS_MESSAGE,
    )
    expect(mocks.streamChat).toHaveBeenCalledTimes(2)
  })

  it("原本就关了思考时不重试，原样抛出", async () => {
    mocks.streamChat.mockImplementationOnce(failReasoningOnly())
    await expect(
      callAnalysisModelText(
        { ...(llmConfig as object), reasoning: { mode: "off" } } as never,
        messages,
      ),
    ).rejects.toThrow(reasoningOnlyError())
    expect(mocks.streamChat).toHaveBeenCalledTimes(1)
  })

  it("非思考-only 的错误不重试，原样抛出", async () => {
    mocks.streamChat.mockImplementationOnce(async (_c: unknown, _m: unknown, cb: Handlers) => {
      cb.onError?.(new Error("HTTP 500"))
    })
    await expect(callAnalysisModelText(llmConfig, messages)).rejects.toThrow("HTTP 500")
    expect(mocks.streamChat).toHaveBeenCalledTimes(1)
  })

  it("signal 已取消时抛取消文案且不重试", async () => {
    const controller = new AbortController()
    controller.abort()
    mocks.streamChat.mockImplementationOnce(succeedWith("不该被采用"))
    await expect(
      callAnalysisModelText(llmConfig, messages, {
        signal: controller.signal,
        cancelMessage: "用户取消文风分析",
      }),
    ).rejects.toThrow("用户取消文风分析")
    expect(mocks.streamChat).toHaveBeenCalledTimes(1)
  })

  it("baseOverrides 原样保留，关思考重试时把 reasoning 合并进去", async () => {
    mocks.streamChat.mockImplementationOnce(failReasoningOnly())
    mocks.streamChat.mockImplementationOnce(succeedWith("ok"))
    await callAnalysisModelText(llmConfig, messages, {
      baseOverrides: { skipUserMemory: true, max_tokens: 8000, temperature: 0.2 },
    })
    expect(overridesOf(0)).toMatchObject({
      skipUserMemory: true,
      max_tokens: 8000,
      temperature: 0.2,
    })
    expect(overridesOf(0)?.reasoning).toBeUndefined()
    expect(overridesOf(1)).toMatchObject({
      skipUserMemory: true,
      max_tokens: 8000,
      temperature: 0.2,
      reasoning: { mode: "off" },
    })
  })

  it("失败时通过 onPartialText 交出该次尝试已收到的文本", async () => {
    mocks.streamChat.mockImplementationOnce(async (_c: unknown, _m: unknown, cb: Handlers) => {
      cb.onToken?.("半截内容")
      cb.onError?.(new Error("HTTP 500"))
    })
    const seen: string[] = []
    await expect(
      callAnalysisModelText(llmConfig, messages, {
        onPartialText: (text) => seen.push(text),
      }),
    ).rejects.toThrow("HTTP 500")
    expect(seen).toEqual(["半截内容"])
  })

  it("重试那轮吐了半截再失败时，交出的是重试那版的文本", async () => {
    mocks.streamChat.mockImplementationOnce(failReasoningOnly())
    mocks.streamChat.mockImplementationOnce(async (_c: unknown, _m: unknown, cb: Handlers) => {
      cb.onToken?.("重试时的半截内容")
      cb.onError?.(new Error("HTTP 500"))
    })
    const seen: string[] = []
    await expect(
      callAnalysisModelText(llmConfig, messages, {
        onPartialText: (text) => seen.push(text),
      }),
    ).rejects.toThrow("HTTP 500")
    expect(mocks.streamChat).toHaveBeenCalledTimes(2)
    // 两次失败各回调一次；最后一次必须是重试那版，而不是第一次的空串。
    expect(seen).toEqual(["", "重试时的半截内容"])
  })

  it("重试成功后正常返回，回调不会污染返回值", async () => {
    mocks.streamChat.mockImplementationOnce(async (_c: unknown, _m: unknown, cb: Handlers) => {
      cb.onToken?.("第一次的半截")
      cb.onError?.(reasoningOnlyError())
    })
    mocks.streamChat.mockImplementationOnce(succeedWith("重试后的完整正文"))
    const seen: string[] = []
    const text = await callAnalysisModelText(llmConfig, messages, {
      onPartialText: (value) => seen.push(value),
    })
    expect(text).toBe("重试后的完整正文")
    expect(seen).toEqual(["第一次的半截"])
  })

  it("streamChat 直接抛出（不走 onError）时也要交回本轮已收到的半截正文", async () => {
    // llm-client 有些失败是直接 throw 的（provider 配置/网络问题，:401/479/505），
    // 不走 onError 回调。这时若只在 await 之后记录缓冲，半截正文就会丢。
    mocks.streamChat.mockImplementationOnce(async (_c: unknown, _m: unknown, cb: Handlers) => {
      cb.onToken?.("抛出前已收到的内容")
      throw new Error("streamChat 直接抛出")
    })
    const seen: string[] = []
    await expect(
      callAnalysisModelText(llmConfig, messages, {
        onPartialText: (text) => seen.push(text),
      }),
    ).rejects.toThrow("streamChat 直接抛出")
    expect(seen).toEqual(["抛出前已收到的内容"])
  })

  it("终态文案不再被识别为思考-only，避免上层再重试一次", () => {
    // 这是刻意维持的性质：agent/runner.ts:378 与 sources/outline-chat-panel.tsx:428
    // 都用同一个判定决定要不要重试。终态一旦匹配上，就会第三次重发整个 prompt。
    expect(isReasoningOnlyResponseError(new Error(REASONING_ONLY_ANALYSIS_MESSAGE))).toBe(false)
    // 反向对照：真正的 llm-client 诊断文案必须仍然匹配，否则重试根本不会触发。
    expect(isReasoningOnlyResponseError(reasoningOnlyError())).toBe(true)
  })

  it("用户取消时不回调 onPartialText，调用点不会把取消写成草稿", async () => {
    const controller = new AbortController()
    mocks.streamChat.mockImplementationOnce(async (_c: unknown, _m: unknown, cb: Handlers) => {
      cb.onToken?.("取消前收到的半截")
      controller.abort()
      cb.onDone?.()
    })
    const seen: string[] = []
    await expect(
      callAnalysisModelText(llmConfig, messages, {
        signal: controller.signal,
        cancelMessage: "用户取消文风分析",
        onPartialText: (text) => seen.push(text),
      }),
    ).rejects.toThrow("用户取消文风分析")
    expect(seen).toEqual([])
    expect(mocks.streamChat).toHaveBeenCalledTimes(1)
  })

  it("重试途中被取消时也不回调 onPartialText", async () => {
    const controller = new AbortController()
    mocks.streamChat.mockImplementationOnce(failReasoningOnly())
    mocks.streamChat.mockImplementationOnce(async (_c: unknown, _m: unknown, cb: Handlers) => {
      cb.onToken?.("重试时收到的半截")
      controller.abort()
      cb.onDone?.()
    })
    const seen: string[] = []
    await expect(
      callAnalysisModelText(llmConfig, messages, {
        signal: controller.signal,
        cancelMessage: "用户取消文风分析",
        onPartialText: (text) => seen.push(text),
      }),
    ).rejects.toThrow("用户取消文风分析")
    // 第一次失败发生在取消之前，所以会回调一次（空串）；重试那次被取消则不回调。
    expect(seen).toEqual([""])
    expect(mocks.streamChat).toHaveBeenCalledTimes(2)
  })

  it("透传 signal、messages 与 onRequestTrace 给 streamChat", async () => {
    // 防止「漏传 signal」这类静默退化：删掉 signal 参数时上面的用例都还是会绿，
    // 因为本函数自己也会查 signal.aborted。
    const controller = new AbortController()
    const onRequestTrace = vi.fn()
    mocks.streamChat.mockImplementationOnce(succeedWith("正文"))
    await callAnalysisModelText(llmConfig, messages, {
      signal: controller.signal,
      onRequestTrace,
    })
    const call = mocks.streamChat.mock.calls[0]
    expect(call[0]).toBe(llmConfig)
    expect(call[1]).toBe(messages)
    expect(call[3]).toBe(controller.signal)
    expect((call[2] as Handlers & { onRequestTrace?: unknown }).onRequestTrace).toBe(onRequestTrace)
  })

  it("调用点已用 baseOverrides 关掉思考时同样不重试", async () => {
    // 门控用的是「生效后的」reasoning（overrides 优先于 config），
    // 所以只在 baseOverrides 里关思考也必须拦住重试，否则会重发一份逐字节相同的请求。
    mocks.streamChat.mockImplementationOnce(failReasoningOnly())
    await expect(
      callAnalysisModelText(llmConfig, messages, {
        baseOverrides: { reasoning: { mode: "off" } },
      }),
    ).rejects.toThrow(reasoningOnlyError())
    expect(mocks.streamChat).toHaveBeenCalledTimes(1)
  })
})
