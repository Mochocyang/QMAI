import { useCallback, useEffect, useRef, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { IconSidebar } from "./icon-sidebar"
import { SidebarPanel } from "./sidebar-panel"
import { ContentArea } from "./content-area"
import { ActivityPanel } from "./activity-panel"
import { useOutlineGenerationStore, type OutlineGenerationTask, type OutlineGenerationState } from "@/stores/outline-generation-store"
import { useBookAnalysisStore } from "@/stores/book-analysis-store"
import { ErrorBoundary } from "@/components/error-boundary"
import { clampSidebarWidth } from "@/lib/workspace-layout"
import { useTranslation } from "react-i18next"
import { HelpCircle, X } from "lucide-react"

const USAGE_GUIDE_PROMPT_DISMISSED_KEY = "qmai-usage-guide-prompt-dismissed"

interface AppLayoutProps {
  onSwitchProject: () => void
}

export function AppLayout({ onSwitchProject }: AppLayoutProps) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setActiveSettingsCategory = useWikiStore((s) => s.setActiveSettingsCategory)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const outlineTasks = useOutlineGenerationStore((s: OutlineGenerationState) => s.tasks)
  const removeOutlineTask = useOutlineGenerationStore((s: OutlineGenerationState) => s.removeTask)
  const bookAnalysisTasks = useBookAnalysisStore((s) => s.tasks)
  const cancelBookAnalysisTask = useBookAnalysisStore((s) => s.cancelTask)
  const [leftWidth, setLeftWidth] = useState(220)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [usageGuidePromptDismissed, setUsageGuidePromptDismissed] = useState(() => {
    if (typeof localStorage === "undefined") return false
    return localStorage.getItem(USAGE_GUIDE_PROMPT_DISMISSED_KEY) === "1"
  })
  // 拆书分析通知：用户手动关闭的任务ID集合（运行中关闭后不再显示，完成后重新弹出）
  const [dismissedBookAnalysisTaskIds, setDismissedBookAnalysisTaskIds] = useState<Set<string>>(new Set())
  const isDraggingLeft = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const latestOutlineTask = outlineTasks
    .filter((task: OutlineGenerationTask) => (
      task.status === "generating" ||
      task.status === "generated" ||
      task.status === "error"
    ))
    .sort((a: OutlineGenerationTask, b: OutlineGenerationTask) => b.updatedAt - a.updatedAt)[0] ?? null

  // 拆书分析后台任务：正在运行或刚完成
  // 运行中的任务如果被用户关闭则不显示，但完成后重新弹出
  const latestBookAnalysisTask = bookAnalysisTasks
    .filter((task) => {
      if (task.status !== "running" && task.status !== "completed" && task.status !== "error") return false
      // 完成或出错时总是显示
      if (task.status === "completed" || task.status === "error") return true
      // 运行中：如果用户关闭过则不显示
      return !dismissedBookAnalysisTaskIds.has(task.id)
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null

  const loadFileTree = useCallback(async () => {
    if (!project) return
    try {
      const tree = await listDirectory(normalizePath(project.path))
      setFileTree(tree)
    } catch (err) {
      console.error("Failed to load file tree:", err)
    }
  }, [project, setFileTree])

  useEffect(() => {
    loadFileTree()
  }, [loadFileTree])

  const startDrag = useCallback(
    (side: "left") => (e: React.MouseEvent) => {
      e.preventDefault()
      if (side === "left") isDraggingLeft.current = true
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
      document.body.dataset.panelResizing = "true"

      const handleMouseMove = (e: MouseEvent) => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()

        if (isDraggingLeft.current) {
          const newWidth = e.clientX - rect.left
          setLeftWidth(clampSidebarWidth(newWidth))
        }
      }

      const handleMouseUp = () => {
        isDraggingLeft.current = false
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
        delete document.body.dataset.panelResizing
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
      }

      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
    },
    []
  )

  // Settings is a full-width admin view — the file tree / activity panel
  // are irrelevant there and their narrow column makes the settings form
  // cramped. Hide both the left sidebar (and the file preview on the
  // right) so the settings screen uses the whole content area.
  const isSettings = activeView === "settings"
  // Novel mode keeps the writing editor inside the chapter workspace only.
  // Outline/search/graph views no longer mount a secondary preview panel.

  useEffect(() => {
    const savedCollapsed = localStorage.getItem("lk-sidebar-collapsed")
    if (savedCollapsed === "1") {
      setSidebarCollapsed(true)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem("lk-sidebar-collapsed", sidebarCollapsed ? "1" : "0")
  }, [sidebarCollapsed])

  const dismissUsageGuidePrompt = useCallback(() => {
    setUsageGuidePromptDismissed(true)
    localStorage.setItem(USAGE_GUIDE_PROMPT_DISMISSED_KEY, "1")
  }, [])

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {latestOutlineTask && (
        <div className="fixed bottom-3 right-3 z-50 w-80 rounded-lg border bg-background p-3 shadow-lg">
          <div className="text-sm font-medium">
            {latestOutlineTask.status === "generating"
              ? latestOutlineTask.kind === "refine"
                ? (latestOutlineTask.displayTitle && latestOutlineTask.displayTitle !== t("novel.outlineGenerator.refineTitle")
                  ? t("novel.outlineGenerator.sectionGenerating", { title: latestOutlineTask.displayTitle })
                  : t("novel.outlineGenerator.refining"))
                : t("novel.outlineGenerator.generatingTitle")
              : latestOutlineTask.status === "error"
                ? t("novel.outlineGenerator.error")
                : latestOutlineTask.kind === "refine"
                  ? t("novel.outlineGenerator.refineTitle")
                  : t("novel.outlineGenerator.generatedTitle")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {latestOutlineTask.status === "generating"
              ? t("novel.outlineGenerator.generationMayTakeLong")
              : latestOutlineTask.status === "error"
                ? latestOutlineTask.message
                : latestOutlineTask.kind === "refine"
                  ? latestOutlineTask.message
                  : t("novel.outlineGenerator.generatedDescription")}
          </div>
          <div className="mt-3 flex gap-2">
            {latestOutlineTask.outlinePath ? (
              <>
                <button
                  type="button"
                  className="rounded-md border px-3 py-1.5 text-xs"
                  onClick={async () => {
                    const { openGeneratedOutline } = await import("@/lib/novel/outline-generation")
                    await openGeneratedOutline(latestOutlineTask.id)
                  }}
                >
                  {t("novel.outlineGenerator.openOutline")}
                </button>
                {latestOutlineTask.kind === "outline" ? (
                  <button
                    type="button"
                    className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                    onClick={async () => {
                      const { runOutlineIngestTask } = await import("@/lib/novel/outline-generation")
                      await runOutlineIngestTask(latestOutlineTask.id)
                    }}
                  >
                    {t("novel.outlineGenerator.ingestNow")}
                  </button>
                ) : null}
              </>
            ) : null}
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground"
              onClick={() => removeOutlineTask(latestOutlineTask.id)}
            >
              {t("novel.outlineGenerator.handleLater")}
            </button>
          </div>
        </div>
      )}
      {/* 拆书分析后台任务通知 */}
      {latestBookAnalysisTask && (
        <div className={`fixed z-50 w-80 rounded-lg border bg-background p-3 shadow-lg ${latestOutlineTask ? "bottom-[calc(0.75rem+13rem)]" : "bottom-3"} right-3`}>
          <button
            type="button"
            onClick={() => {
              if (latestBookAnalysisTask.status === "running") {
                // 运行中关闭：记录ID，完成后重新弹出
                setDismissedBookAnalysisTaskIds((prev) => new Set(prev).add(latestBookAnalysisTask.id))
              } else {
                // 完成/出错关闭：移除任务
                cancelBookAnalysisTask(latestBookAnalysisTask.id)
              }
            }}
            className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="关闭"
            aria-label="关闭通知"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <div className="text-sm font-medium pr-5">
            {latestBookAnalysisTask.status === "running"
              ? latestBookAnalysisTask.progress.stage === "extracting_characters"
                ? "正在后台提取角色"
                : latestBookAnalysisTask.progress.stage === "analyzing_six_dimension"
                  ? "正在后台深度提取"
                  : latestBookAnalysisTask.progress.stage === "generating_skills"
                    ? "正在后台生成 Skills"
                    : "拆书分析后台运行中"
              : latestBookAnalysisTask.status === "error"
                ? "拆书分析出错"
                : "拆书分析完成"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {latestBookAnalysisTask.status === "running"
              ? latestBookAnalysisTask.progress.stageLabel || "处理中，请耐心等待..."
              : latestBookAnalysisTask.status === "error"
                ? latestBookAnalysisTask.error || "分析过程中出现错误"
                : latestBookAnalysisTask.progress.stageLabel || "角色特征提取已完成"}
          </div>
          {latestBookAnalysisTask.status === "running" && (
            <div className="mt-2">
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${latestBookAnalysisTask.progress.percentage ?? 0}%` }}
                />
              </div>
              {latestBookAnalysisTask.progress.currentItem && (
                <div className="mt-1 text-xs text-muted-foreground truncate">
                  {latestBookAnalysisTask.progress.currentItem}
                </div>
              )}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            {latestBookAnalysisTask.status === "completed" && (
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                onClick={() => {
                  setActiveView("bookAnalysis")
                  cancelBookAnalysisTask(latestBookAnalysisTask.id)
                }}
              >
                查看结果
              </button>
            )}
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground"
              onClick={() => {
                if (latestBookAnalysisTask.status === "running") {
                  setDismissedBookAnalysisTaskIds((prev) => new Set(prev).add(latestBookAnalysisTask.id))
                } else {
                  cancelBookAnalysisTask(latestBookAnalysisTask.id)
                }
              }}
            >
              {latestBookAnalysisTask.status === "running" ? "稍后处理" : "关闭"}
            </button>
          </div>
        </div>
      )}
      {!isSettings && !usageGuidePromptDismissed && (
        <div className="fixed bottom-4 left-14 z-50 w-56 rounded-lg border border-primary/40 bg-background/95 p-3 shadow-xl backdrop-blur">
          <button
            type="button"
            onClick={dismissUsageGuidePrompt}
            className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="关闭"
            aria-label="关闭软件使用说明提示"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              dismissUsageGuidePrompt()
              setActiveSettingsCategory("usage-guide")
              setActiveView("settings")
            }}
            className="flex w-full items-start gap-2 pr-5 text-left"
          >
            <span className="mt-0.5 rounded-md bg-primary/10 p-1.5 text-primary">
              <HelpCircle className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">软件不知道怎么使用？点我</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                查看完整教程、用户手册和小说功能介绍。
              </span>
            </span>
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <IconSidebar
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          onOpenSidebar={() => setSidebarCollapsed(false)}
          onSwitchProject={onSwitchProject}
        />
        <div ref={containerRef} className="flex min-w-0 flex-1 overflow-hidden">
        {!isSettings && !sidebarCollapsed && (
          <>
            <div
              className="flex shrink-0 flex-col overflow-hidden border-r"
              style={{ width: leftWidth }}
            >
              <div className="flex-1 overflow-hidden">
                <SidebarPanel />
              </div>
              <ActivityPanel />
            </div>
            <div
              className="w-1.5 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/30 active:bg-primary/40"
              onMouseDown={startDrag("left")}
            />
          </>
        )}
        <div className="min-w-0 flex-1 overflow-hidden">
          <ErrorBoundary>
            <ContentArea />
          </ErrorBoundary>
        </div>
        </div>
      </div>
    </div>
  )
}
