import type {
  AnalysisChapterRange,
  AnalysisChunkPlan,
} from "./analysis-pipeline-types"

export const MAX_ANALYSIS_CHAPTERS = 100
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

export function computeAnalysisChunkCharLimit(maxContextSize: number): number {
  const requested = Math.floor(maxContextSize * 0.45)
  return Math.max(8000, Math.min(40000, requested))
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
  }

  for (const chapter of selected) {
    const wouldExceedCount = current.length >= targetChapterCount
    const wouldExceedChars = current.length > 0 && currentWordCount + chapter.wordCount > maxChunkChars
    if (wouldExceedCount || wouldExceedChars) flush()
    current.push(chapter)
    currentWordCount += chapter.wordCount
    if (chapter.wordCount > maxChunkChars) flush()
  }
  flush()
  return chunks
}
