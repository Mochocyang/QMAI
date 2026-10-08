import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { UiTestDirectoryHeader } from "@/components/uitest/ui-test-directory"
import { UiTestOutlineTools } from "@/components/uitest/ui-test-outline-tools"
import {
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react"
import { KnowledgeTree, type KnowledgeCreateRequest } from "./knowledge-tree"
import { TrashPanel } from "./trash-panel"
import { GraphSidebarPanel } from "./graph-sidebar-panel"
import { ReviewCenterSidebarPanel } from "./review-center-sidebar-panel"
import { FrameworkList } from "@/components/novel/story-simulation/framework-list"
import { useListFileDrop } from "@/components/novel/use-list-file-drop"

import { useWikiStore } from "@/stores/wiki-store"
import { useChatStore } from "@/stores/chat-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import { useStorySimulationStore } from "@/stores/story-simulation-store"
import { loadFrameworks, loadSimulationResults, deleteSimulationResult } from "@/lib/novel/story-simulation/framework-store"
import { loadBinding } from "@/lib/novel/story-simulation/framework-binding"
import type { StoryFramework } from "@/lib/novel/story-simulation/types"
import { createDirectory, fileExists, listDirectory, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { flattenMdFiles, getNextChapterNumber } from "@/lib/novel/chapter-utils"
import { Button } from "@/components/ui/button"
import { PanelHeaderWithHelp } from "@/components/layout/panel-header-with-help"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  OUTLINE_IMPORT_EXTENSIONS,
  collectOutlineImportCandidatesFromFolder,
  importOutlineCandidates,
  importOutlineFiles,
} from "@/lib/novel/outline-import"
import {
  CHAPTER_IMPORT_EXTENSIONS,
  collectChapterImportCandidatesFromFolder,
  importChapterFiles,
  runImportedChapterMemoryExtraction,
  type ImportedChapter,
} from "@/lib/novel/chapter-import"
import { makeChapterFileName, makeDefaultChapterTitle, makeSafeFileSlug } from "@/lib/wiki-filename"
import { buildPureOutlineMarkdown } from "@/lib/novel/outline-markdown"
import { useImportProgressStore } from "@/stores/import-progress-store"
import { openExternalUrl } from "@/lib/open-external-url"
import type { ReferenceToken } from "@/lib/reference/types"
const BookAnalysisSidebarPanel = lazy(async () => {
  const mod = await import("./book-analysis-sidebar-panel")
  return { default: mod.BookAnalysisSidebarPanel }
})

const USAGE_GUIDE_URL = "https://tcnk9ik08e1c.feishu.cn/wiki/FWiSwYQKoifpwBk6mSRcSlB8nrh?from=from_copylink"

function SearchHistoryPanel() {
  const { t } = useTranslation()
  const searchHistory = useWikiStore((s) => s.searchHistory)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSearchTrigger = useWikiStore((s) => s.setSearchTrigger)

  return (
    <div className="flex h-full flex-col">
      <div data-ui-panel-heading className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="text-sm font-semibold text-foreground">
          {t("novel.nav.search")}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {searchHistory.length === 0 ? (
          <div className="px-2 py-4 text-xs text-muted-foreground">暂无历史搜索</div>
        ) : (
          <div className="space-y-1">
            {searchHistory.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setActiveView("search")
                  setSearchTrigger({ query: item, ts: Date.now() })
                }}
                className="w-full rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
              >
                <span className="line-clamp-2 break-all">{item}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SidebarPanelLoading() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      <span>{t("common.loading", { defaultValue: "加载中..." })}</span>
    </div>
  )
}

/** 剧情推演室侧边栏：头部标题+新建按钮 + 框架列表 */
function StorySimulationSidebarPanel() {
  const projectPath = useWikiStore((s) => s.project?.path)
  const setFrameworks = useStorySimulationStore((s) => s.setFrameworks)
  const setBinding = useStorySimulationStore((s) => s.setBinding)
  const setCurrentFramework = useStorySimulationStore((s) => s.setCurrentFramework)
  const setCurrentReport = useStorySimulationStore((s) => s.setCurrentReport)
  const setCurrentDraft = useStorySimulationStore((s) => s.setCurrentDraft)
  const setTimelineEvents = useStorySimulationStore((s) => s.setTimelineEvents)
  const setPhase = useStorySimulationStore((s) => s.setPhase)
  const setSavedResults = useStorySimulationStore((s) => s.setSavedResults)
  const setSelectedResultId = useStorySimulationStore((s) => s.setSelectedResultId)
  const currentFramework = useStorySimulationStore((s) => s.currentFramework)
  const savedResults = useStorySimulationStore((s) => s.savedResults)
  const selectedResultId = useStorySimulationStore((s) => s.selectedResultId)
  const reset = useStorySimulationStore((s) => s.reset)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // 加载指定框架的历史推演结果
  const loadResultsForFramework = useCallback(async (frameworkId: string) => {
    if (!projectPath) return
    try {
      const results = await loadSimulationResults(projectPath, frameworkId)
      setSavedResults(results.map(r => ({
        id: r.id,
        frameworkId,
        report: r.report,
        draft: r.draft,
        timelineEvents: r.timelineEvents,
        agentSnapshot: r.agentSnapshot,
        createdAt: r.report.createdAt,
      })))
    } catch {
      setSavedResults([])
    }
  }, [projectPath, setSavedResults])

  // 进入视图时加载框架列表和绑定
  useEffect(() => {
    if (!projectPath) return
    let cancelled = false
    void (async () => {
      try {
        const [list, currentBinding] = await Promise.all([
          loadFrameworks(projectPath),
          loadBinding(projectPath),
        ])
        if (cancelled) return
        setFrameworks(list)
        setBinding(currentBinding)
      } catch {
        // 忽略加载错误
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectPath, setFrameworks, setBinding])

  // 当currentFramework变化时，加载其历史结果
  useEffect(() => {
    if (currentFramework) {
      void loadResultsForFramework(currentFramework.id)
    } else {
      setSavedResults([])
    }
  }, [currentFramework, loadResultsForFramework, setSavedResults])

  const handleSelectFramework = (framework: StoryFramework) => {
    setCurrentFramework(framework)
    setCurrentReport(null)
    setCurrentDraft(null)
    setTimelineEvents([])
    setSelectedResultId(null)
    setPhase("framework-confirming")
  }

  const handleSelectResult = (resultId: string) => {
    const result = savedResults.find(r => r.id === resultId)
    if (result) {
      setCurrentReport(result.report)
      setCurrentDraft(result.draft || null)
      setTimelineEvents(result.timelineEvents || [])
      setSelectedResultId(resultId)
      setPhase("report-viewing")
    }
  }

  const handleDeleteResult = async (e: { stopPropagation: () => void }, resultId: string) => {
    e.stopPropagation() // 防止触发选择
    if (!projectPath || !currentFramework) return
    if (!confirm("确定要删除这个推演结果吗？此操作不可撤销。")) return

    setDeletingId(resultId)
    try {
      await deleteSimulationResult(projectPath, currentFramework.id, resultId)
      // 刷新列表
      await loadResultsForFramework(currentFramework.id)
      // 如果删除的是当前选中的结果，清空
      if (selectedResultId === resultId) {
        setCurrentReport(null)
        setCurrentDraft(null)
        setTimelineEvents([])
        setSelectedResultId(null)
        setPhase("framework-confirming")
      }
    } catch {
      // 删除失败忽略
    } finally {
      setDeletingId(null)
    }
  }

  const handleNewFramework = () => {
    reset()
    setPhase("configuring")
  }

  return (
    <div className="flex h-full flex-col">
      <div data-ui-panel-heading className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <PanelHeaderWithHelp
          title="故事框架"
          helpKey="storySimulation"
          helpTitle="剧情推演室使用说明"
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={handleNewFramework}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          新建框架
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FrameworkList
          onSelectFramework={handleSelectFramework}
          onNewFramework={handleNewFramework}
        />
      </div>
      {/* 历史推演结果 */}
      {currentFramework && savedResults.length > 0 && (
        <div className="shrink-0 border-t">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="text-xs font-semibold text-muted-foreground">
              历史推演 ({savedResults.length})
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto px-2 pb-2">
            {savedResults.map((result) => (
              <div
                key={result.id}
                className={`group flex items-center gap-1 rounded px-2 py-1.5 text-xs transition-colors cursor-pointer hover:bg-accent ${
                  selectedResultId === result.id ? "bg-accent" : ""
                }`}
                onClick={() => handleSelectResult(result.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="truncate text-foreground">
                      {new Date(result.createdAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {result.draft && (
                      <span className="shrink-0 rounded bg-primary/10 px-1 text-[0.625rem] text-primary">
                        草稿
                      </span>
                    )}
                  </div>
                  <span className="block truncate text-[0.6875rem] text-muted-foreground">
                    {result.report.recommendation?.slice(0, 25) || "查看推演结果"}...
                  </span>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  onClick={(e) => void handleDeleteResult(e, result.id)}
                  disabled={deletingId === result.id}
                  title="删除此结果"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function inferModeFromPath(path: string): "knowledge" | "files" {
  const normalized = normalizePath(path)
  if (normalized.includes("/wiki/outlines/")) return "files"
  return "knowledge"
}

interface PendingPageInfo {
  path: string
  title: string
  type: "chapter" | "outline"
  tags: string[]
  origin?: string
}

type ImportMemoryDecision = "extract" | "import-only" | "cancel"

interface ImportMemoryDecisionRequest {
  kind: "chapter" | "outline"
  count: number
}

async function getExistingChapterTitles(projectPath: string): Promise<Set<string>> {
  const titles = new Set<string>()
  try {
    const tree = await listDirectory(`${projectPath}/wiki/chapters`)
    const files = flattenMdFiles(tree)
    for (const file of files) {
      try {
        const content = await readFile(file.path)
        const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m)
        if (titleMatch?.[1]) {
          titles.add(titleMatch[1].trim())
        } else {
          titles.add(file.name.replace(/\.md$/, "").replace(/-/g, " ").trim())
        }
      } catch {
        titles.add(file.name.replace(/\.md$/, "").replace(/-/g, " ").trim())
      }
    }
  } catch {
    // Ignore missing chapter directories.
  }
  return titles
}

async function getUniqueWikiPagePath(dir: string, fileName: string): Promise<string> {
  const firstPath = `${dir}/${fileName}`
  if (!(await fileExists(firstPath))) return firstPath

  const extensionIndex = fileName.lastIndexOf(".")
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ""
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${dir}/${stem}-${index}${extension}`
    if (!(await fileExists(candidate))) return candidate
  }

  return `${dir}/${stem}-${Date.now()}${extension}`
}

export function SidebarPanel({ onUiTestCloseDirectory, onUiTestRegisterCancel }: { onUiTestCloseDirectory?: () => void; onUiTestRegisterCancel?: (cancel: (() => void) | null) => void } = {}) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const activeView = useWikiStore((s) => s.activeView)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setChatExpanded = useWikiStore((s) => s.setChatExpanded)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const enqueueChatReferenceTokens = useChatStore((s) => s.enqueueReferenceTokens)
  const enqueueOutlineReferenceTokens = useOutlineChatStore((s) => s.enqueueReferenceTokens)
  const setOutlineChatOpen = useOutlineGenerationStore((s) => s.setPanelOpen)
  const [mode, setMode] = useState<"knowledge" | "files">("knowledge")
  const [refreshKey, setRefreshKey] = useState(0)
  const [uiTestQuery, setUiTestQuery] = useState("")
  const [chapterTotalWords, setChapterTotalWords] = useState<number | null>(null)
  useEffect(() => setUiTestQuery(""), [activeView])
  const [pendingCreate, setPendingCreate] = useState<KnowledgeCreateRequest | null>(null)
  const [inputTitle, setInputTitle] = useState("")
  const [creating, setCreating] = useState(false)
  const [pendingPages, setPendingPages] = useState<PendingPageInfo[]>([])
  const [outlineImporting, setOutlineImporting] = useState(false)
  const [bulkOutlineOpen, setBulkOutlineOpen] = useState(false)
  const [bulkChapterOpen, setBulkChapterOpen] = useState(false)
  const [outlineImportMenuOpen, setOutlineImportMenuOpen] = useState(false)
  const outlineImportMenuRef = useRef<HTMLDivElement | null>(null)
  const [chapterImporting, setChapterImporting] = useState(false)
  const [chapterImportMenuOpen, setChapterImportMenuOpen] = useState(false)
  const [memoryDecisionRequest, setMemoryDecisionRequest] = useState<ImportMemoryDecisionRequest | null>(null)
  const chapterImportMenuRef = useRef<HTMLDivElement | null>(null)
  const chapterImportAbortRef = useRef<AbortController | null>(null)
  const activeImportTaskIdRef = useRef<string | null>(null)
  const outlineImportCancelledRef = useRef(false)
  const memoryDecisionResolveRef = useRef<((decision: ImportMemoryDecision) => void) | null>(null)
  /**
   * 「一次导入正在进行」的同步标记。
   *
   * `chapterImporting` / `outlineImporting` 是 state，要等到下一次渲染才变真，
   * 而「是否提取记忆」这个弹窗是在 setState **之前** await 的 —— 中间这一段时间里
   * 第二个入口照样能进来。菜单入口要用户再点一次才可能撞上，但桌面拖拽是
   * 原生事件，连续拖两次就会撞上：第二次会覆盖 memoryDecisionResolveRef，
   * 第一次那个 promise 永远不 resolve，导入就静默卡死。
   * 所以用 ref 在函数入口处同步占位。
   */
  const importRunBusyRef = useRef(false)

  function cancelPendingCreate() {
    setPendingCreate(null)
    setInputTitle("")
  }

  useEffect(() => {
    if (activeView === "wiki") {
      setMode("knowledge")
      return
    }
    if (activeView === "sources") {
      setMode("files")
      return
    }
    if (!selectedFile) return
    setMode(inferModeFromPath(selectedFile))
  }, [activeView, selectedFile])

  const isChapter = mode === "knowledge"

  /*
   * 桌面文件直接拖进列表就能导入。
   *
   * 走 Tauri 的原生拖拽事件（不是 DOM 的 onDrop）：这个应用的 webview 默认开着
   * dragDropEnabled，系统拖放会在到达 DOM 之前就被 Tauri 接走，React 的
   * onDrop/dataTransfer 收不到桌面文件。判定、换算、扩展名粗筛都在
   * lib/novel/drop-import.ts 与 components/novel/use-list-file-drop.ts 里，
   * 这里只负责把落进来的路径接到与菜单导入同一段的导入流程上。
   */
  const { containerRef: dropContainerRef, isDraggingOver } = useListFileDrop({
    enabled: Boolean(project) && !chapterImporting && !outlineImporting,
    kind: isChapter ? "chapter" : "outline",
    onDropPaths: (paths) => {
      if (isChapter) {
        void importChapterSourcePaths(paths)
        return
      }
      void runOutlineImport({
        count: paths.length,
        askMemoryFirst: true,
        performImport: (projectPath) => importOutlineFiles(projectPath, paths),
      })
    },
    onUnsupportedDrop: (message) => window.alert(message),
  })

  useEffect(() => {
    if (!pendingCreate?.kind) return
    if (isChapter && (pendingCreate.kind === "outline" || pendingCreate.kind === "folder")) {
      cancelPendingCreate()
    }
    if (!isChapter && pendingCreate.kind === "volume") {
      cancelPendingCreate()
    }
  }, [isChapter, pendingCreate?.kind])

  useEffect(() => {
    if (isChapter) {
      setOutlineImportMenuOpen(false)
    } else {
      setChapterImportMenuOpen(false)
    }
  }, [isChapter])

  useEffect(() => {
    if (!outlineImportMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (outlineImportMenuRef.current?.contains(target)) return
      setOutlineImportMenuOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOutlineImportMenuOpen(false)
    }

    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [outlineImportMenuOpen])

  useEffect(() => {
    if (!chapterImportMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (chapterImportMenuRef.current?.contains(target)) return
      setChapterImportMenuOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setChapterImportMenuOpen(false)
    }

    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [chapterImportMenuOpen])

  const handleRemovePendingPage = (pagePath: string) => {
    setPendingPages((prev) => prev.filter((page) => page.path !== pagePath))
  }

  async function refreshTree(projectPath: string, selectedPath?: string) {
    const tree = await listDirectory(projectPath)
    setFileTree(tree)
    useWikiStore.getState().bumpDataVersion()
    setRefreshKey((current) => current + 1)
    if (selectedPath) setSelectedFile(selectedPath)
  }

  function confirmImportMemoryExtraction(kind: "chapter" | "outline", count: number): Promise<ImportMemoryDecision> {
    return new Promise((resolve) => {
      memoryDecisionResolveRef.current = resolve
      setMemoryDecisionRequest({ kind, count })
    })
  }

  function confirmChapterMemoryExtraction(count: number): Promise<ImportMemoryDecision> {
    return confirmImportMemoryExtraction("chapter", count)
  }

  function confirmOutlineMemoryExtraction(count: number): Promise<ImportMemoryDecision> {
    return confirmImportMemoryExtraction("outline", count)
  }

  function closeMemoryDecision(decision: ImportMemoryDecision) {
    const resolve = memoryDecisionResolveRef.current
    memoryDecisionResolveRef.current = null
    setMemoryDecisionRequest(null)
    resolve?.(decision)
  }

  function handleCancelImportMemoryExtraction() {
    const taskId = activeImportTaskIdRef.current
    if (taskId) useImportProgressStore.getState().markCancelling(taskId)
    outlineImportCancelledRef.current = true
    chapterImportAbortRef.current?.abort()
  }

  async function extractImportedChapterMemories(projectPath: string, importedChapters: ImportedChapter[]) {
    const abortController = new AbortController()
    chapterImportAbortRef.current = abortController
    const titleByPath = new Map(importedChapters.map((chapter) => [chapter.path, chapter.title]))
    const taskId = useImportProgressStore.getState().startTask({
      projectPath,
      kind: "chapter",
      total: importedChapters.length,
      currentTitle: importedChapters[0]?.title ?? "",
      message: "正在提取章节记忆",
    })
    activeImportTaskIdRef.current = taskId

    const { ingestChapter } = await import("@/lib/novel/chapter-ingest")
    const result = await runImportedChapterMemoryExtraction({
      projectPath,
      chapterPaths: importedChapters.map((chapter) => chapter.path),
      signal: abortController.signal,
      reviewModel: undefined,
      ingestChapter,
      onProgress: (progress) => {
        useImportProgressStore.getState().updateTask(taskId, {
          completed: progress.completed,
          total: progress.total,
          currentTitle: progress.currentPath ? titleByPath.get(progress.currentPath) ?? progress.currentPath : "",
          // 章节目录的「提取中」灰点按路径点亮：标题会重名，路径不会。
          activeChapterPaths: progress.currentPath ? [normalizePath(progress.currentPath)] : [],
        })
      },
    })

    const doneMessage = result.cancelled
      ? `已取消记忆提取，已完成 ${result.completed}/${importedChapters.length} 个章节。`
      : result.failed > 0
        ? `记忆提取完成：成功 ${result.completed} 个，失败 ${result.failed} 个。`
        : `记忆提取完成：成功 ${result.completed} 个章节。`
    useImportProgressStore.getState().finishTask(taskId, result.cancelled ? "cancelled" : "done", {
      completed: result.completed,
      total: importedChapters.length,
      currentTitle: "",
      message: doneMessage,
    })
    chapterImportAbortRef.current = null
    activeImportTaskIdRef.current = null
    await refreshTree(projectPath, importedChapters[0]?.path)
  }

  async function extractImportedOutlineMemories(projectPath: string, importedPaths: string[]) {
    const { runOutlineIngestPaths } = await import("@/lib/novel/outline-generation")
    try {
      await runOutlineIngestPaths(projectPath, importedPaths, {
        onProgressTaskStarted: (taskId) => {
          activeImportTaskIdRef.current = taskId
        },
      })
    } finally {
      activeImportTaskIdRef.current = null
      await refreshTree(projectPath, importedPaths[0])
    }
  }

  async function finishChapterImport(projectPath: string, importedChapters: ImportedChapter[], extractMemory: boolean) {
    if (importedChapters.length === 0) {
      window.alert("没有找到可导入的章节文档。")
      return
    }
    await refreshTree(projectPath, importedChapters[0].path)
    if (extractMemory) {
      await extractImportedChapterMemories(projectPath, importedChapters)
    }
  }

  /**
   * 把一批**已知路径**的章节文档导进来：问记忆 → 导入 → 落盘后提取。
   *
   * 抽出来是为了让「选文件」「选文件夹」「从桌面拖进来」三条入口共用同一段逻辑。
   * 三条入口都对同一批文件得出同样的结果，用户才不会因为"这次是拖进来的"而
   * 得到不一样的章节号或不一样的前言。
   */
  async function importChapterSourcePaths(sourcePaths: string[]) {
    if (!project || chapterImporting || importRunBusyRef.current || sourcePaths.length === 0) return

    // 同步占位，挡住"弹窗还没回答就又来一次"的并发入口（见 importRunBusyRef 注释）。
    importRunBusyRef.current = true
    const projectPath = normalizePath(project.path)
    try {
      const memoryDecision = await confirmChapterMemoryExtraction(sourcePaths.length)
      if (memoryDecision === "cancel") return
      const extractMemory = memoryDecision === "extract"
      setChapterImporting(true)
      const importedChapters = await importChapterFiles(projectPath, sourcePaths, {
        finalForMemoryExtraction: extractMemory,
      })
      await finishChapterImport(projectPath, importedChapters, extractMemory)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("[SidebarPanel] chapter import failed:", error)
      window.alert(`导入失败：${message}`)
    } finally {
      importRunBusyRef.current = false
      setChapterImporting(false)
      setChapterImportMenuOpen(false)
    }
  }

  async function handleImportChapterFiles() {
    if (!project || chapterImporting) return

    const { open } = await import("@tauri-apps/plugin-dialog")
    const selected = await open({
      multiple: true,
      title: "导入章节文件",
      filters: [{ name: "章节文档", extensions: [...CHAPTER_IMPORT_EXTENSIONS] }],
    })
    if (!selected || (Array.isArray(selected) && selected.length === 0)) return
    const sourcePaths = Array.isArray(selected) ? selected : [selected]

    await importChapterSourcePaths(sourcePaths)
  }

  async function handleImportChapterFolder() {
    if (!project || chapterImporting) return

    const { open } = await import("@tauri-apps/plugin-dialog")
    const selected = await open({
      directory: true,
      title: "导入章节文件夹",
    })
    const selectedFolder = Array.isArray(selected) ? selected[0] : selected
    if (!selectedFolder || typeof selectedFolder !== "string") return
    const candidates = await collectChapterImportCandidatesFromFolder(selectedFolder)

    if (candidates.length === 0) {
      window.alert("没有找到可导入的章节文档。")
      setChapterImportMenuOpen(false)
      return
    }

    await importChapterSourcePaths(candidates.map((candidate) => candidate.path))
  }

  async function handleImportOutlineFiles() {
    if (!project || outlineImporting) return

    const { open } = await import("@tauri-apps/plugin-dialog")
    const selected = await open({
      multiple: true,
      title: t("novel.outlineImport.importFilesTitle", { defaultValue: "导入大纲文件" }),
      filters: [
        {
          name: t("novel.outlineImport.documentFilter", { defaultValue: "文档" }),
          extensions: [...OUTLINE_IMPORT_EXTENSIONS],
        },
      ],
    })
    if (!selected || (Array.isArray(selected) && selected.length === 0)) return
    const sourcePaths = Array.isArray(selected) ? selected : [selected]

    await runOutlineImport({
      count: sourcePaths.length,
      askMemoryFirst: false,
      performImport: (projectPath) => importOutlineFiles(projectPath, sourcePaths),
    })
  }

  /**
   * 大纲导入的公共收尾：问记忆 → 导入 → 刷新 →（按需）提取。
   *
   * 三条入口共用它，但 `performImport` 由调用方给：
   *   - 「选文件夹」用 `importOutlineCandidates(projectPath, candidates)` —— 候选里
   *     带着 targetFolders（文件夹里的子目录结构），换成按路径重算会把层级拍平。
   *   - 「选文件」和「从桌面拖进来」用 `importOutlineFiles(projectPath, sourcePaths)`。
   *
   * `askMemoryFirst` 决定要不要先弹「是否提取记忆」：「选文件夹」和「拖进来」
   * 都可能一次带进一大批，需要在开始前决定；「选文件」这条入口过去就不问，
   * 保持原样，免得打断既有习惯。
   */
  async function runOutlineImport({
    count,
    askMemoryFirst,
    performImport,
  }: {
    count: number
    askMemoryFirst: boolean
    performImport: (projectPath: string) => Promise<string[]>
  }) {
    if (!project || outlineImporting || importRunBusyRef.current || count === 0) return

    // 同步占位，挡住"弹窗还没回答就又来一次"的并发入口（见 importRunBusyRef 注释）。
    importRunBusyRef.current = true
    const projectPath = normalizePath(project.path)
    try {
      let extractMemory = false
      if (askMemoryFirst) {
        const memoryDecision = await confirmOutlineMemoryExtraction(count)
        if (memoryDecision === "cancel") return
        extractMemory = memoryDecision === "extract"
      }

      setOutlineImporting(true)
      const importedPaths = await performImport(projectPath)
      if (importedPaths.length === 0) {
        window.alert(t("novel.outlineImport.emptyResult", { defaultValue: "没有找到可导入的大纲文档。" }))
        return
      }
      await refreshTree(projectPath, importedPaths[0])
      if (extractMemory) {
        await extractImportedOutlineMemories(projectPath, importedPaths)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("[SidebarPanel] outline import failed:", error)
      window.alert(t("novel.outlineImport.importFailed", {
        message,
        defaultValue: `导入失败：${message}`,
      }))
    } finally {
      importRunBusyRef.current = false
      setOutlineImporting(false)
      setOutlineImportMenuOpen(false)
    }
  }

  async function handleImportOutlineFolder() {
    if (!project || outlineImporting) return

    const { open } = await import("@tauri-apps/plugin-dialog")
    const selected = await open({
      directory: true,
      title: t("novel.outlineImport.importFolderTitle", { defaultValue: "导入大纲文件夹" }),
    })
    if (!selected || typeof selected !== "string") return
    const candidates = await collectOutlineImportCandidatesFromFolder(selected)

    if (candidates.length === 0) {
      window.alert(t("novel.outlineImport.emptyResult", { defaultValue: "没有找到可导入的大纲文档。" }))
      setOutlineImportMenuOpen(false)
      return
    }

    await runOutlineImport({
      count: candidates.length,
      askMemoryFirst: true,
      performImport: (projectPath) => importOutlineCandidates(projectPath, candidates),
    })
  }

  async function handleCreateNextChapter(parentDir?: string) {
    if (!project) return
    setCreating(true)
    try {
      const projectPath = normalizePath(project.path)
      const chaptersRoot = `${projectPath}/wiki/chapters`
      const targetDir = parentDir ?? chaptersRoot
      await createDirectory(chaptersRoot).catch(() => {})
      await createDirectory(targetDir).catch(() => {})

      const existingTitles = await getExistingChapterTitles(projectPath)
      let nextNumber = await getNextChapterNumber(projectPath)
      while (existingTitles.has(makeDefaultChapterTitle(nextNumber))) {
        nextNumber += 1
      }

      const title = makeDefaultChapterTitle(nextNumber)
      const filePath = await getUniqueWikiPagePath(targetDir, makeChapterFileName(title, nextNumber))
      const content = [
        "---",
        "type: chapter",
        `title: "${title}"`,
        `chapter_number: ${nextNumber}`,
        "chapter_status: draft",
        "---",
        "",
        `# ${title}`,
        "",
      ].join("\n")

      await writeFile(filePath, content)
      setPendingPages((prev) => [
        { path: filePath, title, type: "chapter", tags: [] },
        ...prev.filter((page) => page.path !== filePath),
      ])
      await refreshTree(projectPath, filePath)
    } catch (error) {
      console.error("[SidebarPanel] auto chapter create failed:", error)
    } finally {
      setCreating(false)
    }
  }

  async function handleCreateFromInput() {
    if (!project || !pendingCreate || !inputTitle.trim()) return
    setCreating(true)
    try {
      const projectPath = normalizePath(project.path)
      const title = inputTitle.trim()

      if (pendingCreate.kind === "outline") {
        const outlinesRoot = `${projectPath}/wiki/outlines`
        const targetDir = pendingCreate.parentDir ?? outlinesRoot
        await createDirectory(outlinesRoot).catch(() => {})
        await createDirectory(targetDir).catch(() => {})
        const filePath = await getUniqueWikiPagePath(targetDir, `${makeSafeFileSlug(title)}.md`)
        const content = buildPureOutlineMarkdown(title, "")
        await writeFile(filePath, content)
        setPendingPages((prev) => [
          { path: filePath, title, type: "outline", tags: [] },
          ...prev.filter((page) => page.path !== filePath),
        ])
        await refreshTree(projectPath, filePath)
      } else {
        const baseDir = pendingCreate.parentDir
          ?? `${projectPath}/wiki/${pendingCreate.kind === "volume" ? "chapters" : "outlines"}`
        await createDirectory(baseDir).catch(() => {})
        const folderPath = `${baseDir}/${makeSafeFileSlug(title)}`
        await createDirectory(folderPath)
        await refreshTree(projectPath)
      }

      setPendingCreate(null)
      setInputTitle("")
    } catch (error) {
      console.error("[SidebarPanel] create failed:", error)
    } finally {
      setCreating(false)
    }
  }

  function beginCreate(request: KnowledgeCreateRequest) {
    if (request.kind === "chapter") {
      void handleCreateNextChapter(request.parentDir)
      return
    }
    setPendingCreate(request)
    setInputTitle("")
  }

  const handleSendChapterToChat = useCallback((token: ReferenceToken) => {
    enqueueChatReferenceTokens([token])
    setChatExpanded(true)
  }, [enqueueChatReferenceTokens, setChatExpanded])

  const handleSendOutlineToOutlineChat = useCallback((token: ReferenceToken) => {
    enqueueOutlineReferenceTokens([token])
    setOutlineChatOpen(true)
    setActiveView("sources")
  }, [enqueueOutlineReferenceTokens, setActiveView, setOutlineChatOpen])

  const inputPlaceholder = pendingCreate?.kind === "outline"
    ? t("sidebar.newOutlinePrompt")
    : pendingCreate?.kind === "volume"
      ? t("sidebar.newVolumePrompt")
      : pendingCreate?.kind === "folder"
        ? t("sidebar.newFolderPrompt")
        : ""

  /*
   * 记忆中心整块从这里移除了。
   *
   * 它原本在 lint && novelMode 下渲染一个「记忆分类列表」，与右侧内容区构成
   * 双栏结构。记忆中心已改为整窗单页（见 ui-test-shell.tsx 的 fullWindowViews），
   * 分类列表变成页面顶部的标签条，所以这一栏、它的数据加载、以及它与内容区之间
   * 的握手状态（selectedMemoryCenterEntry）全部不再需要。
   *
   * 注意 handleCancelImportMemoryExtraction 仍在下面：那是**导入章节时的记忆提取**
   * 取消入口，与记忆中心的展示无关，两者此前共用过 memory 前缀，别误删。
   */

  useEffect(() => {
    if (!onUiTestRegisterCancel) return
    onUiTestRegisterCancel(handleCancelImportMemoryExtraction)
    return () => onUiTestRegisterCancel(null)
  }, [onUiTestRegisterCancel])

  if (activeView === "storySimulation") {
    return <StorySimulationSidebarPanel />
  }

  if (activeView === "graph") {
    return <GraphSidebarPanel />
  }

  if (activeView === "reviewCenter") {
    return <ReviewCenterSidebarPanel />
  }

  if (activeView === "bookAnalysis") {
    return (
      <Suspense fallback={<SidebarPanelLoading />}>
        <BookAnalysisSidebarPanel />
      </Suspense>
    )
  }

  if (activeView === "search") {
    return <SearchHistoryPanel />
  }

  if (activeView === "trash") {
    return <TrashPanel />
  }

  /*
   * 记忆中心分支已删除：分类列表变成页面内的标签条，整个记忆中心现在是整窗单页。
   * 详见 ui-test-shell.tsx 的 fullWindowViews。
   */

  return (
    <div className="flex h-full flex-col">
      <UiTestDirectoryHeader
        kind={isChapter ? "chapter" : "outline"}
        totalWordCount={isChapter ? chapterTotalWords : null}
        busy={creating || outlineImporting || chapterImporting}
        onCreate={() => { setUiTestQuery(""); if (isChapter) void handleCreateNextChapter(); else beginCreate({ kind: "outline" }) }}
        onCreateContainer={() => beginCreate({ kind: isChapter ? "volume" : "folder" })}
        onImportFiles={() => { if (isChapter) void handleImportChapterFiles(); else void handleImportOutlineFiles() }}
        onImportFolder={() => { if (isChapter) void handleImportChapterFolder(); else void handleImportOutlineFolder() }}
        onOpenAssistant={() => { if (isChapter) setBulkChapterOpen((open) => !open); else setBulkOutlineOpen((open) => !open) }}
        onClose={onUiTestCloseDirectory}
        onHelp={() => void openExternalUrl(USAGE_GUIDE_URL)}
      />

      {pendingCreate && (
        <div className="flex flex-col gap-2 border-b px-2 py-2">
          <input
            type="text"
            value={inputTitle}
            onChange={(event) => setInputTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && inputTitle.trim() && !event.nativeEvent.isComposing) {
                void handleCreateFromInput()
              } else if (event.key === "Escape") {
                cancelPendingCreate()
              }
            }}
            placeholder={inputPlaceholder}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
            autoFocus
            disabled={creating}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                cancelPendingCreate()
              }}
              disabled={creating}
              className="rounded-md border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleCreateFromInput()}
              disabled={!inputTitle.trim() || creating}
              className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {creating ? "..." : "创建"}
            </button>
          </div>
        </div>
      )}

      {!isChapter && bulkOutlineOpen && <div className="border-b px-3 py-2"><UiTestOutlineTools /></div>}
      {isChapter && bulkChapterOpen && <div className="border-b px-3 py-2"><UiTestOutlineTools kind="chapter" /></div>}
      <div
        ref={dropContainerRef}
        data-ui-list-drop-target={isChapter ? "chapter" : "outline"}
        className={`relative flex-1 overflow-hidden transition-colors ${isDraggingOver ? "ring-2 ring-inset ring-primary/60 bg-primary/5" : ""}`}
      >
        {/* 拖拽经过时才出现的一条提示：让用户知道"松手就导入到这里"。
            不用整块遮罩，否则会挡住列表本身，用户看不到自己要放进哪。 */}
        {isDraggingOver ? (
          <div
            className="pointer-events-none absolute inset-x-2 top-2 z-10 rounded border border-primary/40 bg-background/95 px-2 py-1 text-center text-[0.6875rem] text-primary shadow-sm"
            data-ui-list-drop-hint="true"
          >
            松手即可导入到{isChapter ? "章节" : "大纲"}列表
          </div>
        ) : null}
        <KnowledgeTree
          searchQuery={uiTestQuery}
          onSearchQueryChange={setUiTestQuery}
          onChapterTotalWordsChange={isChapter ? setChapterTotalWords : undefined}
          filterType={isChapter ? "chapter" : "outline"}
          refreshKey={refreshKey}
          pendingPages={pendingPages.filter((page) => page.type === (isChapter ? "chapter" : "outline"))}
          onRemovePendingPage={handleRemovePendingPage}
          onRequestCreate={beginCreate}
          onSendToChat={isChapter ? handleSendChapterToChat : undefined}
          onSendToOutline={!isChapter ? handleSendOutlineToOutlineChat : undefined}
        />
      </div>
      <Dialog
        open={Boolean(memoryDecisionRequest)}
        onOpenChange={(open) => {
          if (!open) closeMemoryDecision("cancel")
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>是否提取记忆</DialogTitle>
            <DialogDescription>
              {memoryDecisionRequest?.kind === "outline"
                ? `本次将导入 ${memoryDecisionRequest.count} 个 AI 大纲文档。提取记忆会增加 token 消耗，速度也会比较慢，请耐心等待。`
                : `本次将导入 ${memoryDecisionRequest?.count ?? 0} 个章节文档。提取记忆会增加 token 消耗，速度也会比较慢，请耐心等待。`}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            点击“提取记忆”会在导入后逐个提取并同步到记忆库；点击“只导入”不会提取记忆；点击“取消导入”或关闭弹窗将取消本次导入。
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => closeMemoryDecision("cancel")}>
              取消导入
            </Button>
            <Button type="button" variant="secondary" onClick={() => closeMemoryDecision("import-only")}>
              只导入
            </Button>
            <Button type="button" onClick={() => closeMemoryDecision("extract")}>
              提取记忆
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
