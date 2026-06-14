import { useState } from "react"
import { Button } from "@/components/ui/button"
import { BookAnalysisInputDialog } from "./book-analysis-input-dialog"
import { BookAnalysisResultViewer } from "./book-analysis-result-viewer"
import { ChapterSelectionPanel } from "./chapter-selection-panel"
import { useBookAnalysisStore } from "@/stores/book-analysis-store"
import { useWikiStore } from "@/stores/wiki-store"
import { BookOpen, Check, Loader2, Plus, X } from "lucide-react"
import type {
  AnalysisDepth,
  SixDimensionProgressItem,
  SixDimensionStatus,
} from "@/lib/novel/book-analysis/types"

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
  const [chapterSelectionData, setChapterSelectionData] = useState<{
    taskId: string
    bookPath: string
    chapters: Array<{
      id: string
      title: string
      order: number
      wordCount: number
      path: string
    }>
    metadata: any
    abortController: AbortController
  } | null>(null)
  const currentProject = useWikiStore((s) => s.project)
  const startTask = useBookAnalysisStore((s) => s.startTask)
  const cancelTask = useBookAnalysisStore((s) => s.cancelTask)
  const tasks = useBookAnalysisStore((s) => s.tasks)
  const currentResult = useBookAnalysisStore((s) => s.currentResult)
  const showResultViewer = useBookAnalysisStore((s) => s.showResultViewer)
  const setShowResultViewer = useBookAnalysisStore((s) => s.setShowResultViewer)

  const handleStartAnalysis = async (config: {
    sourceType: "file"
    sourcePath: string
  }) => {
    if (!currentProject?.path) {
      console.error("没有打开的项目")
      return
    }

    // 创建 AbortController
    const abortController = new AbortController()

    // 启动分析任务
    const taskId = startTask(currentProject.path, {
      sourceType: config.sourceType,
      sourcePath: config.sourcePath,
      selectedChapters: [], // 初始为空，稍后用户选择章节
    }, abortController)

    setInputDialogOpen(false)

    // 启动后台分析
    try {
      const { splitNovelIntoChapters } = await import("@/lib/novel/book-analysis/analysis-engine")
      const { useWikiStore } = await import("@/stores/wiki-store")
      const llmConfig = useWikiStore.getState().llmConfig
      const updateTaskProgress = useBookAnalysisStore.getState().updateTaskProgress
      const updateTaskMetadata = useBookAnalysisStore.getState().updateTaskMetadata

      // 第一步：拆分章节
      const splitResult = await splitNovelIntoChapters(
        config.sourcePath,
        currentProject.path,
        llmConfig,
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

        // 显示章节选择界面
        setChapterSelectionData({
          taskId,
          bookPath: splitResult.bookPath,
          chapters: splitResult.chapters,
          metadata: splitResult.metadata,
          abortController,
        })
      }
    } catch (error) {
      const errorTaskFn = useBookAnalysisStore.getState().errorTask
      const errorMessage = error instanceof Error ? error.message : "分析失败"
      // 如果是用户取消，不重复设置错误（cancelTask已处理）
      if (!errorMessage.includes("取消") && !errorMessage.includes("已停止")) {
        errorTaskFn(taskId, errorMessage)
      }
    }
  }

  const handleChapterSelectionConfirm = async (selectedChapterIds: string[], depth: AnalysisDepth) => {
    if (!chapterSelectionData) return

    const { taskId, bookPath, metadata, abortController } = chapterSelectionData
    setChapterSelectionData(null) // 关闭选择界面

    // 继续分析流程
    try {
      const { useWikiStore } = await import("@/stores/wiki-store")
      const llmConfig = useWikiStore.getState().llmConfig
      const updateTaskProgress = useBookAnalysisStore.getState().updateTaskProgress
      const updateTaskCharacters = useBookAnalysisStore.getState().updateTaskCharacters
      const updateTaskSkills = useBookAnalysisStore.getState().updateTaskSkills
      const completeTask = useBookAnalysisStore.getState().completeTask

      // 第二步：提取角色（含 6 维度分析）
      const { extractCharactersFromChapters } = await import("@/lib/novel/book-analysis/character-extraction-engine")

      const extractionResult = await extractCharactersFromChapters({
        bookPath,
        selectedChapterIds,
        llmConfig,
        depth,
        bookTitle: metadata.title,
        bookAuthor: metadata.author,
        onProgress: (progress) => {
          updateTaskProgress(taskId, {
            stage: progress.stage as any,
            stageLabel: progress.stageLabel,
            completed: progress.completed,
            total: progress.total,
            percentage: progress.percentage,
            currentItem: progress.currentItem,
            currentCharacter: (progress as any).currentCharacter,
            currentDimension: (progress as any).currentDimension,
            dimensions: (progress as any).dimensions,
          })
        },
        signal: abortController.signal,
      })

      if (extractionResult.success) {
        updateTaskCharacters(taskId, extractionResult.characters)

        // 第三步：生成 Skills
        const { generateSkillsForCharacters } = await import("@/lib/novel/book-analysis/skill-generator")

        const skills = await generateSkillsForCharacters(
          extractionResult.characters,
          metadata,
          bookPath,
          llmConfig,
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

        updateTaskSkills(taskId, skills)
        completeTask(taskId)
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

  // 如果没有任务，显示欢迎页
  if (tasks.length === 0) {
    return (
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

        <BookAnalysisInputDialog
          open={inputDialogOpen}
          onOpenChange={setInputDialogOpen}
          onSubmit={handleStartAnalysis}
        />
      </div>
    )
  }

  // 如果有任务，显示任务列表和进度
  return (
    <div className="flex h-full flex-col p-6">
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
            className="border rounded-lg p-4 space-y-3"
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
                  onClick={() => setViewingResultPath(task.projectPath)}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm font-medium"
                >
                  查看分析结果
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

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
          chapters={chapterSelectionData.chapters}
          onConfirm={handleChapterSelectionConfirm}
          onCancel={handleChapterSelectionCancel}
        />
      )}
    </div>
  )
}
