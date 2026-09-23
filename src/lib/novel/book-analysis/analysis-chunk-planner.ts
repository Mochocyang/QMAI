import { CHAPTER_BODY_EXCERPT_MAX_CHARS } from "@/lib/novel/chapter-excerpts"
import type {
  AnalysisChapterRange,
  AnalysisChunkPlan,
} from "./analysis-pipeline-types"

export const MAX_ANALYSIS_CHAPTERS = 100
/** 单次调用喂给模型的正文上限。失败重试的代价随这值上升，所以故意封顶。 */
export const MAX_ANALYSIS_CHUNK_CHARS = 40_000
export const MIN_ANALYSIS_CHUNK_CHARS = 8_000
const DEFAULT_CHAPTERS_PER_CHUNK = 10

interface AnalysisChapterSummary {
  id: string
  order: number
  wordCount: number
}

interface AnalysisChunkPlanOptions {
  targetChapterCount?: number
  maxChunkChars: number
}

export function validateAnalysisRange(
  chapters: Array<{ order: number }>,
  range: AnalysisChapterRange,
): void {
  if (!Number.isInteger(range.startOrder) || range.startOrder < 1) {
    throw new Error("起始章节必须大于 0")
  }
  if (!Number.isInteger(range.endOrder) || range.endOrder < range.startOrder) {
    throw new Error("结束章节不能小于起始章节")
  }
  if (range.endOrder - range.startOrder + 1 > MAX_ANALYSIS_CHAPTERS) {
    throw new Error("单次最多分析 100 章，请分批处理")
  }

  const availableOrders = new Set(chapters.map((chapter) => chapter.order))
  for (let order = range.startOrder; order <= range.endOrder; order += 1) {
    if (!availableOrders.has(order)) {
      throw new Error(`未找到第 ${order} 章，无法开始分析`)
    }
  }
}

/**
 * 单次调用喂给模型的正文上限（字符），不是按窗口实时推导。
 * 公式是 context * 0.45 再夹到 [8000, 40000]；
 * 项目的 MIN_USER_LLM_CONTEXT_SIZE = 204_800，0.45 × 204800 = 92160 恒被夹到 40000，
 * 所以当前所有已配置模型实际都是 40000。
 */
export function computeAnalysisChunkCharLimit(maxContextSize: number): number {
  const requested = Math.floor(maxContextSize * 0.45)
  return Math.max(MIN_ANALYSIS_CHUNK_CHARS, Math.min(MAX_ANALYSIS_CHUNK_CHARS, requested))
}

/** adapter 发给模型前会把每章截到这个长度，预算必须按截断后的量算，否则超长章会被过度切片。 */
export function analysisBudgetChars(wordCount: number): number {
  return Math.min(Math.max(0, wordCount), CHAPTER_BODY_EXCERPT_MAX_CHARS)
}

export function buildAnalysisChunkPlan(
  chapters: AnalysisChapterSummary[],
  range: AnalysisChapterRange,
  options: AnalysisChunkPlanOptions,
): AnalysisChunkPlan[] {
  validateAnalysisRange(chapters, range)
  const targetChapterCount = Math.max(
    1,
    Math.min(DEFAULT_CHAPTERS_PER_CHUNK, Math.floor(options.targetChapterCount ?? DEFAULT_CHAPTERS_PER_CHUNK)),
  )
  const maxChunkChars = Math.max(1, Math.floor(options.maxChunkChars))
  const selected = chapters
    .filter((chapter) => chapter.order >= range.startOrder && chapter.order <= range.endOrder)
    .sort((left, right) => left.order - right.order)

  const chunks: AnalysisChunkPlan[] = []
  let current: AnalysisChapterSummary[] = []
  let currentWordCount = 0
  let currentBudgetChars = 0

  const flush = () => {
    if (current.length === 0) return
    const startOrder = current[0].order
    const endOrder = current[current.length - 1].order
    chunks.push({
      id: `chunk-${String(startOrder).padStart(4, "0")}-${String(endOrder).padStart(4, "0")}`,
      chapterIds: current.map((chapter) => chapter.id),
      startOrder,
      endOrder,
      wordCount: currentWordCount,
    })
    current = []
    currentWordCount = 0
    currentBudgetChars = 0
  }

  for (const chapter of selected) {
    const budget = analysisBudgetChars(chapter.wordCount)
    const wouldExceedCount = current.length >= targetChapterCount
    const wouldExceedChars = current.length > 0 && currentBudgetChars + budget > maxChunkChars
    if (wouldExceedCount || wouldExceedChars) flush()
    current.push(chapter)
    currentWordCount += chapter.wordCount
    currentBudgetChars += budget
    if (budget > maxChunkChars) flush()
  }
  flush()
  return chunks
}
