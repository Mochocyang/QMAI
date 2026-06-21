import {
  FileText, FolderOpen, Search, Network, Brain, Settings, ArrowLeftRight, Sun, Moon, Monitor, Trash2, Sparkles, LayoutDashboard, BookOpen, CircleHelp,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useTranslation } from "react-i18next"
import logoImg from "@/assets/QM-LOGO.png"
import type { WikiState } from "@/stores/wiki-store"
import { saveTheme } from "@/lib/project-store"
import { openExternalUrl } from "@/lib/open-external-url"

type NavView = WikiState["activeView"]

const SEARCH_NAV_ITEM: { view: NavView; icon: typeof FileText; labelKey: string; novelLabelKey: string } = {
  view: "search",
  icon: Search,
  labelKey: "nav.search",
  novelLabelKey: "novel.nav.search",
}

// 功能使用说明文档链接
const USAGE_GUIDE_URLS: Record<string, string> = {
  wiki: "https://tcnk9ik08e1c.feishu.cn/wiki/AOkuw8KtCixoVqko4gpc8rYGnNc?from=from_copylink",
  sources: "https://tcnk9ik08e1c.feishu.cn/wiki/CtUhwqUUBiQhOZk6OcHcc4uHnDd?from=from_copylink",
  graph: "https://tcnk9ik08e1c.feishu.cn/wiki/Yrb6wfFzqiFy8akW4xAcTz3EnKh?from=from_copylink",
  lint: "https://tcnk9ik08e1c.feishu.cn/wiki/SMrtwpJdsi4H5EkP0CicfsOhnvf?from=from_copylink",
  soul: "https://tcnk9ik08e1c.feishu.cn/wiki/Az3owqt2kiDxBbkls0Gc3K7ZnNc?from=from_copylink",
  reviewCenter: "https://tcnk9ik08e1c.feishu.cn/wiki/Tfp8w6hNWinb2okPvvEc3veZnZf?from=from_copylink",
  settings: "https://tcnk9ik08e1c.feishu.cn/wiki/H8F7wRVqeifGDakS7jXcSkO4nlg?from=from_copylink",
}

const NAV_ITEMS: { view: NavView; icon: typeof FileText; labelKey: string; novelLabelKey: string }[] = [
  { view: "wiki", icon: FileText, labelKey: "nav.wiki", novelLabelKey: "novel.nav.wiki" },
  { view: "sources", icon: FolderOpen, labelKey: "nav.sources", novelLabelKey: "novel.nav.sources" },
  { view: "graph", icon: Network, labelKey: "nav.graph", novelLabelKey: "novel.nav.graph" },
  { view: "lint", icon: Brain, labelKey: "nav.lint", novelLabelKey: "novel.nav.lint" },
  { view: "soul", icon: Sparkles, labelKey: "nav.soul", novelLabelKey: "novel.nav.soul" },
  { view: "bookAnalysis", icon: BookOpen, labelKey: "nav.dismantling", novelLabelKey: "novel.nav.dismantling" },
  { view: "reviewCenter", icon: LayoutDashboard, labelKey: "nav.reviewCenter", novelLabelKey: "novel.nav.reviewCenter" },
]

interface IconSidebarProps {
  onToggleSidebar?: () => void
  onOpenSidebar?: () => void
  onSwitchProject: () => void
}

export function IconSidebar({ onToggleSidebar, onOpenSidebar, onSwitchProject }: IconSidebarProps) {
  const { t } = useTranslation()
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSearchPanelOpen = useWikiStore((s) => s.setSearchPanelOpen)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const novelMode = useWikiStore((s) => s.novelMode)
  const theme = useWikiStore((s) => s.theme)
  const setTheme = useWikiStore((s) => s.setTheme)
  const pendingCount = useReviewStore((s) => s.items.filter((i) => !i.resolved).length)

  const handleCycleTheme = () => {
    const themes: ("light" | "dark" | "deep-blue")[] = ["light", "dark", "deep-blue"]
    const currentIndex = themes.indexOf(theme)
    const nextIndex = (currentIndex + 1) % themes.length
    const nextTheme = themes[nextIndex]
    
    setTheme(nextTheme)
    saveTheme(nextTheme)
    
    // 更新 html 类
    document.documentElement.classList.remove("dark", "deep-blue")
    if (nextTheme === "dark") {
      document.documentElement.classList.add("dark")
    } else if (nextTheme === "deep-blue") {
      document.documentElement.classList.add("deep-blue")
    }
  }

  const getThemeIcon = () => {
    switch (theme) {
      case "light": return <Sun className="h-5 w-5" />
      case "dark": return <Moon className="h-5 w-5" />
      case "deep-blue": return <Monitor className="h-5 w-5" />
      default: return <Sun className="h-5 w-5" />
    }
  }

  const getThemeTooltip = () => {
    switch (theme) {
      case "light": return t("theme.toDark")
      case "dark": return t("theme.toDeepBlue")
      case "deep-blue": return t("theme.toLight")
      default: return t("theme.switch")
    }
  }

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
      novelMode &&
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
          {NAV_ITEMS.map(({ view, icon: Icon, labelKey, novelLabelKey }) => (
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
              </TooltipTrigger>
              <TooltipContent side="right" className="flex items-center gap-2">
                <span>
                  {t(novelMode ? novelLabelKey : labelKey)}
                  {view === "reviewCenter" && pendingCount > 0 && ` (${pendingCount})`}
                </span>
                {USAGE_GUIDE_URLS[view] && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void openExternalUrl(USAGE_GUIDE_URLS[view])
                    }}
                    className="flex items-center justify-center text-muted-foreground transition-colors hover:text-primary"
                    title={t("iconSidebar.usageGuide")}
                  >
                    <CircleHelp className="h-3.5 w-3.5" />
                  </button>
                )}
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
              {t(novelMode ? SEARCH_NAV_ITEM.novelLabelKey : SEARCH_NAV_ITEM.labelKey)}
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
          {/* Theme toggle */}
          <Tooltip>
            <TooltipTrigger
              onClick={handleCycleTheme}
              className="relative flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground"
            >
              {getThemeIcon()}
            </TooltipTrigger>
            <TooltipContent side="right">
              {getThemeTooltip()}
            </TooltipContent>
          </Tooltip>
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
            <TooltipContent side="right" className="flex items-center gap-2">
              <span>{t(novelMode ? "novel.nav.settings" : "nav.settings")}</span>
              {USAGE_GUIDE_URLS.settings && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void openExternalUrl(USAGE_GUIDE_URLS.settings)
                  }}
                  className="flex items-center justify-center text-muted-foreground transition-colors hover:text-primary"
                  title={t("iconSidebar.usageGuide")}
                >
                  <CircleHelp className="h-3.5 w-3.5" />
                </button>
              )}
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
