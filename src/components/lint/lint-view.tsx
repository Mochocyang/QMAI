import { useState, useCallback, useMemo, useEffect } from "react"
import i18n from "@/i18n"
import {
  Link2Off,
  Unlink,
  ArrowUpRight,
  AlertTriangle,
  Info,
  RefreshCw,
  CheckCircle2,
  BrainCircuit,
  Wrench,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { runStructuralLint, runSemanticLint, type LintResult } from "@/lib/lint"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { resolveDefaultModel, resolveNovelModel } from "@/lib/novel/model-resolver"
import { readFile, writeFile, listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { useTranslation } from "react-i18next"
import { parseFrontmatter } from "@/lib/frontmatter"
import { parseChapterMeta } from "@/lib/novel/chapter-meta"
import { persistRevisionFeedbackForChapter, pickRevisionFeedbackFromLintResults } from "@/lib/novel/revision-feedback"
import {
  deleteGenerationHistoryEntry,
  listGenerationHistory,
  saveGenerationHistoryEntry,
  type GenerationHistoryEntry,
} from "@/lib/novel/generation-history"

export function LintView() {
  const { t } = useTranslation()
  const novelMode = useWikiStore((s) => s.novelMode)
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const fileContent = useWikiStore((s) => s.fileContent)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const lintRun = useWikiStore((s) => s.lintRun)
  const setLintRun = useWikiStore((s) => s.setLintRun)

  // Dynamic type config based on i18n
  const typeConfig = useMemo(() => ({
    orphan: { icon: Unlink, label: t("lint.typeLabels.orphan") },
    "broken-link": { icon: Link2Off, label: t("lint.typeLabels.broken-link") },
    "no-outlinks": { icon: ArrowUpRight, label: t("lint.typeLabels.no-outlinks") },
    semantic: { icon: BrainCircuit, label: t("lint.typeLabels.semantic") },
  }), [t])

  const results = lintRun?.results ?? []
  const running = lintRun?.running ?? false
  const hasRun = lintRun?.hasRun ?? false
  const error = lintRun?.error
  const [history, setHistory] = useState<GenerationHistoryEntry[]>([])
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null)
  const [runSemantic, setRunSemantic] = useState(false)
  const [fixingId, setFixingId] = useState<string | null>(null)

  const setResults = useCallback((next: LintResult[] | ((prev: LintResult[]) => LintResult[])) => {
    const current = useWikiStore.getState().lintRun
    const prev = current?.results ?? []
    const nextResults = typeof next === "function" ? next(prev) : next
    if (!current) return
    useWikiStore.getState().setLintRun({
      ...current,
      results: nextResults,
    })
  }, [])

  const loadHistory = useCallback(async () => {
    if (!project) {
      setHistory([])
      return
    }
    setHistory(await listGenerationHistory(project.path, "lint"))
  }, [project])

  useEffect(() => {
    if (novelMode && project) {
      void loadHistory()
      return
    }
    setHistory([])
    setExpandedHistoryId(null)
  }, [novelMode, project, loadHistory])

  const handleDeleteHistory = useCallback(async (entry: GenerationHistoryEntry) => {
    if (!project) return
    const confirmed = window.confirm(t("novel.history.deleteConfirm"))
    if (!confirmed) return
    await deleteGenerationHistoryEntry(project.path, entry.filePath)
    setExpandedHistoryId((current) => current === entry.id ? null : current)
    await loadHistory()
  }, [project, loadHistory, t])

  const handleRunLint = useCallback(async () => {
    if (!project || running) return
    const pp = normalizePath(project.path)
    const parsed = parseFrontmatter(fileContent)
    const meta = parsed.frontmatter ? parseChapterMeta(parsed.frontmatter as Record<string, unknown>) : null
    const runId = `${Date.now()}-${Math.random()}`
    setLintRun({ runId, projectPath: project.path, filePath: selectedFile ?? undefined, running: true, hasRun: false, results: [] })
    try {
      const structural = await runStructuralLint(pp)
      let all = structural

      const state = useWikiStore.getState()
      const effectiveLlmConfig = novelMode
        ? resolveNovelModel(state.llmConfig, state.novelConfig, "lint")
        : resolveDefaultModel(state.llmConfig)

      if (runSemantic && hasUsableLlm(effectiveLlmConfig, state.providerConfigs)) {
        const semantic = await runSemanticLint(pp, effectiveLlmConfig, {
          chapterContent: novelMode && selectedFile ? fileContent : undefined,
          chapterNumber: meta?.chapterNumber,
        })
        all = [...structural, ...semantic]
      }

      useWikiStore.getState().finishLintRun(runId, { running: true, hasRun: true, results: all, error: undefined })
      if (novelMode) {
        await saveGenerationHistoryEntry(project.path, {
          kind: "lint",
          title: meta?.chapterNumber ? t("novel.lint.historyEntryTitle", { chapter: meta.chapterNumber }) : t("novel.lint.historyEntryTitleNoChapter"),
          chapterNumber: meta?.chapterNumber,
          sourcePath: selectedFile ?? undefined,
          results: all,
        })
        await loadHistory()
      }
      if (novelMode && meta?.chapterNumber) {
        await persistRevisionFeedbackForChapter(
          project.path,
          meta.chapterNumber,
          "lint",
          pickRevisionFeedbackFromLintResults(all),
        )
      }
    } catch (err) {
      console.error("检查失败:", err)
      useWikiStore.getState().finishLintRun(runId, { running: false, hasRun: true, error: t("lint.messages.runFailed") })
    } finally {
      const current = useWikiStore.getState().lintRun
      if (current?.runId === runId) {
        useWikiStore.getState().finishLintRun(runId, {
          running: false,
          hasRun: current.hasRun,
          results: current.results,
        })
      }
    }
  }, [project, running, runSemantic, fileContent, novelMode, selectedFile, t, loadHistory, setLintRun])

  async function handleOpenPage(page: string) {
    if (!project) return
    const pp = normalizePath(project.path)
    const candidates = [
      `${pp}/wiki/${page}`,
      `${pp}/wiki/${page}.md`,
    ]
    setActiveView("wiki")
    for (const path of candidates) {
      try {
        const content = await readFile(path)
        setSelectedFile(path)
        setFileContent(content)
        return
      } catch {
        // try next
      }
    }
    setSelectedFile(candidates[0])
    setFileContent(i18n.t("lint.messages.unableToLoad", { page }))
  }

  async function handleFix(result: LintResult, index: number) {
    if (!project) return
    const pp = normalizePath(project.path)
    const id = `${result.type}-${index}`
    setFixingId(id)

    try {
      switch (result.type) {
        case "orphan": {
          // Add a link to this page from index.md
          const indexPath = `${pp}/wiki/index.md`
          let indexContent = ""
          try { indexContent = await readFile(indexPath) } catch { indexContent = i18n.t("lint.indexFallbackTitle") + "\n" }

          const pageName = result.page.replace(".md", "").replace(/^.*\//, "")
          const entry = `- [[${pageName}]]`
          if (!indexContent.includes(entry)) {
            indexContent = indexContent.trimEnd() + "\n" + entry + "\n"
            await writeFile(indexPath, indexContent)
          }
          // Remove from results
          setResults((prev) => prev.filter((_, i) => i !== index))
          break
        }

        case "broken-link": {
          // Option: remove the broken link from the page, or send to Review for manual fix
          const pagePath = `${pp}/wiki/${result.page}`
          useReviewStore.getState().addItem({
            type: "confirm",
            title: t("lint.fixBrokenLink", { page: result.page }),
            description: result.detail,
            affectedPages: [result.page],
            options: [
              { label: t("lint.openEdit"), action: `open:${result.page}` },
              { label: t("lint.deletePage"), action: `delete:${pagePath}` },
              { label: t("lint.reviewFallbacks.skipActionLabel"), action: "Skip" },
            ],
          })
          setResults((prev) => prev.filter((_, i) => i !== index))
          break
        }

        case "no-outlinks": {
          // Send to Review — user should add links manually
          useReviewStore.getState().addItem({
            type: "suggestion",
            title: t("lint.addCrossRefs", { page: result.page }),
            description: t("lint.addCrossRefsDescription"),
            affectedPages: [result.page],
            options: [
              { label: t("lint.openEdit"), action: `open:${result.page}` },
              { label: t("lint.reviewFallbacks.skipActionLabel"), action: "Skip" },
            ],
          })
          setResults((prev) => prev.filter((_, i) => i !== index))
          break
        }

        default: {
          // Semantic issues → send to Review for manual resolution
          useReviewStore.getState().addItem({
            type: "confirm",
            title: result.detail.slice(0, 80).trim() || t("lint.reviewFallbacks.semanticTitleFallback"),
            description: result.detail,
            affectedPages: result.affectedPages ?? [result.page],
            options: [
              { label: t("lint.openEdit"), action: `open:${result.page}` },
              { label: t("lint.reviewFallbacks.skipActionLabel"), action: "Skip" },
            ],
          })
          setResults((prev) => prev.filter((_, i) => i !== index))
          break
        }
      }

      // Refresh tree
      const tree = await listDirectory(pp)
      setFileTree(tree)
      bumpDataVersion()
    } catch (err) {
      console.error("修复失败:", err)
    } finally {
      setFixingId(null)
    }
  }

  async function handleDeleteOrphan(result: LintResult, index: number) {
    if (!project) return
    const pp = normalizePath(project.path)
    const pagePath = `${pp}/wiki/${result.page}`
    const confirmed = window.confirm(t("lint.deleteOrphanConfirm", { page: result.page }))
    if (!confirmed) return

    try {
      // Full cascade: file + embedding chunks + every reference to
      // the page across the wiki (body wikilinks, index.md listing,
      // `related:` frontmatter arrays). Even though "orphan" by lint
      // means no incoming wikilinks were detected, `related:` slugs
      // and index.md entries can still point at it — the orphan
      // detector only walks body refs.
      const { cascadeDeleteWikiPagesWithRefs } = await import(
        "@/lib/wiki-page-delete"
      )
      await cascadeDeleteWikiPagesWithRefs(pp, [pagePath])
      setResults((prev) => prev.filter((_, i) => i !== index))
      const tree = await listDirectory(pp)
      setFileTree(tree)
      bumpDataVersion()
    } catch (err) {
      console.error("删除失败:", err)
    }
  }

  const warnings = results.filter((r) => r.severity === "warning")
  const infos = results.filter((r) => r.severity === "info")

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t(novelMode ? "novel.lint.title" : "lint.title")}</h2>
          {hasRun && results.length > 0 && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              {results.length === 1 ? t("lint.issues", { count: results.length }) : t("lint.issues_plural", { count: results.length })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              className="h-3 w-3"
              checked={runSemantic}
              onChange={(e) => setRunSemantic(e.target.checked)}
            />
            {t("lint.semantic")}
          </label>
          <Button
            size="sm"
            onClick={handleRunLint}
            disabled={running || !project}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
            {running ? t("lint.running") : t(novelMode ? "novel.lint.runLint" : "lint.runLint")}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="m-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {!hasRun ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-muted-foreground/30" />
            <p>{t(novelMode ? "novel.lint.runLintHint" : "lint.runLintHint")}</p>
            <p className="text-xs">{t("lint.runLintDescription")}</p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-emerald-500/60" />
            <p className="text-emerald-600 dark:text-emerald-400 font-medium">{t(novelMode ? "novel.lint.allClear" : "lint.allClear")}</p>
            <p className="text-xs">{t("lint.noIssues")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            {warnings.length > 0 && (
              <SectionHeader icon={AlertTriangle} label={t("lint.warnings")} count={warnings.length} color="text-amber-500" t={t} />
            )}
            {warnings.map((result, i) => (
              <LintCard
                key={`warn-${i}`}
                result={result}
                index={i}
                fixing={fixingId === `${result.type}-${i}`}
                onOpenPage={handleOpenPage}
                onFix={handleFix}
                onDelete={result.type === "orphan" ? handleDeleteOrphan : undefined}
                typeConfig={typeConfig}
                t={t}
              />
            ))}
            {infos.length > 0 && (
              <SectionHeader icon={Info} label={t("lint.info")} count={infos.length} color="text-blue-500" t={t} />
            )}
            {infos.map((result, i) => {
              const realIndex = warnings.length + i
              return (
                <LintCard
                  key={`info-${i}`}
                  result={result}
                  index={realIndex}
                  fixing={fixingId === `${result.type}-${realIndex}`}
                  onOpenPage={handleOpenPage}
                  onFix={handleFix}
                  onDelete={result.type === "orphan" ? handleDeleteOrphan : undefined}
                  typeConfig={typeConfig}
                  t={t}
                />
              )
            })}
          </div>
        )}
        {novelMode && history.length > 0 && (
          <div className="border-t p-3">
            <div className="mb-2 text-xs font-semibold text-muted-foreground">{t("novel.lint.historyTitle")}</div>
            <div className="space-y-2">
              {history.map((entry) => {
                const entryResults = entry.results as LintResult[]
                const warningCount = entryResults.filter((result) => result.severity === "warning").length
                const infoCount = entryResults.filter((result) => result.severity === "info").length
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
                        <span className="text-muted-foreground">{entry.createdAt.slice(0, 10)} · {t("novel.lint.historySummary", { warnings: warningCount, infos: infoCount })}</span>
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
                            <div className="font-medium">{result.page}</div>
                            <div className="text-muted-foreground">{result.detail}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  label,
  count,
  color,
  t,
}: {
  icon: typeof AlertTriangle
  label: string
  count: number
  color: string
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  return (
    <div className={`flex items-center gap-1.5 px-1 py-1 text-xs font-semibold ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      {t("lint.sectionCount", { label, count })}
    </div>
  )
}

function LintCard({
  result,
  index,
  fixing,
  onOpenPage,
  onFix,
  onDelete,
  typeConfig,
  t,
}: {
  result: LintResult
  index: number
  fixing: boolean
  onOpenPage: (page: string) => void
  onFix: (result: LintResult, index: number) => void
  onDelete?: (result: LintResult, index: number) => void
  typeConfig: Record<string, { icon: typeof AlertTriangle; label: string }>
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const config = typeConfig[result.type] ?? typeConfig.semantic
  const Icon = config.icon

  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="mb-1.5 flex items-start gap-2">
        <Icon
          className={`mt-0.5 h-4 w-4 shrink-0 ${
            result.severity === "warning" ? "text-amber-500" : "text-blue-500"
          }`}
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{result.page}</div>
          <div className="text-[11px] text-muted-foreground">{config.label}</div>
        </div>
      </div>

      <p className="mb-2 text-xs text-muted-foreground">{result.detail}</p>

      {result.affectedPages && result.affectedPages.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {result.affectedPages.map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => onOpenPage(page)}
              className="inline-flex items-center gap-0.5 rounded bg-accent/60 px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-accent transition-colors"
            >
              {page}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5 mt-2">
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-xs gap-1"
          onClick={() => onOpenPage(result.page)}
        >
          {t("lint.open")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-xs gap-1"
          disabled={fixing}
          onClick={() => onFix(result, index)}
        >
          <Wrench className="h-3 w-3" />
          {fixing ? t("lint.fixing") : t("lint.fix")}
        </Button>
        {onDelete && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs gap-1 text-destructive hover:text-destructive"
            onClick={() => onDelete(result, index)}
          >
            <Trash2 className="h-3 w-3" />
            {t("lint.delete")}
          </Button>
        )}
      </div>
    </div>
  )
}
