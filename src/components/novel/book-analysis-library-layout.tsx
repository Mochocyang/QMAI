import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { readFile } from "@/commands/fs"
import { joinPath } from "@/lib/path-utils"
import { listStoryMapHistory } from "@/lib/novel/book-analysis/story-map-history"
import type { BookAnalysisLibraryState } from "@/lib/novel/book-analysis/library-state"
import type { PlotFramework } from "@/lib/novel/plot-framework"
import type {
  AnalysisChunkRecord,
  AnalysisRuntimeProgress,
  AnalysisSkill,
  BookAnalysisPipelineTask,
} from "@/lib/novel/book-analysis/analysis-pipeline-types"
import { BookAnalysisActiveContext } from "./book-analysis-active-context"
import { BookAnalysisModuleView, type BookAnalysisModuleTab } from "./book-analysis-module-view"

interface StoryMapCardData {
  id: string
  title: string
  mainline: string
  createdAt: number
  startOrder: number
  endOrder: number
  chapterCount: number
  mainEventCount: number
  branchCount: number
  html: string | null
}

/**
 * 拆书故事导图展示：读取 story-maps/ 下全部历史导图，按最新在前逐一渲染卡片；
 * 每张卡片含大标题 + 预览，点击「查看全部」展开到完整高度阅读。
 * 兼容旧数据：若只有根目录 story-map.html（无历史目录），按单张方式展示。
 */
export function StoryMapContent({
  bookPath,
  refreshKey = 0,
  onDeleteStoryMap,
}: {
  bookPath: string
  refreshKey?: number
  /** 删除某张历史导图（id 为历史目录名或 legacy）；由父级实际执行磁盘删除 */
  onDeleteStoryMap?: (id: string) => Promise<void> | void
}) {
  const [cards, setCards] = useState<StoryMapCardData[] | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setCards(null)
    setExpandedIds(new Set())
    void (async () => {
      try {
        const history = await listStoryMapHistory(bookPath)
        const loaded: StoryMapCardData[] = []
        for (const entry of history) {
          const html = await readFile(entry.htmlPath).catch(() => null)
          const map = entry.map
          const orders = map.chapters.map((chapter) => chapter.order)
          loaded.push({
            id: entry.dirName,
            title: map.bookTitle,
            mainline: map.mainLineLabel,
            createdAt: map.createdAt,
            startOrder: orders.length ? Math.min(...orders) : 0,
            endOrder: orders.length ? Math.max(...orders) : 0,
            chapterCount: map.chapters.length,
            mainEventCount: map.chapters.reduce((sum, chapter) => sum + chapter.mainEvents.length, 0),
            branchCount: map.chapters.reduce((sum, chapter) => sum + chapter.branches.length, 0),
            html,
          })
        }
        if (cancelled) return
        if (loaded.length > 0) {
          // 新的在前
          setCards(loaded.reverse())
          return
        }
        // 旧格式兼容：仅根目录 story-map.html（未走历史目录生成的老数据）
        const legacyHtml = await readFile(joinPath(bookPath, "story-map.html")).catch(() => null)
        if (cancelled) return
        if (legacyHtml) {
          setCards([{
            id: "legacy",
            title: "",
            mainline: "",
            createdAt: 0,
            startOrder: 0,
            endOrder: 0,
            chapterCount: 0,
            mainEventCount: 0,
            branchCount: 0,
            html: legacyHtml,
          }])
        } else {
          setCards([])
        }
      } catch {
        if (!cancelled) setCards([])
      }
    })()
    return () => { cancelled = true }
  }, [bookPath, refreshKey])

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDeleteMap = async (card: StoryMapCardData) => {
    const title = card.title ? `《${card.title}》故事导图` : "故事导图"
    if (!window.confirm(`确认删除「${title}」吗？\n\n删除后不可恢复。`)) return
    if (!onDeleteStoryMap) return
    try {
      await onDeleteStoryMap(card.id)
      setCards((prev) => (prev ? prev.filter((item) => item.id !== card.id) : prev))
    } catch (error) {
      console.error("[story-map] 删除故事导图失败", error)
    }
  }

  if (cards === null) {
    return <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">正在加载故事导图…</div>
  }
  if (cards.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        尚未提取故事导图。请先分析「故事」技能生成导图。
      </div>
    )
  }
  return (
    <div className="space-y-4" aria-label="故事导图历史列表">
      {cards.map((card) => {
        const expanded = expandedIds.has(card.id)
        return (
          <div key={card.id} className="overflow-hidden rounded-md border bg-white">
            <div className="flex items-start justify-between gap-3 border-b bg-background px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">
                  {card.title ? `《${card.title}》故事导图` : "故事导图"}
                  {card.mainline ? (
                    <span className="ml-2 text-sm font-medium text-primary">主线：{card.mainline}</span>
                  ) : null}
                </div>
                {card.createdAt > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    生成于 {new Date(card.createdAt).toLocaleString("zh-CN")}
                    {card.chapterCount > 0
                      ? ` ｜ 覆盖第 ${card.startOrder}～${card.endOrder} 章 ｜ 主线 ${card.mainEventCount} 条 · 分支 ${card.branchCount} 条`
                      : ""}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => toggleExpand(card.id)}>
                  {expanded ? "收起" : "查看全部"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => void handleDeleteMap(card)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  删除
                </Button>
              </div>
            </div>
            {card.html ? (
              <iframe
                title={`故事导图预览-${card.id}`}
                srcDoc={card.html}
                sandbox="allow-same-origin"
                className={`w-full border-0 ${expanded ? "h-[70vh]" : "h-[300px]"}`}
              />
            ) : (
              <div className="p-4 text-sm text-muted-foreground">该历史导图的 HTML 缺失，无法预览。</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface BookAnalysisLibraryLayoutProps {
  state: BookAnalysisLibraryState
  selectedBookId: string | null
  selectedCharacterId: string | null
  extractingStyle: boolean
  extractingCharacters: boolean
  extractingStoryFramework: boolean
  addingToSoul: boolean
  storyFrameworks?: PlotFramework[]
  importTaskPanel?: ReactNode
  analysisTask?: BookAnalysisPipelineTask | null
  analysisChunks?: AnalysisChunkRecord[]
  analysisProgresses?: Record<string, AnalysisRuntimeProgress>
  /** 同书全部分析任务（含并行运行的多个）；用于分别显示各自的并行进度 */
  analysisTasks?: BookAnalysisPipelineTask[]
  /** 并行任务各自的控制：暂停/继续/重试/取消（按任务 id 定位） */
  onParallelPauseTask?: (taskId: string) => void
  onParallelContinueTask?: (taskId: string) => void
  onParallelRetryTask?: (taskId: string) => void
  onParallelCancelTask?: (taskId: string) => void
  onSelectBook: (bookId: string) => void
  onSelectCharacter: (characterId: string) => void
  onImportNovel: () => void
  onExtractStyle: () => void
  onExtractStoryFramework: () => void
  onCreateOutlineFromFramework?: (frameworkId: string) => void
  /** 打开该作品生成的故事导图（story-map.html）；未提取时传 undefined 隐藏入口 */
  onOpenStoryMap?: (bookPath: string) => void
  onToggleStyle: () => void
  onAddSelectedSkillsToSoul: (skillId: string) => void
  onOpenSkillSelection?: () => void
  onReextractCharacters: () => void
  onReextractSkill?: (skill: AnalysisSkill) => void
  onConfigureAnalysisTask?: () => void
  onSelectAnalysisCharacters?: () => void
  onRetryAnalysisChunk?: (skill: AnalysisSkill, chunkId: string) => void
  onDeleteBook: (bookId: string) => void
  /** 删除单个角色（档案 + Skill） */
  onDeleteCharacter?: (characterId: string) => void
  /** 删除作品文风画像 */
  onDeleteStyle?: () => void
  /** 删除某张历史故事导图（id 为历史目录名或 legacy） */
  onDeleteStoryMap?: (id: string) => Promise<void> | void
  /** 受控页签：任务完成「查看结果」时可从外部切换到对应 Skill 页签 */
  analysisActiveTab?: BookAnalysisModuleTab
  onAnalysisActiveTabChange?: (tab: BookAnalysisModuleTab) => void
  /** 故事导图刷新键：故事任务完成后递增，触发 StoryMapContent 重新读取历史导图 */
  storyMapRefreshKey?: number
}

export function BookAnalysisLibraryLayout({
  state,
  selectedBookId,
  selectedCharacterId,
  extractingStyle,
  addingToSoul,
  analysisTask,
  analysisChunks = [],
  analysisProgresses = {},
  analysisTasks = [],
  onParallelPauseTask,
  onParallelContinueTask,
  onParallelRetryTask,
  onParallelCancelTask,
  onSelectCharacter,
  onOpenStoryMap,
  onToggleStyle,
  onAddSelectedSkillsToSoul,
  onOpenSkillSelection,
  onReextractCharacters,
  onExtractStoryFramework,
  onExtractStyle,
  onReextractSkill,
  onConfigureAnalysisTask,
  onSelectAnalysisCharacters,
  onRetryAnalysisChunk,
  onDeleteCharacter,
  onDeleteStyle,
  onDeleteStoryMap,
  analysisActiveTab,
  onAnalysisActiveTabChange,
  storyMapRefreshKey,
}: BookAnalysisLibraryLayoutProps) {
  const selectedBook = state.books.find((book) => book.id === selectedBookId) ?? state.books[0] ?? null

  if (!selectedBook) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/20 p-8 text-sm text-muted-foreground">
        请在左侧作品列表导入或选择一本小说
      </div>
    )
  }

  const storyContent = (
    <StoryMapContent bookPath={selectedBook.path} refreshKey={storyMapRefreshKey} onDeleteStoryMap={onDeleteStoryMap} />
  )

  return (
    <div className="flex h-full min-h-0 bg-muted/20">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b bg-background px-5 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-muted-foreground">拆书库</div>
              <h2 className="text-lg font-semibold">{selectedBook.metadata.title}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{selectedBook.metadata.totalChapters} 章 · {selectedBook.metadata.totalWords.toLocaleString()} 字</p>
            </div>
            {onOpenStoryMap ? (
              <Button variant="outline" size="sm" onClick={() => onOpenStoryMap(selectedBook.path)}>
                打开故事导图
              </Button>
            ) : null}
          </div>
        </header>
        <BookAnalysisModuleView
        book={selectedBook}
        task={analysisTask}
        tasks={analysisTasks}
        chunks={analysisChunks}
        progresses={analysisProgresses}
        selectedCharacterId={selectedCharacterId}
        storyContent={storyContent}
        extractingStyle={extractingStyle}
        addingToSoul={addingToSoul}
        onSelectCharacter={onSelectCharacter}
        onToggleStyle={onToggleStyle}
        onAddSelectedSkillsToSoul={onAddSelectedSkillsToSoul}
        onOpenSkillSelection={onOpenSkillSelection}
        onReextract={(skill) => {
          if (onReextractSkill) onReextractSkill(skill)
          else if (skill === "characters") onReextractCharacters()
          else if (skill === "story") onExtractStoryFramework()
          else onExtractStyle()
        }}
        onDeleteCharacter={onDeleteCharacter}
        onDeleteStyle={onDeleteStyle}
        onConfigureTask={onConfigureAnalysisTask}
        onSelectCharacters={onSelectAnalysisCharacters}
        onPauseTask={onParallelPauseTask}
        onContinueTask={onParallelContinueTask}
        onRetryTask={onParallelRetryTask}
        onRetryChunk={onRetryAnalysisChunk}
        onCancelTask={onParallelCancelTask}
        activeTab={analysisActiveTab}
        onActiveTabChange={onAnalysisActiveTabChange}
        />
      </main>
      <BookAnalysisActiveContext enabledStyle={state.enabledStyle} bindings={state.bindings} />
    </div>
  )
}
