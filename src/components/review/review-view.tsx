import { useState, useCallback, useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import i18n from "@/i18n"
import type { NovelReviewResult } from "@/lib/novel/review-adapter"
import {
  AlertTriangle,
  Copy,
  FileQuestion,
  CheckCircle2,
  Lightbulb,
  MessageSquare,
  X,
  Check,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useReviewStore, type ReviewItem } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"
import { resolveDefaultModel } from "@/lib/novel/model-resolver"
import { writeFile, readFile, listDirectory, deleteFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { loadCognitionState, type CognitionState } from "@/lib/novel/character-cognition"
import {
  deleteGenerationHistoryEntry,
  listGenerationHistory,
  type GenerationHistoryEntry,
} from "@/lib/novel/generation-history"
import { startNovelReviewRun } from "@/lib/novel/start-review-run"
import { startSixDimensionReviewRun } from "@/lib/novel/start-six-dimension-review-run"
import { SIX_REVIEW_DIMENSIONS, type SixReviewDimensionKey } from "@/lib/novel/dimension-review-adapter"
import { streamChat } from "@/lib/llm-client"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import {
  createEmptyDashboardIssueState,
  loadDashboardIssueState,
  restoreDashboardRewriteInMarkdown,
  saveDashboardIssueState,
  type DashboardIssueState,
} from "@/lib/dashboard-issue-actions"
import {
  buildVisibleNovelReviewActionItemsForDimensionResults,
  buildVisibleNovelReviewActionItemsForScoreDimensions,
  buildVisibleNovelReviewActionItems,
  type NovelReviewActionItem,
} from "@/lib/novel-review-action-items"
import {
  applyReviewRewriteEditsToMarkdown,
  buildReviewRewritePlanMessages,
  findReviewRewriteAnchors,
  parseReviewRewritePlan,
  type ReviewRewriteEdit,
} from "@/lib/review-rewrite-plan"

const typeConfig: Record<ReviewItem["type"], { icon: typeof AlertTriangle; labelKey: string; novelLabelKey: string; color: string }> = {
  contradiction: { icon: AlertTriangle, labelKey: "review.typeLabels.contradiction", novelLabelKey: "novel.review.typeLabels.contradiction", color: "text-amber-500" },
  duplicate: { icon: Copy, labelKey: "review.typeLabels.duplicate", novelLabelKey: "novel.review.typeLabels.duplicate", color: "text-blue-500" },
  "missing-page": { icon: FileQuestion, labelKey: "review.typeLabels.missingPage", novelLabelKey: "novel.review.typeLabels.missingPage", color: "text-purple-500" },
  confirm: { icon: MessageSquare, labelKey: "review.typeLabels.confirm", novelLabelKey: "novel.review.typeLabels.confirm", color: "text-foreground" },
  suggestion: { icon: Lightbulb, labelKey: "review.typeLabels.suggestion", novelLabelKey: "novel.review.typeLabels.suggestion", color: "text-emerald-500" },
}

interface ReviewRewriteEditState extends ReviewRewriteEdit {
  status: "pending" | "ignored"
  editing: boolean
}

interface ReviewRewriteDialogState {
  item: NovelReviewActionItem
  targetPath: string
  chapterContent: string
  edits: ReviewRewriteEditState[]
}

interface ReviewViewProps {
  title?: string
  emptyMessage?: string
  resultScoreDimensionKeys?: string[]
  dimensionKey?: SixReviewDimensionKey
  /** 只展示角色一致性（character_consistency）类型的问题 */
  characterOnly?: boolean
}

export function ReviewView({
  title,
  emptyMessage,
  resultScoreDimensionKeys,
  dimensionKey,
  characterOnly = false,
}: ReviewViewProps = {}) {
  const { t } = useTranslation()
  const novelMode = useWikiStore((s) => s.novelMode)
  const items = useReviewStore((s) => s.items)
  const resolveItem = useReviewStore((s) => s.resolveItem)
  const dismissItem = useReviewStore((s) => s.dismissItem)
  const clearResolved = useReviewStore((s) => s.clearResolved)
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const selectedReviewFilePath = useWikiStore((s) => s.selectedReviewFilePath)
  const fileContent = useWikiStore((s) => s.fileContent)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setPendingEditorHighlight = useWikiStore((s) => s.setPendingEditorHighlight)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const reviewRun = useWikiStore((s) => s.reviewRun)
  const allReviewResults = reviewRun?.results ?? []
  // characterOnly 模式下只展示角色一致性（character_consistency）类型的问题
  const novelReviewResults = characterOnly
    ? allReviewResults.filter((item) => item.type === "character_consistency")
    : allReviewResults
  const isReviewing = reviewRun?.running ?? false
  const reviewError = reviewRun?.error
  const [reviewHistory, setReviewHistory] = useState<GenerationHistoryEntry[]>([])
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null)
  const [cognitionState, setCognitionState] = useState<CognitionState | null>(null)
  const [cognitionExpanded, setCognitionExpanded] = useState(false)
  const [issueState, setIssueState] = useState<DashboardIssueState>(createEmptyDashboardIssueState())
  const [rewriteDialog, setRewriteDialog] = useState<ReviewRewriteDialogState | null>(null)
  const [rewriteBusyId, setRewriteBusyId] = useState<string | null>(null)
  const [rewriteError, setRewriteError] = useState<string | null>(null)

  const dimensionScoped = Boolean(dimensionKey) || resultScoreDimensionKeys !== undefined
  const selectedDimensionResult = dimensionKey ? reviewRun?.dimensionResults?.[dimensionKey] : undefined
  const selectedDimensionThinking = dimensionKey ? reviewRun?.dimensionThinking?.[dimensionKey] : undefined
  const novelReviewActionItems = useMemo(
    () => dimensionKey
      ? buildVisibleNovelReviewActionItemsForDimensionResults(
        reviewRun?.filePath,
        reviewRun?.dimensionResults,
        issueState.ignored,
        dimensionKey,
      )
      : dimensionScoped
      ? buildVisibleNovelReviewActionItemsForScoreDimensions(
        reviewRun?.filePath,
        novelReviewResults,
        issueState.ignored,
        resultScoreDimensionKeys ?? [],
      )
      : buildVisibleNovelReviewActionItems(reviewRun?.filePath, novelReviewResults, issueState.ignored),
    [dimensionKey, dimensionScoped, issueState.ignored, novelReviewResults, resultScoreDimensionKeys, reviewRun?.dimensionResults, reviewRun?.filePath],
  )

  useEffect(() => {
    if (!novelMode || !project) {
      setCognitionState(null)
      return
    }
    loadCognitionState(project.path).then(setCognitionState).catch(() => setCognitionState(null))
  }, [novelMode, project, novelReviewResults])

  useEffect(() => {
    if (!project?.path) {
      setIssueState(createEmptyDashboardIssueState())
      return
    }
    let cancelled = false
    loadDashboardIssueState(project.path)
      .then((state) => {
        if (!cancelled) setIssueState(state)
      })
      .catch(() => {
        if (!cancelled) setIssueState(createEmptyDashboardIssueState())
      })
    return () => { cancelled = true }
  }, [project?.path])

  const loadReviewHistory = useCallback(async () => {
    if (!project) {
      setReviewHistory([])
      return
    }
    setReviewHistory(await listGenerationHistory(project.path, "review"))
  }, [project])

  useEffect(() => {
    if (novelMode && project) {
      void loadReviewHistory()
      return
    }
    setReviewHistory([])
    setExpandedHistoryId(null)
  }, [novelMode, project, loadReviewHistory])

  const persistIssueState = useCallback(async (nextState: DashboardIssueState) => {
    setIssueState(nextState)
    if (project?.path) {
      await saveDashboardIssueState(project.path, nextState)
    }
  }, [project?.path])

  const showAiRewriteAlert = useCallback((message: string) => {
    window.alert(`AI修改暂时无法继续：${message}`)
  }, [])

  const openNovelReviewActionItem = useCallback(async (item: NovelReviewActionItem, highlight = false) => {
    try {
      const content = await readFile(item.targetPath)
      setSelectedFile(item.targetPath)
      setFileContent(content)
      setActiveView("wiki")
      if (highlight) {
        const anchor = findReviewRewriteAnchors(content, [item.evidence, item.secondaryEvidence])[0]
        if (anchor) {
          setPendingEditorHighlight({
            path: item.targetPath,
            text: anchor.selection.text,
            nonce: Date.now(),
          })
        }
      }
      return { path: item.targetPath, content }
    } catch (error) {
      console.error("[ReviewView] open AI review item failed:", error)
      return null
    }
  }, [setActiveView, setFileContent, setPendingEditorHighlight, setSelectedFile])

  const handleIgnoreNovelReviewItem = useCallback(async (item: NovelReviewActionItem) => {
    if (issueState.ignored[item.id]) return
    await persistIssueState({
      ...issueState,
      ignored: {
        ...issueState.ignored,
        [item.id]: true,
      },
    })
  }, [issueState, persistIssueState])

  const generateNovelReviewRewriteEdits = useCallback(async (
    item: NovelReviewActionItem,
    chapterContent: string,
    targetOriginalText?: string,
  ): Promise<ReviewRewriteEdit[]> => {
    const llmConfig = resolveDefaultModel(useWikiStore.getState().llmConfig)
    const directAnchors = targetOriginalText
      ? findReviewRewriteAnchors(chapterContent, [targetOriginalText])
      : findReviewRewriteAnchors(chapterContent, [item.evidence, item.secondaryEvidence])

    let rawResponse = ""
    await streamChat(
      llmConfig,
      buildReviewRewritePlanMessages({
        message: item.message,
        suggestion: item.suggestion,
        evidence: targetOriginalText || item.evidence,
        secondaryEvidence: targetOriginalText ? undefined : item.secondaryEvidence,
        chapterContent,
        directAnchors,
      }),
      {
        onToken: (token) => {
          rawResponse += token
        },
        onDone: () => {},
        onError: (error) => {
          throw error
        },
      },
    )
    const parsed = parseReviewRewritePlan(rawResponse)
    if (parsed.length > 0 || !targetOriginalText) return parsed
    const fallbackReplacement = rawResponse
      .trim()
      .replace(/^```(?:json|markdown|md)?/i, "")
      .replace(/```$/i, "")
      .trim()
    if (!fallbackReplacement) return []
    return [{
      id: "edit-1",
      originalText: targetOriginalText,
      replacementText: fallbackReplacement,
    }]
  }, [])

  const runNovelReviewAiRewrite = useCallback(async (item: NovelReviewActionItem) => {
    if (!project) {
      showAiRewriteAlert("当前没有打开项目。")
      return
    }
    const llmConfig = resolveDefaultModel(useWikiStore.getState().llmConfig)
    if (!hasUsableLlm(llmConfig)) {
      showAiRewriteAlert("请先在设置里配置可用的 AI 模型。")
      return
    }

    const chapterContent = await readFile(item.targetPath).catch(() => "")
    if (!chapterContent) {
      showAiRewriteAlert("没有找到对应章节，暂时无法改写。")
      return
    }

    setRewriteBusyId(item.id)
    setRewriteError(null)
    setRewriteDialog({
      item,
      targetPath: item.targetPath,
      chapterContent,
      edits: [],
    })

    try {
      const edits = await generateNovelReviewRewriteEdits(item, chapterContent)
      if (edits.length === 0) {
        setRewriteError("AI 没有返回可用的修改项，请重新生成或检查模型设置。")
        return
      }
      setRewriteDialog((current) => {
        if (!current || current.item.id !== item.id) return current
        return {
          ...current,
          edits: edits.map((edit, index) => ({
            ...edit,
            id: `${item.id}:edit-${index + 1}`,
            status: "pending",
            editing: false,
          })),
        }
      })
    } catch (error) {
      console.error("[ReviewView] AI review rewrite failed:", error)
      setRewriteError(error instanceof Error ? error.message : "生成失败，请稍后重试。")
    } finally {
      setRewriteBusyId(null)
    }
  }, [generateNovelReviewRewriteEdits, project, showAiRewriteAlert])

  const handleApplyRewrite = useCallback(async () => {
    if (!rewriteDialog) return
    if (rewriteBusyId === rewriteDialog.item.id) return
    if (rewriteError) return
    const activeEdits = rewriteDialog.edits
      .filter((edit) => edit.status !== "ignored" && edit.replacementText.trim())
      .map((edit) => ({
        id: edit.id,
        originalText: edit.originalText,
        replacementText: edit.replacementText,
        note: edit.note,
      }))
    if (activeEdits.length === 0) {
      setRewriteError("没有可确认的修改项。")
      return
    }

    const latestMarkdown = await readFile(rewriteDialog.targetPath).catch(() => "")
    if (!latestMarkdown) return

    const applyResult = applyReviewRewriteEditsToMarkdown(latestMarkdown, activeEdits)
    if (!applyResult.ok) {
      setRewriteError(`有 ${applyResult.failed.length} 条原文片段没有定位到，已取消写入。请重新生成或编辑原文片段。`)
      return
    }

    await writeFile(rewriteDialog.targetPath, applyResult.markdown)
    bumpDataVersion()
    if (selectedFile === rewriteDialog.targetPath) {
      setFileContent(applyResult.markdown)
      setPendingEditorHighlight({
        path: rewriteDialog.targetPath,
        text: activeEdits[0]?.replacementText ?? "",
        nonce: Date.now(),
      })
    }

    const nextRewrites = { ...issueState.rewrites }
    for (const applied of applyResult.applied) {
      nextRewrites[applied.edit.id] = {
        ...applied.backup,
        itemId: applied.edit.id,
        targetPath: rewriteDialog.targetPath,
      }
    }

    await persistIssueState({
      ...issueState,
      rewrites: nextRewrites,
    })
    setRewriteError(null)
    setRewriteDialog(null)
  }, [bumpDataVersion, issueState, persistIssueState, rewriteBusyId, rewriteDialog, rewriteError, selectedFile, setFileContent, setPendingEditorHighlight])

  const handleRegenerateAllRewrite = useCallback(async () => {
    if (!rewriteDialog) return
    setRewriteError(null)
    await runNovelReviewAiRewrite(rewriteDialog.item)
  }, [rewriteDialog, runNovelReviewAiRewrite])

  const handleRegenerateOneRewrite = useCallback(async (editId: string) => {
    if (!rewriteDialog) return
    const edit = rewriteDialog.edits.find((item) => item.id === editId)
    if (!edit) return

    setRewriteBusyId(editId)
    setRewriteError(null)
    try {
      const latestMarkdown = await readFile(rewriteDialog.targetPath).catch(() => rewriteDialog.chapterContent)
      const edits = await generateNovelReviewRewriteEdits(rewriteDialog.item, latestMarkdown, edit.originalText)
      const nextEdit = edits[0]
      if (!nextEdit) {
        setRewriteError("AI 没有返回可用的单条修改结果。")
        return
      }
      setRewriteDialog((current) => {
        if (!current || current.item.id !== rewriteDialog.item.id) return current
        return {
          ...current,
          edits: current.edits.map((row) => row.id === editId
            ? {
              ...row,
              replacementText: nextEdit.replacementText,
              note: nextEdit.note,
              status: "pending",
            }
            : row),
        }
      })
    } catch (error) {
      setRewriteError(error instanceof Error ? error.message : "重新生成失败，请稍后重试。")
    } finally {
      setRewriteBusyId(null)
    }
  }, [generateNovelReviewRewriteEdits, rewriteDialog])

  const handleRestoreRewrite = useCallback(async (item: NovelReviewActionItem) => {
    const backupEntries = Object.entries(issueState.rewrites)
      .filter(([key]) => key === item.id || key.startsWith(`${item.id}:`))
      .reverse()
    if (backupEntries.length === 0) return

    const firstBackup = backupEntries[0][1]
    const latestMarkdown = await readFile(firstBackup.targetPath).catch(() => "")
    if (!latestMarkdown) return

    let restoredMarkdown = latestMarkdown
    for (const [, backup] of backupEntries) {
      const nextMarkdown = restoreDashboardRewriteInMarkdown(restoredMarkdown, backup)
      if (nextMarkdown) restoredMarkdown = nextMarkdown
    }

    await writeFile(firstBackup.targetPath, restoredMarkdown)
    bumpDataVersion()
    if (selectedFile === firstBackup.targetPath) {
      setFileContent(restoredMarkdown)
      setPendingEditorHighlight({
        path: firstBackup.targetPath,
        text: firstBackup.originalText,
        nonce: Date.now(),
      })
    }

    const rest = { ...issueState.rewrites }
    for (const [key] of backupEntries) {
      delete rest[key]
    }
    await persistIssueState({
      ...issueState,
      rewrites: rest,
    })
  }, [bumpDataVersion, issueState, persistIssueState, selectedFile, setFileContent, setPendingEditorHighlight])

  const handleViewRewrite = useCallback(async (item: NovelReviewActionItem) => {
    const backupEntries = Object.entries(issueState.rewrites)
      .filter(([key]) => key === item.id || key.startsWith(`${item.id}:`))
      .map(([, backup]) => backup)
    const firstBackup = backupEntries[0]
    if (!firstBackup) return
    const latestMarkdown = await readFile(firstBackup.targetPath).catch(() => "")
    if (!latestMarkdown) return

    const highlightText = backupEntries
      .map((backup) => backup.replacementText)
      .find((text) => text && latestMarkdown.includes(text))
      || firstBackup.replacementText

    setSelectedFile(firstBackup.targetPath)
    setFileContent(latestMarkdown)
    setActiveView("wiki")
    setPendingEditorHighlight({
      path: firstBackup.targetPath,
      text: highlightText,
      nonce: Date.now(),
    })
  }, [issueState.rewrites, setActiveView, setFileContent, setPendingEditorHighlight, setSelectedFile])

  const renderNovelReviewActionBar = useCallback((item: NovelReviewActionItem) => {
    const hasBackup = Object.keys(issueState.rewrites).some((key) => key === item.id || key.startsWith(`${item.id}:`))
    const isRewriting = Boolean(rewriteBusyId && (rewriteBusyId === item.id || rewriteBusyId.startsWith(`${item.id}:`)))
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            void runNovelReviewAiRewrite(item)
          }}
          disabled={isRewriting}
          className="rounded border border-border px-2 py-1 text-[11px] text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRewriting ? t("dashboard.actions.rewriting") : t("dashboard.actions.aiRewrite")}
        </button>
        {hasBackup ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              void handleViewRewrite(item)
            }}
            className="rounded border border-border px-2 py-1 text-[11px] text-foreground hover:bg-accent"
          >
            {t("dashboard.actions.viewRewrite")}
          </button>
        ) : null}
        {hasBackup ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              void handleRestoreRewrite(item)
            }}
            className="rounded border border-border px-2 py-1 text-[11px] text-foreground hover:bg-accent"
          >
            {t("dashboard.actions.restore")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            void handleIgnoreNovelReviewItem(item)
          }}
          className="rounded border border-border px-2 py-1 text-[11px] text-foreground hover:bg-accent"
        >
          {t("dashboard.actions.ignore")}
        </button>
      </div>
    )
  }, [handleIgnoreNovelReviewItem, handleRestoreRewrite, handleViewRewrite, issueState.rewrites, rewriteBusyId, runNovelReviewAiRewrite, t])

  const handleRewriteEditReplacementChange = useCallback((editId: string, replacementText: string) => {
    setRewriteDialog((current) => current
      ? {
        ...current,
        edits: current.edits.map((edit) => edit.id === editId
          ? { ...edit, replacementText, status: "pending" }
          : edit),
      }
      : current)
  }, [])

  const handleRewriteEditIgnoredChange = useCallback((editId: string, ignored: boolean) => {
    setRewriteDialog((current) => current
      ? {
        ...current,
        edits: current.edits.map((edit) => edit.id === editId
          ? { ...edit, status: ignored ? "ignored" : "pending" }
          : edit),
      }
      : current)
  }, [])

  const handleIgnoreAllRewriteEdits = useCallback(() => {
    setRewriteDialog((current) => current
      ? {
        ...current,
        edits: current.edits.map((edit) => ({ ...edit, status: "ignored" })),
      }
      : current)
  }, [])

  const handleEditAllRewriteEdits = useCallback(() => {
    setRewriteDialog((current) => current
      ? {
        ...current,
        edits: current.edits.map((edit) => ({ ...edit, status: "pending", editing: true })),
      }
      : current)
  }, [])

  const handleDeleteHistory = useCallback(async (entry: GenerationHistoryEntry) => {
    if (!project) return
    const confirmed = window.confirm(t("novel.history.deleteConfirm"))
    if (!confirmed) return
    await deleteGenerationHistoryEntry(project.path, entry.filePath)
    setExpandedHistoryId((current) => current === entry.id ? null : current)
    await loadReviewHistory()
  }, [project, loadReviewHistory, t])

  const handleNovelReview = useCallback(async () => {
    const reviewFilePath = selectedReviewFilePath || selectedFile
    if (!project || !reviewFilePath) return
    const reviewFileContent = reviewFilePath === selectedFile ? fileContent : await readFile(reviewFilePath)
    if (!reviewFileContent.trim()) return
    if (dimensionKey) {
      await startSixDimensionReviewRun({
        fileContent: reviewFileContent,
        projectPath: project.path,
        selectedFile: reviewFilePath,
        t,
        onHistorySaved: loadReviewHistory,
        dimensionKey,
      })
      return
    }
    await startNovelReviewRun({
      fileContent: reviewFileContent,
      projectPath: project.path,
      selectedFile: reviewFilePath,
      t,
      onHistorySaved: loadReviewHistory,
    })
    /*
    return
    const parsed = parseFrontmatter(fileContent)
    const meta = parsed.frontmatter ? parseChapterMeta(parsed.frontmatter as Record<string, unknown>) : null
    const runId = `${Date.now()}-${Math.random()}`
    setReviewRun({ runId, projectPath: project.path, filePath: selectedFile, running: true, results: [] })
    try {
      const results = await reviewChapter(project.path, fileContent, meta?.chapterNumber)
      useWikiStore.getState().finishReviewRun(runId, { running: true, results, error: undefined })
      await saveGenerationHistoryEntry(project.path, {
        kind: "review",
        title: meta?.chapterNumber ? t("novel.review.historyEntryTitle", { chapter: meta.chapterNumber }) : t("novel.review.historyEntryTitleNoChapter"),
        chapterNumber: meta?.chapterNumber,
        sourcePath: selectedFile,
        results,
      })
      await loadReviewHistory()
      if (meta?.chapterNumber) {
        await persistRevisionFeedbackForChapter(
          project.path,
          meta.chapterNumber,
          "review",
          pickRevisionFeedbackFromReviewResults(results),
        )
      }
    } catch (err) {
      console.error("审稿失败:", err)
      useWikiStore.getState().finishReviewRun(runId, { running: false, error: t("novel.review.runFailed") })
    } finally {
      const current = useWikiStore.getState().reviewRun
      if (current?.runId === runId) {
        useWikiStore.getState().finishReviewRun(runId, { running: false, results: current.results })
      }
    }
    */
  }, [dimensionKey, fileContent, project, selectedFile, selectedReviewFilePath, t, loadReviewHistory])

  const handleResolve = useCallback(async (id: string, action: string) => {
    const novelMode = useWikiStore.getState().novelMode
    const pp = project ? normalizePath(project.path) : ""
    if (action.startsWith("save:") && project) {
      try {
        const encoded = action.slice(5)
        const content = decodeURIComponent(atob(encoded))
        const cleanContent = content
          .replace(/<!--\s*save-worthy:.*?-->/g, "")
          .replace(/<!--\s*sources:.*?-->/g, "")
          .trimEnd()

        const firstLine = cleanContent.split("\n").find((l) => l.trim() && !l.startsWith("<!--"))?.replace(/^#+\s*/, "").trim() ?? i18n.t("review.fallbacks.savedQueryTitle")
        const title = firstLine.slice(0, 60)
        const slug = title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 50)
        const date = new Date().toISOString().slice(0, 10)
        const fileName = `${slug}-${date}.md`
        const filePath = `${pp}/wiki/queries/${fileName}`

        const frontmatter = `---\ntype: query\ntitle: "${title.replace(/"/g, '\\"')}"\ncreated: ${date}\ntags: []\n---\n\n`
        await writeFile(filePath, frontmatter + cleanContent)

        const indexPath = `${pp}/wiki/index.md`
        let indexContent = ""
        try { indexContent = await readFile(indexPath) } catch { indexContent = "# Wiki Index\n" }
        const entry = `- [[queries/${slug}-${date}|${title}]]`
        if (indexContent.includes("## Queries")) {
          indexContent = indexContent.replace(/(## Queries\n)/, `$1${entry}\n`)
        } else {
          indexContent = indexContent.trimEnd() + "\n\n## Queries\n" + entry + "\n"
        }
        await writeFile(indexPath, indexContent)

        const logPath = `${pp}/wiki/log.md`
        let logContent = ""
        try { logContent = await readFile(logPath) } catch { logContent = "# Wiki Log\n" }
        await writeFile(logPath, logContent.trimEnd() + `\n- ${date}: Saved query page \`${fileName}\`\n`)

        const tree = await listDirectory(pp)
        setFileTree(tree)
        resolveItem(id, novelMode ? i18n.t("novel.review.notifications.savedToChapterLibrary") : i18n.t("review.notifications.savedToWiki"))
      } catch (err) {
        console.error("审稿页面写入 wiki 失败:", err)
        resolveItem(id, novelMode ? i18n.t("novel.review.notifications.saveFailed") : i18n.t("review.notifications.saveFailed"))
      }
    } else if (action.startsWith("open:") && project) {
      const page = action.slice(5)
      const candidates = [
        `${pp}/wiki/${page}`,
        `${pp}/wiki/${page}.md`,
      ]
      for (const path of candidates) {
        try {
          const content = await readFile(path)
          useWikiStore.getState().setSelectedFile(path)
          useWikiStore.getState().setFileContent(content)
          useWikiStore.getState().setActiveView("wiki")
          break
        } catch {
        }
      }
      resolveItem(id, novelMode ? i18n.t("novel.review.notifications.openedChapter", { page }) : i18n.t("review.notifications.openedPage", { page }))
    } else if (action.startsWith("delete:") && project) {
      const filePath = action.slice(7)
      try {
        await deleteFile(filePath)
        const tree = await listDirectory(pp)
        setFileTree(tree)
        resolveItem(id, i18n.t("review.notifications.deleted"))
      } catch (err) {
        console.error("删除失败:", err)
        resolveItem(id, i18n.t("review.notifications.deleteFailed"))
      }
    } else if ((action.startsWith("__create_page__:") || actionLooksLikeCreate(action)) && project) {
      const realAction = action.startsWith("__create_page__:")
        ? action.slice("__create_page__:".length)
        : action
      const item = items.find((i) => i.id === id)
      if (item) {
        try {
          const titlePrefixPattern = new RegExp(`^(${i18n.t("review.fallbacks.stripTitlePrefixes")})[:\\s]*`, "i")
          const title = item.title.replace(titlePrefixPattern, "").trim() || i18n.t("review.fallbacks.untitled")
          const slug = title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 50)
          const date = new Date().toISOString().slice(0, 10)

          const pageType = detectPageType(realAction, item.type)
          const dir = pageType === "query" ? "queries" : pageType === "entity" ? "entities" : pageType === "concept" ? "concepts" : "queries"
          const fileName = `${slug}-${date}.md`
          const filePath = `${pp}/wiki/${dir}/${fileName}`

          const frontmatter = `---\ntype: ${pageType}\ntitle: "${title.replace(/"/g, '\\"')}"\ncreated: ${date}\ntags: []\nrelated: []\n---\n\n`
          const body = `# ${title}\n\n${item.description}\n`
          await writeFile(filePath, frontmatter + body)

          const indexPath = `${pp}/wiki/index.md`
          let indexContent = ""
          try { indexContent = await readFile(indexPath) } catch { indexContent = "# Wiki Index\n" }
          const sectionHeader = `## ${dir.charAt(0).toUpperCase() + dir.slice(1)}`
          const entry = `- [[${dir}/${slug}-${date}|${title}]]`
          if (indexContent.includes(sectionHeader)) {
            indexContent = indexContent.replace(new RegExp(`(${sectionHeader}\n)`), `$1${entry}\n`)
          } else {
            indexContent = indexContent.trimEnd() + `\n\n${sectionHeader}\n${entry}\n`
          }
          await writeFile(indexPath, indexContent)

          const logPath = `${pp}/wiki/log.md`
          let logContent = ""
          try { logContent = await readFile(logPath) } catch { logContent = "# Wiki Log\n" }
          await writeFile(logPath, logContent.trimEnd() + `\n- ${date}: Created ${pageType} page \`${fileName}\` from review\n`)

          const tree = await listDirectory(pp)
          setFileTree(tree)
          useWikiStore.getState().bumpDataVersion()

          resolveItem(id, novelMode ? i18n.t("novel.review.notifications.created", { title }) : i18n.t("review.notifications.createdPage", { title }))
        } catch (err) {
          console.error("审稿创建页面失败:", err)
          resolveItem(id, novelMode ? i18n.t("novel.review.notifications.createFailed") : i18n.t("review.notifications.createFailed"))
        }
      } else {
        resolveItem(id, i18n.t("review.fallbacks.genericActionLabel"))
      }
    } else {
      resolveItem(id, i18n.t("review.fallbacks.genericActionLabel"))
    }
  }, [project, items, resolveItem, setFileTree])

  const pending = dimensionScoped ? [] : items.filter((i) => !i.resolved)
  const resolved = dimensionScoped ? [] : items.filter((i) => i.resolved)
  const headerCount = dimensionScoped ? novelReviewActionItems.length : pending.length
  const showReviewHistory = !dimensionScoped && reviewHistory.length > 0
  const showCognition = !dimensionScoped && novelMode && cognitionState
  const reviewThinkingContent = dimensionKey ? selectedDimensionThinking : reviewRun?.thinking
  const reviewThinkingTitle = dimensionKey ? "六维阶段式审查" : "阶段式深度审稿"
  const reviewButtonLabel = isReviewing
    ? (dimensionKey ? reviewRun?.dimensionProgress || "正在审查此维度" : t("novel.review.reviewing"))
    : (dimensionKey ? "重新审查此维度" : t("novel.review.startReview"))

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          {title || t(novelMode ? "novel.review.title" : "review.title")}
          {headerCount > 0 && (
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
              {headerCount}
            </span>
          )}
        </h2>
        {novelMode && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleNovelReview}
            disabled={isReviewing || !(selectedReviewFilePath || selectedFile)}
            className="ml-auto"
          >
            {reviewButtonLabel}
          </Button>
        )}
        {resolved.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearResolved} className="text-xs">
            <Trash2 className="mr-1 h-3 w-3" />
            {t(novelMode ? "novel.review.clearResolved" : "review.clearResolved")}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {reviewError && (
          <div className="m-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{reviewError}</span>
          </div>
        )}
        {dimensionKey && selectedDimensionResult && (
          <div className="m-3 rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">
                {SIX_REVIEW_DIMENSIONS[dimensionKey].label}评分：{selectedDimensionResult.score}
              </span>
              <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {selectedDimensionResult.status}
              </span>
            </div>
            {selectedDimensionResult.summary && (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{selectedDimensionResult.summary}</p>
            )}
          </div>
        )}
        {isReviewing && reviewThinkingContent && (
          <div className="m-3 rounded-md border bg-muted/40 p-3 text-xs">
            <div className="mb-2 font-medium text-foreground">{reviewThinkingTitle}</div>
            <pre className="max-h-52 whitespace-pre-wrap overflow-auto text-muted-foreground">
              {reviewThinkingContent}
            </pre>
          </div>
        )}
        {pending.length === 0 && resolved.length === 0 && novelReviewActionItems.length === 0 && !showReviewHistory ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-muted-foreground/30" />
            <p>{emptyMessage || t(novelMode ? "novel.review.allClear" : "review.allClear")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            {pending.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                onResolve={handleResolve}
                onDismiss={dismissItem}
              />
            ))}
            {resolved.length > 0 && pending.length > 0 && (
              <div className="my-2 text-center text-xs text-muted-foreground">
                — {t(novelMode ? "novel.review.resolvedSeparator" : "review.resolvedSeparator")} —
              </div>
            )}
            {resolved.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                onResolve={handleResolve}
                onDismiss={dismissItem}
              />
            ))}
            {novelReviewActionItems.length > 0 && (
              <div className={dimensionScoped ? "space-y-2" : "mt-4 space-y-2"}>
                {!dimensionScoped && (
                  <h3 className="text-xs font-semibold text-muted-foreground">
                    {t("novel.review.resultsTitle")}
                  </h3>
                )}
                {novelReviewActionItems.map((item) => {
                  const severityKey = `review.results.severity.${item.reviewSeverity}`
                  const dimensionKey = `review.results.dimension.${item.detail}`
                  const severityLabel = i18n.exists(severityKey) ? i18n.t(severityKey) : item.reviewSeverity
                  const typeLabel = i18n.exists(dimensionKey) ? i18n.t(dimensionKey) : item.detail

                  return (
                    <div
                      key={item.id}
                      onClick={() => void openNovelReviewActionItem(item)}
                      className={`cursor-pointer rounded-md border p-3 text-sm transition-colors hover:border-primary/50 ${
                        item.reviewSeverity === "error"
                          ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950"
                          : item.reviewSeverity === "warning"
                            ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
                            : "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{typeLabel}</span>
                        <span className="text-xs text-muted-foreground">{severityLabel}</span>
                      </div>
                      <p className="mt-1">{item.message}</p>
                      {item.evidence && (
                        <p className="mt-1 text-xs text-muted-foreground italic">「{item.evidence}」</p>
                      )}
                      {item.suggestion && (
                        <p className="mt-1 text-xs text-green-700 dark:text-green-400">
                          💡 {item.suggestion}
                        </p>
                      )}
                      {renderNovelReviewActionBar(item)}
                    </div>
                  )
                })}
              </div>
            )}
            {showReviewHistory && (
              <div className="mt-4 space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground">
                  {t("novel.review.historyTitle")}
                </h3>
                {reviewHistory.map((entry) => {
                  const entryResults = entry.results as NovelReviewResult[]
                  const errors = entryResults.filter((result) => result.severity === "error").length
                  const warnings = entryResults.filter((result) => result.severity === "warning").length
                  const expanded = expandedHistoryId === entry.id
                  return (
                    <div key={entry.id} className="rounded-md border p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left font-medium hover:text-primary"
                          onClick={() => setExpandedHistoryId(expanded ? null : entry.id)}
                        >
                          <span className="block truncate">{entry.title}</span>
                          <span className="text-muted-foreground">{entry.createdAt.slice(0, 10)} · {t("novel.review.historySummary", { errors, warnings })}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteHistory(entry)}
                          className="shrink-0 text-[10px] text-muted-foreground hover:text-destructive"
                        >
                          {t("novel.history.delete")}
                        </button>
                      </div>
                      {expanded && (
                        <div className="mt-2 space-y-1 border-t pt-2">
                          {entryResults.length === 0 ? (
                            <p className="text-muted-foreground">{t("novel.history.emptyResult")}</p>
                          ) : entryResults.map((result, index) => (
                            <div key={`${entry.id}-${index}`} className="rounded bg-muted/50 p-2">
                              <div className="font-medium">{i18n.exists(`review.results.dimension.${result.type}`) ? i18n.t(`review.results.dimension.${result.type}`) : result.type}</div>
                              <div className="text-muted-foreground">{result.message}</div>
                              {result.suggestion && <div className="mt-1 text-green-700 dark:text-green-400">{result.suggestion}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {showCognition && (
              <div className="mt-4 rounded-md border">
                <button
                  className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/50"
                  onClick={() => setCognitionExpanded(!cognitionExpanded)}
                >
                  <span>{t("novel.cognition.title")}</span>
                  <span className="text-[10px]">{cognitionExpanded ? "▲" : "▼"}</span>
                </button>
                {cognitionExpanded && (
                  <div className="space-y-2 border-t px-3 py-2 text-xs">
                    {cognitionState.lastUpdatedChapter > 0 && (
                      <p className="text-muted-foreground">
                        {t("novel.cognition.lastUpdated", { chapter: cognitionState.lastUpdatedChapter })}
                      </p>
                    )}
                    {cognitionState.characters.length === 0 && cognitionState.readerKnows.length === 0 ? (
                      <p className="text-muted-foreground">{t("novel.cognition.noData")}</p>
                    ) : (
                      <>
                        {cognitionState.characters.map((char) => (
                          <div key={char.character}>
                            <p className="font-medium">{char.character}</p>
                            {char.knows.length > 0 && (
                              <p className="ml-3 text-muted-foreground">
                                {t("novel.cognition.knows")}：{char.knows.join("、")}
                              </p>
                            )}
                            {char.doesNotKnow.length > 0 && (
                              <p className="ml-3 text-muted-foreground">
                                {t("novel.cognition.doesNotKnow")}：{char.doesNotKnow.join("、")}
                              </p>
                            )}
                          </div>
                        ))}
                        {cognitionState.readerKnows.length > 0 && (
                          <div>
                            <p className="font-medium">{t("novel.cognition.readerKnows")}</p>
                            <p className="ml-3 text-muted-foreground">{cognitionState.readerKnows.join("、")}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <ReviewRewritePreviewDialog
        open={Boolean(rewriteDialog)}
        edits={rewriteDialog?.edits ?? []}
        error={rewriteError}
        busy={Boolean(rewriteBusyId)}
        busyId={rewriteBusyId}
        onReplacementChange={handleRewriteEditReplacementChange}
        onIgnoredChange={handleRewriteEditIgnoredChange}
        onRegenerateOne={(editId) => void handleRegenerateOneRewrite(editId)}
        onRegenerateAll={() => void handleRegenerateAllRewrite()}
        onIgnoreAll={handleIgnoreAllRewriteEdits}
        onEditAll={handleEditAllRewriteEdits}
        onApply={() => void handleApplyRewrite()}
        onClose={() => {
          if (rewriteBusyId === rewriteDialog?.item.id) return
          setRewriteError(null)
          setRewriteDialog(null)
        }}
      />
    </div>
  )
}

function ReviewRewritePreviewDialog({
  open,
  edits,
  error,
  busy,
  busyId,
  onReplacementChange,
  onIgnoredChange,
  onRegenerateOne,
  onRegenerateAll,
  onIgnoreAll,
  onEditAll,
  onApply,
  onClose,
}: {
  open: boolean
  edits: ReviewRewriteEditState[]
  error: string | null
  busy: boolean
  busyId: string | null
  onReplacementChange: (editId: string, replacementText: string) => void
  onIgnoredChange: (editId: string, ignored: boolean) => void
  onRegenerateOne: (editId: string) => void
  onRegenerateAll: () => void
  onIgnoreAll: () => void
  onEditAll: () => void
  onApply: () => void
  onClose: () => void
}) {
  const activeCount = edits.filter((edit) => edit.status !== "ignored").length
  const hasPendingContent = edits.some((edit) => edit.status !== "ignored" && edit.replacementText.trim())

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>AI修改预览</DialogTitle>
          <DialogDescription>
            左侧是需要修改的原文，右侧是 AI 生成的新内容。确认后才会写入原章节。
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRegenerateAll} disabled={busy}>
            全部重新生成
          </Button>
          <Button variant="outline" size="sm" onClick={onIgnoreAll} disabled={busy || edits.length === 0}>
            全部忽略
          </Button>
          <Button variant="outline" size="sm" onClick={onEditAll} disabled={busy || edits.length === 0}>
            全部编辑
          </Button>
          {busy && (
            <span className="text-xs text-muted-foreground">正在生成修改内容，请稍候...</span>
          )}
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {edits.length === 0 ? (
            <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
              正在等待 AI 返回修改项。
            </div>
          ) : edits.map((edit, index) => {
            const ignored = edit.status === "ignored"
            const rowBusy = busyId === edit.id
            return (
              <div
                key={edit.id}
                className={`rounded-md border p-3 ${ignored ? "bg-muted/40 opacity-60" : "bg-background"}`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">修改 {index + 1}</span>
                  {edit.note ? <span className="text-xs text-muted-foreground">{edit.note}</span> : null}
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRegenerateOne(edit.id)}
                      disabled={busy}
                      className="h-7 text-xs"
                    >
                      {rowBusy ? "生成中..." : "重新生成"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onIgnoredChange(edit.id, !ignored)}
                      disabled={busy}
                      className="h-7 text-xs"
                    >
                      {ignored ? "恢复修改" : "忽略不改"}
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="min-h-0 rounded-md border bg-red-50/70 p-3 text-sm leading-6 whitespace-pre-wrap text-red-900 dark:bg-red-950/25 dark:text-red-200">
                    {edit.originalText}
                  </div>
                  <textarea
                    value={edit.replacementText}
                    onChange={(event) => onReplacementChange(edit.id, event.target.value)}
                    disabled={busy || ignored}
                    className="min-h-32 rounded-md border bg-emerald-50/70 p-3 text-sm leading-6 text-emerald-950 outline-none focus:border-ring disabled:opacity-70 dark:bg-emerald-950/25 dark:text-emerald-100"
                  />
                </div>
              </div>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={onApply} disabled={busy || !hasPendingContent || activeCount === 0}>
            确认修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReviewCard({
  item,
  onResolve,
  onDismiss,
}: {
  item: ReviewItem
  onResolve: (id: string, action: string) => void
  onDismiss: (id: string) => void
}) {
  const { t } = useTranslation()
  const novelMode = useWikiStore((s) => s.novelMode)
  const config = typeConfig[item.type]
  const Icon = config.icon

  return (
    <div
      className={`rounded-lg border p-3 text-sm transition-opacity ${
        item.resolved ? "opacity-50" : ""
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 shrink-0 ${config.color}`} />
          <span className="text-xs text-muted-foreground">{t(novelMode ? config.novelLabelKey : config.labelKey)}</span>
          <span className="font-medium">{item.title}</span>
        </div>
        <button
          onClick={() => onDismiss(item.id)}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">{item.description}</p>

      {item.affectedPages && item.affectedPages.length > 0 && (
        <div className="mb-3 text-xs text-muted-foreground">
          {t(novelMode ? "novel.review.pages" : "review.pages")}: {item.affectedPages.join(", ")}
        </div>
      )}

      {!item.resolved ? (
        <div className="flex flex-wrap gap-1.5">
          {item.options.map((opt) => (
            <Button
              key={opt.action}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onResolve(item.id, opt.action)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1 text-xs text-emerald-600">
          <Check className="h-3 w-3" />
          {item.resolvedAction}
        </div>
      )}
    </div>
  )
}

function actionIsDismissal(action: string): boolean {
  const lower = action.toLowerCase()
  return (
    lower === "skip" ||
    lower === "dismiss" ||
    lower === "ignore" ||
    lower === "跳过" ||
    lower === "忽略" ||
    lower === "approve" ||
    lower === "keep existing" ||
    lower === "no"
  )
}

function actionLooksLikeCreate(action: string): boolean {
  return !actionIsDismissal(action)
}

function detectPageType(action: string, reviewType: string): string {
  const lower = action.toLowerCase()
  if (lower.includes("entity") || lower.includes("实体")) return "entity"
  if (lower.includes("concept") || lower.includes("概念")) return "concept"
  if (lower.includes("comparison") || lower.includes("compare") || lower.includes("比较")) return "comparison"
  if (lower.includes("synthesis") || lower.includes("综合")) return "synthesis"
  if (reviewType === "missing-page") return "query"
  if (reviewType === "contradiction" || reviewType === "duplicate") return "entity"
  return "query"
}
