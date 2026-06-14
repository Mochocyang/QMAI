import { useState, useEffect } from "react"
import {
  FileText, FolderOpen, Search, Network, Brain, Settings, ArrowLeftRight, Sun, Moon, Monitor, Trash2, Sparkles, LayoutDashboard, BookOpen,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useTranslation } from "react-i18next"
import logoImg from "@/assets/QM-LOGO.png"
import type { WikiState } from "@/stores/wiki-store"
import { saveTheme } from "@/lib/project-store"

type NavView = WikiState["activeView"]

const SEARCH_NAV_ITEM: { view: NavView; icon: typeof FileText; labelKey: string; novelLabelKey: string } = {
  view: "search",
  icon: Search,
  labelKey: "nav.search",
  novelLabelKey: "novel.nav.search",
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

  // Model connection status check
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const [modelStatus, setModelStatus] = useState<"connected" | "checking" | "disconnected">("checking")
  useEffect(() => {
    const checkModel = async () => {
      try {
        const { hasUsableLlm } = await import("@/lib/has-usable-llm")
        if (!hasUsableLlm(llmConfig)) {
          setModelStatus("disconnected")
          return
        }
        // Build the models endpoint based on provider
        const { getHttpFetch } = await import("@/lib/tauri-fetch")
        const httpFetch = await getHttpFetch()
        let modelsUrl = ""
        if (llmConfig.provider === "ollama") {
          const base = (llmConfig.ollamaUrl || "http://127.0.0.1:11434").replace(/\/+$/, "")
          modelsUrl = `${base}/api/tags`
        } else if (llmConfig.provider === "custom" || llmConfig.provider === "minimax") {
          // customEndpoint 可能是 "/v1" 或 "/v1/chat/completions"，去掉 /chat/completions 保留 /v1
          const base = (llmConfig.customEndpoint || "").replace(/\/+$/, "").replace(/\/chat\/completions$/i, "")
          if (!base) { setModelStatus("disconnected"); return }
          modelsUrl = `${base}/models`
        } else if (llmConfig.provider === "openai") {
          modelsUrl = "https://api.openai.com/v1/models"
        } else if (llmConfig.provider === "anthropic") {
          // Anthropic 没有 /models 端点，配置有 key 就认为连接正常
          setModelStatus("connected")
          return
        } else {
          // claude-code, codex-cli etc. — assume connected if hasUsableLlm
          setModelStatus("connected")
          return
        }
        const headers: Record<string, string> = {}
        if (llmConfig.apiKey) headers["Authorization"] = `Bearer ${llmConfig.apiKey}`
        const response = await httpFetch(modelsUrl, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(8000),
        })
        setModelStatus(response.ok ? "connected" : "disconnected")
      } catch {
        setModelStatus("disconnected")
      }
    }
    checkModel()
    const interval = setInterval(checkModel, 60000)
    return () => clearInterval(interval)
  }, [llmConfig])

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
              <TooltipContent side="right">
                {t(novelMode ? novelLabelKey : labelKey)}
                {view === "reviewCenter" && pendingCount > 0 && ` (${pendingCount})`}
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
          {/* Model connection status indicator */}
          <Tooltip>
            <TooltipTrigger className="flex h-6 w-6 items-center justify-center">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  modelStatus === "connected" ? "bg-emerald-500" :
                  modelStatus === "checking" ? "bg-amber-400 animate-pulse" :
                  "bg-red-500"
                }`}
              />
            </TooltipTrigger>
            <TooltipContent side="right">
              {modelStatus === "connected" && t("iconSidebar.modelConnected")}
              {modelStatus === "checking" && t("iconSidebar.modelChecking")}
              {modelStatus === "disconnected" && t("iconSidebar.modelDisconnected")}
            </TooltipContent>
          </Tooltip>
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
            <TooltipContent side="right">
              {t(novelMode ? "novel.nav.settings" : "nav.settings")}
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
