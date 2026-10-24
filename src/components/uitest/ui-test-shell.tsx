import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { BookOpen, Brain, Grid2X2, GitBranch, HeartHandshake, History, Library, Minus, PanelLeft, Search, Settings, ShieldCheck, Sparkles, Square, Trash2, Wrench, X } from "lucide-react"
import logoImg from "@/assets/QM-LOGO.png"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useWikiStore, type WikiState } from "@/stores/wiki-store"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import { ContentArea } from "@/components/layout/content-area"
import { SidebarPanel } from "@/components/layout/sidebar-panel"
import { RawSourcesSection } from "@/components/layout/knowledge-tree"
import { BookAnalysisActivitySection } from "@/components/novel/book-analysis-activity-section"
import { registerUiTestProject } from "@/lib/ui-test-library"
import { ErrorBoundary } from "@/components/error-boundary"
import { refreshProjectFileTree } from "@/lib/project-file-tree-refresh"
import { isMacOS, isTauri } from "@/lib/platform"
import { CreateProjectDialog } from "@/components/project/create-project-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { applyTheme } from "@/lib/theme-utils"
import { saveTheme } from "@/lib/project-store"
import { readUiTestAiHintDismissed, readUiTestDirectoryHintDismissed, readUiTestSkin, writeUiTestAiHintDismissed, writeUiTestDirectoryHintDismissed, writeUiTestSkin, type UiTestSkin } from "@/lib/ui-test"
import { AppearanceSkinProvider } from "@/components/layout/appearance-context"
import { readUiTestWorkspacePreference as readPreference, uiTestWorkspaceKey as preferenceKey } from "@/lib/ui-test-workspace-preferences"
import { availablePrimaryNav, movePrimaryNav, normalizePrimaryNav, PRIMARY_NAV_LONG_PRESS_MS, readPrimaryNav, writePrimaryNav, type PrimaryNavItem, type PrimaryNavView } from "@/lib/ui-test-primary-nav"
import { normalizePath } from "@/lib/path-utils"
import { getUiTestDocumentPath, UI_TEST_AI_DEFAULT_WIDTH } from "@/lib/ui-test-layout"
import { isFullWindowView } from "@/lib/full-window-views"
import type { WikiProject } from "@/types/wiki"
import { UiTestShelf } from "./ui-test-shelf"
import { ContactSupportSection } from "@/components/settings/sections/contact-support-section"
import { useCloudSyncAutoSync } from "@/hooks/use-cloud-sync-auto-sync"
import { CloudSyncIndicator } from "@/components/layout/cloud-sync-indicator"
import { CloudSyncDetailDialog } from "@/components/layout/cloud-sync-detail-dialog"
import { CLOUD_SYNC_OPEN_SETTINGS_EVENT } from "@/lib/cloud-sync/client"
import { useCloudSyncStore } from "@/stores/cloud-sync-store"
import { confirmModelDraftLeave } from "./models/model-draft-guard"
import { MacTrafficLights } from "./mac-traffic-lights"
import { GuideOverlay } from "@/components/guide/guide-overlay"
import { useGuideStore } from "@/lib/guide/guide-store"
import { GUIDE_RESTART_EVENT } from "@/lib/guide/guide-events"
import {
  buildGuideDemoChapterBody,
  readGuideDemoNovel,
} from "@/lib/guide/guide-demo-novel"
import type { GuideDirective } from "@/lib/guide/guide-types"
import { buildDraftChapterMarkdown } from "@/lib/novel/chapter-draft-markdown"
import { makeChapterFileName } from "@/lib/wiki-filename"
import { createDirectory, fileExists, readFile, writeFile } from "@/commands/fs"
import { toast } from "@/lib/toast"
import type { FileNode } from "@/types/wiki"
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
  [ { view: "maintenance", label: "维护工具", icon: Wrench }, { view: "trash", label: "回收站", icon: Trash2 } ],
] as const
/** 文件树里是否已经有章节文件（用来区分「空书」与「用户已经在写的书」）。 */
function fileTreeHasChapter(nodes: FileNode[]): boolean {
  return nodes.some((node) => /\/wiki\/chapters\//.test(node.path) || (node.children ? fileTreeHasChapter(node.children) : false))
}

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
  const novelMode = useWikiStore((s) => s.novelMode)
  const chatExpanded = useWikiStore((s) => s.chatExpanded)
  const setChatExpanded = useWikiStore((s) => s.setChatExpanded)
  const outlineExpanded = useOutlineGenerationStore((s) => s.panelOpen)
  const setOutlineExpanded = useOutlineGenerationStore((s) => s.setPanelOpen)
  const [skin, setSkin] = useState<UiTestSkin>(() => readUiTestSkin())
  const [directoryHintDismissed, setDirectoryHintDismissed] = useState(() => readUiTestDirectoryHintDismissed())
  const [aiHintDismissed, setAiHintDismissed] = useState(() => readUiTestAiHintDismissed())
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showGlobalSettings, setShowGlobalSettings] = useState(false)
  /**
   * 新手引导的开关状态。
   *
   * `hydrate()` 必须在首帧后跑一次（读 localStorage），否则服务端式首渲染
   * 与持久化状态不一致会先闪一下引导再消失。`status === "new"` 表示这台机器
   * 从没走过引导 —— 只有这种情况才自动弹，用户「结束引导」之后不再打扰。
   */
  const guideStatus = useGuideStore((s) => s.status)
  const guideHydrated = useGuideStore((s) => s.hydrated)
  const hydrateGuide = useGuideStore((s) => s.hydrate)
  const startGuide = useGuideStore((s) => s.start)
  const [showActivity, setShowActivity] = useState(false)
  const [showContact, setShowContact] = useState(false)
  const [libraryError, setLibraryError] = useState("")
  const [toolOpen, setToolOpen] = useState(false)
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
  const toolRef = useRef<HTMLButtonElement>(null)
  const directoryRef = useRef<HTMLButtonElement>(null)
  const cancelImportRef = useRef<(() => void) | null>(null)
  const writing = Boolean(project && (activeView === "wiki" || activeView === "sources"))
  const assistantOpen = activeView === "sources" ? outlineExpanded : chatExpanded
  const requestedWidth = Number.isFinite(preference.aiWidth) ? preference.aiWidth! : UI_TEST_AI_DEFAULT_WIDTH
  // 技能库、灵魂改为整窗卡片画廊，不再占用左侧目录栏。
  // 判定抽到 `@/lib/full-window-views`：这样「哪些视图是整窗」有**行为测试**
  // （`full-window-views.spec.ts`），而不是靠源码里一行的子串比对。
  const fullWindowViews = isFullWindowView(activeView)
  /*
   * 记忆中心同样改为整窗单页：它的分类列表现在是页面内的标签条，
   * 不再需要左侧目录栏 —— 那一栏原来是"中间栏"，与右侧内容区构成双栏。
   *
   * 必须带上 novelMode：activeView === "lint" 由两个页面共用
   * （content-area.tsx 里 novelMode ? <MemoryCenterView/> : <LintView/>）。
   * LintView 依赖目录栏的章节树，只看 activeView 会把它的目录栏一起藏掉。
   */
  const memoryCenterFullWindow = activeView === "lint" && novelMode
  const hasDirectory = Boolean(project && activeView !== "settings" && !fullWindowViews && !memoryCenterFullWindow)
  const sidebarPreference = preference.directory?.[activeView] ?? activeView !== "graph"
  const sidebarVisible = hasDirectory && sidebarPreference
  const showShelf = !project && !showGlobalSettings

  useEffect(() => {
    hydrateGuide()
  }, [hydrateGuide])
  /**
   * 自动播放只在**本次启动**判断一次，而且只看「装好还没走过」这一种情况。
   *
   * 设置页现在没有引导开关（只剩一颗「播放」），所以状态一旦变成 done / off
   * 就不会再回到 new；这次会话想再看，只能自己点播放。用 ref 吃掉后续状态变化，
   * 是为了防止将来任何把 status 复位成 new 的入口把 46 步教程直接拍到用户脸上
   * —— 那会顶掉设置页，而第一步恰好是「在书架点设置」。
   */
  const autoStartChecked = useRef(false)
  useEffect(() => {
    if (!guideHydrated || autoStartChecked.current) return
    autoStartChecked.current = true
    // 只有「从没开始过」才自动弹；结束/关闭过的一律安静。
    if (guideStatus === "new") startGuide()
  }, [guideHydrated, guideStatus, startGuide])
  /**
   * 设置页点了「重新开始引导」：先退出设置、回到书架。
   *
   * 整段引导的第一步是「在书架点设置」，人若还站在设置页，第一步会指着一个
   * 已经点过的按钮。这里只管退界面，进度由设置页那边（`start()`）写好。
   */
  useEffect(() => {
    const onRestart = () => {
      setShowGlobalSettings(false)
      setShowCreateDialog(false)
      if (useWikiStore.getState().project) onSwitchProject()
    }
    window.addEventListener(GUIDE_RESTART_EVENT, onRestart)
    return () => window.removeEventListener(GUIDE_RESTART_EVENT, onRestart)
  }, [onSwitchProject])
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
    if (!toolOpen) return
    const menu = toolsRef.current
    menu?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus()
    const outside = (event: PointerEvent) => {
      if (menu?.contains(event.target as Node)) return
      setToolOpen(false); setNavMenu(null)
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault(); setToolOpen(false); setNavMenu(null)
      toolRef.current?.focus()
    }
    // 捕获阶段接收外部点击，避免编辑器等子区域阻止冒泡后菜单无法关闭。
    document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", escape)
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape) }
  }, [toolOpen])
  useEffect(() => {
    if (!navMenu) return
    if (!navMenuSection) navMenuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus()
    const outside = (event: PointerEvent) => {
      if (navMenuRef.current?.contains(event.target as Node)) return
      setNavMenu(null)
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setNavMenu(null)
    }
    document.addEventListener("pointerdown", outside, true)
    document.addEventListener("keydown", escape)
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape) }
  }, [navMenu, navMenuSection])

  const minimizeWindow = () => { if (isTauri()) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().minimize()).catch(() => undefined) }
  const toggleMaximizeWindow = () => { if (isTauri()) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize()).catch(() => undefined) }
  const closeWindow = () => { if (isTauri()) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().close()).catch(() => undefined) }
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
    setToolOpen(false)
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
  /**
   * 云同步：启动时拉一次配置/状态/历史并订阅后端事件。
   * 主窗口才订阅（client 里按 window.label 判断），独立窗口不会重复弹泡。
   */
  useEffect(() => {
    void useCloudSyncStore.getState().hydrate()
    return () => useCloudSyncStore.getState().teardown()
  }, [])

  // 自动同步（落盘后 / 重新聚焦 / 刚连上）：判定在 lib/cloud-sync/scheduler.ts。
  useCloudSyncAutoSync()

  // 云图标/气泡里点「去登录」「查看详情」时，由外壳负责真正打开设置页：
  // showGlobalSettings 属于外壳，组件自己改会在无项目时掉回书架。
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ category?: string }>).detail
      const category = detail?.category
      if (category) {
        const setCategory = useWikiStore.getState().setActiveSettingsCategory
        setCategory(category as Parameters<typeof setCategory>[0])
      }
      void navigateRef.current("settings")
    }
    window.addEventListener(CLOUD_SYNC_OPEN_SETTINGS_EVENT, handler)
    return () => window.removeEventListener(CLOUD_SYNC_OPEN_SETTINGS_EVENT, handler)
  }, [])

  const returnToShelf = async () => {
    if (!showShelf && activeView === "settings" && !(await confirmModelDraftLeave())) return
    setShowGlobalSettings(false)
    if (project) onSwitchProject()
  }
  const handleCreatedProject = async (created: WikiProject) => { await onProjectOpened(created); setActiveView("sources") }

  /**
   * 引导的「载入示例章节」：把内置正文写成一份**草稿章节**再打开。
   *
   * 为什么写草稿（`chapter_status: draft`）而不是正式章节：与 AI 生成正文
   * 落盘的口径一致（见 `chapter-draft-markdown.ts` 的文件头说明）——草稿不会被
   * 自动提取记忆，用户要先看过、确认过，才走「提取记忆」把它转正。
   * 引导示范的是一章「还没定稿的初稿」，不该一上来就污染记忆库。
   *
   * 已存在同名文件时**不覆盖**：用户可能已经把示例改成了自己的开头。
   */
  const guideLoadDemoChapter = async () => {
    const store = useWikiStore.getState()
    const project = store.project
    const novel = readGuideDemoNovel()
    if (!project || !novel) {
      toast.error("还没有可写入的小说，请先完成新建小说这一步。")
      return
    }
    /*
     * 只往「引导用的示例书」里写。
     *
     * 重播「章节」阶段时，当前打开的可能是用户自己的小说：不拦一下就会凭空
     * 给它多出一章《第1章-雾里的船》，那是最难解释的一类"数据损坏"。
     * 书名对不上但书里还一章都没有（用户改过示例书名）时仍然放行。
     */
    if (project.name.trim() !== novel.name && fileTreeHasChapter(store.fileTree)) {
      toast.error(`这一节用的是示例小说《${novel.name}》，请先切回它再重播，否则会往《${project.name}》里多写一章。`)
      return
    }
    const projectPath = normalizePath(project.path)
    const chapterPath = `${projectPath}/wiki/chapters/${makeChapterFileName(`第1章-${novel.chapterTitle}`, 1)}`
    try {
      if (!(await fileExists(chapterPath))) {
        await createDirectory(`${projectPath}/wiki/chapters`)
        await writeFile(
          chapterPath,
          buildDraftChapterMarkdown(1, novel.chapterTitle, buildGuideDemoChapterBody(novel)),
        )
        await refreshProjectFileTree(projectPath, { projectId: project.id, clearDisplayTreeFirst: false })
      }
      const content = await readFile(chapterPath)
      store.setSelectedFile(chapterPath)
      store.setFileContent(content)
      store.setActiveView("wiki")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "载入示例章节失败，可稍后在章节里手动新建。")
    }
  }

  /**
   * 执行引导层请求的界面动作。
   *
   * 引导数据只声明「要打开设置 / 回书架 / 开新建弹窗」，真正落地放在这里：
   * 这几个开关（`showGlobalSettings`、`showCreateDialog`）与 `navigate()` 都归外壳所有，
   * 让覆盖层直接去改 store 会造成「设置开着、书架还盖在上面」这类不一致。
   */
  const runGuideDirective = (directive: GuideDirective) => {
    switch (directive) {
      case "open-settings": void navigate("settings"); break
      case "open-shelf": void returnToShelf(); break
      case "open-create-dialog": setShowCreateDialog(true); break
      case "open-outline-view": void navigate("sources"); break
      case "open-chapter-view": void navigate("wiki"); break
      case "load-demo-chapter": void guideLoadDemoChapter(); break
    }
  }

  /**
   * 皮肤切换器已从顶栏移到侧栏底部（SidebarBottomActions 的「外观」）。
   * 这里把皮肤状态通过 context 传下去，避免穿过层层侧栏面板做 prop drilling。
   */
  const appearanceValue = useMemo(() => ({ skin, selectSkin: setSkin }), [skin])

  return (
    <AppearanceSkinProvider value={appearanceValue}>
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
            {/*
              「书架」已从这里移到主导航最左端（见下方 nav 内的固定按钮）。
              品牌区只保留：图标 + 产品名 + 当前书名。
            */}
            {project && <span className="ui-test-current-book" title={project.name}>{project.name}</span>}
          </div>
          <nav className="ui-test-nav" aria-label="主模块" onContextMenu={(event) => event.preventDefault()}>
            {/*
              「书架」是**固定**按钮，钉在主导航最左端（用户要求：从品牌区移到「大纲」左侧）。
              它故意**不**放进下面的 `primaryNav.map`：
                · `primaryNav` 是用户可配置的（长按出菜单 → 移动 / 替换 / 新增 / 删除，
                  见 `ui-test-primary-nav.ts`，上限 5 项）；
                · 书架是回退入口，不该被删掉或换走 —— 一旦被移出「主模块」，
                  用户就没有稳定的一键回书架了。
              所以它在 DOM 上是 `<nav>` 的第一个子元素、**不是** `.ui-test-nav-slot`
              （那层是给可配置项挂长按菜单用的），也不带 `aria-haspopup`。
              类名用 `.ui-test-nav-shelf` 而不是 `.ui-test-nav-item`，好让
              `.ui-test-nav-item` 继续精确表示「可配置的那几项」
              （`ui-test-shell.spec.tsx` 与 `docs/.../verify-real-exe*.mjs` 都按这个口径查）。
              与它原来的面包屑形态一样，始终渲染（未打开小说时也点得到，
              用于从「全局设置」退回书架）。

              ⚠️ 只有「书架」两个字，**没有图标**（用户要求）：
              此前是 `<BookOpen />书架`。去掉图标后，它与右侧那几个纯文字导航项
              在视觉上才是一组；`BookOpen` 仍被下方创作工具菜单使用，导入保留。
            */}
            <button type="button" className={`ui-test-nav-shelf${showShelf ? " is-active" : ""}`} data-guide="shell.shelf" aria-label="返回书架" aria-current={showShelf ? "page" : undefined} title="返回书架" onClick={() => void returnToShelf()}>书架</button>
            {primaryNav.map((item, index) => <div className="ui-test-nav-slot" key={item.view} onPointerDown={(event) => pressNav(event, item.view)} onPointerMove={moveNavPress} onPointerUp={releaseNavPress} onPointerCancel={releaseNavPress} onContextMenu={(event) => openNavMenu(event, item.view)}>
              <button type="button" disabled={!project} data-guide={item.view === "wiki" ? "shell.nav.wiki" : item.view === "soul" ? "shell.tool.soul" : item.view === "skillLibrary" ? "shell.tool.skillLibrary" : undefined} aria-current={project && activeView === item.view ? "page" : undefined} aria-haspopup="menu" className={`ui-test-nav-item${project && activeView === item.view ? " is-active" : ""}`} onClick={() => navigate(item.view)}>{item.label}</button>
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
              <button type="button" className="ui-test-icon-btn" data-guide="shell.settings" aria-label="设置" title="设置" onClick={() => navigate("settings")}><Settings /></button>
            </>}
            <div ref={toolsRef} className="ui-test-menu-anchor">
              <Tooltip>
                <TooltipTrigger render={<button ref={toolRef} type="button" className="ui-test-icon-btn" aria-label="创作工具" aria-haspopup="menu" aria-expanded={toolOpen} onClick={() => setToolOpen(!toolOpen)}><Grid2X2 /></button>} />
                <TooltipContent>创作工具</TooltipContent>
              </Tooltip>
              {toolOpen && <div className="ui-test-menu-pop" role="menu" aria-label="创作工具" data-tauri-drag-region="false" onKeyDown={menuKeyboard}>
                <div className="ui-test-menu-title">创作工具 · {project?.name ?? "未选择小说"}</div>
                {TOOL_GROUPS.map((group, index) => <div className="ui-test-menu-group" key={index}>
                  {group.map(({ view, label, icon: Icon }) => <button key={view} type="button" role="menuitem" className="ui-test-menu-item" disabled={!project} onClick={() => navigate(view)}><Icon /><span>{label}</span></button>)}
                </div>)}
              </div>}
            </div>
            <Tooltip>
              <TooltipTrigger render={<button type="button" className="ui-test-icon-btn ui-test-activity-entry" aria-label="后台活动" onClick={() => setShowActivity(true)}><History /></button>} />
              <TooltipContent>后台活动</TooltipContent>
            </Tooltip>
            <CloudSyncIndicator />
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
      <Dialog open={showActivity} onOpenChange={setShowActivity}><DialogContent className="ui-test-activity-dialog"><DialogHeader><DialogTitle>后台活动</DialogTitle><DialogDescription>查看进度、重试错误，不必离开写作。</DialogDescription></DialogHeader><div className="ui-test-activity-body"><RawSourcesSection uiTestActivityView onCancelExtraction={() => cancelImportRef.current?.()} /><BookAnalysisActivitySection onNavigate={() => setShowActivity(false)} /></div><DialogFooter><button type="button" className="ui-test-btn primary" onClick={() => setShowActivity(false)}>关闭</button></DialogFooter></DialogContent></Dialog>
      <CloudSyncDetailDialog />
      <Dialog open={showContact} onOpenChange={setShowContact}><DialogContent className="ui-test-contact-dialog" aria-label="联系与支持"><DialogTitle className="sr-only">联系与支持</DialogTitle><div className="ui-test-contact-body"><ContactSupportSection /></div><DialogFooter><button type="button" className="ui-test-btn primary" onClick={() => setShowContact(false)}>关闭</button></DialogFooter></DialogContent></Dialog>
      <GuideOverlay onDirective={runGuideDirective} />
    </div>
    </AppearanceSkinProvider>
  )
}
