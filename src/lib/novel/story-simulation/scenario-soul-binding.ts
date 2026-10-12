/**
 * 「舞台情景」绑定灵魂
 *
 * ── 为什么需要这个模块 ──
 * `bindCharacterAura` 写盘前会查 `hasCharacterProfile`，要求该角色已经在
 * `wiki/entities`（type=entity 且 tags 含 character）或 `wiki/outlines`
 * 里有「人物小传 / 人物设定」，否则直接抛错。
 *
 * 而舞台情景的候选角色是 `extractStoryContent` 从**章节正文**提取的，
 * 提取过程只读不写 —— 所以这些角色大概率还没有人物页，一点「绑定灵魂」
 * 就会被拒。本模块把「就地补一份最小小传再绑」这件事做完。
 *
 * ── 为什么是「先试后补」而不是「先查后补」──
 * `hasCharacterProfile` 除了查实体页/大纲，还会兜底走一次 `searchWiki`
 * （character-aura.ts:737-745）。若在这里用 `listBindableNovelCharacters`
 * 自己预判，会漏掉 searchWiki 这条命中路径，对本来能绑成功的角色弹出
 * 多余的补小传步骤。所以顺序必须是：直接绑 → 失败且原因正是缺小传 → 才补。
 */

import { createDirectory, fileExists, writeFileAtomic } from "@/commands/fs"
import {
  CHARACTER_AURA_BINDING_BLOCK_MESSAGE,
  bindCharacterAura,
} from "@/lib/novel/character-aura"
import { normalizePath } from "@/lib/path-utils"
import type { ScenarioCandidate } from "./scenario-types"

/** 认知范围最多带入条目数，避免一份草稿长得没法读。 */
const DRAFT_COGNITION_LIMIT = 10

/** 性格 / 风格缺省时的占位文案。 */
const DRAFT_PLACEHOLDER = "（待补充）"

/** 文件名安全化。规则与 graph-node-page.ts 的 fileNameFromLabel 一致。 */
export function scenarioProfileFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim() || "未命名角色"
}

/** 人物页的落盘路径。 */
export function scenarioProfilePagePath(projectPath: string, name: string): string {
  const pp = normalizePath(projectPath)
  return `${pp}/wiki/entities/${scenarioProfileFileName(name)}.md`
}

/**
 * 由候选角色**已有**的信息拼出小传草稿。
 *
 * 不调模型、不消耗 token：ScenarioCandidate 里已经有 profile / personality /
 * speakingStyle / knowledgeScope / doesNotKnow，够拼出一份能过校验、也有
 * 参考价值的草稿。用户可以在弹窗里改。
 */
export function buildProfileDraftFromCandidate(candidate: ScenarioCandidate): string {
  const lines: string[] = []

  lines.push(`# ${candidate.name}`)
  lines.push("")
  lines.push("## 基本信息")
  lines.push(`- 姓名：${candidate.name}`)
  if (candidate.auraName) lines.push(`- 灵魂：${candidate.auraName}`)

  lines.push("")
  lines.push("## 性格")
  lines.push(
    candidate.personality.length > 0
      ? candidate.personality.join("、")
      : DRAFT_PLACEHOLDER,
  )

  lines.push("")
  lines.push("## 说话风格")
  lines.push(candidate.speakingStyle.trim() || DRAFT_PLACEHOLDER)

  const knows = candidate.knowledgeScope.slice(0, DRAFT_COGNITION_LIMIT)
  const notKnows = candidate.doesNotKnow.slice(0, DRAFT_COGNITION_LIMIT)
  if (knows.length > 0 || notKnows.length > 0) {
    lines.push("")
    lines.push("## 认知范围")
    if (knows.length > 0) {
      lines.push("### 知道")
      for (const item of knows) lines.push(`- ${item}`)
    }
    if (notKnows.length > 0) {
      lines.push("### 不知道")
      for (const item of notKnows) lines.push(`- ${item}`)
    }
  }

  lines.push("")
  lines.push("<!-- 由「舞台情景」根据已写章节自动整理，可自由修改 -->")
  return lines.join("\n")
}

/**
 * 人物实体页全文。
 *
 * frontmatter 必须是 `type: entity` + `tags` 含 `character`：这是
 * `isCharacterEntityContent`（character-aura.ts:757-763）认出「可绑定人物页」
 * 的唯一判据，写错这一行绑定就过不了校验。
 */
export function buildProfilePageContent(
  name: string,
  body: string,
  date: Date = new Date(),
): string {
  const day = date.toISOString().slice(0, 10)
  return [
    "---",
    "type: entity",
    `title: "${name}"`,
    "tags: [character]",
    `created: ${day}`,
    `updated: ${day}`,
    "---",
    "",
    body.trim(),
    "",
  ].join("\n")
}

/** 绑定结果：成功 / 缺小传 / 其它错误。 */
export type ScenarioSoulBindResult =
  | { ok: true }
  | { ok: false; reason: "missing-profile" }
  | { ok: false; reason: "error"; message: string }

/** 补小传再绑的结果：无论成败都带上「这次建了没有」。 */
export type ScenarioSoulBindOutcome =
  | { ok: true; created: boolean }
  | { ok: false; created: boolean; message: string }

/** 这个错误是不是「缺人物小传」。 */
export function isMissingProfileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(CHARACTER_AURA_BINDING_BLOCK_MESSAGE)
  )
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 照常绑一次，并把失败原因分成三类交给界面。 */
export async function bindScenarioSoul(
  projectPath: string,
  characterName: string,
  auraId: string,
): Promise<ScenarioSoulBindResult> {
  try {
    await bindCharacterAura(projectPath, { characterName, auraId })
    return { ok: true }
  } catch (error) {
    if (isMissingProfileError(error)) return { ok: false, reason: "missing-profile" }
    return { ok: false, reason: "error", message: toMessage(error) }
  }
}

/**
 * 补一份最简小传，然后绑定。
 *
 * **已存在的人物页绝不覆盖** —— 用户手写的内容比我们拼的草稿重要得多，
 * 所以 fileExists 为真时直接跳过写入进入绑定。
 */
export async function createProfilePageThenBind(
  projectPath: string,
  characterName: string,
  auraId: string,
  body: string,
): Promise<ScenarioSoulBindOutcome> {
  const path = scenarioProfilePagePath(projectPath, characterName)
  let created = false

  try {
    const exists = await fileExists(path)
    if (!exists) {
      await createDirectory(`${normalizePath(projectPath)}/wiki/entities`)
      await writeFileAtomic(path, buildProfilePageContent(characterName, body))
      created = true
    }
  } catch (error) {
    return {
      ok: false,
      created: false,
      message: `写入人物页失败：${toMessage(error)}`,
    }
  }

  const result = await bindScenarioSoul(projectPath, characterName, auraId)
  if (result.ok) return { ok: true, created }
  if (result.reason === "missing-profile") {
    return {
      ok: false,
      created,
      message:
        "人物页已写入，但绑定仍被拒绝。请确认这份小传里写到了角色姓名，或先在「人物小传」里补全档案。",
    }
  }
  return { ok: false, created, message: result.message }
}
