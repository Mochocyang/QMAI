export type IntentClarity = "clear" | "needs_input"

export interface IntentClarityOption {
  id: string
  label: string
  description: string
}

export interface IntentClarityResult {
  clarity: IntentClarity
  module: string
  analysis: string
  detectedScope: string
  missingItems: string[]
  options: IntentClarityOption[]
  question: string
}

const CLARITY_PATTERN = /<!--\s*intent_clarity\s*-->([\s\S]*?)<!--\s*\/intent_clarity\s*-->/i

export function parseIntentClarity(text: string): IntentClarityResult | null {
  const match = text.match(CLARITY_PATTERN)
  if (!match) return null

  let payload: unknown
  try {
    payload = JSON.parse(match[1].trim())
  } catch {
    return null
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null

  const raw = payload as Record<string, unknown>
  const clarity = String(raw.clarity ?? "")
  if (clarity !== "clear" && clarity !== "needs_input") return null

  const options: IntentClarityOption[] = Array.isArray(raw.options)
    ? raw.options
        .filter((item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item))
        .map((item) => ({
          id: String(item.id ?? ""),
          label: String(item.label ?? ""),
          description: String(item.description ?? ""),
        }))
        .filter((item) => item.id && item.label)
    : []

  return {
    clarity,
    module: String(raw.module ?? ""),
    analysis: String(raw.analysis ?? ""),
    detectedScope: String(raw.detectedScope ?? ""),
    missingItems: Array.isArray(raw.missingItems)
      ? raw.missingItems.filter((item): item is string => typeof item === "string")
      : [],
    options,
    question: String(raw.question ?? ""),
  }
}

export function buildIntentAnalysisPrompt(title: string, requestHint: string): string {
  return [
    `请对以下请求进行意图分析：「生成${title}」`,
    "",
    "## 任务",
    "1. 调用 list_outlines、list_chapters、read_outline 读取已有资料",
    "2. 判断用户意图是否清晰（能否确定具体生成范围）",
    "",
    `## 本分项内容要求`,
    requestHint,
    "",
    "## 章节类模块判定规则",
    "- 检测已有章节列表，判断是否缺失细纲",
    "- 若能确定范围（如仅3章缺细纲）→ clear",
    "- 若大范围缺细纲或无章节信息 → needs_input",
    "",
    "## 非章节类模块判定规则",
    "- 读取已有设定/角色，判断当前卷范围",
    "- 列出已有项和缺失项",
    "- 若范围明确且缺失项清晰 → clear",
    "- 若卷范围不明确 → needs_input",
    "",
    "## needs_input 时的推荐选项策略",
    "必须提供4类选项：",
    "A. 全部缺失项生成（如「生成前面缺失的细纲」）",
    "B. 基于已有内容推断（如「根据已有章节内容分析后生成后续细纲」）",
    "C. 最近范围生成（如「生成最近5-10章的细纲」）",
    "D. 自定义（由用户描述要生成的内容范围或故事方向）",
    "",
    "## 输出格式（必须严格遵守）",
    "<!-- intent_clarity -->",
    '按 JSON 输出，字段：clarity("clear"|"needs_input")、module、analysis、detectedScope(clear时填写)、missingItems(数组)、options(needs_input时填4个选项，clear时为空数组)、question(needs_input时填写自然语言提问)',
    "<!-- /intent_clarity -->",
    "",
    "clear 时：只输出上述 JSON，不生成正文。",
    "needs_input 时：输出 JSON 后，用自然语言在会话中提出澄清问题 + 推荐选项。",
  ].join("\n")
}

export function stripStructuredMarkers(text: string): string {
  return text
    .replace(/<!--\s*intent_clarity\s*-->[\s\S]*?<!--\s*\/intent_clarity\s*-->/gi, "")
    .replace(/<!--\s*next_step\s*-->[\s\S]*?<!--\s*\/next_step\s*-->/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
