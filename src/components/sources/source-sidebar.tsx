import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { Plus, FileText, Trash2, Folder, ChevronRight, ChevronDown, BookOpen, Check, Loader2 } from "lucide-react"
import { isTauri } from "@/lib/platform"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useWikiStore } from "@/stores/wiki-store"
import { copyFile, deleteFile, fileExists, listDirectory } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { useTranslation } from "react-i18next"
import { getFileName, getFileStem, normalizePath } from "@/lib/path-utils"
import { decideDeleteClick } from "@/lib/sources-tree-delete"
import { saveNovelConfig } from "@/lib/project-store"
import {
  deleteSourceFile,
  deleteSourceFolder,
  enqueueSourceIngest,
  importSourceFiles,
  importSourceFolder,
} from "@/lib/source-lifecycle"
import { getQueue } from "@/lib/ingest-queue"
import type { KnowledgeCreateRequest } from "@/components/layout/knowledge-tree"

const SOURCE_TREE_INITIAL_ROWS = 160
const SOURCE_TREE_LOAD_BATCH = 160

export function SourceSidebar({
  onRequestCreate,
}: {
  onRequestCreate?: (request: KnowledgeCreateRequest) => void
}) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const novelConfig = useWikiStore((s) => s.novelConfig)
  const setNovelConfig = useWikiStore((s) => s.setNovelConfig)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const [sources, setSources] = useState<FileNode[]>([])
  const [importing, setImporting] = useState(false)
  const [ingestingPath, setIngestingPath] = useState<string | null>(null)
  const [extractTaskIdsByPath, setExtractTaskIdsByPath] = useState<Record<string, string[]>>({})
  const [extractedPaths, setExtractedPaths] = useState<Set<string>>(() => new Set())
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null)
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const [createMenu, setCreateMenu] = useState<{ x: number; y: number } | null>(null)
  const [fileMenu, setFileMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [renamingBusy, setRenamingBusy] = useState(false)
  const importMenuRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const loadSources = useCallback(async () => {
    if (!project) return
    const pp = normalizePath(project.path)
    try {
      const tree = await listDirectory(`${pp}/raw/sources`)
      setSources(filterTree(tree))
    } catch {
      setSources([])
    }
  }, [project])

  useEffect(() => {
    void loadSources()
  }, [loadSources, dataVersion])

  useEffect(() => {
    if (!pendingDeletePath) return
    const timer = setTimeout(() => setPendingDeletePath(null), 5000)
    return () => clearTimeout(timer)
  }, [pendingDeletePath])

  useEffect(() => {
    if (!importMenuOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (importMenuRef.current?.contains(target)) return
      setImportMenuOpen(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImportMenuOpen(false)
    }
    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [importMenuOpen])

  useEffect(() => {
    if (!createMenu && !fileMenu) return
    const closeMenu = () => {
      setCreateMenu(null)
      setFileMenu(null)
    }
    document.addEventListener("mousedown", closeMenu)
    document.addEventListener("keydown", closeMenu)
    return () => {
      document.removeEventListener("mousedown", closeMenu)
      document.removeEventListener("keydown", closeMenu)
    }
  }, [createMenu, fileMenu])

  useEffect(() => {
    if (Object.keys(extractTaskIdsByPath).length === 0) return
    const timer = window.setInterval(() => {
      const queue = getQueue()
      const completed: string[] = []

      setExtractTaskIdsByPath((prev) => {
        let changed = false
        const next = { ...prev }
        for (const [path, ids] of Object.entries(prev)) {
          const tasks = ids.map((id) => queue.find((task) => task.id === id)).filter(Boolean)
          const failed = tasks.some((task) => task?.status === "failed")
          const stillActive = tasks.some((task) => task?.status === "pending" || task?.status === "processing")
          if (!stillActive) {
            delete next[path]
            changed = true
            if (!failed) completed.push(path)
          }
        }
        return changed ? next : prev
      })

      if (completed.length > 0) {
        setExtractedPaths((prev) => {
          const next = new Set(prev)
          for (const path of completed) next.add(path)
          return next
        })
      }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [extractTaskIdsByPath])

  const registerExtractTasks = useCallback((taskIdsByPath: Record<string, string[]>, importedPaths: string[] = []) => {
    const normalizedPaths = importedPaths.map(normalizePath)
    if (normalizedPaths.length > 0) {
      setExtractedPaths((prev) => {
        const next = new Set(prev)
        for (const path of normalizedPaths) next.delete(path)
        return next
      })
    }
    if (Object.keys(taskIdsByPath).length === 0) return
    setExtractTaskIdsByPath((prev) => ({ ...prev, ...taskIdsByPath }))
  }, [])

  async function handleToggleAutoExtract() {
    if (!project) return
    const nextValue = !novelConfig.autoExtractOnImport
    const nextConfig = { ...novelConfig, autoExtractOnImport: nextValue }
    setNovelConfig({ autoExtractOnImport: nextValue })
    try {
      await saveNovelConfig(nextConfig, project.id, project.path)
    } catch (err) {
      console.error("保存自动提取设置失败：", err)
    }
  }

  async function handleImportFiles() {
    if (!project) return
    if (!isTauri()) {
      window.alert("导入文件功能仅在桌面端可用")
      return
    }
    const { open } = await import("@tauri-apps/plugin-dialog")
    const selected = await open({
      multiple: true,
      title: t("sources.importSourceFiles"),
      filters: [
        { name: "文档", extensions: ["md", "mdx", "txt", "rtf", "pdf", "html", "htm", "xml", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "epub", "pages", "numbers", "key"] },
        { name: "数据文件", extensions: ["json", "jsonl", "csv", "tsv", "yaml", "yml", "ndjson"] },
        { name: "代码", extensions: ["py", "js", "ts", "jsx", "tsx", "rs", "go", "java", "c", "cpp", "h", "rb", "php", "swift", "sql", "sh"] },
        { name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "avif", "heic"] },
        { name: "媒体", extensions: ["mp4", "webm", "mov", "avi", "mkv", "mp3", "wav", "ogg", "flac", "m4a"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    })
    if (!selected || selected.length === 0) return

    setImporting(true)
    try {
      const paths = Array.isArray(selected) ? selected : [selected]
      const result = await importSourceFiles(project, paths, llmConfig, {
        autoExtract: novelConfig.autoExtractOnImport,
      })
      registerExtractTasks(result.taskIdsByPath, result.importedPaths)
      await loadSources()
    } finally {
      setImporting(false)
      setImportMenuOpen(false)
    }
  }

  async function handleImportFolder() {
    if (!project) return
    if (!isTauri()) {
      window.alert("导入文件夹功能仅在桌面端可用")
      return
    }
    const { open } = await import("@tauri-apps/plugin-dialog")
    const selected = await open({
      directory: true,
      title: t("sources.importSourceFolder"),
    })
    if (!selected || typeof selected !== "string") return

    setImporting(true)
    try {
      const result = await importSourceFolder(project, selected, llmConfig, {
        autoExtract: novelConfig.autoExtractOnImport,
      })
      registerExtractTasks(result.taskIdsByPath, result.importedPaths)
      await loadSources()
    } finally {
      setImporting(false)
      setImportMenuOpen(false)
    }
  }

  async function handleDelete(node: FileNode) {
    if (!project) return
    const pp = normalizePath(project.path)
    try {
      const result = await deleteSourceFile(pp, node.path)
      await loadSources()
      const tree = await listDirectory(pp)
      setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()
      if (selectedFile === node.path || result.deletedWikiPaths.includes(selectedFile ?? "")) {
        setSelectedFile(null)
      }
    } catch (err) {
      console.error("删除源文件失败：", err)
      window.alert(`删除失败：${err}`)
    }
  }

  async function handleDeleteFolder(folder: FileNode) {
    if (!project) return
    const pp = normalizePath(project.path)
    try {
      const result = await deleteSourceFolder(pp, folder)
      await loadSources()
      const tree = await listDirectory(pp)
      setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()
      if (selectedFile?.startsWith(folder.path + "/") || result.deletedWikiPaths.includes(selectedFile ?? "")) {
        setSelectedFile(null)
      }
    } catch (err) {
      console.error("删除文件夹失败：", err)
      window.alert(`删除文件夹失败：${err}`)
    }
  }

  async function handleIngest(node: FileNode) {
    if (!project || ingestingPath) return
    const normalizedNodePath = normalizePath(node.path)
    setIngestingPath(node.path)
    setExtractedPaths((prev) => {
      const next = new Set(prev)
      next.delete(normalizedNodePath)
      return next
    })
    try {
      const ids = await enqueueSourceIngest(project, [node.path], llmConfig)
      if (ids.length > 0) {
        setExtractTaskIdsByPath((prev) => ({ ...prev, [normalizedNodePath]: ids }))
      }
    } catch (err) {
      console.error("加入提取队列失败：", err)
    } finally {
      setIngestingPath(null)
    }
  }

  const openCreateMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = containerRef.current?.getBoundingClientRect()
    setCreateMenu({
      x: rect ? event.clientX - rect.left : event.clientX,
      y: rect ? event.clientY - rect.top : event.clientY,
    })
    setImportMenuOpen(false)
  }, [])

  const handleBlankContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest("[data-source-interactive='true']")) return
    openCreateMenu(event)
  }, [openCreateMenu])

  const startRename = useCallback((node: FileNode) => {
    setFileMenu(null)
    setRenamingPath(node.path)
    setRenameValue(getFileStem(node.name))
  }, [])

  const cancelRename = useCallback(() => {
    if (renamingBusy) return
    setRenamingPath(null)
    setRenameValue("")
  }, [renamingBusy])

  const submitRename = useCallback(async () => {
    if (!project || !renamingPath || renamingBusy) return
    const currentNode = findNodeByPath(sources, renamingPath)
    const nextStem = renameValue.trim()
    if (!currentNode || !nextStem) {
      cancelRename()
      return
    }

    const currentName = getFileName(currentNode.path)
    const extensionMatch = currentName.match(/(\.[^.]+)$/)
    const extension = extensionMatch?.[1] ?? ""
    const candidateName = nextStem.endsWith(extension) ? nextStem : `${nextStem}${extension}`
    const dir = normalizePath(currentNode.path).replace(/\/[^/]+$/, "")
    let targetPath = `${dir}/${candidateName}`
    if (normalizePath(targetPath) === normalizePath(currentNode.path)) {
      cancelRename()
      return
    }

    setRenamingBusy(true)
    try {
      if (await fileExists(targetPath)) {
        const stem = extension ? candidateName.slice(0, -extension.length) : candidateName
        let index = 2
        while (await fileExists(`${dir}/${stem}-${index}${extension}`)) {
          index += 1
        }
        targetPath = `${dir}/${stem}-${index}${extension}`
      }
      await copyFile(currentNode.path, targetPath)
      await deleteFile(currentNode.path)
      await loadSources()
      const pp = normalizePath(project.path)
      const tree = await listDirectory(pp)
      setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()
      if (selectedFile === currentNode.path) {
        setSelectedFile(targetPath)
      }
    } catch (error) {
      console.error("重命名源文件失败：", error)
      window.alert(`重命名失败：${error}`)
    } finally {
      setRenamingBusy(false)
      setRenamingPath(null)
      setRenameValue("")
    }
  }, [cancelRename, loadSources, project, renameValue, renamingBusy, renamingPath, selectedFile, setFileTree, setSelectedFile, sources])

  return (
    <TooltipProvider delay={300}>
      <div
        ref={containerRef}
        className="relative flex h-full flex-col"
        onClick={() => {
          setCreateMenu(null)
          setFileMenu(null)
        }}
        onContextMenu={handleBlankContextMenu}
      >
        <div className="border-b px-3 py-2">
          <div className="mb-2 text-sm font-semibold text-foreground">{t("sidebar.files")}</div>
          <div className="flex flex-wrap items-center gap-1" data-source-interactive="true">
            <div className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-1" data-source-interactive="true">
              <span className="text-[11px] text-muted-foreground">
                {t("novel.sources.autoExtract", { defaultValue: "自动提取" })}
              </span>
              <button
                type="button"
                onClick={() => void handleToggleAutoExtract()}
                className={`relative inline-flex h-4 w-8 shrink-0 rounded-full border border-transparent transition-colors ${
                  novelConfig.autoExtractOnImport ? "bg-primary" : "bg-input"
                }`}
                aria-pressed={novelConfig.autoExtractOnImport}
              >
                <span
                  className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-background shadow transition-transform ${
                    novelConfig.autoExtractOnImport ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            <div ref={importMenuRef} className="relative" data-source-interactive="true">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setImportMenuOpen((prev) => !prev)}
                disabled={importing}
                className="h-7 px-2 text-xs"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {importing ? t("sources.importing") : t("novel.sources.import", { defaultValue: "导入" })}
              </Button>
              {importMenuOpen ? (
                <div className="absolute left-0 top-full z-20 mt-1 w-32 rounded-md border bg-popover py-1 text-xs text-popover-foreground shadow-lg" data-source-interactive="true">
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left hover:bg-accent"
                    onClick={() => void handleImportFiles()}
                  >
                    {t("sources.importFiles")}
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left hover:bg-accent"
                    onClick={() => void handleImportFolder()}
                  >
                    {t("sources.importFolder")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {sources.length === 0 ? (
              <div className="px-2 py-4 text-sm text-muted-foreground">{t("novel.sources.noSources")}</div>
            ) : (
              <SourceTree
                nodes={sources}
                onOpen={(node) => setSelectedFile(node.path)}
                onIngest={handleIngest}
                onDelete={handleDelete}
                onDeleteFolder={handleDeleteFolder}
                pendingDeletePath={pendingDeletePath}
                setPendingDeletePath={setPendingDeletePath}
                ingestingPath={ingestingPath}
                extractTaskIdsByPath={extractTaskIdsByPath}
                extractedPaths={extractedPaths}
                renamingPath={renamingPath}
                renameValue={renameValue}
                setRenameValue={setRenameValue}
                renamingBusy={renamingBusy}
                onSubmitRename={submitRename}
                onCancelRename={cancelRename}
                onOpenFileMenu={(event, node) => {
                  event.preventDefault()
                  event.stopPropagation()
                  const rect = containerRef.current?.getBoundingClientRect()
                  setFileMenu({
                    path: node.path,
                    x: rect ? event.clientX - rect.left : event.clientX,
                    y: rect ? event.clientY - rect.top : event.clientY,
                  })
                  setCreateMenu(null)
                }}
              />
            )}
          </div>
        </ScrollArea>
        {createMenu ? (
          <div
            className="absolute z-20 w-40 rounded-md border bg-background py-1 text-xs shadow-lg"
            style={{ left: createMenu.x, top: createMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            data-source-interactive="true"
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
              onClick={() => {
                onRequestCreate?.({ kind: "outline" })
                setCreateMenu(null)
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("sidebar.newOutline")}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
              onClick={() => {
                onRequestCreate?.({ kind: "folder" })
                setCreateMenu(null)
              }}
            >
              <Folder className="h-3.5 w-3.5" />
              {t("sidebar.newFolder")}
            </button>
          </div>
        ) : null}
        {fileMenu ? (
          <div
            className="absolute z-20 w-40 rounded-md border bg-background py-1 text-xs shadow-lg"
            style={{ left: fileMenu.x, top: fileMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            data-source-interactive="true"
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
              onClick={() => {
                const node = findNodeByPath(sources, fileMenu.path)
                if (node && !node.is_dir) {
                  startRename(node)
                } else {
                  setFileMenu(null)
                }
              }}
            >
              {t("knowledgeTree.rename")}
            </button>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  )
}

interface SourceTreeRow {
  node: FileNode
  depth: number
}

function filterTree(nodes: FileNode[]): FileNode[] {
  return nodes
    .filter((n) => !n.name.startsWith("."))
    .map((n) => (n.is_dir && n.children ? { ...n, children: filterTree(n.children) } : n))
    .filter((n) => !n.is_dir || (n.children && n.children.length > 0))
}

function countFiles(nodes: FileNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.is_dir && node.children) count += countFiles(node.children)
    else if (!node.is_dir) count += 1
  }
  return count
}

function sortSourceNodes(nodes: readonly FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.is_dir && !b.is_dir) return -1
    if (!a.is_dir && b.is_dir) return 1
    return a.name.localeCompare(b.name, "zh-CN")
  })
}

function flattenVisibleRows(nodes: readonly FileNode[], collapsed: Record<string, boolean>, depth = 0): SourceTreeRow[] {
  const rows: SourceTreeRow[] = []
  for (const node of sortSourceNodes(nodes)) {
    rows.push({ node, depth })
    if (node.is_dir && node.children && !(collapsed[node.path] ?? false)) {
      rows.push(...flattenVisibleRows(node.children, collapsed, depth + 1))
    }
  }
  return rows
}

function findNodeByPath(nodes: readonly FileNode[], targetPath: string): FileNode | null {
  for (const node of nodes) {
    if (normalizePath(node.path) === normalizePath(targetPath)) return node
    if (node.is_dir && node.children) {
      const match = findNodeByPath(node.children, targetPath)
      if (match) return match
    }
  }
  return null
}

function SourceTree({
  nodes,
  onOpen,
  onIngest,
  onDelete,
  onDeleteFolder,
  pendingDeletePath,
  setPendingDeletePath,
  ingestingPath,
  extractTaskIdsByPath,
  extractedPaths,
  renamingPath,
  renameValue,
  setRenameValue,
  renamingBusy,
  onSubmitRename,
  onCancelRename,
  onOpenFileMenu,
}: {
  nodes: FileNode[]
  onOpen: (node: FileNode) => void
  onIngest: (node: FileNode) => void
  onDelete: (node: FileNode) => void
  onDeleteFolder: (node: FileNode) => void
  pendingDeletePath: string | null
  setPendingDeletePath: (path: string | null) => void
  ingestingPath: string | null
  extractTaskIdsByPath: Record<string, string[]>
  extractedPaths: Set<string>
  renamingPath: string | null
  renameValue: string
  setRenameValue: (value: string) => void
  renamingBusy: boolean
  onSubmitRename: () => void
  onCancelRename: () => void
  onOpenFileMenu: (event: React.MouseEvent, node: FileNode) => void
}) {
  const { t } = useTranslation()
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [visibleLimit, setVisibleLimit] = useState(SOURCE_TREE_INITIAL_ROWS)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const rows = useMemo(() => flattenVisibleRows(nodes, collapsed), [nodes, collapsed])
  const visibleRows = rows.slice(0, visibleLimit)
  const hasMore = visibleLimit < rows.length

  useEffect(() => {
    setVisibleLimit(SOURCE_TREE_INITIAL_ROWS)
  }, [nodes])

  useEffect(() => {
    if (!hasMore) return
    const target = loadMoreRef.current
    if (!target) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      setVisibleLimit((current) => Math.min(current + SOURCE_TREE_LOAD_BATCH, rows.length))
    }, { rootMargin: "240px 0px" })
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, rows.length])

  const handleDeleteClick = (node: FileNode) => {
    const action = decideDeleteClick(pendingDeletePath, node)
    switch (action.kind) {
      case "arm":
        setPendingDeletePath(action.path)
        return
      case "fire-file":
        setPendingDeletePath(null)
        onDelete(action.node)
        return
      case "fire-folder":
        setPendingDeletePath(null)
        onDeleteFolder(action.node)
        return
    }
  }

  return (
    <>
      {visibleRows.map(({ node, depth }) => {
        const isPendingDelete = pendingDeletePath === node.path
        if (node.is_dir && node.children) {
          const isCollapsed = collapsed[node.path] ?? false
          return (
            <div key={node.path}>
              <div
                data-source-interactive="true"
                className="group flex w-full items-center gap-1 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                style={{ paddingLeft: `${depth * 16 + 4}px` }}
              >
                <button
                  type="button"
                  onClick={() => setCollapsed((prev) => ({ ...prev, [node.path]: !prev[node.path] }))}
                  className="flex flex-1 items-center gap-1.5 px-1 py-1 text-left"
                >
                  {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                  <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                  <span className="truncate font-medium">{node.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">{countFiles(node.children)}</span>
                </button>
                <DeleteButton
                  isPending={isPendingDelete}
                  onClick={() => handleDeleteClick(node)}
                  hint={isPendingDelete ? t("sources.deleteFolderConfirm", { name: node.name }) : t("sources.deleteFolder", { name: node.name })}
                />
              </div>
            </div>
          )
        }

        const normalizedNodePath = normalizePath(node.path)
        const isSelected = selectedFile === node.path
        const isExtracting = ingestingPath === node.path || Boolean(extractTaskIdsByPath[normalizedNodePath]?.length)
        const isExtracted = !isExtracting && extractedPaths.has(normalizedNodePath)

        return (
          <div
            key={node.path}
            data-source-interactive="true"
            className={`flex w-full items-center gap-1 rounded-md px-1 py-1 text-sm transition-colors ${
              isSelected ? "qm-selected" : "text-muted-foreground qm-hover"
            }`}
            style={{ paddingLeft: `${depth * 16 + 4}px` }}
            onContextMenu={(event) => onOpenFileMenu(event, node)}
          >
            <button
              type="button"
              onClick={() => onOpen(node)}
              disabled={renamingPath === node.path}
              className="flex flex-1 items-center gap-2 truncate px-2 py-1 text-left"
            >
              <FileText className="h-4 w-4 shrink-0" />
              {renamingPath === node.path ? (
                <input
                  type="text"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  onFocus={(event) => event.stopPropagation()}
                  onBlur={() => void onSubmitRename()}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === "Enter") {
                      event.preventDefault()
                      void onSubmitRename()
                    } else if (event.key === "Escape") {
                      event.preventDefault()
                      onCancelRename()
                    }
                  }}
                  className="w-full rounded border bg-background px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                  disabled={renamingBusy}
                />
              ) : (
                <span className="truncate">{node.name}</span>
              )}
            </button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 shrink-0 ${isExtracted ? "text-emerald-600 hover:text-emerald-700" : ""}`}
              title={t("novel.outlineGenerator.ingest")}
              disabled={isExtracting}
              onClick={() => onIngest(node)}
            >
              {isExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : isExtracted ? <Check className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
            </Button>
            <DeleteButton
              isPending={isPendingDelete}
              onClick={() => handleDeleteClick(node)}
              hint={isPendingDelete ? t("sources.deleteFileConfirm", { name: node.name }) : t("sources.deleteFile", { name: node.name })}
            />
          </div>
        )
      })}
      {hasMore ? (
        <div ref={loadMoreRef} className="px-3 py-2 text-center text-[11px] text-muted-foreground">
          {t("sources.loadingMore")}
        </div>
      ) : null}
    </>
  )
}

function DeleteButton({
  isPending,
  onClick,
  hint,
}: {
  isPending: boolean
  onClick: () => void
  hint: string
}) {
  const { t } = useTranslation()
  if (isPending) {
    return (
      <Button
        variant="destructive"
        size="sm"
        className="h-7 shrink-0 px-2 text-[11px] font-semibold animate-pulse"
        title={hint}
        onClick={onClick}
      >
        <Trash2 className="mr-1 h-3.5 w-3.5" />
        {t("sources.confirm")}
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
      title={hint}
      onClick={onClick}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  )
}
