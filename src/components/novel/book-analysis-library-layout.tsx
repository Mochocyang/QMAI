import { Plus, RefreshCw, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { BookAnalysisLibraryState } from "@/lib/novel/book-analysis/library-state"
import { BookAnalysisActiveContext } from "./book-analysis-active-context"
import { BookAnalysisCharacterPanel } from "./book-analysis-character-panel"
import { BookAnalysisStyleCard } from "./book-analysis-style-card"
import type { PlotFramework } from "@/lib/novel/plot-framework"

interface BookAnalysisLibraryLayoutProps {
  state: BookAnalysisLibraryState
  selectedBookId: string | null
  selectedCharacterId: string | null
  extractingStyle: boolean
  extractingCharacters: boolean
  extractingStoryFramework: boolean
  addingToSoul: boolean
  storyFrameworks?: PlotFramework[]
  onSelectBook: (bookId: string) => void
  onSelectCharacter: (characterId: string) => void
  onImportNovel: () => void
  onExtractStyle: () => void
  onExtractStoryFramework: () => void
  onCreateOutlineFromFramework?: (frameworkId: string) => void
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
  extractingStoryFramework,
  addingToSoul,
  storyFrameworks = [],
  onSelectCharacter,
  onImportNovel,
  onExtractStyle,
  onExtractStoryFramework,
  onCreateOutlineFromFramework,
  onToggleStyle,
  onAddSelectedSkillsToSoul,
  onReextractCharacters,
}: BookAnalysisLibraryLayoutProps) {
  const selectedBook = state.books.find((book) => book.id === selectedBookId) ?? state.books[0] ?? null

  return (
    <div className="flex h-full min-h-0 bg-muted/20">
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onExtractStoryFramework}
                  disabled={extractingStoryFramework}
                >
                  <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${extractingStoryFramework ? "animate-spin" : ""}`} />
                  {extractingStoryFramework ? "提取中..." : "故事框架提取"}
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
            <section className="rounded-lg border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">故事框架</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    从选中章节提取钩子、铺垫、爽点和结尾钩子，可用于后续章纲生成。
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onExtractStoryFramework}
                  disabled={extractingStoryFramework}
                >
                  {extractingStoryFramework ? "提取中..." : "提取故事框架"}
                </Button>
              </div>
              {storyFrameworks.length === 0 ? (
                <div className="mt-3 rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
                  尚未提取故事框架。点击“故事框架提取”后选择章节，生成可复用的四段框架。
                </div>
              ) : (
                <div className="mt-3 grid gap-2">
                  {storyFrameworks.map((framework) => (
                    <div key={framework.id} className="rounded-md border bg-muted/30 p-3 text-xs">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{framework.title}</div>
                          <div className="mt-1 text-muted-foreground">
                            {framework.line === "main" ? "主线" : "支线"} · 覆盖 {framework.rangeChapterIds.length} 章
                          </div>
                        </div>
                        {onCreateOutlineFromFramework && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onCreateOutlineFromFramework(framework.id)}
                          >
                            基于此框架创建章纲
                          </Button>
                        )}
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div>
                          <div className="font-medium">开局钩子</div>
                          <div className="mt-1 line-clamp-2 text-muted-foreground">{framework.beats.hook}</div>
                        </div>
                        <div>
                          <div className="font-medium">爽点</div>
                          <div className="mt-1 line-clamp-2 text-muted-foreground">{framework.beats.payoff}</div>
                        </div>
                      </div>
                      <details className="mt-3 rounded-md border bg-background px-3 py-2">
                        <summary className="cursor-pointer text-xs font-medium text-primary">
                          查看完整框架
                        </summary>
                        <div className="mt-3 grid gap-3 text-xs leading-5">
                          <div>
                            <div className="font-medium">开局钩子</div>
                            <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{framework.beats.hook}</div>
                          </div>
                          <div>
                            <div className="font-medium">铺垫</div>
                            <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{framework.beats.buildup}</div>
                          </div>
                          <div>
                            <div className="font-medium">爽点</div>
                            <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{framework.beats.payoff}</div>
                          </div>
                          <div>
                            <div className="font-medium">结尾钩子</div>
                            <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{framework.beats.endingHook}</div>
                          </div>
                          {framework.handcraftHints ? (
                            <div>
                              <div className="font-medium">作者手搓留白</div>
                              <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{framework.handcraftHints}</div>
                            </div>
                          ) : null}
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              )}
            </section>
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
    </div>
  )
}
