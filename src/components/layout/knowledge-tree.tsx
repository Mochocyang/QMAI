import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { BookOpen, ChevronDown, ChevronRight, FileText, Folder, FolderInput, FolderOpen, Globe, Loader2, Pencil, Plus, Trash2, Check, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { useWikiStore } from "@/stores/wiki-store"
import { deleteFile, fileExists, listDirectory, readFile, writeFile, openFileLocation, copyFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { buildChapterWordCountLabel, getChapterStatusLabel } from "@/lib/chapter-display"
import { normalizePath } from "@/lib/path-utils"
import { countChapterBodyWords } from "@/lib/chapter-word-count"
import { normalizeChapterStatus, type ChapterStatus } from "@/lib/novel/chapter-meta"
import { moveFileToTrash } from "@/lib/trash"
import { makeChapterFileName, makeDefaultChapterTitle, makeSafeFileSlug } from "@/lib/wiki-filename"
import { useImportProgressStore } from "@/stores/import-progress-store"

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
}

interface CreateMenuState {
  x: number
  y: number
  parentDir?: string
  targetFolderName?: string
  targetFolderPath?: string
}

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
  pendingPages = [],
  onRemovePendingPage,
  onRequestCreate,
}: KnowledgeTreeProps) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const fileTree = useWikiStore((s) => s.fileTree)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const [pages, setPages] = useState<WikiPageInfo[]>([])
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({})
  const [armedPath, setArmedPath] = useState<string | null>(null)
  const [deletingPath, setDeletingPath] = useState<string | null>(null)
  const [createMenu, setCreateMenu] = useState<CreateMenuState | null>(null)
  const [pageMenu, setPageMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [renamingBusy, setRenamingBusy] = useState(false)
  const [moveMenuTarget, setMoveMenuTarget] = useState<string | null>(null)
  const [dragSource, setDragSource] = useState<string | null>(null)
  const [dragInsertIndex, setDragInsertIndex] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragSourceRef = useRef<string | null>(null)
  const dragInsertIndexRef = useRef<number | null>(null)
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const pendingPointerPositionRef = useRef<{ x: number; y: number } | null>(null)
  const lastPointerTypeRef = useRef<string>("mouse")
  const removeGlobalPointerListenersRef = useRef<(() => void) | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { dragSourceRef.current = dragSource }, [dragSource])
  useEffect(() => { dragInsertIndexRef.current = dragInsertIndex }, [dragInsertIndex])

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

  const handleMoveToVolume = useCallback(async (sourcePath: string, targetVolumePath: string) => {
    if (!project) return
    const normalizedSource = normalizePath(sourcePath)
    const fileName = normalizedSource.split("/").pop()
    if (!fileName) return

    const destPath = `${targetVolumePath}/${fileName}`
    if (normalizedSource === destPath) return

    if (await fileExists(destPath)) {
      window.alert(t("knowledgeTree.moveTargetExists"))
      return
    }

    try {
      await copyFile(normalizedSource, destPath)
      await deleteFile(normalizedSource)

      await loadPages()
      const tree = await listDirectory(normalizePath(project.path))
      setFileTree(tree)
      bumpDataVersion()
      if (selectedFile === normalizedSource) {
        setSelectedFile(destPath)
      }
    } catch (error) {
      console.error("[KnowledgeTree] move to volume failed:", error)
    } finally {
      setMoveMenuTarget(null)
      setPageMenu(null)
    }
  }, [project, t, loadPages, setFileTree, bumpDataVersion, selectedFile, setSelectedFile])

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

    removeGlobalPointerListenersRef.current?.()
    removeGlobalPointerListenersRef.current = null
    activePointerIdRef.current = null
    pendingPointerPositionRef.current = null
    dragSourceRef.current = null
    dragInsertIndexRef.current = null
    setIsDragging(false)
    setDragSource(null)
    setDragInsertIndex(null)

    if (sourcePath && targetIndex !== null) {
      void executeChapterReorder(sourcePath, targetIndex)
    }
  }, [executeChapterReorder])

  const updateDragInsertFromPoint = useCallback((clientX: number, clientY: number) => {
    const target = document.elementFromPoint(clientX, clientY)
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
  }, [sortedChapterPages])

  const handleContainerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return

    pendingPointerPositionRef.current = { x: event.clientX, y: event.clientY }
    if (!dragSourceRef.current) return

    updateDragInsertFromPoint(event.clientX, event.clientY)
  }, [updateDragInsertFromPoint])

  const handleItemPointerDown = useCallback((event: React.PointerEvent, pagePath: string) => {
    if (filterType !== "chapter" || renamingPath) return

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
      updateDragInsertFromPoint(pointerEvent.clientX, pointerEvent.clientY)
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
        updateDragInsertFromPoint(pointerPosition.x, pointerPosition.y)
      }
    }, 300)
  }, [filterType, renamingPath, selectedFile, isDragging, finishDragInteraction, updateDragInsertFromPoint])

  const handlePageClick = useCallback((pagePath: string) => {
    setArmedPath(null)
    if (renamingPath === pagePath) return
    setSelectedFile(pagePath)
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
        const folderRow = (
          <div key={normalizedPath}>
            <div
              data-knowledge-interactive="true"
              className="group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground qm-hover"
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
              onContextMenu={(event) => openCreateMenu(event, normalizedPath, node.name)}
            >
              <button
                type="button"
                onClick={() => toggleFolder(normalizedPath)}
                className="flex flex-1 items-center gap-1.5 text-left"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                )}
                <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                <span className="truncate font-medium">{node.name}</span>
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
      const isArmed = armedPath === normalizedPath
      const isDeleting = deletingPath === normalizedPath
      const isDragSource = dragSource === normalizedPath
      const chapterIndex = chapterIndexMap.get(normalizedPath)
      const isInsertTarget = isDragging && dragInsertIndex !== null && chapterIndex !== undefined && chapterIndex === dragInsertIndex && !isDragSource
      return [
        <div
          key={normalizedPath}
          data-knowledge-interactive="true"
          data-page-path={normalizedPath}
          className={`group flex items-center gap-1 rounded-md ${isSelected ? "qm-selected" : "qm-hover"} ${isDragSource ? "ring-2 ring-primary/50" : ""} ${isInsertTarget ? "border-t-[3px] border-primary/70" : ""}`}
          onContextMenu={(event) => handlePageContextMenu(event, normalizedPath)}
          onPointerDown={(event) => handleItemPointerDown(event, normalizedPath)}
          style={{
            marginLeft: `${depth * 16}px`,
            userSelect: filterType === "chapter" ? "none" : undefined,
            WebkitUserSelect: filterType === "chapter" ? "none" : undefined,
            WebkitTouchCallout: filterType === "chapter" ? "none" : undefined,
          }}
        >
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
    openCreateMenu,
    toggleFolder,
    submitRenamePage,
    cancelRenamePage,
    handleDeleteClick,
    handleItemPointerDown,
    handlePageContextMenu,
    handlePageClick,
    dragSource,
    dragInsertIndex,
    isDragging,
    sortedChapterPages,
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
        <div className="mb-2 px-2 text-xs font-semibold uppercase text-muted-foreground">{rootLabel}</div>
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
            ) : null}
          </div>
        )}

        {pageMenu && (
          <div
            className="absolute z-20 w-40 rounded-md border bg-background py-1 text-xs shadow-lg"
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
                    {volumeFolders.map((vol) => {
                      const sourceDir = getDirName(pageMenu.path)
                      const isCurrentVolume = sourceDir === vol.path
                      return (
                        <button
                          key={vol.path}
                          type="button"
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent ${isCurrentVolume ? "opacity-50 cursor-not-allowed" : ""}`}
                          disabled={isCurrentVolume}
                          onClick={() => {
                            if (!isCurrentVolume) {
                              void handleMoveToVolume(pageMenu.path, vol.path)
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
        <div className="ml-3 space-y-2 pr-1 text-xs text-muted-foreground">
          {hasAnyTask ? (
            projectTasks.slice(0, 20).map((task) => {
              const kindLabel =
              task.kind === "outline" ? "AI 大纲" :
                task.kind === "outline_generation" ? "生成大纲" :
                  task.kind === "outline_refinement" ? "细化生成" :
                    "章节"
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
                          ? task.cancelling
                            ? `正在取消${kindLabel}提取...`
                            : task.currentTitle || `${kindLabel}提取中`
                          : task.status === "done"
                            ? `${kindLabel}提取完成`
                            : task.status === "error"
                              ? `${kindLabel}提取失败`
                              : task.status === "cancelled"
                                ? `${kindLabel}提取已取消`
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
                  {isRunning && task.completed > 0 && (
                    <span className="text-muted-foreground">
                      {task.completed}/{task.total} · {kindLabel}
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
