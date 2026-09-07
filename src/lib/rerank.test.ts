import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { rerankCandidates } from "./rerank"
import { streamChat } from "./llm-client"
import { isDirectRerankEndpoint, requestDirectRerank } from "./rerank-api"

vi.mock("./llm-client", () => ({
  streamChat: vi.fn(),
}))

vi.mock("./rerank-api", () => ({
  isDirectRerankEndpoint: vi.fn(() => false),
  requestDirectRerank: vi.fn(),
}))

const mockStreamChat = vi.mocked(streamChat)
const mockIsDirectRerankEndpoint = vi.mocked(isDirectRerankEndpoint)
const mockRequestDirectRerank = vi.mocked(requestDirectRerank)

describe("rerankCandidates", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWikiStore.setState({
      llmConfig: {
        provider: "openai",
        apiKey: "main-key",
        model: "main-model",
        ollamaUrl: "http://127.0.0.1:11434",
        customEndpoint: "",
        maxContextSize: 200000,
        reasoning: { mode: "auto" },
      },
      rerankConfig: {
        enabled: true,
        useMainLlm: true,
        provider: "custom",
        apiKey: "",
        model: "",
        ollamaUrl: "http://127.0.0.1:11434",
        customEndpoint: "",
        apiMode: "chat_completions",
        maxCandidates: 8,
      },
    })
  })

  it("returns original order when rerank is disabled", async () => {
    useWikiStore.setState({
      rerankConfig: {
        ...useWikiStore.getState().rerankConfig,
        enabled: false,
      },
    })

    const results = await rerankCandidates("query", [
      { id: "a", title: "A", snippet: "aaa" },
      { id: "b", title: "B", snippet: "bbb" },
    ])

    expect(results.map((item) => item.id)).toEqual(["a", "b"])
    expect(mockStreamChat).not.toHaveBeenCalled()
  })

  it("reorders candidates according to model JSON output", async () => {
    mockStreamChat.mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onToken('{"order":[{"id":"b","score":0.99},{"id":"a","score":0.8}]}')
      callbacks.onDone()
    })

    const results = await rerankCandidates("query", [
      { id: "a", title: "A", snippet: "aaa" },
      { id: "b", title: "B", snippet: "bbb" },
    ])

    expect(results.map((item) => item.id)).toEqual(["b", "a"])
  })

  it("uses the direct rerank endpoint when configured", async () => {
    useWikiStore.setState({
      rerankConfig: {
        ...useWikiStore.getState().rerankConfig,
        useMainLlm: false,
        provider: "custom",
        apiKey: "rerank-key",
        model: "Qwen/Qwen3-Reranker-8B",
        customEndpoint: "https://api.siliconflow.cn/v1/rerank",
      },
    })
    mockIsDirectRerankEndpoint.mockReturnValue(true)
    mockRequestDirectRerank.mockResolvedValue([
      { index: 1, relevanceScore: 0.91 },
      { index: 0, relevanceScore: 0.22 },
    ])

    const results = await rerankCandidates("query", [
      { id: "a", title: "A", snippet: "aaa" },
      { id: "b", title: "B", snippet: "bbb" },
    ])

    expect(results.map((item) => item.id)).toEqual(["b", "a"])
    expect(mockStreamChat).not.toHaveBeenCalled()
  })
})
