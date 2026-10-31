/**
 * 删大纲时如何处理关联人物小传。
 *
 * 用户口径（已拍板）：
 * - 删大纲要弹窗问「是否同时删除他们的人物小传」；
 * - 选「同时删除」→ 连带删；但手工创建 / 已标绿勾 / 仍被其他大纲引用的角色要跳过；
 * - 选「保留」→ 解引用 + 冻结 asOfChapter + 转 dormant；
 * - 反向：从人物小传删角色时不回删大纲。
 *
 * ⚠️ 为什么「删除」在这里是 archive 而不是真删文件：
 * 角色档案是 `.qmai/persona-skills/<名>/` **目录**（SKILL.md + references/history + research），
 * 而 `@/commands/fs` 只提供 `deleteFile`（单文件），项目里没有目录删除能力。
 * 真删需要新增 Rust 命令并重新编译，风险与本次需求不成比例。
 * 所以「删除」的落地是：从 index 移除 + 档案目录留盘。用户真要彻底清理，目录随时可手工删。
 *
 * 本文件是**纯函数**：判据一旦写错，用户手上的角色会被批量误删/误留，必须能穷举单测。
 */
import { loadPersonaSkillIndex, updatePersonaSkillIndex } from "./persona-skill-store"
import type { PersonaSkillMeta } from "./persona-skill-types"

export type PersonaKeepReason = "manual" | "pinned" | "referenced"

export interface PersonaDetachPlan {
  /** 可以连带移除的角色名。 */
  removals: string[]
  /** 必须保留的角色，附原因（用于向用户说明「这几位为什么没删」）。 */
  kept: Array<{ characterName: string; reason: PersonaKeepReason; otherRefs?: string[] }>
}

/**
 * 判据顺序即优先级：
 * 1. manual —— 用户手建的，永不连带移除。
 * 2. pinned（绿勾）—— 用户标记过的重点人物，永不连带移除。
 * 3. 仍被别的大纲引用 —— 移除会造成别的大纲「指向不存在的角色」。
 * 三条都过不了才进入移除集合。
 */
export function planPersonaDetach(input: {
  outlineFileName: string
  skills: readonly PersonaSkillMeta[]
}): PersonaDetachPlan {
  const removals: string[] = []
  const kept: PersonaDetachPlan["kept"] = []
  for (const meta of input.skills) {
    if (!meta.outlineRefs.includes(input.outlineFileName)) continue
    if (meta.origin === "manual") {
      kept.push({ characterName: meta.characterName, reason: "manual" })
      continue
    }
    if (meta.pinned) {
      kept.push({ characterName: meta.characterName, reason: "pinned" })
      continue
    }
    const otherRefs = meta.outlineRefs.filter((ref) => ref !== input.outlineFileName)
    if (otherRefs.length > 0) {
      kept.push({ characterName: meta.characterName, reason: "referenced", otherRefs })
      continue
    }
    removals.push(meta.characterName)
  }
  return { removals, kept }
}

/**
 * 选「保留人物小传」时的处理：解引用 + 冻结 + 转潜伏。
 *
 * 冻结 asOfChapter 是用户拍板的口径：它回答「这份档案停在哪一章」。
 * 不冻结的话界面会一直显示「已学到第 N 章」，而实际上它再也不会更新了 ——
 * 那是比停在旧值更容易误导人的状态。
 */
export function planPersonaKeep(input: {
  outlineFileName: string
  skills: readonly PersonaSkillMeta[]
}): Array<{ id: string; outlineRefs: string[]; status: "dormant"; asOfChapter: number | null }> {
  return input.skills
    .filter((meta) => meta.outlineRefs.includes(input.outlineFileName))
    .map((meta) => ({
      id: meta.id,
      outlineRefs: meta.outlineRefs.filter((ref) => ref !== input.outlineFileName),
      status: "dormant" as const,
      // 优先用学习进度定格；从没学过（lastChapter 为 0）就保留已有值。
      asOfChapter: meta.lastChapter > 0 ? meta.lastChapter : meta.asOfChapter,
    }))
}

/**
 * 从所有角色的 outlineRefs 里摘掉某个大纲文件名（纯函数）。
 *
 * 按**文件名**匹配而不是全路径：outlineRefs 里存的就是文件名
 * （见 persona-outline-sync 的 attachOutlineRef），两处口径必须一致。
 */
export function detachOutlineRefFromSkills(
  skills: readonly { characterName: string; outlineRefs: readonly string[] }[],
  outlineFileName: string,
): { changed: string[]; next: Map<string, string[]> } {
  const next = new Map<string, string[]>()
  const changed: string[] = []
  for (const skill of skills) {
    if (!skill.outlineRefs.includes(outlineFileName)) continue
    next.set(skill.characterName, skill.outlineRefs.filter((ref) => ref !== outlineFileName))
    changed.push(skill.characterName)
  }
  return { changed, next }
}

/**
 * 从 index 里移除角色（archive 语义：只移除索引条目，档案目录留在磁盘）。
 */
export function removePersonaFromIndex(
  skills: readonly PersonaSkillMeta[],
  characterNames: readonly string[],
): { removed: string[]; next: PersonaSkillMeta[] } {
  const targets = new Set(characterNames.map((name) => name.trim()))
  const removed: string[] = []
  const next = skills.filter((meta) => {
    if (!targets.has(meta.characterName)) return true
    removed.push(meta.characterName)
    return false
  })
  return { removed, next }
}

/**
 * 把「保留」计划应用到 index 上（纯函数）。
 */
export function applyPersonaKeep(
  skills: readonly PersonaSkillMeta[],
  patches: ReturnType<typeof planPersonaKeep>,
): PersonaSkillMeta[] {
  if (patches.length === 0) return [...skills]
  return skills.map((meta) => {
    const patch = patches.find((item) => item.id === meta.id)
    return patch ? { ...meta, ...patch } : meta
  })
}
/**
 * 执行解引用落盘。失败由调用方的 catch 兜住：
 * 删大纲已经成功，清理不掉只是留点脏数据，不能反过来把「删除成功」变成「删除失败」。
 */
export async function detachOutlineRef(projectPath: string, outlineFileName: string): Promise<string[]> {
  const name = outlineFileName.trim()
  if (!name) return []
  const index = await loadPersonaSkillIndex(projectPath)
  const plan = detachOutlineRefFromSkills(index.skills, name)
  if (plan.changed.length === 0) return []

  await updatePersonaSkillIndex(projectPath, (current) => {
    const changed = new Set(plan.changed.map((characterName) => characterName.trim()))
    return {
      version: 1,
      skills: current.skills.map((meta) =>
        changed.has(meta.characterName) && meta.outlineRefs.includes(name)
          ? { ...meta, outlineRefs: meta.outlineRefs.filter((ref) => ref !== name), updatedAt: new Date().toISOString() }
          : meta,
      ),
    }
  })
  return plan.changed
}

/**
 * 删大纲时用户选择「同时删除」→ archive 语义移除。
 *
 * 只动 index，不动磁盘：档案目录留在 `.qmai/persona-skills/<名>/`，
 * 需要彻底清理时用户可手工删目录。这样做的原因是项目没有目录删除能力，
 * 而「误删目录」是不可逆的 —— 宁可留文件，也不能给用户一个删了找不回来的按钮。
 */
export async function removePersonaFromProject(
  projectPath: string,
  characterNames: readonly string[],
): Promise<string[]> {
  if (characterNames.length === 0) return []
  let removed: string[] = []
  await updatePersonaSkillIndex(projectPath, (current) => {
    const result = removePersonaFromIndex(current.skills, characterNames)
    removed = result.removed
    if (result.removed.length === 0) return
    return { version: 1, skills: result.next }
  })
  return removed
}

/**
 * 删大纲时用户选择「保留」→ 解引用 + 冻结 asOfChapter + 转 dormant。
 */
export async function keepPersonaAfterOutlineDelete(
  projectPath: string,
  outlineFileName: string,
): Promise<number> {
  const name = outlineFileName.trim()
  if (!name) return 0
  const index = await loadPersonaSkillIndex(projectPath)
  const patches = planPersonaKeep({ outlineFileName: name, skills: index.skills })
  if (patches.length === 0) return 0

  await updatePersonaSkillIndex(projectPath, (current) => ({
    version: 1,
    skills: applyPersonaKeep(current.skills, patches),
  }))
  return patches.length
}