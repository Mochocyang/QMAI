import type { ChatMessage } from "@/lib/llm-client"
import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type { StoryNode, TimelineEvent, DirectorScore, DirectorEvaluation } from "./types"

export interface DirectorEvaluateInput {
  node: StoryNode
  nodeTimelineEvents: TimelineEvent[]
  worldRules: string
  llmConfig: LlmConfig
  signal?: AbortSignal
}

export function shouldInjectEvent(eval_: DirectorEvaluation): boolean {
  return eval_.shouldInjectEvent && !!eval_.injectEvent
}

const DEFAULT_SCORES: DirectorScore = {
  tension: 3,
  pace: 3,
  characterUtilization: 3,
  characterArc: 3,
  infoDensity: 3,
  emotionalResonance: 3,
  logicConsistency: 3,
}

const DEFAULT_EVALUATION: DirectorEvaluation = {
  scores: { ...DEFAULT_SCORES },
  totalScore: 3.0,
  highlights: [],
  issues: [],
  suggestion: "",
  shouldInjectEvent: false,
}

function extractJson(text: string): string | null {
  const trimmed = text.trim()

  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {
    // 继续
  }

  const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
  if (codeBlockMatch) {
    const candidate = codeBlockMatch[1].trim()
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // 继续
    }
  }

  const objMatch = /\{[\s\S]*\}/.exec(trimmed)
  if (objMatch) {
    const candidate = objMatch[0]
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // 继续
    }
  }

  return null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function buildSystemPrompt(): string {
  return [
    "你是一位资深的小说导演，负责评估故事节点的质量并提供改进建议。",
    "",
    "【你的任务】",
    "评估刚刚完成的故事节点，从以下 7 个维度给出评价（每个维度 1-5 分）：",
    "1. tension（张力）：1=平淡无奇，3=有一定起伏，5=高潮迭起扣人心弦",
    "2. pace（节奏）：1=过慢拖沓，3=适中，5=过快急促",
    "3. characterUtilization（角色利用率）：1=大部分角色没出场或没用，3=主要角色有发挥，5=所有角色都充分发挥了作用",
    "4. characterArc（人物弧光）：1=角色毫无成长变化，3=有一定转变，5=角色成长变化鲜明动人",
    "5. infoDensity（信息密度）：1=内容空洞信息量极低，3=信息量适中，5=信息饱满干货多",
    "6. emotionalResonance（情感共鸣）：1=完全没有感染力，3=有一定情感触动，5=强烈共情令人动容",
    "7. logicConsistency（逻辑自洽）：1=bug 百出逻辑混乱，3=基本自洽，5=严丝合缝无懈可击",
    "",
    "其他评价内容：",
    "- highlights（亮点）：2-3 条，简要列出本节点的精彩之处",
    "- issues（问题）：1-2 条，简要列出本节点的主要问题",
    "- suggestion（建议）：一句话总结综合改进建议",
    "- shouldInjectEvent（是否注入事件）：布尔值，只有当整体评分较低（totalScore < 3）时才考虑设为 true",
    "- injectEvent（注入事件）：可选，如果 shouldInjectEvent 为 true，请构思一个能提升剧情质量的突发事件，注入到下一个节点开头",
    "",
    "【输出格式】",
    "你必须输出一个严格的JSON对象，不要输出任何其他文字，不要使用markdown代码块：",
    "{",
    '  "scores": {',
    '    "tension": 1到5的整数,',
    '    "pace": 1到5的整数,',
    '    "characterUtilization": 1到5的整数,',
    '    "characterArc": 1到5的整数,',
    '    "infoDensity": 1到5的整数,',
    '    "emotionalResonance": 1到5的整数,',
    '    "logicConsistency": 1到5的整数',
    "  },",
    '  "totalScore": 7项的算术平均值（可选，未提供则由系统计算）,',
    '  "highlights": ["亮点1", "亮点2"],',
    '  "issues": ["问题1"],',
    '  "suggestion": "综合改进建议文本",',
    '  "shouldInjectEvent": true 或 false,',
    '  "injectEvent": "可选，下一个节点的注入事件文本，shouldInjectEvent 为 false 时不要此字段"',
    "}",
    "",
    "【注意】",
    "- 只有当 totalScore < 3 时，才将 shouldInjectEvent 设为 true 并提供 injectEvent 字段",
    "- injectEvent 应该是一个具体的、能打破当前局面的突发事件",
    "- 评估要客观、专业，基于节点内实际发生的事件",
    "",
    "只输出JSON对象，不要输出任何其他文字。",
  ].join("\n")
}

function buildUserMessage(
  node: StoryNode,
  nodeTimelineEvents: TimelineEvent[],
  worldRules: string,
): string {
  const eventsText = nodeTimelineEvents
    .map((e) => `[${e.round}] ${e.actorName}(${e.actionType}): ${e.content}`)
    .join("\n")

  return [
    "【世界观规则】",
    worldRules,
    "",
    "【节点信息】",
    `节点标题：${node.title}`,
    `节点阶段：${node.phase}`,
    `节点目标：${node.goal}`,
    `核心冲突：${node.coreConflict}`,
    `涉及角色：${node.involvedCharacters.join("、")}`,
    `预期结果：${node.expectedOutcome || "无"}`,
    "",
    "【节点内发生的事件】",
    eventsText || "（无事件）",
    "",
    "请根据以上信息，以导演视角评估这个节点的质量，并输出JSON。",
  ].join("\n")
}

function parseScore(raw: unknown, defaultValue: number = 3): number {
  const num = typeof raw === "number" ? raw : defaultValue
  return Math.round(clamp(num, 1, 5))
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function calcTotalScore(scores: DirectorScore): number {
  const sum =
    scores.tension +
    scores.pace +
    scores.characterUtilization +
    scores.characterArc +
    scores.infoDensity +
    scores.emotionalResonance +
    scores.logicConsistency
  return sum / 7
}

export async function directorEvaluate(
  input: DirectorEvaluateInput,
): Promise<DirectorEvaluation> {
  const { node, nodeTimelineEvents, worldRules, llmConfig, signal } = input

  try {
    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: buildUserMessage(node, nodeTimelineEvents, worldRules),
      },
    ]

    let result = ""
    let streamError: Error | null = null

    await streamChat(
      llmConfig,
      messages,
      {
        onToken: (token) => {
          result += token
        },
        onDone: () => {},
        onError: (err) => {
          streamError = err
        },
      },
      signal,
    )

    if (streamError) throw streamError
    if (signal?.aborted) return { ...DEFAULT_EVALUATION, scores: { ...DEFAULT_SCORES } }

    const jsonText = extractJson(result)
    if (!jsonText) {
      return { ...DEFAULT_EVALUATION, scores: { ...DEFAULT_SCORES } }
    }

    const data = JSON.parse(jsonText) as Record<string, unknown>

    const scoresRaw =
      typeof data.scores === "object" && data.scores !== null
        ? (data.scores as Record<string, unknown>)
        : {}

    const scores: DirectorScore = {
      tension: parseScore(scoresRaw.tension),
      pace: parseScore(scoresRaw.pace),
      characterUtilization: parseScore(scoresRaw.characterUtilization),
      characterArc: parseScore(scoresRaw.characterArc),
      infoDensity: parseScore(scoresRaw.infoDensity),
      emotionalResonance: parseScore(scoresRaw.emotionalResonance),
      logicConsistency: parseScore(scoresRaw.logicConsistency),
    }

    const totalScoreRaw =
      typeof data.totalScore === "number" ? data.totalScore : calcTotalScore(scores)
    const totalScore = clamp(totalScoreRaw, 1, 5)

    const highlights = parseStringArray(data.highlights)
    const issues = parseStringArray(data.issues)

    const suggestion = String(data.suggestion ?? "").trim()

    const shouldInjectEvent = data.shouldInjectEvent === true

    const injectEvent =
      data.injectEvent !== undefined && data.injectEvent !== null && data.injectEvent !== ""
        ? String(data.injectEvent).trim()
        : undefined

    return {
      scores,
      totalScore,
      highlights,
      issues,
      suggestion,
      shouldInjectEvent,
      injectEvent,
    }
  } catch {
    return { ...DEFAULT_EVALUATION, scores: { ...DEFAULT_SCORES } }
  }
}
