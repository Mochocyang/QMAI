/**
 * 「舞台情景」主持人
 *
 * 主持人负责开场点题、串场引导、最后收束总结。主持人可以是：
 * - 用户本人（在设置面板中选择「由我担任主持人」），此时不产生主持人 LLM 调用，
 *   开场白直接取自用户填写的情景规则；
 * - 或者某个被指定为主持人的角色，此时由 LLM 以其身份生成开场/串场/收束台词。
 *
 * 本模块只负责提示词与上下文的构建，真正的调用在 scenario-engine.ts。
 */

import type {
  ScenarioMessage,
  ScenarioParticipant,
  ScenarioRules,
  ScenarioSetup,
} from "./scenario-types"
import { SCENARIO_MODERATOR_USER_ID } from "./scenario-types"

/** 判断主持人是否由用户本人担任（或未指定主持人）。 */
export function isUserModerator(setup: ScenarioSetup): boolean {
  const moderator = setup.participants.find((p) => p.isModerator)
  if (!moderator) return true
  return moderator.id === SCENARIO_MODERATOR_USER_ID
}

/** 取主持人参与者（可能为 null）。 */
export function getModerator(
  participants: ScenarioParticipant[],
): ScenarioParticipant | null {
  return participants.find((p) => p.isModerator) ?? null
}

/** 取上台发言的角色（不含主持人）。 */
export function getCharacters(
  participants: ScenarioParticipant[],
): ScenarioParticipant[] {
  return participants.filter((p) => !p.isModerator)
}

/** 将情景规则格式化为可读文本块。 */
export function formatScenarioRules(rules: ScenarioRules): string {
  const lines: string[] = []
  if (rules.directive) {
    lines.push(`主持人的要求：${rules.directive}`)
  }
  if (rules.scene) {
    lines.push(`情景设定：${rules.scene}`)
  }
  if (rules.location) {
    lines.push(`地点：${rules.location}`)
  }
  if (rules.time) {
    lines.push(`时间：${rules.time}`)
  }
  if (rules.reference) {
    lines.push(`参考点（必须以此为依据）：${rules.reference}`)
  }
  return lines.length > 0 ? lines.join("\n") : "（未指定）"
}

/** 将同台参与者格式化为名单。 */
export function formatParticipantRoster(
  participants: ScenarioParticipant[],
): string {
  const moderator = participants.find((p) => p.isModerator)
  const characters = participants.filter((p) => !p.isModerator)
  const lines: string[] = []
  if (moderator) {
    lines.push(
      `主持人：${moderator.name}${moderator.id === SCENARIO_MODERATOR_USER_ID ? "（由作者/用户担任）" : ""}`,
    )
  }
  for (const c of characters) {
    const soul = c.auraName ? `（灵魂：${c.auraName}）` : ""
    lines.push(`角色：${c.name}${soul}`)
  }
  return lines.join("\n")
}

/**
 * 构建所有角色与主持人都需要知道的公共情景上下文。
 * 包括：情景规则、同台名单、对话形式、世界规则（可选）。
 */
export function buildSceneContext(
  setup: ScenarioSetup,
  options: { worldRules?: string; formatHint: string } = {
    formatHint: "",
  },
): string {
  const sections: string[] = []
  sections.push("【舞台情景】")
  sections.push(`标题：${setup.title}`)
  sections.push(`对话形式：${setup.format}`)
  sections.push("")
  sections.push("【情景规则】")
  sections.push(formatScenarioRules(setup.rules))
  sections.push("")
  sections.push("【同台人员】")
  sections.push(formatParticipantRoster(setup.participants))
  if (options.formatHint) {
    sections.push("")
    sections.push("【发言要求】")
    sections.push(options.formatHint)
  }
  if (options.worldRules) {
    sections.push("")
    sections.push("【世界规则 / 背景设定】")
    sections.push(options.worldRules)
  }
  return sections.join("\n")
}

/** 将已有对话压缩为可读记录（取最近 limit 条）。 */
export function formatTranscript(
  messages: ScenarioMessage[],
  limit = 30,
): string {
  const recent = messages.slice(-limit)
  if (recent.length === 0) return "（对话尚未开始）"
  return recent
    .map((m) => {
      if (m.kind === "moderator") return `【主持人·${m.speakerName}】${m.content}`
      if (m.kind === "user") return `【作者】${m.content}`
      if (m.kind === "system") return `（${m.content}）`
      return `【${m.speakerName}】${m.content}`
    })
    .join("\n")
}

// ── 主持人提示词 ──

export function buildModeratorSystemPrompt(setup: ScenarioSetup): string {
  const moderator = getModerator(setup.participants)
  const name = moderator?.name ?? "主持人"
  const soulLine = moderator?.auraName
    ? `你参照的灵魂气质：${moderator.auraName}`
    : ""
  return [
    `你是《${setup.title}》这场舞台情景的主持人「${name}」。`,
    "你的职责是控制节奏、点题串场，而不是参与辩论本身。",
    "",
    "【职责】",
    "1. 开场：介绍场景、时间、话题或争议焦点，并说明规则。",
    "2. 串场：适时点题、把话题引向深入，或点名请某位角色发言。",
    "3. 收束：在讨论结束时，简洁地总结各方观点。",
    "",
    "【要求】",
    "- 语气自然、简洁有力，符合主持人的身份。",
    "- 不要代替角色发言，也不要替角色下结论。",
    "- 只输出台词纯文本，不要输出 JSON、markdown，不要加括号动作描写。",
    soulLine,
  ]
    .filter((line) => line !== "")
    .join("\n")
}

/** 主持人开场白的用户指令。 */
export function buildModeratorOpeningPrompt(
  setup: ScenarioSetup,
  worldRules?: string,
): string {
  const characters = getCharacters(setup.participants)
  return [
    buildSceneContext(setup, {
      formatHint: `请以主持人的身份为这场情景开场。交代背景与话题，然后邀请以下角色发言：${characters
        .map((c) => c.name)
        .join("、")}。`,
      worldRules,
    }),
    "",
    "请说出你的开场白。",
  ].join("\n")
}

/** 主持人串场（中途引导）的用户指令。 */
export function buildModeratorInterjectionPrompt(
  setup: ScenarioSetup,
  transcript: string,
  round: number,
  worldRules?: string,
): string {
  return [
    buildSceneContext(setup, {
      formatHint: `当前已进行到第 ${round} 轮。请用一两句话点题、追问或点名某人，把讨论引向深入。`,
      worldRules,
    }),
    "",
    "【已有对话】",
    transcript,
    "",
    "请说出你的串场话。",
  ].join("\n")
}

/** 主持人收束总结的用户指令。 */
export function buildModeratorClosingPrompt(
  setup: ScenarioSetup,
  transcript: string,
  worldRules?: string,
): string {
  return [
    buildSceneContext(setup, {
      formatHint: "讨论到此告一段落，请简洁收束，总结各方观点并点出余韵。",
      worldRules,
    }),
    "",
    "【完整对话】",
    transcript,
    "",
    "请说出你的结束语。",
  ].join("\n")
}
