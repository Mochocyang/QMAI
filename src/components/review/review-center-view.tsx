import { IS_UI_TEST_BUILD } from "@/lib/ui-test"
import "@/components/uitest/ui-test-tools.css"
import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wiki-store"
import { useCallback, type ReactNode } from "react"
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
  const project = useWikiStore((s) => s.project)
  const selectedReviewFilePath = useWikiStore((s) => s.selectedReviewFilePath)
  const renderReview = (content: ReactNode) => IS_UI_TEST_BUILD ? (
    <section data-ui-page={IS_UI_TEST_BUILD ? "review" : undefined} data-ui-state={IS_UI_TEST_BUILD ? (selectedReviewDimension ?? "summary") : undefined}>
      <header data-ui="tool-heading">
        <div>
          <nav aria-label="面包屑" className="ui-test-breadcrumb">
            <span>{project?.name ?? "未选择项目"}</span><span aria-hidden="true">/</span><span>审稿</span>
            {selectedReviewFilePath && <><span aria-hidden="true">/</span><span aria-current="page">{selectedReviewFilePath.replace(/\\/g, "/").split("/").pop()}</span></>}
          </nav>
          <h1 className="ui-test-page-title">把故事，再打磨一次。</h1>
        </div>
      </header>
      <div data-ui="review-content">{content}</div>
    </section>
  ) : content

  if (selectedReviewDimension === "ai-review") {
    if (IS_UI_TEST_BUILD) return renderReview(<ReviewView />)
    return <ReviewView />
  }

  if (selectedReviewDimension === "character-report") {
    if (IS_UI_TEST_BUILD) return renderReview(<ReviewView title="角色命中报告" emptyMessage="暂无角色命中报告，请先运行AI审稿。" characterOnly />)
    return <ReviewView title="角色命中报告" emptyMessage="暂无角色命中报告，请先运行AI审稿。" characterOnly />
  }

  if (!selectedReviewDimension || !novelMode) {
    if (IS_UI_TEST_BUILD) return renderReview(<DashboardView headerActions={<ReviewStartButton />} />)
    return <DashboardView headerActions={<ReviewStartButton />} />
  }

  if (!isSixReviewDimensionKey(selectedReviewDimension)) {
    if (IS_UI_TEST_BUILD) return renderReview(<DashboardView headerActions={<ReviewStartButton />} />)
    return <DashboardView headerActions={<ReviewStartButton />} />
  }

  if (IS_UI_TEST_BUILD) return renderReview(
    <ReviewView
      title={t(`reviewCenter.dimension.${selectedReviewDimension}`)}
      emptyMessage={t("reviewCenter.noResults")}
      dimensionKey={selectedReviewDimension}
    />
  )

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
