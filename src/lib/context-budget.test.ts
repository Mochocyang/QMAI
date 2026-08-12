import { describe, it, expect } from "vitest"
import {
  computeContextBudget,
  computeNovelContextTokenBudget,
  computeWritingContextPackTokenBudget,
  contextScaleForLanguage,
  resolveContextPackTokenBudget,
  planChapterRequestBudget,
  planLlmRequestBudget,
  planOutlineRequestBudget,
  LlmContextBudgetError,
  WRITING_OUTPUT_RESERVE_MULTIPLIER,
} from "./context-budget"

// The base-math tests pin langScale=1 so they stay deterministic
// regardless of the active UI language (the app defaults to zh).
describe("computeContextBudget", () => {
  it("falls back to the 200K-char default for falsy input", () => {
    expect(computeContextBudget(undefined, 1).maxCtx).toBe(204_800)
    expect(computeContextBudget(0, 1).maxCtx).toBe(204_800)
    expect(computeContextBudget(Number.NaN, 1).maxCtx).toBe(204_800)
  })

  it("allocates fractional sub-budgets from the window", () => {
    const b = computeContextBudget(200_000, 1)
    expect(b.responseReserve).toBe(30_000)
    expect(b.indexBudget).toBe(10_000)
    expect(b.pageBudget).toBe(100_000)
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
      windowTokens: 51_200,
      outputTokens: 16_384,
      contextTokenBudget: 26_624,
      scaffoldReserveTokens: 8_192,
      inputTokenBudget: 34_816,
    })
    expect(
      plan.outputTokens + plan.contextTokenBudget + plan.scaffoldReserveTokens,
    ).toBeLessThanOrEqual(plan.windowTokens)
  })

  it("reduces output but never below 512 before rejecting an impossible window", () => {
    const reduced = planLlmRequestBudget({
      maxContextSize: 4_096,
      desiredOutputTokens: 8_192,
      scaffoldReserveTokens: 256,
      minimumContextTokens: 400,
    })
    expect(reduced.outputTokens).toBe(512)
    expect(reduced.contextTokenBudget).toBe(256)
    expect(() => planLlmRequestBudget({
      maxContextSize: 2_000,
      desiredOutputTokens: 8_192,
      scaffoldReserveTokens: 64,
    })).toThrow(LlmContextBudgetError)
  })
})

describe("outline request budget", () => {
  it.each([
    [204_800, 8_192, 16_384],
    [262_143, 8_192, 16_384],
    [262_144, 8_192, 24_576],
    [524_287, 8_192, 24_576],
    [524_288, 8_192, 32_768],
    [1_000_000, 8_192, 32_768],
  ])("uses stage tiers at window %i", (maxContextSize, analysis, generation) => {
    expect(planOutlineRequestBudget({
      maxContextSize,
      stage: "analysis",
      langScale: 1,
    }).outputTokens).toBe(analysis)
    expect(planOutlineRequestBudget({
      maxContextSize,
      stage: "generation",
      langScale: 1,
    }).outputTokens).toBe(generation)
  })

  it("silently raises a legacy 128K window to 204800", () => {
    const plan = planOutlineRequestBudget({
      maxContextSize: 128_000,
      stage: "generation",
      langScale: 1,
    })
    expect(plan.windowTokens).toBe(51_200)
    expect(plan.outputTokens).toBe(16_384)
  })
})

describe("chapter request budget", () => {
  it.each([
    [2_000, 8_000],
    [3_000, 8_000],
    [6_000, 13_000],
  ])("derives generation output for %i target chars", (chapterTargetChars, outputTokens) => {
    const plan = planChapterRequestBudget({
      maxContextSize: 204_800,
      chapterTargetChars,
      stage: "generation",
      langScale: 1,
    })
    expect(plan.outputTokens).toBe(outputTokens)
    expect(
      plan.outputTokens + plan.contextTokenBudget + plan.scaffoldReserveTokens,
    ).toBeLessThanOrEqual(plan.windowTokens)
  })

  it("uses 4096 tokens for task analysis", () => {
    expect(planChapterRequestBudget({
      maxContextSize: 204_800,
      chapterTargetChars: 3_000,
      stage: "analysis",
      langScale: 1,
    }).outputTokens).toBe(4_096)
  })
})

describe("contextScaleForLanguage", () => {
  it("keeps scale 1 for English and other non-CJK languages", () => {
    expect(contextScaleForLanguage("en")).toBe(1)
    expect(contextScaleForLanguage("en-US")).toBe(1)
    expect(contextScaleForLanguage("fr")).toBe(1)
  })

  it("falls back to the active UI language when none is given", () => {
    // Test env initialises i18n to zh, so the implicit lookup is CJK-scaled.
    expect(contextScaleForLanguage()).toBeCloseTo(0.425, 5)
  })

  it("shrinks the window for CJK languages", () => {
    expect(contextScaleForLanguage("zh")).toBeCloseTo(0.425, 5)
    expect(contextScaleForLanguage("zh-CN")).toBeCloseTo(0.425, 5)
    expect(contextScaleForLanguage("ja")).toBeCloseTo(0.425, 5)
    expect(contextScaleForLanguage("ko")).toBeCloseTo(0.425, 5)
  })
})

describe("computeContextBudget language scaling", () => {
  it("scales the effective window down for CJK UIs", () => {
    const zh = contextScaleForLanguage("zh")
    expect(computeContextBudget(200_000, zh).maxCtx).toBe(85_000)
    expect(computeContextBudget(204_800, zh).maxCtx).toBe(87_040)
  })

  it("leaves English windows untouched", () => {
    expect(computeContextBudget(200_000, contextScaleForLanguage("en")).maxCtx).toBe(200_000)
  })
})

describe("computeNovelContextTokenBudget", () => {
  it("preserves the legacy 32K-token deep-chapter budget on the default window", () => {
    // Default window (204800 chars) → cap 33280 tokens, so 32000 is kept intact.
    expect(computeNovelContextTokenBudget(204_800, 32_000, 1)).toBe(32_000)
    expect(computeNovelContextTokenBudget(undefined, 32_000, 1)).toBe(32_000)
  })

  it("caps an unset (0 / unlimited) budget at the window-derived ceiling", () => {
    expect(computeNovelContextTokenBudget(204_800, 0, 1)).toBe(33_280)
    expect(computeNovelContextTokenBudget(204_800, undefined, 1)).toBe(33_280)
  })

  it("clamps an over-large user budget down to the ceiling", () => {
    expect(computeNovelContextTokenBudget(204_800, 100_000, 1)).toBe(33_280)
  })

  it("shrinks the budget proportionally for small windows", () => {
    // 32000 chars → floor(32000 * 0.65 / 4) = 5200 tokens.
    expect(computeNovelContextTokenBudget(32_000, 32_000, 1)).toBe(5_200)
  })

  it("never drops below the token floor", () => {
    expect(computeNovelContextTokenBudget(1_000, 0, 1)).toBe(4_000)
  })

  it("tightens the ceiling for CJK UIs so the same request is capped down", () => {
    // zh: maxCtx 204800*0.425=87040 → cap floor(87040*0.65/4)=14144 tokens.
    const zh = contextScaleForLanguage("zh")
    expect(computeNovelContextTokenBudget(204_800, 32_000, zh)).toBe(14_144)
    expect(computeNovelContextTokenBudget(204_800, 0, zh)).toBe(14_144)
  })
})

describe("resolveContextPackTokenBudget", () => {
  it("always returns a positive finite budget for auto mode", () => {
    const budget = resolveContextPackTokenBudget({ maxContextSize: 204_800, contextTokenBudget: 0, langScale: 1 })
    expect(budget).toBe(33_280)
    expect(Number.isFinite(budget)).toBe(true)
  })

  it("honors an explicit user budget within the window cap", () => {
    expect(resolveContextPackTokenBudget({
      maxContextSize: 204_800,
      contextTokenBudget: 10_000,
      langScale: 1,
    })).toBe(10_000)
  })
})

describe("computeWritingContextPackTokenBudget", () => {
  it("reserves at least maxOutputTokens (as chars) before allocating the pack", () => {
    const maxContextSize = 204_800
    const chapterTargetChars = 3_000
    const langScale = 1
    const { maxCtx } = computeContextBudget(maxContextSize, langScale)
    const budget = computeWritingContextPackTokenBudget({
      maxContextSize,
      contextTokenBudget: 0,
      chapterTargetChars,
      langScale,
    })
    const maxOutputTokens = 8_000
    const targetReserveTokens = Math.ceil((chapterTargetChars * WRITING_OUTPUT_RESERVE_MULTIPLIER) / 1.7)
    const outputReserveChars = Math.max(targetReserveTokens, maxOutputTokens) * 4
    const scaffold = Math.max(8_000, Math.floor(maxCtx * 0.08))
    expect(budget * 4 + outputReserveChars + scaffold).toBeLessThanOrEqual(maxCtx)
    expect(outputReserveChars).toBeGreaterThanOrEqual(maxOutputTokens * 4)
  })

  it("shrinks when chapter target grows", () => {
    const smallTarget = computeWritingContextPackTokenBudget({
      maxContextSize: 204_800,
      chapterTargetChars: 3_000,
      langScale: 1,
    })
    const largeTarget = computeWritingContextPackTokenBudget({
      maxContextSize: 204_800,
      chapterTargetChars: 6_000,
      langScale: 1,
    })
    expect(largeTarget).toBeLessThanOrEqual(smallTarget)
  })

  it("grows with a larger window within the general cap", () => {
    const smallWindow = computeWritingContextPackTokenBudget({
      maxContextSize: 64_000,
      chapterTargetChars: 3_000,
      langScale: 1,
    })
    const largeWindow = computeWritingContextPackTokenBudget({
      maxContextSize: 204_800,
      chapterTargetChars: 3_000,
      langScale: 1,
    })
    expect(largeWindow).toBeGreaterThanOrEqual(smallWindow)
  })

  it("never exceeds the general window cap", () => {
    const budget = computeWritingContextPackTokenBudget({
      maxContextSize: 204_800,
      chapterTargetChars: 3_000,
      langScale: 1,
    })
    expect(budget).toBeLessThanOrEqual(computeNovelContextTokenBudget(204_800, 0, 1))
  })

  it("clamps an explicit user budget to the writing-derived auto budget", () => {
    const auto = computeWritingContextPackTokenBudget({
      maxContextSize: 204_800,
      chapterTargetChars: 3_000,
      langScale: 1,
    })
    expect(computeWritingContextPackTokenBudget({
      maxContextSize: 204_800,
      contextTokenBudget: 100_000,
      chapterTargetChars: 3_000,
      langScale: 1,
    })).toBe(auto)
  })
})
