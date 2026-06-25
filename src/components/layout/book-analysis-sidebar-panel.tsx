/**
 * 拆书作品侧边栏面板
 * 显示所有已分析的作品列表
 */

import { useEffect, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { useBookAnalysisStore } from "@/stores/book-analysis-store"
import { Button } from "@/components/ui/button"
import { BookOpen, Trash2, RefreshCw, Loader2, Square, CheckCircle2 } from "lucide-react"
import { listDirectory, readFile, deleteFile } from "@/commands/fs"
import { joinPath, normalizePath } from "@/lib/path-utils"
import { toast } from "@/lib/toast"
import { deleteOrphanAurasForBook } from "@/lib/novel/book-analysis/aura-cleanup"
import { listCharacterAuras } from "@/lib/novel/character-aura"
import { PanelHeaderWithHelp } from "@/components/layout/panel-header-with-help"
import type { BookAnalysisMetadata } from "@/lib/novel/book-analysis/types"

interface BookItem {
  id: string
  title: string
  author?: string
  totalChapters: number
  totalWords: number
  createdAt: number
  updatedAt: number
  charactersCount: number
  skillsCount: number
  path: string
}

export function BookAnalysisSidebarPanel() {
  const project = useWikiStore((s) => s.project)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const { setSelectedLibraryBookId, sidebarRefreshCounter, triggerSidebarRefresh } = useBookAnalysisStore()
  const tasks = useBookAnalysisStore((s) => s.tasks)
  const cancelTask = useBookAnalysisStore((s) => s.cancelTask)
  const requestReopenChapterSelection = useBookAnalysisStore((s) => s.requestReopenChapterSelection)
  const [books, setBooks] = useState<BookItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null)
  const [bookAuraCount, setBookAuraCount] = useState<Record<string, number>>({})

  // 正在运行的任务：识别已完成的任务退出"运行中"，不再显示 Loader2 转圈
  const runningTasks = tasks.filter((t) => t.status === "running" && t.progress.recognitionStatus !== "done")
  // 识别完成、等待用户处理（点"现在处理"重新打开面板）的任务
  const recognitionDoneTasks = tasks.filter((t) => t.status === "running" && t.progress.recognitionStatus === "done")

  const handleReopenRecognition = (taskId: string) => {
    requestReopenChapterSelection(taskId)
    setActiveView("bookAnalysis")
  }

  useEffect(() => {
    if (project?.path) {
      loadBooks()
    }
  }, [project?.path, sidebarRefreshCounter])

  async function loadBooks() {
    if (!project?.path) return

    setLoading(true)
    try {
      const bookAnalysisDir = normalizePath(joinPath(project.path, "book-analysis"))

      try {
        const items = await listDirectory(bookAnalysisDir)
        const bookItems: BookItem[] = []

        for (const item of items) {
          if (item.is_dir && item.name.startsWith("book-")) {
            try {
              const metadataPath = joinPath(item.path, "metadata.json")
              const metadataContent = await readFile(metadataPath)
              const metadata: BookAnalysisMetadata = JSON.parse(metadataContent)

              // 统计角色和技能数量
              let charactersCount = 0
              let skillsCount = 0

              try {
                const charactersDir = joinPath(item.path, "characters")
                const characterFiles = await listDirectory(charactersDir)
                charactersCount = characterFiles.filter(f => !f.is_dir && f.name.endsWith(".json")).length
              } catch {
                // 目录不存在
              }

              try {
                const skillsDir = joinPath(item.path, "skills")
                const skillFiles = await listDirectory(skillsDir)
                skillsCount = skillFiles.filter(f => !f.is_dir && f.name.endsWith(".md")).length
              } catch {
                // 目录不存在
              }

              bookItems.push({
                id: item.name,
                title: metadata.title,
                author: metadata.author,
                totalChapters: metadata.totalChapters,
                totalWords: metadata.totalWords,
                createdAt: metadata.createdAt,
                updatedAt: metadata.updatedAt,
                charactersCount,
                skillsCount,
                path: item.path,
              })
            } catch (err) {
              console.error(`Failed to load book ${item.name}:`, err)
            }
          }
        }

        // 按更新时间排序
        bookItems.sort((a, b) => b.updatedAt - a.updatedAt)
        setBooks(bookItems)
        // 计算每本书对应的"已添加灵魂"数量（feature 优化 5）
        await refreshAuraCounts(bookItems)
      } catch (err) {
        // book-analysis 目录不存在
        setBooks([])
        setBookAuraCount({})
      }
    } finally {
      setLoading(false)
    }
  }

  async function refreshAuraCounts(items: BookItem[]) {
    if (!project?.path) {
      setBookAuraCount({})
      return
    }
    try {
      const auras = await listCharacterAuras(project.path)
      const aurasFromBook = auras.filter((aura) => !aura.builtIn)
      const counts: Record<string, number> = {}
      await Promise.all(
        items.map(async (book) => {
          const ids = aurasFromBook
            .filter((aura) => aura.category === "拆书角色")
            .filter((aura) => {
              const note = aura.sourceNote ?? ""
              return note.includes(`《${book.title}》`)
            })
            .map((aura) => aura.id)
          // 不统计孤儿列表，统计"所有属于这本书的灵魂"
          counts[book.id] = ids.length
        }),
      )
      setBookAuraCount(counts)
    } catch (error) {
      // 静默失败，不影响主列表
      console.warn("[book-analysis] 统计灵魂数失败", error)
      setBookAuraCount({})
    }
  }

  const handleViewBook = async (book: BookItem) => {
    // 选中作品，三栏布局会自动显示详情
    setSelectedBookId(book.id)
    setSelectedLibraryBookId(book.id)
    setActiveView("bookAnalysis")
  }

  const handleDeleteBook = async (book: BookItem) => {
    const confirmed = window.confirm(
      `确认删除作品"${book.title}"吗？\n\n这将删除：\n- 所有角色信息\n- 所有生成的 Skills\n- 分析元数据\n\n此操作无法撤销。`
    )
    if (!confirmed) return

    const projectPath = project?.path
    if (!projectPath) {
      toast.error("当前没有打开任何项目，无法删除")
      return
    }

    try {
      await deleteFile(book.path)
      // 同步清理由该作品生成的孤儿灵魂（feature 优化 4）
      const cleaned = await deleteOrphanAurasForBook(projectPath, book.title).catch(() => 0)
      await loadBooks()
      if (selectedBookId === book.id) {
        setSelectedBookId(null)
        setSelectedLibraryBookId(null)
      }
      // 触发主面板刷新 libraryState
      triggerSidebarRefresh()
      if (cleaned > 0) {
        toast.success(`已删除作品「${book.title}」，并清理了 ${cleaned} 个孤儿灵魂`)
      } else {
        toast.success(`已删除作品「${book.title}」`)
      }
    } catch (err) {
      console.error("Failed to delete book:", err)
      toast.error("删除作品失败，请稍后重试")
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* 标题栏 */}
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="min-w-0">
          <PanelHeaderWithHelp title="作品库" helpKey="bookAnalysis" />
          <div className="mt-0.5 text-xs text-muted-foreground">
            已分析 {books.length} 部作品
          </div>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={loadBooks}
          disabled={loading}
          title="刷新列表"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* 作品列表 */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {loading ? (
          <div className="px-2 py-4 text-xs text-muted-foreground">正在加载...</div>
        ) : books.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-xs leading-5 text-muted-foreground">
            还没有作品。点击主面板的"导入小说"按钮开始分析。
          </div>
        ) : (
          books.map((book) => (
            <div
              key={book.id}
              className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                selectedBookId === book.id
                  ? "border-primary bg-primary/10"
                  : "bg-background hover:bg-muted"
              }`}
            >
              <button
                type="button"
                onClick={() => handleViewBook(book)}
                className="flex min-w-0 flex-1 items-start gap-2 text-left"
              >
                <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{book.title}</span>
                  {book.author && (
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {book.author}
                    </span>
                  )}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {book.totalChapters} 章 · {book.charactersCount} 角色 · {book.skillsCount} Skills
                  </span>
                  {(bookAuraCount[book.id] ?? 0) > 0 && (
                    <span className="mt-1 flex items-center gap-1 text-xs text-primary">
                      <CheckCircle2 className="h-3 w-3" />
                      已添加 {bookAuraCount[book.id]} 个灵魂
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleDeleteBook(book)}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                title="删除作品"
                aria-label="删除作品"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* 提取进度区域 */}
      {(runningTasks.length > 0 || recognitionDoneTasks.length > 0) && (
        <div className="shrink-0 border-t px-3 py-2 space-y-2">
          {/* 识别完成、待处理：显示"现在处理"按钮，不再转圈 */}
          {recognitionDoneTasks.map((task) => {
            const stageLabel = task.progress.stageLabel || "识别完成"
            return (
              <div key={task.id} className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  <span className="font-medium text-foreground truncate">{stageLabel}</span>
                  <button
                    type="button"
                    onClick={() => handleReopenRecognition(task.id)}
                    className="ml-auto flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20 transition-colors"
                    title="打开角色选择面板"
                  >
                    现在处理
                  </button>
                </div>
              </div>
            )
          })}
          {/* 运行中：显示进度条 + 停止按钮 */}
          {runningTasks.map((task) => {
            const stageLabel = task.progress.stageLabel || "处理中"
            const percentage = task.progress.percentage ?? 0
            return (
              <div key={task.id} className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs">
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  <span className="font-medium text-foreground truncate">{stageLabel}</span>
                  <span className="ml-auto text-muted-foreground shrink-0">{percentage}%</span>
                  <button
                    type="button"
                    onClick={() => cancelTask(task.id)}
                    className="flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20 transition-colors"
                    title="立即停止提取"
                  >
                    <Square className="h-2.5 w-2.5" />
                    停止
                  </button>
                </div>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                {task.progress.currentItem && (
                  <div className="text-xs text-muted-foreground truncate">{task.progress.currentItem}</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
