import { describe, expect, it } from "vitest"
import { recognizedCharacterToExtracted, selectCharacterCandidates } from "./character-candidate-selection"
import type { ExtractedCharacter, RecognizedCharacter } from "./types"

const character = (overrides: Partial<ExtractedCharacter>): ExtractedCharacter => ({
  id: "character",
  name: "角色",
  aliases: [],
  importance: 4,
  category: "minor",
  firstAppearance: 1,
  lastAppearance: 4,
  appearanceCount: 2,
  description: "有明确身份",
  personality: "谨慎",
  speechStyle: "短句",
  relationships: [],
  keyEvents: [],
  ...overrides,
})

describe("角色候选筛选", () => {
  it("过滤一次出现且资料不足的路人角色，并给保留角色分类", () => {
    const candidates = selectCharacterCandidates([
      character({ id: "hero", name: "主角", importance: 9, category: "protagonist", appearanceCount: 1 }),
      character({ id: "supporting", name: "配角", importance: 5, category: "supporting", appearanceCount: 2 }),
      character({ id: "extra", name: "路人甲", importance: 1, appearanceCount: 1, description: "", personality: "", speechStyle: "" }),
    ])

    expect(candidates.map((item) => item.id)).toEqual(["hero", "supporting"])
    expect(candidates.map((item) => item.candidateCategory)).toEqual(["protagonist", "supporting"])
  })
})

describe("recognizedCharacterToExtracted（识别角色 → 角色档案）", () => {
  const recognized = (overrides: Partial<RecognizedCharacter>): RecognizedCharacter => ({
    id: "char-hanli",
    name: "韩立",
    aliases: ["小韩"],
    appearances: 12,
    chapterIndices: [0, 4, 9],
    importanceScore: 92,
    category: "主角",
    sourceBook: "E:/book",
    ...overrides,
  })

  it("映射分类、出场范围与重要性（0-100 → 1-10）", () => {
    const extracted = recognizedCharacterToExtracted(recognized())
    expect(extracted.id).toBe("char-hanli")
    expect(extracted.name).toBe("韩立")
    expect(extracted.aliases).toEqual(["小韩"])
    expect(extracted.category).toBe("protagonist")
    expect(extracted.importance).toBe(10)
    expect(extracted.firstAppearance).toBe(1)
    expect(extracted.lastAppearance).toBe(10)
    expect(extracted.appearanceCount).toBe(12)
    expect(extracted.relationships).toEqual([])
    expect(extracted.keyEvents).toEqual([])
  })

  it("配角 / 次要分类与重要性越界钳制", () => {
    const supporting = recognizedCharacterToExtracted(recognized({ category: "配角", importanceScore: 55 }))
    expect(supporting.category).toBe("supporting")
    expect(supporting.importance).toBe(6)

    const minor = recognizedCharacterToExtracted(recognized({ category: "次要", importanceScore: 3 }))
    expect(minor.category).toBe("minor")
    expect(minor.importance).toBe(1)
  })

  it("无出场章节索引时兜底为第 1 章", () => {
    const extracted = recognizedCharacterToExtracted(recognized({ chapterIndices: [] }))
    expect(extracted.firstAppearance).toBe(1)
    expect(extracted.lastAppearance).toBe(1)
  })
})
