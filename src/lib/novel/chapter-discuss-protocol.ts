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
/** 每个方向「后续故事介绍」的字数下限（提示词要求约 200-300 字大白话）。 */
export const CHAPTER_DISCUSS_MIN_SUMMARY_CHARS = 180
/** 补协议修复轮的输出上限：协议块里要放 3-4 个约 200-300 字的方向介绍。 */
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
  /**
   * 约 200-300 字的后续故事介绍。
   *
   * 必须是**大白话**：只讲剧情怎么走，不写修辞、不写主题升华、不自造名词
   * （约束见 CHAPTER_DISCUSS_PLAIN_LANGUAGE_RULES）。
   */
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

/**
 * 「方向介绍要用大白话写」的硬约束。
 *
 * 为什么单列成常量：主规则（buildChapterDiscussPhaseSystemRules）与「补协议」修复轮
 * （buildChapterDiscussRepairMessages）都要用它。修复轮是拿一段已经跑偏的回复重新提炼
 * 方向——如果只在主规则里要求大白话，补出来的那一批又会变回 AI 腔。用户 2026-10-13
 * 实测踩到的正是这个：方向介绍里全是「外勤部配锁」「编号派实战杀器」「战时编号器测试
 * 母片」这类**前文根本没出现过**的生造名词，标题还写成「雷霆碎锁」「符契对撞」这样的
 * 四字对仗。
 *
 * 用户原话：「用最通俗的大白话……完全可以定义为用初中生或者小学生的回答方式，
 * 只要表现出故事是怎么发展的，让用户知道接下来的故事是怎么走的就行了」。
 * 所以这里钉的是三条**可执行**的约束（语言水平、只写剧情、禁自造名词/对仗标题），
 * 而不是一句「不要 AI 腔」——那种话模型听得懂却落不到笔下。
 */
export const CHAPTER_DISCUSS_PLAIN_LANGUAGE_RULES = [
  "## 方向介绍怎么写（硬性要求，比用词漂亮更重要）",
  "方向介绍是给作者看「故事接下来怎么走」的，不是文学创作。把它当成跟朋友复述剧情：用最普通的大白话，按先后顺序把事讲完就行。",
  "- 语言水平按「初中生读一遍就懂」来写：短句、日常词、直接说事；不要修辞、比喻、排比、抒情和升华。",
  "- 只写剧情本身：谁做了什么、遇到什么、结果怎么样、这一章停在什么地方。不要写主题升华、不要评论人物、不要解释写作手法。",
  "- **禁止自造名词**：不要生造组织、职务、装备、代号、编号（「第X部」「编号派」「战时XX器」「母片」「密令」这类一律不要）。前文已经出现过的专有名词可以照用；没出现过的，就用最普通的说法（武器、命令、陷阱、地图），不要为了显得高级去造词。",
  "- 标题禁止四字对仗和文言腔：「雷霆碎锁」「符契对撞」「并肩破茧」这种不要。方向标题就用一句大白话说清这条路怎么走，例如「藏起来，然后反杀回收队」。",
  "- 介绍大致长这样：「主角先躲起来，等那队人进到废车场，再突然动手反杀；打不过的时候，他用上从异世界带回来的能力解决掉对方，然后动身去莲城。」——把事按顺序说清楚就行，不要写成「雷霆碎锁」「符契对撞」那种一眼是 AI 的句子。",
  "- 不要为了凑字数注水：不要用没信息量的漂亮话填满；把这条走向讲完整、讲清楚即可。",
]

/** 共创讨论轮的系统规则；由章节会话的 system prompt 拼接。 */
export function buildChapterDiscussPhaseSystemRules(module: string): string {
  const scope = module || "本章"
  return [
    "## 本轮阶段：章节共创（方向推演）",
    `本轮目标：${scope}。本轮只做方向推演，禁止输出章节正文，禁止调用 run_chapter_workflow，禁止输出可直接入库的正文草稿。`,
    "1. 先读取前文：用 read_chapter、read_outline、read_memory、list_chapters 等只读工具确认已有剧情、人物与伏笔。",
    "2. 依据已写内容与「起承转合」式的功能故事框架，判断后续应当如何发展，先用大白话写出关键判断（不要术语、不要自造名词）。",
    `3. 给出 ${CHAPTER_DISCUSS_MIN_DIRECTIONS}-${CHAPTER_DISCUSS_MAX_DIRECTIONS} 个走向不同的方向。每个方向必须带一个**互不重复**的故事类型（如「复仇线」「悬念反转」「情感升温」「势力升级」），并附约 200-300 字的后续故事介绍。`,
    "4. 最后输出一个 chapter_discuss 协议块承载这些方向；正文里只留关键判断，不要把方向内容再抄一遍。",
    "5. 如果前文信息确实不足以推演，用 status=insufficient 并在 judgment 里说明缺少什么。",
    ...CHAPTER_DISCUSS_PLAIN_LANGUAGE_RULES,
    "## 输出格式（必须严格遵守）",
    CHAPTER_DISCUSS_MARKER_OPEN,
    `{"status":"needs_choice|insufficient","module":"${scope}","judgment":"关键判断","directions":[{"id":"d1","storyType":"故事类型","title":"方向标题","summary":"约200-300字的大白话后续故事介绍"}],"preferenceId":"d1","preferenceReason":"推荐理由（可空）"}`,
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

/**
 * 「补齐」轮的输出上限：只补短介绍/缺字段，不该重写整批方向，
 * 但各方向加起来仍可能接近修复轮的体量，沿用修复轮的上限。
 */
export const CHAPTER_DISCUSS_TOPUP_MAX_TOKENS = CHAPTER_DISCUSS_REPAIR_MAX_TOKENS

/**
 * 「补齐」轮提示词：协议**解析出来了但没通过闸门**（介绍太短、缺故事类型/标题、
 * 故事类型重复、方向数量不对、AI 推荐指向不存在方向）时，让模型只修这几处。
 *
 * 为什么必须单独一轮：这类失败是"内容不够"，不是"格式没给"。重新生成整批会把
 * 用户在上一轮已经看到的方向全部换掉，而用户真正需要的只是把那条短的介绍补到 180 字。
 * 所以这里要求 id / 标题 / 故事类型原样保留，只补不足。
 */
export function buildChapterDiscussTopUpMessages(input: {
  module: string
  /** 校验失败原因（来自 validateChapterDiscussProtocol）。 */
  error: string
  /** 已解析出的协议；完全没解析出来（JSON 坏了）时传 null。 */
  protocol: ChapterDiscussProtocol | null
  /** 原始回复，protocol 为 null 时用它重建。 */
  content?: string
}): Array<{ role: "user"; content: string }> {
  const scope = input.module || "本章"
  const payload = input.protocol
    ? JSON.stringify({
      status: input.protocol.status,
      module: input.protocol.module || scope,
      judgment: input.protocol.judgment,
      directions: input.protocol.directions,
      preferenceId: input.protocol.preferenceId,
      preferenceReason: input.protocol.preferenceReason,
    })
    : ""
  return [{
    role: "user",
    content: [
      `下面这份「${scope}」的 chapter_discuss 协议没有通过完整性检查：${input.error}`,
      "请只修不合格的地方，凑齐要求后重新输出**完整**协议块。",
      "硬性要求：",
      "- 已经存在的方向 id、标题、故事类型原样保留，不要新增、删除或替换方向（除下面说的数量不足）。",
      "- 介绍太短的方向：把它扩写到 200-300 字，只补剧情信息（谁做了什么、遇到什么、结果怎样、停在哪里），不要注水、不要修辞。",
      "- 缺故事类型或标题的方向：按它已经写出的事情补一个普通说法即可。",
      "- 故事类型重复：把后面那个换成它实际写的另一类走法。",
      "- 方向数量不足：按已写的判断补足到 3-4 个；数量超标：只保留最靠前的几个，其余合并进保留方向的介绍里。",
      "- AI 推荐必须指向真实存在的方向 id；实在选不出就留空字符串。",
      "- 只输出协议块本身（开标记、JSON、闭标记），不要复述原回复，不要写任何解释。",
      ...CHAPTER_DISCUSS_PLAIN_LANGUAGE_RULES,
      "协议格式（严格遵守）：",
      CHAPTER_DISCUSS_MARKER_OPEN,
      `{"status":"needs_choice","module":"${scope}","judgment":"关键判断","directions":[{"id":"d1","storyType":"故事类型","title":"方向标题","summary":"约200-300字的大白话后续故事介绍"}],"preferenceId":"d1","preferenceReason":"推荐理由（可空）"}`,
      CHAPTER_DISCUSS_MARKER_CLOSE,
      `开闭标记必须成对出现，JSON 必须完整可解析；每个方向的介绍不少于 ${CHAPTER_DISCUSS_MIN_SUMMARY_CHARS} 字。`,
      "",
      input.protocol ? "## 待修的协议" : "## 上一轮回复（协议块缺失或无法解析，请据此重建）",
      payload || (input.content ?? ""),
    ].join("\n"),
  }]
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
      "- 方向介绍与标题一律用大白话重写：把原文里自造的术语、代号、编号和四字对仗标题改成人话（前文已有的专有名词可保留）。",
      "协议格式（严格遵守）：",
      CHAPTER_DISCUSS_MARKER_OPEN,
      `{"status":"needs_choice|insufficient","module":"${input.module || "本章"}","judgment":"关键判断","directions":[{"id":"d1","storyType":"故事类型","title":"方向标题","summary":"约200-300字的大白话后续故事介绍"}],"preferenceId":"d1","preferenceReason":"推荐理由（可空）"}`,
      CHAPTER_DISCUSS_MARKER_CLOSE,
      `开闭标记必须成对出现，JSON 必须完整可解析。needs_choice 时给出 ${CHAPTER_DISCUSS_MIN_DIRECTIONS}-${CHAPTER_DISCUSS_MAX_DIRECTIONS} 个方向，每个都要有互不重复的故事类型、标题与不少于 ${CHAPTER_DISCUSS_MIN_SUMMARY_CHARS} 字的介绍。`,
      ...CHAPTER_DISCUSS_PLAIN_LANGUAGE_RULES,
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
    `请给出 ${CHAPTER_DISCUSS_MIN_DIRECTIONS}-${CHAPTER_DISCUSS_MAX_DIRECTIONS} 个与上一批**故事类型完全不同**、彼此也不重复的新方向，每个仍附约 200-300 字的大白话后续故事介绍，并按 chapter_discuss 协议输出。`,
    "介绍和标题照旧用大白话写：只讲故事怎么发展，不要自造名词，也不要四字对仗的标题。",
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
    `要求：给出 ${CHAPTER_DISCUSS_MIN_DIRECTIONS}-${CHAPTER_DISCUSS_MAX_DIRECTIONS} 个方向，每个方向带互不重复的故事类型与约 200-300 字的大白话后续故事介绍；介绍和标题只讲故事怎么发展，不要自造名词，也不要四字对仗的标题；如果你的判断认为我的想法与前文设定冲突或信息不足，请在 judgment 里直接说明，不要为了迎合我而硬凑。`,
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
