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
/** 单个事件展开成正文的合理字数区间。用它挡住「3000 字分 8 个事件」这类不可能的安排。 */
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
  const num = typeof value === "number" ? value : Number.parseInt(text(value), 10)
  return Number.isFinite(num) && num > 0 ? Math.round(num) : fallback
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
 */
export function validateEventOutlineData(
  data: EventOutlineData | null,
): { ok: boolean; problems: string[] } {
  if (!data) return { ok: false, problems: ["未解析到事件细纲结构化数据（eventOutlineData）。"] }

  const problems: string[] = []
  const { events } = data

  if (events.length < EVENT_OUTLINE_MIN_EVENTS || events.length > EVENT_OUTLINE_MAX_EVENTS) {
    problems.push(
      `事件数为 ${events.length}，应在 ${EVENT_OUTLINE_MIN_EVENTS}~${EVENT_OUTLINE_MAX_EVENTS} 个之间。`,
    )
  }

  events.forEach((event, index) => {
    if (event.id !== index + 1) {
      problems.push(`第 ${index + 1} 个事件的序号是 ${event.id}，事件序号必须从 1 起连续递增。`)
    }
    // 校验不假设入参已经归一化（用户可能在卡片上直接改过草稿），字符串一律去空白再判断。
    const title = event.title.trim()
    if (!title) {
      problems.push(`第 ${index + 1} 个事件缺少一句话标题。`)
    } else if (title.length > EVENT_OUTLINE_TITLE_MAX_CHARS) {
      problems.push(
        `第 ${index + 1} 个事件标题 ${title.length} 字，超过 ${EVENT_OUTLINE_TITLE_MAX_CHARS} 字，请压到 20 字左右。`,
      )
    }
    if (event.points.length < EVENT_OUTLINE_MIN_POINTS || event.points.length > EVENT_OUTLINE_MAX_POINTS) {
      problems.push(
        `第 ${index + 1} 个事件的细节抓手为 ${event.points.length} 条，应有 ${EVENT_OUTLINE_MIN_POINTS}~${EVENT_OUTLINE_MAX_POINTS} 条。`,
      )
    }
  })

  if (!data.endingHook.trim()) {
    problems.push("缺少全章结尾钩子（endingHook）。")
  }

  if (data.chapterNumber <= 0) {
    problems.push("缺少目标章号（chapterNumber）。")
  }

  if (data.targetWords > 0 && events.length > 0) {
    const perEvent = Math.round(data.targetWords / events.length)
    if (perEvent < EVENT_OUTLINE_MIN_WORDS_PER_EVENT || perEvent > EVENT_OUTLINE_MAX_WORDS_PER_EVENT) {
      problems.push(
        `目标 ${data.targetWords} 字分给 ${events.length} 个事件，每个事件约 ${perEvent} 字，`
        + `正常应在 ${EVENT_OUTLINE_MIN_WORDS_PER_EVENT}~${EVENT_OUTLINE_MAX_WORDS_PER_EVENT} 字之间。`,
      )
    }
  }

  return { ok: problems.length === 0, problems }
}
