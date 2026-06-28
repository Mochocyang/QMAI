import { useState, useRef, useEffect } from "react"
import {
  FileText, FolderOpen, Search, Network, Brain, Settings, ArrowLeftRight, Sun, Moon, Eye, SunMoon, Check, Trash2, Sparkles, LayoutDashboard, BookOpen, Drama,
} from "lucide-react"
import { createPortal } from "react-dom"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useTranslation } from "react-i18next"
import logoImg from "@/assets/QM-LOGO.png"
import type { WikiState } from "@/stores/wiki-store"
import { saveTheme } from "@/lib/project-store"
import { applyTheme, type ThemeMode } from "@/lib/theme-utils"

type NavView = WikiState["activeView"]

const SEARCH_NAV_ITEM: { view: NavView; icon: typeof FileText; labelKey: string } = {
  view: "search",
  icon: Search,
  labelKey: "novel.nav.search",
}

const NAV_ITEMS: { view: NavView; icon: typeof FileText; labelKey: string }[] = [
  { view: "wiki", icon: FileText, labelKey: "novel.nav.wiki" },
  { view: "sources", icon: FolderOpen, labelKey: "novel.nav.sources" },
  { view: "graph", icon: Network, labelKey: "novel.nav.graph" },
  { view: "lint", icon: Brain, labelKey: "novel.nav.lint" },
  { view: "soul", icon: Sparkles, labelKey: "novel.nav.soul" },
  { view: "bookAnalysis", icon: BookOpen, labelKey: "novel.nav.dismantling" },
  { view: "reviewCenter", icon: LayoutDashboard, labelKey: "novel.nav.reviewCenter" },
  { view: "storySimulation", icon: Drama, labelKey: "novel.nav.storySimulation" },
]

interface IconSidebarProps {
  onToggleSidebar?: () => void
  onOpenSidebar?: () => void
  onSwitchProject: () => void
}

const THEME_OPTIONS: { value: ThemeMode; icon: typeof Sun; labelKey: string }[] = [
  { value: "light", icon: Sun, labelKey: "theme.light" },
  { value: "dark", icon: Moon, labelKey: "theme.dark" },
  { value: "deep-blue", icon: Eye, labelKey: "theme.deepBlue" },
  { value: "system", icon: SunMoon, labelKey: "theme.system" },
]

export function IconSidebar({ onToggleSidebar, onOpenSidebar, onSwitchProject }: IconSidebarProps) {
  const { t } = useTranslation()
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSearchPanelOpen = useWikiStore((s) => s.setSearchPanelOpen)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const theme = useWikiStore((s) => s.theme)
  const setTheme = useWikiStore((s) => s.setTheme)
  const pendingCount = useReviewStore((s) => s.items.filter((i) => !i.resolved).length)

  // 主题下拉框状态
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const themeTriggerRef = useRef<HTMLButtonElement>(null)
  const [themeMenuStyle, setThemeMenuStyle] = useState<{ left: number; top: number } | null>(null)

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
    if (
      view === "wiki" &&
      normalizedSelectedFile &&
      !normalizedSelectedFile.includes("/wiki/chapters/")
    ) {
      setSelectedFile(null)
    }
    if (
      view === "sources" &&
      normalizedSelectedFile &&
      !normalizedSelectedFile.includes("/wiki/outlines/")
    ) {
      setSelectedFile(null)
    }
    setActiveView(view)
  }

  const handleSearchClick = () => {
    setSearchPanelOpen(false)
    setActiveView("search")
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
        {/* Top: main nav items */}
        <div className="flex flex-1 flex-col items-center gap-1">
          {NAV_ITEMS.map(({ view, icon: Icon, labelKey }) => (
            <Tooltip key={view}>
              <TooltipTrigger
                onClick={() => handleNavClick(view)}
                className={`relative flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                  activeView === view
                    ? "qm-selected"
                    : "text-muted-foreground qm-hover"
                }`}
              >
                <Icon className="h-5 w-5" />
                {view === "reviewCenter" && pendingCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {pendingCount > 99 ? "99+" : pendingCount}
                  </span>
                )}
                {view === "storySimulation" && (
                  <span className="absolute -right-1 -top-0.5 flex h-3.5 items-center justify-center rounded bg-amber-500 px-1 text-[9px] font-bold leading-none text-white">
                    BETA
                  </span>
                )}
              </TooltipTrigger>
              <TooltipContent side="right">
                {t(labelKey)}
                {view === "reviewCenter" && pendingCount > 0 && ` (${pendingCount})`}
                {view === "storySimulation" && " (测试版)"}
              </TooltipContent>
            </Tooltip>
          ))}
          <Tooltip>
            <TooltipTrigger
              onClick={handleSearchClick}
              className={`relative flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                activeView === "search"
                  ? "qm-selected"
                  : "text-muted-foreground qm-hover"
              }`}
            >
              <Search className="h-5 w-5" />
            </TooltipTrigger>
            <TooltipContent side="right">
              {t(SEARCH_NAV_ITEM.labelKey)}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              onClick={() => {
                setSearchPanelOpen(false)
                setActiveView("trash")
                onOpenSidebar?.()
              }}
              className={`relative flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                activeView === "trash"
                  ? "qm-selected"
                  : "text-muted-foreground qm-hover"
              }`}
            >
              <Trash2 className="h-5 w-5" />
            </TooltipTrigger>
            <TooltipContent side="right">{t("nav.trash")}</TooltipContent>
          </Tooltip>
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
