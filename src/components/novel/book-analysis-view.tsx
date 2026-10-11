import "@/components/uitest/ui-test-tools.css"
import type { LlmRequestCacheTrace } from "@/lib/llm-request-trace"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { BookAnalysisInputDialog } from "./book-analysis-input-dialog"
import { BookAnalysisWorkbench } from "./book-analysis-workbench"
import { BookAnalysisLibraryLayout } from "./book-analysis-library-layout"
import { BookAnalysisResultViewer } from "./book-analysis-result-viewer"
import { ChapterSelectionPanel } from "./chapter-selection-panel"
import { useBookAnalysisStore } from "@/stores/book-analysis-store"
import { useBookAnalysisImportStore } from "@/stores/book-analysis-import-store"
import { useBookAnalysisPipelineStore } from "@/stores/book-analysis-pipeline-store"
import { useWikiStore } from "@/stores/wiki-store"
import { resolveDefaultModel } from "@/lib/novel/model-resolver"
import type { ChatMessage } from "@/lib/llm-client"
import { callAnalysisModelText } from "@/lib/novel/book-analysis/analysis-model-call"
import { yieldToBrowserFrame } from "@/lib/novel/yield-to-browser"
import {
  toBookAnalysisResult,
  type BookAnalysisLibraryState,
  type BookAnalysisLibraryBook,
} from "@/lib/novel/book-analysis/library-state"
import { toast } from "@/lib/toast"
import { Plus } from "lucide-react"
import type {
  AnalysisDepth,
  ExtractedCharacter,
  RecognizedCharacter,
} from "@/lib/novel/book-analysis/types"
import { useCharacterExtraction, type ChapterSelectionData } from "./hooks/use-character-extraction"
import { useCharacterRecognition } from "./hooks/use-character-recognition"
import { useLibraryOperations } from "./hooks/use-library-operations"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import {
  buildBookStoryFrameworkPrompt,
  buildPlotFrameworkDraftFromBookStoryOutput,
  loadBookStoryFrameworkChapters,
} from "@/lib/novel/book-analysis/story-framework-extraction"
import { loadPlotFrameworkLibrary, upsertPlotFramework } from "@/lib/novel/plot-framework-library"
import { bridgePlotFrameworkToStoryFramework } from "@/lib/novel/story-simulation/plot-framework-bridge"
import type { PlotFramework } from "@/lib/novel/plot-framework"
import type { BatchImportCandidate } from "@/lib/novel/book-analysis/batch-import-types"
import {
  analysisProgressKey,
  type AnalysisChapterRange,
  type AnalysisSkill,
  type StyleAnalysisDepth,
} from "@/lib/novel/book-analysis/analysis-pipeline-types"
import { loadChapterList } from "@/lib/novel/book-analysis/analysis-engine"
import { BookAnalysisRunDialog } from "./book-analysis-run-dialog"
import { BookAnalysisCharacterSkillDialog } from "./book-analysis-character-skill-dialog"
import { CharacterSelectionPanel } from "./character-selection-panel"
import { OutlineCreatorDialog } from "./outline-editor"
import { generateSkillsForCharacters } from "@/lib/novel/book-analysis/skill-generator"
import {
  recognizedCharacterToExtracted,
  selectCharacterCandidates,
} from "@/lib/novel/book-analysis/character-candidate-selection"
import { analysisTabForSkills, type BookAnalysisModuleTab } from "./book-analysis-module-view"
import { readFile, fileExists, deleteFile } from "@/commands/fs"
import { joinPath } from "@/lib/path-utils"
import { saveRecognizedCharacters } from "@/lib/novel/book-analysis/recognized-character-store"
import { deleteStoryMapHistory } from "@/lib/novel/book-analysis/story-map-history"

interface StoryFrameworkSelectionData {
  book: BookAnalysisLibraryBook
  chapters: ChapterSelectionData["chapters"]
}

export function BookAnalysisView() {
  return <BookAnalysisWorkbench />
}

export function LegacyBookAnalysisView() {
  const [inputDialogOpen, setInputDialogOpen] = useState(false)
  const [viewingResultPath, setViewingResultPath] = useState<string | null>(null)
  const [chapterSelectionData, setChapterSelectionData] = useState<ChapterSelectionData | null>(null)
  const [storyFrameworkSelectionData, setStoryFrameworkSelectionData] =
    useState<StoryFrameworkSelectionData | null>(null)
  const [storyFrameworkExtracting, setStoryFrameworkExtracting] = useState(false)
  const [storyFrameworks, setStoryFrameworks] = useState<PlotFramework[]>([])
  const [outlineCreatorFrameworkId, setOutlineCreatorFrameworkId] = useState<string | undefined>(undefined)
  const [libraryState, setLibraryState] = useState<BookAnalysisLibraryState>({
    books: [],
    enabledStyle: null,
    bindings: [],
  })
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null)
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  const [pipelineDialog, setPipelineDialog] = useState<{
    taskId: string
    chapters: Awaited<ReturnType<typeof loadChapterList>>
    initialSkills: AnalysisSkill[]
    lockedSkills?: AnalysisSkill[]
    initialRange?: AnalysisChapterRange | null
    initialModelKey?: string
    initialStyleDepth?: StyleAnalysisDepth
  } | null>(null)
  const [characterSkillDialogOpen, setCharacterSkillDialogOpen] = useState(false)
  const [characterSkillGenerating, setCharacterSkillGenerating] = useState(false)
  const [pipelineCharacterPicker, setPipelineCharacterPicker] = useState<{
    taskId: string
    selectedIds: string[]
  } | null>(null)
  const [pipelineCharacterConfirming, setPipelineCharacterConfirming] = useState(false)
  // fix/view-result-routing：任务完成「查看结果」路由到对应 Skill 页签（受控页签）
  const [moduleActiveTab, setModuleActiveTab] = useState<BookAnalysisModuleTab>("characters")
  // fix/view-result-routing：故事任务完成后递增，触发故事页签重新读取历史导图
  const [storyMapRefreshKey, setStoryMapRefreshKey] = useState(0)

  const currentProject = useWikiStore((s) => s.project)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const storeSelectedBookId = useBookAnalysisStore((s) => s.selectedLibraryBookId)
  const sidebarRefreshCounter = useBookAnalysisStore((s) => s.sidebarRefreshCounter)
  const pendingRecognitionTaskId = useBookAnalysisStore((s) => s.pendingRecognitionTaskId)
  const startTask = useBookAnalysisStore((s) => s.startTask)
  const cancelTask = useBookAnalysisStore((s) => s.cancelTask)
  const tasks = useBookAnalysisStore((s) => s.tasks)
  const currentResult = useBookAnalysisStore((s) => s.currentResult)
  const showResultViewer = useBookAnalysisStore((s) => s.showResultViewer)
  const setShowResultViewer = useBookAnalysisStore((s) => s.setShowResultViewer)
  const importBatches = useBookAnalysisImportStore((s) => s.batches)
  const importTasks = useBookAnalysisImportStore((s) => s.tasks)
  const importRevision = useBookAnalysisImportStore((s) => s.revision)
  const initializeImportProject = useBookAnalysisImportStore((s) => s.initializeProject)
  const createImportBatch = useBookAnalysisImportStore((s) => s.createBatch)
  const pipelineTasks = useBookAnalysisPipelineStore((s) => s.tasks)
  const pipelineChunks = useBookAnalysisPipelineStore((s) => s.chunks)
  const pipelineProgresses = useBookAnalysisPipelineStore((s) => s.progresses)
  const initializePipelineProject = useBookAnalysisPipelineStore((s) => s.initializeProject)
  const createAwaitingRangeTask = useBookAnalysisPipelineStore((s) => s.createAwaitingRangeTask)
  const configureTaskRange = useBookAnalysisPipelineStore((s) => s.configureTaskRange)
  const setTaskRecognizedCharacters = useBookAnalysisPipelineStore((s) => s.setTaskRecognizedCharacters)
  const failPipelineTask = useBookAnalysisPipelineStore((s) => s.failTask)
  const confirmCharacterSelection = useBookAnalysisPipelineStore((s) => s.confirmCharacterSelection)
  const setRuntimeProgress = useBookAnalysisPipelineStore((s) => s.setRuntimeProgress)
  const startPipelineTask = useBookAnalysisPipelineStore((s) => s.startTask)
  const pausePipelineTask = useBookAnalysisPipelineStore((s) => s.pauseTask)
  const continuePipelineTask = useBookAnalysisPipelineStore((s) => s.continueTask)
  const retryPipelineChunk = useBookAnalysisPipelineStore((s) => s.retryFailedChunk)
  const cancelPipelineTask = useBookAnalysisPipelineStore((s) => s.cancelTask)
  const importRevisionBaselineRef = useRef({ projectPath: currentProject?.path ?? null, revision: importRevision })
  const importInitializationSequenceRef = useRef(0)
  const importInitializationTokenRef = useRef<{ sequence: number; projectPath: string } | null>(null)
  const notifiedPipelineTaskIdsRef = useRef<Set<string>>(new Set())

  // 角色识别 LLM 配置（feature/llm-character-recognizer）
  const baseLlmConfig = useWikiStore((s) => s.llmConfig)
  const novelConfig = useWikiStore((s) => s.novelConfig)
  const aiChatModel = useWikiStore((s) => s.aiChatModel)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const llmConfig = useMemo(
    () => resolveDefaultModel(baseLlmConfig),
    [baseLlmConfig, novelConfig.defaultLlmModel, aiChatModel, providerConfigs],
  )

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

  const recordBookRequestTrace = useCallback((bookPath: string, stage: string, trace: LlmRequestCacheTrace) => {
    const state = useBookAnalysisPipelineStore.getState()
    const task = state.tasks.filter((item) => item.bookPath === bookPath).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (task) void state.recordTaskRequestTrace(task.id, { ...trace, stage })
      .catch(() => console.warn("拆书附属请求用量保存失败"))
  }, [])

  const reloadStoryFrameworks = useCallback(async () => {
    if (!currentProject?.path || !selectedLibraryBook) {
      setStoryFrameworks([])
      return
    }
    const library = await loadPlotFrameworkLibrary(currentProject.path)
    setStoryFrameworks(
      library.frameworks.filter(
        (framework) => framework.sourceDismantlingProjectId === `book-analysis:${selectedLibraryBook.id}`,
      ),
    )
  }, [currentProject?.path, selectedLibraryBook])

  // 作品库操作钩子
  const {
    addingToSoul,
    reloadLibraryState,
    handleLibraryToggleStyle,
    handleLibraryAddSkillsToSoul,
    handleLibraryDeleteBook,
    handleLibraryDeleteStyle,
    handleLibraryDeleteCharacter,
    handleLibraryReextractCharacters,
  } = useLibraryOperations({
    currentProjectPath: currentProject?.path ?? null,
    selectedLibraryBook,
    libraryState,
    setLibraryState,
    setSelectedBookId,
    setSelectedCharacterId,
    selectedCharacterId,
    setChapterSelectionData,
    llmConfig,
    providerConfigs,
    startTask,
  })

  const handleOpenCharacterSkillSelection = useCallback(() => {
    if (selectedLibraryBook) setCharacterSkillDialogOpen(true)
  }, [selectedLibraryBook])

  const handleGenerateSelectedCharacterSkills = useCallback(async (characterIds: string[]) => {
    if (!selectedLibraryBook || characterIds.length === 0) return
    // fix/generate-in-background：立即关闭弹窗，生成转入后台执行，
    // 避免多个角色逐个 LLM 生成时长长地卡在「正在生成」弹窗里。
    setCharacterSkillGenerating(true)
    setCharacterSkillDialogOpen(false)
    try {
      const extractedCandidates = selectCharacterCandidates(selectedLibraryBook.characters)
      let selected: ExtractedCharacter[]
      if ((selectedLibraryBook.recognizedCharacters?.length ?? 0) > 0) {
        // fix/recognized-in-dialog：弹窗展示的是「已识别角色」，按 id 选出；
        // 优先复用该角色的深度分析结果（数据更全），没有则用识别角色兜底。
        selected = selectedLibraryBook.recognizedCharacters
          .filter((character) => characterIds.includes(character.id))
          .map((recognized) =>
            extractedCandidates.find((candidate) => candidate.name === recognized.name)
              ?? recognizedCharacterToExtracted(recognized),
          )
        // 持久化为角色档案（characters/{id}.json），之后弹窗/角色面板直接可读
        if (selected.length > 0) {
          const { persistCharacterToDisk } = await import("@/lib/novel/book-analysis/character-disk-store")
          for (const character of selected) {
            await persistCharacterToDisk(selectedLibraryBook.path, character)
          }
        }
      } else {
        // 兼容旧数据：无识别记录时从深度分析角色推导
        selected = extractedCandidates.filter((character) => characterIds.includes(character.id))
      }
      if (selected.length === 0) {
        toast.info("没有匹配到可生成的角色。")
        return
      }
      await generateSkillsForCharacters(selected, selectedLibraryBook.metadata, selectedLibraryBook.path, llmConfig,
        undefined, undefined, (trace) => recordBookRequestTrace(selectedLibraryBook.path, "skill-generation", trace))
      await reloadLibraryState()
      toast.success(`已生成 ${selected.length} 个角色 Skill，可在角色面板中查看并加入自定义灵魂库。`)
    } catch (error) {
      toast.error(`角色 Skill 生成失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setCharacterSkillGenerating(false)
    }
  }, [llmConfig, reloadLibraryState, selectedLibraryBook, recordBookRequestTrace])

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
    providerConfigs,
  })

  // 提取钩子仍要挂载（内部有副作用）；旧的「继续生成」按钮随死代码一起删除后，
  // 返回值已无人使用，就不再解构。
  useCharacterExtraction({
    chapterSelectionData,
    setChapterSelectionData,
    recognizedCharacters,
    selectedCharacterIds,
    reloadLibraryState,
  })

  const handleSelectBook = useCallback((bookId: string) => {
    const book = libraryState.books.find((item) => item.id === bookId)
    setSelectedBookId(bookId)
    setSelectedCharacterId(null)
    clearRecognition()
    const analysisStore = useBookAnalysisStore.getState()
    analysisStore.setSelectedLibraryBookId(bookId)
    if (book) analysisStore.setCurrentResult(toBookAnalysisResult(book))
  }, [clearRecognition, libraryState.books])

  useEffect(() => {
    if (!currentProject?.path) return

    const projectPath = currentProject.path
    const initializationToken = { sequence: ++importInitializationSequenceRef.current, projectPath }
    importInitializationTokenRef.current = initializationToken
    importRevisionBaselineRef.current = { projectPath, revision: useBookAnalysisImportStore.getState().revision }
    void initializePipelineProject(projectPath).catch((error) => {
      console.error("加载拆书分析任务失败", error)
    })
    void initializeImportProject(projectPath).then(() => {
      if (importInitializationTokenRef.current !== initializationToken) return
      const importState = useBookAnalysisImportStore.getState()
      if (currentProject.path === projectPath && importState.projectPath === projectPath) {
        importRevisionBaselineRef.current = { projectPath, revision: importState.revision }
      }
    }).catch((error) => {
      if (useBookAnalysisImportStore.getState().projectPath !== projectPath) return
      console.error("加载批量导入任务失败", error)
      toast.error("加载批量导入任务失败，请稍后重试。")
    }).finally(() => {
      if (importInitializationTokenRef.current === initializationToken) importInitializationTokenRef.current = null
    })

    // 不在卸载时 dispose：调度器在后台持续运行，
    // 切换页面再返回时通过 initializeProject 的同项目早返回保持进度不丢失。
    // 项目切换时 initializeProject 内部会自动释放旧调度器。
  }, [currentProject?.path, initializeImportProject, initializePipelineProject])

  useEffect(() => {
    if (!currentProject?.path) return
    for (const importTask of importTasks) {
      if (importTask.status !== "completed") continue
      const batch = importBatches.find((item) => item.id === importTask.batchId)
      if (!batch?.analysisSkills?.length) continue
      void createAwaitingRangeTask({
        batchId: batch.id,
        bookId: importTask.bookId,
        bookPath: `${currentProject.path}/book-analysis/${importTask.bookId}`,
        selectedSkills: batch.analysisSkills,
      })
    }
  }, [createAwaitingRangeTask, currentProject?.path, importBatches, importTasks])

  useEffect(() => {
    if (!currentProject?.path) return
    for (const task of pipelineTasks) {
      if (task.status === "completed" && !notifiedPipelineTaskIdsRef.current.has(`${task.id}:completed`)) {
        notifiedPipelineTaskIdsRef.current.add(`${task.id}:completed`)
        void reloadLibraryState()
        // 故事任务完成：递增刷新键，故事页签的历史导图自动重新读取
        if (task.selectedSkills.includes("story")) {
          setStoryMapRefreshKey((key) => key + 1)
        }
        if (task.batchId) continue
        if (task.selectedSkills.includes("characters") && task.selectedSkills.length === 1) {
          toast.success("角色信息已提取完成，可选择角色生成 Skill。", {
            persistent: true,
            action: {
              label: "打开角色信息",
              onClick: () => {
                // fix/view-result-routing：定位到任务所属作品后再打开弹窗
                if (libraryState.books.some((book) => book.id === task.bookId)) {
                  handleSelectBook(task.bookId)
                } else {
                  setSelectedBookId(task.bookId)
                }
                setCharacterSkillDialogOpen(true)
              },
            },
          })
        } else {
          // fix/view-result-routing：按任务技能路由到对应 Skill 页签，
          // 直接展示角色/故事/文风的生成结果（旧版查看器不再使用）
          const tab = analysisTabForSkills(task.selectedSkills)
          toast.success("拆书任务已完成，结果已更新。", {
            persistent: true,
            action: {
              label: "查看结果",
              onClick: () => {
                if (libraryState.books.some((book) => book.id === task.bookId)) {
                  handleSelectBook(task.bookId)
                } else {
                  setSelectedBookId(task.bookId)
                }
                setModuleActiveTab(tab)
              },
            },
          })
        }
      } else if (task.status === "failed" && !notifiedPipelineTaskIdsRef.current.has(`${task.id}:failed`)) {
        notifiedPipelineTaskIdsRef.current.add(`${task.id}:failed`)
        void reloadLibraryState()
        if (!task.batchId) {
          toast.error(`分析失败：${task.error || "未知错误"}`)
        }
      }
    }
  }, [currentProject?.path, pipelineTasks, reloadLibraryState, handleOpenCharacterSkillSelection, handleSelectBook, libraryState.books])

  useEffect(() => {
    const projectPath = currentProject?.path ?? null
    const baseline = importRevisionBaselineRef.current
    if (!projectPath || baseline.projectPath !== projectPath || importInitializationTokenRef.current?.projectPath === projectPath) {
      importRevisionBaselineRef.current = { projectPath, revision: importRevision }
      return
    }
    if (importRevision <= baseline.revision) {
      importRevisionBaselineRef.current = { projectPath, revision: importRevision }
      return
    }
    importRevisionBaselineRef.current = { projectPath, revision: importRevision }
    useBookAnalysisStore.getState().triggerSidebarRefresh()
  }, [currentProject?.path, importRevision])

  useEffect(() => {
    void reloadLibraryState()
  }, [currentProject?.path, tasks.length, sidebarRefreshCounter, reloadLibraryState])

  useEffect(() => {
    void reloadStoryFrameworks()
  }, [reloadStoryFrameworks, sidebarRefreshCounter])

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

  // 监听"现在处理"请求：从 task 重建章节选择面板（feature/fix-recognition-reopen）
  // 触发点：toast「现在处理」按钮 / 侧边栏「现在处理」按钮，均调用 requestReopenChapterSelection
  useEffect(() => {
    if (!pendingRecognitionTaskId) return
    // 面板已打开则不重复打开
    if (chapterSelectionData) {
      useBookAnalysisStore.getState().consumeReopenRequest()
      return
    }
    const task = tasks.find((t) => t.id === pendingRecognitionTaskId)
    useBookAnalysisStore.getState().consumeReopenRequest()
    if (!task || !task.bookPath || !task.metadata || !task.chapters || task.chapters.length === 0) {
      console.warn("[现在处理] 任务数据不完整，无法恢复面板", task?.id)
      return
    }
    setChapterSelectionData({
      taskId: task.id,
      bookPath: task.bookPath,
      chapters: task.chapters,
      metadata: task.metadata,
      abortController: task.abortController ?? new AbortController(),
      selectedChapterIds: [],
      depth: "standard" as AnalysisDepth,
    })
  }, [pendingRecognitionTaskId, tasks, chapterSelectionData, setChapterSelectionData])

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
        .map((c) => c.id)
    )
    setRecognitionStatus("done")
    toast.info(`已加载 ${existingCharacters.length} 个已提取的角色，可直接选择进行提取`)
  }

  const handleOpenStoryFrameworkSelection = async () => {
    if (!selectedLibraryBook) return
    try {
      const chapters = await loadBookStoryFrameworkChapters(selectedLibraryBook.path)
      if (chapters.length === 0) {
        toast.error("未找到章节文件，无法提取故事框架。")
        return
      }
      setStoryFrameworkSelectionData({
        book: selectedLibraryBook,
        chapters: chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          order: chapter.order,
          wordCount: chapter.content.length,
          path: "",
        })),
      })
    } catch (err) {
      toast.error(`读取章节失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleStoryFrameworkConfirm = async (selectedChapterIds: string[]) => {
    if (!currentProject?.path || !storyFrameworkSelectionData || storyFrameworkExtracting) return
    if (!hasUsableLlm(llmConfig, providerConfigs)) {
      toast.error("未配置可用模型，请先在设置中配置 LLM。")
      return
    }

    const { book } = storyFrameworkSelectionData
    setStoryFrameworkExtracting(true)
    setStoryFrameworkSelectionData(null)
    toast.info("正在提取故事框架，请稍候。")
    try {
      const chapters = await loadBookStoryFrameworkChapters(book.path, selectedChapterIds)
      const prompt = buildBookStoryFrameworkPrompt({
        bookTitle: book.metadata.title,
        chapters,
      })
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: "你是严谨的小说故事框架拆解助手，必须输出可复用的中文四段框架。",
        },
        { role: "user", content: prompt },
      ]
      // 思考-only 的流在 HTTP 层是成功的，这里原先没有任何重试，
      // 用户只会拿到一条 17K 字符的思考诊断 toast。交给共享实现重试一次。
      const output = await callAnalysisModelText(llmConfig, messages, {
        cancelMessage: "用户取消故事框架提取",
      })
      const now = Date.now()
      const framework = buildPlotFrameworkDraftFromBookStoryOutput({
        bookId: book.id,
        bookTitle: book.metadata.title,
        markdown: output,
        rangeChapterIds: selectedChapterIds,
        createdAt: now,
      })
      if (!framework) {
        toast.error("故事框架提取失败：AI 输出缺少钩子/铺垫/爽点/结尾钩子。")
        return
      }
      const saved = await upsertPlotFramework(currentProject.path, framework)
      /*
       * 这是第三个发布方（workbench 版本确认、story-analysis-adapter 之外的那个「旧框架入口」）。
       * 只写跨作品库的话，从这里提取的故事框架同样进不了 storyFrameworkBinding —— 也就是没打通。
       * 桥接 id 由 framework.id 派生，而这个 id 本身带 createdAt，所以每次提取各自一份，
       * 与跨作品库里「每次提取新增一条」的行为一致。
       */
      await bridgePlotFrameworkToStoryFramework(currentProject.path, saved)
      await reloadStoryFrameworks()
      useBookAnalysisStore.getState().triggerSidebarRefresh()
      toast.success("故事框架已提取并入库。")
    } catch (err) {
      toast.error(`故事框架提取失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setStoryFrameworkExtracting(false)
    }
  }

  const handleStartAnalysis = useCallback(async function handleStartAnalysis(files: BatchImportCandidate[], analysisSkills?: AnalysisSkill[]) {
    await createImportBatch(files, analysisSkills)
    setInputDialogOpen(false)
  }, [createImportBatch])

  const selectedPipelineTask = pipelineTasks
    .filter((task) => task.bookId === selectedLibraryBook?.id)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null

  // 同书所有分析任务（含并行运行的多个）；默认聚焦最新任务，其余在「并行分析任务」区各自显示进度
  const bookAnalysisTasks = pipelineTasks.filter((task) => task.bookId === selectedLibraryBook?.id)

  const openPipelineDialog = useCallback(async (skill: AnalysisSkill) => {
    if (!selectedLibraryBook) return
    const existingModule = selectedLibraryBook.analysisManifest?.modules[skill]
    const created = await createAwaitingRangeTask({
      bookId: selectedLibraryBook.id,
      bookPath: selectedLibraryBook.path,
      selectedSkills: [skill],
      forceNew: true,
      forceRefresh: true,
    })
    if (!created) return
    setPipelineDialog({
      taskId: created.id,
      chapters: await loadChapterList(selectedLibraryBook.path),
      initialSkills: [skill],
      lockedSkills: [skill],
      initialRange: existingModule?.range ?? null,
      // 沿用上一次该书用过的模型与深度，省得每次重选
      initialModelKey: selectedPipelineTask?.modelKey ?? "",
      initialStyleDepth: selectedPipelineTask?.styleDepth,
    })
  }, [createAwaitingRangeTask, selectedLibraryBook, selectedPipelineTask])

  const openExistingPipelineDialog = useCallback(async () => {
    if (!selectedLibraryBook || !selectedPipelineTask) return
    setPipelineDialog({
      taskId: selectedPipelineTask.id,
      chapters: await loadChapterList(selectedLibraryBook.path),
      initialSkills: selectedPipelineTask.selectedSkills,
      initialRange: selectedPipelineTask.range,
      initialModelKey: selectedPipelineTask.modelKey ?? "",
      initialStyleDepth: selectedPipelineTask.styleDepth,
    })
  }, [selectedLibraryBook, selectedPipelineTask])

  const openPipelineCharacterPicker = useCallback((taskId: string, characters: RecognizedCharacter[]) => {
    const defaultIds = characters
      .filter((character) => character.category === "主角" || character.category === "配角")
      .map((character) => character.id)
    setPipelineCharacterPicker({
      taskId,
      selectedIds: defaultIds.length > 0 ? defaultIds : characters.map((character) => character.id),
    })
  }, [])

  const startPipelineWithErrorToast = useCallback((taskId: string) => {
    void startPipelineTask(taskId).catch((error) => {
      toast.error(`分析失败：${error instanceof Error ? error.message : String(error)}`)
    })
  }, [startPipelineTask])

  const recognizeCharactersForPipelineTask = useCallback(async (
    taskId: string,
    bookPath: string,
    range: AnalysisChapterRange,
    chapters: Awaited<ReturnType<typeof loadChapterList>>,
  ) => {
    const progressKey = analysisProgressKey(taskId, "characters", "recognition")
    const reportRecognition = (progress: { stageLabel: string; percentage: number; currentItem?: string }) => {
      setRuntimeProgress(progressKey, progress)
    }
    toast.info("正在识别角色，完成后请勾选要深度分析的角色…")
    reportRecognition({ stageLabel: "准备识别角色", percentage: 2 })
    try {
      if (!hasUsableLlm(llmConfig, providerConfigs)) {
        throw new Error("未配置可用的模型，请先在设置中配置 LLM，再识别角色")
      }
      const selectedChapters = chapters
        .filter((chapter) => chapter.order >= range.startOrder && chapter.order <= range.endOrder)
        .sort((left, right) => left.order - right.order)
      if (selectedChapters.length === 0) {
        throw new Error("所选章节范围内没有可用章节")
      }
      const totalChapters = selectedChapters.length
      const chapterContents: { index: number; content: string }[] = []
      reportRecognition({
        stageLabel: `读取章节中（0/${totalChapters}）`,
        percentage: 5,
        currentItem: `第 ${range.startOrder}～${range.endOrder} 章，共 ${totalChapters} 章`,
      })
      // 让出一帧，避免读章过快时 UI 直接跳到 AI 阶段、看不到 x/y。
      // 窗口隐藏时 rAF 不会触发，yieldToBrowserFrame 会直接放行。
      await yieldToBrowserFrame()
      for (let i = 0; i < totalChapters; i++) {
        const chapter = selectedChapters[i]
        const chapterPath = joinPath(bookPath, "chapters", `${chapter.chapterId}.md`)
        const raw = await readFile(chapterPath)
        const body = raw.replace(/^---[\s\S]*?---\n/, "")
        chapterContents.push({ index: i, content: body.slice(0, 4000) })
        const readCount = i + 1
        reportRecognition({
          stageLabel: `读取章节中（${readCount}/${totalChapters}）`,
          percentage: 5 + Math.floor((readCount / totalChapters) * 40),
          currentItem: `第 ${chapter.order} 章 · ${chapter.title}`,
        })
        await yieldToBrowserFrame()
      }
      reportRecognition({
        stageLabel: `正在用 AI 识别角色（已读 ${totalChapters}/${totalChapters} 章）`,
        percentage: 55,
        currentItem: `第 ${range.startOrder}～${range.endOrder} 章，共 ${totalChapters} 章`,
      })
      const { llmRecognizeCharacters } = await import(
        "@/lib/novel/book-analysis/character-llm-recognizer"
      )
      const recognized = await llmRecognizeCharacters({
        chapters: chapterContents,
        llmConfig,
        sourceBook: bookPath, bookPath,
        forceRefresh: useBookAnalysisPipelineStore.getState().tasks.find((task) => task.id === taskId)?.forceRefresh,
        onRequestTrace: (trace) => {
          void useBookAnalysisPipelineStore.getState().recordTaskRequestTrace(taskId, { ...trace, stage: "recognition" })
            .catch(() => console.warn("角色识别用量保存失败"))
        },
      })
      if (recognized.length === 0) {
        throw new Error("AI 没有识别出角色，请确认所选章节包含人物，或更换模型后重试")
      }
      reportRecognition({
        stageLabel: `保存识别结果（已读 ${totalChapters}/${totalChapters} 章）`,
        percentage: 90,
        currentItem: `${recognized.length} 个角色`,
      })
      await saveRecognizedCharacters(bookPath, recognized)
      await setTaskRecognizedCharacters(taskId, recognized)
      reportRecognition({
        stageLabel: `识别出 ${recognized.length} 个角色（已读 ${totalChapters}/${totalChapters} 章）`,
        percentage: 100,
      })
      openPipelineCharacterPicker(taskId, recognized)
      toast.success(`识别完成：共 ${recognized.length} 个角色，请选择后开始深度分析`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      notifiedPipelineTaskIdsRef.current.add(`${taskId}:failed`)
      await failPipelineTask(taskId, message).catch(() => undefined)
      toast.error(`角色识别失败：${message}`)
    } finally {
      setRuntimeProgress(progressKey, null)
    }
  }, [failPipelineTask, llmConfig, openPipelineCharacterPicker, providerConfigs, setRuntimeProgress, setTaskRecognizedCharacters])

  const handleDeleteStoryMap = useCallback(async (id: string) => {
    if (!currentProject?.path || !selectedLibraryBook) return
    try {
      if (id === "legacy") {
        // 旧格式：仅根目录 story-map.{json,html}，直接删除这两份引用文件
        for (const name of ["story-map.json", "story-map.html"]) {
          const target = joinPath(selectedLibraryBook.path, name)
          if (await fileExists(target)) await deleteFile(target)
        }
      } else {
        await deleteStoryMapHistory(selectedLibraryBook.path, id)
      }
      useBookAnalysisStore.getState().triggerSidebarRefresh()
      toast.success("已删除该故事导图。")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("[删除故事导图失败]", msg)
      toast.error(`删除故事导图失败：${msg}`)
    }
  }, [currentProject?.path, selectedLibraryBook])

  const libraryContent = (
    <>
    <BookAnalysisLibraryLayout
      state={libraryState}
      selectedBookId={selectedLibraryBook?.id ?? selectedBookId}
      selectedCharacterId={selectedCharacterId}
      extractingStyle={
        selectedPipelineTask?.status === "running" && selectedPipelineTask.currentSkill === "style"
      }
      extractingCharacters={chapterSelectionData !== null}
      extractingStoryFramework={storyFrameworkExtracting}
      addingToSoul={addingToSoul}
      storyFrameworks={storyFrameworks}
      analysisTask={selectedPipelineTask}
      analysisChunks={pipelineChunks}
      analysisProgresses={pipelineProgresses}
      analysisTasks={bookAnalysisTasks}
      analysisActiveTab={moduleActiveTab}
      onAnalysisActiveTabChange={setModuleActiveTab}
      storyMapRefreshKey={storyMapRefreshKey}
      onDeleteCharacter={handleLibraryDeleteCharacter}
      onDeleteStyle={handleLibraryDeleteStyle}
      onDeleteStoryMap={handleDeleteStoryMap}
      onParallelPauseTask={(taskId) => {
        void pausePipelineTask(taskId).catch((error) => {
          toast.error(`暂停失败：${error instanceof Error ? error.message : String(error)}`)
        })
      }}
      onParallelContinueTask={(taskId) => {
        void continuePipelineTask(taskId).catch((error) => {
          toast.error(`继续失败：${error instanceof Error ? error.message : String(error)}`)
        })
      }}
      onParallelCancelTask={(taskId) => {
        void cancelPipelineTask(taskId).catch((error) => {
          toast.error(`取消失败：${error instanceof Error ? error.message : String(error)}`)
        })
      }}
      onSelectBook={handleSelectBook}
      onSelectCharacter={setSelectedCharacterId}
      onImportNovel={() => setInputDialogOpen(true)}
      onExtractStyle={() => void openPipelineDialog("style")}
      onExtractStoryFramework={handleOpenStoryFrameworkSelection}
      onCreateOutlineFromFramework={(frameworkId) => setOutlineCreatorFrameworkId(frameworkId)}
      onOpenStoryMap={(bookPath) => {
        setSelectedFile(null)
        setActiveView("wiki")
        setSelectedFile(`${bookPath}/story-map.html`)
      }}
      onToggleStyle={handleLibraryToggleStyle}
      onAddSelectedSkillsToSoul={handleLibraryAddSkillsToSoul}
      onOpenSkillSelection={handleOpenCharacterSkillSelection}
      onReextractCharacters={handleLibraryReextractCharacters}
      onReextractSkill={openPipelineDialog}
      onConfigureAnalysisTask={openExistingPipelineDialog}
      onSelectAnalysisCharacters={
        selectedPipelineTask?.status === "awaiting-character-selection"
          && (selectedPipelineTask.recognizedCharacters?.length ?? 0) > 0
          ? () => openPipelineCharacterPicker(
              selectedPipelineTask.id,
              selectedPipelineTask.recognizedCharacters ?? [],
            )
          : undefined
      }
      onParallelRetryTask={selectedPipelineTask ? (taskId) => {
        const target = bookAnalysisTasks.find((t) => t.id === taskId) ?? selectedPipelineTask
        const skill = target.currentSkill
        const failedChunkId = skill ? target.modules[skill].failedChunkId : null
        const retry = skill && failedChunkId
          ? retryPipelineChunk(target.id, skill, failedChunkId)
          : continuePipelineTask(target.id)
        void retry.catch((error) => toast.error(`重试失败：${error instanceof Error ? error.message : String(error)}`))
      } : undefined}
      onRetryAnalysisChunk={selectedPipelineTask ? (skill, chunkId) => {
        void retryPipelineChunk(selectedPipelineTask.id, skill, chunkId).catch((error) => {
          toast.error(`重试区块失败：${error instanceof Error ? error.message : String(error)}`)
        })
      } : undefined}
      onDeleteBook={(bookId) => handleLibraryDeleteBook(bookId, selectedBookId)}
      hideBookHeader
    />
    {pipelineDialog && (
      <BookAnalysisRunDialog
        open
        chapters={pipelineDialog.chapters}
        initialSkills={pipelineDialog.initialSkills}
        lockedSkills={pipelineDialog.lockedSkills}
        initialRange={pipelineDialog.initialRange}
        initialModelKey={pipelineDialog.initialModelKey}
        initialStyleDepth={pipelineDialog.initialStyleDepth}
        onOpenChange={(open) => !open && setPipelineDialog(null)}
        onSubmit={async ({ range, selectedSkills, modelKey, styleDepth }) => {
          const taskId = pipelineDialog.taskId
          const chapters = pipelineDialog.chapters
          const bookPath = useBookAnalysisPipelineStore.getState().tasks.find((t) => t.id === taskId)?.bookPath
          await configureTaskRange(taskId, range, selectedSkills, { modelKey, styleDepth })
          setPipelineDialog(null)
          if (selectedSkills.includes("characters")) {
            if (!bookPath) {
              toast.error("未找到分析任务作品路径")
              return
            }
            await recognizeCharactersForPipelineTask(taskId, bookPath, range, chapters)
            return
          }
          startPipelineWithErrorToast(taskId)
        }}
      />
    )}
    {selectedLibraryBook && (
      <BookAnalysisCharacterSkillDialog
        book={selectedLibraryBook}
        open={characterSkillDialogOpen}
        generating={characterSkillGenerating}
        onOpenChange={setCharacterSkillDialogOpen}
        onSubmit={handleGenerateSelectedCharacterSkills}
      />
    )}
    {(() => {
      const pickerTask = pipelineCharacterPicker
        ? pipelineTasks.find((task) => task.id === pipelineCharacterPicker.taskId)
        : null
      const pickerCharacters = pickerTask?.recognizedCharacters ?? []
      if (!pipelineCharacterPicker || pickerCharacters.length === 0) return null
      return (
        <CharacterSelectionPanel
          characters={pickerCharacters}
          selectedIds={pipelineCharacterPicker.selectedIds}
          onToggle={(id) => {
            setPipelineCharacterPicker((current) => {
              if (!current) return current
              const selected = current.selectedIds.includes(id)
                ? current.selectedIds.filter((item) => item !== id)
                : [...current.selectedIds, id]
              return { ...current, selectedIds: selected }
            })
          }}
          onSelectAllMain={() => {
            setPipelineCharacterPicker((current) => {
              if (!current) return current
              return {
                ...current,
                selectedIds: pickerCharacters
                  .filter((character) => character.category === "主角" || character.category === "配角")
                  .map((character) => character.id),
              }
            })
          }}
          onClear={() => {
            setPipelineCharacterPicker((current) => current ? { ...current, selectedIds: [] } : current)
          }}
          onCancel={() => setPipelineCharacterPicker(null)}
          onClose={() => setPipelineCharacterPicker(null)}
          confirming={pipelineCharacterConfirming}
          onConfirm={() => {
            const taskId = pipelineCharacterPicker.taskId
            const selectedIds = pipelineCharacterPicker.selectedIds
            setPipelineCharacterConfirming(true)
            void confirmCharacterSelection(taskId, selectedIds)
              .then(() => {
                setPipelineCharacterPicker(null)
                startPipelineWithErrorToast(taskId)
              })
              .catch((error) => {
                toast.error(`启动深度分析失败：${error instanceof Error ? error.message : String(error)}`)
              })
              .finally(() => {
                setPipelineCharacterConfirming(false)
              })
          }}
        />
      )
    })()}
    </>
  )

  const libraryLayout = (
    <section data-ui-page="analysis" data-ui-state={selectedPipelineTask?.status ?? (selectedLibraryBook ? "book" : "empty")}>
      <header data-ui="tool-heading">
        <div>
          <nav aria-label="面包屑" className="ui-test-breadcrumb"><span>拆书库</span><span aria-hidden="true">/</span><span aria-current="page">{selectedLibraryBook?.metadata.title ?? "作品"}</span></nav>
          <h1 className="ui-test-page-title">读懂一个故事的构成。</h1>
        </div>
        <Button size="sm" onClick={() => setInputDialogOpen(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />导入作品</Button>
      </header>
      <div data-ui="analysis-content">{libraryContent}</div>
    </section>
  )

  if (tasks.length === 0) {
    return (
      <>
        {libraryLayout}
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

        {storyFrameworkSelectionData && (
          <ChapterSelectionPanel
            key={`story-framework-${storyFrameworkSelectionData.book.id}`}
            chapters={storyFrameworkSelectionData.chapters}
            onConfirm={handleStoryFrameworkConfirm}
            onCancel={() => setStoryFrameworkSelectionData(null)}
          />
        )}

        <OutlineCreatorDialog
          open={Boolean(outlineCreatorFrameworkId)}
          onOpenChange={(open) => {
            if (!open) setOutlineCreatorFrameworkId(undefined)
          }}
          frameworkId={outlineCreatorFrameworkId}
        />
      </>
    )
  }

  // 如果有任务，显示任务列表和进度
  return (
    <div className="flex h-full flex-col">
      {libraryLayout}
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

      {storyFrameworkSelectionData && (
        <ChapterSelectionPanel
          key={`story-framework-${storyFrameworkSelectionData.book.id}`}
          chapters={storyFrameworkSelectionData.chapters}
          onConfirm={handleStoryFrameworkConfirm}
          onCancel={() => setStoryFrameworkSelectionData(null)}
        />
      )}

      <OutlineCreatorDialog
        open={Boolean(outlineCreatorFrameworkId)}
        onOpenChange={(open) => {
          if (!open) setOutlineCreatorFrameworkId(undefined)
        }}
        frameworkId={outlineCreatorFrameworkId}
      />
    </div>
  )
}
