/**
 * 把人物档案投影成 `wiki/outlines/人物小传/<名>.md`（IO 层）。
 *
 * 为什么单独一个文件而不留在 persona-outline-sync：
 * 「建档」和「保存大纲时抓人」两条路都必须产出投影，而 sync 依赖 learning
 * （要用 createPersonaSkillByUser）。若 learning 反过来 import sync，就成了循环依赖。
 * 所以把这段唯一的写盘逻辑提出来，两边都依赖它，谁也不再依赖谁。
 *
 * 单向投影：只读档案、只写投影，永不反向解析用户改动（理由见 persona-projection.ts）。
 */
import { createDirectory, fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { isGeneratedProjection, renderPersonaTableMarkdown } from "./persona-projection"
import { splitPersonaSkillDocument } from "./persona-skill-profile"
import { loadPersonaSkillIndex, readPersonaSkillDocument } from "./persona-skill-store"

/** 人物小传投影所在的文件夹（与 DEFAULT_OUTLINE_FOLDERS 的 characters 同名）。 */
export const PERSONA_PROJECTION_FOLDER = "人物小传"

/**
 * 生成/更新投影文件。
 *
 * 覆盖规则：只有文件不存在、或文件带 generated-from 标记时才写。
 * 用户手写过的同名文件永不覆盖 —— 一次建档就吃掉用户正文是不可接受的。
 */
export async function projectPersonaToOutline(pp: string, id: string): Promise<void> {
  const meta = (await loadPersonaSkillIndex(pp)).skills.find((item) => item.id === id)
  if (!meta) return
  const fields = splitPersonaSkillDocument(await readPersonaSkillDocument(pp, id)).fields
  const dir = `${pp}/wiki/outlines/${PERSONA_PROJECTION_FOLDER}`
  const target = `${dir}/${meta.characterName}.md`
  if (await fileExists(target)) {
    if (!isGeneratedProjection(await readFile(target))) return
  } else {
    await createDirectory(dir)
  }
  await writeFileAtomic(target, renderPersonaTableMarkdown({
    characterName: meta.characterName,
    roleType: meta.roleType,
    personaId: meta.id,
    generatedAt: new Date().toISOString(),
    fields,
    // 反向引用跟着投影一起出去：从人物小传那份 MD 就能看到它被哪些大纲引用。
    outlineRefs: meta.outlineRefs,
  }))
}
