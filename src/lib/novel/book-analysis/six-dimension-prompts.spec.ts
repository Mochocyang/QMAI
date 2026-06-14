import { describe, expect, it } from "vitest"
import {
  ALL_DIMENSIONS,
  buildPublicMaterialPrompt,
  buildSpeechStylePrompt,
  buildExpressionDnaPrompt,
  buildExternalViewsPrompt,
  buildDecisionLogPrompt,
  buildTimelinePrompt,
  DIMENSION_LABELS,
  PROMPT_BUILDERS,
} from "./six-dimension-prompts"
import type { ExtractedCharacter } from "./types"

function makeCharacter(): ExtractedCharacter {
  return {
    id: "c1",
    name: "许七安",
    aliases: ["大郎", "许银锣"],
    importance: 8,
    category: "protagonist",
    firstAppearance: 1,
    lastAppearance: 100,
    appearanceCount: 80,
    description: "捕快出身的现代人",
    personality: "稳健、谨慎",
    speechStyle: "温和",
    relationships: [],
    keyEvents: [],
    corpus: "第一章 ... 一段正文",
    aliasMap: { canonical: "许七安", aliases: ["大郎", "许银锣"] },
  }
}

describe("six-dimension-prompts", () => {
  it("exports 6 dimensions in stable order", () => {
    expect(ALL_DIMENSIONS).toEqual([
      "publicMaterial",
      "speechStyle",
      "expressionDna",
      "externalViews",
      "decisionLog",
      "timeline",
    ])
  })

  it("has 6 labels in matching order", () => {
    for (const key of ALL_DIMENSIONS) {
      expect(DIMENSION_LABELS[key]).toMatch(/^\d{2} /)
    }
  })

  it("PROMPT_BUILDERS covers every dimension", () => {
    for (const key of ALL_DIMENSIONS) {
      expect(typeof PROMPT_BUILDERS[key]).toBe("function")
    }
  })

  it("public-material prompt contains name + aliases + book info", () => {
    const c = makeCharacter()
    const p = buildPublicMaterialPrompt({
      character: c,
      corpus: "正文",
      bookTitle: "大奉",
      bookAuthor: "卖报小郎君",
    })
    expect(p).toContain("许七安")
    expect(p).toContain("大郎")
    expect(p).toContain("许银锣")
    expect(p).toContain("大奉")
    expect(p).toContain("卖报小郎君")
    expect(p).toContain("## 人物定位")
  })

  it("speech prompt asks for at least 3 typical dialogues", () => {
    const c = makeCharacter()
    const p = buildSpeechStylePrompt({ character: c, corpus: "正文", bookTitle: "X" })
    expect(p).toContain("至少 3 段")
  })

  it("expression-dna prompt contains mapping table", () => {
    const c = makeCharacter()
    const p = buildExpressionDnaPrompt({ character: c, corpus: "正文", bookTitle: "X" })
    expect(p).toContain("表格")
  })

  it("external-views prompt handles missing web material", () => {
    const c = makeCharacter()
    const p = buildExternalViewsPrompt({ character: c, corpus: "正文", bookTitle: "X" })
    expect(p).toContain("未获取到")
  })

  it("external-views prompt uses web material when provided", () => {
    const c = makeCharacter()
    const p = buildExternalViewsPrompt({
      character: c,
      corpus: "正文",
      bookTitle: "X",
      externalMaterial: "DuckDuckGo result: 许七安是一个...",
    })
    expect(p).toContain("DuckDuckGo result")
    expect(p).not.toContain("未获取到")
  })

  it("decision-log prompt asks for at least 3 cases", () => {
    const c = makeCharacter()
    const p = buildDecisionLogPrompt({ character: c, corpus: "正文", bookTitle: "X" })
    expect(p).toContain("至少 3 个")
  })

  it("timeline prompt asks for early/mid/late", () => {
    const c = makeCharacter()
    const p = buildTimelinePrompt({ character: c, corpus: "正文", bookTitle: "X" })
    expect(p).toContain("早期")
    expect(p).toContain("中期")
    expect(p).toContain("后期")
  })

  it("truncates long corpus", () => {
    const c = makeCharacter()
    const big = "字".repeat(20000)
    const p = buildPublicMaterialPrompt({ character: c, corpus: big, bookTitle: "X" })
    expect(p).toContain("语料过长已截断")
    expect(p.length).toBeLessThan(big.length)
  })
})
