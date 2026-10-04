import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { BookOpen, Brain, Check, Grid2X2, GitBranch, HeartHandshake, History, Library, Minus, Moon, PanelLeft, Search, Settings, ShieldCheck, Sparkles, Square, Trash2, X } from "lucide-react"
import logoImg from "@/assets/QM-LOGO.png"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useWikiStore, type WikiState } from "@/stores/wiki-store"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import { ContentArea } from "@/components/layout/content-area"
import { SidebarPanel } from "@/components/layout/sidebar-panel"
import { RawSourcesSection } from "@/components/layout/knowledge-tree"
import { registerUiTestProject } from "@/lib/ui-test-library"
import { ErrorBoundary } from "@/components/error-boundary"
import { refreshProjectFileTree } from "@/lib/project-file-tree-refresh"
import { isMacOS, isTauri } from "@/lib/platform"
import { CreateProjectDialog } from "@/components/project/create-project-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { applyTheme } from "@/lib/theme-utils"
import { saveTheme } from "@/lib/project-store"
import { UI_TEST_SKINS, readUiTestAiHintDismissed, readUiTestDirectoryHintDismissed, readUiTestSkin, writeUiTestAiHintDismissed, writeUiTestDirectoryHintDismissed, writeUiTestSkin, type UiTestSkin } from "@/lib/ui-test"
import { readUiTestWorkspacePreference as readPreference, uiTestWorkspaceKey as preferenceKey } from "@/lib/ui-test-workspace-preferences"
import { availablePrimaryNav, movePrimaryNav, normalizePrimaryNav, PRIMARY_NAV_LONG_PRESS_MS, readPrimaryNav, writePrimaryNav, type PrimaryNavItem, type PrimaryNavView } from "@/lib/ui-test-primary-nav"
import { normalizePath } from "@/lib/path-utils"
import { getUiTestDocumentPath, UI_TEST_AI_DEFAULT_WIDTH } from "@/lib/ui-test-layout"
import type { WikiProject } from "@/types/wiki"
import { UiTestShelf } from "./ui-test-shelf"
import { ContactSupportSection } from "@/components/settings/sections/contact-support-section"
import { confirmModelDraftLeave } from "./models/model-draft-guard"
import { MacTrafficLights } from "./mac-traffic-lights"
import "./ui-test.css"

const UiTestWorkspace = lazy(async () => ({ default: (await import("./ui-test-workspace")).UiTestWorkspace }))
type NavView = WikiState["activeView"]
interface UiTestShellProps {
  project: WikiProject | null
  onCreateProject: () => void
  onOpenProject: () => void
  onSelectProject: (project: WikiProject) => void
  onSwitchProject: () => void
  onProjectOpened: (project: WikiProject) => void
}
const TOOL_GROUPS = [
  [ { view: "lint", label: "记忆中心", icon: Brain }, { view: "graph", label: "小说图谱", icon: GitBranch }, { view: "soul", label: "灵魂", icon: Sparkles }, { view: "skillLibrary", label: "技能库", icon: Sparkles }, { view: "bookAnalysis", label: "拆书库", icon: Library } ],
  [ { view: "storySimulation", label: "剧情推演室 · 测试版", icon: BookOpen }, { view: "reviewCenter", label: "审查中心", icon: ShieldCheck }, { view: "search", label: "剧情搜索", icon: Search } ],
  [ { view: "trash", label: "回收站", icon: Trash2 }, { view: "settings", label: "设置", icon: Settings } ],
] as const
function menuKeyboard(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
  event.preventDefault()
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)'))
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
  items[next]?.focus()
}

/**
 * 顶栏「AI 对话」专用图标：圆角对话气泡内嵌 AI 字样。
 * 全部笔画使用 currentColor，跟随按钮文字色，因此会自动适配静水/纸间/星夜三种皮肤。
 */
function AiChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M7 4.4H17A3.6 3.6 0 0 1 20.6 8v6A3.6 3.6 0 0 1 17 17.6h-3.4l-2.2 3.6-2-3.6H7A3.6 3.6 0 0 1 3.4 14V8A3.6 3.6 0 0 1 7 4.4Z" />
      <path d="M9 13.3 11 8.9l2 4.4" />
      <path d="M9.9 11.6h2.2" />
      <path d="M15.1 8.9v4.4" />
    </svg>
  )
}

export function UiTestShell({ project, onOpenProject, onSelectProject, onSwitchProject, onProjectOpened }: UiTestShellProps) {
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setTheme = useWikiStore((s) => s.setTheme)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const chatExpanded = useWikiStore((s) => s.chatExpanded)
  const setChatExpanded = useWikiStore((s) => s.setChatExpanded)
  const outlineExpanded = useOutlineGenerationStore((s) => s.panelOpen)
  const setOutlineExpanded = useOutlineGenerationStore((s) => s.setPanelOpen)
  const [skin, setSkin] = useState<UiTestSkin>(() => readUiTestSkin())
  const [directoryHintDismissed, setDirectoryHintDismissed] = useState(() => readUiTestDirectoryHintDismissed())
  const [aiHintDismissed, setAiHintDismissed] = useState(() => readUiTestAiHintDismissed())
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showGlobalSettings, setShowGlobalSettings] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  const [showContact, setShowContact] = useState(false)
  const [libraryError, setLibraryError] = useState("")
  const [toolOpen, setToolOpen] = useState(false)
  const [skinOpen, setSkinOpen] = useState(false)
  const [primaryNav, setPrimaryNav] = useState<PrimaryNavItem[]>(() => readPrimaryNav())
  const [navMenu, setNavMenu] = useState<PrimaryNavView | null>(null)
  const [navMenuSection, setNavMenuSection] = useState<"move" | "replace" | "add" | null>(null)
  const navMenuCloseTimer = useRef<number | null>(null)
  const navMenuRef = useRef<HTMLDivElement | null>(null)
  const [navMenuAlign, setNavMenuAlign] = useState<"left" | "right">("left")
  const navPressRef = useRef<{ view: PrimaryNavView; x: number; y: number; timer: number } | null>(null)
  const [windowFilled, setWindowFilled] = useState(false)
  const [windowFocused, setWindowFocused] = useState(() => document.hasFocus())
  const macOS = isMacOS()
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth)
  const [preference, setPreference] = useState(() => readPreference(project?.id))
  const preferenceProject = useRef(project?.id)
  const toolsRef = useRef<HTMLDivElement>(null)
  const skinsRef = useRef<HTMLDivElement>(null)
  const toolRef = useRef<HTMLButtonElement>(null)
  const skinRef = useRef<HTMLButtonElement>(null)
  const directoryRef = useRef<HTMLButtonElement>(null)
  const cancelImportRef = useRef<(() => void) | null>(null)
  const writing = Boolean(project && (activeView === "wiki" || activeView === "sources"))
  const assistantOpen = activeView === "sources" ? outlineExpanded : chatExpanded
  const requestedWidth = Number.isFinite(preference.aiWidth) ? preference.aiWidth! : UI_TEST_AI_DEFAULT_WIDTH
  // 技能库、灵魂改为整窗卡片画廊，不再占用左侧目录栏。
  const fullWindowViews = activeView === "skillLibrary" || activeView === "writingSkillLibrary" || activeView === "skillFavorites" || activeView === "soul"
  const hasDirectory = Boolean(project && activeView !== "settings" && !fullWindowViews)
  const sidebarPreference = preference.directory?.[activeView] ?? activeView !== "graph"
  const sidebarVisible = hasDirectory && sidebarPreference
  const showShelf = !project && !showGlobalSettings

  useEffect(() => {
    const nextTheme = skin === "xing" ? "dark" : "light"
    document.documentElement.dataset.uiTestSkin = skin
    applyTheme(nextTheme); setTheme(nextTheme); writeUiTestSkin(skin)
    void saveTheme(nextTheme).catch(() => undefined)
    return () => { delete document.documentElement.dataset.uiTestSkin }
  }, [skin, setTheme])
  useEffect(() => {
    const onSkinChange = (event: Event) => {
      const next = (event as CustomEvent).detail
      if (next === "jing" || next === "zhi" || next === "xing") setSkin(next)
    }
    window.addEventListener("qmai-ui-test-skin-change", onSkinChange)
    return () => window.removeEventListener("qmai-ui-test-skin-change", onSkinChange)
  }, [])
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  useEffect(() => {
    const onFocus = () => setWindowFocused(true)
    const onBlur = () => setWindowFocused(false)
    window.addEventListener("focus", onFocus)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("blur", onBlur)
    }
  }, [])
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow()
      if (isMacOS()) {
        // 保留系统圆角。setDecorations(false) 会把窗口改成直角，再叠 CSS 圆角就是两层。
        const { invoke } = await import("@tauri-apps/api/core")
        await invoke("restore_macos_window_frame")
      } else {
        await win.setDecorations(false)
        await win.setShadow(false)
      }
      const syncWindowFilled = async () => {
        const [maximized, fullscreen] = await Promise.all([win.isMaximized(), win.isFullscreen()])
        if (!cancelled) setWindowFilled(maximized || fullscreen)
      }
      await syncWindowFilled()
      unlisten = await win.onResized(() => { void syncWindowFilled() })
    }).catch((err) => console.warn("设置测试版窗口外观失败：", err))
    return () => { cancelled = true; unlisten?.() }
  }, [])
  useEffect(() => {
    if (preferenceProject.current !== project?.id) {
      preferenceProject.current = project?.id
      setPreference(readPreference(project?.id)); setShowGlobalSettings(false)
    }
    if (!project) return
    try { registerUiTestProject(project); setLibraryError("") } catch (error) { setLibraryError(error instanceof Error ? error.message : "书架索引保存失败，小说仍可正常打开。") }
    void refreshProjectFileTree(project.path, { projectId: project.id, clearDisplayTreeFirst: false })
  }, [project?.id, project?.path])
  useEffect(() => {
    if (preferenceProject.current !== project?.id) return
    try { localStorage.setItem(preferenceKey(project?.id), JSON.stringify(preference)) } catch { /* 界面偏好写入失败不影响正文。 */ }
  }, [preference, project?.id])
  useEffect(() => {
    if (!writing || !selectedFile || !project) return
    const view = activeView === "sources" ? "sources" : "wiki"
    const validPath = getUiTestDocumentPath(project.path, selectedFile, view)
    if (!validPath) return
    const relativePath = validPath.slice(normalizePath(project.path).replace(/\/+$/, "").length + 1)
    setPreference((previous) => previous.files?.[view] === relativePath ? previous : { ...previous, files: { ...previous.files, [view]: relativePath } })
  }, [selectedFile, activeView, project?.id, writing])
  useEffect(() => {
    if (!project || preferenceProject.current !== project.id || !["wiki", "sources", "soul"].includes(activeView)) return
    const view = activeView as "wiki" | "sources" | "soul"
    setPreference(previous => {
      const assistant = view === "sources" ? outlineExpanded : chatExpanded
      if (previous.lastView === view && (view === "soul" || previous.assistant?.[view] === assistant)) return previous
      return { ...previous, lastView: view, ...(view === "soul" ? {} : { assistant: { ...previous.assistant, [view]: assistant } }) }
    })
  }, [activeView, chatExpanded, outlineExpanded, project?.id])
  useEffect(() => {
    if (!toolOpen && !skinOpen) return
    const menu = toolOpen ? toolsRef.current : skinsRef.current
    menu?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus()
    const outside = (event: MouseEvent) => {
      if (toolsRef.current?.contains(event.target as Node) || skinsRef.current?.contains(event.target as Node) || (event.target as HTMLElement).closest(".ui-test-nav-slot")) return
      setToolOpen(false); setSkinOpen(false); setNavMenu(null)
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault(); setToolOpen(false); setSkinOpen(false); setNavMenu(null)
      ;(toolOpen ? toolRef : skinRef).current?.focus()
    }
    document.addEventListener("mousedown", outside); document.addEventListener("keydown", escape)
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape) }
  }, [toolOpen, skinOpen])
  useEffect(() => {
    if (!navMenu) return
    if (!navMenuSection) navMenuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus()
    const outside = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest(".ui-test-nav-slot")) return
      setNavMenu(null)
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setNavMenu(null)
    }
    document.addEventListener("mousedown", outside)
    document.addEventListener("keydown", escape)
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape) }
  }, [navMenu, navMenuSection])

  const minimizeWindow = () => { if (isTauri()) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().minimize()).catch(() => undefined) }
  const toggleMaximizeWindow = () => { if (isTauri()) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize()).catch(() => undefined) }
  const closeWindow = () => { if (isTauri()) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().close()).catch(() => undefined) }
  const chooseSkin = (next: UiTestSkin) => { setSkin(next); setSkinOpen(false); skinRef.current?.focus() }
  const toggleDirectory = () => setPreference((previous) => ({ ...previous, directory: { ...previous.directory, [activeView]: !sidebarVisible } }))
  const updatePrimaryNav = (items: PrimaryNavItem[]) => {
    const next = normalizePrimaryNav(items.map((item) => item.view))
    setPrimaryNav(next)
    writePrimaryNav(next)
  }
  const showNavSection = (section: "move" | "replace" | "add") => {
    if (navMenuCloseTimer.current !== null) window.clearTimeout(navMenuCloseTimer.current)
    setNavMenuSection(section)
  }
  const hideNavSectionSoon = () => {
    if (navMenuCloseTimer.current !== null) window.clearTimeout(navMenuCloseTimer.current)
    navMenuCloseTimer.current = window.setTimeout(() => setNavMenuSection(null), 180)
  }
  const openNavMenu = (event: { preventDefault(): void; clientX: number }, view: PrimaryNavView) => {
    event.preventDefault()
    setNavMenuAlign(window.innerWidth - event.clientX < 220 ? "right" : "left")
    setNavMenuSection(null)
    setNavMenu(view)
    setToolOpen(false)
    setSkinOpen(false)
  }
  const pressNav = (event: React.PointerEvent<HTMLElement>, view: PrimaryNavView) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    window.clearTimeout(navPressRef.current?.timer)
    const point = { clientX: event.clientX, preventDefault() {} }
    const timer = window.setTimeout(() => openNavMenu(point, view), PRIMARY_NAV_LONG_PRESS_MS)
    navPressRef.current = { view, x: event.clientX, y: event.clientY, timer }
  }
  const moveNavPress = (event: React.PointerEvent<HTMLElement>) => {
    const press = navPressRef.current
    if (!press || Math.hypot(event.clientX - press.x, event.clientY - press.y) < 8) return
    window.clearTimeout(press.timer)
    navPressRef.current = null
  }
  const releaseNavPress = () => {
    window.clearTimeout(navPressRef.current?.timer)
    navPressRef.current = null
  }
  const removePrimaryNav = async (view: PrimaryNavView) => {
    const remaining = primaryNav.filter((item) => item.view !== view)
    if (remaining.length === 0) return
    updatePrimaryNav(remaining)
    setNavMenu(null)
    if (activeView === view) await navigate(remaining[0].view)
  }
  const replacePrimaryNav = async (current: PrimaryNavView, next: PrimaryNavItem) => {
    if (!primaryNav.some((item) => item.view === current) || primaryNav.some((item) => item.view === next.view)) return
    const replaced = primaryNav.map((item) => item.view === current ? next : item)
    if (project && activeView === current && !(await confirmModelDraftLeave())) return
    if (project && activeView === current) await navigate(next.view)
    if (useWikiStore.getState().activeView !== (project && activeView === current ? next.view : activeView)) return
    updatePrimaryNav(replaced)
    setNavMenu(null)
  }
  const navigate = async (view: NavView) => {
    setToolOpen(false); setSkinOpen(false)
    if (!project && view !== "settings") return
    if (view === "settings") setShowGlobalSettings(true)
    if (activeView === view) return
    if (activeView === "settings" && !(await confirmModelDraftLeave())) return
    setActiveView(view)
    // 仍由旧 store 决定能否离开有未保存草稿的功能，不能绕过其保护。
    if (useWikiStore.getState().activeView !== view) return
    if (view === "sources" || view === "wiki") {
      const kind = view === "sources" ? "/outlines/" : "/chapters/"
      const current = useWikiStore.getState().selectedFile
      if (!(current ? normalizePath(current).includes(kind) : false)) useWikiStore.getState().setSelectedFile(project ? getUiTestDocumentPath(project.path, preference.files?.[view], view) : null)
    }
  }
  const returnToShelf = async () => {
    if (!showShelf && activeView === "settings" && !(await confirmModelDraftLeave())) return
    setShowGlobalSettings(false)
    if (project) onSwitchProject()
  }
  const handleCreatedProject = async (created: WikiProject) => { await onProjectOpened(created); setActiveView("sources") }

  return (
    <div className="ui-test-root" data-skin={skin} data-view={showShelf ? "shelf" : activeView} data-platform={macOS ? "macos" : undefined} data-window-focused={windowFocused ? "true" : "false"} data-window-filled={windowFilled ? "true" : undefined} onContextMenu={(event) => event.preventDefault()}>
      {!windowFilled && (["top", "right", "bottom", "left", "nw", "ne", "sw", "se"] as const).map((edge) => <div key={edge} className={`ui-test-resize-edge ${edge}${edge.length === 2 ? " corner" : ""}`} data-resize-edge={edge} onPointerDown={(event) => {
        if (event.button !== 0 || !isTauri()) return
        event.preventDefault()
        const direction = ({ top: "North", right: "East", bottom: "South", left: "West", nw: "NorthWest", ne: "NorthEast", sw: "SouthWest", se: "SouthEast" } as const)[edge]
        void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().startResizeDragging(direction))
      }} />)}
      <div className="ui-test-app">
        <header className="ui-test-header" data-tauri-drag-region="deep">
          {macOS && <MacTrafficLights onClose={closeWindow} onMinimize={minimizeWindow} onZoom={toggleMaximizeWindow} />}
          <div className="ui-test-brand"><div className="ui-test-header-hint-anchor">{hasDirectory ? <button ref={directoryRef} type="button" className="ui-test-brand-logo-btn" aria-label={sidebarVisible ? "收起目录" : "展开目录"} aria-expanded={sidebarVisible} aria-controls="ui-test-directory" title={sidebarVisible ? "收起目录" : "展开目录"} onClick={toggleDirectory}><img className="ui-test-brand-logo" src={logoImg} alt="" /><PanelLeft className="ui-test-brand-logo-icon" aria-hidden="true" /></button> : <img className="ui-test-brand-logo" src={logoImg} alt="" />}{hasDirectory && !directoryHintDismissed && <div className="ui-test-header-hint" role="status"><p>目录已移到左上角：点击这个图标即可显示或隐藏目录。</p><div className="ui-test-header-hint-actions"><button type="button" className="ui-test-header-hint-dismiss" onClick={() => { writeUiTestDirectoryHintDismissed(); setDirectoryHintDismissed(true) }}>知道了</button></div></div>}</div><span className="ui-test-brand-name">青幕AI写作</span>
            <button type="button" className="ui-test-crumb" aria-label="返回书架" title="返回书架" onClick={returnToShelf}><BookOpen />书架</button>
            {project && <span className="ui-test-current-book" title={project.name}>{project.name}</span>}
          </div>
          <nav className="ui-test-nav" aria-label="主模块" onContextMenu={(event) => event.preventDefault()}>
            {primaryNav.map((item, index) => <div className="ui-test-nav-slot" key={item.view} onPointerDown={(event) => pressNav(event, item.view)} onPointerMove={moveNavPress} onPointerUp={releaseNavPress} onPointerCancel={releaseNavPress} onContextMenu={(event) => openNavMenu(event, item.view)}>
              <button type="button" disabled={!project} aria-current={project && activeView === item.view ? "page" : undefined} aria-haspopup="menu" className={`ui-test-nav-item${project && activeView === item.view ? " is-active" : ""}`} onClick={() => navigate(item.view)}>{item.label}</button>
              {navMenu === item.view && <div ref={navMenuRef} className={`ui-test-menu-pop ui-test-nav-menu${navMenuAlign === "right" ? " is-right" : ""}`} role="menu" aria-label={`${item.label}功能菜单`} data-tauri-drag-region="false" onKeyDown={menuKeyboard} onMouseLeave={hideNavSectionSoon}>
                <button type="button" role="menuitem" className="ui-test-menu-item" aria-expanded={navMenuSection === "move"} aria-haspopup="menu" onMouseEnter={() => showNavSection("move")} onFocus={() => showNavSection("move")}>移动</button>
                <button type="button" role="menuitem" className="ui-test-menu-item" aria-expanded={navMenuSection === "replace"} aria-haspopup="menu" onMouseEnter={() => showNavSection("replace")} onFocus={() => showNavSection("replace")}>替换为</button>
                <button type="button" role="menuitem" className="ui-test-menu-item" aria-expanded={navMenuSection === "add"} aria-haspopup="menu" disabled={primaryNav.length >= 5 || availablePrimaryNav(primaryNav).length === 0} onMouseEnter={() => showNavSection("add")} onFocus={() => showNavSection("add")}>新增功能</button>
                <button type="button" role="menuitem" className="ui-test-menu-item ui-test-nav-delete" disabled={primaryNav.length <= 1} onMouseEnter={hideNavSectionSoon} onClick={() => void removePrimaryNav(item.view)}>删除</button>
                {navMenuSection && <div className={`ui-test-nav-submenu${navMenuAlign === "right" ? " is-left" : ""}`} role="menu" aria-label={`${item.label}二级菜单`} onMouseEnter={() => showNavSection(navMenuSection)}>
                  {navMenuSection === "move" && <>
                    <button type="button" role="menuitem" className="ui-test-menu-item" disabled={index === 0} onClick={() => { updatePrimaryNav(movePrimaryNav(primaryNav, item.view, -1)); setNavMenu(null) }}>左移</button>
                    <button type="button" role="menuitem" className="ui-test-menu-item" disabled={index === primaryNav.length - 1} onClick={() => { updatePrimaryNav(movePrimaryNav(primaryNav, item.view, 1)); setNavMenu(null) }}>右移</button>
                  </>}
                  {navMenuSection === "replace" && availablePrimaryNav(primaryNav).map((option) => <button key={option.view} type="button" role="menuitem" className="ui-test-menu-item" onClick={() => void replacePrimaryNav(item.view, option)}>{option.label}</button>)}
                  {navMenuSection === "add" && availablePrimaryNav(primaryNav).map((option) => <button key={`add-${option.view}`} type="button" role="menuitem" className="ui-test-menu-item" onClick={() => { updatePrimaryNav([...primaryNav, option]); setNavMenu(null) }}>{option.label}</button>)}
                </div>}
              </div>}
            </div>)}
          </nav>
          <div className="ui-test-actions">
            {writing ? <div className="ui-test-header-hint-anchor"><Tooltip><TooltipTrigger render={<button type="button" className="ui-test-icon-btn" aria-label="AI 对话" aria-expanded={assistantOpen} onClick={() => activeView === "sources" ? setOutlineExpanded(!outlineExpanded) : setChatExpanded(!chatExpanded)}><AiChatIcon /></button>} /><TooltipContent>AI 对话</TooltipContent></Tooltip>{!aiHintDismissed && <div className="ui-test-header-hint is-right" role="status"><p>「AI 对话」改成了图标：点击它即可打开或收起对话栏。</p><div className="ui-test-header-hint-actions"><button type="button" className="ui-test-header-hint-dismiss" onClick={() => { writeUiTestAiHintDismissed(); setAiHintDismissed(true) }}>知道了</button></div></div>}</div> : <>
              <button type="button" className="ui-test-icon-btn" aria-label="剧情搜索" title={project ? "剧情搜索" : "请先打开小说"} disabled={!project} onClick={() => navigate("search")}><Search /></button>
              <button type="button" className="ui-test-icon-btn" aria-label="设置" title="设置" onClick={() => navigate("settings")}><Settings /></button>
            </>}
            <div ref={toolsRef} className="ui-test-menu-anchor">
              <Tooltip>
                <TooltipTrigger render={<button ref={toolRef} type="button" className="ui-test-icon-btn" aria-label="创作工具" aria-haspopup="menu" aria-expanded={toolOpen} onClick={() => { setToolOpen(!toolOpen); setSkinOpen(false) }}><Grid2X2 /></button>} />
                <TooltipContent>创作工具</TooltipContent>
              </Tooltip>
              {toolOpen && <div className="ui-test-menu-pop" role="menu" aria-label="创作工具" data-tauri-drag-region="false" onKeyDown={menuKeyboard}>
                <div className="ui-test-menu-title">创作工具 · {project?.name ?? "未选择小说"}</div>
                {TOOL_GROUPS.map((group, index) => <div className="ui-test-menu-group" key={index}>
                  {group.map(({ view, label, icon: Icon }) => <button key={view} type="button" role="menuitem" className="ui-test-menu-item" disabled={!project && view !== "settings"} onClick={() => navigate(view)}><Icon /><span>{label}</span></button>)}
                </div>)}
              </div>}
            </div>
            <div ref={skinsRef} className="ui-test-menu-anchor">
              <Tooltip>
                <TooltipTrigger render={<button ref={skinRef} type="button" className="ui-test-icon-btn" aria-label="外观" aria-haspopup="menu" aria-expanded={skinOpen} onClick={() => { setSkinOpen(!skinOpen); setToolOpen(false) }}><Moon /></button>} />
                <TooltipContent>外观</TooltipContent>
              </Tooltip>
              {skinOpen && <div className="ui-test-menu-pop ui-test-skin-menu" role="menu" aria-label="外观" data-tauri-drag-region="false" onKeyDown={menuKeyboard}><div className="ui-test-menu-title">外观</div>
                {UI_TEST_SKINS.map(item => <button type="button" role="menuitemradio" aria-checked={skin === item.id} className="ui-test-menu-item" key={item.id} onClick={() => chooseSkin(item.id)}><span className={`ui-test-skin-dot ui-test-skin-dot-${item.id}`} /><span className="ui-test-skin-copy"><span>{item.name}</span><small>{item.hint}</small></span>{skin === item.id && <Check />}</button>)}
              </div>}
            </div>
            <Tooltip>
              <TooltipTrigger render={<button type="button" className="ui-test-icon-btn ui-test-activity-entry" aria-label="后台活动" onClick={() => setShowActivity(true)}><History /></button>} />
              <TooltipContent>后台活动</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={<button type="button" className="ui-test-icon-btn ui-test-activity-entry" aria-label="联系与支持" aria-haspopup="dialog" onClick={() => setShowContact(true)}><HeartHandshake /></button>} />
              <TooltipContent>联系与支持</TooltipContent>
            </Tooltip>
            {!macOS && <div className="ui-test-win-actions">
              <button type="button" className="ui-test-win-btn" aria-label="最小化" title="最小化" onClick={minimizeWindow}><Minus /></button>
              <button type="button" className="ui-test-win-btn" aria-label="最大化或还原" title="最大化或还原" onClick={toggleMaximizeWindow}><Square /></button>
              <button type="button" className="ui-test-win-btn ui-test-win-close" aria-label="关闭窗口" title="关闭窗口" onClick={closeWindow}><X /></button>
            </div>}
          </div>
        </header>
        {libraryError && <p className="ui-test-local-warning" role="alert">{libraryError}</p>}
        <div className="ui-test-workspace">
          {showShelf ? <UiTestShelf onCreateProject={() => setShowCreateDialog(true)} onOpenProject={onOpenProject} onSelectProject={onSelectProject} /> : <>
            {hasDirectory && <aside hidden={!sidebarVisible} id="ui-test-directory" className="ui-test-sidebar" aria-label="工作区目录">
              <div className="ui-test-directory-content"><SidebarPanel onUiTestCloseDirectory={toggleDirectory} onUiTestRegisterCancel={(cancel) => { cancelImportRef.current = cancel }} /></div>
            </aside>}
            <main className="ui-test-main"><ErrorBoundary>
              {writing ? <Suspense fallback={<div className="ui-test-loading">正在打开工作区…</div>}><UiTestWorkspace mode={activeView === "sources" ? "outline" : "chapter"} requestedWidth={requestedWidth} viewportWidth={viewportWidth} onWidthChange={(aiWidth) => setPreference(previous => ({ ...previous, aiWidth }))} /></Suspense> : <ContentArea />}
            </ErrorBoundary></main>
          </>}
        </div>
      </div>
      <CreateProjectDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} onCreated={handleCreatedProject} />
      <Dialog open={showActivity} onOpenChange={setShowActivity}><DialogContent className="ui-test-activity-dialog"><DialogHeader><DialogTitle>后台活动</DialogTitle><DialogDescription>查看进度、重试错误，不必离开写作。</DialogDescription></DialogHeader><div className="ui-test-activity-body"><RawSourcesSection uiTestActivityView onCancelExtraction={() => cancelImportRef.current?.()} /></div><DialogFooter><button type="button" className="ui-test-btn primary" onClick={() => setShowActivity(false)}>关闭</button></DialogFooter></DialogContent></Dialog>
      <Dialog open={showContact} onOpenChange={setShowContact}><DialogContent className="ui-test-contact-dialog" aria-label="联系与支持"><DialogTitle className="sr-only">联系与支持</DialogTitle><div className="ui-test-contact-body"><ContactSupportSection /></div><DialogFooter><button type="button" className="ui-test-btn primary" onClick={() => setShowContact(false)}>关闭</button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}
