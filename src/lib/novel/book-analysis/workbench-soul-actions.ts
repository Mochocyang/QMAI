import { bindCharacterAura, loadCharacterAuraStore } from "../character-aura"
import { isSameBookAnalysisCharacterAura } from "./aura-match"
import { ensureLegacyCharacterAura, publishWorkbenchCharacter } from "./workbench-publish"
import type { BookAnalysisLibraryBook } from "./library-state"
import type { WorkbenchRevision } from "./workbench-core"

export type CharacterSoulStatus = "none" | "added" | { bound: string[] }

/** 徽标数据源：这个角色在自定义灵魂库里吗？绑给了哪些小说人物？ */
export async function loadCharacterSoulStatus(
  projectPath: string, bookTitle: string, subject: string,
): Promise<CharacterSoulStatus> {
  const store = await loadCharacterAuraStore(projectPath)
  const aura = store.customAuras.find((a) => isSameBookAnalysisCharacterAura(a, bookTitle, subject))
  if (!aura) return "none"
  const bound = store.bindings.filter((b) => b.auraId === aura.id).map((b) => b.characterName)
  return bound.length ? { bound } : "added"
}

/**
 * 确保这个角色在自定义灵魂库里，返回 auraId。
 *
 * 旧版条目与批量「确认并加入」共用同一条路径：ensureLegacyCharacterAura 内部的
 * importBookAnalysisSkillsAsAuras 会用作品库里的真实角色构建 aura
 * （aura-adapter.ts:230），因此「无人格块就退回 personalityProfile、再退回散文字段」
 * 的兜底链会自然生效——六维路径的旧版角色因此也能发布，且 SKILL.md 不会是空的。
 */
async function ensureAura(
  projectPath: string, book: BookAnalysisLibraryBook, revision: WorkbenchRevision, subject: string,
): Promise<{ auraId: string; auraName: string }> {
  if (revision.origin === "legacy") return ensureLegacyCharacterAura(projectPath, book, subject)
  const item = revision.items.find((i) => i.subject === subject)
  if (!item) throw new Error(`该版本里没有「${subject}」`)
  const aura = await publishWorkbenchCharacter(projectPath, revision, item)
  return { auraId: aura.id, auraName: aura.name }
}

/** 只入库、不绑定。用于「生成了但暂时不想绑定小说人物」的角色。 */
export async function addCharacterToSoulLibrary(
  projectPath: string, book: BookAnalysisLibraryBook, revision: WorkbenchRevision, subject: string,
): Promise<{ auraId: string; auraName: string }> {
  return ensureAura(projectPath, book, revision, subject)
}

/** 绑定到小说人物。**先入库再绑定**——这就是需求「绑定时自动进入自定义灵魂库」。 */
export async function bindCharacterToNovelCharacters(
  projectPath: string, book: BookAnalysisLibraryBook, revision: WorkbenchRevision,
  subject: string, characterNames: string[],
): Promise<{ succeeded: number; alreadyBound: string[]; failed: string[] }> {
  if (characterNames.length === 0) return { succeeded: 0, alreadyBound: [], failed: [] }
  const { auraId } = await ensureAura(projectPath, book, revision, subject)
  // 已绑定同一人物再绑视为幂等，不重复写入；汇总里计为已有。
  const store = await loadCharacterAuraStore(projectPath)
  const bound = new Set(store.bindings.filter((b) => b.auraId === auraId).map((b) => b.characterName))
  const alreadyBound = characterNames.filter((name) => bound.has(name))
  let succeeded = 0
  const failed: string[] = []
  for (const characterName of characterNames) {
    if (bound.has(characterName)) continue
    try {
      await bindCharacterAura(projectPath, { characterName, auraId })
      succeeded++
    } catch (error) {
      console.error(`[绑定角色灵魂] 失败：${characterName}`, error)
      failed.push(characterName)
    }
  }
  return { succeeded, alreadyBound, failed }
}
