import { describe, expect, it } from "vitest"
import { computeNovelContextTokenBudget } from "@/lib/context-budget"
import type { ContextPack } from "@/lib/novel/context-engine"
import { composeContext } from "./composer"
import { estimateContextTokens } from "./token-estimator"

const dependencyStamp = { fingerprint: "test", sourceCount: 0, kinds: [] }

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
    const input = { contextPack: pack(), dependencyStamp }
    const first = composeContext(input)
    const second = composeContext(input)

    expect(first.stableCore).toBe(second.stableCore)
    expect(first.stableCore.indexOf("作品灵魂")).toBeLessThan(first.stableCore.indexOf("大纲骨架"))
    expect(first.stableCore).not.toContain("updatedAt")
  })

  it("places explicit references ahead of automatically selected dynamic context", () => {
    const result = composeContext({
      contextPack: pack(),
      dependencyStamp,
      referenceContext: ["@引用：人物/林默.md\n林默怕水"],
    })

    expect(result.dynamicContext.indexOf("@引用")).toBeLessThan(result.dynamicContext.indexOf("上一章结尾"))
  })

  it("expands to chapter originals when confidence is low", () => {
    const result = composeContext({
      contextPack: pack({ recentChapterContents: ["第一章原文"], searchResults: "补充检索" }),
      dependencyStamp,
      confidence: 0.4,
    })

    expect(result.dynamicContext).toContain("第一章原文")
    expect(result.dynamicContext).toContain("补充检索")
    expect(result.stats.expanded).toBe(true)
  })

  it("trims low-priority search content before required task facts", () => {
    const result = composeContext({
      contextPack: pack({ searchResults: "低相关背景".repeat(500) }),
      dependencyStamp,
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
      dependencyStamp,
      confidence: 0.9,
      tokenBudget: 6000,
    })

    expect(result.stats.estimatedSavedPercent).toBeGreaterThanOrEqual(30)
  })

  it("compares trimmed context with the same summary and references", () => {
    const input = {
      contextPack: pack({
        recentChapterContents: ["章节原文".repeat(1000)],
        searchResults: "低优先级检索".repeat(100),
      }),
      dependencyStamp,
      confidence: 0.9,
      tokenBudget: 100_000,
    }
    const base = composeContext(input)
    const supplemented = composeContext({
      ...input,
      sessionSummary: "会话摘要".repeat(100),
      referenceContext: ["显式引用".repeat(100)],
    })
    const baseComposed = base.stats.stableTokens + base.stats.summaryTokens + base.stats.dynamicTokens
    const supplementedComposed = supplemented.stats.stableTokens
      + supplemented.stats.summaryTokens
      + supplemented.stats.dynamicTokens

    expect(base.stats.estimatedSavedTokens).toBeGreaterThan(0)
    expect(supplemented.stats.estimatedSavedTokens).toBe(base.stats.estimatedSavedTokens)
    expect(supplemented.stats.candidateTokens - base.stats.candidateTokens)
      .toBe(supplementedComposed - baseComposed)
  })

  it("稳定核心和必需片段都不能突破总 Token 预算", () => {
    const result = composeContext({
      contextPack: pack({
        soulDoc: "作品灵魂".repeat(1000),
        canonRules: "硬规则".repeat(1000),
        relatedSettings: "设定".repeat(1000),
        outline: "大纲".repeat(2000),
        task: "本轮任务".repeat(500),
        mustDo: "必须做到".repeat(500),
      }),
      sessionSummary: "会话摘要".repeat(1000),
      dependencyStamp,
      tokenBudget: 800,
    })

    expect(estimateContextTokens(result.stableCore) + estimateContextTokens(result.sessionSummary) + estimateContextTokens(result.dynamicContext))
      .toBeLessThanOrEqual(800)
    expect(result.dynamicContext).toContain("本轮任务")
    expect(result.stats.budgetTokens).toBe(800)
    expect(result.stats.composedTokens).toBeLessThanOrEqual(800)
    expect(result.stats.utilizationPercent).toBeLessThanOrEqual(100)
  })

  it("无显式预算时按模型上下文窗口安全比例计算，而不是写死上限", () => {
    const large = composeContext({
      contextPack: pack(),
      dependencyStamp,
      maxContextSize: 204_800,
      tokenBudget: 0,
    })
    const small = composeContext({
      contextPack: pack(),
      dependencyStamp,
      maxContextSize: 32_000,
      tokenBudget: 0,
    })

    expect(large.stats.budgetTokens).toBe(computeNovelContextTokenBudget(204_800, 0))
    expect(small.stats.budgetTokens).toBe(computeNovelContextTokenBudget(32_000, 0))
    expect(large.stats.budgetTokens).toBeGreaterThan(small.stats.budgetTokens)
    expect(large.stats.budgetTokens).not.toBe(16_000)
  })
})
