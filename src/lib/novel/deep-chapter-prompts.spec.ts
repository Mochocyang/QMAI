import { describe, expect, it } from "vitest"
import {
  DEEP_CHAPTER_DRAFT_MAX_CHARS,
  DEEP_CHAPTER_MAX_OUTPUT_TOKENS,
  DEEP_CHAPTER_MIN_CHARS,
  DEEP_CHAPTER_TARGET_CHARS,
  buildDeepChapterBriefPrompt,
  buildDeepChapterDraftPrompt,
  resolveChapterLengthSpec,
} from "./deep-chapter-prompts"

describe("resolveChapterLengthSpec", () => {
  it("keeps the built-in defaults when no target is configured", () => {
    const spec = resolveChapterLengthSpec()

    expect(spec.targetChars).toBe(DEEP_CHAPTER_TARGET_CHARS)
    expect(spec.minChars).toBe(DEEP_CHAPTER_MIN_CHARS)
    expect(spec.draftMaxChars).toBe(DEEP_CHAPTER_DRAFT_MAX_CHARS)
    expect(spec.maxOutputTokens).toBe(DEEP_CHAPTER_MAX_OUTPUT_TOKENS)
  })

  it("derives all thresholds from a configured chapter target (issue #8)", () => {
    const spec = resolveChapterLengthSpec(2000)

    expect(spec.targetChars).toBe(2000)
    expect(spec.minChars).toBeLessThan(2000)
    expect(spec.minChars).toBeGreaterThan(1000)
    expect(spec.draftMaxChars).toBe(2500)
  })

  it("scales output token budget up for long chapters", () => {
    const spec = resolveChapterLengthSpec(6000)

    expect(spec.maxOutputTokens).toBeGreaterThan(DEEP_CHAPTER_MAX_OUTPUT_TOKENS)
  })

  it("clamps unreasonable targets", () => {
    expect(resolveChapterLengthSpec(10).targetChars).toBe(2000)
    expect(resolveChapterLengthSpec(999999).targetChars).toBe(6000)
  })
})

describe("chapter prompts honor the configured length spec", () => {
  it("injects the configured target into brief and draft prompts", () => {
    const spec = resolveChapterLengthSpec(2000)
    const brief = buildDeepChapterBriefPrompt("上下文", "继续生成下一章", 5, undefined, spec)
    const draft = buildDeepChapterDraftPrompt("上下文", "任务书", "继续生成下一章", 5, undefined, spec)

    expect(brief).toContain("目标约 2000 字")
    expect(draft).toContain("目标约 2000 字")
    expect(draft).toContain(`阶段3正文草稿最多 ${spec.draftMaxChars} 字`)
    expect(draft).not.toContain("目标约 3000 字")
  })
})
