import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  FileText,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { deleteFile, readFile, writeFile } from "@/commands/fs"
import { WikiReader } from "@/components/editor/wiki-reader"
import { parseFrontmatter } from "@/lib/frontmatter"
import { useWikiStore } from "@/stores/wiki-store"
import {
  loadMemoryCenterData,
  type MemoryCenterSnapshotCard,
} from "@/lib/novel/memory-center"
import { loadSnapshot } from "@/lib/novel/chapter-ingest"
import { loadPlotFrameworkLibrary } from "@/lib/novel/plot-framework-library"
import { summarizePlotFrameworkLibrary } from "@/lib/novel/plot-framework-summary"
import type { PlotFrameworkSummary } from "@/lib/novel/plot-framework-summary"

const SnapshotViewer = lazy(async () => {
  const mod = await import("@/components/novel/snapshot-viewer")
  return { default: mod.SnapshotViewer }
})

const FILE_LABEL_KEYS: Record<string, string> = {
  "character-states": "novel.memoryCenter.sections.characterStates",
  "character-cognition": "novel.memoryCenter.sections.cognition",
  "foreshadowing-tracker": "novel.memoryCenter.sections.foreshadowing",
  timeline: "novel.memoryCenter.sections.timeline",
  "canon-facts": "novel.memoryCenter.sections.canonFacts",
  conflicts: "novel.memoryCenter.sections.conflicts",
}

type MemoryCenterDetailView =
  | {
      kind: "snapshotList"
      title: string
      description: string
      cards: MemoryCenterSnapshotCard[]
      allChapterNumbers: number[]
      parentView: MemoryCenterDetailView | null
    }
  | {
      kind: "markdown"
      title: string
      description: string
      path: string
      content: string
      rawBlock: string
      editable: boolean
      deleteChapterNumber?: number
      parentView: MemoryCenterDetailView | null
    }

function splitRenderableMarkdown(markdown: string): { rawBlock: string; body: string } {
  const parsed = parseFrontmatter(markdown)
  return {
    rawBlock: parsed.rawBlock,
    body: parsed.rawBlock ? parsed.body : markdown,
  }
}

function snapshotNumberFromMarkdownPath(path: string): number | null {
  const fileName = path.replace(/\\/g, "/").split("/").pop() ?? ""
  const outlineMatch = fileName.match(/^outline-(\d+)\.snapshot\.md$/i)
  if (outlineMatch) return -Number(outlineMatch[1])
  const chapterMatch = fileName.match(/^(\d+)\.snapshot\.md$/i)
  if (chapterMatch) return Number(chapterMatch[1])
  return null
}

function SnapshotCard({
  card,
  buttonId,
  onOpen,
  onEdit,
  onDelete,
  t,
}: {
  card: MemoryCenterSnapshotCard
  buttonId: string
  onOpen: (path: string, title: string, focusId: string) => void
  onEdit: (chapterNumber: number) => void
  onDelete: (chapterNumber: number, title: string) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const title = card.chapterNumber < 0
    ? (card.chapterTitle || `大纲快照(${card.chapterNumber})`)
    : (card.chapterTitle || t("novel.memoryCenter.snapshots.chapter", { chapter: card.chapterNumber }))
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">
            {title}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {card.memorySynced
              ? t("novel.memoryCenter.snapshots.synced")
              : t("novel.memoryCenter.snapshots.unsynced")}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            id={buttonId}
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onOpen(card.snapshotPath, title, buttonId)}
          >
            {t("novel.memoryCenter.snapshots.openSnapshot")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onEdit(card.chapterNumber)}
          >
            <Pencil className="mr-1 h-3.5 w-3.5" />
            {t("novel.memoryCenter.edit")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 border-destructive/50 text-xs text-destructive hover:bg-destructive/10"
            onClick={() => onDelete(card.chapterNumber, title)}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            {t("novel.memoryCenter.delete")}
          </Button>
        </div>
      </div>

      <p className="mt-3 text-sm leading-6 text-foreground">
        {card.summary || t("novel.memoryCenter.snapshots.summaryFallback")}
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <SnapshotList
          title={t("novel.snapshot.characterStateChanges")}
          items={card.characterStateChanges}
          hasMore={card.hasMoreCharacterStateChanges}
        />
        <SnapshotList
          title={t("novel.snapshot.knowledgeChanges")}
          items={card.knowledgeChanges}
          hasMore={card.hasMoreKnowledgeChanges}
        />
        <SnapshotList
          title={t("novel.snapshot.foreshadowingChanges")}
          items={card.foreshadowingChanges}
          hasMore={card.hasMoreForeshadowingChanges}
        />
        <SnapshotList
          title={t("novel.snapshot.timelineEvents")}
          items={card.timelineEvents}
          hasMore={card.hasMoreTimelineEvents}
        />
      </div>

      {card.endingHook ? (
        <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t("novel.snapshot.endingHook")}：</span>
          {card.endingHook}
        </div>
      ) : null}
    </div>
  )
}

function SnapshotList({
  title,
  items,
  hasMore,
}: {
  title: string
  items: string[]
  hasMore: boolean
}) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <ul className="mt-1 space-y-1 text-xs text-foreground">
        {items.map((item) => (
          <li key={`${title}-${item}`}>{item}</li>
        ))}
        {hasMore ? <li className="text-muted-foreground">…</li> : null}
      </ul>
    </div>
  )
}

export function MemoryCenterView() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const selectedMemoryCenterEntry = useWikiStore((s) => s.selectedMemoryCenterEntry)
  const setSelectedMemoryCenterEntry = useWikiStore((s) => s.setSelectedMemoryCenterEntry)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailView, setDetailView] = useState<MemoryCenterDetailView | null>(null)
  const [statusMessage, setStatusMessage] = useState("")
  const [snapshotEditorNumber, setSnapshotEditorNumber] = useState<number | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{
    kind: "snapshot" | "file"
    title: string
    path?: string
    chapterNumber?: number
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [frameworkSummary, setFrameworkSummary] = useState<PlotFrameworkSummary | null>(null)

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const restoreScrollTop = useRef(0)
  const restoreFocusId = useRef<string | null>(null)
  const shouldRestorePosition = useRef(false)

  const refresh = useCallback(async () => {
    if (!project?.path || !selectedMemoryCenterEntry) {
      setError(null)
      setDetailView(null)
      setLoading(false)
      return
    }

    if (selectedMemoryCenterEntry === "dismantling-library") {
      setSelectedMemoryCenterEntry(null)
      setDetailView(null)
      setLoading(false)
      return
    }

    if (selectedMemoryCenterEntry === "plot-framework") {
      setLoading(true)
      setError(null)
      setDetailView(null)
      try {
        const lib = await loadPlotFrameworkLibrary(project.path)
        setFrameworkSummary(summarizePlotFrameworkLibrary(lib))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        setFrameworkSummary(null)
      } finally {
        setLoading(false)
      }
      return
    }

    setLoading(true)
    setError(null)
    setStatusMessage("")
    setDetailView(null)
    try {
      const memoryData = await loadMemoryCenterData(project.path)

      if (selectedMemoryCenterEntry === "snapshots") {
        setDetailView({
          kind: "snapshotList",
          title: t("novel.memoryCenter.snapshots.title"),
          description: t("novel.memoryCenter.snapshots.listDescription"),
          cards: memoryData.snapshots,
          allChapterNumbers: memoryData.allChapterNumbers,
          parentView: null,
        })
        return
      }

      const file = memoryData.files.find((item) => item.key === selectedMemoryCenterEntry)
      if (!file) {
        setDetailView(null)
        return
      }

      const labelKey = FILE_LABEL_KEYS[file.key] ?? "novel.memoryCenter.openFile"
      const content = await readFile(file.path)
      const rendered = splitRenderableMarkdown(content)
      setDetailView({
        kind: "markdown",
        title: t(labelKey),
        description: t("novel.memoryCenter.fileDetailDescription"),
        path: file.path,
        content: rendered.body,
        rawBlock: rendered.rawBlock,
        editable: true,
        parentView: null,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [project?.path, selectedMemoryCenterEntry, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (detailView || !shouldRestorePosition.current) return
    shouldRestorePosition.current = false
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      if (container) {
        container.scrollTop = restoreScrollTop.current
      }

      if (!restoreFocusId.current) return
      const target = document.getElementById(restoreFocusId.current)
      if (!(target instanceof HTMLElement)) return
      target.scrollIntoView({ block: "center" })
      target.focus({ preventScroll: true })
    })
  }, [detailView])

  const rememberOpenLocation = useCallback((focusId: string) => {
    restoreScrollTop.current = scrollContainerRef.current?.scrollTop ?? 0
    restoreFocusId.current = focusId
  }, [])

  const openMarkdownDetail = useCallback(async (
    path: string,
    title: string,
    description: string,
    focusId: string,
  ) => {
    const parentView = detailView?.kind === "snapshotList" ? detailView : null
    rememberOpenLocation(focusId)
    setError(null)
    try {
      const content = await readFile(path)
      const rendered = splitRenderableMarkdown(content)
      const snapshotChapterNumber = snapshotNumberFromMarkdownPath(path)
      setDetailView({
        kind: "markdown",
        title,
        description,
        path,
        content: rendered.body,
        rawBlock: rendered.rawBlock,
        editable: snapshotChapterNumber === null,
        deleteChapterNumber: snapshotChapterNumber ?? undefined,
        parentView,
      })
      requestAnimationFrame(() => {
        scrollContainerRef.current?.scrollTo({ top: 0 })
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    }
  }, [detailView, rememberOpenLocation])

  const openSnapshotDetail = useCallback((path: string, title: string, focusId: string) => {
    void openMarkdownDetail(
      path,
      title,
      t("novel.memoryCenter.snapshots.detailDescription"),
      focusId,
    )
  }, [openMarkdownDetail, t])

  const closeDetail = useCallback(() => {
    if (detailView?.parentView) {
      setDetailView(detailView.parentView)
      return
    }
    shouldRestorePosition.current = true
    setDetailView(null)
    setSelectedMemoryCenterEntry(null)
  }, [detailView, setSelectedMemoryCenterEntry])

  const handleSaveMarkdown = useCallback(async (nextContent: string) => {
    if (detailView?.kind !== "markdown") return
    try {
      await writeFile(detailView.path, `${detailView.rawBlock}${nextContent}`)
      setDetailView({ ...detailView, content: nextContent })
      setStatusMessage(t("novel.memoryCenter.saveSuccess"))
      bumpDataVersion()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [bumpDataVersion, detailView, t])

  const requestDeleteMarkdown = useCallback(() => {
    if (detailView?.kind !== "markdown") return
    if (detailView.deleteChapterNumber !== undefined) {
      setPendingDelete({ kind: "snapshot", title: detailView.title, chapterNumber: detailView.deleteChapterNumber })
      return
    }
    setPendingDelete({ kind: "file", title: detailView.title, path: detailView.path })
  }, [detailView])

  const requestDeleteSnapshot = useCallback((chapterNumber: number, title: string) => {
    setPendingDelete({ kind: "snapshot", title, chapterNumber })
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete || !project?.path || deleting) return
    setDeleting(true)
    setError(null)
    try {
      if (pendingDelete.kind === "snapshot" && pendingDelete.chapterNumber !== undefined) {
        const { deleteChapterSnapshots } = await import("@/lib/novel/chapter-ingest")
        await deleteChapterSnapshots(project.path, pendingDelete.chapterNumber)
      } else if (pendingDelete.kind === "file" && pendingDelete.path) {
        await deleteFile(pendingDelete.path)
        setDetailView(null)
        setSelectedMemoryCenterEntry(null)
      }
      bumpDataVersion()
      if (pendingDelete.kind === "snapshot") {
        await refresh()
      }
      setPendingDelete(null)
      setStatusMessage(t("novel.memoryCenter.deleteSuccess"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }, [bumpDataVersion, deleting, pendingDelete, project?.path, refresh, setSelectedMemoryCenterEntry, t])

  if (loading && selectedMemoryCenterEntry && !detailView) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        {t("novel.memoryCenter.loading")}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            {detailView?.title ?? t("novel.memoryCenter.title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {detailView?.description ?? t("novel.memoryCenter.description")}
          </p>
        </div>
        {detailView ? (
          <Button
            id="memory-center-close-detail"
            size="sm"
            variant="outline"
            onClick={closeDetail}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            {t("novel.memoryCenter.closeDetail")}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {t("novel.memoryCenter.refresh")}
          </Button>
        )}
      </div>

      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error ? (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {statusMessage ? (
          <div className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            {statusMessage}
          </div>
        ) : null}

        {selectedMemoryCenterEntry === "plot-framework" && frameworkSummary ? (
          <PlotFrameworkSummaryCard summary={frameworkSummary} />
        ) : null}
        {!selectedMemoryCenterEntry ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <FileText className="h-8 w-8 text-muted-foreground/30" />
            <p>{t("novel.memoryCenter.selectPrompt")}</p>
            <p className="text-xs">{t("novel.memoryCenter.selectHint")}</p>
          </div>
        ) : detailView ? (
          <MemoryCenterDetailPanel
            detailView={detailView}
            onOpenSnapshot={openSnapshotDetail}
            onEditSnapshot={setSnapshotEditorNumber}
            onDeleteSnapshot={requestDeleteSnapshot}
            onSaveMarkdown={handleSaveMarkdown}
            onDeleteMarkdown={requestDeleteMarkdown}
            t={t}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            {t("novel.memoryCenter.loading")}
          </div>
        )}
      </div>
      {snapshotEditorNumber !== null && project ? (
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 text-sm text-white">{t("novel.snapshot.loading")}</div>}>
          <SnapshotViewer
            projectPath={project.path}
            chapterNumber={snapshotEditorNumber}
            onClose={() => {
              setSnapshotEditorNumber(null)
              void refresh()
            }}
          />
        </Suspense>
      ) : null}
      <DeleteMemoryConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.title ?? ""}
        deleting={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        t={t}
      />
    </div>
  )
}

const DEFAULT_SNAPSHOT_PAGE_SIZE = 15

function MemoryCenterDetailPanel({
  detailView,
  onOpenSnapshot,
  onEditSnapshot,
  onDeleteSnapshot,
  onSaveMarkdown,
  onDeleteMarkdown,
  t,
}: {
  detailView: MemoryCenterDetailView
  onOpenSnapshot: (path: string, title: string, focusId: string) => void
  onEditSnapshot: (chapterNumber: number) => void
  onDeleteSnapshot: (chapterNumber: number, title: string) => void
  onSaveMarkdown: (content: string) => Promise<void>
  onDeleteMarkdown: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null)
  const [rangeStart, setRangeStart] = useState("")
  const [rangeEnd, setRangeEnd] = useState("")
  const [loadedCard, setLoadedCard] = useState<MemoryCenterSnapshotCard | null>(null)
  const [loadingCard, setLoadingCard] = useState(false)

  // 按需加载不在预加载列表中的章节快照
  useEffect(() => {
    if (selectedChapter === null) {
      setLoadedCard(null)
      return
    }
    const fromCache = detailView.kind === "snapshotList"
      ? detailView.cards.find((c) => c.chapterNumber === selectedChapter)
      : null
    if (fromCache) {
      setLoadedCard(null)
      return
    }
    // 不在缓存中，从磁盘加载
    let cancelled = false
    setLoadingCard(true)
    const projectPath = useWikiStore.getState().project?.path
    if (!projectPath) {
      setLoadingCard(false)
      return
    }
    loadSnapshot(projectPath, selectedChapter).then((snapshot) => {
      if (cancelled || !snapshot) {
        if (!cancelled) setLoadingCard(false)
        return
      }
      const card: MemoryCenterSnapshotCard = {
        chapterNumber: snapshot.chapterNumber,
        chapterTitle: snapshot.chapterTitle,
        summary: snapshot.summary?.trim() ?? "",
        endingHook: snapshot.endingHook?.trim() ?? "",
        memorySynced: Boolean(snapshot.memorySyncedAt),
        memorySyncedAt: snapshot.memorySyncedAt,
        snapshotPath: "",
        characterStateChanges: (snapshot.characterStateChanges ?? []).slice(0, 3),
        knowledgeChanges: (snapshot.knowledgeChanges ?? []).slice(0, 3),
        foreshadowingChanges: (snapshot.foreshadowingChanges ?? []).slice(0, 3),
        timelineEvents: (snapshot.timelineEvents ?? []).slice(0, 3),
        hasMoreCharacterStateChanges: (snapshot.characterStateChanges ?? []).length > 3,
        hasMoreKnowledgeChanges: (snapshot.knowledgeChanges ?? []).length > 3,
        hasMoreForeshadowingChanges: (snapshot.foreshadowingChanges ?? []).length > 3,
        hasMoreTimelineEvents: (snapshot.timelineEvents ?? []).length > 3,
      }
      if (!cancelled) {
        setLoadedCard(card)
        setLoadingCard(false)
      }
    }).catch(() => {
      if (!cancelled) setLoadingCard(false)
    })
    return () => { cancelled = true }
  }, [selectedChapter, detailView])

  if (detailView.kind === "snapshotList") {
    const chapterCards = detailView.cards.filter((c) => c.chapterNumber > 0)
    const outlineCards = detailView.cards.filter((c) => c.chapterNumber < 0)
    const maxChapter = detailView.allChapterNumbers.length > 0 ? detailView.allChapterNumbers[0] : 0

    // 区间筛选
    const filteredChapterCards = useMemo(() => {
      const start = rangeStart.trim() ? Number(rangeStart.trim()) : 0
      const end = rangeEnd.trim() ? Number(rangeEnd.trim()) : 0
      let filtered = chapterCards
      if (start > 0 && end > 0 && start <= end) {
        filtered = chapterCards.filter((c) => c.chapterNumber >= start && c.chapterNumber <= end)
      } else if (start > 0) {
        filtered = chapterCards.filter((c) => c.chapterNumber >= start)
      } else if (end > 0) {
        filtered = chapterCards.filter((c) => c.chapterNumber <= end)
      }
      return filtered
    }, [chapterCards, rangeStart, rangeEnd])

    // 默认显示最近15章，区间搜索时显示全部匹配
    const displayCards = useMemo(() => {
      if (rangeStart || rangeEnd) return filteredChapterCards
      return filteredChapterCards.slice(0, DEFAULT_SNAPSHOT_PAGE_SIZE)
    }, [filteredChapterCards, rangeStart, rangeEnd])

    // 章节列表（用于侧边栏选择，显示全部章节）
    const allChapterNumbers = detailView.allChapterNumbers

    // 选中的章节卡片（优先从缓存取，其次从按需加载取）
    const selectedCard = useMemo(() => {
      if (selectedChapter === null) return null
      return detailView.cards.find((c) => c.chapterNumber === selectedChapter) ?? loadedCard ?? null
    }, [detailView.cards, selectedChapter, loadedCard])

    return (
      <div className="flex h-full gap-0">
        {/* 左侧章节列表 */}
        <div className="flex w-48 shrink-0 flex-col border-r">
          <div className="border-b px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="number"
                min={1}
                max={maxChapter}
                placeholder="起始章"
                value={rangeStart}
                onChange={(e) => { setRangeStart(e.target.value); setSelectedChapter(null) }}
                className="h-6 w-14 rounded border bg-background px-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-xs text-muted-foreground">-</span>
              <input
                type="number"
                min={1}
                max={maxChapter}
                placeholder="结束章"
                value={rangeEnd}
                onChange={(e) => { setRangeEnd(e.target.value); setSelectedChapter(null) }}
                className="h-6 w-14 rounded border bg-background px-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {(rangeStart || rangeEnd) ? (
                <button
                  type="button"
                  onClick={() => { setRangeStart(""); setRangeEnd(""); setSelectedChapter(null) }}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {allChapterNumbers.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">暂无章节快照</p>
            ) : (
              allChapterNumbers.map((cn) => (
                <button
                  key={cn}
                  type="button"
                  onClick={() => setSelectedChapter(cn === selectedChapter ? null : cn)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                    cn === selectedChapter
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span>第{cn}章</span>
                </button>
              ))
            )}
          </div>
          {outlineCards.length > 0 ? (
            <div className="border-t px-3 py-1.5">
              <p className="text-xs text-muted-foreground">
                大纲快照：{outlineCards.length}条
              </p>
            </div>
          ) : null}
        </div>

        {/* 右侧快照详情 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loadingCard ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">正在加载第{selectedChapter}章快照...</span>
            </div>
          ) : selectedCard ? (
            <SnapshotCard
              card={selectedCard}
              buttonId={`memory-center-detail-snapshot-${selectedCard.chapterNumber}`}
              onOpen={onOpenSnapshot}
              onEdit={onEditSnapshot}
              onDelete={onDeleteSnapshot}
              t={t}
            />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {rangeStart || rangeEnd
                    ? `区间 ${rangeStart || "1"}–${rangeEnd || maxChapter} 章，共${filteredChapterCards.length}条`
                    : `最近${Math.min(displayCards.length, DEFAULT_SNAPSHOT_PAGE_SIZE)}章（共${chapterCards.length}章）`}
                </p>
              </div>
              {displayCards.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">该区间内暂无章节快照</p>
              ) : (
                displayCards.map((card) => (
                  <SnapshotCard
                    key={card.chapterNumber}
                    card={card}
                    buttonId={`memory-center-detail-snapshot-${card.chapterNumber}`}
                    onOpen={onOpenSnapshot}
                    onEdit={onEditSnapshot}
                    onDelete={onDeleteSnapshot}
                    t={t}
                  />
                ))
              )}
              {!rangeStart && !rangeEnd && chapterCards.length > DEFAULT_SNAPSHOT_PAGE_SIZE ? (
                <p className="text-center text-xs text-muted-foreground">
                  仅显示最近{DEFAULT_SNAPSHOT_PAGE_SIZE}章，使用左侧章节列表或区间搜索查看更多
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <EditableMarkdownMemory
      detailView={detailView}
      onSave={onSaveMarkdown}
      onDelete={onDeleteMarkdown}
      t={t}
    />
  )
}

function EditableMarkdownMemory({
  detailView,
  onSave,
  onDelete,
  t,
}: {
  detailView: Extract<MemoryCenterDetailView, { kind: "markdown" }>
  onSave: (content: string) => Promise<void>
  onDelete: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(detailView.content)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(detailView.content)
    setEditing(false)
    setSaving(false)
  }, [detailView.path, detailView.content])

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {detailView.editable ? t("novel.memoryCenter.editHint") : t("novel.memoryCenter.snapshots.detailDescription")}
        </p>
        <div className="flex items-center gap-1">
          {detailView.editable && editing ? (
            <>
              <Button size="sm" variant="outline" disabled={saving} onClick={() => void handleSave()}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {saving ? t("novel.memoryCenter.saving") : t("novel.memoryCenter.save")}
              </Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => {
                setDraft(detailView.content)
                setEditing(false)
              }}>
                {t("novel.memoryCenter.cancel")}
              </Button>
            </>
          ) : detailView.editable ? (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              {t("novel.memoryCenter.edit")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
            onClick={onDelete}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {t("novel.memoryCenter.delete")}
          </Button>
        </div>
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-[420px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus:border-ring"
        />
      ) : (
        <WikiReader body={detailView.content} />
      )}
    </div>
  )
}

function DeleteMemoryConfirmDialog({
  open,
  title,
  deleting,
  onCancel,
  onConfirm,
  t,
}: {
  open: boolean
  title: string
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-md rounded-lg border border-destructive/60 bg-background shadow-xl">
        <div className="flex items-start gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t("novel.memoryCenter.deleteConfirmTitle")}</h3>
            <p className="mt-1 truncate text-xs opacity-80">{title}</p>
          </div>
        </div>
        <div className="px-4 py-4">
          <p className="text-sm leading-6 text-foreground">
            {t("novel.memoryCenter.deleteConfirmBody")}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="outline" disabled={deleting} onClick={onCancel}>
            {t("novel.memoryCenter.cancel")}
          </Button>
          <Button
            type="button"
            disabled={deleting}
            onClick={onConfirm}
            className="border border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? t("novel.memoryCenter.deleting") : t("novel.memoryCenter.deleteConfirmAction")}
          </Button>
        </div>
      </div>
    </div>
  )
}

function PlotFrameworkSummaryCard({
  summary,
}: {
  summary: PlotFrameworkSummary
}) {
  const lineLabel = (line: "main" | "sub") => (line === "main" ? "主线" : "支线")
  const pacingLabel = (pacing: "tight" | "standard" | "loose" | undefined) => {
    if (pacing === "tight") return "紧凑"
    if (pacing === "standard") return "标准"
    if (pacing === "loose") return "舒缓"
    return "未评定"
  }
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card px-4 py-3">
        <div className="text-sm font-semibold">剧情框架统计</div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div className="rounded-md border bg-background px-3 py-2">
            <div className="text-muted-foreground">框架总数</div>
            <div className="mt-1 text-lg font-semibold">{summary.total}</div>
          </div>
          <div className="rounded-md border bg-background px-3 py-2">
            <div className="text-muted-foreground">主线</div>
            <div className="mt-1 text-lg font-semibold">{summary.mainCount}</div>
          </div>
          <div className="rounded-md border bg-background px-3 py-2">
            <div className="text-muted-foreground">支线</div>
            <div className="mt-1 text-lg font-semibold">{summary.subCount}</div>
          </div>
          <div className="rounded-md border bg-background px-3 py-2">
            <div className="text-muted-foreground">未评定节奏</div>
            <div className="mt-1 text-lg font-semibold">{summary.unratedCount}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border px-2 py-0.5">紧凑 {summary.tightCount}</span>
          <span className="rounded-full border px-2 py-0.5">标准 {summary.standardCount}</span>
          <span className="rounded-full border px-2 py-0.5">舒缓 {summary.looseCount}</span>
        </div>
      </div>
      {summary.recentTitles.length > 0 ? (
        <div className="rounded-md border bg-card px-4 py-3">
          <div className="text-sm font-semibold">最近更新的框架</div>
          <ul className="mt-2 space-y-1 text-xs">
            {summary.recentTitles.map((fw, idx) => (
              <li key={idx} className="flex items-center justify-between rounded border bg-background px-2 py-1">
                <span className="truncate">{fw.title}</span>
                <span className="ml-2 shrink-0 text-muted-foreground">{lineLabel(fw.line)} · {pacingLabel(fw.pacing)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="text-xs text-muted-foreground">
        剧情框架在拆书库提取后自动入库；此卡片为只读统计视图。
      </div>
    </div>
  )
}
