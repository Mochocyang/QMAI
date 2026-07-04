import { describe, expect, it, vi } from "vitest"
import { cosineSimilarity } from "@/lib/embedding-client"
import { isNodeGoalReachedWithEmbedding } from "@/lib/novel/story-simulation/simulation-engine"
import type { StoryNode, TimelineEvent } from "@/lib/novel/story-simulation/types"
import type { LlmConfig } from "@/stores/wiki-store"

vi.mock("@/lib/embedding-client", () => ({
  cosineSimilarity: vi.fn((a: number[], b: number[]) => {
    if (a.length === 0 || b.length === 0) return 0
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    if (normA === 0 || normB === 0) return 0
    return dot / (Math.sqrt(normA) * Math.sqrt(normB))
  }),
  embed: vi.fn(),
}))

import { embed } from "@/lib/embedding-client"

function makeNode(expectedOutcome: string): StoryNode {
  return {
    index: 0,
    phase: "起",
    title: "测试节点",
    coreConflict: "冲突",
    involvedCharacters: ["甲", "乙"],
    goal: "目标",
    causeFromPrev: "无",
    expectedOutcome,
  }
}

function makeTimelineEvent(content: string, actionType: TimelineEvent["actionType"] = "speak"): TimelineEvent {
  return {
    id: `evt_${Date.now()}_${Math.random()}`,
    round: 0,
    nodeIndex: 0,
    actorId: "a",
    actorName: "甲",
    actionType,
    content,
    observableBy: ["a", "b"],
    impacts: [],
    timestamp: "2026-07-04T00:00:00.000Z",
  }
}

function makeLlmConfig(): LlmConfig {
  return {
    provider: "openai",
    apiKey: "test-key",
    model: "gpt-4",
    ollamaUrl: "",
    customEndpoint: "",
    maxContextSize: 2048,
  }
}

describe("cosineSimilarity", () => {
  it("相同向量返回 1", () => {
    const a = [1, 0, 0]
    expect(cosineSimilarity(a, a)).toBeCloseTo(1)
  })

  it("正交向量返回 0", () => {
    const a = [1, 0, 0]
    const b = [0, 1, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(0)
  })

  it("相反向量返回 -1", () => {
    const a = [1, 0, 0]
    const b = [-1, 0, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1)
  })

  it("空向量返回 0", () => {
    expect(cosineSimilarity([], [1, 2, 3])).toBe(0)
    expect(cosineSimilarity([1, 2, 3], [])).toBe(0)
    expect(cosineSimilarity([], [])).toBe(0)
  })
})

describe("isNodeGoalReachedWithEmbedding", () => {
  it("相似度 >= 0.75 时返回 true", async () => {
    const node = makeNode("主角发现了真相")
    const events = [makeTimelineEvent("主角终于发现了隐藏的真相")]

    vi.mocked(embed).mockResolvedValueOnce([1, 0, 0])
    vi.mocked(embed).mockResolvedValueOnce([0.8, 0.6, 0])

    const result = await isNodeGoalReachedWithEmbedding(node, events, 5, 0, makeLlmConfig())
    expect(result).toBe(true)
  })

  it("相似度 < 0.75 时返回 false", async () => {
    const node = makeNode("主角发现了真相")
    const events = [makeTimelineEvent("主角在喝茶聊天")]

    vi.mocked(embed).mockResolvedValueOnce([1, 0, 0])
    vi.mocked(embed).mockResolvedValueOnce([0.5, 0.866, 0])

    const result = await isNodeGoalReachedWithEmbedding(node, events, 5, 0, makeLlmConfig())
    expect(result).toBe(false)
  })

  it("embedding 失败时降级为旧启发式", async () => {
    const node = makeNode("主角发现了真相")
    const events = [
      makeTimelineEvent("事件1", "pushPlot"),
      makeTimelineEvent("事件2", "pushPlot"),
    ]

    vi.mocked(embed).mockRejectedValueOnce(new Error("API error"))

    const result = await isNodeGoalReachedWithEmbedding(node, events, 5, 0, makeLlmConfig())
    expect(result).toBe(true)
  })

  it("maxRounds 兜底仍保留", async () => {
    const node = makeNode("主角发现了真相")
    const events: TimelineEvent[] = []

    const result = await isNodeGoalReachedWithEmbedding(node, events, 5, 4, makeLlmConfig())
    expect(result).toBe(true)
  })

  it("没有 expectedOutcome 时降级为旧启发式", async () => {
    const node = makeNode("")
    const events = [
      makeTimelineEvent("事件1"),
      makeTimelineEvent("事件2"),
      makeTimelineEvent("事件3"),
      makeTimelineEvent("事件4"),
      makeTimelineEvent("事件5"),
      makeTimelineEvent("事件6"),
    ]

    const result = await isNodeGoalReachedWithEmbedding(node, events, 5, 0, makeLlmConfig())
    expect(result).toBe(true)
  })
})
