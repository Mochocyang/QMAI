import type { CharacterAura } from "@/lib/novel/character-aura"

const BOOK_ANALYSIS_AURA_CATEGORIES = new Set(["拆书角色", "鎷嗕功瑙掕壊"])

export function bookAnalysisAuraKey(bookTitle: string, characterName: string): string {
  return `${bookTitle.trim()}\u0000${characterName.trim()}`
}

export function isSameBookAnalysisCharacterAura(
  aura: CharacterAura,
  bookTitle: string,
  characterName: string,
): boolean {
  if (aura.builtIn) return false
  if (!BOOK_ANALYSIS_AURA_CATEGORIES.has(aura.category ?? "")) return false
  if (aura.name !== characterName) return false

  return [
    aura.sourceNote,
    aura.corpus,
    aura.notes,
    aura.generationPrompt,
  ].some((text) => text?.includes(bookTitle))
}
