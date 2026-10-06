import { stripOutlineDiscussMarkers } from "./outline-discuss-protocol"
import { stripOutlinePlanMarkers } from "./outline-plan-protocol"

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
  normalizationSource?: "canonical" | "legacy_status" | "legacy_unclosed" | "legacy_status_unclosed"
}

type IntentClarityParseOutcome =
  | { kind: "none" }
  | { kind: "valid"; result: IntentClarityResult }
  | { kind: "invalid"; error: string }

interface DirectOutlineGenerationRequest {
  module: string
}

const INTENT_OPEN_PATTERN = /<!--\s*intent_clarity\s*-->/i
const INTENT_CLOSE_PATTERN = /<!--\s*\/intent_clarity\s*-->/i
const OUTLINE_GENERATION_VERB_PATTERN = /生成|编写|完善|补充|细化|扩写|修改|重写|续写|改写|写一本|写一部|写一篇|写个|写本/
const OUTLINE_GENERATION_TARGETS: Array<{ pattern: RegExp; module: string }> = [
  { pattern: /(?:第?\s*\d+\s*章[^\n]{0,12}大纲)|章纲|章节细纲|章节大纲|细纲/, module: "章节细纲" },
  { pattern: /卷纲|分卷大纲/, module: "卷纲" },
  { pattern: /人物|角色/, module: "人物小传" },
  { pattern: /组织势力|势力设定/, module: "组织势力设定" },
  { pattern: /力量体系|能力体系/, module: "力量体系" },
  { pattern: /金手指|系统设定/, module: "金手指设定" },
  { pattern: /地理设定|地点设定|地图/, module: "地理设定" },
  { pattern: /背景设定|世界观/, module: "背景设定" },
  { pattern: /伏笔/, module: "伏笔计划" },
  { pattern: /大纲质量/, module: "大纲质量检查" },
  { pattern: /故事大纲|总纲|(?:^|[^章节卷])大纲/, module: "故事大纲" },
]

function extractCompleteJsonObject(text: string): { json: string; remainder: string } | null {
  const start = text.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
    } else if (character === "{") {
      depth += 1
    } else if (character === "}") {
      depth -= 1
      if (depth === 0) {
        return {
          json: text.slice(start, index + 1),
          remainder: text.slice(index + 1),
        }
      }
    }
  }
  return null
}

function inferModule(raw: Record<string, unknown>): string {
  const explicitModule = String(raw.module ?? "").trim()
  if (explicitModule) return explicitModule
  const legacyDescription = [raw.target, raw.scope, raw.intent]
    .map((value) => String(value ?? ""))
    .join(" ")
  return OUTLINE_GENERATION_TARGETS.find(({ pattern }) => pattern.test(legacyDescription))?.module ?? "大纲"
}

export function classifyDirectOutlineGenerationRequest(
  text: string,
): DirectOutlineGenerationRequest | null {
  if (!OUTLINE_GENERATION_VERB_PATTERN.test(text)) return null
  const target = OUTLINE_GENERATION_TARGETS.find(({ pattern }) => pattern.test(text))
  return target ? { module: target.module } : null
}

export function shouldAutoFollowUpGeneration(
  intentPhase: "intent_analysis" | "generation" | "waiting_user_input" | undefined,
): boolean {
  return intentPhase === "intent_analysis"
}

export function parseIntentClarity(text: string): IntentClarityResult | null {
  const outcome = parseIntentClarityProtocol(text)
  return outcome.kind === "valid" ? outcome.result : null
}

export function parseIntentClarityProtocol(text: string): IntentClarityParseOutcome {
  const openMatch = INTENT_OPEN_PATTERN.exec(text)
  if (!openMatch) return { kind: "none" }

  const payloadStart = openMatch.index + openMatch[0].length
  const afterOpen = text.slice(payloadStart)
  const closeMatch = INTENT_CLOSE_PATTERN.exec(afterOpen)
  const hasClosingMarker = Boolean(closeMatch)
  const unclosedPayload = hasClosingMarker ? null : extractCompleteJsonObject(afterOpen)
  const payloadText = hasClosingMarker
    ? afterOpen.slice(0, closeMatch!.index).trim()
    : unclosedPayload?.json
  if (!payloadText) {
    return { kind: "invalid", error: "意图分析 JSON 不完整或缺失" }
  }
  if (!hasClosingMarker && unclosedPayload?.remainder.trim()) {
    return { kind: "invalid", error: "意图分析缺少闭合标记且 JSON 后仍有额外内容" }
  }

  let payload: unknown
  try {
    payload = JSON.parse(payloadText)
  } catch {
    return { kind: "invalid", error: "意图分析 JSON 无法解析" }
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { kind: "invalid", error: "意图分析结果必须是 JSON 对象" }
  }

  const raw = payload as Record<string, unknown>
  const usedLegacyStatus = raw.clarity == null && raw.status != null
  const clarity = String(raw.clarity ?? raw.status ?? "")
  if (clarity !== "clear" && clarity !== "needs_input") {
    return { kind: "invalid", error: "意图分析缺少有效的 clarity 字段" }
  }

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

  const result: IntentClarityResult = {
    clarity,
    module: inferModule(raw),
    analysis: String(raw.analysis ?? raw.intent ?? ""),
    detectedScope: String(raw.detectedScope ?? raw.scope ?? raw.target ?? ""),
    missingItems: Array.isArray(raw.missingItems)
      ? raw.missingItems.filter((item): item is string => typeof item === "string")
      : [],
    options,
    question: String(raw.question ?? ""),
    normalizationSource: !hasClosingMarker && usedLegacyStatus
      ? "legacy_status_unclosed"
      : !hasClosingMarker
        ? "legacy_unclosed"
        : usedLegacyStatus
          ? "legacy_status"
          : "canonical",
  }
  return { kind: "valid", result }
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
    "## needs_input 时的 options 要求（最容易出错，必须照做）",
    "options 必须是**具体的、能直接执行的范围对象**，取自你刚刚读到的资料，而不是抽象的生成策略。",
    "- 例：卷纲模块缺第二至第十卷 → options 直接列出「第二卷 归墟寄魂」「第三卷 记忆深渊」……每个卷次一项。",
    "- 例：章节细纲缺第 1-35 章 → options 列出「第1-5章」「第6-10章」这类具体区间。",
    "- label 用用户一眼能选的具体对象名；description 用一句话说明现状与依据（读的是哪份资料、该对象现在是什么状态）。",
    "- 最多给 6 个，按推荐优先级排序。",
    "- 不要把候选塞进 missingItems 而把 options 留空：options 为空视为格式错误。",
    "- 不要把「自定义」放进 options，系统会自动在末尾追加。",
    "- 严禁输出「全部缺失项生成」「基于已有内容推断」「最近范围生成」这类抽象策略项。",
    "",
    "## 输出格式（必须严格遵守）",
    "<!-- intent_clarity -->",
    '{"clarity":"clear|needs_input","module":"模块名","analysis":"判断依据","detectedScope":"明确范围","missingItems":[],"options":[{"id":"A","label":"具体范围","description":"现状与依据"}],"question":""}',
    "<!-- /intent_clarity -->",
    "开闭标记必须成对出现；字段名必须使用 clarity，禁止使用 status。JSON 必须完整且可解析。",
    "",
    "clear 时：只输出上述 JSON，不生成正文。",
    "needs_input 时：只输出上述 JSON，question 问清楚要哪一个，options 列出具体候选。",
  ].join("\n")
}

export function buildIntentPhaseSystemRules(
  intentPhase: "intent_analysis" | "generation" | "waiting_user_input" | undefined,
): string {
  if (intentPhase === "intent_analysis") {
    return [
      "## 本轮阶段：意图分析",
      "本轮只判断生成范围，不生成大纲正文。最终输出必须包含且只包含一个完整协议块：",
      "<!-- intent_clarity -->",
      '{"clarity":"clear|needs_input","module":"模块名","analysis":"判断依据","detectedScope":"明确范围","missingItems":[],"options":[{"id":"A","label":"具体范围","description":"现状与依据"}],"question":""}',
      "<!-- /intent_clarity -->",
      "开闭标记必须成对出现；字段名必须使用 clarity，禁止使用 status。JSON 必须完整且可解析。",
      "needs_input 时 options 必须列出具体的候选范围（如具体卷次、具体章节区间），最多 6 个；",
      "options 为空视为格式错误；「自定义」由系统自动追加，不要自己输出。",
    ].join("\n")
  }
  if (intentPhase === "generation") {
    return [
      "## 本轮阶段：正文生成",
      "意图分析已经完成。直接生成可保存的大纲正文。",
      "禁止再次输出 intent_clarity 标记，禁止重新进入意图分析。",
    ].join("\n")
  }
  return ""
}

export function stripStructuredMarkers(text: string): string {
  return stripOutlineDiscussMarkers(stripOutlinePlanMarkers(text))
    // 1. 移除完整的标记对（现有逻辑）
    .replace(/<!--\s*intent_clarity\s*-->[\s\S]*?<!--\s*\/intent_clarity\s*-->/gi, "")
    .replace(/<!--\s*next_step\s*-->[\s\S]*?<!--\s*\/next_step\s*-->/gi, "")
    // 2. 移除不完整的 intent_clarity 开标签及其后所有内容
    //    （流式中间态：开标签已到达，闭标签未到达，后续是 JSON payload）
    .replace(/<!--\s*intent_clarity\s*-->[\s\S]*$/gi, "")
    // 3. 移除不完整的 next_step 开标签及其后所有内容
    .replace(/<!--\s*next_step\s*-->[\s\S]*$/gi, "")
    // 4. 清理可能残留的裸闭标签
    .replace(/<!--\s*\/intent_clarity\s*-->/gi, "")
    .replace(/<!--\s*\/next_step\s*-->/gi, "")
    // 5. 移除 AI 生成的 HTML 折叠块（<details>...</details>）及其内部内容
    .replace(/<details[\s\S]*?<\/details>/gi, "")
    .replace(/<details[^>]*>[\s\S]*$/gi, "")
    // 6. 移除其他 AI 常见的 HTML 块级标签对（<summary>...</summary> 等）
    .replace(/<\/?(?:details|summary|fieldset|legend|table|thead|tbody|tr|td|th|caption|colgroup|col)\b[^>]*>/gi, "")
    // 7. 移除 AI 常见的 HTML 行内标签（保留标签内的文本内容）
    .replace(/<\/?(?:b|strong|i|em|u|ins|del|s|mark|small|sub|sup|code|kbd|samp|var|abbr|cite|q|span|font|br|hr|wbr|div|p|section|article|header|footer|nav|aside|main|ul|ol|li|dl|dt|dd|h[1-6]|pre|blockquote|figure|figcaption)\b[^>]*>/gi, "")
    // 8. 清理多余空行
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
