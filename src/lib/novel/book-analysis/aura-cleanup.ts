/**
 * 拆书作品 → 孤儿灵魂 清理工具
 *
 * 什么是孤儿灵魂？
 *   - category === "拆书角色"
 *   - sourceNote 或 corpus 中包含 `《<原作品标题>》`
 *   - 用户在"自定义灵魂"中已不再需要（来源作品已删除）
 *
 * deleteOrphanAurasForBook 会：
 *   1. 加载当前项目的 CharacterAuraStore
 *   2. 找出所有属于该书、且没有被任何人物"绑定使用中"的灵魂
 *   3. 直接复用 deleteCustomCharacterAura：连带绑定关系一并清理
 *   4. 返回实际删除数量
 *
 * 注意：
 *   - 内置灵魂（builtIn=true）永远不会被清掉
 *   - 该书生成后用户已经绑到人物身上的灵魂，只有当其他书未占用时一起清（避免误删活跃灵魂）
 *     实现策略：只清掉没有出现在任何 binding.auraId 中的孤儿
 */

import { deleteCustomCharacterAura, listCharacterAuras } from "@/lib/novel/character-aura"
import { loadCharacterAuraStore } from "@/lib/novel/character-aura"

const BOOK_TITLE_IN_SOURCE_NOTE = (title: string) =>
  new RegExp(`《\\s*${escapeRegExp(title)}\\s*》`)

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * 检查一个灵魂是否属于指定书目的"拆书角色"产物
 */
export function isAuraFromBook(
  aura: { category?: string; sourceNote?: string; corpus?: string },
  bookTitle: string,
): boolean {
  if (!bookTitle) return false
  if (aura.category !== "拆书角色") return false
  const matcher = BOOK_TITLE_IN_SOURCE_NOTE(bookTitle)
  if (aura.sourceNote && matcher.test(aura.sourceNote)) return true
  if (aura.corpus && matcher.test(aura.corpus)) return true
  return false
}

/**
 * 删除一本书对应的孤儿灵魂（未在绑定中的）。
 * 返回被删除的 aura 数量。
 */
export async function deleteOrphanAurasForBook(
  projectPath: string,
  bookTitle: string,
): Promise<number> {
  if (!projectPath || !bookTitle) return 0
  const store = await loadCharacterAuraStore(projectPath)
  const allAuras = await listCharacterAuras(projectPath)
  // 取当前 store 中所有"被绑定到的 auraId"
  const boundAuraIds = new Set(store.bindings.map((binding) => binding.auraId))

  const orphanAuraIds: string[] = []
  for (const aura of allAuras) {
    if (aura.builtIn) continue
    if (boundAuraIds.has(aura.id)) continue
    if (isAuraFromBook(aura, bookTitle)) {
      orphanAuraIds.push(aura.id)
    }
  }

  let removed = 0
  for (const id of orphanAuraIds) {
    try {
      await deleteCustomCharacterAura(projectPath, id)
      removed += 1
    } catch (error) {
      console.warn(`[book-analysis] 删除孤儿灵魂 ${id} 失败`, error)
    }
  }
  return removed
}

/**
 * 列出属于某本书的孤儿灵魂 ID（只读，不删除）
 */
export async function listOrphanAurasForBook(
  projectPath: string,
  bookTitle: string,
): Promise<string[]> {
  if (!projectPath || !bookTitle) return []
  const store = await loadCharacterAuraStore(projectPath)
  const allAuras = await listCharacterAuras(projectPath)
  const boundAuraIds = new Set(store.bindings.map((binding) => binding.auraId))

  return allAuras
    .filter((aura) => !aura.builtIn)
    .filter((aura) => !boundAuraIds.has(aura.id))
    .filter((aura) => isAuraFromBook(aura, bookTitle))
    .map((aura) => aura.id)
}
