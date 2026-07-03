import { useState, useRef, useEffect, useMemo } from "react"
import {
  FileText, FolderOpen, Search, Network, Brain, Settings, ArrowLeftRight, Sun, Moon, SunMoon, Check, Trash2, Sparkles, LayoutDashboard, BookOpen, Drama, WandSparkles,
} from "lucide-react"
import { createPortal } from "react-dom"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useTranslation } from "react-i18next"
import logoImg from "@/assets/QM-LOGO.png"
import type { WikiState } from "@/stores/wiki-store"
import { saveTheme } from "@/lib/project-store"
import { applyTheme, type ThemeMode } from "@/lib/theme-utils"
import {
  isSidebarNavItemId,
  reorderSidebarNavOrder,
  type SidebarNavItemId,
} from "@/lib/sidebar-nav-preferences"

type NavView = WikiState["activeView"]

interface ConfigurableNavItem {
  id: SidebarNavItemId
  view: NavView
  icon: typeof FileText
  labelKey: string
}

const CONFIGURABLE_NAV_ITEMS: ConfigurableNavItem[] = [
  { id: "wiki", view: "wiki", icon: FileText, labelKey: "novel.nav.wiki" },
  { id: "sources", view: "sources", icon: FolderOpen, labelKey: "novel.nav.sources" },
  { id: "graph", view: "graph", icon: Network, labelKey: "novel.nav.graph" },
  { id: "lint", view: "lint", icon: Brain, labelKey: "novel.nav.lint" },
  { id: "soul", view: "soul", icon: Sparkles, labelKey: "novel.nav.soul" },
  { id: "skillLibrary", view: "skillLibrary", icon: WandSparkles, labelKey: "novel.nav.skillLibrary" },
  { id: "bookAnalysis", view: "bookAnalysis", icon: BookOpen, labelKey: "novel.nav.dismantling" },
  { id: "reviewCenter", view: "reviewCenter", icon: LayoutDashboard, labelKey: "novel.nav.reviewCenter" },
  { id: "storySimulation", view: "storySimulation", icon: Drama, labelKey: "novel.nav.storySimulation" },
  { id: "search", view: "search", icon: Search, labelKey: "novel.nav.search" },
  { id: "trash", view: "trash", icon: Trash2, labelKey: "nav.trash" },
]

interface IconSidebarProps {
  onToggleSidebar?: () => void
  onOpenSidebar?: () => void
  onSwitchProject: () => void
}

const THEME_OPTIONS: { value: ThemeMode; icon: typeof Sun; labelKey: string }[] = [
  { value: "light", icon: Sun, labelKey: "theme.light" },
  { value: "dark", icon: Moon, labelKey: "theme.dark" },
  { value: "system", icon: SunMoon, labelKey: "theme.system" },
]

interface SortableNavButtonProps {
  item: ConfigurableNavItem
  activeView: NavView
  pendingCount: number
  label: string
  onClick: (item: ConfigurableNavItem) => void
}

function SortableNavButton({ item, activeView, pendingCount, label, onClick }: SortableNavButtonProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const Icon = item.icon
  const isActive = activeView === item.view || (item.view === "skillLibrary" && activeView === "writingSkillLibrary")
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <Tooltip>
      <TooltipTrigger
        ref={setNodeRef}
        type="button"
        onClick={() => onClick(item)}
        className={`relative flex h-10 w-10 touch-none items-center justify-center rounded-md transition-colors ${
          isActive
            ? "qm-selected"
            : "text-muted-foreground qm-hover"
        } ${isDragging ? "z-10 opacity-80 shadow-sm" : ""}`}
        style={style}
        {...attributes}
        {...listeners}
      >
        <Icon className="h-5 w-5" />
        {item.view === "reviewCenter" && pendingCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {pendingCount > 99 ? "99+" : pendingCount}
          </span>
        )}
        {item.view === "storySimulation" && (
          <span className="absolute -right-1 -top-0.5 flex h-3.5 items-center justify-center rounded bg-amber-500 px-1 text-[9px] font-bold leading-none text-white">
            BETA
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}
        {item.view === "reviewCenter" && pendingCount > 0 && ` (${pendingCount})`}
        {item.view === "storySimulation" && " (测试版)"}
      </TooltipContent>
    </Tooltip>
  )
}

export function IconSidebar({ onToggleSidebar, onOpenSidebar, onSwitchProject }: IconSidebarProps) {
  const { t } = useTranslation()
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSearchPanelOpen = useWikiStore((s) => s.setSearchPanelOpen)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const theme = useWikiStore((s) => s.theme)
  const setTheme = useWikiStore((s) => s.setTheme)
  const sidebarNavConfig = useWikiStore((s) => s.sidebarNavConfig)
  const setSidebarNavConfig = useWikiStore((s) => s.setSidebarNavConfig)
  const pendingCount = useReviewStore((s) => s.items.filter((i) => !i.resolved).length)

  // 主题下拉框状态
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const themeTriggerRef = useRef<HTMLButtonElement>(null)
  const [themeMenuStyle, setThemeMenuStyle] = useState<{ left: number; top: number } | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  )
  const navItemsById = useMemo(
    () => new Map(CONFIGURABLE_NAV_ITEMS.map((item) => [item.id, item])),
    [],
  )
  const hiddenNavIds = useMemo(
    () => new Set(sidebarNavConfig.hidden),
    [sidebarNavConfig.hidden],
  )
  const visibleNavItems = sidebarNavConfig.order
    .map((id) => navItemsById.get(id))
    .filter((item): item is ConfigurableNavItem => item !== undefined && !hiddenNavIds.has(item.id))
  const visibleNavIds = visibleNavItems.map((item) => item.id)

  const getThemeIcon = () => {
    const option = THEME_OPTIONS.find((o) => o.value === theme)
    const Icon = option?.icon ?? Sun
    return <Icon className="h-5 w-5" />
  }

  const handleSelectTheme = (nextTheme: ThemeMode) => {
    setTheme(nextTheme)
    saveTheme(nextTheme)
    applyTheme(nextTheme)
    setThemeMenuOpen(false)
  }

  useEffect(() => {
    if (!themeMenuOpen) {
      setThemeMenuStyle(null)
      return
    }
    const updatePosition = () => {
      const rect = themeTriggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const menuWidth = 180
      const menuHeight = THEME_OPTIONS.length * 36 + 8
      const left = Math.min(rect.right + 6, window.innerWidth - menuWidth - 4)
      let top: number
      const availableAbove = rect.top
      const availableBelow = window.innerHeight - rect.bottom
      if (availableAbove >= menuHeight + 6 || availableAbove >= availableBelow) {
        top = Math.max(4, rect.bottom - menuHeight)
      } else {
        top = rect.top
      }
      setThemeMenuStyle({ left, top })
    }
    updatePosition()
    window.addEventListener("resize", updatePosition)
    return () => window.removeEventListener("resize", updatePosition)
  }, [themeMenuOpen])

  const handleNavClick = (view: NavView) => {
    setSearchPanelOpen(false)
    const normalizedSelectedFile = selectedFile?.replace(/\\/g, "/") ?? ""

    // 离开wiki视图时，保存当前章节路径到sessionStorage，以便切回时恢复
    if (activeView === "wiki" && view !== "wiki" && normalizedSelectedFile.includes("/wiki/chapters/")) {
      try {
        sessionStorage.setItem("lk-last-chapter-path", selectedFile!)
      } catch { /* ignore quota errors */ }
    }

    // 离开sources视图时，如果当前选中的是大纲文件，保存到sessionStorage（仅章节用chapter key，大纲暂不做持久化）

    // 切换视图时清空不属于目标视图的选中文件
    let needsRestoreChapter = false
    if (
      view === "wiki" &&
      normalizedSelectedFile &&
      !normalizedSelectedFile.includes("/wiki/chapters/")
    ) {
      setSelectedFile(null)
      needsRestoreChapter = true
    }
    if (
      view === "sources" &&
      normalizedSelectedFile &&
      !normalizedSelectedFile.includes("/wiki/outlines/")
    ) {
      setSelectedFile(null)
    }

    // 切换回wiki时，如果selectedFile为空或已被清空，尝试从sessionStorage恢复章节
    if (view === "wiki" && (!normalizedSelectedFile || needsRestoreChapter)) {
      const savedPath = sessionStorage.getItem("lk-last-chapter-path")
      if (savedPath) {
        setSelectedFile(savedPath)
      }
    }

    setActiveView(view)
  }

  const handleConfigurableNavClick = (item: ConfigurableNavItem) => {
    handleNavClick(item.view)
    if (item.view === "trash") {
      onOpenSidebar?.()
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (!isSidebarNavItemId(activeId) || !isSidebarNavItemId(overId)) return
    setSidebarNavConfig({
      ...sidebarNavConfig,
      order: reorderSidebarNavOrder(sidebarNavConfig.order, activeId, overId),
    })
  }

  return (
    <TooltipProvider delay={300}>
      <div className="flex h-full w-12 flex-col items-center border-r bg-muted/50 py-2">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="mb-2 flex items-center justify-center rounded-md p-0.5 transition-colors hover:bg-accent/50"
          title={t("iconSidebar.toggleSidebar")}
        >
          <img
            src={logoImg}
            alt={t("iconSidebar.logoAlt")}
            className="h-6 w-6 rounded-[22%]"
          />
        </button>
        {/* Top: configurable feature entries */}
        <div className="flex flex-1 flex-col items-center gap-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={visibleNavIds} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col items-center gap-1">
                {visibleNavItems.map((item) => (
                  <SortableNavButton
                    key={item.id}
                    item={item}
                    activeView={activeView}
                    pendingCount={pendingCount}
                    label={t(item.labelKey)}
                    onClick={handleConfigurableNavClick}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        {/* Bottom: daemon status + theme toggle + settings + switch project */}
        <div className="flex flex-col items-center gap-1 pb-1">
          {/* Theme selector dropdown */}
          <Tooltip>
            <TooltipTrigger
              ref={themeTriggerRef}
              onClick={() => setThemeMenuOpen(!themeMenuOpen)}
              className={`relative flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-accent/50 hover:text-accent-foreground ${
                themeMenuOpen ? "bg-accent/50 text-accent-foreground" : "text-muted-foreground"
              }`}
            >
              {getThemeIcon()}
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("theme.switch")}
            </TooltipContent>
          </Tooltip>
          {themeMenuOpen && themeMenuStyle && createPortal(
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setThemeMenuOpen(false)}
              />
              <div
                className="fixed z-50 rounded-md border bg-popover p-1 shadow-md"
                style={{ left: themeMenuStyle.left, top: themeMenuStyle.top, width: 180 }}
              >
                {THEME_OPTIONS.map((option) => {
                  const Icon = option.icon
                  const isActive = theme === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleSelectTheme(option.value)}
                      className={`flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                        isActive ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{t(option.labelKey)}</span>
                      <Check className={`h-4 w-4 shrink-0 ${isActive ? "opacity-100" : "opacity-0"}`} />
                    </button>
                  )
                })}
              </div>
            </>,
            document.body,
          )}
          <Tooltip>
            <TooltipTrigger
              onClick={() => {
                setSearchPanelOpen(false)
                setActiveView("settings")
              }}
              className={`relative flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                activeView === "settings"
                  ? "qm-selected"
                  : "text-muted-foreground qm-hover"
              }`}
            >
              <Settings className="h-5 w-5" />
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("novel.nav.settings")}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              onClick={() => {
                setSearchPanelOpen(false)
                onSwitchProject()
              }}
              className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground"
            >
              <ArrowLeftRight className="h-5 w-5" />
            </TooltipTrigger>
            <TooltipContent side="right">{t("nav.switchProject")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}
