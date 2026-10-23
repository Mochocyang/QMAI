import {
  isPlainObject,
  scanMarkedJsonPayload,
  stripMarkedBlock,
  type MarkedJsonInvalidReason,
} from "./discuss-protocol-shared"

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

/** 标记解析与 JSON 提取的通用机械见 discuss-protocol-shared。 */
function outlineDiscussScanError(reason: MarkedJsonInvalidReason): string {
  switch (reason) {
    case "missing_payload":
      return "共创协议 JSON 不完整或缺失"
    case "unparseable":
      return "共创协议 JSON 无法解析"
    case "not_object":
      return "共创协议必须是 JSON 对象"
  }
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
  const scan = scanMarkedJsonPayload(text, OPEN_PATTERN, CLOSE_PATTERN)
  if (scan.kind === "none") return { kind: "none" }
  if (scan.kind === "invalid") return { kind: "invalid", error: outlineDiscussScanError(scan.reason) }

  const payload = scan.payload
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

/** 共创协议修复用的输出 token 上限：只要一个协议块，不需要长正文。 */
export const OUTLINE_DISCUSS_REPAIR_MAX_TOKENS = 1_600

/**
 * 是否值得为这段回复发起一次「补协议」修复。
 *
 * 模型偶发只写正文不写协议块（实测：直接吐了整卷大纲 + 写回清单），
 * 这时内容本身是有价值的判断，值得多花一次便宜的调用把它转成协议；
 * 但如果回复本来就是空的、或只有一句「好的」，重试也不会变出分歧点，
 * 就不该白花这次调用。
 */
export function hasOutlineDiscussRepairableContent(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 80) return false
  // 已经带了协议块就不用修（交给正常解析路径处理，让闸门报更准确的原因）。
  return !OPEN_PATTERN.test(trimmed)
}

/** 「补齐」轮的输出上限：只补可选项目/倾向，不重写整份讨论，沿用补协议的上限。 */
export const OUTLINE_DISCUSS_TOPUP_MAX_TOKENS = OUTLINE_DISCUSS_REPAIR_MAX_TOKENS

/**
 * 「补齐」轮提示词：协议**解析出来了但没通过闸门**（分歧没有可选项、可选项少于 2 个、
 * 倾向没落在真实选项上、一次抛出太多分歧、ready 却没有判断）时，只修这几处。
 *
 * 为什么值得单独一轮：这类失败是"内容不达标"，不是"没给格式"。重新跑一整轮共创
 * 会把前面已经确认过的拍板全部作废（用户口径：前面问了非常多的问题，后面一报错全丢）。
 */
export function buildOutlineDiscussTopUpMessages(input: {
  module: string
  error: string
  /** 已解析出的协议；JSON 坏掉时传 null，让模型据原始回复重建。 */
  protocol: OutlineDiscussProtocol | null
  content?: string
}): Array<{ role: "user"; content: string }> {
  const scope = input.module || "大纲"
  const payload = input.protocol
    ? JSON.stringify({
      status: input.protocol.status,
      module: input.protocol.module || scope,
      judgment: input.protocol.judgment,
      nextStep: input.protocol.nextStep,
      decisions: input.protocol.decisions,
      agreed: input.protocol.agreed,
    })
    : ""
  return [{
    role: "user",
    content: [
      `下面这份「${scope}」的 outline_discuss 协议没有通过完整性检查：${input.error}`,
      "请只修不合格的地方，凑齐要求后重新输出**完整**协议块。",
      "硬性要求：",
      "- 已有的分歧 id、问题、可选项、已拍板项原样保留，不要新增无关分歧，也不要重写已确认的结论。",
      "- 某个分歧的可选项少于 2 个：按它已经写到的思路补足到 2-3 个真实可选项（不要只补一个 CUSTOM）。",
      "- 倾向没有落在真实选项上：从该分歧已有的可选项里挑一个最合适的填进 preferenceId，并给一句理由。",
      "- 分歧太多：只保留最关键的 1-3 个，其余降级写进 agreed（问题 + 已确认方案）。",
      "- status=ready 却缺少判断：补一句为什么现在可以开写。",
      "- 只输出协议块本身（开标记、JSON、闭标记），不要复述原回复，不要写任何解释。",
      "协议格式（严格遵守）：",
      OUTLINE_DISCUSS_MARKER_OPEN,
      '{"status":"needs_decision|ready","module":"模块名","judgment":"关键判断","nextStep":"下一步建议","decisions":[{"id":"d1","question":"分歧点","options":[{"id":"A","label":"方案","description":"说明"}],"preferenceId":"A","preferenceReason":"倾向理由"}],"agreed":[{"id":"a1","question":"已拍板问题","value":"已确认方案"}]}',
      OUTLINE_DISCUSS_MARKER_CLOSE,
      "开闭标记必须成对出现，JSON 必须完整可解析。needs_decision 时 decisions 放 1-3 个分歧，每个至少 2 个真实可选项，并填 preferenceId 与 preferenceReason。",
      "",
      input.protocol ? "## 待修的协议" : "## 上一轮回复（协议块缺失或无法解析，请据此重建）",
      payload || (input.content ?? ""),
    ].join("\n"),
  }]
}

/**
 * 「补协议」修复轮的提示词。
 *
 * 关键约束：**只让模型输出协议块，不许复述、重写或补充正文**。修复结果只用于解析，
 * 气泡里仍显示原回复；要求复述正文会先耗尽 token 上限，协议块根本写不出来。
 */
export function buildOutlineDiscussRepairMessages(input: {
  content: string
  module: string
}): Array<{ role: "user"; content: string }> {
  return [{
    role: "user",
    content: [
      `下面是对「${input.module || "大纲"}」的一轮共创讨论回复，但它漏掉了 outline_discuss 协议块，系统无法据此生成待拍板卡片。`,
      "请只做一件事：读完这段回复，把它已经表达出的判断与分歧点，转写成要求的协议块。",
      "硬性要求：",
      "- 不要重写、扩写或继续生成大纲正文；只提炼回复里**已经出现**的判断与分歧。",
      "- 如果回复里确实没有可拍板的分歧，就用 status=ready，并在 judgment 里说明为什么可以开写。",
      "- 只输出协议块本身（开标记、JSON、闭标记），不要复述原回复，也不要附加任何说明。",
      "协议格式（严格遵守）：",
      OUTLINE_DISCUSS_MARKER_OPEN,
      '{"status":"needs_decision|ready","module":"模块名","judgment":"关键判断","nextStep":"下一步建议","decisions":[{"id":"d1","question":"分歧点","options":[{"id":"A","label":"方案","description":"说明"}],"preferenceId":"A","preferenceReason":"倾向理由"}],"agreed":[{"id":"a1","question":"已拍板问题","value":"已确认方案"}]}',
      OUTLINE_DISCUSS_MARKER_CLOSE,
      "开闭标记必须成对出现，JSON 必须完整可解析。needs_decision 时 decisions 放 1-3 个分歧，每个至少 2 个真实可选项，并填 preferenceId 与 preferenceReason。",
      "",
      "## 需要补协议的回复",
      input.content,
    ].join("\n"),
  }]
}

/** 修复轮用确定性采样：这是格式转写，不是创作。 */
export function buildOutlineDiscussRepairRequestOverrides(maxTokens = OUTLINE_DISCUSS_REPAIR_MAX_TOKENS): {
  temperature: number
  max_tokens: number
} {
  return { temperature: 0, max_tokens: maxTokens }
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
  return stripMarkedBlock(text, OPEN_PATTERN, CLOSE_PATTERN)
}
