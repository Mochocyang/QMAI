import { describe, expect, it } from "vitest"

import type { NovelAgent, RumorEvent } from "@/lib/novel/story-simulation/types"
import {
  createSimulationBlackboard,
  decideRumorTruth,
  findMatchingRumor,
  recordRumorEvent,
  verifyRumor,
  type SimulationBlackboard,
} from "@/lib/novel/story-simulation/multi-agent-orchestrator"

function makeAgent(id: string, name: string): NovelAgent {
  return {
    characterId: id,
    name,
    profile: `${name} profile`,
    aura: null,
    cognition: null,
    soul: "",
    currentGoal: "完成当前节点目标",
    emotionalState: "neutral",
    knownFacts: new Set(),
    relationships: new Map(),
    powerLevel: "normal",
    memory: {
      observedEvents: [],
      knownSecrets: new Set(),
      sentiments: new Map(),
      recentDecisions: [],
    },
    knowledgeScope: [],
    personality: [],
    speakingStyle: "",
  }
}

function makeRumorEvent(
  id: string,
  content: string,
  observableBy: string[],
  distortion = 0.5,
): RumorEvent {
  return {
    id,
    round: 0,
    nodeIndex: 0,
    sourceId: null,
    content,
    distortion,
    observableBy,
    believedBy: [],
    verifiedBy: [],
    timestamp: "2026-07-04T00:00:00.000Z",
  }
}

function setupBlackboardWithRumors(): {
  agentA: NovelAgent
  agentB: NovelAgent
  blackboard: SimulationBlackboard
} {
  const agentA = makeAgent("a", "甲")
  const agentB = makeAgent("b", "乙")
  const blackboard = createSimulationBlackboard({ agents: [agentA, agentB] })
  return { agentA, agentB, blackboard }
}

describe("findMatchingRumor", () => {
  it("能按描述精确匹配传闻", () => {
    const { blackboard } = setupBlackboardWithRumors()
    const rumor = makeRumorEvent(
      "r1",
      "听说城主私通敌国，准备在今晚开城门",
      ["a", "b"],
    )
    recordRumorEvent(blackboard, rumor)

    const result = findMatchingRumor(blackboard, "a", "听说城主私通敌国，准备在今晚开城门")
    expect(result).not.toBeNull()
    expect(result?.id).toBe("r1")
  })

  it("能通过关键词重叠度匹配传闻", () => {
    const { blackboard } = setupBlackboardWithRumors()
    const rumor = makeRumorEvent(
      "r1",
      "听说城主私通敌国，准备在今晚开城门",
      ["a", "b"],
    )
    recordRumorEvent(blackboard, rumor)

    const result = findMatchingRumor(blackboard, "a", "城主私通敌国")
    expect(result).not.toBeNull()
    expect(result?.id).toBe("r1")
  })

  it("找不到匹配的传闻返回 null", () => {
    const { blackboard } = setupBlackboardWithRumors()
    const rumor = makeRumorEvent("r1", "今天天气真好", ["a"])
    recordRumorEvent(blackboard, rumor)

    const result = findMatchingRumor(blackboard, "a", "城主私通敌国")
    expect(result).toBeNull()
  })

  it("只在 agent 可见的传闻中查找", () => {
    const { blackboard } = setupBlackboardWithRumors()
    const rumor = makeRumorEvent("r1", "听说城主私通敌国", ["b"])
    recordRumorEvent(blackboard, rumor)

    const resultA = findMatchingRumor(blackboard, "a", "城主私通敌国")
    expect(resultA).toBeNull()

    const resultB = findMatchingRumor(blackboard, "b", "城主私通敌国")
    expect(resultB).not.toBeNull()
    expect(resultB?.id).toBe("r1")
  })
})

describe("verifyRumor", () => {
  it("confirmed 写入 knownSecrets 并加入 verifiedBy 和 believedBy", () => {
    const { agentA, blackboard } = setupBlackboardWithRumors()
    const rumor = makeRumorEvent(
      "r1",
      "听说城主私通敌国",
      ["a"],
      0.1,
    )
    recordRumorEvent(blackboard, rumor)

    const result = verifyRumor(blackboard, "a", "r1", "confirmed")

    expect(result).toContain("确认属实")
    expect(result).toContain("城主私通敌国")
    expect(agentA.memory.knownSecrets.has("城主私通敌国")).toBe(true)
    expect(rumor.verifiedBy).toContain("a")
    expect(rumor.believedBy).toContain("a")
  })

  it("debunked 从可见传闻中移除并加入 observedEvents", () => {
    const { agentA, blackboard } = setupBlackboardWithRumors()
    const rumor = makeRumorEvent(
      "r1",
      "听说城主私通敌国",
      ["a"],
      0.9,
    )
    recordRumorEvent(blackboard, rumor)

    const beforeVisible = blackboard.visibleRumorsByAgent.get("a")!.length
    const result = verifyRumor(blackboard, "a", "r1", "debunked")
    const afterVisible = blackboard.visibleRumorsByAgent.get("a")!.length

    expect(result).toContain("证实为假")
    expect(afterVisible).toBe(beforeVisible - 1)
    expect(agentA.memory.observedEvents.length).toBeGreaterThan(0)
    expect(rumor.verifiedBy).toContain("a")
  })

  it("partial 写入 knownSecrets（带前缀）并加入 observedEvents", () => {
    const { agentA, blackboard } = setupBlackboardWithRumors()
    const rumor = makeRumorEvent(
      "r1",
      "听说城主私通敌国",
      ["a"],
      0.5,
    )
    recordRumorEvent(blackboard, rumor)

    const result = verifyRumor(blackboard, "a", "r1", "partial")

    expect(result).toContain("部分属实")
    const hasPartialSecret = Array.from(agentA.memory.knownSecrets).some((s) =>
      s.includes("部分属实"),
    )
    expect(hasPartialSecret).toBe(true)
    expect(agentA.memory.observedEvents.length).toBeGreaterThan(0)
    expect(rumor.verifiedBy).toContain("a")
  })

  it("confirmed 去掉听说/据说/传言/有消息称/据传前缀", () => {

    const testCases = [
      { prefix: "听说", content: "听说城主私通敌国" },
      { prefix: "据说", content: "据说城主私通敌国" },
      { prefix: "传言", content: "传言城主私通敌国" },
      { prefix: "有消息称", content: "有消息称城主私通敌国" },
      { prefix: "据传", content: "据传城主私通敌国" },
    ]

    for (const tc of testCases) {
      const agent = makeAgent(tc.prefix, tc.prefix)
      const bb = createSimulationBlackboard({ agents: [agent] })
      const rumor = makeRumorEvent(`r-${tc.prefix}`, tc.content, [tc.prefix], 0.1)
      recordRumorEvent(bb, rumor)

      verifyRumor(bb, tc.prefix, `r-${tc.prefix}`, "confirmed")

      expect(agent.memory.knownSecrets.has("城主私通敌国")).toBe(true)
    }
  })
})

describe("decideRumorTruth", () => {
  it("低 distortion 高概率 confirmed（100 次 > 60 次）", () => {
    let confirmedCount = 0
    for (let i = 0; i < 100; i++) {
      const result = decideRumorTruth(0.1)
      if (result === "confirmed") confirmedCount++
    }
    expect(confirmedCount).toBeGreaterThan(60)
  })

  it("高 distortion 高概率 debunked（100 次 > 25 次）", () => {
    let debunkedCount = 0
    for (let i = 0; i < 100; i++) {
      const result = decideRumorTruth(0.9)
      if (result === "debunked") debunkedCount++
    }
    expect(debunkedCount).toBeGreaterThan(25)
  })

  it("返回值只能是 confirmed/debunked/partial", () => {
    for (let d = 0; d <= 1; d += 0.1) {
      const result = decideRumorTruth(d)
      expect(["confirmed", "debunked", "partial"]).toContain(result)
    }
  })
})
