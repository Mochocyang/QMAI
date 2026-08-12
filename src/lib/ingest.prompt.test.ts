import { describe, it, expect } from "vitest"
import {
  computeIngestAnalysisMaxTokens,
  computeIngestGenerationMaxTokens,
  computeIngestReviewMaxTokens,
  computeIngestSourceBudget,
  fitIngestOutputToWindow,
  splitSourceIntoSemanticChunks,
} from "./ingest"

// The character-domain helpers take chars/token explicitly (4 = English-ish,
// 1 = CJK) so they stay deterministic regardless of the active UI language.
describe("long-source ingest planning", () => {
  it("scales generation output tokens with the configured context window", () => {
    // Windows below MIN_USER_LLM_CONTEXT_SIZE (204800) clamp up first.
    expect(computeIngestGenerationMaxTokens(64_000)).toBe(30_720)
    expect(computeIngestGenerationMaxTokens(204_800)).toBe(30_720)
    expect(computeIngestGenerationMaxTokens(1_000_000)).toBe(150_000)
    expect(computeIngestReviewMaxTokens(1_000_000)).toBe(40_000)
  })

  it("uses the same window-fraction formula regardless of UI language density", () => {
    expect(computeIngestGenerationMaxTokens(256_000)).toBe(38_400)
  })

  it("scales analysis output tokens with ANALYSIS_OUTPUT_FRAC", () => {
    expect(computeIngestAnalysisMaxTokens(204_800)).toBe(8_192)
    expect(computeIngestAnalysisMaxTokens(1_000_000)).toBe(40_000)
  })

  it("scales source budget from the configured context window instead of a fixed 50k cap", () => {
    const small = computeIngestSourceBudget(64_000, 8_000, 1)
    const large = computeIngestSourceBudget(1_000_000, 8_000, 1)

    expect(small).toBeGreaterThan(20_000)
    expect(large).toBeGreaterThan(200_000)
    expect(large).toBeLessThanOrEqual(300_000)
  })

  it("gives CJK fewer characters than English for the same token window", () => {
    const en = computeIngestSourceBudget(200_000, 8_000, 4)
    const zh = computeIngestSourceBudget(200_000, 8_000, 1)
    expect(zh).toBeLessThan(en)
  })

  it("keeps the desired output tokens when the window has ample room", () => {
    expect(fitIngestOutputToWindow(1_000_000, 10_000, 8_192, 1)).toBe(8_192)
  })

  it("shrinks output tokens so prompt + output fits the window", () => {
    // 64000-token window; a 60000-character CJK prompt is 60000 tokens in,
    // leaving 4000 for output.
    expect(fitIngestOutputToWindow(64_000, 60_000, 8_192, 1)).toBe(4_000)
  })

  it("falls back to the output floor when the prompt already overflows", () => {
    expect(fitIngestOutputToWindow(64_000, 300_000, 8_192, 1)).toBe(512)
  })

  it("leaves less output room for CJK prompts than English ones", () => {
    const en = fitIngestOutputToWindow(64_000, 250_000, 8_192, 4)
    const zh = fitIngestOutputToWindow(64_000, 250_000, 8_192, 1)
    expect(zh).toBeLessThan(en)
  })

  it("splits long sources on heading and paragraph boundaries with overlap", () => {
    const content = [
      "# Chapter One",
      "",
      "A".repeat(1200),
      "",
      "B".repeat(1200),
      "",
      "## Section Two",
      "",
      "C".repeat(1200),
      "",
      "D".repeat(1200),
    ].join("\n")

    const chunks = splitSourceIntoSemanticChunks(content, 1800, 200)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].headingPath).toBe("Chapter One")
    expect(chunks.some((chunk) => chunk.headingPath.includes("Section Two"))).toBe(true)
    expect(chunks[1].overlapBefore.length).toBeGreaterThan(0)
    expect(chunks[1].main.startsWith(chunks[0].main.slice(-200))).toBe(false)
  })
})
