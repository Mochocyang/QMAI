/**
 * 拆书作品侧边栏面板
 * 显示所有已分析的作品列表
 */

import { useEffect, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { useBookAnalysisStore } from "@/stores/book-analysis-store"
import { Button } from "@/components/ui/button"
import { BookOpen, Trash2, Eye, RefreshCw } from "lucide-react"
import { listDirectory, readFile, deleteFile } from "@/commands/fs"
import { joinPath, normalizePath } from "@/lib/path-utils"
import { toast } from "@/lib/toast"
import { deleteOrphanAurasForBook } from "@/lib/novel/book-analysis/aura-cleanup"
import { listCharacterAuras } from "@/lib/novel/character-aura"
import { CheckCircle2 } from "lucide-react"
import type { BookAnalysisMetadata, BookAnalysisResult, CharacterSkill, ExtractedCharacter } from "@/lib/novel/book-analysis/types"

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
  const { setCurrentResult, setShowResultViewer } = useBookAnalysisStore()
  const [books, setBooks] = useState<BookItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null)
  const [bookAuraCount, setBookAuraCount] = useState<Record<string, number>>({})

  useEffect(() => {
    if (project?.path) {
      loadBooks()
    }
  }, [project?.path])

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
    try {
      // 读取元数据
      const metadataPath = joinPath(book.path, "metadata.json")
      const metadataContent = await readFile(metadataPath)
      const metadata: BookAnalysisMetadata = JSON.parse(metadataContent)

      // 读取角色数据
      const characters: ExtractedCharacter[] = []
      try {
        const charactersDir = joinPath(book.path, "characters")
        const characterFiles = await listDirectory(charactersDir)
        for (const file of characterFiles) {
          if (!file.is_dir && file.name.endsWith(".json")) {
            const content = await readFile(file.path)
            characters.push(JSON.parse(content))
          }
        }
      } catch {
        // 没有角色数据
      }

      // 读取 Skills 数据
      const skills: CharacterSkill[] = []
      try {
        const skillsDir = joinPath(book.path, "skills")
        const skillFiles = await listDirectory(skillsDir)
        for (const file of skillFiles) {
          if (!file.is_dir && file.name.endsWith(".md")) {
            const content = await readFile(file.path)
            const baseName = file.name.replace(/-skill\.md$/i, "").replace(/\.md$/i, "")
            const character = characters.find((item) => item.name === baseName || file.name.includes(item.name))
            skills.push({
              id: character ? `skill-${character.id}` : `skill-${baseName}`,
              characterId: character?.id ?? baseName,
              characterName: character?.name ?? baseName,
              skillContent: content,
              sourceBook: metadata.title,
              chapterRange: character ? [`${character.firstAppearance}`, `${character.lastAppearance}`] : [],
              createdAt: metadata.createdAt,
              filePath: file.path,
            })
          }
        }
      } catch {
        // 没有 Skills 数据
      }

      // 构建结果对象
      const result: BookAnalysisResult = {
        metadata,
        characters,
        skills,
      }

      // 切换到拆书视图并显示结果
      setActiveView("bookAnalysis")
      setCurrentResult(result)
      setShowResultViewer(true)
    } catch (err) {
      console.error("Failed to load book:", err)
      alert("加载作品失败，请重试")
    }
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
      }
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
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-foreground">拆书作品（测试功能）</span>
            <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              实验
            </span>
          </div>
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
            还没有拆书作品。点击主面板的“拆书作品”按钮开始分析。
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
                onClick={() => setSelectedBookId(book.id)}
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
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => handleViewBook(book)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                  title="查看分析结果"
                  aria-label="查看分析结果"
                >
                  <Eye className="h-4 w-4" />
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
            </div>
          ))
        )}
      </div>
    </div>
  )
}
