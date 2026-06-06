import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { StreamCallbacks } from "@/lib/llm-client"
import type { ContextPack } from "./context-engine"
import {
  buildDimensionReviewPrompt,
  reviewChapterDimension,
  runSixDimensionReview,
  SIX_REVIEW_DIMENSION_ORDER,
  SIX_REVIEW_DIMENSIONS,
} from "./dimension-review-adapter"

const mocks = vi.hoisted(() => ({
  streamChatMock: vi.fn(),
  buildContextPackMock: vi.fn(),
  llmConfig: {
    provider: "custom" as const,
    apiKey: "test-key",
    model: "test-review-model",
    ollamaUrl: "",
    customEndpoint: "https://example.test/v1",
    maxContextSize: 120000,
    reasoning: { mode: "off" as const },
  },
  contextPack: {
    task: "审查第8章",
    chapterGoal: "第8章目标：主角进入祠堂，发现族谱异常。",
    outline: "总大纲：围绕族谱秘密推进。\n第8章章纲：进入祠堂，发现族谱缺页。",
    recentSummaries: ["第6章：主角得到旧钥匙。", "第7章：主角抵达村口。"],
    previousChapterEnding: "祠堂门缝里透出一线冷光。",
    characterStates: "主角谨慎，小晴仍隐瞒自己知道族谱。",
    soulDoc: "项目灵魂：悬疑、克制、现实压力。",
    characterAuras: "主角表达克制，不会突然热血喊口号。",
    cognitionStates: "主角不知道族谱已经被人换过。",
    foreshadowingStates: "旧钥匙、族谱缺页、门缝冷光都未回收。",
    timeline: "雨夜，进入祠堂前后不超过一小时。",
    relatedSettings: "祠堂位于村东，只有一扇正门。",
    canonRules: "不能提前揭露小晴真实身份。",
    writingStyle: "短句、悬疑、画面感。",
    searchResults: "相关记忆：旧钥匙来自第6章。",
    graphSearchResults: "旧钥匙 -> 祠堂 -> 族谱缺页。",
    mustDo: "必须承接门缝冷光并推进族谱异常。",
    mustAvoid: "不能让主角凭空知道族谱被换。",
    nextChapterAdvice: "下一章继续追查族谱缺页。",
    revisionDirectives: "上一轮反馈：避免重复解释。",
  },
}))

const streamChatMock = mocks.streamChatMock
const buildContextPackMock = mocks.buildContextPackMock
const llmConfig = mocks.llmConfig as LlmConfig
const contextPack = mocks.contextPack satisfies ContextPack

vi.mock("@/lib/llm-client", () => ({
  streamChat: mocks.streamChatMock,
}))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: () => ({
      llmConfig,
      novelConfig: { reviewModel: "" },
      novelMode: true,
    }),
  },
}))

vi.mock("@/lib/has-usable-llm", () => ({
  hasUsableLlm: () => true,
}))

vi.mock("./model-resolver", () => ({
  resolveNovelModel: (config: LlmConfig) => config,
}))

vi.mock("./context-engine", () => ({
  buildContextPack: mocks.buildContextPackMock,
  contextPackToPrompt: (pack: ContextPack) => [
    `当前任务：${pack.task}`,
    `章节目标：${pack.chapterGoal}`,
    `大纲：${pack.outline}`,
    `上一章结尾：${pack.previousChapterEnding}`,
    `人物状态：${pack.characterStates}`,
    `角色认知：${pack.cognitionStates}`,
    `伏笔状态：${pack.foreshadowingStates}`,
    `时间线：${pack.timeline}`,
    `相关记忆：${pack.searchResults}`,
  ].join("\n"),
}))

describe("six-dimension review adapter", () => {
  beforeEach(() => {
    streamChatMock.mockReset()
    buildContextPackMock.mockReset()
    buildContextPackMock.mockResolvedValue(contextPack)
  })

  it("defines six independent professional review workflows", () => {
    expect(SIX_REVIEW_DIMENSION_ORDER).toEqual([
      "thrill",
      "consistency",
      "pacing",
      "character",
      "continuity",
      "pull",
    ])

    expect(Object.keys(SIX_REVIEW_DIMENSIONS)).toEqual(SIX_REVIEW_DIMENSION_ORDER)
    expect(SIX_REVIEW_DIMENSIONS.thrill.label).toBe("爽感密度")
    expect(SIX_REVIEW_DIMENSIONS.thrill.stages.join("\n")).toContain("压抑与释放链检查")
    expect(SIX_REVIEW_DIMENSIONS.consistency.stages.join("\n")).toContain("规则一致性检查")
    expect(SIX_REVIEW_DIMENSIONS.pull.stages.join("\n")).toContain("结尾钩子检查")
  })

  it("builds a dimension-specific prompt with shared context and strict output rules", () => {
    const prompt = buildDimensionReviewPrompt(contextPack, "主角直接说出族谱被换。", SIX_REVIEW_DIMENSIONS.thrill)

    expect(prompt).toContain("爽感密度")
    expect(prompt).toContain("压抑与释放链检查")
    expect(prompt).toContain("当前任务：审查第8章")
    expect(prompt).toContain("只输出阶段分析")
    expect(prompt).toContain("score")
    expect(prompt).toContain("issues")
  })

  it("runs one dimension with two high-reasoning model calls and publishes thinking", async () => {
    streamChatMock.mockImplementation(async (
      _config: LlmConfig,
      messages: Array<{ role: string; content: string }>,
      callbacks: StreamCallbacks,
    ) => {
      const prompt = messages.map((message) => message.content).join("\n")
      if (prompt.includes("最终 JSON")) {
        callbacks.onToken(JSON.stringify({
          score: 72,
          status: "medium",
          summary: "爽点有铺垫，但兑现偏弱。",
          issues: [{
            severity: "warning",
            type: "thrill",
            message: "主爽点兑现不足",
            evidence: "主角直接说出族谱被换。",
            relatedMemory: "第8章章纲要求发现族谱异常。",
            suggestion: "增加压抑后的反转与奖励兑现。",
            impact: "读者情绪释放不足。",
            rewriteTarget: "主角直接说出族谱被换。",
          }],
        }))
      } else {
        callbacks.onToken("阶段分析：已检查压抑与释放链。")
      }
      callbacks.onDone()
    })

    const thinking: string[] = []
    const result = await reviewChapterDimension({
      llmConfig,
      contextPack,
      chapterContent: "主角直接说出族谱被换。",
      dimension: SIX_REVIEW_DIMENSIONS.thrill,
      callbacks: {
        onThinking: (_dimensionKey, content) => thinking.push(content),
      },
    })

    expect(streamChatMock).toHaveBeenCalledTimes(2)
    expect(streamChatMock.mock.calls.every((call) => call[4]?.reasoning?.mode === "high")).toBe(true)
    expect(thinking.join("\n")).toContain("爽感密度")
    expect(thinking.join("\n")).toContain("阶段分析：已检查压抑与释放链。")
    expect(result).toMatchObject({
      dimensionKey: "thrill",
      score: 72,
      status: "medium",
      summary: "爽点有铺垫，但兑现偏弱。",
    })
    expect(result.issues[0]).toMatchObject({
      dimensionKey: "thrill",
      message: "主爽点兑现不足",
      impact: "读者情绪释放不足。",
      rewriteTarget: "主角直接说出族谱被换。",
    })
  })

  it("coalesces high-frequency dimension thinking callbacks from streamed tokens", async () => {
    streamChatMock.mockImplementation(async (
      _config: LlmConfig,
      messages: Array<{ role: string; content: string }>,
      callbacks: StreamCallbacks,
    ) => {
      const prompt = messages.map((message) => message.content).join("\n")
      if (prompt.includes("最终 JSON")) {
        callbacks.onToken(JSON.stringify({
          score: 90,
          status: "pass",
          summary: "爽感密度通过",
          issues: [],
        }))
      } else {
        for (let i = 0; i < 50; i += 1) {
          callbacks.onToken(`阶段片段 ${i}`)
        }
      }
      callbacks.onDone()
    })

    const thinking: string[] = []
    await reviewChapterDimension({
      llmConfig,
      contextPack,
      chapterContent: "主角直接说出族谱被换。",
      dimension: SIX_REVIEW_DIMENSIONS.thrill,
      callbacks: {
        onThinking: (_dimensionKey, content) => thinking.push(content),
      },
    })

    expect(thinking.length).toBeLessThan(20)
    expect(thinking.join("\n")).toContain("阶段片段 49")
  })

  it("runs all six dimensions with one shared context and continues after one failure", async () => {
    const finalCallDimensions: string[] = []
    streamChatMock.mockImplementation(async (
      _config: LlmConfig,
      messages: Array<{ role: string; content: string }>,
      callbacks: StreamCallbacks,
    ) => {
      const prompt = messages.map((message) => message.content).join("\n")
      if (!prompt.includes("最终 JSON")) {
        callbacks.onToken("阶段分析完成")
        callbacks.onDone()
        return
      }

      const dimension = SIX_REVIEW_DIMENSION_ORDER.find((key) => prompt.includes(SIX_REVIEW_DIMENSIONS[key].label))
      if (!dimension) throw new Error("missing dimension")
      finalCallDimensions.push(dimension)
      if (dimension === "pacing") {
        throw new Error("模型暂时不可用")
      }
      callbacks.onToken(JSON.stringify({
        score: 90,
        status: "pass",
        summary: `${SIX_REVIEW_DIMENSIONS[dimension].label}通过`,
        issues: [],
      }))
      callbacks.onDone()
    })

    const results = await runSixDimensionReview({
      projectPath: "E:/Novel",
      chapterContent: "章节正文",
      chapterNumber: 8,
    })

    expect(buildContextPackMock).toHaveBeenCalledTimes(1)
    expect(finalCallDimensions).toEqual(SIX_REVIEW_DIMENSION_ORDER)
    expect(Object.keys(results)).toEqual(SIX_REVIEW_DIMENSION_ORDER)
    expect(results.pacing?.status).toBe("error")
    expect(results.pacing?.issues[0].message).toContain("节奏张力审查失败")
    expect(results.pull?.summary).toBe("追读引力通过")
  })
})
