import { describe, expect, it } from "vitest"
import {
  CHAPTER_TARGET_CHARS_MAX,
  CHAPTER_TARGET_CHARS_MIN,
  DEEP_CHAPTER_DRAFT_MAX_CHARS,
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
    expect(spec).not.toHaveProperty("maxOutputTokens")
  })

  it("derives char thresholds from a configured chapter target (issue #8)", () => {
    const spec = resolveChapterLengthSpec(2000)

    expect(spec.targetChars).toBe(2000)
    expect(spec.minChars).toBeLessThan(2000)
    expect(spec.minChars).toBeGreaterThan(1000)
    expect(spec.draftMaxChars).toBe(2500)
    expect(spec).not.toHaveProperty("maxOutputTokens")
  })

  it("clamps unreasonable targets to the writing-settings range", () => {
    expect(resolveChapterLengthSpec(10).targetChars).toBe(CHAPTER_TARGET_CHARS_MIN)
    expect(resolveChapterLengthSpec(999999).targetChars).toBe(CHAPTER_TARGET_CHARS_MAX)
  })

  it("honors a configured target inside 1000–10000 that the old 2000–6000 clamp would have rewritten", () => {
    expect(resolveChapterLengthSpec(1500).targetChars).toBe(1500)
    expect(resolveChapterLengthSpec(8000).targetChars).toBe(8000)
  })
})

describe("chapter prompts honor the configured length spec", () => {
  it("injects the configured target into brief and draft prompts", () => {
    const spec = resolveChapterLengthSpec(2000)
    const brief = buildDeepChapterBriefPrompt("", "上下文", "继续生成下一章", 5, undefined, spec)
    const draft = buildDeepChapterDraftPrompt("", "上下文", "任务书", "继续生成下一章", 5, undefined, spec)

    expect(brief).toContain("目标约 2000 字")
    expect(draft).toContain("目标约 2000 字")
    expect(draft).toContain(`阶段3正文草稿最多 ${spec.draftMaxChars} 字`)
    expect(draft).not.toContain("目标约 3000 字")
  })
})
