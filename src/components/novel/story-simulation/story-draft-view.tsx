import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Check, Copy, Download, FileText, BookOpen, Pencil, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { StoryDraft } from "@/lib/novel/story-simulation/types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useStorySimulationStore } from "@/stores/story-simulation-store"
import { useWikiStore } from "@/stores/wiki-store"
import { exportDraft } from "@/lib/novel/story-simulation/draft-export"
import { importDraftToChapters } from "@/lib/novel/story-simulation/draft-importer"
import { getNextChapterNumber } from "@/lib/novel/chapter-utils"
import { refreshProjectState } from "@/lib/project-refresh"

interface StoryDraftViewProps {
  onBack: () => void
}

export function StoryDraftView({ onBack }: StoryDraftViewProps) {
  const { t } = useTranslation()
  const projectPath = useWikiStore((s) => s.project?.path)
  const currentFramework = useStorySimulationStore((s) => s.currentFramework)
  const draft = useStorySimulationStore((s) => s.currentDraft)
  const setCurrentDraft = useStorySimulationStore((s) => s.setCurrentDraft)
  const setError = useStorySimulationStore((s) => s.setError)
  const setInfoMessage = useStorySimulationStore((s) => s.setInfoMessage)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importResult, setImportResult] = useState<{
    count: number
    startChapter: number
    paths: string[]
    backedUpCount: number
  } | null>(null)
  const [startChapter, setStartChapter] = useState(1)
  const [overwrite, setOverwrite] = useState(false)
  const [autoStartChapter, setAutoStartChapter] = useState(true)
  const [selectedIndices, setSelectedIndices] = useState<number[]>([])
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; title: string } | null>(null)
  const [editingChapterIdx, setEditingChapterIdx] = useState<number | null>(null)
  const [editContent, setEditContent] = useState("")
  const [editTitle, setEditTitle] = useState("")

  // 打开对话框时自动计算下一个章节号，并默认全选
  useEffect(() => {
    if (showImportDialog && projectPath && autoStartChapter && !importResult && draft) {
      let cancelled = false
      void (async () => {
        try {
          const next = await getNextChapterNumber(projectPath)
          if (!cancelled) setStartChapter(next)
        } catch {
          // 计算失败时使用默认值
        }
      })()
      // 默认全选
      if (selectedIndices.length === 0 && draft) {
        setSelectedIndices(draft.chapters.map((_, i) => i))
      }
      return () => {
        cancelled = true
      }
    }
  }, [showImportDialog, projectPath, autoStartChapter, importResult, draft, selectedIndices.length])

  if (!draft) return null

  const handleCopyAll = async () => {
    const text = draft.chapters
      .map((ch) => `${ch.title}\n\n${ch.content}`)
      .join("\n\n---\n\n")
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExport = async () => {
    if (!projectPath || !currentFramework || !draft) return
    setExporting(true)
    try {
      const filePath = await exportDraft(projectPath, currentFramework, draft)
      setInfoMessage(`草稿已导出到：${filePath}`)
      setTimeout(() => setInfoMessage(null), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败")
      setTimeout(() => setError(null), 5000)
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async () => {
    if (!projectPath || !currentFramework || !draft) return
    if (selectedIndices.length === 0) {
      setError("请至少选择一章导入")
      setTimeout(() => setError(null), 3000)
      return
    }
    setImporting(true)
    try {
      const result = await importDraftToChapters(
        projectPath,
        currentFramework,
        draft,
        {
          startChapter,
          overwrite,
          selectedIndices,
          onProgress: (current, total, title) => {
            setImportProgress({ current, total, title })
          },
        },
      )
      setImportResult({
        count: result.importedCount,
        startChapter: result.startChapter,
        paths: result.chapterPaths,
        backedUpCount: result.backedUpPaths.length,
      })
      // 刷新项目状态
      await refreshProjectState(projectPath)
      // 选中第一个导入的章节
      if (result.chapterPaths.length > 0) {
        setSelectedFile(result.chapterPaths[0])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败")
      setTimeout(() => setError(null), 5000)
    } finally {
      setImporting(false)
      setImportProgress(null)
    }
  }

  const handleGoToChapters = () => {
    setShowImportDialog(false)
    setImportResult(null)
    setAutoStartChapter(true)
    setOverwrite(false)
    setSelectedIndices([])
    setActiveView("wiki")
  }

  const handleCloseDialog = () => {
    setShowImportDialog(false)
    setImportResult(null)
    setAutoStartChapter(true)
    setOverwrite(false)
    setSelectedIndices([])
  }

  const toggleChapter = (idx: number) => {
    setSelectedIndices((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx],
    )
  }

  const toggleAll = () => {
    if (draft && selectedIndices.length === draft.chapters.length) {
      setSelectedIndices([])
    } else if (draft) {
      setSelectedIndices(draft.chapters.map((_, i) => i))
    }
  }

  const openEditDialog = (idx: number) => {
    if (!draft) return
    const chapter = draft.chapters[idx]
    setEditTitle(chapter.title)
    setEditContent(chapter.content)
    setEditingChapterIdx(idx)
  }

  const saveEdit = () => {
    if (editingChapterIdx === null || !draft) return
    const updatedDraft: StoryDraft = {
      ...draft,
      chapters: draft.chapters.map((ch, i) =>
        i === editingChapterIdx
          ? { ...ch, title: editTitle.trim() || ch.title, content: editContent }
          : ch,
      ),
    }
    setCurrentDraft(updatedDraft)
    setEditingChapterIdx(null)
  }

  const cancelEdit = () => {
    setEditingChapterIdx(null)
  }

  const allSelected = draft && selectedIndices.length === draft.chapters.length

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-sm font-semibold">{t("storySimulation.draftTitle")}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => setShowImportDialog(true)}
            disabled={importing}
          >
            <BookOpen className="mr-1 h-3.5 w-3.5" />
            导入到章节库
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            {exporting ? "导出中..." : "导出MD"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopyAll}>
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? t("storySimulation.copied") : t("storySimulation.copyAll")}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="text-xs text-muted-foreground">
            {t("storySimulation.totalWords")}: {draft.totalWords}
          </div>

          {draft.chapters.map((chapter, idx) => (
            <div key={idx} className="rounded-lg border p-4">
              <h3 className="mb-2 flex items-center gap-2 font-medium">
                <FileText className="h-4 w-4 text-muted-foreground" />
                {chapter.title}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 w-7 p-0 opacity-50 hover:opacity-100"
                  onClick={() => openEditDialog(idx)}
                  title="编辑章节"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {chapter.content}
              </p>
              {chapter.rawContent && chapter.rawContent !== chapter.content && (
                <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                  ✓ 已编辑（原始内容已备份）
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 导入确认对话框 */}
      <Dialog open={showImportDialog} onOpenChange={(open) => {
        if (!open) handleCloseDialog()
        else setShowImportDialog(true)
      }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>
              {importResult ? "导入成功" : "导入草稿到章节库"}
            </DialogTitle>
            {!importResult && (
              <DialogDescription>
                选择要导入的章节，配置起始章节号和覆盖选项。
              </DialogDescription>
            )}
          </DialogHeader>

          {importResult ? (
            <div className="space-y-3 py-2">
              <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                <div className="font-medium">✓ 成功导入 {importResult.count} 章</div>
                <div className="mt-1 text-xs opacity-80">
                  章节范围：第{importResult.startChapter}章 ~ 第{importResult.startChapter + importResult.count - 1}章
                </div>
                {importResult.backedUpCount > 0 && (
                  <div className="mt-1 text-xs opacity-80">
                    已自动备份 {importResult.backedUpCount} 个原章节文件
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {/* 章节选择 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">选择导入章节</span>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-xs text-primary hover:underline"
                  >
                    {allSelected ? "取消全选" : "全选"}
                  </button>
                </div>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded border p-2">
                  {draft.chapters.map((chapter, idx) => (
                    <label
                      key={idx}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIndices.includes(idx)}
                        onChange={() => toggleChapter(idx)}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <span className="flex-1 truncate text-sm">
                        {idx + 1}. {chapter.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ~{chapter.content.length}字
                      </span>
                    </label>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground">
                  已选 {selectedIndices.length} / {draft.chapters.length} 章
                </div>
              </div>

              {/* 起始章节号 */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoStartChapter}
                    onChange={(e) => {
                      setAutoStartChapter(e.target.checked)
                      if (e.target.checked && projectPath) {
                        void getNextChapterNumber(projectPath).then(setStartChapter)
                      }
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm font-medium">
                    自动选择起始章节号
                  </span>
                </label>
                {!autoStartChapter && (
                  <div className="flex items-center gap-2 pl-6">
                    <span className="text-sm text-muted-foreground">起始章节：</span>
                    <Input
                      type="number"
                      min={1}
                      value={startChapter}
                      onChange={(e) => setStartChapter(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-24"
                    />
                    <span className="text-xs text-muted-foreground">
                      将从第{startChapter}章开始
                    </span>
                  </div>
                )}
                {autoStartChapter && (
                  <div className="pl-6 text-xs text-muted-foreground">
                    从下一个可用章节号（第{startChapter}章）开始
                  </div>
                )}
              </div>

              {/* 覆盖选项 */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overwrite}
                    onChange={(e) => setOverwrite(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm font-medium">
                    覆盖已存在的章节文件
                  </span>
                </label>
                {overwrite && (
                  <p className="pl-6 text-xs text-emerald-600 dark:text-emerald-400">
                    ✓ 覆盖前会自动备份原章节文件到 .qmai/chapter-backups/
                  </p>
                )}
                {!overwrite && (
                  <p className="pl-6 text-xs text-amber-600 dark:text-amber-400">
                    ⚠️ 如果目标章节号已存在，导入将失败并中止。
                  </p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            {importResult ? (
              <>
                <Button variant="outline" onClick={handleCloseDialog}>
                  留在当前页
                </Button>
                <Button onClick={handleGoToChapters}>
                  前往章节查看
                </Button>
              </>
            ) : importing && importProgress ? (
              <div className="w-full space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate">正在导入：{importProgress.title}</span>
                  <span className="shrink-0">{importProgress.current}/{importProgress.total}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={handleCloseDialog}
                  disabled={importing}
                >
                  取消
                </Button>
                <Button onClick={handleImport} disabled={importing || selectedIndices.length === 0}>
                  {importing && importProgress
                    ? `导入中 ${importProgress.current}/${importProgress.total}...`
                    : importing
                      ? "导入中..."
                      : `确认导入（${selectedIndices.length}章）`}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑章节对话框 */}
      <Dialog open={editingChapterIdx !== null} onOpenChange={(open) => {
        if (!open) cancelEdit()
      }}>
        <DialogContent className="max-h-[90vh] sm:max-w-[768px]">
          <DialogHeader>
            <DialogTitle>编辑章节</DialogTitle>
            <DialogDescription>
              编辑后的内容将用于导入到章节库。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">章节标题</label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="text-sm"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">章节内容</label>
                <span className="text-xs text-muted-foreground">
                  {editContent.length} 字
                </span>
              </div>
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="min-h-[50vh] text-sm leading-relaxed"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cancelEdit}>
              放弃
            </Button>
            <Button onClick={saveEdit}>
              <Save className="mr-1 h-3.5 w-3.5" />
              保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
