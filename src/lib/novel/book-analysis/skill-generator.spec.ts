import { describe, it, expect } from "vitest"
import { generateCharacterSkill, generateSimpleSkillMarkdown, isSixDimensionSkill } from "./skill-generator"
import type { BookAnalysisMetadata, ExtractedCharacter } from "./types"
import type { LlmConfig } from "@/stores/wiki-store"

const metadata: BookAnalysisMetadata = {
  title: "长夜书",
  totalChapters: 3,
  totalWords: 12000,
  sourceType: "file",
  createdAt: 1,
  updatedAt: 2,
}

const stubLlmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "x",
  model: "x",
  ollamaUrl: "http://127.0.0.1:1",
  customEndpoint: "http://127.0.0.1:1",
  maxContextSize: 8000,
}

describe("isSixDimensionSkill", () => {
  it("存在 sixDimensionResearch + sixDimensionMeta 时返回 true", () => {
    const c: ExtractedCharacter = {
      id: "1", name: "A", aliases: [], importance: 1, category: "protagonist",
      firstAppearance: 1, lastAppearance: 2, appearanceCount: 2,
      description: "", personality: "", speechStyle: "", relationships: [], keyEvents: [],
      sixDimensionResearch: {
        publicMaterial: "", speechStyle: "", expressionDna: "",
        externalViews: "", decisionLog: "", timeline: "",
      },
      sixDimensionMeta: {
        depth: "standard", schemaVersion: 1, generatedAt: 1,
        webSearchUsed: false, llmFallbackUsed: false, sourceNote: "",
      },
    }
    expect(isSixDimensionSkill(c)).toBe(true)
  })

  it("仅 personalityProfile 时返回 false", () => {
    const c: ExtractedCharacter = {
      id: "1", name: "A", aliases: [], importance: 1, category: "protagonist",
      firstAppearance: 1, lastAppearance: 2, appearanceCount: 2,
      description: "", personality: "", speechStyle: "", relationships: [], keyEvents: [],
      personalityProfile: {
        personality: "x", motivation: "y", speechStyle: "z",
        behaviorPatterns: "w", quotes: [],
      },
    }
    expect(isSixDimensionSkill(c)).toBe(false)
  })
})

describe("generateSimpleSkillMarkdown", () => {
  it("包含 4 字段 + 代表性台词", () => {
    const md = generateSimpleSkillMarkdown({
      characterName: "许七安",
      profile: {
        personality: "机智", motivation: "上位", speechStyle: "犀利",
        behaviorPatterns: "果断", quotes: ["q1", "q2", "q3"],
      },
      sourceBook: "长夜书",
    })
    expect(md).toContain("许七安")
    expect(md).toContain("机智")
    expect(md).toContain("上位")
    expect(md).toContain("犀利")
    expect(md).toContain("果断")
    expect(md).toContain("q1")
    expect(md).toContain("q2")
    expect(md).toContain("q3")
  })
})

describe("generateCharacterSkill 模式分支", () => {
  it("personalityProfile 存在时走简单提取模板，不调 LLM", async () => {
    const c: ExtractedCharacter = {
      id: "1", name: "许七安", aliases: ["许七"], importance: 1, category: "protagonist",
      firstAppearance: 1, lastAppearance: 2, appearanceCount: 2,
      description: "desc", personality: "p", speechStyle: "s",
      relationships: [], keyEvents: [],
      personalityProfile: {
        personality: "机智", motivation: "上位", speechStyle: "犀利",
        behaviorPatterns: "果断", quotes: ["q1", "q2"],
      },
    }
    const md = await generateCharacterSkill(
      c,
      metadata,
      // 故意传一个无效 endpoint；如果走了 LLM 路径，会抛错或挂起
      stubLlmConfig
    )
    expect(md).toContain("许七安")
    expect(md).toContain("机智")
    expect(md).toContain("代表性台词")
  })

  it("sixDimensionResearch 存在时走 6 维度模板", async () => {
    const c: ExtractedCharacter = {
      id: "1", name: "许七安", aliases: [], importance: 1, category: "protagonist",
      firstAppearance: 1, lastAppearance: 2, appearanceCount: 2,
      description: "desc", personality: "p", speechStyle: "s",
      relationships: [], keyEvents: [],
      sixDimensionResearch: {
        publicMaterial: "公开资料内容",
        speechStyle: "", expressionDna: "",
        externalViews: "", decisionLog: "", timeline: "",
      },
      sixDimensionMeta: {
        depth: "standard", schemaVersion: 1, generatedAt: 1,
        webSearchUsed: false, llmFallbackUsed: false, sourceNote: "测试",
      },
    }
    const md = await generateCharacterSkill(
      c,
      metadata,
      stubLlmConfig
    )
    expect(md).toContain("许七安")
    expect(md).toContain("公开资料内容")
    expect(md).toContain("6 维度分析")
  })
})
