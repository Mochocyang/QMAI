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
    storyFrameworkBinding: "",
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

  it("injects story framework binding into the stable core when present", () => {
    const result = composeContext({
      contextPack: pack({
        storyFrameworkBinding: "# 故事框架绑定\n- 框架标题：测试框架\n- 目标章节数：100",
      }),
      dependencyStamp,
    })
    expect(result.stableCore).toContain("故事框架绑定")
    expect(result.stableCore).toContain("测试框架")
  })

  it("keeps candidate, injected and saved tokens conserved under one fragment pipeline", () => {
    const result = composeContext({
      contextPack: pack({
        recentChapterContents: Array.from({ length: 8 }, (_, index) => `第${index + 1}章原文：${"情节".repeat(400)}`),
        searchResults: "低优先级".repeat(200),
      }),
      sessionSummary: "会话摘要内容",
      dependencyStamp,
      confidence: 0.9,
      tokenBudget: 1200,
    })
    expect(result.stats.estimatedSavedTokens).toBe(
      Math.max(0, result.stats.candidateTokens - (result.stats.composedTokens ?? 0)),
    )
    expect(result.stats.fragmentTraces?.length).toBeGreaterThan(0)
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

    expect(base.stats.estimatedSavedTokens).toBe(
      Math.max(0, base.stats.candidateTokens - (base.stats.composedTokens ?? 0)),
    )
    expect(supplemented.stats.estimatedSavedTokens).toBe(
      Math.max(0, supplemented.stats.candidateTokens - (supplemented.stats.composedTokens ?? 0)),
    )
    expect(supplemented.stats.candidateTokens).toBeGreaterThan(base.stats.candidateTokens)
    expect(supplemented.stats.composedTokens ?? 0).toBeGreaterThan(base.stats.composedTokens ?? 0)
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
    if (typeof large.stats.budgetTokens !== "number" || typeof small.stats.budgetTokens !== "number") {
      throw new Error("composeContext 必须在 stats 中返回数值型 budgetTokens，否则上面的等值断言无法成立")
    }
    expect(large.stats.budgetTokens).toBeGreaterThan(small.stats.budgetTokens)
    expect(large.stats.budgetTokens).not.toBe(16_000)
  })
})


describe("项目与章节缓存层隔离", () => {
  it("切换章节不改写项目稳定核心，章纲仍在当前动态资料内", () => {
    const make = (chapter: number) => composeContext({
      contextPack: pack({
        outline: `全书固定主线\n第${chapter}卷\n第${chapter}章执行要求`,
        projectOutline: "全书固定主线",
        chapterOutlineContext: `第${chapter}卷\n第${chapter}章执行要求`,
        task: `续写第${chapter}章`,
      }),
      dependencyStamp,
      tokenBudget: 5000,
    })
    const first = make(1)
    const second = make(2)
    expect(first.stableCore).toBe(second.stableCore)
    expect(first.stableCore).toContain("全书固定主线")
    expect(first.stableCore).not.toContain("执行要求")
    expect(first.dynamicContext).toContain("第1章执行要求")
    expect(second.dynamicContext).toContain("第2章执行要求")
    expect(second.dynamicContext).not.toContain("第1章执行要求")
    expect(second.dynamicContext).not.toContain("全书固定主线")
  })

  it("明确没有全书骨架时，不把可变章纲回填到稳定层", () => {
    const result = composeContext({
      contextPack: pack({ outline: "只有当前章纲", projectOutline: "", chapterOutlineContext: "只有当前章纲" }),
      dependencyStamp,
    })
    expect(result.stableCore).not.toContain("只有当前章纲")
    expect(result.dynamicContext).toContain("只有当前章纲")
  })

  it("全书主线实际变更必须立即改变稳定前缀", () => {
    const make = (projectOutline: string) => composeContext({
      contextPack: pack({ projectOutline, chapterOutlineContext: "本章不变" }),
      dependencyStamp,
    })
    expect(make("主角不能复活").stableCore).not.toBe(make("主角可以复活").stableCore)
  })
})
