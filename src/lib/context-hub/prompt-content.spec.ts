import { describe, expect, it } from "vitest"
import type { ContentBlock } from "@/lib/llm-providers"
import { buildContextHubSystemContent, flattenContextHubSystemContent, buildContextHubPromptParts, withContextHubTaskContent, markHistoryCacheBoundary } from "./prompt-content"
import type { ContextHubResult } from "./types"

/**
 * 断言并收窄为文本块。ContentBlock 是 text | image 的可辨识联合，
 * 直接读 .text 不合法；这里先断言再收窄，遇到图片块会让用例失败而不是静默跳过。
 */
function expectTextBlock(block: ContentBlock): Extract<ContentBlock, { type: "text" }> {
  expect(block.type).toBe("text")
  if (block.type !== "text") throw new Error("expected a text content block")
  return block
}

const result: ContextHubResult = {
  surface: "ai-chat",
  stableCore: "稳定项目核心",
  sessionSummary: "当前会话摘要",
  dynamicContext: "任务动态片段",
  contextPack: {
    task: "调整第二章",
    chapterGoal: "",
    outline: "",
    recentSummaries: [],
    previousChapterEnding: "",
    characterStates: "",
    soulDoc: "",
    characterAuras: "",
    storyFrameworkBinding: "",
    cognitionStates: "",
    foreshadowingStates: "",
    timeline: "",
    relatedSettings: "",
    canonRules: "",
    writingStyle: "",
    searchResults: "",
    graphSearchResults: "",
    mustDo: "",
    mustAvoid: "",
    nextChapterAdvice: "",
    revisionDirectives: "",
  },
  dependencyStamp: { fingerprint: "prompt-content-spec", sourceCount: 0, kinds: [] },
  stats: {
    cacheHits: 0,
    reloaded: 0,
    empty: 0,
    fallbackUsed: 0,
    readFailed: 0,
    writeFailed: 0,
    stableTokens: 0,
    summaryTokens: 0,
    dynamicTokens: 0,
    candidateTokens: 0,
    estimatedSavedTokens: 0,
    estimatedSavedPercent: 0,
    expanded: false,
    providerCacheEnabled: false,
  },
  cacheItems: [],
  warnings: [],
  readFile: async () => "",
}

describe("context hub system content", () => {
  it("places stable core after software rules and marks its end as cacheable", () => {
    const content = buildContextHubSystemContent("软件规则", result, ["本轮任务规则"])

    expect(content).toEqual([
      { type: "text", text: "软件规则\n\n" },
      { type: "text", text: "## 项目稳定核心\n稳定项目核心", cacheControl: true },
      { type: "text", text: "\n\n## 当前会话摘要\n当前会话摘要\n\n## 本轮动态上下文\n任务动态片段\n\n本轮任务规则" },
    ])
  })

  it("flattens blocks byte-for-byte for non-Anthropic provider configs", () => {
    const content = buildContextHubSystemContent("软件规则", result, ["本轮任务规则"])

    expect(flattenContextHubSystemContent(content)).toBe(content.map((block) => expectTextBlock(block).text).join(""))
  })
})


describe("对话缓存前缀与本轮资料分离", () => {
  it("摘要、任务和阶段规则变化不再改变系统前缀", () => {
    const first = buildContextHubPromptParts("固定软件规则", result, ["分析阶段"])
    const second = buildContextHubPromptParts("固定软件规则", {
      ...result,
      sessionSummary: "新的会话摘要",
      dynamicContext: "新的任务资料",
    }, ["生成阶段"])
    expect(first.systemContent).toEqual(second.systemContent)
    expect(flattenContextHubSystemContent(first.systemContent)).not.toContain("当前会话摘要")
    expect(flattenContextHubSystemContent(first.taskContext)).toContain("当前会话摘要")
    expect(flattenContextHubSystemContent(second.taskContext)).toContain("新的任务资料")
    expect(flattenContextHubSystemContent(second.taskContext)).toContain("生成阶段")
  })

  it("同一资料包不同阶段复用完整资料前缀，变化规则在断点之后", () => {
    const material = { ...result, dynamicContext: "同一份章节材料".repeat(1500) }
    const first = buildContextHubPromptParts("固定规则", material, ["先做意图分析"])
    const second = buildContextHubPromptParts("固定规则", material, ["根据分析生成大纲"])
    expect(first.taskContext[0]).toEqual(second.taskContext[0])
    expect(first.taskContext[0]).toMatchObject({ cacheControl: true })
    const materialBlock = expectTextBlock(first.taskContext[0])
    expect(materialBlock.text).toContain(material.dynamicContext)
    expect(materialBlock.text).not.toContain("先做意图分析")
    expect(expectTextBlock(first.taskContext[1]).text).toContain("先做意图分析")
  })

  it("把本轮资料放到当前用户消息中，保留图片和原始请求且不修改输入", () => {
    const image = { type: "image" as const, mediaType: "image/png", dataBase64: "test-image" }
    const user = [{ type: "text" as const, text: "只调整第二章" }, image]
    const parts = buildContextHubPromptParts("固定规则", result, ["不得改写人物设定"])
    const combined = withContextHubTaskContent(user, parts.taskContext)
    expect(combined).toContainEqual(image)
    expect(flattenContextHubSystemContent(combined)).toContain("只调整第二章")
    expect(flattenContextHubSystemContent(combined)).toContain("不得改写人物设定")
    expect(user).toEqual([{ type: "text", text: "只调整第二章" }, image])
  })

  it("只在最后一条可复用历史文本加断点，不改变历史正文和原对象", () => {
    const history = [{ role: "user" as const, content: "初始要求" }, { role: "assistant" as const, content: "已确认方案" }]
    const marked = markHistoryCacheBoundary(history)
    expect(marked[0]).toEqual(history[0])
    expect(marked[1].content).toEqual([{ type: "text", text: "已确认方案", cacheControl: true }])
    expect(history[1].content).toBe("已确认方案")
  })
})
