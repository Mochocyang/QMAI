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

import { fileExists, writeFileAtomic } from "@/commands/fs"
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

/**
 * 文件名安全化。正则与 `.trim()` 和 graph-node-page.ts 的 fileNameFromLabel
 * 一致，只有空白名时的兜底文案不同（那边是「未命名节点」）。
 */
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
 * 不调模型、不消耗 token：ScenarioCandidate 里已经有 personality /
 * speakingStyle / knowledgeScope / doesNotKnow，够拼出一份能过校验、也有
 * 参考价值的草稿。刻意**不**塞 candidate.profile 原文：它是从别处
 * frontmatter 抄来的一段自由文本，可能很长、格式也不受控，塞进草稿只会
 * 盖过这里自己的小标题结构。用户可以在弹窗里改。
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
 * frontmatter 里 `title` 这一行的**内联标量**（含引号）。
 *
 * 名字是外部数据（从章节正文提取），必须当成不可信输入来写 YAML：
 *
 * - 含 `"` 或 `\` 的名字**必须**用单引号标量。单引号里这两个字符都是普通
 *   字面量，无需转义。旧的 `title: "${name}"` 写法会产出 `title: "林"清"`
 *   或 `title: "林\清"`，前者让双引号标量提前闭合（bad indentation of a
 *   mapping entry），后者是双引号里的非法转义（unknown escape sequence）——
 *   两种都让整个 frontmatter 解析失败，人物页不再被认成 entity 页，绑定
 *   永久被拒；又因为「已存在的人物页绝不覆盖」，用户再点多少次都不会修复。
 * - 名字含 `'` 时按 YAML 规则**加倍**（`林'清` → `'林''清'`）。
 * - 其余名字保持双引号：这样含 `'` 的名字能被原样取回，见下条。
 *
 * **不要**改成「双引号 + `.replace(/"/g, '\\"')`」或复用 chapter-meta.ts 的
 * yamlEscape / fanfic-canon.ts 的 yamlScalar：它们产出 `\"`，而
 * `character-aura.ts:2167-2173` 的 extractPrimaryTitle 用
 * `/^title:\s*["']?(.+?)["']?\s*$/m` 取值，不认 YAML 转义序列，会把反斜杠
 * 一起取回来，名字反而对不上（`林"清` 变成 `林\"清`）。同一条正则也不做
 * 单引号加倍的反转义，所以含 `'` 的名字才优先走双引号。
 */
function titleScalar(name: string): string {
  if (/["\\]/.test(name)) return `'${name.replace(/'/g, "''")}'`
  return `"${name}"`
}

/**
 * 人物实体页全文。
 *
 * frontmatter 必须是 `type: entity` + `tags` 含 `character`：这是
 * `isCharacterEntityContent`（character-aura.ts:757-763）认出「可绑定人物页」
 * 的唯一判据，写错这一行绑定就过不了校验。
 *
 * title 的引号由 `titleScalar` 按名字内容决定，**不要**顺手统一成双引号 ——
 * 名字里一个 `"` 就能让整段 frontmatter 解析失败（详见 titleScalar 注释）。
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
    `title: ${titleScalar(name)}`,
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
 *
 * 父目录由 writeFileAtomic 保证（Rust 侧 do_write_file_atomic 无条件执行
 * create_dir_all），故此处不需要先建目录。
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
    // 草稿里必然已经写了角色名（`# 名字` 与 `- 姓名：名字`），所以不能把责任
    // 推给「没写名字」。实测能走到这里的只有两种情况：名字里的特殊字符把
    // frontmatter 写坏（已在 buildProfilePageContent 用单引号标量修掉，见
    // titleScalar），或名字超过 character-aura.ts addBindableCharacterName 的
    // 40 字上限被可绑定名单筛掉。文案要指向这两个真实原因，否则用户照提示
    // 改也修不好。
    return {
      ok: false,
      created,
      message:
        "人物页已写入，但绑定校验仍未通过。请打开该人物页，确认 frontmatter 里的 type: entity 与 tags: [character] 还在（名字含特殊字符时可能写坏）；若角色名过长，请改用更短的常用名后再试。",
    }
  }
  return { ok: false, created, message: result.message }
}
