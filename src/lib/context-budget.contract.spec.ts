import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  computeNovelContextTokenBudget,
  computeWritingContextPackTokenBudget,
  planChapterRequestBudget,
  resolveContextPackTokenBudget,
} from "./context-budget"

describe("context pack budget contracts", () => {
  it("auto mode is always finite and bounded by the window-derived cap", () => {
    for (const maxContextSize of [64_000, 204_800, 1_000_000]) {
      const general = resolveContextPackTokenBudget({
        maxContextSize,
        contextTokenBudget: 0,
        langScale: 1,
      })
      const writing = computeWritingContextPackTokenBudget({
        maxContextSize,
        contextTokenBudget: 0,
        chapterTargetChars: 3_000,
        langScale: 1,
      })
      expect(Number.isFinite(general)).toBe(true)
      expect(Number.isFinite(writing)).toBe(true)
      expect(general).toBeGreaterThan(0)
      expect(writing).toBeGreaterThan(0)
      expect(general).toBeLessThanOrEqual(computeNovelContextTokenBudget(maxContextSize, 0, 1))
      const normalizedGeneral = resolveContextPackTokenBudget({
        maxContextSize: Math.max(204_800, maxContextSize),
        contextTokenBudget: 0,
        langScale: 1,
      })
      expect(writing).toBeLessThanOrEqual(normalizedGeneral)
    }
  })

  it("writing adapter migrates a legacy small window before allocating", () => {
    const writing = computeWritingContextPackTokenBudget({
      maxContextSize: 32_000,
      chapterTargetChars: 3_000,
      langScale: 1,
    })
    expect(writing).toBe(33_280)
  })

  it("writing pack leaves room for output-token reserve plus scaffold", () => {
    for (const chapterTargetChars of [2_000, 3_000, 6_000]) {
      for (const maxContextSize of [64_000, 204_800]) {
        const plan = planChapterRequestBudget({
          maxContextSize,
          chapterTargetChars,
          langScale: 1,
          stage: "generation",
        })
        expect(
          plan.contextTokenBudget + plan.outputTokens + plan.scaffoldReserveTokens,
        ).toBeLessThanOrEqual(plan.windowTokens)
      }
    }
  })

  it("chat-panel fallback resolves budget instead of passing undefined", () => {
    const source = readFileSync(resolve(__dirname, "../components/chat/chat-panel.tsx"), "utf8")
    expect(source).toContain("resolveContextPackTokenBudget({")
    expect(source).not.toContain("contextTokenBudget > 0 ? novelConfig.contextTokenBudget : undefined")
  })

  it("context-engine never uses Infinity for pack trimming", () => {
    const source = readFileSync(resolve(__dirname, "./novel/context-engine.ts"), "utf8")
    expect(source).not.toMatch(/tokenBudget \? tokenBudget \* 4 : Infinity/)
    expect(source).toContain("resolveContextPackTokenBudget({ maxContextSize: options?.maxContextSize })")
  })

  it("deep chapter no longer hard-codes a 32000 context budget", () => {
    const source = readFileSync(resolve(__dirname, "./novel/deep-chapter-generation.ts"), "utf8")
    expect(source).toContain("planChapterRequestBudget({")
    expect(source).toContain("max_tokens: chapterGenerationBudget.outputTokens")
    expect(source).not.toContain("DEEP_CHAPTER_CONTEXT_TOKEN_BUDGET")
  })
})
