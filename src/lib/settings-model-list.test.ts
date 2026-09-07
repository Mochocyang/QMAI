import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  fetchEmbeddingModelList,
  fetchLlmModelList,
  fetchRerankModelList,
} from "@/lib/settings-model-list"

const mockFetch = vi.fn()

vi.mock("@/lib/tauri-fetch", () => ({
  getHttpFetch: vi.fn(async () => mockFetch),
}))

describe("settings-model-list", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("awaits the fetch factory before requesting llm models", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "gpt-4.1-mini" }, { id: "gpt-4.1" }],
      }),
    })

    const config: Parameters<typeof fetchLlmModelList>[0] = {
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4.1",
      ollamaUrl: "",
      customEndpoint: "",
      maxContextSize: 32000,
    }

    await expect(fetchLlmModelList(config)).resolves.toEqual({
      models: ["gpt-4.1", "gpt-4.1-mini"],
    })
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
        }),
      }),
    )
  })

  it("fetches embedding models from an embeddings endpoint", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "text-embedding-3-small" }, { id: "text-embedding-3-large" }],
      }),
    })

    await expect(fetchEmbeddingModelList({
      enabled: true,
      endpoint: "https://api.openai.com/v1/embeddings",
      apiKey: "emb-key",
      model: "text-embedding-3-small",
    })).resolves.toEqual({
      models: ["text-embedding-3-large", "text-embedding-3-small"],
    })

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer emb-key",
        }),
      }),
    )
  })

  it("parses google model lists from the models field", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: "models/gemini-embedding-001" }, { name: "models/text-embedding-004" }],
      }),
    })

    await expect(fetchEmbeddingModelList({
      enabled: true,
      endpoint: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "google-key",
      model: "gemini-embedding-001",
    })).resolves.toEqual({
      models: ["gemini-embedding-001", "text-embedding-004"],
    })

    expect(mockFetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-goog-api-key": "google-key",
        }),
      }),
    )
  })

  it("fetches rerank models from a direct rerank endpoint", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "Qwen/Qwen3-Reranker-8B" }, { id: "Qwen/Qwen3-Reranker-4B" }],
      }),
    })

    await expect(fetchRerankModelList(
      {
        provider: "custom",
        apiKey: "main-key",
        model: "main-model",
        ollamaUrl: "",
        customEndpoint: "https://main.example.com/v1",
        maxContextSize: 64000,
      },
      {
        enabled: true,
        useMainLlm: false,
        provider: "custom",
        apiKey: "rerank-key",
        model: "Qwen/Qwen3-Reranker-8B",
        ollamaUrl: "",
        customEndpoint: "https://rerank.example.com/v1/rerank",
        apiMode: "chat_completions",
        maxCandidates: 12,
      },
    )).resolves.toEqual({
      models: ["Qwen/Qwen3-Reranker-4B", "Qwen/Qwen3-Reranker-8B"],
    })

    expect(mockFetch).toHaveBeenCalledWith(
      "https://rerank.example.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer rerank-key",
        }),
      }),
    )
  })
})
