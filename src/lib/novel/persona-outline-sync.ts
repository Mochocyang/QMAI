/**
 * 大纲保存 → 人物小传同步。
 *
 * 为什么抽角色名必须是**纯函数**：它是整条链路上唯一可能出错的判断，
 * 而同步本身有 IO、有模型调用、有排队，没法在单测里稳定复现。
 * 把「谁算角色」剥出来单独测，是这条链路唯一能守住正确性的地方。
 *
 * 触发口径（用户拍板）：**只在保存入库时抓，不保存不抓**。
 * 所以这里没有定时器、没有文件监听、没有「提取记忆」按钮的入口。
 */
import { normalizePath } from "@/lib/path-utils"
import { enablePersonaEvolutionOnFirstBuild } from "./persona-evolution-autostart"
import { createPersonaSkillByUser } from "./persona-skill-learning"
import { projectPersonaToOutline } from "./persona-projection-writer"
export { projectPersonaToOutline } from "./persona-projection-writer"
import {
  loadPersonaSkillIndex,
  personaSkillIdFor,
  updatePersonaSkillState,
} from "./persona-skill-store"
import { normalizePersonaName } from "./persona-skill-types"
import type { OutlineSaveRequest } from "./outline-save-request"

/** §13 表头的固定列名。第一列一定叫「角色」，这一列的内容才是人名。 */
const CAST_TABLE_HEADER = "角色"

/** 不是人名的单元格内容。 */
const NOT_A_NAME = new Set(["角色", "姓名", "无", "-", "—", "/", "未定", "待定"])

function acceptName(name: string, into: string[]): void {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 40) return
  if (NOT_A_NAME.has(trimmed)) return
  if (into.includes(trimmed)) return
  into.push(trimmed)
}

/**
 * 从章纲正文的 §13 表格里抽第一列。
 * 只认「| 角色 | ...」开头的那张表：别的表格（事件链、伏笔）第一列不是人名。
 */
function collectFromCastTable(content: string, into: string[]): void {
  let inCastTable = false
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("|")) { inCastTable = false; continue }
    const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim())
    if (cells[0] === CAST_TABLE_HEADER) { inCastTable = true; continue }
    if (!inCastTable) continue
    // 分隔行 | --- | --- |
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === "")) continue
    acceptName(cells[0], into)
  }
}

/** 从卷纲 structuredData 里抽 roles[].name；结构不认识就返回，绝不猜。 */
function collectFromStructuredData(structuredData: string | undefined, into: string[]): void {
  if (!structuredData) return
  let parsed: unknown
  try { parsed = JSON.parse(structuredData) } catch { return }
  const volumes = (parsed as { volumes?: unknown })?.volumes
  if (!Array.isArray(volumes)) return
  for (const volume of volumes) {
    const roles = (volume as { roles?: unknown })?.roles
    if (!Array.isArray(roles)) continue
    for (const role of roles) {
      const name = (role as { name?: unknown })?.name
      if (typeof name === "string") acceptName(name, into)
    }
  }
}

/** 文件基名（去掉扩展名）。角色草稿与人物小传 MD 都以文件名承载人名。 */
function baseNameWithoutExt(fileName: string): string {
  return fileName.replace(/\.(md|html|json)$/i, "").trim()
}

export function collectOutlineCharacterNames(requests: readonly OutlineSaveRequest[]): string[] {
  const names: string[] = []
  for (const request of requests) {
    // 来源 1：卷纲结构化数据
    collectFromStructuredData(request.structuredData, names)
    // 来源 2：章纲 §13 出场角色表
    if (request.fileType === "chapter-outline") collectFromCastTable(request.content, names)
    // 来源 3：角色草稿／来源 4：直接写进「人物小传」的 MD
    if (request.targetFolder.trim() === "人物小传" || request.fileType === "character") {
      acceptName(baseNameWithoutExt(request.fileName), names)
    }
  }
  return names
}

/**
 * 永不抛的包装。
 *
 * 为什么必须有它：这条链路挂在「保存成功」之后，抛出去会变成无人处理的 rejection，
 * 而调用方（对话框）此刻正在做跳转与状态清理，一个飘出来的错误会把保存成功的结论搅浑。
 * 失败的正确表现是：保存照常成功，同步失败只 warn，不改变任何已完成的结论。
 */
export async function runPersonaSyncSafely(task: () => Promise<void>, label: string): Promise<void> {
  try {
    await task()
  } catch (error) {
    console.warn(`[persona-sync] ${label}失败：`, error)
  }
}

export interface SyncPersonaFromOutlineSaveInput {
  projectPath: string
  /** 本次保存的大纲文件名（不带路径），用来写 outlineRefs。 */
  outlineFileName: string
  requests: readonly OutlineSaveRequest[]
  llmConfig: unknown
}

export async function syncPersonaFromOutlineSave(input: SyncPersonaFromOutlineSaveInput): Promise<void> {
  const names = collectOutlineCharacterNames(input.requests)
  if (names.length === 0) return
  const pp = normalizePath(input.projectPath)
  const known = new Set(
    (await loadPersonaSkillIndex(pp)).skills.map((meta) => normalizePersonaName(meta.characterName)),
  )

  for (const name of names) {
    const normalized = normalizePersonaName(name)
    if (!known.has(normalized)) {
      // 新角色：走建档流程（origin=auto 由学习侧默认值保障）。
      // 这里**不调模型**：保存大纲时手上只有名字，没有可支撑演技字段的正文证据，
      // 让模型凭空编一份档案，正是「技能库里出现一堆没戏份的假人物」的来源。
      await createPersonaSkillByUser({
        projectPath: pp,
        characterName: name,
        roleType: "",
        fields: {},
        llmConfig: input.llmConfig,
        // 抓来的角色是 auto：它没有用户手写的正文，删大纲时应当可以被连带清理。
        origin: "auto",
      })
      known.add(normalized)
      // 用户口径：新角色「自动进入人物小传，并且开启了自动进化」。
      // 只在**首次建档**时调用；函数内部会尊重用户已有关掉的选择。
      await enablePersonaEvolutionOnFirstBuild(pp)
    }
    // 已建档：只记引用。正文交给章节学习，这次保存没有可信的演技证据，不能瞎写。
    await attachOutlineRef(pp, name, input.outlineFileName)
    await projectPersonaToOutline(pp, personaSkillIdFor(name))
  }
}

/** 追加一条大纲引用，去重。 */
async function attachOutlineRef(pp: string, characterName: string, outlineFileName: string): Promise<void> {
  await updatePersonaSkillState(pp, (state) => {
    let changed = false
    const skills = state.index.skills.map((meta) => {
      if (normalizePersonaName(meta.characterName) !== normalizePersonaName(characterName)) return meta
      if (meta.outlineRefs.includes(outlineFileName)) return meta
      changed = true
      return { ...meta, outlineRefs: [...meta.outlineRefs, outlineFileName], updatedAt: new Date().toISOString() }
    })
    return changed ? { index: { version: 1, skills } } : {}
  })
}

