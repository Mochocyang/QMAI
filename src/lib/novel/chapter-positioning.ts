export type ChapterPositionType =
  | "opening"
  | "development"
  | "buildup"
  | "turn"
  | "climax"
  | "resolution"

export interface ChapterPosition {
  chapterNumber: number
  type: ChapterPositionType
  pressureLevel: 1 | 2 | 3 | 4 | 5
  emotionIntensity: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  note: string
}

export interface GenrePositioningBaseline {
  opening: number
  development: number
  buildup: number
  turn: number
  climax: number
  resolution: number
}

export const DEFAULT_SHOUWEN_BASELINE: GenrePositioningBaseline = {
  opening: 10,
  development: 30,
  buildup: 25,
  turn: 15,
  climax: 15,
  resolution: 5,
}

/**
 * 中英文定位标签映射，用于从卷纲 Markdown 中解析中文标签。
 */
const POSITION_LABEL_MAP: Record<string, ChapterPositionType> = {
  "开场": "opening",
  "发展": "development",
  "铺垫": "buildup",
  "转折": "turn",
  "高潮": "climax",
  "收束": "resolution",
}

/**
 * 检查章节定位分布是否合理。
 *
 * 规则：
 * - 高压章（高潮+转折）不超过30%
 * - 信息/收束章不超过10%
 * - 相邻章情绪母题不扎堆（连续3章不能同类型且情绪都>7）
 *
 * @param positions - 章节定位数组
 * @param baseline - 可选，题材基线，默认使用爽文基线
 * @returns 警告列表
 */
export function checkChapterPositioningDistribution(
  positions: ChapterPosition[],
  baseline?: GenrePositioningBaseline,
): string[] {
  const warnings: string[] = []
  const total = positions.length
  if (total === 0) return warnings

  const b = baseline ?? DEFAULT_SHOUWEN_BASELINE

  // 高压章（高潮+转折）占比
  const highPressureCount = positions.filter(
    (p) => p.type === "climax" || p.type === "turn",
  ).length
  const highPressureRatio = (highPressureCount / total) * 100
  if (highPressureRatio > 30) {
    warnings.push(
      `高压章（高潮+转折）占比 ${highPressureRatio.toFixed(1)}%，超过30%上限`,
    )
  }

  // 收束章占比
  const resolutionCount = positions.filter((p) => p.type === "resolution").length
  const resolutionRatio = (resolutionCount / total) * 100
  if (resolutionRatio > 10) {
    warnings.push(
      `收束章占比 ${resolutionRatio.toFixed(1)}%，超过10%上限`,
    )
  }

  // 检查分布与基线偏差
  const actualPercentages: Record<ChapterPositionType, number> = {
    opening: 0,
    development: 0,
    buildup: 0,
    turn: 0,
    climax: 0,
    resolution: 0,
  }
  for (const p of positions) {
    actualPercentages[p.type]++
  }
  for (const key of Object.keys(actualPercentages) as ChapterPositionType[]) {
    const actual = (actualPercentages[key] / total) * 100
    const expected = b[key]
    if (expected !== undefined && Math.abs(actual - expected) > 15) {
      warnings.push(
        `章节类型"${key}"占比 ${actual.toFixed(1)}%，与基线 ${expected}% 偏差超过15%`,
      )
    }
  }

  // 相邻章情绪扎堆检查
  const clusteringWarnings = checkAdjacentEmotionClustering(positions)
  warnings.push(...clusteringWarnings)

  return warnings
}

/**
 * 检查相邻章情绪扎堆。
 * 连续3章不能同类型且情绪都>7。
 *
 * @param positions - 章节定位数组
 * @returns 警告列表
 */
export function checkAdjacentEmotionClustering(
  positions: ChapterPosition[],
): string[] {
  const warnings: string[] = []
  for (let i = 0; i <= positions.length - 3; i++) {
    const a = positions[i]
    const b = positions[i + 1]
    const c = positions[i + 2]
    if (
      a.type === b.type &&
      b.type === c.type &&
      a.emotionIntensity > 7 &&
      b.emotionIntensity > 7 &&
      c.emotionIntensity > 7
    ) {
      warnings.push(
        `第${a.chapterNumber}、${b.chapterNumber}、${c.chapterNumber}章连续3章类型相同（${a.type}）且情绪强度均>7，建议调整其中至少一章的类型或情绪强度`,
      )
    }
  }
  return warnings
}

/**
 * 从 Markdown 文本中解析章节定位分布表。
 */
export function parsePositionTableFromMarkdown(
  markdown: string,
): ChapterPosition[] {
  const positions: ChapterPosition[] = []
  const lines = markdown.split("\n")

  let inTable = false
  let tableHeaderFound = false

  for (const line of lines) {
    const trimmed = line.trim()

    // 检测表格开始：包含表头 "章 | 定位" 或 "定位 | 压力级"
    if (
      !tableHeaderFound &&
      trimmed.startsWith("|") &&
      trimmed.includes("章") &&
      trimmed.includes("定位") &&
      (trimmed.includes("压力级") || trimmed.includes("情绪"))
    ) {
      inTable = true
      tableHeaderFound = true
      continue
    }

    // 跳过表头分隔行
    if (inTable && trimmed.startsWith("|---")) {
      continue
    }

    // 解析表格行
    if (inTable && trimmed.startsWith("|")) {
      // 遇到空表行或下一个表格，结束
      const cells = trimmed
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0)

      if (cells.length < 4) {
        // 可能不是数据行
        continue
      }

      const chapterNumber = parseInt(cells[0], 10)
      if (isNaN(chapterNumber)) {
        // 可能是非数据行
        continue
      }

      const typeLabel = cells[1]
      const type = POSITION_LABEL_MAP[typeLabel]
      if (!type) {
        continue
      }

      // 查找压力级和情绪强度所在列
      // 表头格式: 章 | 定位 | 压力级(1-5) | 情绪强度(1-10) | 说明
      // cells[0] = 章号, cells[1] = 定位, cells[2] = 压力级, cells[3] = 情绪强度
      let pressureLevel: 1 | 2 | 3 | 4 | 5 = 1
      let emotionIntensity: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 = 1
      let note = ""

      if (cells.length >= 3) {
        const pl = parseInt(cells[2], 10)
        if (pl >= 1 && pl <= 5) pressureLevel = pl as 1 | 2 | 3 | 4 | 5
      }
      if (cells.length >= 4) {
        const ei = parseInt(cells[3], 10)
        if (ei >= 1 && ei <= 10) emotionIntensity = ei as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
      }
      if (cells.length >= 5) {
        note = cells[4]
      }

      positions.push({
        chapterNumber,
        type,
        pressureLevel,
        emotionIntensity,
        note,
      })
    }
  }

  return positions
}