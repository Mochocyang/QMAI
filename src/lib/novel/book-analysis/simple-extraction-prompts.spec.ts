import { describe, it, expect } from "vitest"
import { buildSimpleExtractionPrompt } from "./simple-extraction-prompts"

describe("buildSimpleExtractionPrompt", () => {
  it("包含所有选中角色名", () => {
    const prompt = buildSimpleExtractionPrompt({
      characterNames: ["许七安", "临安公主"],
      chapterSamples: "【第1章】...【第2章】...",
    })
    expect(prompt).toContain("许七安")
    expect(prompt).toContain("临安公主")
  })

  it("输出 JSON Schema 包含 4 字段 + quotes", () => {
    const prompt = buildSimpleExtractionPrompt({
      characterNames: ["A"],
      chapterSamples: "x",
    })
    expect(prompt).toContain("personality")
    expect(prompt).toContain("motivation")
    expect(prompt).toContain("speechStyle")
    expect(prompt).toContain("behaviorPatterns")
    expect(prompt).toContain("quotes")
  })

  it("要求 quotes 3-5 句", () => {
    const prompt = buildSimpleExtractionPrompt({
      characterNames: ["A"],
      chapterSamples: "x",
    })
    expect(prompt).toMatch(/3-5|3～5|3 至 5/)
  })
})


describe("简单提取长材料公共前缀", () => {
  const chapterSamples = "共同章节材料。".repeat(3000)

  it("相同的 21000 字材料换人物后，完整说明与材料仍在公共前缀中", () => {
    const first = buildSimpleExtractionPrompt({ characterNames: ["Actor_A"], chapterSamples })
    const second = buildSimpleExtractionPrompt({ characterNames: ["Actor_B"], chapterSamples })
    let sharedLength = 0
    while (sharedLength < first.length && first[sharedLength] === second[sharedLength]) sharedLength++
    const sharedPrefix = first.slice(0, sharedLength)

    expect(chapterSamples).toHaveLength(21000)
    expect(sharedLength).toBeGreaterThanOrEqual(chapterSamples.length)
    expect(sharedPrefix.includes(chapterSamples)).toBe(true)
    expect(sharedPrefix).toContain("只返回 JSON，不要其他文字。")
    expect(sharedPrefix).not.toContain("- Actor_A")
    expect(sharedPrefix).not.toContain("- Actor_B")
    expect(first.indexOf("# 角色列表")).toBeGreaterThan(first.indexOf(chapterSamples))
  })

  it("固定字段、字数限制、JSON schema 和代表性原文台词要求均在材料之前", () => {
    const prompt = buildSimpleExtractionPrompt({ characterNames: ["Actor_A"], chapterSamples })
    const instructions = prompt.slice(0, prompt.indexOf(chapterSamples))

    for (const field of ["name", "personality", "motivation", "speechStyle", "behaviorPatterns", "quotes"]) {
      expect(instructions).toContain(`"${field}"`)
    }
    expect(instructions).toContain("50-100 字")
    expect(instructions).toContain("30-80 字")
    expect(instructions).toContain("3-5 句最能体现该角色性格的原文台词")
    expect(instructions).toContain("只返回 JSON，不要其他文字。")
  })
})
