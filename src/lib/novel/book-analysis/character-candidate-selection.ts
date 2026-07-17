import type { ExtractedCharacter } from "./types"

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

export function classifyCharacterCandidate(character: ExtractedCharacter): CharacterCandidate | null {
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
