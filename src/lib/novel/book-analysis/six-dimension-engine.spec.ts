import { describe, expect, it, vi, beforeEach } from "vitest"
import { analyzeSixDimensions, DEPTH_DESCRIPTIONS } from "./six-dimension-engine"
import type { ExtractedCharacter } from "./types"
import type { LlmConfig } from "@/stores/wiki-store"

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(async (_cfg, _msgs, callbacks) => {
    // 模拟：每个维度返回一个稳定的 markdown
    callbacks.onToken?.("## 模拟章节\n模拟正文")
    callbacks.onDone?.()
  }),
}))

vi.mock("@/lib/novel/book-analysis/web-search", () => ({
  fetchCharacterExternalMaterial: vi.fn(async () => null),
}))

function makeCharacter(): ExtractedCharacter {
  return {
    id: "c1",
    name: "许七安",
    aliases: ["大郎", "许银锣"],
    importance: 8,
    category: "protagonist",
    firstAppearance: 1,
    lastAppearance: 100,
    appearanceCount: 80,
    description: "捕快",
    personality: "稳健",
    speechStyle: "温和",
    relationships: [],
    keyEvents: [],
    corpus: "大郎走进城。",
  }
}

function makeLlmConfig(): LlmConfig {
  return {
    baseUrl: "http://localhost",
    apiKey: "test",
    model: "test-model",
  } as unknown as LlmConfig
}

describe("six-dimension-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("fast mode does not call LLM or web", async () => {
    const result = await analyzeSixDimensions({
      character: makeCharacter(),
      corpus: "x",
      llmConfig: makeLlmConfig(),
      depth: "fast",
      bookTitle: "X",
    })
    expect(result.character.sixDimensionMeta?.depth).toBe("fast")
    expect(result.character.sixDimensionMeta?.webSearchUsed).toBe(false)
    expect(result.character.aliasMap?.canonical).toBe("许七安")
    expect(result.character.sixDimensionResearch?.publicMaterial).toContain("## 人物定位")
  })

  it("standard mode calls LLM 6 times and skips web", async () => {
    const { streamChat } = await import("@/lib/llm-client")
    const result = await analyzeSixDimensions({
      character: makeCharacter(),
      corpus: "x",
      llmConfig: makeLlmConfig(),
      depth: "standard",
      bookTitle: "X",
    })
    expect(streamChat).toHaveBeenCalledTimes(6)
    expect(result.webSearchUsed).toBe(false)
    expect(result.character.sixDimensionMeta?.depth).toBe("standard")
  })

  it("deep mode tries web + 6 LLM; web failure → llmFallback", async () => {
    const { fetchCharacterExternalMaterial } = await import(
      "@/lib/novel/book-analysis/web-search"
    )
    ;(fetchCharacterExternalMaterial as any).mockResolvedValueOnce(null)
    const { streamChat } = await import("@/lib/llm-client")
    const result = await analyzeSixDimensions({
      character: makeCharacter(),
      corpus: "x",
      llmConfig: makeLlmConfig(),
      depth: "deep",
      bookTitle: "X",
    })
    expect(fetchCharacterExternalMaterial).toHaveBeenCalled()
    expect(streamChat).toHaveBeenCalledTimes(6)
    expect(result.webSearchUsed).toBe(false)
    expect(result.llmFallbackUsed).toBe(true)
  })

  it("deep mode with web success sets webSearchUsed", async () => {
    const { fetchCharacterExternalMaterial } = await import(
      "@/lib/novel/book-analysis/web-search"
    )
    ;(fetchCharacterExternalMaterial as any).mockResolvedValueOnce({
      source: "duckduckgo",
      title: "X",
      abstract: "abc",
      url: "https://example.com",
    })
    const result = await analyzeSixDimensions({
      character: makeCharacter(),
      corpus: "x",
      llmConfig: makeLlmConfig(),
      depth: "deep",
      bookTitle: "X",
    })
    expect(result.webSearchUsed).toBe(true)
  })

  it("DEPTH_DESCRIPTIONS has 3 levels with token multiplier", () => {
    expect(DEPTH_DESCRIPTIONS.fast.approxTokenMultiplier).toBe("1×")
    expect(DEPTH_DESCRIPTIONS.standard.approxTokenMultiplier).toBe("6×")
    expect(DEPTH_DESCRIPTIONS.deep.approxTokenMultiplier).toMatch(/6×/)
  })

  // 6 维度细粒度进度（feature/book-analysis-6d-skill）
  it("standard mode reports each dimension with running→done transition in dimensions array", async () => {
    const progress: any[] = []
    await analyzeSixDimensions({
      character: makeCharacter(),
      corpus: "x",
      llmConfig: makeLlmConfig(),
      depth: "standard",
      bookTitle: "X",
      onProgress: (p) => progress.push(p),
    })
    // 取所有 dimension 阶段的 progress
    const dimProgress = progress.filter((p) => p.stage === "dimension")
    // 6 个维度 × 2 次（开始 + 完成）= 12 次
    expect(dimProgress.length).toBe(12)
    // 第一次（维度 0 开始）应有 currentDimension = publicMaterial，status = running
    expect(dimProgress[0].currentDimension).toBe("publicMaterial")
    expect(dimProgress[0].dimensions?.find((d: any) => d.key === "publicMaterial")?.status).toBe("running")
    // 第二次（维度 0 完成）应将 status 置为 done
    expect(dimProgress[1].dimensions?.find((d: any) => d.key === "publicMaterial")?.status).toBe("done")
    // 第 12 次（最后）应有所有维度 done
    const last = dimProgress[11]
    expect(last.dimensions?.every((d: any) => d.status === "done")).toBe(true)
  })

  it("onProgress reports characterName in every progress", async () => {
    const progress: any[] = []
    await analyzeSixDimensions({
      character: makeCharacter(),
      corpus: "x",
      llmConfig: makeLlmConfig(),
      depth: "standard",
      bookTitle: "X",
      onProgress: (p) => progress.push(p),
    })
    // 每条 progress 都应当带上 characterName
    for (const p of progress) {
      expect(p.characterName).toBe("许七安")
    }
  })

  it("deep mode reports fetching_web stage before dimension stages", async () => {
    const { fetchCharacterExternalMaterial } = await import(
      "@/lib/novel/book-analysis/web-search"
    )
    ;(fetchCharacterExternalMaterial as any).mockResolvedValueOnce(null)
    const progress: any[] = []
    await analyzeSixDimensions({
      character: makeCharacter(),
      corpus: "x",
      llmConfig: makeLlmConfig(),
      depth: "deep",
      bookTitle: "X",
      onProgress: (p) => progress.push(p),
    })
    // 第一条 progress 应当是 fetching_web
    expect(progress[0].stage).toBe("fetching_web")
    // fetching_web 时所有维度还是 pending
    expect(
      progress[0].dimensions?.every((d: any) => d.status === "pending")
    ).toBe(true)
  })

  it("final done progress has all dimensions marked done", async () => {
    const progress: any[] = []
    await analyzeSixDimensions({
      character: makeCharacter(),
      corpus: "x",
      llmConfig: makeLlmConfig(),
      depth: "standard",
      bookTitle: "X",
      onProgress: (p) => progress.push(p),
    })
    const last = progress[progress.length - 1]
    expect(last.stage).toBe("done")
    expect(last.dimensions?.every((d: any) => d.status === "done")).toBe(true)
  })

  it("fast mode reports dimensions all done in single progress", async () => {
    const progress: any[] = []
    await analyzeSixDimensions({
      character: makeCharacter(),
      corpus: "x",
      llmConfig: makeLlmConfig(),
      depth: "fast",
      bookTitle: "X",
      onProgress: (p) => progress.push(p),
    })
    // fast 模式只发一次 done
    expect(progress.length).toBe(1)
    expect(progress[0].stage).toBe("done")
    expect(progress[0].dimensions?.every((d: any) => d.status === "done")).toBe(true)
  })
})
