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
