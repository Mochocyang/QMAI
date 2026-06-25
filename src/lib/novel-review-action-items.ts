import type { NovelReviewResult } from "@/lib/novel/review-adapter"
import type { DimensionReviewResult, SixReviewDimensionKey } from "@/lib/novel/dimension-review-adapter"
import { buildDashboardIssueId } from "@/lib/dashboard-issue-actions"
import { scoreReviewResults } from "@/lib/novel/review-scoring"

export type NovelReviewActionSeverity = "blocking" | "high" | "medium" | "low"

export interface NovelReviewActionItem {
  id: string
  severity: NovelReviewActionSeverity
  reviewSeverity: NovelReviewResult["severity"]
  source: "review"
  message: string
  detail: string
  evidence?: string
  secondaryEvidence?: string
  suggestion?: string
  targetPath: string
}

export function mapNovelReviewActionSeverity(severity: NovelReviewResult["severity"]): NovelReviewActionSeverity {
  switch (severity) {
    case "error": return "high"
    case "warning": return "medium"
    case "info": return "low"
    default: return "medium"
  }
}

export function buildNovelReviewActionItem(targetPath: string, result: NovelReviewResult): NovelReviewActionItem {
  return {
    id: buildDashboardIssueId(["review", targetPath, result.type, result.message, result.evidence]),
    severity: mapNovelReviewActionSeverity(result.severity),
    reviewSeverity: result.severity,
    source: "review",
    message: result.message,
    detail: result.type,
    evidence: result.evidence,
    suggestion: result.suggestion,
    targetPath,
  }
}

export function buildVisibleNovelReviewActionItems(
  targetPath: string | null | undefined,
  results: NovelReviewResult[],
  ignored: Record<string, true>,
): NovelReviewActionItem[] {
  if (!targetPath) return []
  return results
    .map((result) => buildNovelReviewActionItem(targetPath, result))
    .filter((item) => !ignored[item.id])
}

export function buildVisibleNovelReviewActionItemsForScoreDimensions(
  targetPath: string | null | undefined,
  results: NovelReviewResult[],
  ignored: Record<string, true>,
  scoreDimensionKeys: string[],
): NovelReviewActionItem[] {
  if (scoreDimensionKeys.length === 0) {
    return buildVisibleNovelReviewActionItems(targetPath, results, ignored)
  }

  const allowed = new Set(scoreDimensionKeys)
  const scopedResults: NovelReviewResult[] = []
  for (const dimension of scoreReviewResults(results).dimensions) {
    if (allowed.has(dimension.key)) {
      scopedResults.push(...dimension.issues)
    }
  }
  return buildVisibleNovelReviewActionItems(targetPath, scopedResults, ignored)
}

export function buildVisibleNovelReviewActionItemsForDimensionResults(
  targetPath: string | null | undefined,
  dimensionResults: Partial<Record<SixReviewDimensionKey, DimensionReviewResult>> | null | undefined,
  ignored: Record<string, true>,
  dimensionKey: SixReviewDimensionKey,
): NovelReviewActionItem[] {
  if (!targetPath) return []
  const result = dimensionResults?.[dimensionKey]
  if (!result) return []

  return result.issues
    .map((issue) => ({
      ...buildNovelReviewActionItem(targetPath, issue),
      detail: issue.dimensionKey,
      secondaryEvidence: issue.rewriteTarget || issue.evidence,
    }))
    .filter((item) => !ignored[item.id])
}
