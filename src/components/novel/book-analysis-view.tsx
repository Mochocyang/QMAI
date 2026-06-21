﻿import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { BookAnalysisInputDialog } from "./book-analysis-input-dialog"
import { BookAnalysisLibraryLayout } from "./book-analysis-library-layout"
import { BookAnalysisResultViewer } from "./book-analysis-result-viewer"
import { ChapterSelectionPanel } from "./chapter-selection-panel"
import { useBookAnalysisStore } from "@/stores/book-analysis-store"
import { useWikiStore } from "@/stores/wiki-store"
import { resolveModelConfig } from "@/lib/novel/model-resolver"
import {
  toBookAnalysisResult,
  type BookAnalysisLibraryState,
} from "@/lib/novel/book-analysis/library-state"
import { toast } from "@/lib/toast"
import { BookOpen, Check, Loader2, Plus, X } from "lucide-react"
import type {
  AnalysisDepth,
  SixDimensionProgressItem,
  SixDimensionStatus,
  RecognizedCharacter,
} from "@/lib/novel/book-analysis/types"
import { useCharacterExtraction, type ChapterSelectionData } from "./hooks/use-character-extraction"
import { useCharacterRecognition } from "./hooks/use-character-recognition"
import { useLibraryOperations } from "./hooks/use-library-operations"

/** 6 维度状态图标的视觉映射 */
function DimensionStatusIcon({ status }: { status: SixDimensionStatus }) {
  if (status === "done") {
    return <Check className="h-3.5 w-3.5 text-emerald-500" />
  }
  if (status === "failed") {
    return <X className="h-3.5 w-3.5 text-destructive" />
  }
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
  }
  return <span className="h-3.5 w-3.5 inline-block rounded-full border border-muted-foreground/40" />
}

/** 6 维度状态文字颜色 */
function dimensionTextClass(
  status: SixDimensionStatus,
  isCurrent: boolean
): string {
  if (status === "running" || isCurrent) return "text-foreground font-medium"
  if (status === "done") return "text-muted-foreground"
  if (status === "failed") return "text-destructive"
  return "text-muted-foreground/60"
}

export function BookAnalysisView() {
  const [inputDialogOpen, setInputDialogOpen] = useState(false)
  const [viewingResultPath, setViewingResultPath] = useState<string | null>(null)
  const [chapterSelectionData, setChapterSelectionData] = useState<ChapterSelectionData | null>(null)
  const [libraryState, setLibraryState] = useState<BookAnalysisLibraryState>({
    books: [],
    enabledStyle: null,
    bindings: [],
  })
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null)
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)

  const currentProject = useWikiStore((s) => s.project)
  const storeSelectedBookId = useBookAnalysisStore((s) => s.selectedLibraryBookId)
  const sidebarRefreshCounter = useBookAnalysisStore((s) => s.sidebarRefreshCounter)
  const startTask = useBookAnalysisStore((s) => s.startTask)
  const cancelTask = useBookAnalysisStore((s) => s.cancelTask)
  const tasks = useBookAnalysisStore((s) => s.tasks)
  const currentResult = useBookAnalysisStore((s) => s.currentResult)
  const showResultViewer = useBookAnalysisStore((s) => s.showResultViewer)
  const setShowResultViewer = useBookAnalysisStore((s) => s.setShowResultViewer)

  // 角色识别 LLM 配置（feature/llm-character-recognizer）
  const baseLlmConfig = useWikiStore((s) => s.llmConfig)
  const aiChatModel = useWikiStore((s) => s.aiChatModel)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const llmConfig = aiChatModel
    ? resolveModelConfig(aiChatModel, baseLlmConfig, providerConfigs)
    : baseLlmConfig

  // 角色识别 store 状态与 actions（feature/character-recognition-and-simple-mode）
  const recognitionStatus = useBookAnalysisStore((s) => s.recognitionStatus)
  const recognizedCharacters = useBookAnalysisStore((s) => s.recognizedCharacters)
  const selectedCharacterIds = useBookAnalysisStore((s) => s.selectedCharacterIds)
  const setRecognitionStatus = useBookAnalysisStore((s) => s.setRecognitionStatus)
  const setRecognizedCharacters = useBookAnalysisStore((s) => s.setRecognizedCharacters)
  const setSelectedCharacterIds = useBookAnalysisStore((s) => s.setSelectedCharacterIds)
  const clearRecognition = useBookAnalysisStore((s) => s.clearRecognition)
  const recognitionError = useBookAnalysisStore((s) => s.recognitionError)

  const selectedLibraryBook = useMemo(
    () => libraryState.books.find((book) => book.id === selectedBookId) ?? libraryState.books[0] ?? null,
    [libraryState.books, selectedBookId],
  )

  // 作品库操作钩子
  const {
    styleExtracting,
    addingToSoul,
    reloadLibraryState,
    handleLibraryExtractStyle,
    handleLibraryToggleStyle,
    handleLibraryAddSkillsToSoul,
    handleLibraryDeleteBook,
    handleLibraryReextractCharacters,
  } = useLibraryOperations({
    currentProjectPath: currentProject?.path ?? null,
    selectedLibraryBook,
    libraryState,
    setLibraryState,
    setSelectedBookId,
    setSelectedCharacterId,
    setChapterSelectionData,
    llmConfig,
    startTask,
  })

  // 角色识别钩子
  const {
    handleChapterSelectionConfirm,
    handleToggleCharacter,
    handleSelectAllMain,
    handleClearSelection,
  } = useCharacterRecognition({
    chapterSelectionData,
    setChapterSelectionData,
    recognizedCharacters,
    selectedCharacterIds,
    setRecognitionStatus,
    setRecognizedCharacters,
    setSelectedCharacterIds,
    clearRecognition,
    setRecognitionError: useBookAnalysisStore((s) => s.setRecognitionError),
    llmConfig,
  })

  // 角色特征提取钩子
  const {
    handleDeepExtract,
    handleSimpleExtract,
    handleResumeFailedExtraction,
  } = useCharacterExtraction({
    chapterSelectionData,
    setChapterSelectionData,
    recognizedCharacters,
    selectedCharacterIds,
    reloadLibraryState,
  })

  useEffect(() => {
    void reloadLibraryState()
  }, [currentProject?.path, tasks.length, sidebarRefreshCounter, reloadLibraryState])

  // 同步侧栏选中的 bookId（包括清空的情况）
  useEffect(() => {
    if (storeSelectedBookId !== selectedBookId) {
      if (storeSelectedBookId) {
        setSelectedBookId(storeSelectedBookId)
        setSelectedCharacterId(null)
      } else {
        // 侧栏清空了选中（如删除作品），重新从 libraryState 选择
        setSelectedBookId(libraryState.books[0]?.id ?? null)
        setSelectedCharacterId(null)
      }
    }
  }, [storeSelectedBookId, selectedBookId, libraryState.books])

  const handleStartAnalysis = async (config: {
    sourceType: "file"
    sourcePath: string
  }) => {
    if (!currentProject?.path) {
      console.error("没有打开的项目")
      return
    }

    // 新导入：先清空上一本书残留的识别结果（fix：导入 B 仍弹出 A 的角色弹窗）。
    clearRecognition()

    const abortController = new AbortController()

    const taskId = startTask(currentProject.path, {
      sourceType: config.sourceType,
      sourcePath: config.sourcePath,
      selectedChapters: [],
    }, abortController)

    setInputDialogOpen(false)

    try {
      const { splitNovelIntoChapters } = await import("@/lib/novel/book-analysis/analysis-engine")
      const { useWikiStore } = await import("@/stores/wiki-store")
      const storeState = useWikiStore.getState()
      const analysisLlmConfig = storeState.aiChatModel
        ? resolveModelConfig(storeState.aiChatModel, storeState.llmConfig, storeState.providerConfigs)
        : storeState.llmConfig
      const updateTaskProgress = useBookAnalysisStore.getState().updateTaskProgress
      const updateTaskMetadata = useBookAnalysisStore.getState().updateTaskMetadata

      const splitResult = await splitNovelIntoChapters(
        config.sourcePath,
        currentProject.path,
        analysisLlmConfig,
        (progress) => {
          updateTaskProgress(taskId, {
            stage: progress.stage as any,
            stageLabel: progress.stageLabel,
            completed: progress.completed,
            total: progress.total,
            percentage: progress.percentage,
            currentItem: progress.currentItem,
          })
        },
        abortController.signal
      )

      if (splitResult.success) {
        updateTaskMetadata(taskId, splitResult.metadata)

        useBookAnalysisStore.getState().updateTaskBookData(taskId, splitResult.bookId, splitResult.chapters)

        useBookAnalysisStore.getState().triggerSidebarRefresh()

        await reloadLibraryState()

        setChapterSelectionData({
          taskId,
          bookPath: splitResult.bookPath,
          chapters: splitResult.chapters,
          metadata: splitResult.metadata,
          abortController,
          selectedChapterIds: [],
          depth: "standard" as AnalysisDepth,
        })
      }
    } catch (error) {
      const errorTaskFn = useBookAnalysisStore.getState().errorTask
      const errorMessage = error instanceof Error ? error.message : "分析失败"
      if (!errorMessage.includes("取消") && !errorMessage.includes("已停止")) {
        errorTaskFn(taskId, errorMessage)
      }
    }
  }

  const handleChapterSelectionCancel = () => {
    if (chapterSelectionData) {
      cancelTask(chapterSelectionData.taskId)
      setChapterSelectionData(null)
    }
  }

  // 后台运行：只关闭面板、不取消任务，让识别/提取继续在后台跑
  const handleChapterSelectionBackground = () => {
    if (!chapterSelectionData) return
    console.log('[后台运行] 关闭面板，任务继续后台执行', chapterSelectionData.taskId)
    toast.info("任务已在后台运行，完成后会自动刷新")
    setChapterSelectionData(null)
  }

  // 是否有已提取的角色（从磁盘加载）
  const hasExtractedCharacters = useMemo(() => {
    if (!chapterSelectionData?.bookPath) return false
    const bookId = chapterSelectionData.bookPath.split(/[/\\]/).pop() ?? ""
    const book = libraryState.books.find((b) => b.id === bookId || b.path === chapterSelectionData.bookPath)
    return !!book && (book.recognizedCharacters.length > 0 || book.characters.length > 0)
  }, [chapterSelectionData?.bookPath, libraryState.books])

  // 加载已提取的角色（从磁盘读取，避免重复消耗 token）
  const handleLoadExtractedCharacters = async (selectedChapterIds: string[]) => {
    if (!chapterSelectionData?.bookPath) return
    const bookId = chapterSelectionData.bookPath.split(/[/\\]/).pop() ?? ""
    const book = libraryState.books.find((b) => b.id === bookId || b.path === chapterSelectionData.bookPath)
    if (!book || (book.recognizedCharacters.length === 0 && book.characters.length === 0)) {
      toast.info("没有已提取的角色")
      return
    }

    const fallbackCharacters: RecognizedCharacter[] = book.characters.map((c) => ({
      id: c.id,
      name: c.name,
      aliases: c.aliases ?? [],
      appearances: c.appearanceCount,
      chapterIndices: [c.firstAppearance - 1],
      importanceScore: c.importance,
      category:
        c.category === "protagonist"
          ? "主角"
          : c.category === "supporting"
          ? "配角"
          : "次要",
      sourceBook: chapterSelectionData.bookPath,
    }))

    const existingCharacters = book.recognizedCharacters.length > 0
      ? book.recognizedCharacters
      : fallbackCharacters

    setChapterSelectionData({
      ...chapterSelectionData,
      selectedChapterIds,
      depth: "standard" as AnalysisDepth,
    })
    setRecognizedCharacters(existingCharacters)
    setSelectedCharacterIds(
      existingCharacters
        .filter((c) => c.category === "主角" || c.category === "配角")
        .map((c) => c.id)
    )
    setRecognitionStatus("done")
    toast.info(`已加载 ${existingCharacters.length} 个已提取的角色，可直接选择进行提取`)
  }

  const libraryLayout = (
    <BookAnalysisLibraryLayout
      state={libraryState}
      selectedBookId={selectedLibraryBook?.id ?? selectedBookId}
      selectedCharacterId={selectedCharacterId}
      extractingStyle={styleExtracting}
      extractingCharacters={chapterSelectionData !== null}
      addingToSoul={addingToSoul}
      tasks={tasks}
      onCancelTask={cancelTask}
      onSelectBook={(bookId) => {
        const book = libraryState.books.find((item) => item.id === bookId)
        setSelectedBookId(bookId)
        setSelectedCharacterId(null)
        if (book) useBookAnalysisStore.getState().setCurrentResult(toBookAnalysisResult(book))
      }}
      onSelectCharacter={setSelectedCharacterId}
      onImportNovel={() => setInputDialogOpen(true)}
      onExtractStyle={handleLibraryExtractStyle}
      onToggleStyle={handleLibraryToggleStyle}
      onAddSelectedSkillsToSoul={handleLibraryAddSkillsToSoul}
      onReextractCharacters={handleLibraryReextractCharacters}
      onDeleteBook={(bookId) => handleLibraryDeleteBook(bookId, selectedBookId)}
    />
  )

  if (tasks.length === 0) {
    return (
      <>
        {libraryLayout}
        {false && (
        <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center space-y-6">
          <div className="flex justify-center">
            <div className="rounded-full bg-primary/10 p-6">
              <BookOpen className="h-12 w-12 text-primary" />
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold">拆书作品</h2>
            <p className="text-muted-foreground">
              从小说中提取角色信息，生成可复用的角色 Skill，添加到自定义灵魂库
            </p>
          </div>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground space-y-2">
              <div className="flex items-start gap-2">
                <div className="rounded-full bg-primary/20 w-6 h-6 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-medium">1</span>
                </div>
                <div className="text-left">
                  <div className="font-medium text-foreground">上传小说文件</div>
                  <div>支持TXT格式，自动识别章节（可能包含500-1000章）</div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <div className="rounded-full bg-primary/20 w-6 h-6 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-medium">2</span>
                </div>
                <div className="text-left">
                  <div className="font-medium text-foreground">选择分析范围</div>
                  <div>勾选需要分析的章节，支持全选或选择特定范围</div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <div className="rounded-full bg-primary/20 w-6 h-6 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-medium">3</span>
                </div>
                <div className="text-left">
                  <div className="font-medium text-foreground">提取角色与生成Skill</div>
                  <div>全面分析角色信息，生成可复用技能，添加到自定义灵魂</div>
                </div>
              </div>
            </div>
          </div>

          <Button onClick={() => setInputDialogOpen(true)} size="lg" className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            选择小说并拆书
          </Button>

          <div className="text-xs text-muted-foreground">
            支持本地TXT文件，自动识别章节结构
          </div>
        </div>
        </div>
        )}

        <BookAnalysisInputDialog
          open={inputDialogOpen}
          onOpenChange={setInputDialogOpen}
          onSubmit={handleStartAnalysis}
        />

        {/* feature/fix-viewer-from-sidebar：欢迎页下也允许从侧边栏打开历史结果 viewer */}
        {(viewingResultPath || showResultViewer) && (
          <BookAnalysisResultViewer
            projectPath={viewingResultPath ?? currentProject?.path ?? ""}
            result={currentResult}
            onClose={() => {
              setViewingResultPath(null)
              setShowResultViewer(false)
            }}
          />
        )}
      </>
    )
  }

  // 如果有任务，显示任务列表和进度
  return (
    <div className="flex h-full flex-col">
      {libraryLayout}
      {false && (
      <div className="hidden">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">拆书作品</h2>
        <Button onClick={() => setInputDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          拆书作品
        </Button>
      </div>

      <div className="space-y-4">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="border rounded-lg p-4 space-y-3 cursor-pointer transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
            role="button"
            tabIndex={0}
            onClick={() => setViewingResultPath(task.projectPath)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                setViewingResultPath(task.projectPath)
              }
            }}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">
                  {task.metadata?.title || "未命名作品"}
                </div>
                <div className="text-sm text-muted-foreground">
                  角色提取与Skill生成
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                {task.status === "running" && "进行中"}
                {task.status === "paused" && "已暂停"}
                {task.status === "completed" && "已完成"}
                {task.status === "error" && "出错"}
              </div>
            </div>

            {task.status === "running" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{task.progress.stageLabel}</span>
                  <span className="font-medium">{task.progress.percentage}%</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${task.progress.percentage}%` }}
                  />
                </div>
                {task.progress.currentItem && (
                  <div className="text-xs text-muted-foreground">
                    {task.progress.currentItem}
                  </div>
                )}
                {/* 6 维度细粒度进度清单（feature/book-analysis-6d-skill） */}
                {task.progress.dimensions && task.progress.dimensions.length > 0 && (
                  <div className="mt-2 rounded-md border bg-muted/30 p-2 space-y-1">
                    <div className="text-xs text-muted-foreground">
                      {task.progress.currentCharacter
                        ? `角色「${task.progress.currentCharacter}」的 6 维度`
                        : "6 维度进度"}
                    </div>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                      {task.progress.dimensions.map((d: SixDimensionProgressItem) => (
                        <li
                          key={d.key}
                          className={`flex items-center gap-1.5 text-xs ${dimensionTextClass(
                            d.status,
                            d.key === task.progress.currentDimension
                          )}`}
                        >
                          <DimensionStatusIcon status={d.status} />
                          <span className="truncate">{d.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* 角色识别阶段状态（feature/character-recognition-and-simple-mode） */}
                {task.progress.recognitionStatus === "heuristic" && (
                  <p className="text-sm text-muted-foreground">正在启发式识别角色...</p>
                )}
                {task.progress.recognitionStatus === "llm_scoring" && (
                  <p className="text-sm text-muted-foreground">正在用 LLM 评分角色重要度...</p>
                )}
                {task.progress.recognitionStatus === "done" && (
                  <p className="text-sm text-muted-foreground">
                    识别出 {task.progress.recognizedCharactersCount ?? 0} 个角色
                  </p>
                )}
                {/* 停止按钮 */}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => cancelTask(task.id)}
                    className="flex-1 px-3 py-1.5 bg-destructive/10 text-destructive rounded-md hover:bg-destructive/20 transition-colors text-sm font-medium"
                  >
                    停止分析
                  </button>
                </div>
              </div>
            )}

            {task.status === "error" && task.error && (
              <div className="text-sm text-destructive">
                {task.error}
              </div>
            )}

            {task.status === "completed" && (
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm font-medium"
                  onClick={(e) => {
                    e.stopPropagation()
                    setViewingResultPath(task.projectPath)
                  }}
                >
                  查看分析结果
                </button>
                {/* feature/network-error-resume：失败角色时显示"继续生成"按钮 */}
                {(() => {
                  const failedNames = (task.metadata as any)?.failedCharacterNames as string[] | undefined
                  if (!failedNames || failedNames.length === 0) return null
                  return (
                    <button
                      onClick={() => handleResumeFailedExtraction(task.id)}
                      className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 transition-colors text-sm font-medium"
                    >
                      继续生成（{failedNames.length}）
                    </button>
                  )
                })()}
              </div>
            )}
          </div>
        ))}
      </div>

      </div>
      )}

      <BookAnalysisInputDialog
        open={inputDialogOpen}
        onOpenChange={setInputDialogOpen}
        onSubmit={handleStartAnalysis}
      />

      {(viewingResultPath || showResultViewer) && (
        <BookAnalysisResultViewer
          projectPath={viewingResultPath ?? currentProject?.path ?? ""}
          result={currentResult}
          onClose={() => {
            setViewingResultPath(null)
            setShowResultViewer(false)
          }}
        />
      )}

      {chapterSelectionData && (
        <ChapterSelectionPanel
          key={chapterSelectionData.taskId}
          chapters={chapterSelectionData.chapters}
          onConfirm={handleChapterSelectionConfirm}
          onCancel={handleChapterSelectionCancel}
          onBackground={handleChapterSelectionBackground}
          onAnalyzingChange={(analyzing) => {
            if (analyzing) {
              console.log('[book-analysis-view] 进入分析中状态')
            } else {
              console.log('[book-analysis-view] 退出分析中状态')
            }
          }}
          // 角色识别 + 角色选择
          recognitionStatus={recognitionStatus}
          recognizedCharacters={recognizedCharacters}
          selectedCharacterIds={selectedCharacterIds}
          recognitionError={recognitionError}
          onToggleCharacter={handleToggleCharacter}
          onSelectAllMain={handleSelectAllMain}
          onClearSelection={handleClearSelection}
          onDeepExtract={handleDeepExtract}
          onSimpleExtract={handleSimpleExtract}
          onCharacterPickerClose={clearRecognition}
          // 提取进度
          extractionPhase={chapterSelectionData.extractionPhase ?? null}
          extractionProgress={(() => {
            const task = tasks.find((t) => t.id === chapterSelectionData.taskId)
            if (!task) return undefined
            return {
              stageLabel: task.progress.stageLabel,
              percentage: task.progress.percentage,
              currentItem: task.progress.currentItem,
              isCompleted: task.status === "completed",
              error: task.status === "error" ? task.error : undefined,
            }
          })()}
          // 已提取角色
          onLoadExtractedCharacters={handleLoadExtractedCharacters}
          hasExtractedCharacters={hasExtractedCharacters}
        />
      )}
    </div>
  )
}
