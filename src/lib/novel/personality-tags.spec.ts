import { describe, expect, it } from "vitest"
import {
  PERSONALITY_TAGS,
  PERSONALITY_GENRE_PACKS,
  personaTagsForGenre,
  isPerformanceTag,
  PERSONALITY_TAG_MAX_CHARS,
} from "./personality-tags"

describe("personality-tags", () => {
  it("固定基底至少 80 条，且四类分组齐全", () => {
    expect(PERSONALITY_TAGS.length).toBeGreaterThanOrEqual(80)
    expect(new Set(PERSONALITY_TAGS.map((tag) => tag.group))).toEqual(new Set(["语气", "怪癖", "关系", "反差"]))
  })

  it("每条标签都能演出来", () => {
    for (const tag of PERSONALITY_TAGS) {
      expect(tag.label.length).toBeLessThanOrEqual(PERSONALITY_TAG_MAX_CHARS)
      expect(isPerformanceTag(tag.label)).toBe(true)
    }
  })

  it("「严肃沉稳」这类不出戏的词不进基底", () => {
    const labels = PERSONALITY_TAGS.map((tag) => tag.label).join(",")
    expect(labels).not.toContain("严肃沉稳")
    expect(labels).not.toContain("性格")
    expect(isPerformanceTag("严肃沉稳")).toBe(false)
  })

  it("题材包非空且都是可演出标签", () => {
    for (const pack of PERSONALITY_GENRE_PACKS) {
      expect(pack.tags.length).toBeGreaterThan(0)
      for (const label of pack.tags) expect(isPerformanceTag(label)).toBe(true)
    }
    expect(personaTagsForGenre("仙侠")).toEqual(PERSONALITY_GENRE_PACKS.find((p) => p.genre === "仙侠")?.tags)
    expect(personaTagsForGenre("不存在的题材")).toEqual([])
  })
})
