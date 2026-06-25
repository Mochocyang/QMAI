import type { TFunction } from "i18next"
import { parseFrontmatter } from "@/lib/frontmatter"
import { parseChapterMeta } from "@/lib/novel/chapter-meta"
import { reviewChapter } from "@/lib/novel/review-adapter"
import { persistRevisionFeedbackForChapter, pickRevisionFeedbackFromReviewResults } from "@/lib/novel/revision-feedback"
import { saveGenerationHistoryEntry } from "@/lib/novel/generation-history"
import { getFileStem } from "@/lib/path-utils"
import { useWikiStore } from "@/stores/wiki-store"
import { createReviewThinkingPublisher } from "./review-thinking-publisher"
import { yieldToBrowserFrame } from "./yield-to-browser"

interface StartNovelReviewRunArgs {
  fileContent: string
  projectPath: string
  selectedFile: string
  t: TFunction
  onHistorySaved?: () => Promise<void> | void
}

export interface ReviewChapterTarget {
  chapterNumber?: number
}

function parseChapterNumberFromSelectedFile(selectedFile: string): number | undefined {
  const stem = getFileStem(selectedFile).trim()
  const chineseChapter = stem.match(/第\s*0*(\d+)\s*章/)
  if (chineseChapter) return Number(chineseChapter[1])

  const slugChapter = stem.match(/chapter[-_\s]*0*(\d+)/i)
  if (slugChapter) return Number(slugChapter[1])

  const numericStem = stem.match(/^0*(\d+)$/)
  if (numericStem) return Number(numericStem[1])

  return undefined
}

export function resolveReviewChapterTarget(fileContent: string, selectedFile: string): ReviewChapterTarget {
  const parsed = parseFrontmatter(fileContent)
  const meta = parsed.frontmatter ? parseChapterMeta(parsed.frontmatter as Record<string, unknown>) : null
  const selectedChapterNumber = parseChapterNumberFromSelectedFile(selectedFile)

  return {
    chapterNumber: selectedChapterNumber ?? meta?.chapterNumber,
  }
}

export async function startNovelReviewRun({
  fileContent,
  projectPath,
  selectedFile,
  t,
  onHistorySaved,
}: StartNovelReviewRunArgs): Promise<void> {
  if (!selectedFile || !fileContent.trim()) return

  const target = resolveReviewChapterTarget(fileContent, selectedFile)
  const runId = `${Date.now()}-${Math.random()}`
  useWikiStore.getState().setReviewRun({ runId, projectPath, filePath: selectedFile, running: true, results: [] })
  await yieldToBrowserFrame()
  const thinkingPublisher = createReviewThinkingPublisher({
    publish: (thinking) => {
      useWikiStore.getState().finishReviewRun(runId, { running: true, thinking })
    },
  })

  try {
    const results = await reviewChapter(projectPath, fileContent, target.chapterNumber, {
      onThinking: (thinking) => {
        thinkingPublisher.publish(thinking)
      },
    })
    thinkingPublisher.flush()
    useWikiStore.getState().finishReviewRun(runId, { running: true, results, error: undefined })
    await saveGenerationHistoryEntry(projectPath, {
      kind: "review",
      title: target.chapterNumber ? t("novel.review.historyEntryTitle", { chapter: target.chapterNumber }) : t("novel.review.historyEntryTitleNoChapter"),
      chapterNumber: target.chapterNumber,
      sourcePath: selectedFile,
      results,
    })
    await onHistorySaved?.()

    if (target.chapterNumber) {
      await persistRevisionFeedbackForChapter(
        projectPath,
        target.chapterNumber,
        "review",
        pickRevisionFeedbackFromReviewResults(results),
      )
    }
  } catch (error) {
    console.error("审查失败:", error)
    thinkingPublisher.flush()
    useWikiStore.getState().finishReviewRun(runId, { running: false, error: t("novel.review.runFailed") })
  } finally {
    thinkingPublisher.flush()
    const current = useWikiStore.getState().reviewRun
    if (current?.runId === runId) {
      useWikiStore.getState().finishReviewRun(runId, { running: false, results: current.results })
    }
  }
}
