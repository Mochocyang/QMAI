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

  /*
   * 必须按书名**边界**匹配，不能用 text.includes(bookTitle) 的裸子串。
   *
   * 拆书发布的 aura 一律把书名写成《书名》（aura-adapter 的 sourceNote「来自拆书作品《X》…」
   * 与 corpus 首行「来源作品：《X》」），所以《X》就是那个边界。
   *
   * 裸子串会把两本不同的书混为一谈：书名互为子串时（《测试》⊂《测试作品》），
   * 《测试作品》的备注里含有「测试」二字，于是在《测试》里：
   *  - 删除会连《测试作品》的灵魂一起真删（不可撤销的数据丢失）；
   *  - 发布会把《测试作品》那条当成「已有」去更新，改写成《测试》的内容。
   * 两个症状都有回归测试钉住（workbench-remove.spec.ts）。
   */
  const title = bookTitle.trim()
  const marker = `《${title}》`
  return [
    aura.sourceNote,
    aura.corpus,
    aura.notes,
    aura.generationPrompt,
  ].some((text) => Boolean(text) && (text!.includes(marker) || text!.trim() === title))
}
