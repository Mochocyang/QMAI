import type { ExtractedCharacter, RecognizedCharacter } from "./types"

export type CharacterCandidateCategory = "protagonist" | "supporting" | "minor"

export interface CharacterCandidate extends ExtractedCharacter {
  candidateCategory: CharacterCandidateCategory
  candidateScore: number
}

function detailScore(character: ExtractedCharacter): number {
  return [
    character.description,
    character.personality,
    character.motivation,
    character.speechStyle,
    character.growthArc,
    character.behaviorPatterns,
  ].filter((value) => Boolean(value?.trim())).length
    + Math.min(2, character.keyEvents.length)
    + Math.min(2, character.representativeQuotes?.length ?? 0)
}

function classifyCharacterCandidate(character: ExtractedCharacter): CharacterCandidate | null {
  const details = detailScore(character)
  const score = character.appearanceCount * 2 + character.importance + details * 2
  if (character.appearanceCount <= 1 && character.importance <= 2 && details <= 1) return null

  const candidateCategory: CharacterCandidateCategory = character.category === "protagonist" || character.importance >= 8
    ? "protagonist"
    : character.category === "antagonist" || character.category === "supporting" || character.importance >= 5 || character.appearanceCount >= 3
      ? "supporting"
      : "minor"

  return { ...character, candidateCategory, candidateScore: score }
}

export function selectCharacterCandidates(characters: ExtractedCharacter[]): CharacterCandidate[] {
  return characters
    .map(classifyCharacterCandidate)
    .filter((character): character is CharacterCandidate => character !== null)
    .sort((left, right) => right.candidateScore - left.candidateScore)
}

/**
 * 把「已识别角色」转换为可持久化的最小角色档案（fix/recognized-persist）。
 * 深度分析尚未完成时，用户在「选择角色生成 Skill」弹窗中勾选已识别角色，
 * 先落盘为角色档案（characters/{id}.json）再生成 Skill，之后无需重新识别。
 */
export function recognizedCharacterToExtracted(character: RecognizedCharacter): ExtractedCharacter {
  const category: ExtractedCharacter["category"] =
    character.category === "主角" ? "protagonist"
    : character.category === "配角" ? "supporting"
    : "minor"
  const firstIndex = character.chapterIndices[0] ?? 0
  const lastIndex = character.chapterIndices[character.chapterIndices.length - 1] ?? 0
  return {
    id: character.id,
    name: character.name,
    aliases: character.aliases ?? [],
    importance: Math.max(1, Math.min(10, Math.ceil(character.importanceScore / 10))),
    category,
    firstAppearance: firstIndex + 1,
    lastAppearance: lastIndex + 1,
    appearanceCount: character.appearances,
    description: "",
    personality: "",
    speechStyle: "",
    relationships: [],
    keyEvents: [],
  }
}
