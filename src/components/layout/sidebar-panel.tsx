import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  BookOpenCheck,
  BookText,
  Brain,
  ChevronDown,
  CircleHelp,
  Clock3,
  FilePlus2,
  FileText,
  FolderPlus,
  GitBranchPlus,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react"
import { KnowledgeTree, RawSourcesSection, type KnowledgeCreateRequest } from "./knowledge-tree"
import { TrashPanel } from "./trash-panel"
import { GraphSidebarPanel } from "./graph-sidebar-panel"
import { ReviewCenterSidebarPanel } from "./review-center-sidebar-panel"
import { FrameworkList } from "@/components/novel/story-simulation/framework-list"

import { useWikiStore } from "@/stores/wiki-store"
import { useChatStore } from "@/stores/chat-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import { useStorySimulationStore } from "@/stores/story-simulation-store"
import { loadFrameworks, loadSimulationResults, deleteSimulationResult } from "@/lib/novel/story-simulation/framework-store"
import { loadBinding } from "@/lib/novel/story-simulation/framework-binding"
import type { StoryFramework } from "@/lib/novel/story-simulation/types"
import { createDirectory, fileExists, listDirectory, preprocessFile, readFile, writeFile } from "@/commands/fs"
import { getFileName, getFileStem, normalizePath } from "@/lib/path-utils"
import {
  loadDismantlingLibrary,
  normalizeDismantlingLibrary,
  saveDismantlingLibrary,
  splitDismantlingTextIntoChapters,
  type DismantlingChapter,
  type DismantlingLibrary,
  type DismantlingProject,
} from "@/lib/novel/dismantling"
import { flattenMdFiles, getNextChapterNumber } from "@/lib/novel/chapter-utils"
import { Button } from "@/components/ui/button"
import { PanelHeaderWithHelp } from "@/components/layout/panel-header-with-help"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { MemoryCenterData, MemoryCenterFilePreview } from "@/lib/novel/memory-center"
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
  sortChapterImportCandidates,
  type ChapterImportCandidate,
  type ImportedChapter,
} from "@/lib/novel/chapter-import"
import { makeChapterFileName, makeDefaultChapterTitle, makeSafeFileSlug } from "@/lib/wiki-filename"
import { buildPureOutlineMarkdown } from "@/lib/novel/outline-markdown"
import { useImportProgressStore } from "@/stores/import-progress-store"
import { openExternalUrl } from "@/lib/open-external-url"
import type { ReferenceToken } from "@/lib/reference/types"

const SoulSidebarPanel = lazy(async () => {
  const mod = await import("./soul-sidebar-panel")
  return { default: mod.SoulSidebarPanel }
})

const BookAnalysisSidebarPanel = lazy(async () => {
  const mod = await import("./book-analysis-sidebar-panel")
  return { default: mod.BookAnalysisSidebarPanel }
})

const UnifiedSkillLibrarySidebarPanel = lazy(async () => {
  const mod = await import("@/components/skill-library/unified-skill-library-view")
  return { default: mod.UnifiedSkillLibrarySidebarPanel }
})

const USAGE_GUIDE_URL = "https://tcnk9ik08e1c.feishu.cn/wiki/FWiSwYQKoifpwBk6mSRcSlB8nrh?from=from_copylink"

const DISMANTLING_NO_PREPROCESSING_NEEDED = "no preprocessing needed"

function normalizeDismantlingProjectTitle(title: string): string {
  return title
    .normalize("NFKC")
    .trim()
    .replace(/\.(txt|md|mdx|doc|docx)$/i, "")
    .replace(/\s+/g, "")
    .toLowerCase()
}

function shouldReadDismantlingOriginalFile(preprocessedText: string): boolean {
  return preprocessedText.trim().toLowerCase() === DISMANTLING_NO_PREPROCESSING_NEEDED
}

function SearchHistoryPanel() {
  const { t } = useTranslation()
  const searchHistory = useWikiStore((s) => s.searchHistory)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSearchTrigger = useWikiStore((s) => s.setSearchTrigger)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
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

export function DismantlingSidebarPanel() {
  const project = useWikiStore((s) => s.project)
  const selectedDismantlingProjectId = useWikiStore((s) => s.selectedDismantlingProjectId)
  const setSelectedDismantlingProjectId = useWikiStore((s) => s.setSelectedDismantlingProjectId)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const [library, setLibrary] = useState<DismantlingLibrary>({ version: 1, projects: [], selectedProjectId: null })
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importStatus, setImportStatus] = useState("")

  useEffect(() => {
    if (!project?.path) {
      setLibrary({ version: 1, projects: [], selectedProjectId: null })
      setSelectedDismantlingProjectId(null)
      return
    }
    let cancelled = false
    setLoading(true)
    void loadDismantlingLibrary(project.path)
      .then((value) => {
        if (cancelled) return
        setLibrary(value)
        const selected = value.projects.find((item) => item.id === selectedDismantlingProjectId) ?? value.projects[0] ?? null
        if (selected?.id !== selectedDismantlingProjectId) setSelectedDismantlingProjectId(selected?.id ?? null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [project?.path, selectedDismantlingProjectId, setSelectedDismantlingProjectId])

  async function importDismantlingCandidates(candidates: ChapterImportCandidate[], titleFallback: string) {
    if (!project?.path || importing) return
    setImporting(true)
    setImportStatus("正在提取章节...")
    try {
      const normalizedTitle = normalizeDismantlingProjectTitle(titleFallback || "未命名拆文作品")
      const existingProject = library.projects.find((item) => normalizeDismantlingProjectTitle(item.title) === normalizedTitle)
      if (existingProject) {
        setSelectedDismantlingProjectId(existingProject.id)
        setImportStatus(`已存在相同拆文作品：${existingProject.title}`)
        window.alert(`已存在相同拆文作品：${existingProject.title}，不会重复显示。`)
        return
      }

      const chapters: DismantlingChapter[] = []
      const sorted = sortChapterImportCandidates(candidates)
      for (const candidate of sorted) {
        setImportStatus(`正在提取章节：${candidate.name}`)
        let content = ""
        try {
          content = await preprocessFile(candidate.path)
          if (shouldReadDismantlingOriginalFile(content)) {
            content = await readFile(candidate.path)
          }
        } catch {
          content = await readFile(candidate.path)
        }
        const split = splitDismantlingTextIntoChapters(content)
        if (split.length <= 1) {
          const chapterNumber = chapters.length + 1
          chapters.push({
            id: `chapter-${String(chapterNumber).padStart(3, "0")}`,
            chapterNumber,
            title: split[0]?.title === "第1章" ? getFileStem(candidate.name) || `第${chapterNumber}章` : split[0]?.title ?? getFileStem(candidate.name),
            content: split[0]?.content || content,
            status: "pending",
          })
        } else {
          for (const item of split) {
            chapters.push({ ...item, id: `chapter-${String(chapters.length + 1).padStart(3, "0")}`, chapterNumber: chapters.length + 1 })
          }
        }
      }
      if (chapters.length === 0) {
        window.alert("没有找到可导入的拆文资料。")
        return
      }
      const now = Date.now()
      const nextProject: DismantlingProject = {
        id: `dismantling-${now}`,
        title: titleFallback || "未命名拆文作品",
        createdAt: now,
        updatedAt: now,
        chapters,
        analyses: [],
        structureMemory: [],
        useInChat: false,
      }
      const nextLibrary: DismantlingLibrary = {
        ...library,
        projects: [nextProject, ...library.projects],
        selectedProjectId: nextProject.id,
      }
      const normalizedLibrary = normalizeDismantlingLibrary(nextLibrary)
      await saveDismantlingLibrary(project.path, normalizedLibrary)
      setLibrary(normalizedLibrary)
      setSelectedDismantlingProjectId(nextProject.id)
      setImportStatus(`已提取 ${chapters.length} 个章节。`)
      bumpDataVersion()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`导入失败：${message}`)
    } finally {
      setImporting(false)
    }
  }

  async function handleImportDismantlingFiles() {
    if (!project?.path || importing) return

    const { open } = await import("@tauri-apps/plugin-dialog")
    const selected = await open({
      multiple: true,
      title: "导入拆文文件",
      filters: [{ name: "文档", extensions: ["txt", "md", "mdx", "doc", "docx"] }],
    })
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
    if (paths.length === 0) return
    const candidates = paths.map((path) => ({ path: normalizePath(path), name: getFileName(path) }))

    await importDismantlingCandidates(candidates, getFileStem(candidates[0]?.name ?? "") || "拆文作品")
  }

  async function handleImportDismantlingFolder() {
    if (!project?.path || importing) return

    const { open } = await import("@tauri-apps/plugin-dialog")
    const selected = await open({ directory: true, title: "导入拆文文件夹" })
    if (!selected || Array.isArray(selected)) return
    const candidates = await collectChapterImportCandidatesFromFolder(selected)
    await importDismantlingCandidates(candidates, getFileName(selected) || "拆文作品")
  }

  async function handleDeleteDismantlingProject(item: DismantlingProject) {
    if (!project?.path || importing) return
    const confirmed = window.confirm(`确认删除拆文作品“${item.title}”吗？删除后会移除该作品的章节、拆文结果和结构记忆。`)
    if (!confirmed) return

    const nextProjects = library.projects.filter((projectItem) => projectItem.id !== item.id)
    const nextSelectedProjectId = selectedDismantlingProjectId === item.id
      ? nextProjects[0]?.id ?? null
      : selectedDismantlingProjectId
    const normalizedLibrary = normalizeDismantlingLibrary({
      ...library,
      projects: nextProjects,
      selectedProjectId: nextSelectedProjectId,
    })

    await saveDismantlingLibrary(project.path, normalizedLibrary)
    setLibrary(normalizedLibrary)
    setSelectedDismantlingProjectId(normalizedLibrary.selectedProjectId ?? null)
    setImportStatus(`已删除拆文作品：${item.title}`)
    bumpDataVersion()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">拆文作品</div>
          <div className="mt-0.5 text-xs text-muted-foreground">独立拆文库</div>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => void handleImportDismantlingFiles()} disabled={importing} title="导入文件">
            <FilePlus2 className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => void handleImportDismantlingFolder()} disabled={importing} title="导入文件夹">
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {importStatus ? (
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">
          {importStatus}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {loading ? (
          <div className="px-2 py-4 text-xs text-muted-foreground">正在读取拆文库...</div>
        ) : library.projects.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-xs leading-5 text-muted-foreground">还没有拆文作品，请使用上方按钮导入文件或文件夹。</div>
        ) : library.projects.map((item) => (
          <div
            key={item.id}
            className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${selectedDismantlingProjectId === item.id ? "border-primary bg-primary/10" : "bg-background hover:bg-muted"}`}
          >
            <button
              type="button"
              onClick={() => setSelectedDismantlingProjectId(item.id)}
              className="flex min-w-0 flex-1 items-start gap-2 text-left"
            >
              <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{item.chapters.length} 章 · {item.structureMemory.length} 条结构记忆</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteDismantlingProject(item)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              title="删除拆文作品"
              aria-label="删除拆文作品"
              disabled={importing}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <RawSourcesSection onCancelExtraction={() => {}} />
    </div>
  )
}

void DismantlingSidebarPanel

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
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
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
                      <span className="shrink-0 rounded bg-primary/10 px-1 text-[10px] text-primary">
                        草稿
                      </span>
                    )}
                  </div>
                  <span className="block truncate text-[11px] text-muted-foreground">
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

const MEMORY_LABEL_KEYS: Record<string, string> = {
  "dismantling-library": "拆文记忆库",
  snapshots: "novel.memoryCenter.snapshots.title",
  "character-states": "novel.memoryCenter.sections.characterStates",
  "character-cognition": "novel.memoryCenter.sections.cognition",
  "foreshadowing-tracker": "novel.memoryCenter.sections.foreshadowing",
  timeline: "novel.memoryCenter.sections.timeline",
  "canon-facts": "novel.memoryCenter.sections.canonFacts",
  conflicts: "novel.memoryCenter.sections.conflicts",
}

const MEMORY_ICONS: Record<string, typeof Users> = {
  "dismantling-library": BookOpenCheck,
  snapshots: FileText,
  "character-states": Users,
  "character-cognition": Brain,
  "foreshadowing-tracker": Sparkles,
  timeline: Clock3,
  "canon-facts": BookText,
  conflicts: GitBranchPlus,
}

function countMemoryFileEntries(file: MemoryCenterFilePreview | null | undefined): number {
  if (!file) return 0
  return file.sections.reduce(
    (sum, section) => sum + section.items.length + section.groups.length,
    0,
  )
}

function MemoryCenterListButton({
  label,
  count,
  selected,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string
  count: number
  selected: boolean
  icon: typeof Users
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant={selected ? "secondary" : "ghost"}
      className="h-auto w-full justify-between px-3 py-2.5"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
      </span>
      <span className="ml-3 shrink-0 text-sm font-semibold leading-none">{count}</span>
    </Button>
  )
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

export function SidebarPanel() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const activeView = useWikiStore((s) => s.activeView)
  const novelMode = useWikiStore((s) => s.novelMode)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const selectedMemoryCenterEntry = useWikiStore((s) => s.selectedMemoryCenterEntry)
  const setSelectedMemoryCenterEntry = useWikiStore((s) => s.setSelectedMemoryCenterEntry)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setChatExpanded = useWikiStore((s) => s.setChatExpanded)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const enqueueChatReferenceTokens = useChatStore((s) => s.enqueueReferenceTokens)
  const enqueueOutlineReferenceTokens = useOutlineChatStore((s) => s.enqueueReferenceTokens)
  const setOutlineChatOpen = useOutlineGenerationStore((s) => s.setPanelOpen)
  const [mode, setMode] = useState<"knowledge" | "files">("knowledge")
  const [refreshKey, setRefreshKey] = useState(0)
  const [pendingCreate, setPendingCreate] = useState<KnowledgeCreateRequest | null>(null)
  const [inputTitle, setInputTitle] = useState("")
  const [creating, setCreating] = useState(false)
  const [pendingPages, setPendingPages] = useState<PendingPageInfo[]>([])
  const [memoryData, setMemoryData] = useState<MemoryCenterData | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [outlineImporting, setOutlineImporting] = useState(false)
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

  const loadMemoryCenter = useCallback(async (projectPath: string) => {
    const { loadMemoryCenterData } = await import("@/lib/novel/memory-center")
    return loadMemoryCenterData(projectPath)
  }, [])

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

    const memoryDecision = await confirmChapterMemoryExtraction(sourcePaths.length)
    if (memoryDecision === "cancel") return
    const extractMemory = memoryDecision === "extract"
    setChapterImporting(true)
    try {
      const projectPath = normalizePath(project.path)
      const importedChapters = await importChapterFiles(projectPath, sourcePaths, {
        finalForMemoryExtraction: extractMemory,
      })
      await finishChapterImport(projectPath, importedChapters, extractMemory)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("[SidebarPanel] chapter file import failed:", error)
      window.alert(`导入失败：${message}`)
    } finally {
      setChapterImporting(false)
      setChapterImportMenuOpen(false)
    }
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

    const memoryDecision = await confirmChapterMemoryExtraction(candidates.length)
    if (memoryDecision === "cancel") return
    const extractMemory = memoryDecision === "extract"
    setChapterImporting(true)
    try {
      const projectPath = normalizePath(project.path)
      const importedChapters = await importChapterFiles(projectPath, candidates.map((candidate) => candidate.path), {
        finalForMemoryExtraction: extractMemory,
      })
      await finishChapterImport(projectPath, importedChapters, extractMemory)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("[SidebarPanel] chapter folder import failed:", error)
      window.alert(`导入失败：${message}`)
    } finally {
      setChapterImporting(false)
      setChapterImportMenuOpen(false)
    }
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

    setOutlineImporting(true)
    try {
      const projectPath = normalizePath(project.path)
      const importedPaths = await importOutlineFiles(projectPath, sourcePaths)
      if (importedPaths.length === 0) {
        window.alert(t("novel.outlineImport.emptyResult", { defaultValue: "没有找到可导入的大纲文档。" }))
        return
      }
      await refreshTree(projectPath, importedPaths[0])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("[SidebarPanel] outline file import failed:", error)
      window.alert(t("novel.outlineImport.importFailed", {
        message,
        defaultValue: `导入失败：${message}`,
      }))
    } finally {
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

    const memoryDecision = await confirmOutlineMemoryExtraction(candidates.length)
    if (memoryDecision === "cancel") return
    const extractMemory = memoryDecision === "extract"
    setOutlineImporting(true)
    try {
      const projectPath = normalizePath(project.path)
      const importedPaths = await importOutlineCandidates(projectPath, candidates)
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
      console.error("[SidebarPanel] outline folder import failed:", error)
      window.alert(t("novel.outlineImport.importFailed", {
        message,
        defaultValue: `导入失败：${message}`,
      }))
    } finally {
      setOutlineImporting(false)
      setOutlineImportMenuOpen(false)
    }
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

  useEffect(() => {
    if (!(activeView === "lint" && novelMode)) return
    setSelectedMemoryCenterEntry(null)
  }, [activeView, novelMode, setSelectedMemoryCenterEntry])

  useEffect(() => {
    if (!(activeView === "lint" && novelMode)) return
    if (selectedMemoryCenterEntry !== "dismantling-library") return
    setSelectedMemoryCenterEntry(null)
  }, [activeView, novelMode, selectedMemoryCenterEntry, setSelectedMemoryCenterEntry])

  useEffect(() => {
    if (!(activeView === "lint" && novelMode) || !project?.path) {
      setMemoryData(null)
      setMemoryError(null)
      setMemoryLoading(false)
      return
    }

    let cancelled = false
    setMemoryLoading(true)
    setMemoryError(null)

    void loadMemoryCenter(project.path)
      .then((nextData) => {
        if (cancelled) return
        setMemoryData(nextData)
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setMemoryError(message)
      })
      .finally(() => {
        if (cancelled) return
        setMemoryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeView, loadMemoryCenter, novelMode, project?.path])

  if (activeView === "storySimulation") {
    return <StorySimulationSidebarPanel />
  }

  if (activeView === "graph") {
    return <GraphSidebarPanel />
  }

  if (activeView === "soul") {
    return (
      <Suspense fallback={<SidebarPanelLoading />}>
        <SoulSidebarPanel />
      </Suspense>
    )
  }

  if (activeView === "skillLibrary" || activeView === "writingSkillLibrary") {
    return (
      <Suspense fallback={<SidebarPanelLoading />}>
        <UnifiedSkillLibrarySidebarPanel />
      </Suspense>
    )
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

  if (activeView === "lint" && novelMode) {
    const fileMap = new Map(memoryData?.files.map((file) => [file.key, file]) ?? [])
    const entries = Object.keys(MEMORY_LABEL_KEYS).filter((key) => key !== "dismantling-library").map((key) => {
      if (key === "snapshots") {
        return {
          key,
          label: t(MEMORY_LABEL_KEYS[key]),
          count: memoryData?.stats.snapshotCount ?? 0,
          icon: MEMORY_ICONS[key] ?? FileText,
          disabled: (memoryData?.snapshots.length ?? 0) === 0,
        }
      }

      const file = fileMap.get(key)
      return {
        key,
        label: t(MEMORY_LABEL_KEYS[key]),
        count: countMemoryFileEntries(file),
        icon: MEMORY_ICONS[key] ?? FileText,
        disabled: !file,
      }
    })

    return (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
          <PanelHeaderWithHelp title={t("novel.memoryCenter.title")} helpKey="memory" />
        </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => {
              if (!project?.path) return
              setMemoryLoading(true)
              setMemoryError(null)
              void loadMemoryCenter(project.path)
                .then((nextData) => setMemoryData(nextData))
                .catch((err) => {
                  const message = err instanceof Error ? err.message : String(err)
                  setMemoryError(message)
                })
                .finally(() => setMemoryLoading(false))
            }}
            disabled={memoryLoading}
            title={t("novel.memoryCenter.refresh")}
          >
            <RefreshCw className={`h-4 w-4 ${memoryLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          {memoryError ? (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {memoryError}
            </div>
          ) : null}

          {memoryLoading && !memoryData ? (
            <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
              <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
              {t("novel.memoryCenter.loading")}
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => (
                <MemoryCenterListButton
                  key={entry.key}
                  label={entry.label}
                  count={entry.count}
                  selected={selectedMemoryCenterEntry === entry.key}
                  icon={entry.icon}
                  disabled={entry.disabled}
                  onClick={() => setSelectedMemoryCenterEntry(entry.key)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
            <PanelHeaderWithHelp
              title={isChapter ? t("sidebar.knowledge") : t("sidebar.files")}
              helpKey={isChapter ? "chapter" : "outline"}
              helpTitle={isChapter ? "章节功能使用说明" : "大纲功能使用说明"}
            />
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isChapter ? (
            <div ref={chapterImportMenuRef} className="relative">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => setChapterImportMenuOpen((prev) => !prev)}
                disabled={chapterImporting}
              >
                {chapterImporting ? "导入中..." : "导入"}
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>
              {chapterImportMenuOpen ? (
                <div className="absolute right-0 top-full z-20 mt-1 w-28 rounded-md border bg-popover py-1 text-xs text-popover-foreground shadow-lg">
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left hover:bg-accent"
                    onClick={() => void handleImportChapterFiles()}
                  >
                    导入文件
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left hover:bg-accent"
                    onClick={() => void handleImportChapterFolder()}
                  >
                    导入文件夹
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div ref={outlineImportMenuRef} className="relative">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => setOutlineImportMenuOpen((prev) => !prev)}
                disabled={outlineImporting}
              >
                {outlineImporting ? t("sources.importing") : t("sources.import")}
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>
              {outlineImportMenuOpen ? (
                <div className="absolute right-0 top-full z-20 mt-1 w-28 rounded-md border bg-popover py-1 text-xs text-popover-foreground shadow-lg">
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left hover:bg-accent"
                    onClick={() => void handleImportOutlineFiles()}
                  >
                    {t("sources.importFiles")}
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left hover:bg-accent"
                    onClick={() => void handleImportOutlineFolder()}
                  >
                    {t("sources.importFolder")}
                  </button>
                </div>
              ) : null}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              if (isChapter) {
                void handleCreateNextChapter()
                return
              }
              beginCreate({ kind: "outline" })
            }}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={isChapter ? t("sidebar.newChapter") : t("sidebar.newOutline")}
            disabled={creating || outlineImporting || chapterImporting}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {pendingCreate && (
        <div className="flex flex-col gap-2 border-b px-2 py-2">
          <input
            type="text"
            value={inputTitle}
            onChange={(event) => setInputTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && inputTitle.trim()) {
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

      <div className="flex-1 overflow-hidden">
        <KnowledgeTree
          filterType={isChapter ? "chapter" : "outline"}
          refreshKey={refreshKey}
          pendingPages={pendingPages.filter((page) => page.type === (isChapter ? "chapter" : "outline"))}
          onRemovePendingPage={handleRemovePendingPage}
          onRequestCreate={beginCreate}
          onSendToChat={isChapter ? handleSendChapterToChat : undefined}
          onSendToOutline={!isChapter ? handleSendOutlineToOutlineChat : undefined}
        />
      </div>
      <div className="border-t px-3 py-2">
        <button
          type="button"
          onClick={() => {
            void openExternalUrl(USAGE_GUIDE_URL)
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <CircleHelp className="h-4 w-4 shrink-0" />
          <span>{t("iconSidebar.usageGuide")}</span>
        </button>
      </div>
      <RawSourcesSection onCancelExtraction={handleCancelImportMemoryExtraction} />
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
