import { bindCharacterAura, loadCharacterAuraStore } from "../character-aura"
import { isSameBookAnalysisCharacterAura } from "./aura-match"
import { importBookAnalysisSkillsAsAuras } from "./aura-adapter"
import { publishWorkbenchCharacter } from "./workbench-publish"
import { generateSimpleSkillMarkdown } from "./skill-generator"
import type { BookAnalysisLibraryBook } from "./library-state"
import type { WorkbenchRevision } from "./workbench-core"
import type { CharacterSkill, ExtractedCharacter } from "./types"

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
 * 旧版条目复用 importBookAnalysisSkillsAsAuras：它内部就用真实角色构建 aura
 * （aura-adapter.ts:230），因此那条「无人格块就退回 personalityProfile、再退回
 * 散文字段」的兜底链会自然生效——六维路径的旧版角色因此也能发布。
 */
async function ensureAura(
  projectPath: string, book: BookAnalysisLibraryBook, revision: WorkbenchRevision, subject: string,
): Promise<{ auraId: string; auraName: string }> {
  if (revision.origin === "legacy") {
    const character = book.characters.find((c) => c.name === subject)
    if (!character) throw new Error(`找不到旧版角色「${subject}」`)
    const skill = book.skills.find((s) => s.characterId === character.id || s.characterName === character.name)
      ?? syntheticSkill(book, character)
    const imported = await importBookAnalysisSkillsAsAuras(projectPath, book.metadata, book.characters, [skill], [skill.id])
    if (imported.length) return { auraId: imported[0].auraId, auraName: imported[0].auraName }
    // 已存在时该函数会跳过并返回空数组；必须查回既有 aura，
    // 否则「已入库但未绑定」的角色永远绑不上。
    const store = await loadCharacterAuraStore(projectPath)
    const aura = store.customAuras.find((a) => isSameBookAnalysisCharacterAura(a, book.metadata.title, subject))
    if (!aura) throw new Error(`加入灵魂库失败：${subject}`)
    return { auraId: aura.id, auraName: aura.name }
  }
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

/**
 * 旧版角色没有可用 Skill 时就地合成一个、仅作为 aura 输入载体的 CharacterSkill。
 * 不写进 skills 目录、不进入作品库。
 *
 * 有 personalityProfile 时用 generateSimpleSkillMarkdown 生成真实内容而非留空：
 * character-aura.ts 会把 skillContent 写成 SKILL.md，故事提取会读回它。
 */
function syntheticSkill(book: BookAnalysisLibraryBook, character: ExtractedCharacter): CharacterSkill {
  const profile = character.personalityProfile
  return {
    id: `legacy-skill-${character.id}`,
    characterId: character.id,
    characterName: character.name,
    // 有富详情就用真实内容生成；没有就留空——留空时 aura 的字段仍由
    // buildGeneratedAuraInputFromBookCharacter 的散文字段兜底取到。
    skillContent: profile
      ? generateSimpleSkillMarkdown({ characterName: character.name, profile, sourceBook: book.metadata.title })
      : "",
    sourceBook: book.metadata.title,
    chapterRange: [`${character.firstAppearance}`, `${character.lastAppearance}`],
    createdAt: book.metadata.updatedAt,
  }
}
