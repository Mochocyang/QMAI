import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wiki-store"
import { ClipboardCheck, Sparkles, Users } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { listDirectory, readFile } from "@/commands/fs"
import { flattenMdFiles } from "@/lib/novel/chapter-utils"
import { parseFrontmatter } from "@/lib/frontmatter"
import { SIX_REVIEW_DIMENSIONS, SIX_REVIEW_DIMENSION_ORDER } from "@/lib/novel/dimension-review-adapter"

const SIX_DIMENSIONS = SIX_REVIEW_DIMENSION_ORDER.map((key) => ({
  key,
  labelKey: `reviewCenter.dimension.${key}`,
}))

export function ReviewCenterSidebarPanel() {
  const { t } = useTranslation()
  const selectedReviewDimension = useWikiStore((s) => s.selectedReviewDimension)
  const setSelectedReviewDimension = useWikiStore((s) => s.setSelectedReviewDimension)
  const reviewRun = useWikiStore((s) => s.reviewRun)
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const selectedReviewFilePath = useWikiStore((s) => s.selectedReviewFilePath)
  const setSelectedReviewFilePath = useWikiStore((s) => s.setSelectedReviewFilePath)
  const [chapterOptions, setChapterOptions] = useState<Array<{ path: string; label: string }>>([])

  useEffect(() => {
    if (!project?.path) {
      setChapterOptions([])
      setSelectedReviewFilePath("")
      return
    }

    let cancelled = false

    void listDirectory(`${project.path}/wiki/chapters`)
      .then(async (tree) => {
        if (cancelled) return
        const files = flattenMdFiles(tree)
        const options = await Promise.all(files.map(async (file) => {
          try {
            const content = await readFile(file.path)
            const parsed = parseFrontmatter(content)
            const fmTitle = typeof parsed.frontmatter?.title === "string" ? parsed.frontmatter.title.trim() : ""
            const headingTitle = parsed.body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? ""
            const baseTitle = fmTitle || headingTitle || file.name.replace(/\.md$/i, "")
            const label = baseTitle
            return {
              path: file.path,
              label,
            }
          } catch {
            return {
              path: file.path,
              label: file.name.replace(/\.md$/i, ""),
            }
          }
        }))
        setChapterOptions(options)
        const currentReviewFilePath = useWikiStore.getState().selectedReviewFilePath
        if (selectedFile && options.some((option) => option.path === selectedFile)) {
          setSelectedReviewFilePath(selectedFile)
        } else if (currentReviewFilePath && options.some((option) => option.path === currentReviewFilePath)) {
          setSelectedReviewFilePath(currentReviewFilePath)
        } else {
          setSelectedReviewFilePath(options[0]?.path ?? "")
        }
      })
      .catch(() => {
        if (cancelled) return
        setChapterOptions([])
        setSelectedReviewFilePath("")
      })

    return () => {
      cancelled = true
    }
  }, [project?.path, selectedFile, setSelectedReviewFilePath])

  const dimensionCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const dim of SIX_DIMENSIONS) {
      counts[dim.key] = reviewRun?.dimensionResults?.[dim.key]?.issues.length ?? 0
    }
    return counts
  }, [reviewRun?.dimensionResults])

  const totalBySeverity = useMemo(() => {
    const counts = { blocking: 0, high: 0, medium: 0, low: 0 }
    for (const key of SIX_REVIEW_DIMENSION_ORDER) {
      for (const issue of reviewRun?.dimensionResults?.[key]?.issues ?? []) {
        if (issue.severity === "error") counts.high++
        else if (issue.severity === "warning") counts.medium++
        else counts.low++
      }
    }
    return counts
  }, [reviewRun?.dimensionResults])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          {t("reviewCenter.title")}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-3">
          <div className="px-1 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("reviewCenter.chapterTarget")}
          </div>
          <select
            value={selectedReviewFilePath}
            onChange={(event) => setSelectedReviewFilePath(event.target.value)}
            disabled={chapterOptions.length === 0 || (reviewRun?.running ?? false)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {chapterOptions.length === 0 ? (
              <option value="">{t("reviewCenter.noChapterAvailable")}</option>
            ) : (
              chapterOptions.map((option) => (
                <option key={option.path} value={option.path}>
                  {option.label}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="mb-3">
          <div className="px-1 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("reviewCenter.aiReview")}
          </div>
          <button
            type="button"
            onClick={() => setSelectedReviewDimension("ai-review")}
            className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
              selectedReviewDimension === "ai-review" ? "qm-selected" : "text-muted-foreground qm-hover"
            }`}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <span>{t("reviewCenter.aiReview")}</span>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setSelectedReviewDimension("character-report")}
            className={`mt-1 w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
              selectedReviewDimension === "character-report" ? "qm-selected" : "text-muted-foreground qm-hover"
            }`}
          >
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span>角色命中报告</span>
            </div>
          </button>
        </div>

        <div className="mb-3">
          <div className="px-1 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("reviewCenter.sixDimensions")}
          </div>
          <div className="space-y-1">
            {SIX_DIMENSIONS.map((dim) => (
              <button
                key={dim.key}
                type="button"
                onClick={() => setSelectedReviewDimension(dim.key)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  selectedReviewDimension === dim.key ? "qm-selected" : "text-muted-foreground qm-hover"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="truncate">{t(dim.labelKey)}</span>
                  </div>
                  {dimensionCounts[dim.key] > 0 && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{dimensionCounts[dim.key]}</span>
                  )}
                  {(reviewRun?.running && reviewRun.activeDimension === dim.key) && (
                    <span className="text-xs text-primary">{SIX_REVIEW_DIMENSIONS[dim.key].label}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="px-1 text-xs text-muted-foreground">
          {t("reviewCenter.stats", totalBySeverity)}
        </div>
      </div>
    </div>
  )
}
