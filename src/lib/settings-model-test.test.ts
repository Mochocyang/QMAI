import { beforeEach, describe, expect, it, vi } from "vitest"
import type { EmbeddingConfig, LlmConfig, RerankConfig } from "@/stores/wiki-store"

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(),
}))

vi.mock("@/lib/embedding", () => ({
  fetchEmbedding: vi.fn(),
}))

vi.mock("@/lib/rerank-api", () => ({
  isDirectRerankEndpoint: vi.fn(() => false),
  requestDirectRerank: vi.fn(),
}))

import { fetchEmbedding } from "@/lib/embedding"
import { streamChat } from "@/lib/llm-client"
import { isDirectRerankEndpoint, requestDirectRerank } from "@/lib/rerank-api"
import {
  testSettingsEmbeddingModel,
  testSettingsLlmModel,
  testSettingsRerankModel,
} from "@/lib/settings-model-test"

const baseLlmConfig: LlmConfig = {
  provider: "custom",
  apiKey: "test-key",
  model: "main-model",
  ollamaUrl: "http://127.0.0.1:11434",
  customEndpoint: "https://example.com/v1",
  maxContextSize: 8192,
  apiMode: "chat_completions",
  reasoning: { mode: "auto" },
}

const baseEmbeddingConfig: EmbeddingConfig = {
  enabled: true,
  endpoint: "https://example.com/v1/embeddings",
  apiKey: "embed-key",
  model: "embed-model",
}

const baseRerankConfig: RerankConfig = {
  enabled: true,
  useMainLlm: false,
  provider: "custom",
  apiKey: "rerank-key",
  model: "rerank-model",
  ollamaUrl: "http://127.0.0.1:11434",
  customEndpoint: "https://example.com/v1",
  apiMode: "chat_completions",
  maxCandidates: 12,
}

describe("settings model test helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("tests llm models with a real chat request", async () => {
    vi.mocked(streamChat).mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onToken("模型测试成功")
      callbacks.onDone()
    })

    const result = await testSettingsLlmModel(baseLlmConfig)

    expect(result).toEqual({
      model: "main-model",
      content: "模型测试成功",
    })
    expect(vi.mocked(streamChat).mock.calls[0]?.[0].model).toBe("main-model")
  })

  it("tests embedding models with a real embedding request", async () => {
    vi.mocked(fetchEmbedding).mockResolvedValue([0.1, 0.2, 0.3, 0.4])

    const result = await testSettingsEmbeddingModel(baseEmbeddingConfig)

    expect(result).toEqual({
      model: "embed-model",
      dimensions: 4,
    })
    expect(vi.mocked(fetchEmbedding).mock.calls[0]?.[0]).toContain("测试嵌入模型")
  })

  it("tests rerank models with structured JSON output", async () => {
    vi.mocked(streamChat).mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onToken('{"order":[{"id":"a","score":1},{"id":"b","score":0.2}]}')
      callbacks.onDone()
    })

    const result = await testSettingsRerankModel(baseLlmConfig, baseRerankConfig)

    expect(result.model).toBe("rerank-model")
    expect(result.usedMainLlm).toBe(false)
    expect(vi.mocked(streamChat).mock.calls[0]?.[0].model).toBe("rerank-model")
  })

  it("reuses the main model when rerank is configured to use it", async () => {
    vi.mocked(streamChat).mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onToken('{"order":[{"id":"a","score":1},{"id":"b","score":0.2}]}')
      callbacks.onDone()
    })

    const result = await testSettingsRerankModel(baseLlmConfig, {
      ...baseRerankConfig,
      useMainLlm: true,
      model: "",
    })

    expect(result.model).toBe("main-model")
    expect(result.usedMainLlm).toBe(true)
    expect(vi.mocked(streamChat).mock.calls[0]?.[0].model).toBe("main-model")
  })

  it("rejects embedding models for rerank tests before sending the request", async () => {
    await expect(testSettingsRerankModel(baseLlmConfig, {
      ...baseRerankConfig,
      model: "Qwen/Qwen3-Embedding-4B",
    })).rejects.toThrow("嵌入模型")

    expect(vi.mocked(streamChat)).not.toHaveBeenCalled()
  })

  it("tests direct rerank endpoints without using chat completions", async () => {
    vi.mocked(isDirectRerankEndpoint).mockReturnValue(true)
    vi.mocked(requestDirectRerank).mockResolvedValue([
      { index: 0, relevanceScore: 0.95 },
      { index: 1, relevanceScore: 0.12 },
    ])

    const result = await testSettingsRerankModel(baseLlmConfig, {
      ...baseRerankConfig,
      customEndpoint: "https://api.siliconflow.cn/v1/rerank",
      model: "Qwen/Qwen3-Reranker-8B",
    })

    expect(result.model).toBe("Qwen/Qwen3-Reranker-8B")
    expect(vi.mocked(requestDirectRerank)).toHaveBeenCalled()
    expect(vi.mocked(streamChat)).not.toHaveBeenCalled()
  })
})
