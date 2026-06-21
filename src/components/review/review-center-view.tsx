import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wiki-store"
import { useCallback } from "react"
import { ReviewView } from "./review-view"
import { DashboardView } from "@/components/dashboard/dashboard-view"
import { Button } from "@/components/ui/button"
import { readFile } from "@/commands/fs"
import { startSixDimensionReviewRun } from "@/lib/novel/start-six-dimension-review-run"
import { SIX_REVIEW_DIMENSION_ORDER, type SixReviewDimensionKey } from "@/lib/novel/dimension-review-adapter"

function isSixReviewDimensionKey(value: string | null): value is SixReviewDimensionKey {
  return SIX_REVIEW_DIMENSION_ORDER.includes(value as SixReviewDimensionKey)
}

export function ReviewCenterView() {
  const { t } = useTranslation()
  const selectedReviewDimension = useWikiStore((s) => s.selectedReviewDimension)
  const novelMode = useWikiStore((s) => s.novelMode)

  if (selectedReviewDimension === "ai-review") {
    return <ReviewView />
  }

  if (selectedReviewDimension === "character-report") {
    return <ReviewView title="角色命中报告" emptyMessage="暂无角色命中报告，请先运行AI审稿。" characterOnly />
  }

  if (!selectedReviewDimension || !novelMode) {
    return <DashboardView headerActions={<ReviewStartButton />} />
  }

  if (!isSixReviewDimensionKey(selectedReviewDimension)) {
    return <DashboardView headerActions={<ReviewStartButton />} />
  }

  return (
    <ReviewView
      title={t(`reviewCenter.dimension.${selectedReviewDimension}`)}
      emptyMessage={t("reviewCenter.noResults")}
      dimensionKey={selectedReviewDimension}
    />
  )
}

function ReviewStartButton() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const selectedReviewFilePath = useWikiStore((s) => s.selectedReviewFilePath)
  const reviewRun = useWikiStore((s) => s.reviewRun)
  const isReviewing = reviewRun?.running ?? false
  const canReview = Boolean(project?.path && selectedReviewFilePath) && !isReviewing

  const handleStartReview = useCallback(() => {
    if (!project?.path || !selectedReviewFilePath || isReviewing) return
    void readFile(selectedReviewFilePath)
      .then((content) => startSixDimensionReviewRun({
        fileContent: content,
        projectPath: project.path,
        selectedFile: selectedReviewFilePath,
        t,
      }))
      .catch((error) => {
        console.error("[ReviewCenterView] 读取审查章节失败:", error)
      })
  }, [isReviewing, project?.path, selectedReviewFilePath, t])

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleStartReview}
      disabled={!canReview}
      title={selectedReviewFilePath ? undefined : "请先在左侧选择审查章节"}
    >
      {isReviewing ? t("reviewCenter.reviewingAction") : t("reviewCenter.startReview")}
    </Button>
  )
}
