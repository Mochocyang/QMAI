import { describe, expect, it } from "vitest"
import type { ContextPack } from "@/lib/novel/context-engine"
import { composeContext } from "./composer"

function pack(overrides: Partial<ContextPack> = {}): ContextPack {
  return {
    task: "续写第二章",
    chapterGoal: "主角发现第一条线索",
    outline: "第一章：失踪\n第二章：旧车站\n第三章：追踪",
    recentChapterContents: [],
    recentSummaries: [],
    previousChapterEnding: "列车驶入黑暗。",
    characterStates: "林默：保持怀疑",
    soulDoc: "克制、现实主义悬疑",
    characterAuras: "",
    cognitionStates: "",
    foreshadowingStates: "旧车票尚未解释",
    timeline: "第二天清晨",
    relatedSettings: "旧车站已经停用十年",
    canonRules: "死者不能复活",
    writingStyle: "短句，限制视角",
    searchResults: "",
    graphSearchResults: "",
    mustDo: "保留悬念",
    mustAvoid: "揭露凶手",
    nextChapterAdvice: "",
    revisionDirectives: "",
    ...overrides,
  }
}

describe("composeContext", () => {
  it("keeps the stable core byte-identical with fixed field ordering", () => {
    const input = { contextPack: pack(), dependencies: { outline: 1 } }
    const first = composeContext(input)
    const second = composeContext(input)

    expect(first.stableCore).toBe(second.stableCore)
    expect(first.stableCore.indexOf("作品灵魂")).toBeLessThan(first.stableCore.indexOf("大纲骨架"))
    expect(first.stableCore).not.toContain("updatedAt")
  })

  it("places explicit references ahead of automatically selected dynamic context", () => {
    const result = composeContext({
      contextPack: pack(),
      dependencies: {},
      referenceContext: ["@引用：人物/林默.md\n林默怕水"],
    })

    expect(result.dynamicContext.indexOf("@引用")).toBeLessThan(result.dynamicContext.indexOf("上一章结尾"))
  })

  it("expands to chapter originals when confidence is low", () => {
    const result = composeContext({
      contextPack: pack({ recentChapterContents: ["第一章原文"], searchResults: "补充检索" }),
      dependencies: {},
      confidence: 0.4,
    })

    expect(result.dynamicContext).toContain("第一章原文")
    expect(result.dynamicContext).toContain("补充检索")
    expect(result.stats.expanded).toBe(true)
  })

  it("trims low-priority search content before required task facts", () => {
    const result = composeContext({
      contextPack: pack({ searchResults: "低相关背景".repeat(500) }),
      dependencies: {},
      tokenBudget: 180,
      confidence: 0.9,
    })

    expect(result.dynamicContext).toContain("续写第二章")
    expect(result.dynamicContext).toContain("保留悬念")
    expect(result.dynamicContext).not.toContain("低相关背景".repeat(100))
  })

  it("reduces a representative repeated-context request by at least 30 percent", () => {
    const result = composeContext({
      contextPack: pack({
        recentChapterContents: Array.from({ length: 12 }, (_, index) => `第${index + 1}章原文：${"情节内容".repeat(500)}`),
        recentSummaries: ["前情摘要：线索指向旧车站。"],
        searchResults: "候选检索".repeat(500),
      }),
      sessionSummary: "当前会话已确认：继续第二章，不揭露凶手。",
      dependencies: {},
      confidence: 0.9,
      tokenBudget: 6000,
    })

    expect(result.stats.estimatedSavedPercent).toBeGreaterThanOrEqual(30)
  })
})
