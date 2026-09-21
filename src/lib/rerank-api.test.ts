import { beforeEach, describe, expect, it, vi } from "vitest"
import { isDirectRerankEndpoint, requestDirectRerank } from "@/lib/rerank-api"

const mockFetch = vi.fn()

vi.mock("@/lib/tauri-fetch", () => ({
  getHttpFetch: vi.fn(async () => mockFetch),
  isFetchNetworkError: vi.fn(() => false),
}))

describe("rerank-api", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("recognizes direct rerank endpoints", () => {
    expect(isDirectRerankEndpoint({
      provider: "custom",
      customEndpoint: "https://api.siliconflow.cn/v1/rerank",
    })).toBe(true)

    expect(isDirectRerankEndpoint({
      provider: "custom",
      customEndpoint: "https://api.siliconflow.cn/v1",
    })).toBe(false)
  })

  it("posts to the direct rerank endpoint and returns ordered indices", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { index: 1, relevance_score: 0.92 },
          { index: 0, relevance_score: 0.41 },
        ],
      }),
    })

    const results = await requestDirectRerank(
      {
        provider: "custom",
        customEndpoint: "https://api.siliconflow.cn/v1/rerank",
        apiKey: "sk-test",
        model: "Qwen/Qwen3-Reranker-8B",
      },
      "主角寻找线索",
      ["第一条", "第二条"],
    )

    expect(results).toEqual([
      { index: 1, relevanceScore: 0.92 },
      { index: 0, relevanceScore: 0.41 },
    ])
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.siliconflow.cn/v1/rerank",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          "Content-Type": "application/json",
        }),
      }),
    )
  })
})
