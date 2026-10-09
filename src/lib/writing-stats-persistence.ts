import { createDirectory, fileExists, listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { countChapterBodyWords } from "@/lib/chapter-word-count"
import { flattenMdFiles } from "@/lib/novel/chapter-utils"
import { getRelativePath, joinPath, normalizeComparablePath, normalizePath } from "@/lib/path-utils"

/** 写作统计落盘到 `<project>/.novel/writing-stats.json`（派生数据，与正典同目录）。 */
export const WRITING_STATS_DIR = ".novel"
export const WRITING_STATS_FILE = "writing-stats.json"
export const WRITING_STATS_VERSION = 1

export const DEFAULT_DAILY_TARGET_CHARS = 3000
export const DAILY_TARGET_CHARS_MIN = 100
export const DAILY_TARGET_CHARS_MAX = 100_000

/** 保留多少天的历史。每日两条整数，留两个月足够看趋势，又不至于让文件无限长大。 */
export const WRITING_STATS_KEEP_DAYS = 62

export function writingStatsPath(projectPath: string): string {
  return joinPath(normalizeComparablePath(projectPath), WRITING_STATS_DIR, WRITING_STATS_FILE)
}

export interface WritingStatsDay {
  humanChars: number
  aiChars: number
}

/**
 * 单章的归属摘要。
 *
 * 刻意**不落盘章节正文**，只留长度 + 哈希 + 来源游程：
 * - 长度 + 哈希用来判断「磁盘上的这一章还是不是当初记账的那一份」；
 * - 对不上就重打基线并放弃本次记账，绝不错位对齐把归属算到别人头上。
 */
export interface WritingStatsChapterEntry {
  len: number
  hash: string
  rle: string
}

export interface WritingStatsFile {
  version: number
  dailyTargetChars: number
  days: Record<string, WritingStatsDay>
  chapters: Record<string, WritingStatsChapterEntry>
}

export function emptyWritingStatsFile(): WritingStatsFile {
  return {
    version: WRITING_STATS_VERSION,
    dailyTargetChars: DEFAULT_DAILY_TARGET_CHARS,
    days: {},
    chapters: {},
  }
}

/** 本地日期键 `YYYY-MM-DD`。「今日」必须按用户所在时区算，不能用 UTC。 */
export function localDayKey(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function clampDailyTargetChars(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DAILY_TARGET_CHARS
  return Math.max(DAILY_TARGET_CHARS_MIN, Math.min(DAILY_TARGET_CHARS_MAX, Math.round(value)))
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function normalizeDay(raw: unknown): WritingStatsDay | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  if (!isNonNegativeInt(record.humanChars) || !isNonNegativeInt(record.aiChars)) return null
  return { humanChars: record.humanChars, aiChars: record.aiChars }
}

function normalizeChapterEntry(raw: unknown): WritingStatsChapterEntry | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  if (!isNonNegativeInt(record.len)) return null
  if (typeof record.hash !== "string" || typeof record.rle !== "string") return null
  return { len: record.len, hash: record.hash, rle: record.rle }
}

/**
 * 把磁盘上的 JSON 收敛成可信结构。
 *
 * 这个文件在用户的项目目录里，可能被手改、被半截写入或被更早的版本污染，
 * 所以逐字段校验、坏字段直接丢弃：宁可少一段历史，也不能让 NaN 混进界面。
 */
export function normalizeWritingStatsFile(raw: unknown): WritingStatsFile {
  const base = emptyWritingStatsFile()
  if (!raw || typeof raw !== "object") return base
  const record = raw as Record<string, unknown>

  const days: Record<string, WritingStatsDay> = {}
  if (record.days && typeof record.days === "object") {
    for (const [key, value] of Object.entries(record.days as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue
      const day = normalizeDay(value)
      if (day) days[key] = day
    }
  }

  const chapters: Record<string, WritingStatsChapterEntry> = {}
  if (record.chapters && typeof record.chapters === "object") {
    for (const [key, value] of Object.entries(record.chapters as Record<string, unknown>)) {
      if (!key.trim()) continue
      const entry = normalizeChapterEntry(value)
      if (entry) chapters[key] = entry
    }
  }

  return {
    version: WRITING_STATS_VERSION,
    dailyTargetChars: typeof record.dailyTargetChars === "number"
      ? clampDailyTargetChars(record.dailyTargetChars)
      : base.dailyTargetChars,
    days: pruneWritingStatsDays(days),
    chapters,
  }
}

/** 丢掉最老的历史日期，只保留最近 `WRITING_STATS_KEEP_DAYS` 天。 */
export function pruneWritingStatsDays(
  days: Record<string, WritingStatsDay>,
  keepDays: number = WRITING_STATS_KEEP_DAYS,
): Record<string, WritingStatsDay> {
  const keys = Object.keys(days).sort()
  if (keys.length <= keepDays) return days
  const kept: Record<string, WritingStatsDay> = {}
  for (const key of keys.slice(keys.length - keepDays)) kept[key] = days[key]!
  return kept
}

export async function loadWritingStats(projectPath: string): Promise<WritingStatsFile> {
  const path = writingStatsPath(projectPath)
  if (!(await fileExists(path))) return emptyWritingStatsFile()
  try {
    return normalizeWritingStatsFile(JSON.parse(await readFile(path)))
  } catch {
    // 读坏了就当没有：统计是辅助信息，绝不能因为一个坏 JSON 挡住写作流程。
    return emptyWritingStatsFile()
  }
}

export async function saveWritingStats(projectPath: string, file: WritingStatsFile): Promise<void> {
  const directory = joinPath(normalizeComparablePath(projectPath), WRITING_STATS_DIR)
  await createDirectory(directory)
  await writeFileAtomic(writingStatsPath(projectPath), JSON.stringify(file, null, 2))
}

/** 章节在统计文件里的键：相对项目根的路径，这样整个项目挪位置也不会丢账。 */
export function writingStatsChapterKey(projectPath: string, chapterPath: string): string {
  return normalizePath(getRelativePath(normalizePath(chapterPath), normalizePath(projectPath)))
}

/**
 * 全书正文字数。
 *
 * 与章节列表头部的「全书章节总字数」同口径（逐章 `countChapterBodyWords` 求和），
 * 所以底部状态栏和目录里那个数字永远一致，不会互相打架。
 * 单章读失败按 0 计而不是整体失败：一个坏文件不该让整本书的字数变成「未知」。
 */
export async function countProjectChapterWords(projectPath: string): Promise<number | null> {
  const chaptersDir = `${normalizeComparablePath(projectPath)}/wiki/chapters`
  try {
    const nodes = await listDirectory(chaptersDir)
    const files = flattenMdFiles(nodes)
    const contents = await Promise.all(files.map((file) => readFile(file.path).catch(() => "")))
    return contents.reduce((sum, markdown) => sum + countChapterBodyWords(markdown), 0)
  } catch {
    // 还没有 chapters 目录（新项目）→ 0 字，而不是「未知」。
    return 0
  }
}
