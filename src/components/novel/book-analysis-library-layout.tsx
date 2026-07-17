import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import type { BookAnalysisLibraryState } from "@/lib/novel/book-analysis/library-state"
import type { PlotFramework } from "@/lib/novel/plot-framework"
import type { AnalysisChunkRecord, AnalysisSkill, BookAnalysisPipelineTask } from "@/lib/novel/book-analysis/analysis-pipeline-types"
import { BookAnalysisActiveContext } from "./book-analysis-active-context"
import { BookAnalysisModuleView } from "./book-analysis-module-view"

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
  onSelectBook: (bookId: string) => void
  onSelectCharacter: (characterId: string) => void
  onImportNovel: () => void
  onExtractStyle: () => void
  onExtractStoryFramework: () => void
  onCreateOutlineFromFramework?: (frameworkId: string) => void
  onToggleStyle: () => void
  onAddSelectedSkillsToSoul: (skillId: string) => void
  onOpenSkillSelection?: () => void
  onReextractCharacters: () => void
  onReextractSkill?: (skill: AnalysisSkill) => void
  onConfigureAnalysisTask?: () => void
  onPauseAnalysisTask?: () => void
  onContinueAnalysisTask?: () => void
  onRetryAnalysisTask?: () => void
  onCancelAnalysisTask?: () => void
  onDeleteBook: (bookId: string) => void
}

export function BookAnalysisLibraryLayout({
  state,
  selectedBookId,
  selectedCharacterId,
  extractingStyle,
  addingToSoul,
  storyFrameworks = [],
  analysisTask,
  analysisChunks = [],
  onSelectCharacter,
  onCreateOutlineFromFramework,
  onToggleStyle,
  onAddSelectedSkillsToSoul,
  onOpenSkillSelection,
  onReextractCharacters,
  onExtractStoryFramework,
  onExtractStyle,
  onReextractSkill,
  onConfigureAnalysisTask,
  onPauseAnalysisTask,
  onContinueAnalysisTask,
  onRetryAnalysisTask,
  onCancelAnalysisTask,
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
    <section className="space-y-3">
      {storyFrameworks.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">尚未提取故事框架。</div>
      ) : storyFrameworks.map((framework) => (
        <article key={framework.id} className="rounded-md border bg-background p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-medium">{framework.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{framework.line === "main" ? "主线" : "支线"} · 覆盖 {framework.rangeChapterIds.length} 章</p>
            </div>
            {onCreateOutlineFromFramework && <Button variant="outline" size="sm" onClick={() => onCreateOutlineFromFramework(framework.id)}>基于此框架创建章纲</Button>}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div><div className="font-medium">开局钩子</div><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{framework.beats.hook}</p></div>
            <div><div className="font-medium">铺垫</div><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{framework.beats.buildup}</p></div>
            <div><div className="font-medium">爽点</div><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{framework.beats.payoff}</p></div>
            <div><div className="font-medium">结尾钩子</div><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{framework.beats.endingHook}</p></div>
          </div>
        </article>
      ))}
    </section>
  )

  return (
    <div className="flex h-full min-h-0 bg-muted/20">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b bg-background px-5 py-3">
          <div className="text-xs font-medium text-muted-foreground">拆书库</div>
          <h2 className="text-lg font-semibold">{selectedBook.metadata.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{selectedBook.metadata.totalChapters} 章 · {selectedBook.metadata.totalWords.toLocaleString()} 字</p>
        </header>
        <BookAnalysisModuleView
        book={selectedBook}
        task={analysisTask}
        chunks={analysisChunks}
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
        onConfigureTask={onConfigureAnalysisTask}
        onPauseTask={onPauseAnalysisTask}
        onContinueTask={onContinueAnalysisTask}
        onRetryTask={onRetryAnalysisTask}
        onCancelTask={onCancelAnalysisTask}
        />
      </main>
      <BookAnalysisActiveContext enabledStyle={state.enabledStyle} bindings={state.bindings} />
    </div>
  )
}
