export const OUTLINE_DISCUSS_MARKER_OPEN = "<!-- outline_discuss -->"
export const OUTLINE_DISCUSS_MARKER_CLOSE = "<!-- /outline_discuss -->"
/** 自定义输入项固定 id，卡片据此渲染手动输入框。 */
export const OUTLINE_DISCUSS_CUSTOM_OPTION_ID = "CUSTOM"
export const OUTLINE_DISCUSS_CUSTOM_OPTION_LABEL = "其它（我来补充描述）"
/** 每个分歧必须提供的真实选项数量下限。创意分叉允许二元对立。 */
export const OUTLINE_DISCUSS_MIN_OPTIONS = 2
/** 单轮决策点上限，避免一次铺满整张卡片。 */
export const OUTLINE_DISCUSS_MAX_DECISIONS = 3

export type OutlineDiscussStatus = "needs_decision" | "ready"
/** 共创模式协议轮次；定稿后的执行腿复用既有 generation 阶段。 */
export type OutlineDiscussPhase = "decision"
/** 卡片已被使用过的标记，重载后据此置灰，防重复提交。 */
export type OutlineDiscussDecisionState = "confirmed" | "cancelled" | "answered"

export interface OutlineDiscussOption {
  id: string
  label: string
  description: string
}

export interface OutlineDiscussDecision {
  id: string
  question: string
  options: OutlineDiscussOption[]
  preferenceId: string
  preferenceReason: string
}

export interface OutlineDiscussAgreed {
  id: string
  question: string
  value: string
}

export interface OutlineDiscussProtocol {
  status: OutlineDiscussStatus
  module: string
  judgment: string
  nextStep: string
  decisions: OutlineDiscussDecision[]
  agreed: OutlineDiscussAgreed[]
}

export type OutlineDiscussParseOutcome =
  | { kind: "none" }
  | { kind: "valid"; protocol: OutlineDiscussProtocol }
  | { kind: "invalid"; error: string }

export type OutlineDiscussValidation =
  | { kind: "invalid"; error: string }
  | { kind: "ready"; protocol: OutlineDiscussProtocol }
  | { kind: "needs_decision"; protocol: OutlineDiscussProtocol }

export interface OutlineDiscussAnswer {
  id: string
  question: string
  value: string
}

const OPEN_PATTERN = /<!--\s*outline_discuss\s*-->/i
const CLOSE_PATTERN = /<!--\s*\/outline_discuss\s*-->/i
const FINALIZE_PATTERN = /定稿|就按这个写|按这个写|开始生成|可以了|开始写/

function extractLeadingJsonObject(text: string): { json: string; remainder: string } | null {
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
        return { json: text.slice(start, index + 1), remainder: text.slice(index + 1) }
      }
    }
  }
  return null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizeOptions(raw: unknown): OutlineDiscussOption[] {
  const options = Array.isArray(raw)
    ? raw
      .filter(isPlainObject)
      .map((item, index) => ({
        id: String(item.id ?? "").trim() || String.fromCharCode(65 + index),
        label: String(item.label ?? "").trim(),
        description: String(item.description ?? "").trim(),
      }))
      .filter((option) => option.label)
    : []
  const withoutCustom = options.filter(
    (option) => option.id.toUpperCase() !== OUTLINE_DISCUSS_CUSTOM_OPTION_ID,
  )
  const custom = options.find(
    (option) => option.id.toUpperCase() === OUTLINE_DISCUSS_CUSTOM_OPTION_ID,
  )
  return [
    ...withoutCustom,
    {
      id: OUTLINE_DISCUSS_CUSTOM_OPTION_ID,
      label: custom?.label || OUTLINE_DISCUSS_CUSTOM_OPTION_LABEL,
      description: custom?.description ?? "",
    },
  ]
}

function normalizeDecisions(raw: unknown): OutlineDiscussDecision[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isPlainObject)
    .map((item, index) => ({
      id: String(item.id ?? "").trim() || `d${index + 1}`,
      question: String(item.question ?? "").trim(),
      options: normalizeOptions(item.options),
      preferenceId: String(item.preferenceId ?? "").trim(),
      preferenceReason: String(item.preferenceReason ?? "").trim(),
    }))
    .filter((decision) => decision.question)
}

function normalizeAgreed(raw: unknown): OutlineDiscussAgreed[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isPlainObject)
    .map((item, index) => ({
      id: String(item.id ?? "").trim() || `a${index + 1}`,
      question: String(item.question ?? "").trim(),
      value: String(item.value ?? "").trim(),
    }))
    .filter((item) => item.question && item.value)
}

/**
 * 解析 outline_discuss 协议块。
 *
 * 与 outline_plan 对称：支持未闭合标记兜底（流式截断），
 * 并在解析阶段就把每个分歧补上自定义输入项。
 */
export function parseOutlineDiscussProtocol(text: string): OutlineDiscussParseOutcome {
  const openMatch = OPEN_PATTERN.exec(text)
  if (!openMatch) return { kind: "none" }

  const afterOpen = text.slice(openMatch.index + openMatch[0].length)
  const closeMatch = CLOSE_PATTERN.exec(afterOpen)
  const unclosedPayload = closeMatch ? null : extractLeadingJsonObject(afterOpen)
  const payloadText = closeMatch
    ? afterOpen.slice(0, closeMatch.index).trim()
    : unclosedPayload?.json
  if (!payloadText) {
    return { kind: "invalid", error: "共创协议 JSON 不完整或缺失" }
  }
  if (!closeMatch && unclosedPayload?.remainder.trim()) {
    return { kind: "invalid", error: "共创协议缺少闭合标记且 JSON 后仍有额外内容" }
  }

  let payload: unknown
  try {
    payload = JSON.parse(payloadText)
  } catch {
    return { kind: "invalid", error: "共创协议 JSON 无法解析" }
  }
  if (!isPlainObject(payload)) {
    return { kind: "invalid", error: "共创协议必须是 JSON 对象" }
  }

  const status = String(payload.status ?? "").trim()
  if (status !== "needs_decision" && status !== "ready") {
    return { kind: "invalid", error: "共创协议缺少有效的 status 字段" }
  }

  return {
    kind: "valid",
    protocol: {
      status,
      module: String(payload.module ?? "").trim() || "大纲",
      judgment: String(payload.judgment ?? "").trim(),
      nextStep: String(payload.nextStep ?? "").trim(),
      decisions: normalizeDecisions(payload.decisions),
      agreed: normalizeAgreed(payload.agreed),
    },
  }
}

function countRealOptions(decision: OutlineDiscussDecision): number {
  return decision.options.filter(
    (option) => option.id.toUpperCase() !== OUTLINE_DISCUSS_CUSTOM_OPTION_ID,
  ).length
}

function isRealOptionId(decision: OutlineDiscussDecision, optionId: string): boolean {
  const normalized = optionId.trim().toUpperCase()
  if (!normalized || normalized === OUTLINE_DISCUSS_CUSTOM_OPTION_ID) return false
  return decision.options.some((option) => option.id.toUpperCase() === normalized)
}

/**
 * 共创协议的代码闸门。
 *
 * 1. needs_decision 时必须有 1-3 个分歧，每问真实选项不少于 2 个，倾向必须落在真实选项上。
 * 2. ready 时必须有判断摘要；允许不再抛新分歧。
 */
export function validateOutlineDiscussProtocol(
  protocol: OutlineDiscussProtocol,
): OutlineDiscussValidation {
  if (protocol.status === "needs_decision") {
    if (protocol.decisions.length === 0) {
      return { kind: "invalid", error: "共创协议标记为需要拍板，但没有给出任何分歧点" }
    }
    if (protocol.decisions.length > OUTLINE_DISCUSS_MAX_DECISIONS) {
      return {
        kind: "invalid",
        error: `共创协议一次最多抛出 ${OUTLINE_DISCUSS_MAX_DECISIONS} 个分歧点`,
      }
    }
    const thin = protocol.decisions.find(
      (decision) => countRealOptions(decision) < OUTLINE_DISCUSS_MIN_OPTIONS,
    )
    if (thin) {
      return {
        kind: "invalid",
        error: `分歧「${thin.question}」的可选项少于 ${OUTLINE_DISCUSS_MIN_OPTIONS} 个，无法进入拍板`,
      }
    }
    const missingPreference = protocol.decisions.find(
      (decision) => !isRealOptionId(decision, decision.preferenceId),
    )
    if (missingPreference) {
      return {
        kind: "invalid",
        error: `分歧「${missingPreference.question}」没有标出有效的 AI 倾向`,
      }
    }
    return { kind: "needs_decision", protocol }
  }

  if (!protocol.judgment.trim()) {
    return { kind: "invalid", error: "共创协议标记为可以定稿，但缺少关键判断" }
  }
  return { kind: "ready", protocol }
}

/** 共创讨论轮的系统规则；替代计划模式的要素盘点段。 */
export function buildOutlineDiscussPhaseSystemRules(module: string): string {
  return [
    "## 本轮阶段：共创讨论",
    `本轮目标模块：${module || "大纲"}。本轮禁止生成完整大纲正文，禁止调用保存工具，禁止输出 intent_clarity 和 outline_plan。`,
    "1. 先调用 list_outlines、list_chapters、list_memories 确认可用资料，再用 read_outline、read_chapter 读取相关正文。",
    "2. 先用自然语言写出关键判断和下一步建议，再输出一个 outline_discuss 协议块。",
    "3. 还有需要作者拍板的创意分歧时，status 必须是 needs_decision，decisions 只放 1-3 个具体分歧。",
    `4. 每个分歧必须给出至少 ${OUTLINE_DISCUSS_MIN_OPTIONS} 个具体可选方案，并填写 preferenceId 和 preferenceReason；系统会自动追加自定义输入项。`,
    "5. 资料已经足够、没有新的拍板点时，status 才能是 ready，judgment 必须说明为什么可以开写。",
    "6. 已经拍板的内容写入 agreed，不要把同一分歧再问一遍。",
    "## 输出格式（必须严格遵守）",
    OUTLINE_DISCUSS_MARKER_OPEN,
    '{"status":"needs_decision|ready","module":"模块名","judgment":"关键判断","nextStep":"下一步建议","decisions":[{"id":"d1","question":"分歧点","options":[{"id":"A","label":"方案","description":"说明"}],"preferenceId":"A","preferenceReason":"倾向理由"}],"agreed":[{"id":"a1","question":"已拍板问题","value":"已确认方案"}]}',
    OUTLINE_DISCUSS_MARKER_CLOSE,
    "开闭标记必须成对出现，JSON 必须完整可解析。正文里只留判断和下一步，不要输出完整大纲，也不要把协议 JSON 再抄进正文。",
  ].join("\n")
}

function formatAgreed(agreed: OutlineDiscussAgreed[]): string[] {
  return agreed
    .filter((item) => item.question && item.value)
    .map((item) => `- ${item.question}：${item.value}`)
}

/** 用户点选分歧后的内部 user prompt；已拍板项随对话历史传递。 */
export function buildOutlineDiscussAnswerPrompt(input: {
  module: string
  answers: OutlineDiscussAnswer[]
  agreed: OutlineDiscussAgreed[]
}): string {
  const previous = formatAgreed(input.agreed)
  return [
    `我已对「${input.module}」的分歧拍板，请继续共创讨论。`,
    "",
    "## 本次拍板",
    ...input.answers.map((answer) => `- ${answer.question}：${answer.value}`),
    ...(previous.length ? ["", "## 之前已拍板", ...previous] : []),
    "",
    "请把本次拍板并入 agreed，重新判断是否还有需要我拍板的创意分歧。",
    "还有分歧就继续按 outline_discuss 协议抛决策点；没有新分歧就输出 status 为 ready，说明为什么可以定稿。",
  ].join("\n")
}

/** 用户确认定稿后的执行 prompt；执行腿复用既有 generation 阶段。 */
export function buildOutlineDiscussExecutionPrompt(input: {
  module: string
  judgment: string
  agreed: OutlineDiscussAgreed[]
}): string {
  const collected = formatAgreed(input.agreed)
  return [
    `共创讨论已经定稿，现在进入「${input.module}」的正文生成阶段。`,
    "请严格按下面已经拍板的判断和方案生成可保存的大纲正文，不要再抛分歧，不要再次等待确认。",
    `禁止再输出 ${OUTLINE_DISCUSS_MARKER_OPEN} 协议块。生成完成后按 AI 大纲输出协议在末尾附加 outlineSaveRequest 或 outlineSaveRequests JSON 块。`,
    ...(input.judgment.trim() ? ["", "## 已确认判断", input.judgment.trim()] : []),
    ...(collected.length ? ["", "## 已拍板方案", ...collected] : []),
  ].join("\n")
}

/** 短确认句视为定稿，走生成腿而不是再开一轮讨论。 */
export function isOutlineDiscussFinalizeRequest(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 40) return false
  return FINALIZE_PATTERN.test(trimmed)
}

export function findLatestOutlineDiscussProtocol(
  messages: Array<{ outlineDiscussProtocol?: OutlineDiscussProtocol | null }>,
): OutlineDiscussProtocol | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const protocol = messages[index]?.outlineDiscussProtocol
    if (protocol) return protocol
  }
  return null
}

/** 会话落盘后的形状校验，结构不完整的共创数据一律丢弃。 */
export function isOutlineDiscussProtocol(value: unknown): value is OutlineDiscussProtocol {
  if (!isPlainObject(value)) return false
  if (value.status !== "needs_decision" && value.status !== "ready") return false
  if (typeof value.module !== "string" || !value.module.trim()) return false
  if (typeof value.judgment !== "string") return false
  if (typeof value.nextStep !== "string") return false
  if (!Array.isArray(value.decisions) || !Array.isArray(value.agreed)) return false
  if (!value.decisions.every((decision) => (
    isPlainObject(decision)
    && typeof decision.question === "string"
    && Array.isArray(decision.options)
    && decision.options.every((option) => isPlainObject(option) && typeof option.label === "string")
  ))) {
    return false
  }
  if (!value.agreed.every((item) => (
    isPlainObject(item)
    && typeof item.question === "string"
    && typeof item.value === "string"
  ))) {
    return false
  }
  return true
}

/** 剥掉 outline_discuss 协议标记，与 stripStructuredMarkers 对 plan / intent 的处理对称。 */
export function stripOutlineDiscussMarkers(text: string): string {
  return text
    .replace(/<!--\s*outline_discuss\s*-->[\s\S]*?<!--\s*\/outline_discuss\s*-->/gi, "")
    .replace(/<!--\s*outline_discuss\s*-->[\s\S]*$/gi, "")
    .replace(/<!--\s*\/outline_discuss\s*-->/gi, "")
}
