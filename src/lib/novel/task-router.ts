/**
 * 主脑任务路由模块
 * 自动识别用户输入意图，将写作请求路由到对应能力
 */

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

export interface TaskRouteResult {
  intent: NovelTaskIntent
  confidence: number
  chapterNumber?: number
  extractedParams: Record<string, string>
}

interface IntentPattern {
  intent: NovelTaskIntent
  patterns: RegExp[]
  keywords: string[]
  weight: number
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: "write_chapter",
    patterns: [
      /^(写|生成|创作|撰写)\s*(第\s*\d+\s*章|新章节|下一章)/,
      /^(开始|帮我)(写|创作|生成)\s*(第\s*\d+\s*章|章节)/,
      /生成\s*(第\s*\d+\s*章|新的?一?章)/,
      /写\s*第\s*\d+\s*章/,
      /(根据|按照).*(第\s*[\d一二三四五六七八九十百〇零两]+\s*章).*(章纲|大纲|细纲).*(生成|写|创作|撰写).*(正文|章节)?/,
      /(根据|按照).*(章纲|大纲|细纲).*(生成|写|创作|撰写).*(正文|章节)/,
    ],
    keywords: ["写章节", "生成章节", "创作章节", "新章节", "写第", "章纲生成正文"],
    weight: 10,
  },
  {
    intent: "continue_chapter",
    patterns: [
      /^(继续|续写|接着写|往下写)/,
      /(继续|续)(写|创作)\s*(第\s*\d+\s*章|当前|这一?章|下去)/,
      /继续\s*(生成|写|创作|撰写)\s*(第\s*[\d一二三四五六七八九十百〇零两]+\s*章|下一章|当前|这一?章|正文|章节)?/,
      /接着(写|往下)/,
    ],
    keywords: ["续写", "继续写", "继续生成", "接着写", "往下写", "继续创作"],
    weight: 12,
  },
  {
    intent: "rewrite_chapter",
    patterns: [
      /^(改写|重写|重新写)\s*(第\s*\d+\s*章|这一段|这段|这一?章)/,
      /(改写|重写|重新)(写|创作)\s*(第\s*\d+\s*章|这)/,
      /把.+(改|重写|换一种写法)/,
    ],
    keywords: ["改写", "重写", "重新写", "换一种写法"],
    weight: 9,
  },
  {
    intent: "polish_chapter",
    patterns: [
      /^(润色|优化|美化|修饰|精修)/,
      /(润色|优化|精修)\s*(一下|这段|这一?章|第\s*\d+\s*章)/,
      /让.+(更|节奏更紧|文笔更好|更流畅)/,
      /帮我.+(润色|优化)/,
    ],
    keywords: ["润色", "优化", "精修", "修饰", "更流畅", "文笔"],
    weight: 9,
  },
  {
    intent: "review_chapter",
    patterns: [
      /^(审稿|审阅|检查|审核)\s*(第\s*\d+\s*章|这一?章|当前)/,
      /(帮我|请)(审稿|审阅|检查)/,
      /有没有.*(人设崩坏|矛盾|问题|错误)/,
      /检查.*(人设|时间线|伏笔|连贯)/,
    ],
    keywords: ["审稿", "审阅", "人设崩坏", "矛盾检查"],
    weight: 9,
  },
  {
    intent: "lint_chapter",
    patterns: [
      /^(连贯性检查|崩坏检查|一致性检查)/,
      /(检查|查看).*(连贯|一致|崩坏|时间线错误|地点错误)/,
      /有没有.*(时间线|地点|能力体系).*(错误|问题|矛盾)/,
    ],
    keywords: ["连贯性检查", "崩坏检查", "时间线错误", "一致性"],
    weight: 8,
  },
  {
    intent: "generate_outline",
    patterns: [
      /^(生成|创建|写)\s*(大纲|总大纲|分卷大纲|细纲)/,
      /(生成|帮我写|创建)\s*(第?\s*\d*\s*卷?\s*大纲|细纲)/,
      /(大纲|细纲)\s*(生成|创建)/,
    ],
    keywords: ["生成大纲", "创建大纲", "写大纲", "细纲", "分卷大纲"],
    weight: 9,
  },
  {
    intent: "search_plot",
    patterns: [
      /^(搜索|查找|找|查)\s*(剧情|情节|伏笔|人物|事件)/,
      /(找|搜|查).*(之前|前面|历史|出现过|提到过)/,
      /哪一?章.*(提到|出现|发生)/,
    ],
    keywords: ["搜索", "查找", "找一下", "哪章提到", "什么时候出现"],
    weight: 7,
  },
  {
    intent: "extract_memory",
    patterns: [
      /^(提取|摄取|生成快照|章节摄取)/,
      /(提取|摄取|生成)\s*(记忆|快照|章节信息)/,
      /重新(提取|生成)\s*(快照|记忆)/,
    ],
    keywords: ["提取记忆", "生成快照", "章节摄取", "重新提取"],
    weight: 8,
  },
  {
    intent: "character_query",
    patterns: [
      /^(.{1,6})(现在|目前|当前)\s*(在哪|状态|怎么样|情况)/,
      /(谁|哪些人物)\s*(出场|出现|在场)/,
      /(.{1,6})(知道|不知道|了解|认识)\s*(什么|谁|哪些)/,
    ],
    keywords: ["人物状态", "在哪里", "知道什么", "不知道什么", "出场人物"],
    weight: 7,
  },
  {
    intent: "foreshadowing_query",
    patterns: [
      /^(伏笔|还有哪些伏笔|未回收的伏笔)/,
      /(还没|未)(回收|解决|揭示)的?(伏笔|悬念|线索)/,
      /伏笔.*(状态|进度|回收)/,
    ],
    keywords: ["伏笔", "未回收", "悬念", "线索", "回收进度"],
    weight: 8,
  },
  {
    intent: "timeline_query",
    patterns: [
      /^(时间线|当前时间|现在是什么时候)/,
      /(时间线|时间)\s*(是|到了|进展到)/,
      /现在(是|到了)\s*(什么时候|哪一天|第几天)/,
    ],
    keywords: ["时间线", "什么时候", "第几天", "时间进展"],
    weight: 7,
  },
  {
    intent: "setting_query",
    patterns: [
      /^(设定|世界观|规则|正史)/,
      /(什么|哪些)\s*(设定|规则|正史)/,
      /(.{1,8})的?(设定|属性|能力|特点)/,
    ],
    keywords: ["设定", "世界观", "正史", "规则", "能力体系"],
    weight: 6,
  },
]

const CHAPTER_NUMBER_PATTERNS = [
  /第\s*(\d+)\s*章/,
  /第\s*([一二三四五六七八九十百〇零两]+)\s*章/,
  /chapter\s*(\d+)/i,
  /ch\.?\s*(\d+)/i,
]

export function routeTask(userInput: string): TaskRouteResult {
  const trimmed = userInput.trim()
  if (!trimmed) {
    return { intent: "general_chat", confidence: 1, extractedParams: {} }
  }

  if (isOpeningChapterRequest(trimmed)) {
    const chapterNumber = extractOpeningChapterNumber(trimmed)
    const extractedParams: Record<string, string> = {}
    if (chapterNumber !== undefined) {
      extractedParams.chapterNumber = String(chapterNumber)
    }
    return {
      intent: "write_chapter",
      confidence: 1,
      chapterNumber,
      extractedParams,
    }
  }

  const scores: { intent: NovelTaskIntent; score: number }[] = []

  for (const intentDef of INTENT_PATTERNS) {
    let score = 0

    // 正则匹配
    for (const pattern of intentDef.patterns) {
      if (pattern.test(trimmed)) {
        score += intentDef.weight
        break
      }
    }

    // 关键词匹配
    for (const keyword of intentDef.keywords) {
      if (trimmed.includes(keyword)) {
        score += intentDef.weight * 0.6
        break
      }
    }

    if (score > 0) {
      scores.push({ intent: intentDef.intent, score })
    }
  }

  // 提取章节号
  const chapterNumber = extractChapterNumber(trimmed)
  const extractedParams: Record<string, string> = {}
  if (chapterNumber !== undefined) {
    extractedParams.chapterNumber = String(chapterNumber)
  }

  if (scores.length === 0) {
    return { intent: "general_chat", confidence: 0.5, extractedParams }
  }

  scores.sort((a, b) => b.score - a.score)
  const best = scores[0]
  const maxPossible = 16 // weight(10) + keyword(6)
  const confidence = Math.min(best.score / maxPossible, 1)

  return {
    intent: best.intent,
    confidence,
    chapterNumber,
    extractedParams,
  }
}

function extractChapterNumber(text: string): number | undefined {
  // “下一章”类续写请求的目标章节由章节库/会话状态推算，
  // 文本中顺带提到的其他章节号（如“不要重复第一章内容”）只是引用。
  if (hasNextChapterContinuationWording(text)) return undefined

  const openingChapterNumber = extractOpeningChapterNumber(text)
  if (openingChapterNumber !== undefined) return openingChapterNumber

  for (const pattern of CHAPTER_NUMBER_PATTERNS) {
    const match = text.match(pattern)
    if (match) {
      const num = /^\d+$/.test(match[1])
        ? Number(match[1])
        : parseChineseChapterNumber(match[1])
      if (Number.isFinite(num) && num > 0) return num
    }
  }
  return undefined
}

// “继续生成下一章”类请求：续写语义优先于开篇关键词。
// 修复 issue #9：自定义下一章提示词中出现“开篇200字内必须制造钩子”
// 之类的写作要求时，“开篇/第一章”字样不应把目标章节劫持为第1章。
const NEXT_CHAPTER_CONTINUATION_RE = /下一章|下1章|下章|新的?一章/

function hasNextChapterContinuationWording(text: string): boolean {
  return NEXT_CHAPTER_CONTINUATION_RE.test(text.replace(/\s+/g, ""))
}

// 全文出现明确的“第N章”（N>3）时，说明用户的目标章节并非开篇章节，
// 文本里顺带提到的“开篇/第一章”只是写作要求或剧情引用。
function hasExplicitLaterChapterNumber(text: string): boolean {
  const compact = text.replace(/\s+/g, "")
  const explicit = compact.match(/第(\d+)章/)
  return Boolean(explicit?.[1] && Number(explicit[1]) > 3)
}

// “开篇/开局/首章/开头”这类弱关键词：仅当紧跟写作动词，或请求本身
// 就是一句很短的开篇指令时，才视为“写开篇章节”。避免长提示词里的
// “开篇200字内必须制造钩子”这类局部写作要求被误判。
function isAmbientOpeningKeywordRequest(text: string): boolean {
  const compact = text.replace(/\s+/g, "")
  if (/(写|生成|创作|撰写|开始)(一?个)?(小说)?(开篇|开局|首章|开头)/.test(compact)) return true
  return compact.length <= 12 && /开篇|开局|首章|小说开头/.test(compact)
}

function isOpeningChapterRequest(text: string): boolean {
  if (hasNextChapterContinuationWording(text)) return false
  if (hasExplicitLaterChapterNumber(text)) return false
  if ([
    /生成前三章/,
    /写前三章/,
    /黄金三章/,
    /第一章/,
    /第\s*1\s*章/,
    /开篇章节/,
    /小说开头/,
    /(生成|写|创作|撰写)\s*(第二章|第\s*2\s*章|第\s*二\s*章)/,
    /(生成|写|创作|撰写)\s*(第三章|第\s*3\s*章|第\s*三\s*章)/,
  ].some((pattern) => pattern.test(text))) {
    return true
  }
  return isAmbientOpeningKeywordRequest(text)
}

function extractOpeningChapterNumber(text: string): number | undefined {
  if (hasNextChapterContinuationWording(text)) return undefined
  if (hasExplicitLaterChapterNumber(text)) return undefined
  const digitMatch = text.match(/第\s*([123])\s*章/)
  if (digitMatch) return Number(digitMatch[1])
  if (/首章|第一章|第\s*1\s*章|开篇章节|小说开头|生成前三章|写前三章|黄金三章/.test(text)) {
    return 1
  }
  if (/第二章|第\s*二\s*章/.test(text)) return 2
  if (/第三章|第\s*三\s*章/.test(text)) return 3
  if (isAmbientOpeningKeywordRequest(text)) return 1
  return undefined
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
export function buildTaskDirective(route: TaskRouteResult): string {
  const directives: Record<NovelTaskIntent, string> = {
    write_chapter: "用户要求生成新章节。请根据上下文包中的大纲、人物状态和伏笔状态，生成完整的章节正文。注意保持人设一致，结尾留有钩子。",
    continue_chapter: "用户要求续写当前章节。请从上一段结尾处自然衔接，保持风格、节奏一致，不要重复已有内容。",
    rewrite_chapter: "用户要求改写章节内容。请根据用户的修改要求重写指定段落，保持整体连贯性。",
    polish_chapter: "用户要求润色章节。请在保持剧情不变的前提下，优化文笔、增强节奏感和画面感。",
    review_chapter: "用户要求审稿。请按照17项审稿维度逐一检查，输出结构化的审稿结果 JSON 数组。",
    lint_chapter: "用户要求连贯性检查。请检查人设、时间线、伏笔、角色认知等维度的一致性，输出结构化检查结果。",
    generate_outline: "用户要求生成大纲。请根据题材和规模生成结构化的大纲，包含分卷计划、人物设定、伏笔计划。",
    search_plot: "用户要求搜索剧情。请根据检索结果回答用户关于剧情内容的问题。",
    extract_memory: "用户要求提取章节记忆。请从章节正文中提取结构化信息（摘要、人物、事件、伏笔等）。",
    character_query: "用户在查询人物信息。请根据已有的人物状态和认知信息回答。",
    foreshadowing_query: "用户在查询伏笔状态。请列出当前所有伏笔及其状态（已埋设/推进中/已回收）。",
    timeline_query: "用户在查询时间线。请根据时间线数据回答当前时间进展。",
    setting_query: "用户在查询设定信息。请根据正史设定和世界观回答。",
    general_chat: "",
  }

  const directive = directives[route.intent]
  if (!directive) return ""

  return `\n## 任务类型识别\n意图：${intentToLabel(route.intent)}（置信度 ${Math.round(route.confidence * 100)}%）\n指令：${directive}\n`
}

function intentToLabel(intent: NovelTaskIntent): string {
  const labels: Record<NovelTaskIntent, string> = {
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
  }
  return labels[intent] || "未知"
}
