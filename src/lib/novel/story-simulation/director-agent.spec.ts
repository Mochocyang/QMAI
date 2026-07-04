import { describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { StoryNode, TimelineEvent, DirectorEvaluation, DirectorScore } from "./types"
import {
  shouldInjectEvent,
  directorEvaluate,
} from "./director-agent"

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

const mockNode: StoryNode = {
  index: 0,
  phase: "起",
  title: "初入宗门",
  coreConflict: "主角初入宗门，面临身份危机",
  involvedCharacters: ["张三", "李四"],
  goal: "主角成功拜入宗门",
  causeFromPrev: "",
  expectedOutcome: "主角通过考验，正式成为宗门弟子",
}

const mockTimelineEvents: TimelineEvent[] = [
  {
    id: "evt_1",
    round: 0,
    nodeIndex: 0,
    actorId: "char_1",
    actorName: "张三",
    actionType: "pushPlot",
    content: "张三来到宗门门口报名",
    observableBy: ["char_1", "char_2"],
    impacts: [],
    timestamp: "2024-01-01T00:00:00.000Z",
  },
]

function buildMockScores(overrides: Partial<DirectorScore> = {}): DirectorScore {
  return {
    tension: 3,
    pace: 3,
    characterUtilization: 3,
    characterArc: 3,
    infoDensity: 3,
    emotionalResonance: 3,
    logicConsistency: 3,
    ...overrides,
  }
}

describe("shouldInjectEvent", () => {
  it("shouldInjectEvent 为 true 且有 injectEvent 时返回 true", () => {
    const eval_: DirectorEvaluation = {
      scores: buildMockScores({ tension: 2 }),
      totalScore: 2.5,
      highlights: ["亮点1"],
      issues: ["问题1"],
      suggestion: "建议增加冲突",
      shouldInjectEvent: true,
      injectEvent: "一位长老突然出现，质疑主角的身份。",
    }
    expect(shouldInjectEvent(eval_)).toBe(true)
  })

  it("shouldInjectEvent 为 false 时返回 false，即使有 injectEvent", () => {
    const eval_: DirectorEvaluation = {
      scores: buildMockScores(),
      totalScore: 3.0,
      highlights: ["亮点1"],
      issues: [],
      suggestion: "",
      shouldInjectEvent: false,
      injectEvent: "一位长老突然出现，质疑主角的身份。",
    }
    expect(shouldInjectEvent(eval_)).toBe(false)
  })

  it("shouldInjectEvent 为 true 但没有 injectEvent 时返回 false", () => {
    const eval_: DirectorEvaluation = {
      scores: buildMockScores({ tension: 2 }),
      totalScore: 2.0,
      highlights: ["亮点1"],
      issues: ["问题1"],
      suggestion: "建议增加冲突",
      shouldInjectEvent: true,
    }
    expect(shouldInjectEvent(eval_)).toBe(false)
  })

  it("totalScore < 3 且 shouldInjectEvent 为 true 且有 injectEvent 时返回 true", () => {
    const eval_: DirectorEvaluation = {
      scores: buildMockScores({ tension: 1, pace: 1, characterUtilization: 1 }),
      totalScore: 2.0,
      highlights: [],
      issues: ["剧情太拖沓", "张力不足"],
      suggestion: "剧情太拖沓，需要增加冲突",
      shouldInjectEvent: true,
      injectEvent: "意外事件发生",
    }
    expect(shouldInjectEvent(eval_)).toBe(true)
  })

  it("totalScore >= 3 时 shouldInjectEvent 应为 false，返回 false", () => {
    const eval_: DirectorEvaluation = {
      scores: buildMockScores({ tension: 4 }),
      totalScore: 3.5,
      highlights: ["节奏紧凑", "角色鲜明"],
      issues: [],
      suggestion: "保持当前节奏",
      shouldInjectEvent: false,
    }
    expect(shouldInjectEvent(eval_)).toBe(false)
  })
})

describe("directorEvaluate", () => {
  it("LLM 返回有效 JSON 时应正确解析 7 维度评分并计算总分", async () => {
    const { streamChat } = await import("@/lib/llm-client")

    vi.mocked(streamChat).mockImplementationOnce(
      (_config, _messages, callbacks) => {
        callbacks.onToken(
          JSON.stringify({
            scores: {
              tension: 2,
              pace: 2,
              characterUtilization: 3,
              characterArc: 2,
              infoDensity: 2,
              emotionalResonance: 2,
              logicConsistency: 3,
            },
            totalScore: 2.29,
            highlights: ["角色互动自然"],
            issues: ["节奏偏慢", "张力不足"],
            suggestion: "当前节点节奏偏慢，建议增加冲突事件提升张力",
            shouldInjectEvent: true,
            injectEvent: "一位神秘长老突然出现，当众质疑主角的身份来历。",
          }),
        )
        callbacks.onDone()
        return Promise.resolve()
      },
    )

    const result = await directorEvaluate({
      node: mockNode,
      nodeTimelineEvents: mockTimelineEvents,
      worldRules: "这是一个玄幻世界",
      llmConfig: mockLlmConfig,
    })

    expect(result.scores.tension).toBe(2)
    expect(result.scores.pace).toBe(2)
    expect(result.scores.characterUtilization).toBe(3)
    expect(result.scores.characterArc).toBe(2)
    expect(result.scores.infoDensity).toBe(2)
    expect(result.scores.emotionalResonance).toBe(2)
    expect(result.scores.logicConsistency).toBe(3)
    expect(result.totalScore).toBeCloseTo(
      (2 + 2 + 3 + 2 + 2 + 2 + 3) / 7,
      2,
    )
    expect(result.highlights).toEqual(["角色互动自然"])
    expect(result.issues).toEqual(["节奏偏慢", "张力不足"])
    expect(result.suggestion).toBe(
      "当前节点节奏偏慢，建议增加冲突事件提升张力",
    )
    expect(result.shouldInjectEvent).toBe(true)
    expect(result.injectEvent).toBe(
      "一位神秘长老突然出现，当众质疑主角的身份来历。",
    )
  })

  it("LLM 未返回 totalScore 时应自动计算 7 项平均", async () => {
    const { streamChat } = await import("@/lib/llm-client")

    vi.mocked(streamChat).mockImplementationOnce(
      (_config, _messages, callbacks) => {
        callbacks.onToken(
          JSON.stringify({
            scores: {
              tension: 4,
              pace: 5,
              characterUtilization: 4,
              characterArc: 5,
              infoDensity: 4,
              emotionalResonance: 5,
              logicConsistency: 4,
            },
            highlights: ["节奏紧凑", "角色弧光完整"],
            issues: [],
            suggestion: "保持当前节奏和质量",
            shouldInjectEvent: false,
          }),
        )
        callbacks.onDone()
        return Promise.resolve()
      },
    )

    const result = await directorEvaluate({
      node: mockNode,
      nodeTimelineEvents: mockTimelineEvents,
      worldRules: "这是一个玄幻世界",
      llmConfig: mockLlmConfig,
    })

    const expectedTotal = (4 + 5 + 4 + 5 + 4 + 5 + 4) / 7
    expect(result.totalScore).toBeCloseTo(expectedTotal, 2)
  })

  it("LLM 返回带 markdown 代码块的 JSON 时也能解析", async () => {
    const { streamChat } = await import("@/lib/llm-client")

    vi.mocked(streamChat).mockImplementationOnce(
      (_config, _messages, callbacks) => {
        callbacks.onToken(
          "```json\n" +
            JSON.stringify({
              scores: {
                tension: 4,
                pace: 3,
                characterUtilization: 4,
                characterArc: 4,
                infoDensity: 3,
                emotionalResonance: 4,
                logicConsistency: 4,
              },
              totalScore: 3.71,
              highlights: ["节奏不错", "角色塑造成功"],
              issues: [],
              suggestion: "节奏不错",
              shouldInjectEvent: false,
            }) +
            "\n```",
        )
        callbacks.onDone()
        return Promise.resolve()
      },
    )

    const result = await directorEvaluate({
      node: mockNode,
      nodeTimelineEvents: mockTimelineEvents,
      worldRules: "这是一个玄幻世界",
      llmConfig: mockLlmConfig,
    })

    expect(result.scores.tension).toBe(4)
    expect(result.scores.pace).toBe(3)
    expect(result.scores.characterUtilization).toBe(4)
    expect(result.scores.characterArc).toBe(4)
    expect(result.scores.infoDensity).toBe(3)
    expect(result.scores.emotionalResonance).toBe(4)
    expect(result.scores.logicConsistency).toBe(4)
    expect(result.highlights).toEqual(["节奏不错", "角色塑造成功"])
    expect(result.suggestion).toBe("节奏不错")
    expect(result.shouldInjectEvent).toBe(false)
    expect(result.injectEvent).toBeUndefined()
  })

  it("LLM 失败时应返回默认评估且不阻断", async () => {
    const { streamChat } = await import("@/lib/llm-client")

    vi.mocked(streamChat).mockImplementationOnce(
      (_config, _messages, callbacks) => {
        callbacks.onError(new Error("网络连接失败"))
        return Promise.resolve()
      },
    )

    const result = await directorEvaluate({
      node: mockNode,
      nodeTimelineEvents: mockTimelineEvents,
      worldRules: "这是一个玄幻世界",
      llmConfig: mockLlmConfig,
    })

    expect(result.scores.tension).toBe(3)
    expect(result.scores.pace).toBe(3)
    expect(result.scores.characterUtilization).toBe(3)
    expect(result.scores.characterArc).toBe(3)
    expect(result.scores.infoDensity).toBe(3)
    expect(result.scores.emotionalResonance).toBe(3)
    expect(result.scores.logicConsistency).toBe(3)
    expect(result.totalScore).toBe(3.0)
    expect(result.highlights).toEqual([])
    expect(result.issues).toEqual([])
    expect(result.suggestion).toBe("")
    expect(result.shouldInjectEvent).toBe(false)
    expect(result.injectEvent).toBeUndefined()
  })

  it("LLM 返回无效 JSON 时应返回默认评估", async () => {
    const { streamChat } = await import("@/lib/llm-client")

    vi.mocked(streamChat).mockImplementationOnce(
      (_config, _messages, callbacks) => {
        callbacks.onToken("这不是一个有效的 JSON，只是一段评价文字。")
        callbacks.onDone()
        return Promise.resolve()
      },
    )

    const result = await directorEvaluate({
      node: mockNode,
      nodeTimelineEvents: mockTimelineEvents,
      worldRules: "这是一个玄幻世界",
      llmConfig: mockLlmConfig,
    })

    expect(result.scores.tension).toBe(3)
    expect(result.scores.pace).toBe(3)
    expect(result.scores.characterUtilization).toBe(3)
    expect(result.totalScore).toBe(3.0)
  })

  it("各维度分数超出范围时应钳制到 1-5 并取整", async () => {
    const { streamChat } = await import("@/lib/llm-client")

    vi.mocked(streamChat).mockImplementationOnce(
      (_config, _messages, callbacks) => {
        callbacks.onToken(
          JSON.stringify({
            scores: {
              tension: 10,
              pace: -1,
              characterUtilization: 5.6,
              characterArc: 2.3,
              infoDensity: 100,
              emotionalResonance: 0,
              logicConsistency: 3.7,
            },
            highlights: [],
            issues: [],
            suggestion: "",
            shouldInjectEvent: false,
          }),
        )
        callbacks.onDone()
        return Promise.resolve()
      },
    )

    const result = await directorEvaluate({
      node: mockNode,
      nodeTimelineEvents: mockTimelineEvents,
      worldRules: "这是一个玄幻世界",
      llmConfig: mockLlmConfig,
    })

    expect(result.scores.tension).toBe(5)
    expect(result.scores.pace).toBe(1)
    expect(result.scores.characterUtilization).toBe(5)
    expect(result.scores.characterArc).toBe(2)
    expect(result.scores.infoDensity).toBe(5)
    expect(result.scores.emotionalResonance).toBe(1)
    expect(result.scores.logicConsistency).toBe(4)
  })

  it("highlights 和 issues 不是数组时应容错为空数组", async () => {
    const { streamChat } = await import("@/lib/llm-client")

    vi.mocked(streamChat).mockImplementationOnce(
      (_config, _messages, callbacks) => {
        callbacks.onToken(
          JSON.stringify({
            scores: buildMockScores(),
            totalScore: 3.0,
            highlights: "这是亮点",
            issues: 123,
            suggestion: "测试容错",
            shouldInjectEvent: false,
          }),
        )
        callbacks.onDone()
        return Promise.resolve()
      },
    )

    const result = await directorEvaluate({
      node: mockNode,
      nodeTimelineEvents: mockTimelineEvents,
      worldRules: "这是一个玄幻世界",
      llmConfig: mockLlmConfig,
    })

    expect(result.highlights).toEqual([])
    expect(result.issues).toEqual([])
  })
})
