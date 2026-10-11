import { useMemo } from "react"
import {
  FileText, FolderOpen, Search, Network, Brain, ArrowLeftRight, Trash2, Sparkles, LayoutDashboard, BookOpen, Drama, WandSparkles,
} from "lucide-react"
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
import { BrandLogo } from "@/components/brand-logo"
import type { WikiState } from "@/stores/wiki-store"
import { isChapterPathInProject } from "@/lib/path-utils"
import {
  isNavItemActive,
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

interface SortableNavButtonProps {
  item: ConfigurableNavItem
  activeView: NavView
  pendingCount: number
  label: string
  onClick: (item: ConfigurableNavItem) => void
}

/*
 * 「技能库 tab 的内部视图要折算到技能库图标上、保持高亮」这条判定住在
 * `@/lib/sidebar-nav-preferences` 的 `isNavItemActive` / `FOLDED_SKILL_LIBRARY_VIEWS`：
 * 那是个不依赖 React 的模块，所以它能被**行为测试**（本文件的测试只读源码文本，
 * 跑不了组件）。见该模块里关于 `skillFavorites` 例外与「测试守而非编译守」的说明。
 */

function SortableNavButton({ item, activeView, pendingCount, label, onClick }: SortableNavButtonProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const Icon = item.icon
  /*
   * 合并说明：采用本分支的重构（判定抽到 `isNavItemActive`，可被行为测试），
   * 但 `main` 上「人物 Skill」让 `personaSkillLibrary` 折算到技能库图标的
   * 既有行为必须保留 —— 已把它并入 `FOLDED_SKILL_LIBRARY_VIEWS`，
   * 否则点开人物 Skill 页时侧边栏会没有任何图标高亮。
   */
  const isActive = isNavItemActive(item.view, activeView)
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
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] font-bold text-primary-foreground">
            {pendingCount > 99 ? "99+" : pendingCount}
          </span>
        )}
        {item.view === "storySimulation" && (
          <span className="absolute -right-1 -top-0.5 flex h-3.5 items-center justify-center rounded bg-amber-500 px-1 text-[0.5625rem] font-bold leading-none text-white">
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
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const sidebarNavConfig = useWikiStore((s) => s.sidebarNavConfig)
  const setSidebarNavConfig = useWikiStore((s) => s.setSidebarNavConfig)
  const pendingCount = useReviewStore((s) => s.items.filter((i) => !i.resolved).length)

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

  const handleNavClick = (view: NavView) => {
    setSearchPanelOpen(false)
    const normalizedSelectedFile = selectedFile?.replace(/\\/g, "/") ?? ""

    // 离开wiki视图时，保存当前章节路径到sessionStorage，以便切回时恢复
    if (
      activeView === "wiki" &&
      view !== "wiki" &&
      project &&
      selectedFile &&
      isChapterPathInProject(selectedFile, project.path)
    ) {
      try {
        sessionStorage.setItem("lk-last-chapter-path", selectedFile)
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
      if (savedPath && project && isChapterPathInProject(savedPath, project.path)) {
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
          <BrandLogo
            title={t("iconSidebar.logoAlt")}
            className="h-6 w-6 text-brand-600"
          />
        </button>
        {/* Top: configurable feature entries */}
        <div className="flex flex-1 flex-col items-center gap-1.5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={visibleNavIds} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col items-center gap-1.5">
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
        {/*
          Bottom: 切换小说。
          「外观 / 设置」已移到各侧栏面板（章节/大纲列表等）的底部，
          见 components/layout/sidebar-bottom-actions.tsx。
        */}
        <div className="flex flex-col items-center gap-1.5 pb-1">
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
