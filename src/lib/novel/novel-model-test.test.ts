import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore, type LlmConfig, type NovelConfig } from "@/stores/wiki-store"

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(),
}))

import { streamChat } from "@/lib/llm-client"
import { testNovelModel } from "@/lib/novel/novel-model-test"

const baseLlmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "test-key",
  model: "main-model",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "https://example.com/v1/chat/completions",
  maxContextSize: 4096,
  reasoning: { mode: "auto" },
}

const baseNovelConfig: NovelConfig = {
  contextTokenBudget: 0,
  recentSummaryWindow: 8,
  searchTopK: 5,
  chapterTargetChars: 3000,
  autoIngestOnSave: true,
  autoExtractOnImport: true,
  reviewBeforeSave: false,
  deepPreviousChaptersAnalysis: false,
  deepChapterReview: true,
  reviewReasoningEffort: "high",
  defaultLlmModel: "",
  writingModel: "",
  reviewModel: "",
  summaryModel: "",
  extractModel: "",
  deAiModel: "",
  communitySummaryEnabled: false,
  communitySummaryInterval: 5,
  communitySummaryAsync: false,
  autoGenerateChapterTitle: true,
  draftMemoryHintEnabled: true,
}

describe("testNovelModel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWikiStore.getState().setProviderConfigs({
      openai: {
        apiKey: "test-key",
        model: "main-model",
        savedModels: [{
          id: "main-model",
          name: "main-model",
          model: "main-model",
          createdAt: 1,
        }],
      },
    })
    useWikiStore.getState().setAiChatModel("main-model")
    useWikiStore.getState().setDefaultLlmModel("")
  })

  it("uses the AI chat session model for writing task (writingModel is deprecated)", async () => {
    vi.mocked(streamChat).mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onToken("写作模型测试成功")
      callbacks.onDone()
    })

    const result = await testNovelModel(
      baseLlmConfig,
      { ...baseNovelConfig, writingModel: "novel-writing-model" },
      "writing",
    )

    // writingModel 已移除，writing 任务始终使用 AI 会话当前模型（回退到 baseLlmConfig.model）
    expect(vi.mocked(streamChat).mock.calls[0]?.[0].model).toBe("main-model")
    // writingModel 字段虽存在但已不生效，视为回退
    expect(result.usedFallbackModel).toBe(true)
  })

  it("falls back to the main model when the novel model is empty", async () => {
    vi.mocked(streamChat).mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onToken("摘要模型测试成功")
      callbacks.onDone()
    })

    const result = await testNovelModel(baseLlmConfig, baseNovelConfig, "summary")

    expect(vi.mocked(streamChat).mock.calls[0]?.[0].model).toBe("main-model")
    expect(result.usedFallbackModel).toBe(true)
  })

  it("throws when the model returns empty content", async () => {
    vi.mocked(streamChat).mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onDone()
    })

    await expect(testNovelModel(baseLlmConfig, baseNovelConfig, "review")).rejects.toThrow(
      "模型已连接，但没有返回可用内容。",
    )
  })
})
