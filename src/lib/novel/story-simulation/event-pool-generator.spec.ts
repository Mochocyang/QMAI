import { describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import { generateDynamicEventPool, stringArrayToStagedPool } from "./event-pool-generator"

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(),
}))

const mockLlmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "test-key",
  model: "test-model",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 4096,
}

const mockInput = {
  llmConfig: mockLlmConfig,
  worldRules: "这是一个玄幻世界，有修仙者和妖兽。",
  characters: ["张三", "李四"],
}

describe("generateDynamicEventPool", () => {
  it("正常返回四阶段 JSON 对象时应解析为 StagedEventPool", async () => {
    const { streamChat } = await import("@/lib/llm-client")

    const mockResponse = {
      setup: ["起阶段事件1", "起阶段事件2", "起阶段事件3"],
      rising: ["承阶段事件1", "承阶段事件2", "承阶段事件3"],
      climax: ["转阶段事件1", "转阶段事件2", "转阶段事件3"],
      resolution: ["合阶段事件1", "合阶段事件2", "合阶段事件3"],
    }

    vi.mocked(streamChat).mockImplementationOnce(
      (_config, _messages, callbacks) => {
        callbacks.onToken(JSON.stringify(mockResponse))
        callbacks.onDone()
        return Promise.resolve()
      },
    )

    const result = await generateDynamicEventPool(mockInput)

    expect(result.all).toHaveLength(12)
    expect(result.byStage.setup).toHaveLength(3)
    expect(result.byStage.rising).toHaveLength(3)
    expect(result.byStage.climax).toHaveLength(3)
    expect(result.byStage.resolution).toHaveLength(3)
    expect(result.byStage.setup[0].text).toBe("起阶段事件1")
    expect(result.byStage.setup[0].stage).toBe("setup")
    expect(result.byStage.rising[0].stage).toBe("rising")
    expect(result.byStage.climax[0].stage).toBe("climax")
    expect(result.byStage.resolution[0].stage).toBe("resolution")
  })

  it("LLM 返回字符串数组时应自动转换为 StagedEventPool", async () => {
    const { streamChat } = await import("@/lib/llm-client")

    vi.mocked(streamChat).mockImplementationOnce(
      (_config, _messages, callbacks) => {
        callbacks.onToken(
          JSON.stringify([
            "一阵妖风吹过，带来了远方妖兽的嘶吼。",
            "天空中出现了一道罕见的霞光，似乎预示着宝物出世。",
            "一位神秘的修仙者出现在城镇边缘。",
            "后续事件4",
            "后续事件5",
            "后续事件6",
            "后续事件7",
            "后续事件8",
          ]),
        )
        callbacks.onDone()
        return Promise.resolve()
      },
    )

    const result = await generateDynamicEventPool(mockInput)

    expect(result.all).toHaveLength(8)
    expect(result.byStage.setup.length).toBeGreaterThan(0)
    expect(result.byStage.rising.length).toBeGreaterThan(0)
  })

  it("LLM 返回非 JSON 时应返回空池", async () => {
    const { streamChat } = await import("@/lib/llm-client")

    vi.mocked(streamChat).mockImplementationOnce(
      (_config, _messages, callbacks) => {
        callbacks.onToken("这不是一个 JSON 数组，只是一段普通文本。")
        callbacks.onDone()
        return Promise.resolve()
      },
    )

    const result = await generateDynamicEventPool(mockInput)

    expect(result.all).toEqual([])
    expect(result.byStage.setup).toEqual([])
    expect(result.byStage.rising).toEqual([])
    expect(result.byStage.climax).toEqual([])
    expect(result.byStage.resolution).toEqual([])
  })

  it("LLM 抛错时应返回空池", async () => {
    const { streamChat } = await import("@/lib/llm-client")

    vi.mocked(streamChat).mockImplementationOnce(
      (_config, _messages, callbacks) => {
        callbacks.onError(new Error("网络连接失败"))
        return Promise.resolve()
      },
    )

    const result = await generateDynamicEventPool(mockInput)

    expect(result.all).toEqual([])
  })

  it("部分阶段为空时应回退到全局池分配", async () => {
    const { streamChat } = await import("@/lib/llm-client")

    const mockResponse = {
      setup: ["起阶段事件1"],
      rising: [],
      climax: [],
      resolution: [],
    }

    vi.mocked(streamChat).mockImplementationOnce(
      (_config, _messages, callbacks) => {
        callbacks.onToken(JSON.stringify(mockResponse))
        callbacks.onDone()
        return Promise.resolve()
      },
    )

    const result = await generateDynamicEventPool(mockInput)

    expect(result.all).toHaveLength(1)
  })
})

describe("stringArrayToStagedPool", () => {
  it("空数组返回空池", () => {
    const result = stringArrayToStagedPool([])
    expect(result.all).toEqual([])
    expect(result.byStage.setup).toEqual([])
    expect(result.byStage.rising).toEqual([])
    expect(result.byStage.climax).toEqual([])
    expect(result.byStage.resolution).toEqual([])
  })

  it("8个事件按阶段分配", () => {
    const events = ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"]
    const result = stringArrayToStagedPool(events)
    expect(result.all).toHaveLength(8)
    expect(result.byStage.setup[0].text).toBe("e1")
    expect(result.byStage.setup[0].stage).toBe("setup")
  })
})
