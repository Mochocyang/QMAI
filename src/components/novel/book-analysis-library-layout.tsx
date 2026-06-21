import { Plus, RefreshCw, Users, Loader2, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { BookAnalysisLibraryState } from "@/lib/novel/book-analysis/library-state"
import type { BookAnalysisTask } from "@/lib/novel/book-analysis/types"
import { BookAnalysisActiveContext } from "./book-analysis-active-context"
import { BookAnalysisCharacterPanel } from "./book-analysis-character-panel"
import { BookAnalysisStyleCard } from "./book-analysis-style-card"

interface BookAnalysisLibraryLayoutProps {
  state: BookAnalysisLibraryState
  selectedBookId: string | null
  selectedCharacterId: string | null
  extractingStyle: boolean
  extractingCharacters: boolean
  addingToSoul: boolean
  tasks: BookAnalysisTask[]
  onCancelTask: (taskId: string) => void
  onSelectBook: (bookId: string) => void
  onSelectCharacter: (characterId: string) => void
  onImportNovel: () => void
  onExtractStyle: () => void
  onToggleStyle: () => void
  onAddSelectedSkillsToSoul: (skillId: string) => void
  onReextractCharacters: () => void
  onDeleteBook: (bookId: string) => void
}

export function BookAnalysisLibraryLayout({
  state,
  selectedBookId,
  selectedCharacterId,
  extractingStyle,
  extractingCharacters,
  addingToSoul,
  tasks,
  onCancelTask,
  onSelectCharacter,
  onImportNovel,
  onExtractStyle,
  onToggleStyle,
  onAddSelectedSkillsToSoul,
  onReextractCharacters,
}: BookAnalysisLibraryLayoutProps) {
  const selectedBook = state.books.find((book) => book.id === selectedBookId) ?? state.books[0] ?? null
  const runningTasks = tasks.filter((t) => t.status === "running")

  return (
    <div className="relative flex h-full min-h-0 bg-muted/20">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b bg-background px-5 py-3">
          <div>
            <h2 className="text-xl font-semibold">拆书库</h2>
            <p className="mt-1 text-xs text-muted-foreground">管理作品文风、角色 Skill 和小说人物绑定。</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedBook && (
              <>
                <Button variant="outline" size="sm" onClick={onReextractCharacters} disabled={extractingCharacters}>
                  <Users className="mr-1.5 h-3.5 w-3.5" />
                  {extractingCharacters ? "提取中..." : "重新提取角色"}
                </Button>
                <Button variant="outline" size="sm" onClick={onExtractStyle} disabled={extractingStyle}>
                  <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${extractingStyle ? "animate-spin" : ""}`} />
                  {extractingStyle ? "提取中..." : "重新提取文风"}
                </Button>
              </>
            )}
            <Button onClick={onImportNovel}>
              <Plus className="mr-2 h-4 w-4" />
              导入小说
            </Button>
          </div>
        </header>
        {selectedBook ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
            <div>
              <h3 className="text-lg font-semibold">{selectedBook.metadata.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedBook.metadata.totalChapters} 章 · {selectedBook.metadata.totalWords.toLocaleString()} 字
              </p>
            </div>
            <BookAnalysisStyleCard
              book={selectedBook}
              extracting={extractingStyle}
              onExtractStyle={onExtractStyle}
              onToggleStyle={onToggleStyle}
            />
            <BookAnalysisCharacterPanel
              book={selectedBook}
              selectedCharacterId={selectedCharacterId}
              addingToSoul={addingToSoul}
              onSelectCharacter={onSelectCharacter}
              onAddSelectedSkillsToSoul={onAddSelectedSkillsToSoul}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div>
              <h3 className="text-lg font-semibold">还没有拆书作品</h3>
              <p className="mt-2 text-sm text-muted-foreground">导入 TXT 小说后，可以提取角色 Skill 和作品文风。</p>
              <Button className="mt-4" onClick={onImportNovel}>导入小说</Button>
            </div>
          </div>
        )}
      </main>
      <BookAnalysisActiveContext enabledStyle={state.enabledStyle} bindings={state.bindings} />

      {/* 提取进度浮层 - 显示在拆书库底部 */}
      {runningTasks.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-20 border-t bg-background/95 backdrop-blur-sm px-5 py-3 space-y-2">
          {runningTasks.map((task) => {
            const stageLabel = task.progress.stageLabel || "处理中"
            const percentage = task.progress.percentage ?? 0
            return (
              <div key={task.id} className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="font-medium text-foreground">{stageLabel}</span>
                  <span className="ml-auto text-muted-foreground shrink-0">{percentage}%</span>
                  <button
                    type="button"
                    onClick={() => onCancelTask(task.id)}
                    className="ml-2 flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors"
                    title="立即停止提取"
                  >
                    <Square className="h-3 w-3" />
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
