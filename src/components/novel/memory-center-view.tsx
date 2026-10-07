import "@/components/uitest/ui-test-tools.css"
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  ArrowLeft,
  FileText,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { deleteFile, readFile, writeFile } from "@/commands/fs"
import { WikiReader } from "@/components/editor/wiki-reader"
import { parseFrontmatter } from "@/lib/frontmatter"
import { useWikiStore } from "@/stores/wiki-store"
import { loadMemoryCenterData, type MemoryCenterData } from "@/lib/novel/memory-center"
import {
  MEMORY_TAB_ICONS,
  MEMORY_TAB_KEYS,
  MEMORY_TAB_LABEL_KEYS,
  isMemoryFileTab,
  resolveMemoryTabCount,
  selectChapterSnapshotCards,
  selectOutlineSnapshotCards,
  type MemoryFileKey,
  type MemoryTabKey,
} from "./memory-center-tabs"
import { SnapshotCollection } from "./memory-center-snapshots"

const SnapshotViewer = lazy(async () => {
  const mod = await import("@/components/novel/snapshot-viewer")
  return { default: mod.SnapshotViewer }
})

/**
 * 记忆中心：单个页面。
 *
 * 这里曾经是**嵌套两层双栏**：
 *   ① 外层 —— 中间栏（8 个记忆分类列表）↔ 右侧内容区；
 *   ② 内层 —— 内容区里的「章节列表 + 区间搜索」↔「快照详情」。
 *
 * 现在两层都拆了：分类变成页面顶部的标签条，内容独占整幅宽度；
 * 章节列表不再是竖栏，区间筛选降级成工具行，快照卡片全宽纵向堆叠。
 *
 * 随之消失的还有双栏赖以通信的那条全局状态：`selectedMemoryCenterEntry`
 * （写在 wiki-store，只有中间栏写、内容区读）。两栏并成一页后它没有存在意义，
 * 改成这里的 `activeTab`。所以这次是拆结构 + 拆耦合，不只是搬 UI。
 */

type MemoryFileContent = {
  key: MemoryFileKey
  path: string
  content: string
  rawBlock: string
}

type SnapshotMarkdownDetail = {
  title: string
  path: string
  content: string
  rawBlock: string
  chapterNumber: number | null
}

type PendingDelete = {
  kind: "snapshot" | "file"
  title: string
  path?: string
  chapterNumber?: number
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

export function MemoryCenterView() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)

  const [activeTab, setActiveTab] = useState<MemoryTabKey>("snapshots")
  const [data, setData] = useState<MemoryCenterData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState("")
  const [fileContent, setFileContent] = useState<MemoryFileContent | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [detailView, setDetailView] = useState<SnapshotMarkdownDetail | null>(null)
  const [snapshotEditorNumber, setSnapshotEditorNumber] = useState<number | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleting, setDeleting] = useState(false)

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef(new Map<MemoryTabKey, HTMLButtonElement>())
  const restoreScrollTop = useRef(0)
  const restoreFocusId = useRef<string | null>(null)
  const shouldRestorePosition = useRef(false)

  const projectPath = project?.path

  const loadData = useCallback(async () => {
    if (!projectPath) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setData(await loadMemoryCenterData(projectPath))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // markdown 记忆文件按需读取：只有切到对应标签时才读盘。
  useEffect(() => {
    if (!data || !isMemoryFileTab(activeTab)) {
      setFileContent(null)
      setFileLoading(false)
      return
    }
    const file = data.files.find((item) => item.key === activeTab)
    if (!file) {
      setFileContent(null)
      setFileLoading(false)
      return
    }
    let cancelled = false
    setFileLoading(true)
    void readFile(file.path)
      .then((markdown) => {
        if (cancelled) return
        const rendered = splitRenderableMarkdown(markdown)
        setFileContent({
          key: activeTab,
          path: file.path,
          content: rendered.body,
          rawBlock: rendered.rawBlock,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setFileContent(null)
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false)
      })
    return () => { cancelled = true }
  }, [activeTab, data])

  // 关闭详情后回到原来的滚动位置与焦点。
  useEffect(() => {
    if (detailView || !shouldRestorePosition.current) return
    shouldRestorePosition.current = false
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      if (container) container.scrollTop = restoreScrollTop.current
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

  const selectTab = useCallback((key: MemoryTabKey) => {
    setActiveTab(key)
    setDetailView(null)
    setStatusMessage("")
    // 标签条是单排横向滚动，选中的标签若在视野外要滚进来。
    requestAnimationFrame(() => {
      tabRefs.current.get(key)?.scrollIntoView({ block: "nearest", inline: "nearest" })
    })
  }, [])

  const openSnapshotDetail = useCallback(async (path: string, title: string, focusId: string) => {
    rememberOpenLocation(focusId)
    setError(null)
    try {
      const markdown = await readFile(path)
      const rendered = splitRenderableMarkdown(markdown)
      setDetailView({
        title,
        path,
        content: rendered.body,
        rawBlock: rendered.rawBlock,
        chapterNumber: snapshotNumberFromMarkdownPath(path),
      })
      requestAnimationFrame(() => scrollContainerRef.current?.scrollTo({ top: 0 }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [rememberOpenLocation])

  const closeDetail = useCallback(() => {
    shouldRestorePosition.current = true
    setDetailView(null)
  }, [])

  const handleSaveFile = useCallback(async (nextContent: string) => {
    if (!fileContent) return
    try {
      await writeFile(fileContent.path, `${fileContent.rawBlock}${nextContent}`)
      setFileContent({ ...fileContent, content: nextContent })
      setStatusMessage(t("novel.memoryCenter.saveSuccess"))
      bumpDataVersion()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [bumpDataVersion, fileContent, t])

  const requestDeleteFile = useCallback(() => {
    if (!fileContent) return
    setPendingDelete({ kind: "file", title: t(MEMORY_TAB_LABEL_KEYS[fileContent.key]), path: fileContent.path })
  }, [fileContent, t])

  const requestDeleteSnapshot = useCallback((chapterNumber: number, title: string) => {
    setPendingDelete({ kind: "snapshot", title, chapterNumber })
  }, [])

  const requestDeleteDetail = useCallback(() => {
    if (!detailView || detailView.chapterNumber === null) return
    setPendingDelete({ kind: "snapshot", title: detailView.title, chapterNumber: detailView.chapterNumber })
  }, [detailView])

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete || !projectPath || deleting) return
    setDeleting(true)
    setError(null)
    try {
      if (pendingDelete.kind === "snapshot" && pendingDelete.chapterNumber !== undefined) {
        const { deleteChapterSnapshots } = await import("@/lib/novel/chapter-ingest")
        await deleteChapterSnapshots(projectPath, pendingDelete.chapterNumber)
      } else if (pendingDelete.kind === "file" && pendingDelete.path) {
        await deleteFile(pendingDelete.path)
        setFileContent(null)
        setDetailView(null)
      }
      bumpDataVersion()
      await loadData()
      setPendingDelete(null)
      setStatusMessage(t("novel.memoryCenter.deleteSuccess"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }, [bumpDataVersion, deleting, loadData, pendingDelete, projectPath, t])

  const chapterCards = useMemo(() => selectChapterSnapshotCards(data), [data])
  const outlineCards = useMemo(() => selectOutlineSnapshotCards(data), [data])

  const stats = data?.stats
  const memoryEmpty = Boolean(data) && !loading
    && chapterCards.length === 0
    && outlineCards.length === 0
    && data!.files.length === 0

  const pageState = error
    ? "error"
    : detailView
      ? "detail"
      : loading && !data
        ? "loading"
        : memoryEmpty
          ? "empty"
          : "ready"

  return (
    <div data-ui-page="memory" data-ui-state={pageState} className="flex h-full flex-col">
      <div data-ui="tool-heading" className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <nav aria-label="面包屑" className="ui-test-breadcrumb">
            <span>{project?.name ?? "未选择项目"}</span>
            <span aria-hidden="true">/</span>
            <span aria-current="page">记忆中心</span>
          </nav>
          <h2 data-ui="tool-title" className="text-sm font-semibold">
            {detailView?.title ?? t("novel.memoryCenter.title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {detailView
              ? t("novel.memoryCenter.snapshots.detailDescription")
              : t("novel.memoryCenter.description")}
          </p>
        </div>
        {detailView ? (
          <Button
            id="memory-center-close-detail"
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={closeDetail}
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            {t("novel.memoryCenter.back")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => { setStatusMessage(""); void loadData() }}
            disabled={loading}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {t("novel.memoryCenter.refresh")}
          </Button>
        )}
      </div>

      {!detailView ? (
        <>
          {/* 统计条：保留原中间栏「一览各分类规模」的职能。 */}
          <div
            data-ui="memory-stats"
            className="flex shrink-0 flex-nowrap items-center gap-2 overflow-x-auto border-b px-4 py-2 text-xs"
          >
            {[
              ["novel.memoryCenter.stats.totalSnapshots", stats?.snapshotCount ?? 0],
              ["novel.memoryCenter.stats.synced", stats?.syncedSnapshotCount ?? 0],
              ["novel.memoryCenter.stats.characters", stats?.characterCount ?? 0],
              ["novel.memoryCenter.stats.foreshadowing", stats?.activeForeshadowingCount ?? 0],
            ].map(([labelKey, value]) => (
              <span
                key={String(labelKey)}
                className="shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-muted-foreground"
              >
                {t(String(labelKey))} <b className="font-semibold text-foreground">{value}</b>
              </span>
            ))}
          </div>

          {/*
            标签条：单排、横向滚动，**绝不换行**。
            换行会读作"排错了"（本项目刚修过同类缺陷），横向滚动是可预期的。
          */}
          <div
            role="tablist"
            aria-label={t("novel.memoryCenter.title")}
            data-ui="memory-tabs"
            className="flex shrink-0 flex-nowrap items-center gap-1 overflow-x-auto border-b px-4 pt-2"
          >
            {MEMORY_TAB_KEYS.map((key) => {
              const Icon = MEMORY_TAB_ICONS[key]
              const selected = activeTab === key
              return (
                <button
                  key={key}
                  ref={(node) => {
                    if (node) tabRefs.current.set(key, node)
                    else tabRefs.current.delete(key)
                  }}
                  type="button"
                  role="tab"
                  id={`memory-tab-${key}`}
                  aria-selected={selected}
                  aria-controls={`memory-tabpanel-${key}`}
                  data-ui="memory-tab"
                  data-tab-key={key}
                  onClick={() => selectTab(key)}
                  className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-1.5 text-xs transition-colors ${
                    selected
                      ? "border-primary font-semibold text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{t(MEMORY_TAB_LABEL_KEYS[key])}</span>
                  <span className="text-muted-foreground">{resolveMemoryTabCount(key, data)}</span>
                </button>
              )
            })}
          </div>
        </>
      ) : null}

      {/*
        内容区本身就是 tabpanel —— 而不是在某个分支里再套一层。
        套在分支里会让「记忆文件」那几个标签没有对应的 tabpanel，
        aria-controls 就指向了不存在的元素。详情态没有标签条，也就不该声明 tabpanel。
      */}
      <div
        data-ui="memory-body"
        ref={scrollContainerRef}
        role={detailView ? undefined : "tabpanel"}
        id={detailView ? undefined : `memory-tabpanel-${activeTab}`}
        aria-labelledby={detailView ? undefined : `memory-tab-${activeTab}`}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
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

        {detailView ? (
          <MarkdownPanel
            dataUi="memory-detail"
            description={t("novel.memoryCenter.snapshots.detailDescription")}
            content={detailView.content}
            editable={false}
            onSave={handleSaveFile}
            onDelete={detailView.chapterNumber === null ? undefined : requestDeleteDetail}
            t={t}
          />
        ) : isMemoryFileTab(activeTab) ? (
          fileLoading ? (
            <LoadingRow label={t("novel.memoryCenter.loading")} />
          ) : fileContent ? (
            <MarkdownPanel
              dataUi="memory-detail"
              description={t("novel.memoryCenter.fileDetailDescription")}
              content={fileContent.content}
              editable
              onSave={handleSaveFile}
              onDelete={requestDeleteFile}
              t={t}
            />
          ) : (
            <EmptyHint title={t("novel.memoryCenter.emptyFile")} hint="" />
          )
        ) : loading && !data ? (
          <LoadingRow label={t("novel.memoryCenter.loading")} />
        ) : memoryEmpty ? (
          <EmptyHint title={t("novel.memoryCenter.empty")} hint={t("novel.memoryCenter.emptyHint")} />
        ) : (
          <SnapshotCollection
            key={activeTab}
            cards={activeTab === "snapshots" ? chapterCards : outlineCards}
            variant={activeTab === "snapshots" ? "chapter" : "outline"}
            onOpen={(path, title, focusId) => void openSnapshotDetail(path, title, focusId)}
            onEdit={setSnapshotEditorNumber}
            onDelete={requestDeleteSnapshot}
            t={t}
          />
        )}
      </div>

      {snapshotEditorNumber !== null && project ? (
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 text-sm text-white">{t("novel.snapshot.loading")}</div>}>
          <SnapshotViewer
            projectPath={project.path}
            chapterNumber={snapshotEditorNumber}
            onClose={() => {
              setSnapshotEditorNumber(null)
              void loadData()
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

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
      {label}
    </div>
  )
}

function EmptyHint({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
      <FileText className="h-8 w-8 text-muted-foreground/30" />
      <p>{title}</p>
      {hint ? <p className="text-xs">{hint}</p> : null}
    </div>
  )
}

/**
 * markdown 记忆面板：可编辑（记忆文件）或只读（快照正文）。
 * 快照正文不可编辑 —— 它由提取流程生成，改它没有意义。
 */
function MarkdownPanel({
  dataUi,
  description,
  content,
  editable,
  onSave,
  onDelete,
  t,
}: {
  dataUi: string
  description: string
  content: string
  editable: boolean
  onSave: (content: string) => Promise<void>
  onDelete?: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(content)
    setEditing(false)
    setSaving(false)
  }, [content])

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
    <div data-ui={dataUi} className="rounded-lg border bg-background p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {editable ? t("novel.memoryCenter.editHint") : description}
        </p>
        <div className="flex items-center gap-1">
          {editable && editing ? (
            <>
              <Button size="sm" variant="outline" disabled={saving} onClick={() => void handleSave()}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {saving ? t("novel.memoryCenter.saving") : t("novel.memoryCenter.save")}
              </Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => {
                setDraft(content)
                setEditing(false)
              }}>
                {t("novel.memoryCenter.cancel")}
              </Button>
            </>
          ) : editable ? (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              {t("novel.memoryCenter.edit")}
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
              onClick={onDelete}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {t("novel.memoryCenter.delete")}
            </Button>
          ) : null}
        </div>
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-[420px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus:border-ring"
        />
      ) : (
        <WikiReader body={content} />
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
