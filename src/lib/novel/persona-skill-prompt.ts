import { buildLanguageReminder, getOutputLanguage } from "@/lib/output-language"
import type { ChatMessage, RequestOverrides } from "@/lib/llm-providers"
import {
  PERSONA_FIELD_MAX_CHARS,
  PERSONA_PROFILE_FIELDS,
  PERSONA_STORED_FIELDS,
  PERSONA_RESEARCH_DOCUMENTS,
  PERSONA_SUPPLEMENT_MAX_CHARS,
  type PersonaSkillMode,
  type PersonaSkillTier,
} from "./persona-skill-types"
import { extractCharacterEvidence } from "./persona-skill-evidence"

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
  /** 档案被用户手改过：本章观察进唯一的「补充」段，既有正文不动。 */
  editedByUser?: boolean
  /** 建档时附上的此前出场章节素材。 */
  priorEvidence?: ReadonlyArray<{ chapterNumber: number; text: string }>
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

/**
 * ⚠️ 完善（refine）要的是**合并后的完整字段**，不是「本章增量」。
 * 落盘时字段按整格替换：以前这里写「只补本章新增的信息」「看不出来给空字符串」，
 * 模型照做后，每完善一次档案就退化成本章残片，本章没体现的字段直接消失。
 */
export function buildPersonaSkillSystemPrompt(): string {
  return [
    "你是长篇小说的人物档案编辑。用户会一次给你同一章里的多个人物；",
    "你要在一次回答里为每个人物产出一份「人物 Skill」。",
    "一份人物 Skill 由两部分组成：**档案**（他是谁）与**演技**（这一场该怎么演他）。",
    "",
    "硬性要求：",
    "1. 只写正文里能看出来、或能直接推断的东西，禁止编造。",
    "2. 「生成新档案」的人物：看不出来的字段给空字符串。",
    "3. 「完善已有档案」的人物：每个字段都输出**合并后的完整内容**——保留已有档案里仍然成立的观察，",
    "   融入本章的新信息，去掉重复，必要时压缩措辞。本章没有新信息的字段，把已有内容原样抄回，",
    "   绝不能给空字符串，也不能只写本章新增的那一句。",
    `4. 每个字段不超过 ${PERSONA_FIELD_MAX_CHARS} 字。字段名必须与「需要填写的字段」逐字一致。`,
    "   档案字段多数写一两句就够（16 个字段一次全写满会让整轮 JSON 过长、被截断）；",
    "   宁可短而具体，不要为了填满而空转。",
    "5. 档案字段写「他是谁」：性别、年龄、势力组织（门派 / 家族 / 阵营 / 所属机构，正文没提就空着）、",
    "   外貌（辨识点：身形、面容、衣着、随身物，不要形容词堆砌）、性格、背景（出身与关键经历）、",
    "   动机（他要什么、为什么）、能力（会什么、靠什么立足）、成长轨迹（已经发生的变化）、",
    "   备注（其它确凿、但没处安放的事实）。",
    "6. 「关系网」每行一个人，格式「对象：关系（性质）」，例如「陆云飞：竞争对手（权力斗争）」；",
    "   只写正文里真的出现过的关系，态度与利益冲突写进括注，不要只写「好友 / 敌人」两个标签。",
    "7. 「怎么说话」要整理到能照着写台词：口头禅、称呼习惯、句子长短与停顿、情绪上来时的变化、",
    "   绝不会说的词。不要写「他很聪明」这类评价。",
    "8. 标了「用户手改过」的人物：fields 只写本章的新观察；另外输出 supplement 字符串——",
    `   把已有档案里「补充」段的内容与本章新观察合并成一段完整的补充，不超过 ${PERSONA_SUPPLEMENT_MAX_CHARS} 字。`,
    "9. 只有标了「需要研究文件」的人物才额外产出 research；其余人物的 research 给空对象。",
    "10. 只输出 JSON，不要解释，不要 Markdown 代码块。",
    "",
    "输出格式：",
    '{"skills":[{"name":"人物名","fields":{"性别":"…","势力组织":"…","外貌":"…","关系网":"…","怎么说话":"…","怎么想":"…","怎么判断":"…","什么不做":"…","知道局限":"…"},"supplement":"…","research":{"人物小传":"…"}}]}',
  ].join("\n")
}

function isLongChapter(chapterBody: string): boolean {
  return chapterBody.trim().length > PERSONA_SKILL_BODY_HEAD_CHARS + PERSONA_SKILL_BODY_TAIL_CHARS
}

function describeTarget(target: PersonaSkillPromptTarget, input: PersonaSkillPromptInput): string {
  // 抽取字段一律给全，不按档位裁剪 —— 档位只管注入，不管学习。
  // 详见 persona-skill-types.ts 的 PERSONA_STORED_FIELDS 注释。
  // 「档案字段」与「演技字段」分两行写：前者进界面档案，后者进写作注入，
  // 合成一行会让模型以为它们同等重要，档案字段又被敷衍成标签。
  const lines = [
    `### ${target.characterName}`,
    `- 定位：${target.roleType || "未标注"}`,
    `- 档位：${target.tier === "major" ? "主要人物" : "次要人物"}`,
    `- 累计出场：${target.appearanceCount} 次`,
    `- 本轮任务：${target.mode === "create" ? "生成新档案" : "完善已有档案（输出合并后的完整字段）"}`,
    `- 需要填写的档案字段：${PERSONA_PROFILE_FIELDS.join(" / ")}`,
    `- 需要填写的演技字段：${PERSONA_STORED_FIELDS.join(" / ")}`,
  ]
  if (target.aliases.length > 0) lines.push(`- 别名：${target.aliases.join("、")}`)
  if (target.pinned) lines.push("- 这一位是用户手动标记的重要人物，字段要写得更细。")
  if (target.editedByUser) lines.push("- 用户手改过：既有正文不动，本章新观察并入 supplement。")
  if (target.withResearch) lines.push(`- 需要研究文件：${PERSONA_RESEARCH_DOCUMENTS.join(" / ")}`)
  if (isLongChapter(input.chapterBody)) {
    const evidence = extractCharacterEvidence(input.chapterBody, [target.characterName, ...target.aliases])
    if (evidence) lines.push("", `本章相关段落（第 ${input.chapterNumber} 章）：`, evidence)
  }
  for (const prior of target.priorEvidence ?? []) {
    if (!prior.text.trim()) continue
    lines.push("", `此前出场的相关段落（第 ${prior.chapterNumber} 章）：`, prior.text.trim())
  }
  if (target.existingSkill?.trim()) {
    lines.push(
      "",
      "已有档案（合并进你的输出，不要重写成只剩本章内容）：",
      "```markdown",
      buildPersonaSkillExisting(target.existingSkill),
      "```",
    )
  }
  return lines.join("\n")
}

/**
 * 章节较短时整章给出；较长时不再截「开头 + 结尾」（中段出场的人会一个字都拿不到），
 * 改为按人物给相关段落。正文里一次都没点名的人物，仍兜底给开头与结尾。
 */
function chapterBlock(input: PersonaSkillPromptInput): string[] {
  if (!isLongChapter(input.chapterBody)) {
    return [`【第 ${input.chapterNumber} 章正文】`, buildPersonaSkillBody(input.chapterBody)]
  }
  const unnamed = input.targets.some(
    (target) => !extractCharacterEvidence(input.chapterBody, [target.characterName, ...target.aliases]),
  )
  const header = `【第 ${input.chapterNumber} 章正文较长，各人物的相关段落附在人物条目下】`
  if (!unnamed) return [header]
  return [header, "", "【正文开头与结尾（供正文中未直接点名的人物参考）】", buildPersonaSkillBody(input.chapterBody)]
}

export function buildPersonaSkillUserPrompt(input: PersonaSkillPromptInput): string {
  return [
    ...chapterBlock(input),
    "",
    `【本章要处理的人物：${input.targets.length} 位】`,
    input.targets.map((target) => describeTarget(target, input)).join("\n\n"),
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
