/**
 * 章节「共创」协议。
 *
 * 与大纲「共创」（outline_discuss）刻意分开：大纲侧是多轮分歧拍板
 * （needs_decision，每问多个选项 + AI 倾向），章节侧是**一批方向候选单选**
 * （给出 3-4 个不同故事类型的方向，作者挑一个，不满意整批重来）。
 *
 * 共用的只是底层机械（见 discuss-protocol-shared）；本模块负责章节语义、
 * 代码闸门与提示词，且 `module` 一律参数化（章号/章标题），绝不硬编码「大纲」。
 */

import {
  isPlainObject,
  scanMarkedJsonPayload,
  stripMarkedBlock,
  type MarkedJsonInvalidReason,
} from "./discuss-protocol-shared"

export const CHAPTER_DISCUSS_MARKER_OPEN = "<!-- chapter_discuss -->"
export const CHAPTER_DISCUSS_MARKER_CLOSE = "<!-- /chapter_discuss -->"
/** 每批方向数量下限。 */
export const CHAPTER_DISCUSS_MIN_DIRECTIONS = 3
/** 每批方向数量上限，避免一次铺满整屏。 */
export const CHAPTER_DISCUSS_MAX_DIRECTIONS = 4
/** 每个方向「后续故事介绍」的字数下限（提示词要求约 300 字）。 */
export const CHAPTER_DISCUSS_MIN_SUMMARY_CHARS = 180
/** 补协议修复轮的输出上限：协议块里要放 3-4 个约 300 字的方向介绍。 */
export const CHAPTER_DISCUSS_REPAIR_MAX_TOKENS = 4_000

const OPEN_PATTERN = /<!--\s*chapter_discuss\s*-->/i
const CLOSE_PATTERN = /<!--\s*\/chapter_discuss\s*-->/i

export type ChapterDiscussStatus = "needs_choice" | "insufficient"
/** 共创模式的讨论轮次；选定方向后的执行腿复用既有章节生成阶段。 */
export type ChapterDiscussPhase = "decision"
/** 卡片已被使用过的标记，重载后据此置灰，防重复提交。 */
export type ChapterDiscussDecision = "selected" | "regenerated" | "custom"

export interface ChapterDiscussDirection {
  id: string
  /** 故事类型，如「复仇线」「悬念反转」「情感升温」。同批内必须互不重复。 */
  storyType: string
  title: string
  /** 约 300 字的后续故事介绍。 */
  summary: string
}

export interface ChapterDiscussProtocol {
  status: ChapterDiscussStatus
  /** 章号或章标题，用于卡片与提示词的文案。 */
  module: string
  /** 本轮推演的关键判断。 */
  judgment: string
  directions: ChapterDiscussDirection[]
  /** 整批推荐的方向 id（可空），卡片据此打「AI 推荐」徽标。 */
  preferenceId: string
  preferenceReason: string
}

export type ChapterDiscussParseOutcome =
  | { kind: "none" }
  | { kind: "valid"; protocol: ChapterDiscussProtocol }
  | { kind: "invalid"; error: string }

export type ChapterDiscussValidation =
  | { kind: "invalid"; error: string }
  | { kind: "needs_choice"; protocol: ChapterDiscussProtocol }
  | { kind: "insufficient"; protocol: ChapterDiscussProtocol }

function chapterDiscussScanError(reason: MarkedJsonInvalidReason): string {
  switch (reason) {
    case "missing_payload":
      return "章节共创协议 JSON 不完整或缺失"
    case "unparseable":
      return "章节共创协议 JSON 无法解析"
    case "not_object":
      return "章节共创协议必须是 JSON 对象"
  }
}

function normalizeDirections(raw: unknown): ChapterDiscussDirection[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isPlainObject)
    .map((item, index) => ({
      id: String(item.id ?? "").trim() || `d${index + 1}`,
      storyType: String(item.storyType ?? "").trim(),
      title: String(item.title ?? "").trim(),
      summary: String(item.summary ?? "").trim(),
    }))
    .filter((direction) => direction.title || direction.summary || direction.storyType)
}

/**
 * 解析 chapter_discuss 协议块。
 *
 * 与大纲协议对称：支持未闭合标记兜底（流式截断），解析失败原因映射成章节文案。
 */
export function parseChapterDiscussProtocol(text: string): ChapterDiscussParseOutcome {
  const scan = scanMarkedJsonPayload(text, OPEN_PATTERN, CLOSE_PATTERN)
  if (scan.kind === "none") return { kind: "none" }
  if (scan.kind === "invalid") {
    return { kind: "invalid", error: chapterDiscussScanError(scan.reason) }
  }

  const payload = scan.payload
  const status = String(payload.status ?? "").trim()
  if (status !== "needs_choice" && status !== "insufficient") {
    return { kind: "invalid", error: "章节共创协议缺少有效的 status 字段" }
  }

  return {
    kind: "valid",
    protocol: {
      status,
      module: String(payload.module ?? "").trim(),
      judgment: String(payload.judgment ?? "").trim(),
      directions: normalizeDirections(payload.directions),
      preferenceId: String(payload.preferenceId ?? "").trim(),
      preferenceReason: String(payload.preferenceReason ?? "").trim(),
    },
  }
}

/**
 * 章节共创协议的代码闸门。
 *
 * 1. needs_choice：必须给出 3-4 个方向；每个方向要有故事类型与标题；
 *    同批故事类型不得重复；每个方向的介绍不得过短；AI 推荐必须落在真实方向上。
 * 2. insufficient：前文不足以推演时允许，但必须给出原因且不给方向。
 */
export function validateChapterDiscussProtocol(
  protocol: ChapterDiscussProtocol,
): ChapterDiscussValidation {
  if (protocol.status === "insufficient") {
    if (protocol.directions.length > 0) {
      return { kind: "invalid", error: "章节共创协议声称资料不足，却仍给出了方向" }
    }
    if (!protocol.judgment.trim()) {
      return { kind: "invalid", error: "章节共创协议声称资料不足，但没有说明原因" }
    }
    return { kind: "insufficient", protocol }
  }

  const count = protocol.directions.length
  if (count < CHAPTER_DISCUSS_MIN_DIRECTIONS || count > CHAPTER_DISCUSS_MAX_DIRECTIONS) {
    return {
      kind: "invalid",
      error: `章节共创必须给出 ${CHAPTER_DISCUSS_MIN_DIRECTIONS}-${CHAPTER_DISCUSS_MAX_DIRECTIONS} 个方向，当前 ${count} 个`,
    }
  }

  const missing = protocol.directions.find((direction) => !direction.storyType || !direction.title)
  if (missing) {
    return {
      kind: "invalid",
      error: `方向「${missing.title || missing.id}」缺少故事类型或标题`,
    }
  }

  const seen = new Set<string>()
  for (const direction of protocol.directions) {
    const key = direction.storyType.trim().toLowerCase()
    if (seen.has(key)) {
      return { kind: "invalid", error: `方向的故事类型重复：${direction.storyType}` }
    }
    seen.add(key)
  }

  const thin = protocol.directions.find(
    (direction) => direction.summary.length < CHAPTER_DISCUSS_MIN_SUMMARY_CHARS,
  )
  if (thin) {
    return {
      kind: "invalid",
      error: `方向「${thin.title}」的后续介绍过短（不足 ${CHAPTER_DISCUSS_MIN_SUMMARY_CHARS} 字）`,
    }
  }

  if (protocol.preferenceId && !protocol.directions.some((d) => d.id === protocol.preferenceId)) {
    return { kind: "invalid", error: "章节共创协议的 AI 推荐没有指向任何方向" }
  }

  return { kind: "needs_choice", protocol }
}

/** 共创讨论轮的系统规则；由章节会话的 system prompt 拼接。 */
export function buildChapterDiscussPhaseSystemRules(module: string): string {
  const scope = module || "本章"
  return [
    "## 本轮阶段：章节共创（方向推演）",
    `本轮目标：${scope}。本轮只做方向推演，禁止输出章节正文，禁止调用 run_chapter_workflow，禁止输出可直接入库的正文草稿。`,
    "1. 先读取前文：用 read_chapter、read_outline、read_memory、list_chapters 等只读工具确认已有剧情、人物与伏笔。",
    "2. 依据已写内容与「起承转合」式的功能故事框架，判断后续应当如何发展，用自然语言先写出关键判断。",
    `3. 给出 ${CHAPTER_DISCUSS_MIN_DIRECTIONS}-${CHAPTER_DISCUSS_MAX_DIRECTIONS} 个走向不同的方向。每个方向必须带一个**互不重复**的故事类型（如「复仇线」「悬念反转」「情感升温」「势力升级」），并附约 300 字的后续故事介绍。`,
    "4. 最后输出一个 chapter_discuss 协议块承载这些方向；正文里只留关键判断，不要把方向内容再抄一遍。",
    "5. 如果前文信息确实不足以推演，用 status=insufficient 并在 judgment 里说明缺少什么。",
    "## 输出格式（必须严格遵守）",
    CHAPTER_DISCUSS_MARKER_OPEN,
    `{"status":"needs_choice|insufficient","module":"${scope}","judgment":"关键判断","directions":[{"id":"d1","storyType":"故事类型","title":"方向标题","summary":"约300字的后续故事介绍"}],"preferenceId":"d1","preferenceReason":"推荐理由（可空）"}`,
    CHAPTER_DISCUSS_MARKER_CLOSE,
    "开闭标记必须成对出现，JSON 必须完整可解析。",
  ].join("\n")
}

/**
 * 是否值得为这段回复发起一次「补协议」修复。
 *
 * 模型偶发只写正文不写协议块，这时内容本身是有价值的推演，值得多花一次便宜的
 * 调用把它转成协议；但如果回复本来就空、或只有一句客套，重试也变不出方向。
 */
export function hasChapterDiscussRepairableContent(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 80) return false
  return !OPEN_PATTERN.test(trimmed)
}

/** 「补协议」修复轮的提示词：只输出协议块，不复述、不重写正文（修复结果只用于解析）。 */
export function buildChapterDiscussRepairMessages(input: {
  content: string
  module: string
}): Array<{ role: "user"; content: string }> {
  return [{
    role: "user",
    content: [
      `下面是对「${input.module || "本章"}」的一轮章节共创回复，但它漏掉了 chapter_discuss 协议块，系统无法据此生成方向卡片。`,
      "请只做一件事：读完这段回复，把它已经表达出的判断与方向，转写成要求的协议块。",
      "硬性要求：",
      "- 不要重写、扩写或继续生成正文；只提炼回复里**已经出现**的判断与方向。",
      "- 如果回复里确实没有可推演的方向，就用 status=insufficient，并在 judgment 里说明原因。",
      "- 只输出协议块本身（开标记、JSON、闭标记），不要复述原回复，也不要附加任何说明。",
      "协议格式（严格遵守）：",
      CHAPTER_DISCUSS_MARKER_OPEN,
      `{"status":"needs_choice|insufficient","module":"${input.module || "本章"}","judgment":"关键判断","directions":[{"id":"d1","storyType":"故事类型","title":"方向标题","summary":"约300字的后续故事介绍"}],"preferenceId":"d1","preferenceReason":"推荐理由（可空）"}`,
      CHAPTER_DISCUSS_MARKER_CLOSE,
      `开闭标记必须成对出现，JSON 必须完整可解析。needs_choice 时给出 ${CHAPTER_DISCUSS_MIN_DIRECTIONS}-${CHAPTER_DISCUSS_MAX_DIRECTIONS} 个方向，每个都要有互不重复的故事类型、标题与不少于 ${CHAPTER_DISCUSS_MIN_SUMMARY_CHARS} 字的介绍。`,
      "",
      "## 需要补协议的回复",
      input.content,
    ].join("\n"),
  }]
}

/** 选定方向后进入正文生成的 prompt；以写作动语起手，确保命中写作意图路由。 */
export function buildChapterDiscussExecutionPrompt(input: {
  module: string
  direction: ChapterDiscussDirection
}): string {
  const scope = input.module || "本章"
  return [
    `我已经选定方向，请续写「${scope}」的正文，开始写这一章。`,
    "把下面选定的方向当作本章的写作计划执行，不要再抛方向、不要再等待确认。",
    "",
    `## 选定方向：${input.direction.title}（${input.direction.storyType}）`,
    input.direction.summary,
    "",
    "直接撰写本章正文，结构完整，与已有前文自然衔接。",
  ].join("\n")
}

/** 选定方向转成章节计划 blueprint，作为写作任务书的权威依据。 */
export function buildChapterDiscussPlanBlueprint(direction: ChapterDiscussDirection): string {
  return [
    `故事类型：${direction.storyType}`,
    `方向：${direction.title}`,
    direction.summary,
  ].join("\n")
}

/** 「换一批」提示词：带上上一批方向，要求给出故事类型完全不同的新方向。 */
export function buildChapterDiscussRegeneratePrompt(input: {
  module: string
  previous: Array<{ storyType: string; title: string }>
}): string {
  const scope = input.module || "本章"
  const listed = input.previous.length
    ? [
        "",
        "## 上一批已给过的方向（本次不要重复这些故事类型）",
        ...input.previous.map((item, index) => `${index + 1}. ${item.storyType}｜${item.title}`),
      ]
    : []
  return [
    `上一批方向我都不太满意，请为「${scope}」重新推演一批全新的方向。`,
    ...listed,
    "",
    `请给出 ${CHAPTER_DISCUSS_MIN_DIRECTIONS}-${CHAPTER_DISCUSS_MAX_DIRECTIONS} 个与上一批**故事类型完全不同**、彼此也不重复的新方向，每个仍附约 300 字的后续故事介绍，并按 chapter_discuss 协议输出。`,
  ].join("\n")
}

/** 「其他想法」提示词：把作者自己的想法带进去，重新推演一批方向。 */
export function buildChapterDiscussCustomPrompt(input: {
  module: string
  idea: string
}): string {
  const scope = input.module || "本章"
  return [
    `关于「${scope}」，我自己有一个想法：`,
    input.idea.trim(),
    "",
    `请结合前文与这个想法，重新推演后续走向，并按 chapter_discuss 协议给出新的方向。`,
    `要求：给出 ${CHAPTER_DISCUSS_MIN_DIRECTIONS}-${CHAPTER_DISCUSS_MAX_DIRECTIONS} 个方向，每个方向带互不重复的故事类型与约 300 字的后续故事介绍；如果你的判断认为我的想法与前文设定冲突或信息不足，请在 judgment 里直接说明，不要为了迎合我而硬凑。`,
  ].join("\n")
}

export function findLatestChapterDiscussProtocol(
  messages: Array<{ chapterDiscussProtocol?: ChapterDiscussProtocol | null }>,
): ChapterDiscussProtocol | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const protocol = messages[index]?.chapterDiscussProtocol
    if (protocol) return protocol
  }
  return null
}

/** 会话落盘后的形状校验，结构不完整的共创数据一律丢弃。 */
export function isChapterDiscussProtocol(value: unknown): value is ChapterDiscussProtocol {
  if (!isPlainObject(value)) return false
  if (value.status !== "needs_choice" && value.status !== "insufficient") return false
  if (typeof value.module !== "string") return false
  if (typeof value.judgment !== "string") return false
  if (typeof value.preferenceId !== "string") return false
  if (typeof value.preferenceReason !== "string") return false
  if (!Array.isArray(value.directions)) return false
  return value.directions.every((direction) => (
    isPlainObject(direction)
    && typeof direction.id === "string"
    && typeof direction.storyType === "string"
    && typeof direction.title === "string"
    && typeof direction.summary === "string"
  ))
}

/** 剥掉 chapter_discuss 协议标记。 */
export function stripChapterDiscussMarkers(text: string): string {
  return stripMarkedBlock(text, OPEN_PATTERN, CLOSE_PATTERN)
}
