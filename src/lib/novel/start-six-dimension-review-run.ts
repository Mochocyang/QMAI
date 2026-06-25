import type { TFunction } from "i18next"
import { parseFrontmatter } from "@/lib/frontmatter"
import { parseChapterMeta } from "@/lib/novel/chapter-meta"
import { saveGenerationHistoryEntry } from "@/lib/novel/generation-history"
import { runSixDimensionReview, type SixReviewDimensionKey } from "@/lib/novel/dimension-review-adapter"
import { useWikiStore } from "@/stores/wiki-store"

interface StartSixDimensionReviewRunArgs {
  fileContent: string
  projectPath: string
  selectedFile: string
  t: TFunction
  onHistorySaved?: () => Promise<void> | void
  dimensionKey?: SixReviewDimensionKey
}

export async function startSixDimensionReviewRun({
  fileContent,
  projectPath,
  selectedFile,
  t,
  onHistorySaved,
  dimensionKey,
}: StartSixDimensionReviewRunArgs): Promise<void> {
  if (!selectedFile || !fileContent.trim()) return

  const parsed = parseFrontmatter(fileContent)
  const meta = parsed.frontmatter ? parseChapterMeta(parsed.frontmatter as Record<string, unknown>) : null
  const runId = `${Date.now()}-${Math.random()}`
  const currentRun = useWikiStore.getState().reviewRun
  const preservedDimensionResults = dimensionKey && currentRun?.filePath === selectedFile
    ? currentRun.dimensionResults ?? {}
    : {}
  useWikiStore.getState().setReviewRun({
    runId,
    projectPath,
    filePath: selectedFile,
    running: true,
    results: [],
    dimensionResults: preservedDimensionResults,
    dimensionThinking: {},
  })

  try {
    const dimensionResults = await runSixDimensionReview({
      projectPath,
      chapterContent: fileContent,
      chapterNumber: meta?.chapterNumber,
      dimensionKeys: dimensionKey ? [dimensionKey] : undefined,
      callbacks: {
        onDimensionProgress: (activeDimension, dimensionProgress) => {
          useWikiStore.getState().finishReviewRun(runId, {
            running: true,
            activeDimension,
            dimensionProgress,
          })
        },
        onDimensionThinking: (dimensionKey, thinking) => {
          const current = useWikiStore.getState().reviewRun
          useWikiStore.getState().finishReviewRun(runId, {
            running: true,
            activeDimension: dimensionKey,
            dimensionThinking: {
              ...(current?.dimensionThinking ?? {}),
              [dimensionKey]: thinking,
            },
          })
        },
        onDimensionResult: (dimensionKey, result) => {
          const current = useWikiStore.getState().reviewRun
          useWikiStore.getState().finishReviewRun(runId, {
            running: true,
            activeDimension: dimensionKey,
            dimensionResults: {
              ...(current?.dimensionResults ?? {}),
              [dimensionKey]: result,
            },
          })
        },
      },
    })

    const nextDimensionResults = {
      ...preservedDimensionResults,
      ...dimensionResults,
    }

    useWikiStore.getState().finishReviewRun(runId, {
      running: true,
      dimensionResults: nextDimensionResults,
      error: undefined,
    })
    await saveGenerationHistoryEntry(projectPath, {
      kind: "review",
      title: meta?.chapterNumber ? t("novel.review.historyEntryTitle", { chapter: meta.chapterNumber }) : t("novel.review.historyEntryTitleNoChapter"),
      chapterNumber: meta?.chapterNumber,
      sourcePath: selectedFile,
      results: [],
      dimensionResults: nextDimensionResults,
    })
    await onHistorySaved?.()
  } catch (error) {
    console.error("六维审查失败:", error)
    useWikiStore.getState().finishReviewRun(runId, { running: false, error: t("novel.review.runFailed") })
  } finally {
    const current = useWikiStore.getState().reviewRun
    if (current?.runId === runId) {
      useWikiStore.getState().finishReviewRun(runId, {
        running: false,
        results: current.results,
        dimensionResults: current.dimensionResults,
        activeDimension: undefined,
      })
    }
  }
}
