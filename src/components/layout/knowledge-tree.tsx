import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { BookOpen, ChevronDown, ChevronRight, FileText, Folder, FolderInput, FolderOpen, Globe, Loader2, MessageCircle, Pencil, Plus, Sparkles, Trash2, Check, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { useWikiStore } from "@/stores/wiki-store"
import { createDirectory, deleteFile, fileExists, listDirectory, readFile, writeFile, openFileLocation, copyFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { buildChapterWordCountLabel, getChapterStatusLabel } from "@/lib/chapter-display"
import { normalizePath } from "@/lib/path-utils"
import { countChapterBodyWords } from "@/lib/chapter-word-count"
import { normalizeChapterStatus, type ChapterStatus } from "@/lib/novel/chapter-meta"
import { moveFileToTrash } from "@/lib/trash"
import { makeChapterFileName, makeDefaultChapterTitle, makeSafeFileSlug } from "@/lib/wiki-filename"
import { useImportProgressStore, type ImportProgressTask } from "@/stores/import-progress-store"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import { startOutlineIngestTask } from "@/lib/novel/outline-generation"
import { getOutlineFileName, outlineSnapshotExists } from "@/lib/novel/outline-ingest-utils"
import { saveLastReadChapter } from "@/lib/project-store"
import type { ReferenceToken } from "@/lib/reference/types"

function formatImportProgressRunningLabel(task: ImportProgressTask, kindLabel: string): string {
  if (task.cancelling) return `正在取消${kindLabel}提取...`

  const activeTitles = task.activeTitles?.filter(Boolean) ?? []

  if (activeTitles.length > 1) {
    const preview = activeTitles.slice(0, 2).join("、")
    return activeTitles.length > 2 ? `${preview} 等${activeTitles.length}个` : preview
  }

  if (activeTitles.length === 1) return activeTitles[0]!
  return task.currentTitle || `${kindLabel}提取中`
}

function formatImportProgressDetail(task: ImportProgressTask): string {
  const base = `${task.completed}/${task.total}`
  const activeCount = task.activeTitles?.length ?? 0
  if ((task.concurrency ?? 1) > 1 && activeCount > 1) {
    return `${base} · ${activeCount} 路并行`
  }
  return base
}

interface WikiPageInfo {
  path: string
  title: string
  type: "chapter" | "outline"
  chapterNumber?: number
  tags: string[]
  origin?: string
  status?: ChapterStatus
  statusLabel?: string
  wordCount?: number
  wordCountLabel?: string
}

export interface KnowledgeCreateRequest {
  kind: "chapter" | "outline" | "volume" | "folder"
  parentDir?: string
}

interface KnowledgeTreeProps {
  filterType: "chapter" | "outline"
  refreshKey?: number
  pendingPages?: WikiPageInfo[]
  onRemovePendingPage?: (pagePath: string) => void
  onRequestCreate?: (request: KnowledgeCreateRequest) => void
  onSendToChat?: (token: ReferenceToken) => void
  onSendToOutline?: (token: ReferenceToken) => void
}

interface CreateMenuState {
  x: number
  y: number
  parentDir?: string
  targetFolderName?: string
  targetFolderPath?: string
}

const EMPTY_PENDING_PAGES: WikiPageInfo[] = []

function parseChineseNumber(input: string): number | null {
  const digitMap: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }

  if (/^\d+$/.test(input)) return Number.parseInt(input, 10)
  if (input === "十") return 10

  const tenIndex = input.indexOf("十")
  if (tenIndex >= 0) {
    const left = input.slice(0, tenIndex)
    const right = input.slice(tenIndex + 1)
    const tens = left ? (digitMap[left] ?? 0) : 1
    const units = right ? (digitMap[right] ?? 0) : 0
    return tens * 10 + units
  }

  let value = 0
  for (const ch of input) {
    const digit = digitMap[ch]
    if (digit === undefined) return null
    value = value * 10 + digit
  }
  return value
}

function extractPageOrderFromTitle(title: string): number | null {
  const titleMatch = title.match(/第\s*([0-9零一二两三四五六七八九十]+)\s*[章节卷]/)
  if (titleMatch?.[1]) {
    const value = parseChineseNumber(titleMatch[1])
    if (value !== null) return value
  }

  const numberMatch = title.match(/(\d+)/)
  if (numberMatch?.[1]) return Number.parseInt(numberMatch[1], 10)
  return null
}

function extractChapterNumberFromContent(content: string): number | null {
  const match = content.match(/^chapter_number:\s*(\d+)\s*$/m)
  if (!match?.[1]) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function getDirName(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf("/")
  return index >= 0 ? normalized.slice(0, index) : ""
}

function truncateReferenceTitle(title: string, maxLen = 20): string {
  return title.length > maxLen ? `${title.slice(0, maxLen)}...` : title
}

function createPageReferenceToken(page: WikiPageInfo): ReferenceToken {
  return {
    id: globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2),
    category: page.type,
    title: page.title,
    path: page.path,
    displayTitle: truncateReferenceTitle(page.title),
  }
}

async function getUniquePagePath(dir: string, fileName: string, excludePath?: string): Promise<string> {
  const firstPath = `${dir}/${fileName}`
  if (firstPath === excludePath || !(await fileExists(firstPath))) return firstPath

  const extensionIndex = fileName.lastIndexOf(".")
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ""
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${dir}/${stem}-${index}${extension}`
    if (candidate === excludePath || !(await fileExists(candidate))) return candidate
  }

  return `${dir}/${stem}-${Date.now()}${extension}`
}

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
      continue
    }
    if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function flattenAllFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenAllFiles(node.children))
      continue
    }
    if (!node.is_dir) files.push(node)
  }
  return files
}

function flattenFolders(nodes: FileNode[]): FileNode[] {
  const folders: FileNode[] = []
  for (const node of nodes) {
    if (!node.is_dir) continue
    folders.push(node)
    if (node.children) folders.push(...flattenFolders(node.children))
  }
  return folders
}

function getRelativePath(path: string, rootPath: string): string {
  const normalizedPath = normalizePath(path)
  const normalizedRoot = normalizePath(rootPath)
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath.split("/").pop() ?? ""
}

async function cleanupDeletedSourceMemory(
  projectPath: string,
  input: { kind: "chapter" | "outline"; pagePath: string; content?: string },
): Promise<void> {
  const { deleteNovelSourceMemory } = await import("@/lib/novel/delete-source-memory")
  await deleteNovelSourceMemory(projectPath, input)
}

function parsePageInfo(path: string, fileName: string, content: string): WikiPageInfo | null {
  const normalizedPath = normalizePath(path)
  const type = normalizedPath.includes("/wiki/chapters/") ? "chapter" : normalizedPath.includes("/wiki/outlines/") ? "outline" : null
  if (!type) return null

  let title = fileName.replace(/\.md$/, "").replace(/-/g, " ")
  const tags: string[] = []
  let origin: string | undefined
  let status: ChapterStatus | undefined

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1]
    const titleMatch = frontmatter.match(/^title:\s*["']?(.+?)["']?\s*$/m)
    if (titleMatch?.[1]) title = titleMatch[1].trim()

    const tagsMatch = frontmatter.match(/^tags:\s*\[(.+?)\]/m)
    if (tagsMatch?.[1]) {
      tags.push(...tagsMatch[1].split(",").map((value) => value.trim().replace(/["']/g, "")))
    }

    const originMatch = frontmatter.match(/^origin:\s*(.+)$/m)
    if (originMatch?.[1]) origin = originMatch[1].trim()

    if (type === "chapter") {
      const statusMatch = frontmatter.match(/^chapter_status:\s*["']?(.+?)["']?\s*$/m)
      status = normalizeChapterStatus(statusMatch?.[1])
    }
  }

  if (title === fileName.replace(/\.md$/, "").replace(/-/g, " ")) {
    const headingMatch = content.match(/^#\s+(.+)$/m)
    if (headingMatch?.[1]) title = headingMatch[1].trim()
  }

  const wordCount = type === "chapter" ? countChapterBodyWords(content) : undefined
  const chapterNumber = type === "chapter"
    ? (extractChapterNumberFromContent(content) ?? extractPageOrderFromTitle(title) ?? undefined)
    : undefined

  return {
    path: normalizedPath,
    title,
    type,
    chapterNumber,
    tags,
    origin,
    status,
    statusLabel: status ? getChapterStatusLabel(status) : undefined,
    wordCount,
    wordCountLabel: typeof wordCount === "number" ? buildChapterWordCountLabel(wordCount) : undefined,
  }
}

function findNodeByPath(nodes: FileNode[], targetPath: string): FileNode | null {
  for (const node of nodes) {
    if (normalizePath(node.path) === targetPath) return node
    if (node.is_dir && node.children) {
      const childMatch = findNodeByPath(node.children, targetPath)
      if (childMatch) return childMatch
    }
  }
  return null
}

function sortFileNodes(
  nodes: readonly FileNode[],
  pageInfoByPath: Map<string, WikiPageInfo>,
  filterType: "chapter" | "outline",
): FileNode[] {
  return [...nodes].sort((left, right) => {
    if (left.is_dir && !right.is_dir) return -1
    if (!left.is_dir && right.is_dir) return 1
    if (left.is_dir && right.is_dir) return left.name.localeCompare(right.name, "zh-CN")

    const leftInfo = pageInfoByPath.get(normalizePath(left.path))
    const rightInfo = pageInfoByPath.get(normalizePath(right.path))
    if (filterType === "chapter" || filterType === "outline") {
      const leftOrder = leftInfo?.chapterNumber ?? extractPageOrderFromTitle(leftInfo?.title ?? left.name)
      const rightOrder = rightInfo?.chapterNumber ?? extractPageOrderFromTitle(rightInfo?.title ?? right.name)
      if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) {
        return leftOrder - rightOrder
      }
      if (leftOrder !== null && rightOrder === null) return -1
      if (leftOrder === null && rightOrder !== null) return 1
    }

    return (leftInfo?.title ?? left.name).localeCompare(rightInfo?.title ?? right.name, "zh-CN")
  })
}

function countMarkdownDescendants(node: FileNode): number {
  if (!node.is_dir) return node.name.endsWith(".md") ? 1 : 0
  return (node.children ?? []).reduce((total, child) => total + countMarkdownDescendants(child), 0)
}

export function KnowledgeTree({
  filterType,
  refreshKey,
  pendingPages = EMPTY_PENDING_PAGES,
  onRemovePendingPage,
  onRequestCreate,
  onSendToChat,
  onSendToOutline,
}: KnowledgeTreeProps) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const novelMode = useWikiStore((s) => s.novelMode)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const fileTree = useWikiStore((s) => s.fileTree)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const outlineTasks = useOutlineGenerationStore((s) => s.tasks)
  const outlineImportTasks = useImportProgressStore((s) => s.tasks)
  const [pages, setPages] = useState<WikiPageInfo[]>([])
  const [extractedOutlinePaths, setExtractedOutlinePaths] = useState<Set<string>>(() => new Set())
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({})
  const [armedPath, setArmedPath] = useState<string | null>(null)
  const [deletingPath, setDeletingPath] = useState<string | null>(null)
  const [createMenu, setCreateMenu] = useState<CreateMenuState | null>(null)
  const [pageMenu, setPageMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [renamingBusy, setRenamingBusy] = useState(false)
  const [renamingFolderPath, setRenamingFolderPath] = useState<string | null>(null)
  const [renameFolderValue, setRenameFolderValue] = useState("")
  const [renamingFolderBusy, setRenamingFolderBusy] = useState(false)
  const [moveMenuTarget, setMoveMenuTarget] = useState<string | null>(null)
  const [outlineDropFolderPath, setOutlineDropFolderPath] = useState<string | null>(null)
  const [chapterBatchMode, setChapterBatchMode] = useState(false)
  const [selectedChapterPaths, setSelectedChapterPaths] = useState<Set<string>>(() => new Set())
  const [dragSource, setDragSource] = useState<string | null>(null)
  const [dragInsertIndex, setDragInsertIndex] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragSourceRef = useRef<string | null>(null)
  const dragInsertIndexRef = useRef<number | null>(null)
  const outlineDropFolderPathRef = useRef<string | null>(null)
  const renameFolderValueRef = useRef("")
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const pendingPointerPositionRef = useRef<{ x: number; y: number } | null>(null)
  const lastPointerTypeRef = useRef<string>("mouse")
  const removeGlobalPointerListenersRef = useRef<(() => void) | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { dragSourceRef.current = dragSource }, [dragSource])
  useEffect(() => { dragInsertIndexRef.current = dragInsertIndex }, [dragInsertIndex])
  useEffect(() => { outlineDropFolderPathRef.current = outlineDropFolderPath }, [outlineDropFolderPath])
  useEffect(() => { renameFolderValueRef.current = renameFolderValue }, [renameFolderValue])
  const loadPages = useCallback(async () => {
    if (!project) return
    const projectPath = normalizePath(project.path)
    try {
      const wikiTree = await listDirectory(`${projectPath}/wiki`)
      const nextPages: WikiPageInfo[] = []
      for (const file of flattenMdFiles(wikiTree)) {
        if (file.name === "index.md" || file.name === "log.md") continue
        try {
          const content = await readFile(file.path)
          const info = parsePageInfo(file.path, file.name, content)
          if (info) nextPages.push(info)
        } catch {
          // Ignore unreadable pages in the navigator.
        }
      }
      setPages(nextPages)
    } catch (error) {
      console.error("[KnowledgeTree] loadPages failed:", error)
      setPages([])
    }
  }, [project])

  useEffect(() => {
    void loadPages()
  }, [loadPages, fileTree, dataVersion, refreshKey])

  useEffect(() => {
    if (!armedPath) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (containerRef.current?.contains(target)) return
      setArmedPath(null)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setArmedPath(null)
    }

    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [armedPath])

  useEffect(() => {
    const closeMenus = () => {
      setCreateMenu(null)
      setPageMenu(null)
    }
    document.addEventListener("mousedown", closeMenus)
    document.addEventListener("keydown", closeMenus)
    return () => {
      document.removeEventListener("mousedown", closeMenus)
      document.removeEventListener("keydown", closeMenus)
    }
  }, [])

  const pageInfoByPath = useMemo(() => {
    const map = new Map<string, WikiPageInfo>()
    for (const page of pages) {
      if (page.type === filterType) map.set(page.path, page)
    }
    for (const page of pendingPages) {
      if (page.type === filterType) map.set(normalizePath(page.path), page)
    }
    return map
  }, [filterType, pages, pendingPages])

  const effectivePages = useMemo(() => [...pageInfoByPath.values()], [pageInfoByPath])

  const outlinePages = useMemo(
    () => effectivePages.filter((page): page is WikiPageInfo & { type: "outline" } => page.type === "outline"),
    [effectivePages],
  )

  useEffect(() => {
    if (!project || filterType !== "outline" || !novelMode) {
      setExtractedOutlinePaths(new Set())
      return
    }
    let cancelled = false
    void (async () => {
      const extracted = new Set<string>()
      await Promise.all(outlinePages.map(async (page) => {
        if (await outlineSnapshotExists(project.path, page.path)) {
          extracted.add(normalizePath(page.path))
        }
      }))
      if (!cancelled) setExtractedOutlinePaths(extracted)
    })()
    return () => {
      cancelled = true
    }
  }, [filterType, novelMode, outlinePages, project, dataVersion, outlineTasks, outlineImportTasks])

  const isOutlinePathIngesting = useCallback((outlinePath: string) => {
    if (!project) return false
    const normalizedPath = normalizePath(outlinePath)
    const fileName = getOutlineFileName(normalizedPath)
    const pp = normalizePath(project.path)
    const importRunning = outlineImportTasks.find((task) => (
      task.projectPath === pp &&
      task.kind === "outline" &&
      task.status === "running"
    ))
    if (importRunning) {
      if (importRunning.total === 1 && importRunning.currentTitle === fileName) return true
      if (importRunning.activeTitles?.includes(fileName)) return true
    }
    return outlineTasks.some((task) => (
      task.projectPath === pp &&
      task.kind === "ingest" &&
      task.outlinePath != null &&
      normalizePath(task.outlinePath) === normalizedPath &&
      task.status === "ingesting"
    ))
  }, [outlineImportTasks, outlineTasks, project])

  const handleOutlineIngest = useCallback((outlinePath: string) => {
    if (!project || !novelMode || isOutlinePathIngesting(outlinePath)) return
    startOutlineIngestTask(project.path, outlinePath)
  }, [isOutlinePathIngesting, novelMode, project])

  const sortedChapterPages = useMemo(() => {
    return effectivePages
      .filter((page): page is WikiPageInfo & { type: "chapter" } => page.type === "chapter")
      .sort((left, right) => {
        const leftOrder = left.chapterNumber ?? extractPageOrderFromTitle(left.title)
        const rightOrder = right.chapterNumber ?? extractPageOrderFromTitle(right.title)
        if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) return leftOrder - rightOrder
        if (leftOrder !== null && rightOrder === null) return -1
        if (leftOrder === null && rightOrder !== null) return 1
        return left.title.localeCompare(right.title, "zh-CN")
      })
  }, [effectivePages])

  const selectableChapterPaths = useMemo(() => sortedChapterPages.map((page) => page.path), [sortedChapterPages])
  const selectedChapterCount = selectedChapterPaths.size
  const allChaptersSelected = selectableChapterPaths.length > 0
    && selectableChapterPaths.every((path) => selectedChapterPaths.has(path))

  useEffect(() => {
    if (filterType !== "chapter") {
      setChapterBatchMode(false)
      setSelectedChapterPaths((previous) => previous.size > 0 ? new Set() : previous)
      return
    }

    const validPaths = new Set(selectableChapterPaths)
    setSelectedChapterPaths((previous) => {
      const next = new Set<string>()
      for (const path of previous) {
        if (validPaths.has(path)) next.add(path)
      }
      return next.size === previous.size ? previous : next
    })
  }, [filterType, selectableChapterPaths])

  const sectionRootPath = useMemo(() => {
    if (!project) return null
    return `${normalizePath(project.path)}/wiki/${filterType === "chapter" ? "chapters" : "outlines"}`
  }, [filterType, project])

  const sectionNodes = useMemo(() => {
    if (!sectionRootPath) return []
    const sectionNode = findNodeByPath(fileTree, sectionRootPath)
    return sectionNode?.children ?? []
  }, [fileTree, sectionRootPath])

  const volumeFolders = useMemo(() => {
    return sectionNodes.filter((node) => node.is_dir).map((node) => ({
      name: node.name,
      path: normalizePath(node.path),
    }))
  }, [sectionNodes])

  const outlineFolders = useMemo(() => {
    return flattenFolders(sectionNodes).map((node) => ({
      name: node.name,
      path: normalizePath(node.path),
    }))
  }, [sectionNodes])

  const refreshCurrentTree = useCallback(async () => {
    if (!project) return
    await loadPages()
    const tree = await listDirectory(normalizePath(project.path))
    setFileTree(tree)
    bumpDataVersion()
  }, [bumpDataVersion, loadPages, project, setFileTree])

  const handleMovePagesToFolder = useCallback(async (sourcePaths: string[], targetFolderPath: string) => {
    if (!project) return
    const normalizedTargetFolderPath = normalizePath(targetFolderPath)
    const normalizedSources = Array.from(new Set(sourcePaths.map((sourcePath) => normalizePath(sourcePath))))
    const plans: Array<{ source: string; dest: string }> = []
    const plannedDestinations = new Set<string>()

    for (const normalizedSource of normalizedSources) {
      if (getDirName(normalizedSource) === normalizedTargetFolderPath) continue
      const fileName = normalizedSource.split("/").pop()
      if (!fileName) continue
      const destPath = `${normalizedTargetFolderPath}/${fileName}`
      if (normalizedSource === destPath) continue

      if (plannedDestinations.has(destPath) || await fileExists(destPath)) {
        window.alert(t("knowledgeTree.moveTargetExists", { defaultValue: "目标文件已存在，请先改名或选择其他文件夹。" }))
        return
      }

      plannedDestinations.add(destPath)
      plans.push({ source: normalizedSource, dest: destPath })
    }

    if (plans.length === 0) {
      setMoveMenuTarget(null)
      setPageMenu(null)
      return
    }

    try {
      await createDirectory(normalizedTargetFolderPath).catch(() => {})
      for (const plan of plans) {
        await copyFile(plan.source, plan.dest)
        await deleteFile(plan.source)
        onRemovePendingPage?.(plan.source)
      }

      await refreshCurrentTree()
      const selectedMove = selectedFile ? plans.find((plan) => plan.source === normalizePath(selectedFile)) : undefined
      if (selectedMove) {
        setSelectedFile(selectedMove.dest)
      }
    } catch (error) {
      console.error("[KnowledgeTree] move to folder failed:", error)
      window.alert("移动失败，请稍后重试。")
    } finally {
      setMoveMenuTarget(null)
      setPageMenu(null)
      setOutlineDropFolderPath(null)
    }
  }, [project, onRemovePendingPage, refreshCurrentTree, selectedFile, setSelectedFile, t])

  const handleMoveChaptersToVolume = useCallback(async (sourcePaths: string[], targetVolumePath: string) => {
    if (!project) return
    const normalizedTargetVolumePath = normalizePath(targetVolumePath)
    const normalizedSources = Array.from(new Set(sourcePaths.map((sourcePath) => normalizePath(sourcePath))))
    const plans: Array<{ source: string; dest: string }> = []
    const plannedDestinations = new Set<string>()

    for (const normalizedSource of normalizedSources) {
      if (getDirName(normalizedSource) === normalizedTargetVolumePath) continue
      const fileName = normalizedSource.split("/").pop()
      if (!fileName) continue

      const destPath = `${normalizedTargetVolumePath}/${fileName}`
      if (normalizedSource === destPath) continue

      if (plannedDestinations.has(destPath) || await fileExists(destPath)) {
        window.alert(t("knowledgeTree.moveTargetExists"))
        return
      }

      plannedDestinations.add(destPath)
      plans.push({ source: normalizedSource, dest: destPath })
    }

    if (plans.length === 0) {
      setMoveMenuTarget(null)
      setPageMenu(null)
      return
    }

    try {
      for (const plan of plans) {
        await copyFile(plan.source, plan.dest)
        await deleteFile(plan.source)
      }

      await refreshCurrentTree()
      setSelectedChapterPaths(new Set())
      setChapterBatchMode(false)
      const selectedMove = selectedFile ? plans.find((plan) => plan.source === normalizePath(selectedFile)) : undefined
      if (selectedMove) {
        setSelectedFile(selectedMove.dest)
      }
    } catch (error) {
      console.error("[KnowledgeTree] move to volume failed:", error)
    } finally {
      setMoveMenuTarget(null)
      setPageMenu(null)
    }
  }, [project, t, refreshCurrentTree, selectedFile, setSelectedFile])

  const handleExtractAllChapterMemories = useCallback(async () => {
    if (!project || filterType !== "chapter") return
    const chapterPaths = sortedChapterPages.map((page) => page.path)
    if (chapterPaths.length === 0) {
      window.alert("当前没有可提取的章节。")
      return
    }

    const projectPath = normalizePath(project.path)
    const abortController = new AbortController()
    const taskId = useImportProgressStore.getState().startTask({
      projectPath,
      kind: "chapter",
      total: chapterPaths.length,
      currentTitle: sortedChapterPages[0]?.title ?? "",
      message: "正在一键提取所有章节记忆",
      abortController,
    })

    let completed = 0
    let failed = 0
    const titleByPath = new Map(sortedChapterPages.map((page) => [page.path, page.title]))

    try {
      const { ingestChapter } = await import("@/lib/novel/chapter-ingest")
      for (const chapterPath of chapterPaths) {
        if (abortController.signal.aborted) {
          useImportProgressStore.getState().finishTask(taskId, "cancelled", {
            completed,
            total: chapterPaths.length,
            currentTitle: "",
            message: `已取消章节记忆提取，已完成 ${completed}/${chapterPaths.length} 个章节。`,
          })
          return
        }

        useImportProgressStore.getState().updateTask(taskId, {
          completed,
          total: chapterPaths.length,
          currentTitle: titleByPath.get(chapterPath) ?? chapterPath,
        })

        const page = sortedChapterPages.find((item) => item.path === chapterPath)
        const result = await ingestChapter(
          projectPath,
          chapterPath,
          undefined,
          abortController.signal,
          page?.chapterNumber,
          { allowDraft: true },
        )
        if (result.snapshot) {
          completed += 1
        } else {
          failed += 1
        }
      }

      useImportProgressStore.getState().finishTask(taskId, failed > 0 ? "error" : "done", {
        completed,
        total: chapterPaths.length,
        currentTitle: "",
        message: failed > 0
          ? `章节记忆提取完成：成功 ${completed} 个，失败 ${failed} 个。`
          : `章节记忆提取完成：成功 ${completed} 个章节。`,
      })
      await loadPages()
      const tree = await listDirectory(projectPath)
      setFileTree(tree)
      bumpDataVersion()
    } catch (error) {
      if (abortController.signal.aborted) {
        useImportProgressStore.getState().finishTask(taskId, "cancelled", {
          completed,
          total: chapterPaths.length,
          currentTitle: "",
          message: `已取消章节记忆提取，已完成 ${completed}/${chapterPaths.length} 个章节。`,
        })
        return
      }
      console.error("[KnowledgeTree] extract all chapter memories failed:", error)
      useImportProgressStore.getState().finishTask(taskId, "error", {
        completed,
        total: chapterPaths.length,
        currentTitle: "",
        message: `章节记忆提取失败：已完成 ${completed}/${chapterPaths.length} 个章节。`,
      })
    } finally {
      setPageMenu(null)
    }
  }, [project, filterType, sortedChapterPages, loadPages, setFileTree, bumpDataVersion])

  const toggleChapterSelection = useCallback((pagePath: string) => {
    const normalizedPath = normalizePath(pagePath)
    setSelectedChapterPaths((previous) => {
      const next = new Set(previous)
      if (next.has(normalizedPath)) next.delete(normalizedPath)
      else next.add(normalizedPath)
      return next
    })
  }, [])

  const handleToggleAllChapters = useCallback(() => {
    setSelectedChapterPaths((previous) => {
      if (selectableChapterPaths.length > 0 && selectableChapterPaths.every((path) => previous.has(path))) {
        return new Set()
      }
      return new Set(selectableChapterPaths)
    })
  }, [selectableChapterPaths])

  const exitChapterBatchMode = useCallback(() => {
    setChapterBatchMode(false)
    setSelectedChapterPaths(new Set())
  }, [])

  const handleDeleteClick = useCallback(async (pagePath: string) => {
    if (!project) return
    if (armedPath !== pagePath) {
      setArmedPath(pagePath)
      return
    }

    setArmedPath(null)
    setDeletingPath(pagePath)
    try {
      const projectPath = normalizePath(project.path)
      let sourceContent: string | undefined
      if (filterType === "chapter") {
        try {
          sourceContent = await readFile(pagePath)
        } catch { /* ignore */ }
      }
      await moveFileToTrash(projectPath, pagePath, filterType)
      try {
        await cleanupDeletedSourceMemory(projectPath, {
          kind: filterType,
          pagePath,
          content: sourceContent,
        })
      } catch (e) {
        // 记忆清理失败不影响文件删除本身
        console.warn("[KnowledgeTree] 清理关联记忆失败:", e)
      }
      await loadPages()
      onRemovePendingPage?.(pagePath)
      const tree = await listDirectory(projectPath)
      setFileTree(tree)
      bumpDataVersion()
      if (selectedFile === pagePath) setSelectedFile(null)
    } catch (error) {
      console.error("[KnowledgeTree] delete failed:", error)
    } finally {
      setDeletingPath(null)
    }
  }, [project, armedPath, filterType, loadPages, onRemovePendingPage, setFileTree, bumpDataVersion, selectedFile, setSelectedFile])

  const handleDeleteFolder = useCallback(async (folderPath: string) => {
    if (!project) return

    const normalizedFolderPath = normalizePath(folderPath)
    const folderNode = findNodeByPath(sectionNodes, normalizedFolderPath)
    if (!folderNode?.is_dir) return

    const mdFiles = flattenMdFiles([folderNode]).map((file) => normalizePath(file.path))
    const folderName = folderNode.name
    const fileKind = filterType === "chapter" ? "chapter" : "outline"
    const confirmed = window.confirm(
      mdFiles.length > 0
        ? t("knowledgeTree.deleteFolderConfirm", { name: folderName, count: mdFiles.length })
        : t("knowledgeTree.deleteEmptyFolderConfirm", { name: folderName }),
    )
    if (!confirmed) return

    setArmedPath(null)
    setDeletingPath(normalizedFolderPath)
    try {
      const projectPath = normalizePath(project.path)
      for (const filePath of mdFiles) {
        try {
          await moveFileToTrash(projectPath, filePath, fileKind)
          await cleanupDeletedSourceMemory(projectPath, {
            kind: fileKind,
            pagePath: filePath,
          })
        } catch (e) {
          // 单个文件删除失败不影响整体流程（如文件已不存在的幽灵条目）
          console.warn("[KnowledgeTree] 删除文件失败，继续处理下一个:", filePath, e)
        }
        onRemovePendingPage?.(filePath)
      }

      // 尝试删除文件夹：如果目录不存在或已空，直接删除；
      // 这样能清理掉那些文件已丢失、只剩空壳目录的幽灵条目
      try {
        const remainingNodes = await listDirectory(normalizedFolderPath).catch(() => [])
        if (flattenAllFiles(remainingNodes).length === 0) {
          await deleteFile(normalizedFolderPath)
        } else {
          window.alert(t("knowledgeTree.deleteFolderBlocked", { name: folderName }))
        }
      } catch {
        // 目录可能已经不存在了，直接视为删除成功
      }

      await loadPages()
      const tree = await listDirectory(projectPath)
      setFileTree(tree)
      bumpDataVersion()
      if (selectedFile?.startsWith(`${normalizedFolderPath}/`)) {
        setSelectedFile(null)
      }
    } catch (error) {
      console.error("[KnowledgeTree] folder delete failed:", error)
    } finally {
      setDeletingPath(null)
    }
  }, [project, filterType, sectionNodes, t, loadPages, setFileTree, bumpDataVersion, selectedFile, setSelectedFile, onRemovePendingPage])

  const startRenameFolder = useCallback((folderPath: string, folderName: string) => {
    setCreateMenu(null)
    setPageMenu(null)
    setIsDragging(false)
    setDragSource(null)
    setDragInsertIndex(null)
    setOutlineDropFolderPath(null)
    dragSourceRef.current = null
    dragInsertIndexRef.current = null
    if (dragTimerRef.current) {
      clearTimeout(dragTimerRef.current)
      dragTimerRef.current = null
    }
    removeGlobalPointerListenersRef.current?.()
    removeGlobalPointerListenersRef.current = null
    activePointerIdRef.current = null
    pendingPointerPositionRef.current = null
    setRenamingFolderPath(normalizePath(folderPath))
    setRenameFolderValue(folderName)
  }, [])

  const submitRenameFolder = useCallback(async () => {
    if (!project || !renamingFolderPath || renamingFolderBusy) return
    const newName = renameFolderValueRef.current.trim()
    if (!newName) {
      setRenamingFolderPath(null)
      setRenameFolderValue("")
      return
    }

    const folderNode = findNodeByPath(sectionNodes, renamingFolderPath)
    if (!folderNode?.is_dir || folderNode.name === newName) {
      setRenamingFolderPath(null)
      setRenameFolderValue("")
      return
    }

    const targetFolderPath = `${getDirName(renamingFolderPath)}/${makeSafeFileSlug(newName, "folder")}`
    if (targetFolderPath !== renamingFolderPath && await fileExists(targetFolderPath)) {
      window.alert("目标文件夹已存在，请换一个名称。")
      return
    }

    setRenamingFolderBusy(true)
    try {
      await createDirectory(targetFolderPath)
      const mdFiles = flattenMdFiles([folderNode])
      for (const file of mdFiles) {
        const sourcePath = normalizePath(file.path)
        const relativePath = getRelativePath(sourcePath, renamingFolderPath)
        const destPath = `${targetFolderPath}/${relativePath}`
        await createDirectory(getDirName(destPath)).catch(() => {})
        if (await fileExists(destPath)) {
          window.alert("目标文件已存在，请先改名或选择其他文件夹。")
          return
        }
        await copyFile(sourcePath, destPath)
      }

      for (const file of mdFiles) {
        await deleteFile(normalizePath(file.path))
        onRemovePendingPage?.(normalizePath(file.path))
      }
      await deleteFile(renamingFolderPath)

      await refreshCurrentTree()
      if (selectedFile?.startsWith(`${renamingFolderPath}/`)) {
        setSelectedFile(`${targetFolderPath}/${getRelativePath(selectedFile, renamingFolderPath)}`)
      }
    } catch (error) {
      console.error("[KnowledgeTree] folder rename failed:", error)
      window.alert("重命名文件夹失败，请稍后重试。")
    } finally {
      setRenamingFolderBusy(false)
      setRenamingFolderPath(null)
      setRenameFolderValue("")
    }
  }, [project, renamingFolderPath, renamingFolderBusy, renameFolderValue, sectionNodes, refreshCurrentTree, selectedFile, setSelectedFile, onRemovePendingPage])

  const cancelRenameFolder = useCallback(() => {
    if (renamingFolderBusy) return
    setRenamingFolderPath(null)
    setRenameFolderValue("")
  }, [renamingFolderBusy])

  const updatePageTitleContent = useCallback((content: string, newTitle: string, newChapterNumber?: number | null) => {
    const escapedTitle = newTitle.replace(/"/g, '\\"')
    let next = content
    const frontmatterMatch = next.match(/^---\n([\s\S]*?)\n---/)
    if (frontmatterMatch) {
      let frontmatterBody = frontmatterMatch[1]
      if (/^title:\s*.*$/m.test(frontmatterBody)) {
        frontmatterBody = frontmatterBody.replace(/^title:\s*.*$/m, `title: "${escapedTitle}"`)
      } else {
        frontmatterBody = `${frontmatterBody}\ntitle: "${escapedTitle}"`
      }
      if (typeof newChapterNumber === "number" && newChapterNumber > 0) {
        if (/^chapter_number:\s*.*$/m.test(frontmatterBody)) {
          frontmatterBody = frontmatterBody.replace(/^chapter_number:\s*.*$/m, `chapter_number: ${newChapterNumber}`)
        } else {
          frontmatterBody = `${frontmatterBody}\nchapter_number: ${newChapterNumber}`
        }
      }
      next = next.replace(/^---\n[\s\S]*?\n---/, `---\n${frontmatterBody}\n---`)
    }
    if (/^#\s+.+$/m.test(next)) {
      next = next.replace(/^#\s+.+$/m, `# ${newTitle}`)
    }
    return next
  }, [])

  const updateChapterNumberContent = useCallback((content: string, newChapterNumber: number) => {
    if (!Number.isFinite(newChapterNumber) || newChapterNumber <= 0) return content

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (!frontmatterMatch) {
      return `---\nchapter_number: ${newChapterNumber}\n---\n${content}`
    }

    let frontmatterBody = frontmatterMatch[1]
    if (/^chapter_number:\s*.*$/m.test(frontmatterBody)) {
      frontmatterBody = frontmatterBody.replace(/^chapter_number:\s*.*$/m, `chapter_number: ${newChapterNumber}`)
    } else {
      frontmatterBody = `${frontmatterBody}\nchapter_number: ${newChapterNumber}`
    }

    return content.replace(/^---\n[\s\S]*?\n---/, `---\n${frontmatterBody}\n---`)
  }, [])

  const startRenamePage = useCallback((page: WikiPageInfo) => {
    setPageMenu(null)
    setIsDragging(false)
    setDragSource(null)
    setDragInsertIndex(null)
    dragSourceRef.current = null
    dragInsertIndexRef.current = null
    if (dragTimerRef.current) {
      clearTimeout(dragTimerRef.current)
      dragTimerRef.current = null
    }
    removeGlobalPointerListenersRef.current?.()
    removeGlobalPointerListenersRef.current = null
    activePointerIdRef.current = null
    pendingPointerPositionRef.current = null
    setRenamingPath(page.path)
    setRenameValue(page.title)
  }, [])

  const submitRenamePage = useCallback(async () => {
    if (!renamingPath || renamingBusy) return
    const newTitle = renameValue.trim()
    if (!newTitle) {
      setRenamingPath(null)
      setRenameValue("")
      return
    }

    const current = effectivePages.find((page) => page.path === renamingPath)
    if (!current || current.title === newTitle) {
      setRenamingPath(null)
      setRenameValue("")
      return
    }

    setRenamingBusy(true)
    try {
      const duplicate = effectivePages.some((page) => page.path !== renamingPath && page.type === current.type && page.title.trim() === newTitle)
      if (duplicate) return

      const content = await readFile(renamingPath)
      const oldChapterNumber = extractChapterNumberFromContent(content) ?? extractPageOrderFromTitle(current.title)
      const userChapterNumber = extractPageOrderFromTitle(newTitle)
      const chapterNumber = (current.type === "chapter" && userChapterNumber !== null) ? userChapterNumber : oldChapterNumber
      const chapterNumberConflict = current.type === "chapter"
        && typeof chapterNumber === "number"
        && effectivePages.some((page) => (
          page.path !== renamingPath
          && page.type === "chapter"
          && page.chapterNumber === chapterNumber
        ))
      if (chapterNumberConflict) return
      const normalizedTitle = current.type === "chapter" && chapterNumber
        ? makeDefaultChapterTitle(chapterNumber, newTitle)
        : newTitle
      const nextContent = updatePageTitleContent(content, normalizedTitle, current.type === "chapter" ? chapterNumber : null)
      const targetFileName = current.type === "chapter"
        ? makeChapterFileName(normalizedTitle, chapterNumber)
        : `${makeSafeFileSlug(newTitle)}.md`
      const targetPath = await getUniquePagePath(getDirName(renamingPath), targetFileName, renamingPath)

      await writeFile(targetPath, nextContent)
      if (targetPath !== renamingPath) {
        await deleteFile(renamingPath)
        if (selectedFile === renamingPath) setSelectedFile(targetPath)
        onRemovePendingPage?.(renamingPath)
      }

      await loadPages()
      if (project) {
        const tree = await listDirectory(normalizePath(project.path))
        setFileTree(tree)
      }
      bumpDataVersion()
    } catch (error) {
      console.error("[KnowledgeTree] rename failed:", error)
    } finally {
      setRenamingBusy(false)
      setRenamingPath(null)
      setRenameValue("")
    }
  }, [renamingPath, renamingBusy, renameValue, effectivePages, updatePageTitleContent, selectedFile, setSelectedFile, onRemovePendingPage, loadPages, project, setFileTree, bumpDataVersion])

  const cancelRenamePage = useCallback(() => {
    if (renamingBusy) return
    setRenamingPath(null)
    setRenameValue("")
  }, [renamingBusy])

  const executeChapterReorder = useCallback(async (sourcePath: string, targetIndex: number) => {
    if (!project) return

    const sourceIndex = sortedChapterPages.findIndex((page) => page.path === sourcePath)
    if (sourceIndex < 0) return

    const effectiveTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
    if (sourceIndex === effectiveTarget) return

    const reordered = [...sortedChapterPages]
    const [moved] = reordered.splice(sourceIndex, 1)
    reordered.splice(effectiveTarget, 0, moved)

    try {
      const writes: { path: string; content: string; nextNumber: number }[] = []
      for (let i = 0; i < reordered.length; i += 1) {
        const page = reordered[i]
        const nextNumber = i + 1
        const currentNumber = page.chapterNumber ?? extractPageOrderFromTitle(page.title)
        if (currentNumber === nextNumber) continue

        const content = await readFile(page.path)
        writes.push({ path: page.path, content, nextNumber })
      }

      if (writes.length === 0) return

      const appliedWrites: { path: string; content: string }[] = []
      try {
        for (const item of writes) {
          await writeFile(item.path, updateChapterNumberContent(item.content, item.nextNumber))
          appliedWrites.push({ path: item.path, content: item.content })
        }
      } catch (error) {
        for (const item of appliedWrites.reverse()) {
          try {
            await writeFile(item.path, item.content)
          } catch {
            // Ignore rollback failures and preserve the original error.
          }
        }
        throw error
      }

      await loadPages()
      const tree = await listDirectory(normalizePath(project.path))
      setFileTree(tree)
      bumpDataVersion()
    } catch (error) {
      console.error("[KnowledgeTree] chapter reorder failed:", error)
    }
  }, [project, sortedChapterPages, updateChapterNumberContent, loadPages, setFileTree, bumpDataVersion])

  const finishDragInteraction = useCallback(() => {
    if (dragTimerRef.current) {
      clearTimeout(dragTimerRef.current)
      dragTimerRef.current = null
    }

    const sourcePath = dragSourceRef.current
    const targetIndex = dragInsertIndexRef.current
    const targetFolderPath = outlineDropFolderPathRef.current

    removeGlobalPointerListenersRef.current?.()
    removeGlobalPointerListenersRef.current = null
    activePointerIdRef.current = null
    pendingPointerPositionRef.current = null
    dragSourceRef.current = null
    dragInsertIndexRef.current = null
    outlineDropFolderPathRef.current = null
    setIsDragging(false)
    setDragSource(null)
    setDragInsertIndex(null)
    setOutlineDropFolderPath(null)

    if (filterType === "outline" && sourcePath && targetFolderPath) {
      void handleMovePagesToFolder([sourcePath], targetFolderPath)
      return
    }

    if (filterType === "chapter" && sourcePath && targetIndex !== null) {
      void executeChapterReorder(sourcePath, targetIndex)
    }
  }, [executeChapterReorder, filterType, handleMovePagesToFolder])

  const updateDragTargetFromPoint = useCallback((clientX: number, clientY: number) => {
    const target = document.elementFromPoint(clientX, clientY)
    if (filterType === "outline") {
      const folderRow = target instanceof HTMLElement ? target.closest<HTMLElement>("[data-folder-path]") : null
      const folderPath = folderRow?.dataset.folderPath
      const sourcePath = dragSourceRef.current
      const nextFolderPath = folderPath && sourcePath && getDirName(sourcePath) !== folderPath
        ? folderPath
        : null
      outlineDropFolderPathRef.current = nextFolderPath
      setOutlineDropFolderPath(nextFolderPath)
      return
    }

    const row = target instanceof HTMLElement ? target.closest<HTMLElement>("[data-page-path]") : null
    if (!row) return

    const pagePath = row.dataset.pagePath
    if (!pagePath) return

    const rowIndex = sortedChapterPages.findIndex((page) => page.path === pagePath)
    if (rowIndex < 0) return

    const rect = row.getBoundingClientRect()
    const isBottomHalf = (clientY - rect.top) >= rect.height / 2
    const insertIndex = isBottomHalf ? rowIndex + 1 : rowIndex

    dragInsertIndexRef.current = insertIndex
    setDragInsertIndex(insertIndex)
  }, [filterType, sortedChapterPages])

  const handleContainerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return

    pendingPointerPositionRef.current = { x: event.clientX, y: event.clientY }
    if (!dragSourceRef.current) return

    updateDragTargetFromPoint(event.clientX, event.clientY)
  }, [updateDragTargetFromPoint])

  const handleItemPointerDown = useCallback((event: React.PointerEvent, pagePath: string) => {
    if ((filterType !== "chapter" && filterType !== "outline") || renamingPath || renamingFolderPath) return

    lastPointerTypeRef.current = event.pointerType || "mouse"
    if (event.pointerType !== "mouse") {
      event.preventDefault()
      return
    }

    if (event.button !== 0 || selectedFile !== pagePath || isDragging) return

    event.preventDefault()
    dragTimerRef.current && clearTimeout(dragTimerRef.current)
    activePointerIdRef.current = event.pointerId
    pendingPointerPositionRef.current = { x: event.clientX, y: event.clientY }

    removeGlobalPointerListenersRef.current?.()
    const handlePointerFinish = (pointerEvent: PointerEvent) => {
      if (activePointerIdRef.current !== pointerEvent.pointerId) return
      pendingPointerPositionRef.current = { x: pointerEvent.clientX, y: pointerEvent.clientY }
      finishDragInteraction()
    }
    const handleGlobalPointerMove = (pointerEvent: PointerEvent) => {
      if (activePointerIdRef.current !== pointerEvent.pointerId) return
      pendingPointerPositionRef.current = { x: pointerEvent.clientX, y: pointerEvent.clientY }
      if (!dragSourceRef.current) return
      updateDragTargetFromPoint(pointerEvent.clientX, pointerEvent.clientY)
      pointerEvent.preventDefault()
    }
    window.addEventListener("pointerup", handlePointerFinish)
    window.addEventListener("pointercancel", handlePointerFinish)
    window.addEventListener("pointermove", handleGlobalPointerMove)
    removeGlobalPointerListenersRef.current = () => {
      window.removeEventListener("pointerup", handlePointerFinish)
      window.removeEventListener("pointercancel", handlePointerFinish)
      window.removeEventListener("pointermove", handleGlobalPointerMove)
    }

    dragTimerRef.current = setTimeout(() => {
      dragTimerRef.current = null
      dragSourceRef.current = pagePath
      setDragSource(pagePath)
      setIsDragging(true)

      const pointerPosition = pendingPointerPositionRef.current
      if (pointerPosition) {
        updateDragTargetFromPoint(pointerPosition.x, pointerPosition.y)
      }
    }, 300)
  }, [filterType, renamingPath, renamingFolderPath, selectedFile, isDragging, finishDragInteraction, updateDragTargetFromPoint])

  const handlePageClick = useCallback((pagePath: string) => {
    setArmedPath(null)
    if (renamingPath === pagePath) return
    setSelectedFile(pagePath)
    // 保存最后阅读的章节路径，用于启动时自动打开（仅章节保存，大纲不保存）
    if (pagePath.replace(/\\/g, "/").includes("/wiki/chapters/")) {
      saveLastReadChapter(pagePath).catch(() => {})
    }
    // 同时保存到sessionStorage，用于视图切换时恢复章节定位
    if (pagePath.replace(/\\/g, "/").includes("/wiki/chapters/")) {
      try {
        sessionStorage.setItem("lk-last-chapter-path", pagePath)
      } catch { /* ignore quota errors */ }
    }
  }, [renamingPath, setSelectedFile])

  const toggleFolder = useCallback((folderPath: string) => {
    setCollapsedFolders((previous) => ({ ...previous, [folderPath]: !previous[folderPath] }))
  }, [])

  const openCreateMenu = useCallback((event: React.MouseEvent, parentDir?: string, targetFolderName?: string) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = containerRef.current?.getBoundingClientRect()
    setCreateMenu({
      parentDir,
      targetFolderName,
      targetFolderPath: parentDir,
      x: rect ? event.clientX - rect.left : event.clientX,
      y: rect ? event.clientY - rect.top : event.clientY,
    })
    setPageMenu(null)
  }, [])

  const openPageMenu = useCallback((event: React.MouseEvent, pagePath: string) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = containerRef.current?.getBoundingClientRect()
    setPageMenu({
      path: pagePath,
      x: rect ? event.clientX - rect.left : event.clientX,
      y: rect ? event.clientY - rect.top : event.clientY,
    })
    setCreateMenu(null)
  }, [])

  const handlePageContextMenu = useCallback((event: React.MouseEvent, pagePath: string) => {
    if (filterType === "chapter" && lastPointerTypeRef.current !== "mouse") {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    openPageMenu(event, pagePath)
  }, [filterType, openPageMenu])

  const handleBlankContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest("[data-knowledge-interactive='true']")) return
    openCreateMenu(event)
  }, [openCreateMenu])

  useEffect(() => {
    const container = containerRef.current
    if (!container || filterType !== "chapter") return

    const handleSelectStart = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!target.closest("[data-page-path]")) return
      event.preventDefault()
    }

    container.addEventListener("selectstart", handleSelectStart)
    return () => {
      container.removeEventListener("selectstart", handleSelectStart)
    }
  }, [filterType])

  useEffect(() => {
    return () => {
      if (dragTimerRef.current) {
        clearTimeout(dragTimerRef.current)
        dragTimerRef.current = null
      }
      removeGlobalPointerListenersRef.current?.()
      removeGlobalPointerListenersRef.current = null
      activePointerIdRef.current = null
      pendingPointerPositionRef.current = null
    }
  }, [])

  const rootLabel = filterType === "chapter" ? t("sidebar.knowledge") : t("sidebar.files")
  const emptyLabel = filterType === "chapter"
    ? t("knowledgeTree.emptyFiltered", { label: t("trash.kindChapter") })
    : t("knowledgeTree.emptyFiltered", { label: t("trash.kindOutline") })

  const renderNodes = useCallback((nodes: FileNode[], depth = 0) => {
    const chapterIndexMap = new Map<string, number>()
    sortedChapterPages.forEach((page, index) => chapterIndexMap.set(page.path, index))

    return sortFileNodes(nodes, pageInfoByPath, filterType).flatMap((node) => {
      const normalizedPath = normalizePath(node.path)
      if (node.is_dir) {
        const isCollapsed = collapsedFolders[normalizedPath] ?? false
        const isRenamingFolder = renamingFolderPath === normalizedPath
        const isOutlineDropTarget = outlineDropFolderPath === normalizedPath
        const folderRow = (
          <div key={normalizedPath}>
            <div
              data-knowledge-interactive="true"
              data-folder-path={normalizedPath}
              className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground qm-hover ${isOutlineDropTarget ? "ring-2 ring-primary/50" : ""}`}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
              onContextMenu={(event) => openCreateMenu(event, normalizedPath, node.name)}
            >
              <button
                type="button"
                onClick={() => {
                  if (!isRenamingFolder) toggleFolder(normalizedPath)
                }}
                disabled={isRenamingFolder}
                className="flex flex-1 items-center gap-1.5 text-left"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                )}
                <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                {isRenamingFolder ? (
                  <input
                    type="text"
                    value={renameFolderValue}
              onChange={(event) => {
                setRenameFolderValue(event.target.value)
                renameFolderValueRef.current = event.target.value
              }}
              onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onFocus={(event) => event.stopPropagation()}
                    onBlur={() => void submitRenameFolder()}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                      if (event.key === "Enter") {
                        event.preventDefault()
                        void submitRenameFolder()
                      } else if (event.key === "Escape") {
                        event.preventDefault()
                        cancelRenameFolder()
                      }
                    }}
                    className="min-w-0 flex-1 rounded border bg-background px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                    autoFocus
                    disabled={renamingFolderBusy}
                  />
                ) : (
                  <span className="truncate font-medium">{node.name}</span>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground/60">{countMarkdownDescendants(node)}</span>
              </button>
            </div>
            {!isCollapsed && node.children && renderNodes(node.children, depth + 1)}
          </div>
        )
        return [folderRow]
      }

      if (!node.name.endsWith(".md")) return []
      const page = pageInfoByPath.get(normalizedPath) ?? {
        path: normalizedPath,
        title: node.name.replace(/\.md$/, "").replace(/-/g, " "),
        type: filterType,
        tags: [],
      }
      const isSelected = selectedFile === normalizedPath
      const isChapterChecked = filterType === "chapter" && selectedChapterPaths.has(normalizedPath)
      const isArmed = armedPath === normalizedPath
      const isDeleting = deletingPath === normalizedPath
      const isDragSource = dragSource === normalizedPath
      const chapterIndex = chapterIndexMap.get(normalizedPath)
      const isInsertTarget = isDragging && dragInsertIndex !== null && chapterIndex !== undefined && chapterIndex === dragInsertIndex && !isDragSource
      const isOutlineExtracted = filterType === "outline" && extractedOutlinePaths.has(normalizedPath)
      const isOutlineIngesting = filterType === "outline" && isOutlinePathIngesting(normalizedPath)
      return [
        <div
          key={normalizedPath}
          data-knowledge-interactive="true"
          data-page-path={normalizedPath}
          className={`group flex items-center gap-1 rounded-md ${isSelected ? "qm-selected" : "qm-hover"} ${isChapterChecked ? "ring-1 ring-primary/35" : ""} ${isDragSource ? "ring-2 ring-primary/50" : ""} ${isInsertTarget ? "border-t-[3px] border-primary/70" : ""}`}
          onContextMenu={(event) => handlePageContextMenu(event, normalizedPath)}
          onPointerDown={(event) => handleItemPointerDown(event, normalizedPath)}
          style={{
            marginLeft: `${depth * 16}px`,
            userSelect: filterType === "chapter" ? "none" : undefined,
            WebkitUserSelect: filterType === "chapter" ? "none" : undefined,
            WebkitTouchCallout: filterType === "chapter" ? "none" : undefined,
          }}
        >
          {filterType === "chapter" && chapterBatchMode && (
            <input
              type="checkbox"
              checked={isChapterChecked}
              aria-label={t("knowledgeTree.selectChapter", { title: page.title })}
              className="ml-1 h-3.5 w-3.5 shrink-0 accent-primary"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                event.stopPropagation()
                toggleChapterSelection(normalizedPath)
              }}
            />
          )}
          <button
            type="button"
            onClick={() => handlePageClick(normalizedPath)}
            disabled={renamingPath === normalizedPath}
            className={`flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1 text-left text-sm ${
              isSelected ? "qm-selected-muted" : "text-muted-foreground group-hover:text-foreground"
            }`}
            title={normalizedPath}
          >
            {page.origin === "web-clip" ? <Globe className="h-3 w-3 shrink-0 text-blue-400" /> : <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            {renamingPath === normalizedPath ? (
              <input
                type="text"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onFocus={(event) => event.stopPropagation()}
                onBlur={() => void submitRenamePage()}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void submitRenamePage()
                  } else if (event.key === "Escape") {
                    event.preventDefault()
                    cancelRenamePage()
                  }
                }}
                className="w-full rounded border bg-background px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                autoFocus
                disabled={renamingBusy}
              />
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate">{page.title}</span>
                {page.type === "chapter" && page.wordCountLabel && (
                  <span className={`shrink-0 text-right text-[11px] ${isSelected ? "qm-selected-muted" : "text-muted-foreground"}`}>
                    {page.wordCountLabel}
                  </span>
                )}
              </>
            )}
          </button>
          {filterType === "outline" && novelMode ? (
            <Button
              variant="ghost"
              size="icon"
              className={`mr-0 h-7 w-7 shrink-0 ${isOutlineExtracted ? "text-emerald-600 hover:text-emerald-700" : ""}`}
              title={isOutlineExtracted ? t("novel.outlineGenerator.reingestTitle") : t("novel.outlineGenerator.ingest")}
              disabled={isOutlineIngesting}
              onClick={(event) => {
                event.stopPropagation()
                handleOutlineIngest(normalizedPath)
              }}
            >
              {isOutlineIngesting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isOutlineExtracted ? (
                <Check className="h-4 w-4" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
            </Button>
          ) : null}
          <DeleteButton
            armed={isArmed}
            deleting={isDeleting}
            className={`mr-1 transition-opacity ${isArmed || isDeleting ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            onClick={() => void handleDeleteClick(normalizedPath)}
            name={page.title}
          />
        </div>,
      ]
    })
  }, [
    pageInfoByPath,
    filterType,
    collapsedFolders,
    selectedFile,
    armedPath,
    deletingPath,
    renamingPath,
    renameValue,
    renamingBusy,
    renamingFolderPath,
    renameFolderValue,
    renamingFolderBusy,
    outlineDropFolderPath,
    openCreateMenu,
    toggleFolder,
    submitRenamePage,
    cancelRenamePage,
    submitRenameFolder,
    cancelRenameFolder,
    handleDeleteClick,
    handleItemPointerDown,
    handlePageContextMenu,
    handlePageClick,
    chapterBatchMode,
    selectedChapterPaths,
    toggleChapterSelection,
    dragSource,
    dragInsertIndex,
    isDragging,
    sortedChapterPages,
    novelMode,
    extractedOutlinePaths,
    isOutlinePathIngesting,
    handleOutlineIngest,
    t,
  ])

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        {t("knowledgeTree.noProject")}
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div
        ref={containerRef}
        className="relative flex min-h-full flex-col p-2 select-none"
        style={{
          userSelect: filterType === "chapter" ? "none" : undefined,
          WebkitUserSelect: filterType === "chapter" ? "none" : undefined,
          WebkitTouchCallout: filterType === "chapter" ? "none" : undefined,
        }}
        onClick={() => {
          setCreateMenu(null)
          setPageMenu(null)
        }}
        onContextMenu={handleBlankContextMenu}
        onPointerMove={handleContainerPointerMove}
      >
        <div className="mb-2 flex items-center justify-between gap-2 px-2 text-xs font-semibold uppercase text-muted-foreground">
          <span>{rootLabel}</span>
        </div>
        {filterType === "chapter" && chapterBatchMode && selectableChapterPaths.length > 0 && (
          <div className="mb-2 flex items-center gap-2 px-2 text-xs">
            <button
              type="button"
              className="rounded border px-2 py-1 hover:bg-accent"
              onClick={(event) => {
                event.stopPropagation()
                handleToggleAllChapters()
              }}
            >
              {allChaptersSelected ? t("knowledgeTree.clearChapterSelection") : t("knowledgeTree.selectAllChapters")}
            </button>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {selectedChapterCount > 0
                ? t("knowledgeTree.selectedChapters", { count: selectedChapterCount })
                : t("knowledgeTree.selectChaptersHint")}
            </span>
            {selectedChapterCount > 0 && volumeFolders.length > 0 && (
              <select
                aria-label={t("knowledgeTree.moveSelectedToVolume")}
                value=""
                className="h-7 max-w-[120px] rounded border bg-background px-2 text-xs"
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => {
                  const targetVolumePath = event.target.value
                  if (targetVolumePath) {
                    void handleMoveChaptersToVolume(Array.from(selectedChapterPaths), targetVolumePath)
                  }
                }}
              >
                <option value="">{t("knowledgeTree.moveSelectedToVolume")}</option>
                {volumeFolders.map((vol) => (
                  <option key={vol.path} value={vol.path}>{vol.name}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="rounded border px-2 py-1 hover:bg-accent"
              onClick={(event) => {
                event.stopPropagation()
                exitChapterBatchMode()
              }}
            >
              {t("knowledgeTree.exitBatchMode")}
            </button>
          </div>
        )}
        {sectionNodes.length === 0 && pendingPages.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">{emptyLabel}</div>
        ) : (
          renderNodes(sectionNodes)
        )}

        {createMenu && (
          <div
            className="absolute z-20 w-40 rounded-md border bg-background py-1 text-xs shadow-lg"
            style={{ left: createMenu.x, top: createMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
              onClick={() => {
                onRequestCreate?.({ kind: filterType, parentDir: createMenu.parentDir })
                setCreateMenu(null)
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {filterType === "chapter" ? t("sidebar.newChapter") : t("sidebar.newOutline")}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
              onClick={() => {
                onRequestCreate?.({ kind: filterType === "chapter" ? "volume" : "folder", parentDir: createMenu.parentDir })
                setCreateMenu(null)
              }}
            >
              <Folder className="h-3.5 w-3.5" />
              {filterType === "chapter" ? t("sidebar.newVolume") : t("sidebar.newFolder")}
            </button>
            {createMenu.targetFolderPath ? (
              <>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                  onClick={() => {
                    const targetFolderPath = createMenu.targetFolderPath
                    const targetFolderName = createMenu.targetFolderName
                    setCreateMenu(null)
                    if (targetFolderPath && targetFolderName) {
                      startRenameFolder(targetFolderPath, targetFolderName)
                    }
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {t("knowledgeTree.rename")}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-destructive hover:bg-accent"
                  onClick={() => {
                    const targetFolderPath = createMenu.targetFolderPath
                    setCreateMenu(null)
                    if (targetFolderPath) {
                      void handleDeleteFolder(targetFolderPath)
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {filterType === "chapter" ? t("knowledgeTree.deleteVolume") : t("knowledgeTree.deleteFolder")}
                </button>
              </>
            ) : null}
          </div>
        )}

        {pageMenu && (
          <div
            className="absolute z-20 w-48 rounded-md border bg-background py-1 text-xs shadow-lg"
            style={{ left: pageMenu.x, top: pageMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
              onClick={() => {
                const target = pageInfoByPath.get(pageMenu.path)
                onRequestCreate?.({ kind: filterType, parentDir: target ? getDirName(target.path) : undefined })
                setPageMenu(null)
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {filterType === "chapter" ? t("sidebar.newChapter") : t("sidebar.newOutline")}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
              onClick={() => {
                const target = pageInfoByPath.get(pageMenu.path)
                onRequestCreate?.({
                  kind: filterType === "chapter" ? "volume" : "folder",
                  parentDir: target ? getDirName(target.path) : undefined,
                })
                setPageMenu(null)
              }}
            >
              <Folder className="h-3.5 w-3.5" />
              {filterType === "chapter" ? t("sidebar.newVolume") : t("sidebar.newFolder")}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
              onClick={() => {
                const target = pageInfoByPath.get(pageMenu.path)
                if (target) startRenamePage(target)
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
              {t("knowledgeTree.rename")}
            </button>
            {filterType === "chapter" && volumeFolders.length > 0 && (
              <div>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                  onClick={() => setMoveMenuTarget(moveMenuTarget === pageMenu.path ? null : pageMenu.path)}
                >
                  <FolderInput className="h-3.5 w-3.5" />
                  {t("knowledgeTree.moveToVolume")}
                  <ChevronRight className="ml-auto h-3 w-3" />
                </button>
                {moveMenuTarget === pageMenu.path && (
                  <div className="max-h-48 overflow-y-auto border-t bg-background py-1 text-xs">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                      onClick={() => {
                        setChapterBatchMode(true)
                        setSelectedChapterPaths(new Set())
                        setMoveMenuTarget(null)
                        setPageMenu(null)
                      }}
                    >
                      <Check className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span>{t("knowledgeTree.batchChapters")}</span>
                    </button>
                    {volumeFolders.map((vol) => {
                      const sourcePaths = selectedChapterPaths.has(pageMenu.path)
                        ? Array.from(selectedChapterPaths)
                        : [pageMenu.path]
                      const isCurrentVolume = sourcePaths.every((sourcePath) => getDirName(sourcePath) === vol.path)
                      return (
                        <button
                          key={vol.path}
                          type="button"
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent ${isCurrentVolume ? "opacity-50 cursor-not-allowed" : ""}`}
                          disabled={isCurrentVolume}
                          onClick={() => {
                            if (!isCurrentVolume) {
                              void handleMoveChaptersToVolume(sourcePaths, vol.path)
                            }
                          }}
                        >
                          <Folder className="h-3 w-3 shrink-0 text-amber-500" />
                          <span className="truncate">{vol.name}</span>
                          {isCurrentVolume && <span className="ml-auto text-[10px] text-muted-foreground">当前</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
            {filterType === "outline" && outlineFolders.length > 0 && (
              <div>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                  onClick={() => setMoveMenuTarget(moveMenuTarget === pageMenu.path ? null : pageMenu.path)}
                >
                  <FolderInput className="h-3.5 w-3.5" />
                  移动
                  <ChevronRight className="ml-auto h-3 w-3" />
                </button>
                {moveMenuTarget === pageMenu.path && (
                  <div className="max-h-48 overflow-y-auto border-t bg-background py-1 text-xs">
                    {outlineFolders.map((folder) => {
                      const isCurrentFolder = getDirName(pageMenu.path) === folder.path
                      return (
                        <button
                          key={folder.path}
                          type="button"
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent ${isCurrentFolder ? "opacity-50 cursor-not-allowed" : ""}`}
                          disabled={isCurrentFolder}
                          onClick={() => {
                            if (!isCurrentFolder) {
                              void handleMovePagesToFolder([pageMenu.path], folder.path)
                            }
                          }}
                        >
                          <Folder className="h-3 w-3 shrink-0 text-amber-500" />
                          <span className="truncate">{folder.name}</span>
                          {isCurrentFolder && <span className="ml-auto text-[10px] text-muted-foreground">当前</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
            {filterType === "chapter" && pageMenu && (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                onClick={() => void handleExtractAllChapterMemories()}
              >
                <BookOpen className="h-3.5 w-3.5" />
                一键提取所有章节
              </button>
            )}
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
              onClick={() => {
                openFileLocation(pageMenu.path).catch((err) => console.error("打开文件位置失败:", err))
              }}
            >
              <FolderOpen className="h-4 w-4" />
              打开文件所在位置
            </button>
            {((filterType === "chapter" && (onSendToChat || onSendToOutline)) || (filterType === "outline" && onSendToOutline)) && (
              <div className="mt-1 border-t pt-1">
                {filterType === "chapter" && onSendToChat && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                    onClick={() => {
                      const target = pageInfoByPath.get(pageMenu.path)
                      if (target) onSendToChat(createPageReferenceToken(target))
                      setPageMenu(null)
                    }}
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    发送到AI会话
                  </button>
                )}
                {filterType === "chapter" && onSendToOutline && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                    onClick={() => {
                      const target = pageInfoByPath.get(pageMenu.path)
                      if (target) onSendToOutline(createPageReferenceToken(target))
                      setPageMenu(null)
                    }}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    发送到AI大纲
                  </button>
                )}
                {filterType === "outline" && onSendToOutline && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                    onClick={() => {
                      const target = pageInfoByPath.get(pageMenu.path)
                      if (target) onSendToOutline(createPageReferenceToken(target))
                      setPageMenu(null)
                    }}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    发送到对话
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

export function RawSourcesSection({ onCancelExtraction }: { onCancelExtraction?: () => void }) {
  const project = useWikiStore((s) => s.project)
  const tasks = useImportProgressStore((s) => s.tasks)
  const [expanded, setExpanded] = useState(false)

  const projectTasks = useMemo(() => {
    if (!project) return []
    const projectPath = normalizePath(project.path)
    return tasks
      .filter((task) => task.projectPath === projectPath)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [project, tasks])

  const runningTasks = projectTasks.filter((t) => t.status === "running")
  const hasRunning = runningTasks.length > 0
  const hasAnyTask = projectTasks.length > 0

  useEffect(() => {
    if (hasRunning) setExpanded(true)
  }, [hasRunning])

  return (
    <div className="shrink-0 border-t bg-background/95 p-2 backdrop-blur">
      <button
        type="button"
        onClick={() => setExpanded((previous) => !previous)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm qm-hover"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-amber-600" />
        <span className="flex-1 text-left font-medium text-muted-foreground">提取中</span>
        {hasRunning ? (
          <span className="text-xs text-primary">{runningTasks.length} 个任务运行中</span>
        ) : null}
      </button>
      {expanded && (
        <div className="ml-3 max-h-64 space-y-2 overflow-y-auto pr-1 text-xs text-muted-foreground">
          {hasAnyTask ? (
            projectTasks.slice(0, 20).map((task) => {
              const kindLabel = task.kind === "outline" ? "AI 大纲" : "章节"
              const progressPercent = task.total > 0
                ? Math.round((task.completed / task.total) * 100)
                : 0
              const isRunning = task.status === "running"
              return (
                <div key={task.id} className="space-y-1 rounded-md bg-muted/30 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate flex items-center gap-1">
                      {isRunning ? (
                        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                      ) : task.status === "done" ? (
                        <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                      ) : task.status === "error" ? (
                        <X className="h-3 w-3 shrink-0 text-destructive" />
                      ) : task.status === "cancelled" ? (
                        <X className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : null}
                      <span className={isRunning ? "text-foreground font-medium" : ""}>
                        {isRunning
                          ? formatImportProgressRunningLabel(task, kindLabel)
                          : task.status === "done"
                            ? (task.message || `${kindLabel}提取完成`)
                            : task.status === "error"
                              ? (task.message || `${kindLabel}提取失败`)
                              : task.status === "cancelled"
                                ? (task.message || `${kindLabel}提取已取消`)
                                : task.message ?? ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {isRunning && (
                        <>
                          <span className="text-muted-foreground">{progressPercent}%</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-5 px-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                            onClick={() => {
                              useImportProgressStore.getState().cancelTask(task.id)
                              onCancelExtraction?.()
                            }}
                            disabled={task.cancelling}
                          >
                            停止
                          </Button>
                        </>
                      )}
                    </span>
                  </div>
                  {isRunning && (
                    <div className="h-1 overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  )}
                  {isRunning && (
                    <span className="text-muted-foreground">
                      {formatImportProgressDetail(task)}
                    </span>
                  )}
                </div>
              )
            })
          ) : (
            <div className="rounded-md bg-muted/40 px-2 py-2">暂无提取任务</div>
          )}
        </div>
      )}
    </div>
  )
}

function DeleteButton({
  armed,
  deleting,
  onClick,
  name,
  className = "",
}: {
  armed: boolean
  deleting: boolean
  onClick: () => void
  name: string
  className?: string
}) {
  const { t } = useTranslation()

  if (deleting) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className={`h-6 w-6 shrink-0 cursor-default ${className}`}
        disabled
        title={t("knowledgeTree.deletingTitle", { name })}
      >
        <Trash2 className="h-3 w-3 animate-pulse text-destructive" />
      </Button>
    )
  }

  if (armed) {
    return (
      <Button
        variant="destructive"
        size="sm"
        className={`h-6 shrink-0 px-1.5 text-[10px] font-semibold animate-pulse ${className}`}
        onClick={(event) => {
          event.stopPropagation()
          onClick()
        }}
        title={t("knowledgeTree.confirmDeleteTitle", { name })}
      >
        <Trash2 className="mr-0.5 h-3 w-3" />
        {t("knowledgeTree.confirmDelete")}
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive ${className}`}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      title={t("knowledgeTree.deleteTitle", { name })}
    >
      <Trash2 className="h-3 w-3" />
    </Button>
  )
}
