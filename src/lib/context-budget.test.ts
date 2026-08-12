import { describe, it, expect } from "vitest"
import {
  charsPerTokenForLanguage,
  computeContextBudget,
  computeNovelContextTokenBudget,
  computeWritingContextPackTokenBudget,
  resolveContextPackTokenBudget,
  planChapterRequestBudget,
  planLlmRequestBudget,
  planOutlineRequestBudget,
  LlmContextBudgetError,
} from "./context-budget"

// The base-math tests pin charsPerToken explicitly so they stay deterministic
// regardless of the active UI language (the app defaults to zh).
describe("computeContextBudget", () => {
  it("falls back to the 200K-token default for falsy input", () => {
    expect(computeContextBudget(undefined, 1).maxCtx).toBe(204_800)
    expect(computeContextBudget(0, 1).maxCtx).toBe(204_800)
    expect(computeContextBudget(Number.NaN, 1).maxCtx).toBe(204_800)
  })

  it("converts the token window into a character capacity", () => {
    const b = computeContextBudget(200_000, 4)
    expect(b.maxCtx).toBe(800_000)
    expect(b.responseReserve).toBe(120_000)
  })
})

describe("shared LLM request budget", () => {
  it("keeps the token conservation invariant", () => {
    const plan = planLlmRequestBudget({
      maxContextSize: 204_800,
      desiredOutputTokens: 16_384,
      requestedContextTokens: 40_000,
      scaffoldReserveTokens: 8_192,
      minimumContextTokens: 4_000,
    })
    expect(plan).toMatchObject({
      windowTokens: 184_320,
      outputTokens: 16_384,
      contextTokenBudget: 40_000,
      scaffoldReserveTokens: 8_192,
      inputTokenBudget: 167_936,
    })
    expect(
      plan.outputTokens + plan.contextTokenBudget + plan.scaffoldReserveTokens,
    ).toBeLessThanOrEqual(plan.windowTokens)
  })

  it("treats maxContextSize as tokens, not characters", () => {
    // The window is a token count already; planning must not divide it down.
    // Before this was fixed a 200K window planned against 51200 tokens, so a
    // Chinese session could only use a quarter of the model's real capacity.
    const plan = planLlmRequestBudget({
      maxContextSize: 204_800,
      desiredOutputTokens: 8_192,
      scaffoldReserveTokens: 0,
    })
    expect(plan.windowTokens).toBeGreaterThan(180_000)
    expect(plan.inputTokenBudget).toBeGreaterThan(170_000)
  })

  it("reduces output but never below 512 before rejecting an impossible window", () => {
    const reduced = planLlmRequestBudget({
      maxContextSize: 1_024,
      desiredOutputTokens: 8_192,
      scaffoldReserveTokens: 256,
      minimumContextTokens: 400,
    })
    expect(reduced.outputTokens).toBe(512)
    expect(reduced.contextTokenBudget).toBe(153)
    expect(() => planLlmRequestBudget({
      maxContextSize: 512,
      desiredOutputTokens: 8_192,
      scaffoldReserveTokens: 64,
    })).toThrow(LlmContextBudgetError)
  })

  it("converges output down to the declared output cap", () => {
    const plan = planLlmRequestBudget({
      maxContextSize: 1_000_000,
      desiredOutputTokens: 150_000,
      scaffoldReserveTokens: 8_192,
      maxOutputTokensCap: 65_536,
    })
    expect(plan.outputTokens).toBe(65_536)
  })

  it("raises output to the thinking floor without passing the cap", () => {
    const raised = planLlmRequestBudget({
      maxContextSize: 204_800,
      desiredOutputTokens: 4_000,
      scaffoldReserveTokens: 8_192,
      thinkingFloorTokens: 16_384,
    })
    expect(raised.outputTokens).toBe(16_384)

    const capped = planLlmRequestBudget({
      maxContextSize: 204_800,
      desiredOutputTokens: 4_000,
      scaffoldReserveTokens: 8_192,
      thinkingFloorTokens: 16_384,
      maxOutputTokensCap: 8_192,
    })
    expect(capped.outputTokens).toBe(8_192)
  })
})

describe("outline request budget", () => {
  it("scales the output with the window instead of stepping through tiers", () => {
    expect(planOutlineRequestBudget({
      maxContextSize: 204_800,
      stage: "analysis",
    }).outputTokens).toBe(8_192)
    expect(planOutlineRequestBudget({
      maxContextSize: 204_800,
      stage: "generation",
    }).outputTokens).toBe(30_720)
    expect(planOutlineRequestBudget({
      maxContextSize: 1_000_000,
      stage: "generation",
    }).outputTokens).toBe(150_000)
  })

  it("bounds the generation output by the declared output cap", () => {
    expect(planOutlineRequestBudget({
      maxContextSize: 1_000_000,
      stage: "generation",
      maxOutputTokens: 65_536,
    }).outputTokens).toBe(65_536)
  })

  it("silently raises a legacy 128K window to 204800", () => {
    const plan = planOutlineRequestBudget({
      maxContextSize: 128_000,
      stage: "generation",
    })
    expect(plan.windowTokens).toBe(184_320)
    expect(plan.outputTokens).toBe(30_720)
  })
})

describe("chapter request budget", () => {
  it("uses window-fraction generation output with a 15360 floor", () => {
    const plan = planChapterRequestBudget({
      maxContextSize: 204_800,
      chapterTargetChars: 3_000,
      stage: "generation",
    })
    // 0.15 × 204800 = 30720, already above the 15360 floor.
    expect(plan.outputTokens).toBe(30_720)
    expect(
      plan.outputTokens + plan.contextTokenBudget + plan.scaffoldReserveTokens,
    ).toBeLessThanOrEqual(plan.windowTokens)
  })

  it("scales generation output with the window past the floor", () => {
    expect(planChapterRequestBudget({
      maxContextSize: 1_000_000,
      chapterTargetChars: 3_000,
      stage: "generation",
    }).outputTokens).toBe(150_000)
  })

  it("lets the declared output cap win over the generation floor", () => {
    expect(planChapterRequestBudget({
      maxContextSize: 204_800,
      chapterTargetChars: 6_000,
      stage: "generation",
      maxOutputTokens: 8_192,
    }).outputTokens).toBe(8_192)
  })

  it("uses analysis fraction of the window for task analysis", () => {
    expect(planChapterRequestBudget({
      maxContextSize: 204_800,
      chapterTargetChars: 3_000,
      stage: "analysis",
    }).outputTokens).toBe(8_192)
    expect(planChapterRequestBudget({
      maxContextSize: 1_000_000,
      stage: "analysis",
    }).outputTokens).toBe(40_000)
  })
})

describe("charsPerTokenForLanguage", () => {
  it("uses the 4:1 ratio for English and other non-CJK languages", () => {
    expect(charsPerTokenForLanguage("en")).toBe(4)
    expect(charsPerTokenForLanguage("en-US")).toBe(4)
    expect(charsPerTokenForLanguage("fr")).toBe(4)
  })

  it("falls back to the active UI language when none is given", () => {
    // Test env initialises i18n to zh, so the implicit lookup is CJK.
    expect(charsPerTokenForLanguage()).toBe(1)
  })

  it("counts one character per token for CJK languages", () => {
    // Must match the token estimator, which also counts 1 CJK char = 1 token.
    expect(charsPerTokenForLanguage("zh")).toBe(1)
    expect(charsPerTokenForLanguage("zh-CN")).toBe(1)
    expect(charsPerTokenForLanguage("ja")).toBe(1)
    expect(charsPerTokenForLanguage("ko")).toBe(1)
  })
})

describe("computeContextBudget language scaling", () => {
  it("yields fewer characters for CJK because each token holds less", () => {
    const zh = charsPerTokenForLanguage("zh")
    expect(computeContextBudget(200_000, zh).maxCtx).toBe(200_000)
    expect(computeContextBudget(204_800, zh).maxCtx).toBe(204_800)
  })

  it("yields four characters per token for English", () => {
    expect(computeContextBudget(200_000, charsPerTokenForLanguage("en")).maxCtx).toBe(800_000)
  })
})

describe("computeNovelContextTokenBudget", () => {
  it("keeps a requested budget that fits under the window share", () => {
    expect(computeNovelContextTokenBudget(204_800, 32_000)).toBe(32_000)
    expect(computeNovelContextTokenBudget(undefined, 32_000)).toBe(32_000)
  })

  it("caps an unset (0 / unlimited) budget at the window-derived ceiling", () => {
    expect(computeNovelContextTokenBudget(204_800, 0)).toBe(133_120)
    expect(computeNovelContextTokenBudget(204_800, undefined)).toBe(133_120)
  })

  it("clamps an over-large user budget down to the ceiling", () => {
    expect(computeNovelContextTokenBudget(204_800, 200_000)).toBe(133_120)
  })

  it("shrinks the budget proportionally for small windows", () => {
    expect(computeNovelContextTokenBudget(32_000, 32_000)).toBe(20_800)
  })

  it("never drops below the token floor", () => {
    expect(computeNovelContextTokenBudget(1_000, 0)).toBe(4_000)
  })
})

describe("resolveContextPackTokenBudget", () => {
  it("always returns a positive finite budget for auto mode", () => {
    const budget = resolveContextPackTokenBudget({ maxContextSize: 204_800, contextTokenBudget: 0 })
    expect(budget).toBe(133_120)
    expect(Number.isFinite(budget)).toBe(true)
  })

  it("honors an explicit user budget within the window cap", () => {
    expect(resolveContextPackTokenBudget({
      maxContextSize: 204_800,
      contextTokenBudget: 10_000,
    })).toBe(10_000)
  })
})

describe("computeWritingContextPackTokenBudget", () => {
  it("leaves room for the chapter output and scaffolding inside the window", () => {
    const plan = planChapterRequestBudget({
      maxContextSize: 204_800,
      contextTokenBudget: 0,
      chapterTargetChars: 3_000,
      stage: "generation",
    })
    const budget = computeWritingContextPackTokenBudget({
      maxContextSize: 204_800,
      contextTokenBudget: 0,
      chapterTargetChars: 3_000,
    })
    expect(budget).toBe(plan.contextTokenBudget)
    expect(budget + plan.outputTokens + plan.scaffoldReserveTokens)
      .toBeLessThanOrEqual(plan.windowTokens)
  })

  it("shrinks when chapter target grows", () => {
    const smallTarget = computeWritingContextPackTokenBudget({
      maxContextSize: 204_800,
      chapterTargetChars: 3_000,
    })
    const largeTarget = computeWritingContextPackTokenBudget({
      maxContextSize: 204_800,
      chapterTargetChars: 6_000,
    })
    expect(largeTarget).toBeLessThanOrEqual(smallTarget)
  })

  it("grows with a larger window within the general cap", () => {
    const smallWindow = computeWritingContextPackTokenBudget({
      maxContextSize: 204_800,
      chapterTargetChars: 3_000,
    })
    const largeWindow = computeWritingContextPackTokenBudget({
      maxContextSize: 1_000_000,
      chapterTargetChars: 3_000,
    })
    expect(largeWindow).toBeGreaterThan(smallWindow)
  })

  it("never exceeds the general window cap", () => {
    const budget = computeWritingContextPackTokenBudget({
      maxContextSize: 204_800,
      chapterTargetChars: 3_000,
    })
    expect(budget).toBeLessThanOrEqual(computeNovelContextTokenBudget(204_800, 0))
  })

  it("clamps an explicit user budget to the writing-derived auto budget", () => {
    const auto = computeWritingContextPackTokenBudget({
      maxContextSize: 204_800,
      chapterTargetChars: 3_000,
    })
    expect(computeWritingContextPackTokenBudget({
      maxContextSize: 204_800,
      contextTokenBudget: 300_000,
      chapterTargetChars: 3_000,
    })).toBe(auto)
  })
})
