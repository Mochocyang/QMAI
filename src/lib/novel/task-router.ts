/**
 * 主脑任务路由。
 *
 * 意图与置信度来自一次结构化模型分类。章号（第N章、中文数字、大于 10 的裸章号）
 * 仍由程序解析。开篇/黄金三章不再在这里用关键词抢判。
 */

import {
  classifyTaskIntent,
  type TaskIntentClassification as ModelTaskIntentClassification,
} from "./task-intent-classifier"
import type { LlmConfig } from "@/stores/wiki-store"

export type NovelTaskIntent =
  | "write_chapter"        // 写新章节
  | "continue_chapter"     // 续写章节
  | "rewrite_chapter"      // 改写章节
  | "polish_chapter"       // 润色章节
  | "review_chapter"       // 审稿
  | "lint_chapter"         // 连贯性检查
  | "generate_outline"     // 生成大纲
  | "search_plot"          // 剧情搜索
  | "extract_memory"       // 章节摄取
  | "character_query"      // 人物查询
  | "foreshadowing_query"  // 伏笔查询
  | "timeline_query"       // 时间线查询
  | "setting_query"        // 设定查询
  | "general_chat"         // 一般对话
  | "story_framework_generate"  // 故事框架生成
  | "multi_agent_simulate"      // 多智能体推演
  | "character_interview"       // 角色采访
  | "scenario_simulate"         // 舞台情景（人物对话模拟）

const MODIFY_INTENTS: Set<NovelTaskIntent> = new Set([
  "rewrite_chapter",
  "polish_chapter",
  "review_chapter",
  "lint_chapter",
])

/** 模型没给出可用分类时的置信度。低于 confidence_gate 默认阈值，且不再用 weight/16。 */
export const TASK_ROUTE_FALLBACK_CONFIDENCE = 0.2

export const NOVEL_TASK_INTENT_LABELS: Record<NovelTaskIntent, string> = {
  write_chapter: "章节生成",
  continue_chapter: "章节续写",
  rewrite_chapter: "章节改写",
  polish_chapter: "章节润色",
  review_chapter: "AI 审稿",
  lint_chapter: "连贯性检查",
  generate_outline: "大纲生成",
  search_plot: "剧情搜索",
  extract_memory: "章节摄取",
  character_query: "人物查询",
  foreshadowing_query: "伏笔查询",
  timeline_query: "时间线查询",
  setting_query: "设定查询",
  general_chat: "一般对话",
  story_framework_generate: "故事框架生成",
  multi_agent_simulate: "多智能体推演",
  character_interview: "角色采访",
  scenario_simulate: "舞台情景",
}

export function isNovelTaskIntent(value: string): value is NovelTaskIntent {
  return Object.prototype.hasOwnProperty.call(NOVEL_TASK_INTENT_LABELS, value)
}

function isModifyIntent(intent: NovelTaskIntent): boolean {
  return MODIFY_INTENTS.has(intent)
}

export interface TaskRouteResult {
  intent: NovelTaskIntent
  confidence: number
  chapterNumber?: number
  extractedParams: Record<string, unknown>
  modifyFamily?: boolean
}

export interface TaskIntentClassification {
  intent: NovelTaskIntent
  confidence: number
}

export type TaskIntentClassifier = (userInput: string) => Promise<TaskIntentClassification | null>

export interface RouteTaskOptions {
  /**
   * 已经有分类结果时跳过模型。传 null 表示分类失败，按低置信度闲聊降级。
   * 用于用户已选定的产品动作（例如共创里点了「写这一章」），避免再打一次模型。
   */
  classification?: TaskIntentClassification | null
  /** 测试或调用方注入的分类器。提供后不再走默认模型。 */
  classify?: TaskIntentClassifier
  llmConfig?: LlmConfig
  signal?: AbortSignal
}

/** 章号：阿拉伯数字或中文数字（与 parseChineseChapterNumber 字符集对齐） */
const CHAPTER_NUM_TOKEN = String.raw`(?:\d+|[一二三四五六七八九十百〇零两]+)`
// 无“第”格式仅接受大于 10 的阿拉伯数字，避免把“写 5 章”（数量）
// 误判为“写第 5 章”（序号）。11 及以上更符合省略“第”的章节号表达。
const BARE_CHAPTER_NUM_TOKEN = String.raw`(?:1[1-9]|[2-9]\d|[1-9]\d{2,})`

const CHAPTER_NUMBER_PATTERNS = [
  /第\s*(\d+)\s*章/,
  new RegExp(String.raw`第\s*(${CHAPTER_NUM_TOKEN})\s*章`),
  new RegExp(String.raw`(${BARE_CHAPTER_NUM_TOKEN})\s*章`),
  /chapter\s*(\d+)/i,
  /ch\.?\s*(\d+)/i,
]

export async function routeTask(userInput: string, options?: RouteTaskOptions): Promise<TaskRouteResult> {
  const trimmed = userInput.trim()
  const chapterNumber = trimmed ? extractChapterNumber(trimmed) : undefined
  const extractedParams: Record<string, string> = {}
  if (chapterNumber !== undefined) {
    extractedParams.chapterNumber = String(chapterNumber)
  }

  if (!trimmed) {
    return { intent: "general_chat", confidence: 1, extractedParams, modifyFamily: false }
  }

  const classification = await resolveClassification(trimmed, options)
  if (!classification) {
    return {
      intent: "general_chat",
      confidence: TASK_ROUTE_FALLBACK_CONFIDENCE,
      chapterNumber,
      extractedParams,
      modifyFamily: false,
    }
  }

  return {
    intent: classification.intent,
    confidence: classification.confidence,
    chapterNumber,
    extractedParams,
    modifyFamily: isModifyIntent(classification.intent),
  }
}

async function resolveClassification(
  trimmed: string,
  options?: RouteTaskOptions,
): Promise<TaskIntentClassification | null> {
  try {
    if (options?.classify) return acceptClassification(await options.classify(trimmed))
    if (options && Object.prototype.hasOwnProperty.call(options, "classification")) {
      return acceptClassification(options.classification ?? null)
    }
    return acceptClassification(await classifyTaskIntent({
      userInput: trimmed,
      llmConfig: options?.llmConfig,
      signal: options?.signal,
    }))
  } catch {
    return null
  }
}

function acceptClassification(
  value: TaskIntentClassification | ModelTaskIntentClassification | null,
): TaskIntentClassification | null {
  if (!value) return null
  const intent = value.intent.trim()
  if (!isNovelTaskIntent(intent)) return null
  if (!Number.isFinite(value.confidence)) return null
  return { intent, confidence: clamp01(value.confidence) }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function extractChapterNumber(text: string): number | undefined {
  // “下一章”类续写请求的目标章节由章节库/会话状态推算，
  // 文本中顺带提到的其他章节号（如“不要重复第一章内容”）只是引用。
  if (hasNextChapterContinuationWording(text)) return undefined

  for (const pattern of CHAPTER_NUMBER_PATTERNS) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const num = /^\d+$/.test(match[1])
      ? Number(match[1])
      : parseChineseChapterNumber(match[1])
    if (Number.isFinite(num) && num > 0) return num
  }
  return undefined
}

// “继续生成下一章”类请求：续写语义优先于文中顺带出现的章节号。
// 修复 issue #9：自定义下一章提示词中出现“开篇200字内必须制造钩子”
// 或“不要重复第一章”时，不把目标章节劫持为第 1 章。
const NEXT_CHAPTER_CONTINUATION_RE = /下一章|下1章|下章|新的?一章/

function hasNextChapterContinuationWording(text: string): boolean {
  return NEXT_CHAPTER_CONTINUATION_RE.test(text.replace(/\s+/g, ""))
}

function parseChineseChapterNumber(text: string): number {
  const normalized = text.replace(/两/g, "二").replace(/〇/g, "零")
  const digitMap: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }

  if (!/[十百]/.test(normalized)) {
    const digits = [...normalized].map((char) => digitMap[char])
    if (digits.some((digit) => digit === undefined)) return NaN
    return Number(digits.join(""))
  }

  let total = 0
  let current = 0
  for (const char of normalized) {
    if (char === "百") {
      total += (current || 1) * 100
      current = 0
    } else if (char === "十") {
      total += (current || 1) * 10
      current = 0
    } else if (digitMap[char] !== undefined) {
      current = digitMap[char]
    } else {
      return NaN
    }
  }
  return total + current
}

/**
 * 根据任务路由结果生成对 AI 的系统提示增强
 */
const CHAPTER_WRITING_INTENTS = new Set<NovelTaskIntent>([
  "write_chapter",
  "continue_chapter",
  "rewrite_chapter",
  "polish_chapter",
])

const LIBRARY_QUERY_BOUNDARY = "本库剧情、伏笔、人物和设定用本地工具回答，不要发到公网。web_search 只在你判断问题属于外部公开资料时使用，不要因为消息里有「搜索」「最新」「查一下」就联网。"

export function isChapterWritingIntent(intent?: string | null): boolean {
  return Boolean(intent && CHAPTER_WRITING_INTENTS.has(intent as NovelTaskIntent))
}

export function buildTaskDirective(route: TaskRouteResult): string {
  const directives: Record<NovelTaskIntent, string> = {
    write_chapter: "用户要求生成新章节。请根据上下文包中的大纲、人物状态和伏笔状态，生成完整的章节正文。注意保持人设一致，结尾留有钩子。",
    continue_chapter: "用户要求续写当前章节。请从上一段结尾处自然衔接，保持风格、节奏一致，不要重复已有内容。",
    rewrite_chapter: "用户要求改写章节内容。请根据用户的修改要求重写指定段落，保持整体连贯性。",
    polish_chapter: "用户要求润色章节。请在保持剧情不变的前提下，优化文笔、增强节奏感和画面感。",
    review_chapter: "用户要求审稿。请按照17项审稿维度逐一检查，输出结构化的审稿结果 JSON 数组。",
    lint_chapter: "用户要求连贯性检查。请检查人设、时间线、伏笔、角色认知等维度的一致性，输出结构化检查结果。",
    generate_outline: "用户要求生成大纲。请根据题材和规模生成结构化的大纲，包含分卷计划、人物设定、伏笔计划。",
    search_plot: `用户要求在本书内检索剧情。请用本地检索结果回答。${LIBRARY_QUERY_BOUNDARY}`,
    extract_memory: "用户要求提取章节记忆。请从章节正文中提取结构化信息（摘要、人物、事件、伏笔等）。",
    character_query: `用户在查询本书人物。请先用本地工具（load_context / read_memory 等）查人物状态与认知。${LIBRARY_QUERY_BOUNDARY}`,
    foreshadowing_query: `用户在查询本书伏笔。请列出当前伏笔及其状态（已埋设/推进中/已回收）。${LIBRARY_QUERY_BOUNDARY}`,
    timeline_query: `用户在查询本书时间线。请根据时间线数据回答当前时间进展。${LIBRARY_QUERY_BOUNDARY}`,
    setting_query: `用户在查询本书设定。请先用本地工具查正史设定与世界观。${LIBRARY_QUERY_BOUNDARY}`,
    general_chat: "",
    story_framework_generate: "用户要求生成故事框架。请跳转到剧情推演室进行框架生成。",
    multi_agent_simulate: "用户要求多智能体推演。请跳转到剧情推演室进行推演。",
    character_interview: "用户要求角色采访。请跳转到剧情推演室进行角色采访。",
    scenario_simulate: "用户要求舞台情景模拟。请跳转到剧情推演室的「舞台情景」配置角色与情景规则。",
  }

  const directive = directives[route.intent]
  if (!directive) return ""

  const lines = [
    "",
    "## 任务类型识别",
    `意图：${intentToLabel(route.intent)}（置信度 ${Math.round(route.confidence * 100)}%）`,
    `指令：${directive}`,
  ]

  if (
    CHAPTER_WRITING_INTENTS.has(route.intent) &&
    typeof route.chapterNumber === "number" &&
    route.chapterNumber > 0
  ) {
    lines.push(`本次写作目标：第 ${route.chapterNumber} 章。`)
    lines.push(
      "写正文前先 list_outlines（可传 chapterNumber），再按文件夹分流（优先；旧 type 仅兼容）并用 read_outline 读正文，确认对应该章的大纲后再写。",
    )
  }

  lines.push("")
  return lines.join("\n")
}

function intentToLabel(intent: NovelTaskIntent): string {
  return NOVEL_TASK_INTENT_LABELS[intent] || "未知"
}
