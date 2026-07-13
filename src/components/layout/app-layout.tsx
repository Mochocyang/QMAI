import { useCallback, useEffect, useRef, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { refreshProjectFileTree } from "@/lib/project-file-tree-refresh"
import { IconSidebar } from "./icon-sidebar"
import { SidebarPanel } from "./sidebar-panel"
import { ContentArea } from "./content-area"
import { ActivityPanel } from "./activity-panel"
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
  const bookAnalysisTasks = useBookAnalysisStore((s) => s.tasks)
  const removeBookAnalysisTask = useBookAnalysisStore((s) => s.removeTask)
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
    await refreshProjectFileTree(project.path, {
      projectId: project.id,
      clearDisplayTreeFirst: false,
    })
  }, [project])

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

  const bookAnalysisTitle = latestBookAnalysisTask
    ? latestBookAnalysisTask.status === "running"
      ? latestBookAnalysisTask.progress.stage === "extracting_characters"
        ? t("appLayout.bookAnalysis.extractingCharacters")
        : latestBookAnalysisTask.progress.stage === "analyzing_six_dimension"
          ? t("appLayout.bookAnalysis.analyzingSixDimension")
          : latestBookAnalysisTask.progress.stage === "generating_skills"
            ? t("appLayout.bookAnalysis.generatingSkills")
            : t("appLayout.bookAnalysis.running")
      : latestBookAnalysisTask.status === "error"
        ? t("appLayout.bookAnalysis.error")
        : t("appLayout.bookAnalysis.completed")
    : ""

  const bookAnalysisDescription = latestBookAnalysisTask
    ? latestBookAnalysisTask.status === "running"
      ? latestBookAnalysisTask.progress.stageLabel || t("appLayout.bookAnalysis.processing")
      : latestBookAnalysisTask.status === "error"
        ? latestBookAnalysisTask.error || t("appLayout.bookAnalysis.errorDescription")
        : latestBookAnalysisTask.progress.stageLabel || t("appLayout.bookAnalysis.completedDescription")
    : ""

  const bookAnalysisDismissLabel = latestBookAnalysisTask?.status === "running"
    ? t("appLayout.bookAnalysis.handleLater")
    : t("common.close")

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* 拆书分析后台任务通知 */}
      {latestBookAnalysisTask && (
        <div className="fixed bottom-3 right-3 z-50 w-80 rounded-lg border bg-background p-3 shadow-lg">
          <button
            type="button"
            onClick={() => {
              if (latestBookAnalysisTask.status === "running") {
                // 运行中关闭：记录ID，完成后重新弹出
                setDismissedBookAnalysisTaskIds((prev) => new Set(prev).add(latestBookAnalysisTask.id))
              } else {
                // 完成/出错关闭：从列表中移除
                removeBookAnalysisTask(latestBookAnalysisTask.id)
              }
            }}
            className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t("common.close")}
            aria-label={t("appLayout.bookAnalysis.closeNotification")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <div className="text-sm font-medium pr-5">
            {bookAnalysisTitle}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {bookAnalysisDescription}
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
                  removeBookAnalysisTask(latestBookAnalysisTask.id)
                }}
              >
                {t("appLayout.bookAnalysis.viewResult")}
              </button>
            )}
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground"
              onClick={() => {
                if (latestBookAnalysisTask.status === "running") {
                  setDismissedBookAnalysisTaskIds((prev) => new Set(prev).add(latestBookAnalysisTask.id))
                } else {
                  removeBookAnalysisTask(latestBookAnalysisTask.id)
                }
              }}
            >
              {bookAnalysisDismissLabel}
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
            title={t("common.close")}
            aria-label={t("appLayout.usageGuidePrompt.close")}
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
              <span className="block text-sm font-medium">{t("appLayout.usageGuidePrompt.title")}</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {t("appLayout.usageGuidePrompt.description")}
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
        <div ref={containerRef} className="flex min-w-0 min-h-0 flex-1 overflow-hidden">
        {!isSettings && !sidebarCollapsed && (
          <>
            <div
              className="flex shrink-0 flex-col overflow-hidden border-r"
              style={{ width: leftWidth }}
            >
              <div className="min-h-0 flex-1 overflow-hidden">
                <SidebarPanel />
              </div>
              <ActivityPanel />
            </div>
            <div
              className="w-1 shrink-0 cursor-col-resize bg-border/20 transition-colors hover:bg-primary/25 active:bg-primary/30"
              onMouseDown={startDrag("left")}
            />
          </>
        )}
        <div className="min-w-0 min-h-0 flex-1 overflow-hidden">
          <ErrorBoundary>
            <ContentArea />
          </ErrorBoundary>
        </div>
        </div>
      </div>
    </div>
  )
}
