import type { NovelReviewResult } from "./review-adapter"

export interface DimensionScore {
  key: string
  labelKey: string
  score: number
  weight: number
  issueCount: number
  issues: NovelReviewResult[]
}

export interface ReviewScoreReport {
  dimensions: DimensionScore[]
  totalScore: number
  totalIssues: number
  severity: "excellent" | "good" | "fair" | "poor"
  antiHallucinationWarnings: string[]
}

const REVIEW_DIMENSION_MAP: Record<string, string> = {
  "是否违背总大纲": "plot",
  "是否违背分卷大纲": "plot",
  "是否违背章节目标": "plot",
  "下一章推进建议是否被忽略或反向推进": "plot",
  "是否剧情水文": "plot",
  "是否人设崩坏": "character",
  "是否人物动机不一致": "character",
  "是否角色知道了不该知道的信息": "character",
  "是否能力体系崩坏": "world",
  "是否新增未登记设定": "world",
  "是否缺少章节钩子": "pacing",
  "是否时间线错误": "facts",
  "是否地点错误": "facts",
  "是否伏笔遗忘": "facts",
  "是否提前泄露秘密": "facts",
  "本章必须完成项是否已完成": "compliance",
  "本章避免违背项是否存在违背": "compliance",
  "style": "pacing",
}

const DIMENSION_WEIGHTS: Record<string, number> = {
  plot: 0.20,
  character: 0.15,
  world: 0.10,
  pacing: 0.15,
  facts: 0.25,
  compliance: 0.15,
}

const DIMENSION_LABEL_KEYS: Record<string, string> = {
  plot: "novel.scoring.dimension.plot",
  character: "novel.scoring.dimension.character",
  world: "novel.scoring.dimension.world",
  pacing: "novel.scoring.dimension.pacing",
  facts: "novel.scoring.dimension.facts",
  compliance: "novel.scoring.dimension.compliance",
}

const SEVERITY_DEDUCTION: Record<string, number> = {
  error: 20,
  warning: 10,
  info: 5,
}

/**
 * 校准后的推荐配置（基于黄金标准场景网格搜索）。
 * 可由 `node scripts/calibrate-review-weights.mjs` 重新生成。
 *
 * 与默认值差异：
 * - facts 维度权重从 0.25 ↑ 0.35（事实一致性权重最高）
 * - plot 权重从 0.20 ↓ 0.12（允许更多剧情自由度）
 * - error 扣分从 20 ↑ 26（严重错误惩罚更强）
 * - 总绝对误差从 106 → 52（降低 54%）
 */
export const CALIBRATED_DIMENSION_WEIGHTS: Record<string, number> = {
  plot: 0.116,
  character: 0.190,
  world: 0.050,
  pacing: 0.190,
  facts: 0.353,
  compliance: 0.101,
}

export const CALIBRATED_SEVERITY_DEDUCTION: Record<string, number> = {
  error: 26,
  warning: 13,
  info: 7,
}

export interface ReviewScoringOptions {
  enableAntiHallucination?: boolean
  dimensionWeights?: Partial<Record<string, number>>
  severityDeductions?: Partial<Record<string, number>>
}

export function scoreReviewResults(
  results: NovelReviewResult[],
  options?: ReviewScoringOptions,
): ReviewScoreReport {
  const dimensionIssues: Record<string, NovelReviewResult[]> = {}
  for (const key of Object.keys(DIMENSION_WEIGHTS)) {
    dimensionIssues[key] = []
  }

  for (const result of results) {
    const typeLabel = resolveTypeLabel(result.type)
    const dim = REVIEW_DIMENSION_MAP[typeLabel] || "facts"
    if (dimensionIssues[dim]) {
      dimensionIssues[dim].push(result)
    }
  }

  const dimensions: DimensionScore[] = []
  let weightedSum = 0

  for (const key of Object.keys(DIMENSION_WEIGHTS)) {
    const issues = dimensionIssues[key] || []
    const deductions = options?.severityDeductions ?? SEVERITY_DEDUCTION
    const deduction = issues.reduce((sum, issue) => {
      return sum + (deductions[issue.severity] || 5)
    }, 0)
    const score = Math.max(0, 100 - deduction)
    const weight = options?.dimensionWeights?.[key] ?? DIMENSION_WEIGHTS[key]
    dimensions.push({
      key,
      labelKey: DIMENSION_LABEL_KEYS[key],
      score,
      weight,
      issueCount: issues.length,
      issues,
    })
    weightedSum += score * weight
  }

  const antiHallucinationWarnings = options?.enableAntiHallucination
    ? runAntiHallucinationChecks(results)
    : []

  return {
    dimensions,
    totalScore: Math.round(weightedSum),
    totalIssues: results.length,
    severity: classifySeverity(weightedSum, results.length),
    antiHallucinationWarnings,
  }
}

function resolveTypeLabel(type: string): string {
  const directMatch = REVIEW_DIMENSION_MAP[type]
  if (directMatch) return type

  const lower = type.toLowerCase()
  if (lower.includes("character") || lower.includes("consistency")) return "是否人设崩坏"
  if (lower.includes("timeline")) return "是否时间线错误"
  if (lower.includes("plot") || lower.includes("outline")) return "是否违背章节目标"
  if (lower.includes("setting") || lower.includes("world")) return "是否能力体系崩坏"
  if (lower.includes("foreshadowing")) return "是否伏笔遗忘"
  if (lower.includes("style")) return "是否剧情水文"
  return type
}

function classifySeverity(_totalScore: number, totalIssues: number): "excellent" | "good" | "fair" | "poor" {
  if (totalIssues === 0) return "excellent"
  if (totalIssues <= 2) return "good"
  if (totalIssues <= 7) return "fair"
  return "poor"
}

function runAntiHallucinationChecks(results: NovelReviewResult[]): string[] {
  const warnings: string[] = []
  const absoluteWords = ["必然", "一定", "绝对", "肯定", "显然"]

  for (const result of results) {
    if (!result.evidence || result.evidence.trim().length < 5) {
      warnings.push(`证据缺失：问题"${result.message.slice(0, 40)}"的证据字段为空或过短`)
    }
    for (const word of absoluteWords) {
      if (result.message.includes(word) && !result.evidence.includes(word)) {
        warnings.push(`过度推断：问题"${result.message.slice(0, 40)}"使用了确定性词汇"${word}"但证据中未体现`)
      }
    }
  }
  return warnings
}