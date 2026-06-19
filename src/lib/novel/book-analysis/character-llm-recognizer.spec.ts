import { describe, it, expect } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import { llmRecognizeCharacters } from "./character-llm-recognizer"

const llmConfig: LlmConfig = {
  provider: "custom",
  apiKey: "test-key",
  model: "test-model",
  ollamaUrl: "",
  customEndpoint: "https://example.test/v1",
  maxContextSize: 120000,
}

const chapters = [
  { index: 0, content: "韩立站在山边小村。" },
  { index: 1, content: "韩铸打着呼噜。" },
]

describe("llmRecognizeCharacters", () => {
  it("keeps a character even when the model omits chapterIndices", async () => {
    const raw = JSON.stringify([
      { name: "韩立", importanceScore: 90, category: "主角" }, // 无 chapterIndices
      { name: "韩铸", importanceScore: 40, category: "配角", chapterIndices: [1] },
    ])
    const result = await llmRecognizeCharacters({
      chapters,
      llmConfig,
      sourceBook: "凡人",
      _llmCall: async () => raw,
    })

    const names = result.map((c) => c.name)
    expect(names).toContain("韩立")
    expect(names).toContain("韩铸")
    expect(result.find((c) => c.name === "韩立")?.appearances).toBe(1)
  })

  it("parses fenced JSON and sorts by importance score", async () => {
    const raw = "```json\n" + JSON.stringify([
      { name: "甲", importanceScore: 30, category: "次要", chapterIndices: [0] },
      { name: "乙", importanceScore: 80, category: "主角", chapterIndices: [0, 1] },
    ]) + "\n```"
    const result = await llmRecognizeCharacters({
      chapters,
      llmConfig,
      sourceBook: "x",
      _llmCall: async () => raw,
    })
    expect(result[0].name).toBe("乙")
  })

  it("throws (rather than silently returning empty) when the response has no JSON array", async () => {
    await expect(
      llmRecognizeCharacters({
        chapters,
        llmConfig,
        sourceBook: "x",
        _llmCall: async () => "模型出错了，这里没有数组",
      }),
    ).rejects.toThrow()
  })

  it("caps the number of chapters sent to the LLM to avoid oversized prompts (HTTP 524)", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ index: i, content: `第${i + 1}章 韩立做了一件事。` }))
    let capturedPrompt = ""
    await llmRecognizeCharacters({
      chapters: many,
      llmConfig,
      sourceBook: "x",
      _llmCall: async (p) => {
        capturedPrompt = p
        return JSON.stringify([{ name: "韩立", importanceScore: 90, category: "主角" }])
      },
    })
    const chapterMarkers = (capturedPrompt.match(/【第 \d+ 章】/g) || []).length
    expect(chapterMarkers).toBeGreaterThan(0)
    expect(chapterMarkers).toBeLessThanOrEqual(12)
  })
})
