/**
 * 拆书故事导图（StoryMap）类型定义（chaishugushidaotu 分支）
 *
 * 心智模型：主线为核心的时间轴，逐章列出主线事件；
 * 每章可挂若干「分支」（支线故事、任务、伏笔、世界观展开、情感线），
 * 分支需标明由主线哪一环节触发，形成一目了然的思维导图结构。
 */

/** 分支类型 */
export type StoryBranchKind = "sub" | "task" | "foreshadow" | "world" | "emotion"

export const STORY_BRANCH_KIND_LABELS: Record<StoryBranchKind, string> = {
  sub: "支线",
  task: "任务",
  foreshadow: "伏笔",
  world: "世界观",
  emotion: "情感",
}

/** 主线事件 / 分支事件共用结构 */
export interface StoryEvent {
  /** 事件一句话（思维导图节点主文本） */
  label: string
  /** 具体情节点（2~4 条，每条一句话） */
  beats: string[]
  /** 涉及角色名 */
  characters: string[]
  /** 由此延伸的伏笔/悬念（可选） */
  spinoff?: string
}

/** 某一章生成的分支 */
export interface StoryBranch {
  id: string
  kind: StoryBranchKind
  /** 分支名（如「炼丹师大赛支线」） */
  label: string
  /** 由主线哪一环节触发（对应主线事件 label） */
  triggeredBy: string
  events: StoryEvent[]
}

/** 单章导图节点 */
export interface StoryMapChapter {
  id: string
  order: number
  title: string
  /** 本章发生了什么（一句话概括 + 要点） */
  summary: string
  /** 主线事件（按推进顺序） */
  mainEvents: StoryEvent[]
  /** 本章生发的分支 */
  branches: StoryBranch[]
}

/** 整本作品的故事导图 */
export interface StoryMap {
  schemaVersion: 1
  bookId: string
  bookTitle: string
  /** 主线名（如「主角成长主线」） */
  mainLineLabel: string
  /** 主线整体一句话 */
  mainSummary: string
  chapters: StoryMapChapter[]
  createdAt: number
}

/** 规范化：字段兜底 + 清理脏数据，单章失败不整体失败 */
export function normalizeStoryMap(input: {
  bookId: string
  bookTitle: string
  raw: unknown
  createdAt?: number
}): StoryMap {
  const createdAt = input.createdAt ?? Date.now()
  const raw = (input.raw && typeof input.raw === "object" ? input.raw : {}) as Record<string, unknown>

  const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "")
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(asString).filter(Boolean) : []

  const normalizeEvent = (v: unknown): StoryEvent | null => {
    if (!v || typeof v !== "object") return null
    const e = v as Record<string, unknown>
    const label = asString(e.label)
    if (!label) return null
    return {
      label,
      beats: asStringArray(e.beats),
      characters: asStringArray(e.characters),
      spinoff: asString(e.spinoff) || undefined,
    }
  }

  const normalizeBranch = (v: unknown, chapterId: string, index: number): StoryBranch | null => {
    if (!v || typeof v !== "object") return null
    const b = v as Record<string, unknown>
    const label = asString(b.label)
    if (!label) return null
    const kind = (["sub", "task", "foreshadow", "world", "emotion"] as const)
      .find((k) => k === asString(b.kind))
      ?? "sub"
    return {
      id: asString(b.id) || `branch-${chapterId}-${index}`,
      kind,
      label,
      triggeredBy: asString(b.triggeredBy),
      events: (Array.isArray(b.events) ? b.events : [])
        .map(normalizeEvent)
        .filter((e): e is StoryEvent => e !== null),
    }
  }

  const rawChapters = Array.isArray(raw.chapters) ? raw.chapters : []
  const chapters: StoryMapChapter[] = rawChapters.flatMap((v, index): StoryMapChapter[] => {
    if (!v || typeof v !== "object") return []
    const c = v as Record<string, unknown>
    const summary = asString(c.summary)
    const mainEvents = (Array.isArray(c.mainEvents) ? c.mainEvents : [])
      .map(normalizeEvent)
      .filter((e): e is StoryEvent => e !== null)
    if (!summary && mainEvents.length === 0) return []
    const id = asString(c.id) || `ch-${index + 1}`
    return [{
      id,
      order: Number(c.order) || index + 1,
      title: asString(c.title) || `第 ${index + 1} 章`,
      summary,
      mainEvents,
      branches: (Array.isArray(c.branches) ? c.branches : [])
        .map((b, bIndex) => normalizeBranch(b, id, bIndex))
        .filter((b): b is StoryBranch => b !== null),
    }]
  }).sort((a, b) => a.order - b.order)

  return {
    schemaVersion: 1,
    bookId: input.bookId,
    bookTitle: input.bookTitle,
    mainLineLabel: asString(raw.mainLineLabel) || "主线",
    mainSummary: asString(raw.mainSummary),
    chapters,
    createdAt,
  }
}

/** 导图是否有可用内容（至少一章含主线事件） */
export function isStoryMapUsable(map: StoryMap | null | undefined): boolean {
  if (!map) return false
  return map.chapters.some((chapter) => chapter.mainEvents.length > 0 || chapter.branches.length > 0)
}
