import { describe, it, expect, vi, beforeEach } from "vitest"
import { runPostWriteCheckAI } from "./post-write-check-ai"

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(),
}))

vi.mock("@/lib/novel/model-resolver", () => ({
  resolveNovelModel: vi.fn(() => ({
    provider: "custom",
    apiKey: "test-key",
    model: "test-model",
    customEndpoint: "http://test",
  })),
}))

vi.mock("@/lib/has-usable-llm", () => ({
  hasUsableLlm: vi.fn(() => true),
}))

vi.mock("@/stores/wiki-store", async () => {
  const actual = await vi.importActual("@/stores/wiki-store")
  return {
    ...actual,
    useWikiStore: {
      getState: () => ({
        providerConfigs: {},
        novelConfig: {
          reviewModel: "",
          summaryModel: "",
          extractModel: "",
        },
      }),
    },
  }
})

import { streamChat } from "@/lib/llm-client"
import { hasUsableLlm } from "@/lib/has-usable-llm"

describe("runPostWriteCheckAI", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("章节内容为空时降级到规则检查", async () => {
    const result = await runPostWriteCheckAI({ chapterContent: "" })
    expect(result.source).toBe("rule")
    expect(result.fallbackReason).toBe("章节内容为空")
    expect(result.check.items).toHaveLength(7)
  })

  it("未配置可用模型时降级", async () => {
    vi.mocked(hasUsableLlm).mockReturnValueOnce(false)
    const result = await runPostWriteCheckAI({ chapterContent: "测试内容" + "字".repeat(200) })
    expect(result.source).toBe("rule")
    expect(result.fallbackReason).toBe("未配置可用模型")
  })

  it("AI 成功时返回结构化结果", async () => {
    const aiResponse = JSON.stringify({
      items: [
        { name: "剧情承接", passed: true, detail: "承接良好", severity: "info", evidence: "承接上文", suggestion: "良好" },
        { name: "主线推进", passed: true, detail: "推进顺利", severity: "info", evidence: "推进主线", suggestion: "良好" },
        { name: "人物动机", passed: false, detail: "动机不明", severity: "warning", evidence: "动机不明", suggestion: "补充心理描写" },
        { name: "冲突强度", passed: true, detail: "有转折", severity: "info", evidence: "有转折", suggestion: "良好" },
        { name: "伏笔处理", passed: true, detail: "伏笔延续", severity: "info", evidence: "伏笔延续", suggestion: "良好" },
        { name: "节奏", passed: true, detail: "节奏适中", severity: "info", evidence: "节奏适中", suggestion: "良好" },
        { name: "风格一致性", passed: true, detail: "风格统一", severity: "info", evidence: "风格统一", suggestion: "良好" },
      ],
    })
    vi.mocked(streamChat).mockImplementationOnce(async (_config, _messages, callbacks) => {
      callbacks.onToken(aiResponse)
      callbacks.onDone()
    })
    const result = await runPostWriteCheckAI({ chapterContent: "测试章节内容" + "字".repeat(300) })
    expect(result.source).toBe("ai")
    expect(result.fallbackReason).toBeUndefined()
    expect(result.check.items).toHaveLength(7)
    expect(result.check.items[0].severity).toBe("info")
    expect(result.check.items[2].evidence).toBe("动机不明")
    expect(result.check.allPassed).toBe(false)
  })

  it("AI 返回非 JSON 时降级", async () => {
    vi.mocked(streamChat).mockImplementationOnce(async (_config, _messages, callbacks) => {
      callbacks.onToken("这不是 JSON")
      callbacks.onDone()
    })
    const result = await runPostWriteCheckAI({ chapterContent: "测试内容" + "字".repeat(300) })
    expect(result.source).toBe("rule")
    expect(result.fallbackReason).toBe("AI 返回格式无法解析")
  })

  it("AI 调用抛错时降级", async () => {
    vi.mocked(streamChat).mockImplementationOnce(async () => {
      throw new Error("网络错误")
    })
    const result = await runPostWriteCheckAI({ chapterContent: "测试内容" + "字".repeat(300) })
    expect(result.source).toBe("rule")
    expect(result.fallbackReason).toBe("AI 调用失败：网络错误")
  })

  it("AI 推理超时时降级", async () => {
    vi.mocked(streamChat).mockImplementationOnce(async (_config, _messages, callbacks, signal) => {
      const checkSignal = () => {
        if (signal?.aborted) {
          callbacks.onDone()
          return
        }
        setTimeout(checkSignal, 10)
      }
      checkSignal()
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          signal?.removeEventListener("abort", onAbort)
          resolve()
        }
        signal?.addEventListener("abort", onAbort, { once: true })
      })
    })
    const controller = new AbortController()
    const resultPromise = runPostWriteCheckAI({
      chapterContent: "测试内容" + "字".repeat(300),
      signal: controller.signal,
    })
    controller.abort()
    const result = await resultPromise
    expect(result.source).toBe("rule")
    expect(result.fallbackReason).toBe("AI 推理超时")
  })

  it("parseAIResponse 校验 severity 枚举值", async () => {
    const validResponse = JSON.stringify({
      items: [
        { name: "剧情承接", passed: true, detail: "好", severity: "info" },
        { name: "主线推进", passed: true, detail: "好", severity: "warning" },
        { name: "人物动机", passed: false, detail: "差", severity: "error" },
        { name: "冲突强度", passed: true, detail: "好" },
        { name: "伏笔处理", passed: true, detail: "好" },
        { name: "节奏", passed: true, detail: "好" },
        { name: "风格一致性", passed: true, detail: "好" },
      ],
    })
    const invalidSeverityResponse = JSON.stringify({
      items: [
        { name: "剧情承接", passed: true, detail: "好", severity: "critical" },
        { name: "主线推进", passed: true, detail: "好" },
        { name: "人物动机", passed: false, detail: "差" },
        { name: "冲突强度", passed: true, detail: "好" },
        { name: "伏笔处理", passed: true, detail: "好" },
        { name: "节奏", passed: true, detail: "好" },
        { name: "风格一致性", passed: true, detail: "好" },
      ],
    })
    vi.mocked(streamChat).mockImplementationOnce(async (_config, _messages, callbacks) => {
      callbacks.onToken(validResponse)
      callbacks.onDone()
    })
    const validResult = await runPostWriteCheckAI({ chapterContent: "测试内容" + "字".repeat(300) })
    expect(validResult.source).toBe("ai")

    vi.mocked(streamChat).mockImplementationOnce(async (_config, _messages, callbacks) => {
      callbacks.onToken(invalidSeverityResponse)
      callbacks.onDone()
    })
    const invalidResult = await runPostWriteCheckAI({ chapterContent: "测试内容" + "字".repeat(300) })
    expect(invalidResult.source).toBe("rule")
    expect(invalidResult.fallbackReason).toBe("AI 返回格式无法解析")
  })
})
