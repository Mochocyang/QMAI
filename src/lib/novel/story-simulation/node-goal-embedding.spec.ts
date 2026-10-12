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

/**
 * 同一节点内 expectedOutcome 恒定，而这个函数每个节点每轮都会被调用一次，
 * 所以同一个字符串会被重复 embedding R 次 —— 2×N×R 里的一半是纯浪费。
 * 下面两条一起钉住：加了缓存要省调用，且省调用不能改变判定结果。
 */
describe("isNodeGoalReachedWithEmbedding 的 expectedOutcome embedding 缓存", () => {
  function mockEmbeddings() {
    const embedMock = vi.mocked(embed)
    embedMock.mockReset()
    embedMock.mockImplementation(async (text: string) =>
      text === "主角发现了真相" ? [1, 0, 0] : [0.8, 0.6, 0],
    )
    return embedMock
  }

  it("传入缓存时，expectedOutcome 只算一次且判定结果不变", async () => {
    const node = makeNode("主角发现了真相")
    const events = [makeTimelineEvent("主角终于发现了隐藏的真相")]
    const embedMock = mockEmbeddings()
    const cache = new Map<string, number[]>()

    const first = await isNodeGoalReachedWithEmbedding(
      node, events, 5, 0, makeLlmConfig(), cache,
    )
    const second = await isNodeGoalReachedWithEmbedding(
      node, events, 5, 1, makeLlmConfig(), cache,
    )

    expect(first).toBe(true)
    // 等价性：缓存不能改变判定结果
    expect(second).toBe(true)
    // expectedOutcome 1 次 + events 2 次 = 3 次；无缓存时是 4 次
    expect(embedMock).toHaveBeenCalledTimes(3)
    expect(cache.get("主角发现了真相")).toEqual([1, 0, 0])
  })

  it("不传缓存时行为与原先一致（每次重算）", async () => {
    const node = makeNode("主角发现了真相")
    const events = [makeTimelineEvent("主角终于发现了隐藏的真相")]
    const embedMock = mockEmbeddings()

    await isNodeGoalReachedWithEmbedding(node, events, 5, 0, makeLlmConfig())
    await isNodeGoalReachedWithEmbedding(node, events, 5, 1, makeLlmConfig())

    expect(embedMock).toHaveBeenCalledTimes(4)
  })

  it("缓存不跨 expectedOutcome 复用：不同节点各算各的", async () => {
    const events = [makeTimelineEvent("主角终于发现了隐藏的真相")]
    const embedMock = mockEmbeddings()
    const cache = new Map<string, number[]>()

    await isNodeGoalReachedWithEmbedding(
      makeNode("主角发现了真相"), events, 5, 0, makeLlmConfig(), cache,
    )
    await isNodeGoalReachedWithEmbedding(
      makeNode("主角逃出了密室"), events, 5, 0, makeLlmConfig(), cache,
    )

    // 两个不同的 expectedOutcome 各算一次；若按 node.index 粗暴缓存，
    // 第二个节点会错误复用第一个节点的向量。
    expect(embedMock).toHaveBeenCalledWith("主角逃出了密室", expect.anything())
    expect(cache.size).toBe(2)
  })
})
