import { readPersonalitySkill } from "../portable-personality"
import { saveWorkbenchRevision } from "./workbench-storage"
import type { BookAnalysisLibraryBook } from "./library-state"
import type { WorkbenchItem, WorkbenchRevision } from "./workbench-core"
import type { CharacterSkill, ExtractedCharacter } from "./types"

/**
 * 把旧版作品资料里的角色迁移成新版工作台条目。
 *
 * 两代数据在 PortablePersonality 汇合，所以这里只做字段映射，不新造发布逻辑。
 * 三条硬约束：
 *  1) evidence/coverage/selectedChapterIds 必须为空——confirmWorkbenchRevision 会拿 evidence
 *     逐条比对正文偏移，而旧版人格是 LLM 摘要、根本没有偏移。
 *  2) 不能假定「有 Skill 就有人格块」——六维路径的 Skill 没有便携人格块。
 *     拿不到就退回 personalityProfile，再退回散文字段。摘要可以是空串，但条目必须保留，
 *     否则会静默丢角色。
 *  3) id 必须确定性，用于「已落过盘就不再重复加入」的去重。
 */
export function buildLegacyCharacterRevision(book: BookAnalysisLibraryBook): WorkbenchRevision | null {
  if (book.characters.length === 0) return null
  const id = legacyRevisionId(book)
  const items: WorkbenchItem[] = book.characters.map((character) => {
    const persona = findPersonality(book.skills, character)
    return {
      subject: character.name,
      summary: persona?.summary ?? character.personalityProfile?.personality ?? character.personality ?? "",
      limitations: persona?.scope ?? "",
      rules: (persona?.rules ?? []).map((rule) => ({
        id: rule.id,
        // 存人格字段名；WORKBENCH_DIMENSIONS 已把五个字段映射成中文标签
        dimension: rule.field,
        observation: "",
        condition: rule.condition,
        action: rule.tendency,
        boundary: rule.boundary,
        evidenceIds: [],
      })),
    }
  })
  return {
    workbenchVersion: 2,
    id,
    taskId: id,
    bookId: book.id,
    bookTitle: book.metadata.title,
    skill: "characters",
    requirements: "旧版角色导入",
    origin: "legacy",
    selectedChapterIds: [],
    evidence: [],
    coverage: [],
    // 用元数据 updatedAt 而不是 Date.now()：同一份旧数据每次构建要得到同一个版本，
    // 否则「已存在同 id 就不再加入」的去重会与内容对不上。
    createdAt: book.metadata.updatedAt,
    items,
  }
}

/** 懒落盘：只有用户点了「确认并加入」，才把迁移版本写进 revisions 目录。 */
export async function materializeLegacyCharacterRevision(
  bookPath: string,
  book: BookAnalysisLibraryBook,
): Promise<WorkbenchRevision> {
  const revision = buildLegacyCharacterRevision(book)
  if (!revision) throw new Error("没有可导入的旧版角色")
  await saveWorkbenchRevision(bookPath, revision)
  return revision
}

/**
 * 同步的短哈希。不用 sha256Text 是因为它基于 WebCrypto、只有异步版本，
 * 而 node:crypto 在前端 bundle 里不可用；此 id 只是去重键、不是安全令牌，
 * FNV-1a 足够（确定性 + 同书同角色集合稳定 + 不同集合几乎不碰撞）。
 */
function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

function legacyRevisionId(book: BookAnalysisLibraryBook): string {
  const names = book.characters.map((c) => c.name).sort().join("\u0000")
  return `legacy-chars-${shortHash(`${book.path}\u0000${names}`)}`
}

/**
 * 人格块可能损坏（readPersonalitySkill 会抛），损坏时按「没有」处理，不阻断迁移。
 * 返回 PortablePersonality | undefined，不是 PersonalityProfile——两者不可互换。
 */
function findPersonality(skills: CharacterSkill[], character: ExtractedCharacter) {
  const skill = skills.find((s) => s.characterId === character.id || s.characterName === character.name)
  if (!skill) return undefined
  try {
    return readPersonalitySkill(skill.skillContent)
  } catch {
    return undefined
  }
}
