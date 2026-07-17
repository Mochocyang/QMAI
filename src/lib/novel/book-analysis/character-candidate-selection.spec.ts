import { describe, expect, it } from "vitest"
import { selectCharacterCandidates } from "./character-candidate-selection"
import type { ExtractedCharacter } from "./types"

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
