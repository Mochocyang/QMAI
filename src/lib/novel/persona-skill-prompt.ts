import { buildLanguageReminder, getOutputLanguage } from "@/lib/output-language"
import type { ChatMessage, RequestOverrides } from "@/lib/llm-providers"
import {
  PERSONA_MAJOR_FIELDS,
  PERSONA_MINOR_FIELDS,
  PERSONA_RESEARCH_DOCUMENTS,
  type PersonaSkillMode,
  type PersonaSkillTier,
} from "./persona-skill-types"

/** 单次调用的正文预算：超出只送「开头 + 省略标记 + 结尾」。 */
export const PERSONA_SKILL_BODY_HEAD_CHARS = 4000
export const PERSONA_SKILL_BODY_TAIL_CHARS = 2000

export const PERSONA_SKILL_DOC_HEAD_CHARS = 3000
export const PERSONA_SKILL_DOC_TAIL_CHARS = 3000

/**
 * 既有档案进提示词前必须截断。用户手改过的档案每章会被追加一段「补充」，
 * 正文随出场章数线性增长；不截断的话几百章后单次请求带上整部累积文档，
 * 最终超上下文 → streamChat 每轮抛错 → 被学习函数的 catch 吞成 warn →
 * 这个人的学习永久静默失效（而文档不会自己缩小，不会自愈）。
 */
export function buildPersonaSkillExisting(document: string): string {
  const body = document.trim()
  const budget = PERSONA_SKILL_DOC_HEAD_CHARS + PERSONA_SKILL_DOC_TAIL_CHARS
  if (body.length <= budget) return body
  return [
    body.slice(0, PERSONA_SKILL_DOC_HEAD_CHARS),
    "",
    "……（中间省略）……",
    "",
    body.slice(-PERSONA_SKILL_DOC_TAIL_CHARS),
  ].join("\n")
}

/** 这一轮是提取任务：低温、关推理、不注入全局用户记忆。 */
export const PERSONA_SKILL_REQUEST_OVERRIDES: RequestOverrides = {
  temperature: 0.3,
  reasoning: { mode: "off" },
  skipUserMemory: true,
}

export interface PersonaSkillPromptTarget {
  characterName: string
  aliases: readonly string[]
  roleType: string
  tier: PersonaSkillTier
  mode: PersonaSkillMode
  pinned: boolean
  /** 本轮要不要顺带产出研究文件（plan.withResearch 直接透传）。 */
  withResearch: boolean
  appearanceCount: number
  existingSkill?: string
}

export interface PersonaSkillPromptInput {
  chapterNumber: number
  chapterBody: string
  targets: readonly PersonaSkillPromptTarget[]
}

export interface PersonaSkillResearchPromptInput {
  characterName: string
  roleType: string
  document: string
}

export function buildPersonaSkillBody(chapterBody: string): string {
  const body = chapterBody.trim()
  const budget = PERSONA_SKILL_BODY_HEAD_CHARS + PERSONA_SKILL_BODY_TAIL_CHARS
  if (body.length <= budget) return body
  return [
    body.slice(0, PERSONA_SKILL_BODY_HEAD_CHARS),
    "",
    "……（中间省略）……",
    "",
    body.slice(-PERSONA_SKILL_BODY_TAIL_CHARS),
  ].join("\n")
}

export function buildPersonaSkillSystemPrompt(): string {
  return [
    "你是长篇小说的人物档案编辑。用户会一次给你同一章里的多个人物；",
    "你要在一次回答里为每个人物产出一份「人物 Skill」。",
    "",
    "硬性要求：",
    "1. 只写本章正文里能看出来、或能直接推断的东西。看不出来的字段给空字符串，禁止编造。",
    "2. 有人物带了「已有档案」，那只补本章新增的信息，绝不重写既有段落。",
    "3. 每个人物只写「需要填写的字段」里列出的字段，字段名必须逐字一致。",
    "4. 「怎么说话」要给可模仿的语言特征（口头禅、句式长短、称谓、停顿节奏），",
    "   不要写「他很聪明」这类评价。",
    "5. 只有标了「需要研究文件」的人物才额外产出 research；其余人物的 research 给空对象。",
    "6. 只输出 JSON，不要解释，不要 Markdown 代码块。",
    "",
    "输出格式：",
    '{"skills":[{"name":"人物名","fields":{"怎么说话":"…","怎么判断":"…"},"research":{"人物小传":"…"}}]}',
  ].join("\n")
}

function describeTarget(target: PersonaSkillPromptTarget): string {
  const fields = target.tier === "major" ? PERSONA_MAJOR_FIELDS : PERSONA_MINOR_FIELDS
  const lines = [
    `### ${target.characterName}`,
    `- 定位：${target.roleType || "未标注"}`,
    `- 档位：${target.tier === "major" ? "主要人物" : "次要人物"}`,
    `- 累计出场：${target.appearanceCount} 次`,
    `- 本轮任务：${target.mode === "create" ? "生成新档案" : "在已有档案上补本章新增信息"}`,
    `- 需要填写的字段：${fields.join(" / ")}`,
  ]
  if (target.aliases.length > 0) lines.push(`- 别名：${target.aliases.join("、")}`)
  if (target.pinned) lines.push("- 这一位是用户手动标记的重要人物，字段要写得更细。")
  if (target.withResearch) lines.push(`- 需要研究文件：${PERSONA_RESEARCH_DOCUMENTS.join(" / ")}`)
  if (target.existingSkill?.trim()) {
    lines.push(
      "",
      "已有档案（在其之上补充，不要重写）：",
      "```markdown",
      buildPersonaSkillExisting(target.existingSkill),
      "```",
    )
  }
  return lines.join("\n")
}

export function buildPersonaSkillUserPrompt(input: PersonaSkillPromptInput): string {
  return [
    `【第 ${input.chapterNumber} 章正文】`,
    buildPersonaSkillBody(input.chapterBody),
    "",
    `【本章要处理的人物：${input.targets.length} 位】`,
    input.targets.map(describeTarget).join("\n\n"),
    "",
    "请按输出格式一次返回全部人物的 JSON。",
  ].join("\n")
}

export function buildPersonaSkillMessages(input: PersonaSkillPromptInput): ChatMessage[] {
  const reminder = buildLanguageReminder(getOutputLanguage())
  const system = reminder
    ? `${buildPersonaSkillSystemPrompt()}\n\n${reminder}`
    : buildPersonaSkillSystemPrompt()
  return [
    { role: "system", content: system },
    { role: "user", content: buildPersonaSkillUserPrompt(input) },
  ]
}

export function buildPersonaSkillResearchMessages(input: PersonaSkillResearchPromptInput): ChatMessage[] {
  const system = [
    "你在重新整理一份既有人物档案的研究文件。",
    "只能依据给出的档案内容整理，禁止引入档案里没有的新事实。",
    `研究文件清单固定为：${PERSONA_RESEARCH_DOCUMENTS.join(" / ")}`,
    "只输出 JSON，不要解释，不要 Markdown 代码块。",
    '输出格式：{"research":{"人物小传":"…","语言习惯":"…"}}',
  ].join("\n")
  const user = [
    `【人物】${input.characterName}`,
    `【定位】${input.roleType || "未标注"}`,
    "",
    "【已有档案】",
    input.document.trim(),
  ].join("\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}
