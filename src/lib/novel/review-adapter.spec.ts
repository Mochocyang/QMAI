import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { StreamCallbacks } from "@/lib/llm-client"
import type { ContextPack } from "./context-engine"
import { buildReviewPrompt, reviewChapter } from "./review-adapter"

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
    reasoning: { mode: "auto" as const },
  },
  contextPack: {
    task: "审稿第8章",
    chapterGoal: "第8章目标：主角按照章纲进入祠堂，发现族谱被改动。",
    outline: "总大纲：主线围绕族谱秘密推进。\n第8章章纲：进入祠堂，发现族谱异常。",
    recentSummaries: ["第6章：主角得到旧钥匙。", "第7章：主角抵达村口。"],
    previousChapterEnding: "祠堂门缝里透出一线冷光。",
    characterStates: "主角谨慎，小晴仍然隐瞒她知道族谱。 ",
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
  REVIEW_CONTEXT_OPTIONS: {
    includeVectorSearch: false,
    includeGraphSearch: false,
    includeRerank: false,
    maxSearchTopK: 3,
  },
  contextPackToPrompt: (pack: ContextPack) => [
    `当前任务：${pack.task}`,
    `当前章节目标：${pack.chapterGoal}`,
    `大纲要求：${pack.outline}`,
    `最近剧情摘要：${pack.recentSummaries.join(" / ")}`,
    `上一章结尾：${pack.previousChapterEnding}`,
    `当前人物状态：${pack.characterStates}`,
    `角色认知状态：${pack.cognitionStates}`,
    `当前伏笔状态：${pack.foreshadowingStates}`,
    `时间线：${pack.timeline}`,
    `相关记忆检索：${pack.searchResults}`,
    `图谱检索：${pack.graphSearchResults}`,
    `修改反馈：${pack.revisionDirectives}`,
  ].join("\n"),
}))

describe("review-adapter staged review", () => {
  beforeEach(() => {
    streamChatMock.mockReset()
    buildContextPackMock.mockReset()
    buildContextPackMock.mockResolvedValue(contextPack)
    llmConfig.reasoning = { mode: "auto" }
  })

  it("builds a staged deep review prompt with outline, memory, foreshadowing, and cognition checks", () => {
    const prompt = buildReviewPrompt(contextPack, "主角直接说出族谱被换。")

    expect(prompt).toContain("阶段1：审查任务识别")
    expect(prompt).toContain("阶段2：上下文检索")
    expect(prompt).toContain("阶段3：章节目标对齐")
    expect(prompt).toContain("阶段4：事实与记忆核对")
    expect(prompt).toContain("阶段5：逐维度审查")
    expect(prompt).toContain("阶段6：阻断判定")
    expect(prompt).toContain("阶段7：二次复核")
    expect(prompt).toContain("高级 thinking")
    expect(prompt).toContain("角色认知状态：主角不知道族谱已经被人换过。")
    expect(prompt).toContain("当前伏笔状态：旧钥匙、族谱缺页、门缝冷光都未回收。")
  })

  it("runs staged review with high reasoning and publishes stage thinking", async () => {
    llmConfig.reasoning = { mode: "off" }
    streamChatMock.mockImplementation(async (
      _config: LlmConfig,
      messages: Array<{ role: string; content: string }>,
      callbacks: StreamCallbacks,
    ) => {
      const prompt = messages.map((message) => message.content).join("\n")
      if (prompt.includes("最终审查 JSON")) {
        callbacks.onToken(JSON.stringify([{
          severity: "error",
          type: "cognition",
          message: "主角知道了不该知道的信息。",
          evidence: "主角直接说出族谱被换。",
          relatedMemory: "角色认知状态：主角不知道族谱已经被人换过。",
          suggestion: "改为通过族谱缺页和行为细节推断异常。",
        }]))
      } else {
        callbacks.onToken("阶段分析完成")
      }
      callbacks.onDone()
    })

    const thinking: string[] = []
    const results = await reviewChapter(
      "E:/Novel",
      "主角直接说出族谱被换。",
      8,
      { onThinking: (content) => thinking.push(content) },
    )

    expect(streamChatMock).toHaveBeenCalledTimes(4)
    expect(buildContextPackMock).toHaveBeenCalledWith(
      "E:/Novel",
      "审稿第8章",
      8,
      expect.objectContaining({
        includeVectorSearch: false,
        includeGraphSearch: false,
        includeRerank: false,
      }),
    )
    expect(streamChatMock.mock.calls.every((call) => call[4]?.reasoning?.mode === "high")).toBe(true)
    expect(thinking.join("\n")).toContain("阶段1：审查任务识别")
    expect(thinking.join("\n")).toContain("阶段4：事实与记忆核对")
    expect(thinking.join("\n")).toContain("阶段7：二次复核")
    const finalThinking = thinking[thinking.length - 1] || ""
    expect(finalThinking).toContain("阶段1：审查任务识别")
    expect(finalThinking).toContain("阶段7：二次复核")
    expect(results).toEqual([{
      severity: "error",
      type: "cognition",
      message: "主角知道了不该知道的信息。",
      evidence: "主角直接说出族谱被换。",
      relatedMemory: "角色认知状态：主角不知道族谱已经被人换过。",
      suggestion: "改为通过族谱缺页和行为细节推断异常。",
    }])
  })

  it("coalesces high-frequency staged thinking callbacks from streamed tokens", async () => {
    let callCount = 0
    streamChatMock.mockImplementation(async (
      _config: LlmConfig,
      _messages: Array<{ role: string; content: string }>,
      callbacks: StreamCallbacks,
    ) => {
      callCount += 1
      if (callCount === 4) {
        callbacks.onToken("[]")
      } else {
        for (let i = 0; i < 50; i += 1) {
          callbacks.onToken(`阶段片段 ${i}`)
        }
      }
      callbacks.onDone()
    })

    const thinking: string[] = []
    await reviewChapter(
      "E:/Novel",
      "主角直接说出族谱被换。",
      8,
      { onThinking: (content) => thinking.push(content) },
    )

    expect(thinking.length).toBeLessThan(20)
    expect(thinking.join("\n")).toContain("阶段片段 49")
  })
})
