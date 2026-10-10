/**
 * 事件细纲（轻量章细纲）。
 *
 * 与重型「章节细纲」（chapter-outline：17 节 / 整故事 3 章一批 / 必须对齐卷纲骨架）
 * 是两条独立产线。本模块只服务「今天这一章写哪几件事」：一章一批、4~8 个连续事件，
 * 每个事件给一句 20 字左右的标题加若干可直接落笔的细节抓手。
 *
 * 刻意不参与 chapterOutlineData 的解析、分批续跑与校验链路，也不注册为上下文索引
 * 的 chapter kind —— 详见 docs/scratch-20261010-分支说明.md 第 2.3 节。
 */

export const EVENT_OUTLINE_VERSION = 1
export const EVENT_OUTLINE_MIN_EVENTS = 4
export const EVENT_OUTLINE_MAX_EVENTS = 8
export const EVENT_OUTLINE_DEFAULT_EVENTS = 6
export const EVENT_OUTLINE_TITLE_MAX_CHARS = 24
export const EVENT_OUTLINE_MIN_POINTS = 2
export const EVENT_OUTLINE_MAX_POINTS = 5
/**
 * 单个事件展开成正文的参考字数区间。只用于软性提示（advisories），不阻断扩写：
 * 单章目标字数设置被钳在 1000~10000（见 deep-chapter-prompts.ts），
 * 4~8 个事件下平均字数天然可能落在区间外（如 4000/4=1000、10000/4=2500），
 * 若当作硬性错误会让完全合法的细纲用不了「用这份细纲写这一章」。
 */
export const EVENT_OUTLINE_MIN_WORDS_PER_EVENT = 150
export const EVENT_OUTLINE_MAX_WORDS_PER_EVENT = 800

export interface EventOutlineEvent {
  /** 从 1 起的连续序号。 */
  id: number
  /** 一句话事件，约 20 字。 */
  title: string
  /** 2~5 条细节抓手：关键台词 / 神情动作 / 环境物件 / 推进或钩子。 */
  points: string[]
}

export interface EventOutlineData {
  version: number
  chapterNumber: number
  /** 「第N章 · 一句话章名」。 */
  title: string
  /** 本章目标字数（展开成正文的目标）。 */
  targetWords: number
  events: EventOutlineEvent[]
  /** 全章结尾钩子。 */
  endingHook: string
}

/** 一次事件细纲生成请求（向导产出）。 */
export interface EventOutlineRequest {
  chapterNumber: number
  eventCount: number
  targetWords: number
  /** 用户对本章的想法或硬要求，可为空。 */
  requirement: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function positiveInteger(value: unknown, fallback: number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
  }
  // 不能只认开头的数字：AI 常写「约3000字」「第12章」，要扫到第一段数字。
  const digits = text(value).match(/\d+/)?.[0]
  const num = digits ? Number.parseInt(digits, 10) : Number.NaN
  return Number.isFinite(num) && num > 0 ? num : fallback
}

function normalizePoints(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => text(item)).filter(Boolean)
}

function normalizeEvents(value: unknown): EventOutlineEvent[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .map((raw) => ({ title: text(raw.title), points: normalizePoints(raw.points) }))
    // 连标题和抓手都没有的空槽直接丢掉，不占用 4~8 的名额。
    .filter((item) => item.title || item.points.length > 0)
    .map((item, index) => ({ id: index + 1, title: item.title, points: item.points }))
}

/** 把一个「已经是数据本身」的对象读成事件细纲；events 为空则不算数据。 */
function readEventOutline(raw: Record<string, unknown>): EventOutlineData | null {
  const events = normalizeEvents(raw.events)
  if (events.length === 0) return null
  return {
    version: positiveInteger(raw.version, EVENT_OUTLINE_VERSION),
    chapterNumber: positiveInteger(raw.chapterNumber, 0),
    title: text(raw.title),
    targetWords: positiveInteger(raw.targetWords, 0),
    events,
    endingHook: text(raw.endingHook),
  }
}

/**
 * 宽容归一化：不管 AI 用 `eventOutlineData` 信封还是裸对象，只要 events 非空就认。
 * 缺字段取安全默认值，让校验去挑毛病 —— 与 normalizeChapterOutlineData 同一口径。
 */
export function normalizeEventOutlineData(raw: unknown): EventOutlineData | null {
  if (!isRecord(raw)) return null
  // 先当裸对象试；再按「单键信封」把它包着的值当数据试一次 —— 与 chapterDataFromPayload 同一策略。
  const direct = readEventOutline(raw)
  if (direct) return direct
  for (const value of Object.values(raw)) {
    if (!isRecord(value)) continue
    const inner = readEventOutline(value)
    if (inner) return inner
  }
  return null
}

/**
 * 校验返回问题清单而不是布尔值：与 validateChapterOutlineData 同风格，
 * 卡片上逐条标红 + 给修复建议，用户仍可选择「保存当前内容」。
 *
 * `problems` 只装结构性缺陷（缺字段、数量越界、序号不连续），`ok` 也随之只反映结构；
 * 字数分配一类的软性建议放 `advisories`，不参与 `ok`，避免合法细纲被误判为不可用。
 * 契约：任何非 null 对象都只返回清单，绝不抛异常。
 */
export function validateEventOutlineData(
  data: EventOutlineData | null,
): { ok: boolean; problems: string[]; advisories: string[] } {
  if (!data) {
    return { ok: false, problems: ["未解析到事件细纲结构化数据（eventOutlineData）。"], advisories: [] }
  }

  const problems: string[] = []
  const advisories: string[] = []
  // 入参可能来自卡片上被手改过的草稿，不假设它已经归一化，逐字段做存在性兜底。
  const events = Array.isArray(data.events) ? data.events : []

  if (events.length < EVENT_OUTLINE_MIN_EVENTS || events.length > EVENT_OUTLINE_MAX_EVENTS) {
    problems.push(
      `事件数为 ${events.length}，应在 ${EVENT_OUTLINE_MIN_EVENTS}~${EVENT_OUTLINE_MAX_EVENTS} 个之间。`,
    )
  }

  events.forEach((event, index) => {
    if (!isRecord(event)) {
      problems.push(`第 ${index + 1} 个事件不是对象。`)
      return
    }
    if (event.id !== index + 1) {
      problems.push(`第 ${index + 1} 个事件的序号是 ${event.id}，事件序号必须从 1 起连续递增。`)
    }
    // 校验不假设入参已经归一化（用户可能在卡片上直接改过草稿），字符串一律去空白再判断。
    const title = text(event.title)
    if (!title) {
      problems.push(`第 ${index + 1} 个事件缺少一句话标题。`)
    } else if (title.length > EVENT_OUTLINE_TITLE_MAX_CHARS) {
      problems.push(
        `第 ${index + 1} 个事件标题 ${title.length} 字，超过 ${EVENT_OUTLINE_TITLE_MAX_CHARS} 字，请压到 20 字左右。`,
      )
    }
    if (!Array.isArray(event.points)) {
      // 别把非列表说成「1 条」——那会让用户以为只要再加一条。
      problems.push(`第 ${index + 1} 个事件的细节抓手不是列表。`)
    } else {
      const points = event.points
      if (points.length < EVENT_OUTLINE_MIN_POINTS || points.length > EVENT_OUTLINE_MAX_POINTS) {
        problems.push(
          `第 ${index + 1} 个事件的细节抓手为 ${points.length} 条，应有 ${EVENT_OUTLINE_MIN_POINTS}~${EVENT_OUTLINE_MAX_POINTS} 条。`,
        )
      }
    }
  })

  if (!text(data.endingHook)) {
    problems.push("缺少全章结尾钩子（endingHook）。")
  }

  // 与 targetWords 同用取反写法：缺失/NaN 也算缺章号。
  if (!(data.chapterNumber > 0)) {
    problems.push("缺少目标章号（chapterNumber）。")
  }

  // 用取反写法，缺失/NaN 也算缺目标字数（正向的 `<= 0` 对 undefined 不成立）。
  if (!(data.targetWords > 0)) {
    problems.push("缺少本章目标字数（targetWords）。")
  }

  if (data.targetWords > 0 && events.length > 0) {
    const perEvent = Math.round(data.targetWords / events.length)
    if (perEvent < EVENT_OUTLINE_MIN_WORDS_PER_EVENT || perEvent > EVENT_OUTLINE_MAX_WORDS_PER_EVENT) {
      advisories.push(
        `目标 ${data.targetWords} 字分给 ${events.length} 个事件，每个事件约 ${perEvent} 字，展开时注意节奏。`,
      )
    }
  }

  return { ok: problems.length === 0, problems, advisories }
}

/** 从 `{` 开始配平花括号，返回一个完整 JSON 对象文本；尊重字符串与转义。 */
function balancedJsonBlock(candidate: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < candidate.length; index += 1) {
    const ch = candidate[index]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === "\"") inString = false
      continue
    }
    if (ch === "\"") inString = true
    else if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) return candidate.slice(start, index + 1)
    }
  }
  return null
}

/**
 * 从 AI 回复里提取事件细纲数据（优先在 ```json 围栏内查找）。
 * 与 extractChapterOutlineData 同构：逐个围栏试，哪个能解析成事件细纲就用哪个，
 * 于是「模型换了个信封名」不会导致卡片渲染不出来。
 *
 * 信封解包不在本函数做：`normalizeEventOutlineData` 已经负责那一层，
 * 这里只负责「从文本里找到 JSON」。两处都解包会变成两层宽容度，也会重复代码。
 *
 * `balancedJsonBlock` 刻意保持私有，不与 chapter-outline-template.ts 共享：
 * 那个文件不在本分支范围内，不为它建共享模块。
 */
export function extractEventOutlineData(content: string): EventOutlineData | null {
  const fencePattern = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi
  const candidates: string[] = []
  for (const match of content.matchAll(fencePattern)) {
    if (match[1].includes("{")) candidates.push(match[1])
  }
  if (candidates.length === 0 && content.includes("{")) candidates.push(content)

  for (const candidate of candidates) {
    const start = candidate.indexOf("{")
    if (start < 0) continue
    const block = balancedJsonBlock(candidate, start)
    if (!block) continue
    try {
      const data = normalizeEventOutlineData(JSON.parse(block) as unknown)
      if (data) return data
    } catch {
      // 该围栏不是合法 JSON，继续下一个
    }
  }
  return null
}

/** 事件细纲的生成提示词。范围（章号 / 事件数 / 字数）由向导定死，所以不开意图分析。 */
export function buildEventOutlinePrompt(request: EventOutlineRequest): string {
  const requirement = request.requirement.trim()
  const perEventWords = Math.round(request.targetWords / request.eventCount)
  // 章号补零，与「事件细纲-第001章.md」的命名规范保持一致。
  const fileName = `事件细纲-第${String(request.chapterNumber).padStart(3, "0")}章.md`
  // 示例 JSON 交给 JSON.stringify 生成：手写字符串一旦漏引号或漏括号，就会教模型输出坏数据。
  const example = JSON.stringify({
    eventOutlineData: {
      version: 1,
      chapterNumber: request.chapterNumber,
      title: "第N章 · 一句话章名",
      targetWords: request.targetWords,
      events: [
        { id: 1, title: "一句话事件", points: ["关键台词：…", "神情动作：…", "环境物件：…"] },
      ],
      endingHook: "章尾钩子",
    },
  })
  return [
    `请为第 ${request.chapterNumber} 章生成一份「事件细纲」：把这一章拆成 ${request.eventCount} 个连续事件。`,
    "",
    `- 目标章号：第 ${request.chapterNumber} 章`,
    `- 事件数量：${request.eventCount} 个（必须正好 ${request.eventCount} 个）`,
    `- 本章目标字数：约 ${request.targetWords} 字（每个事件约 ${perEventWords} 字）`,
    ...(requirement ? [`- 用户对本章的要求：${requirement}`] : []),
    "",
    "## 每个事件必须包含",
    "1. title：一句话说清这个事件发生了什么，20 字左右，不超过 24 字；",
    "2. points：2~5 条细节抓手，写可以直接落笔的东西，例如关键台词、人物神情与动作、环境与物件细节、这一步推进了什么或留下什么钩子。",
    "",
    "## 硬要求",
    "- 事件之间必须前后连续、有因果推进，不能是并列的碎片；",
    "- 最后一个事件之后必须留下一个能勾住读者的章尾钩子；",
    "- **不要写正文**，不要展开描写，只给事件与抓手；",
    "- 先读资料（list_chapters / read_chapter / list_outlines / read_outline）确认前文与已有章纲，再动笔；",
    "- 不要输出工具调用报告和分析过程。",
    "",
    "## 输出格式（缺一不可）",
    "1. 一份可直接保存的 Markdown 正文：标题形如「第N章 · 一句话章名」，下面按事件分节列出标题与抓手；",
    "2. 一个 ```json 围栏，顶层字段为 eventOutlineData：",
    "```json",
    example,
    "```",
    "3. 一个 ```json 围栏，顶层字段为 outlineSaveRequest（content 为上一步的 Markdown 正文）：",
    `targetFolder 填「事件细纲」，fileName 形如「${fileName}」，`
      + "fileType 必须是 event-outline，writeMode 用 create。",
  ].join("\n")
}

/**
 * 把事件细纲变成写作输入框里的提示词。
 *
 * 走「用户指定」这一档（FIELD_PRIORITY 最前）：不新增上下文数据源、不改 token 预算，
 * 由用户在写作现场确认后自行发送。
 */
export function eventOutlineToProsePrompt(data: EventOutlineData): string {
  const lines: string[] = [
    `请根据下面这份「事件细纲」写出第 ${data.chapterNumber} 章正文。`,
    "",
    "## 本章事件序列（必须按此顺序全部覆盖，不得跳过、不得调换顺序与因果）",
  ]
  data.events.forEach((event) => {
    lines.push(`${event.id}. ${event.title}`)
    event.points.forEach((point) => lines.push(`   - ${point}`))
  })
  if (data.endingHook.trim()) {
    lines.push("", "## 本章结尾钩子", data.endingHook)
  }
  lines.push(
    "",
    "## 写作要求",
    `- 目标约 ${data.targetWords} 字，允许 ±10% 浮动；每个事件都要有场景、对话、人物神情与环境细节，不要写成事件流水账；`,
    "- 只输出可直接保存到章节库的小说正文，不要解释，不要列提纲，不要输出工具调用报告。",
  )
  return lines.join("\n")
}
