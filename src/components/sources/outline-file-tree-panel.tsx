import { useCallback, useEffect, useState } from "react"
import type { FileNode } from "@/types/wiki"
import { copyDirectory, copyFile, createDirectory, deleteFile, fileExists, listDirectory, writeFile } from "@/commands/fs"
import { useWikiStore } from "@/stores/wiki-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { OutlineFileTree } from "@/components/sources/outline-file-tree"
import {
  DEFAULT_OUTLINE_FOLDER_PATHS,
  DEFAULT_SETTING_FOLDER_NAMES,
  LEGACY_OUTLINE_FOLDER_MIGRATIONS,
  getDefaultOutlineFolderPath,
  getOutlineRoot,
  planOutlineFileMove,
} from "@/lib/novel/outline-workbench"
import { normalizePath } from "@/lib/path-utils"

interface OutlineFileTreePanelProps {
  showHeader?: boolean
}

function getDirName(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf("/")
  return index >= 0 ? normalized.slice(0, index) : ""
}

function ensureMarkdownFileName(name: string): string {
  const trimmed = name.trim()
  return trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`
}

function getBaseName(path: string): string {
  return normalizePath(path).split("/").pop() ?? ""
}

function assertSafeName(name: string, label: string) {
  if (!name || name.includes("/") || name.includes("\\")) {
    throw new Error(`${label}不能包含路径分隔符。`)
  }
}

async function resolveUniquePath(path: string): Promise<string> {
  if (!(await fileExists(path))) return path
  const normalized = normalizePath(path)
  const slashIndex = normalized.lastIndexOf("/")
  const dir = slashIndex >= 0 ? normalized.slice(0, slashIndex) : ""
  const name = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
  const dotIndex = name.lastIndexOf(".")
  const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name
  const ext = dotIndex > 0 ? name.slice(dotIndex) : ""
  for (let index = 2; index <= 99; index++) {
    const candidate = `${dir}/${stem}-${index}${ext}`
    if (!(await fileExists(candidate))) return candidate
  }
  return `${dir}/${stem}-${Date.now()}${ext}`
}

async function migrateNodeChildren(sourceNode: FileNode, targetDir: string) {
  await createDirectory(targetDir)
  for (const child of sourceNode.children ?? []) {
    if (child.is_dir) {
      const targetPath = `${targetDir}/${child.name}`
      await migrateNodeChildren(child, targetPath)
      await deleteFile(child.path)
    } else {
      const targetPath = await resolveUniquePath(`${targetDir}/${child.name}`)
      await copyFile(child.path, targetPath)
      await deleteFile(child.path)
    }
  }
}

async function migrateLegacyOutlineFolders(projectPath: string, nodes: FileNode[]): Promise<boolean> {
  const outlineRoot = getOutlineRoot(projectPath)
  let migrated = false
  for (const migration of LEGACY_OUTLINE_FOLDER_MIGRATIONS) {
    const source = nodes.find((node) => node.is_dir && node.name === migration.from)
    if (!source) continue
    const targetDir = `${outlineRoot}/${migration.to}`
    await migrateNodeChildren(source, targetDir)
    await deleteFile(source.path)
    migrated = true
  }
  return migrated
}

function getDuplicatedDefaultSettingName(name: string): string | null {
  const match = name.match(/^(.*)-\d+$/)
  if (!match) return null
  const baseName = match[1]?.trim()
  return DEFAULT_SETTING_FOLDER_NAMES.some((item) => item === baseName) ? baseName : null
}

async function cleanupDuplicatedSettingFolders(nodes: FileNode[]): Promise<boolean> {
  const settingNode = nodes.find((node) => node.is_dir && node.name === "设定")
  if (!settingNode?.children?.length) return false

  let migrated = false
  for (const child of settingNode.children) {
    if (!child.is_dir) continue
    const baseName = getDuplicatedDefaultSettingName(child.name)
    if (!baseName) continue
    const targetDir = `${settingNode.path}/${baseName}`
    await migrateNodeChildren(child, targetDir)
    await deleteFile(child.path)
    migrated = true
  }

  return migrated
}

function isNestedForeshadowingFolder(name: string): boolean {
  return name === "伏笔" || /^伏笔-\d+$/.test(name)
}

async function cleanupNestedForeshadowingFolders(nodes: FileNode[]): Promise<boolean> {
  const settingNode = nodes.find((node) => node.is_dir && node.name === "设定")
  if (!settingNode?.children?.length) return false

  const outlineRoot = getDirName(settingNode.path)
  const targetDir = `${outlineRoot}/伏笔`
  let migrated = false
  for (const child of settingNode.children) {
    if (!child.is_dir || !isNestedForeshadowingFolder(child.name)) continue
    await migrateNodeChildren(child, targetDir)
    await deleteFile(child.path)
    migrated = true
  }

  return migrated
}

export function OutlineFileTreePanel({ showHeader = true }: OutlineFileTreePanelProps) {
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const enqueueOutlineReferenceTokens = useOutlineChatStore((s) => s.enqueueReferenceTokens)
  const [outlineNodes, setOutlineNodes] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshTrees = useCallback(async () => {
    if (!project) return
    const projectPath = normalizePath(project.path)
    const outlineRoot = getOutlineRoot(projectPath)
    const [nextOutlineNodes, nextProjectTree] = await Promise.all([
      listDirectory(outlineRoot),
      listDirectory(projectPath),
    ])
    setOutlineNodes(nextOutlineNodes)
    setFileTree(nextProjectTree)
    bumpDataVersion()
  }, [bumpDataVersion, project, setFileTree])

  useEffect(() => {
    if (!project) {
      setOutlineNodes([])
      return
    }

    let cancelled = false
    async function load() {
      if (!project) return
      setLoading(true)
      setError(null)
      try {
        const projectPath = normalizePath(project.path)
        await Promise.all(
          DEFAULT_OUTLINE_FOLDER_PATHS.map((folderPath) =>
            createDirectory(getDefaultOutlineFolderPath(projectPath, folderPath)),
          ),
        )
        const outlineRoot = getOutlineRoot(projectPath)
        const initialNodes = await listDirectory(outlineRoot)
        const migrated = await migrateLegacyOutlineFolders(projectPath, initialNodes)
        const afterMigrationNodes = migrated ? await listDirectory(outlineRoot) : initialNodes
        const cleaned = await cleanupDuplicatedSettingFolders(afterMigrationNodes)
        const afterSettingCleanupNodes = cleaned ? await listDirectory(outlineRoot) : afterMigrationNodes
        const cleanedForeshadowing = await cleanupNestedForeshadowingFolders(afterSettingCleanupNodes)
        const nodes = cleanedForeshadowing ? await listDirectory(outlineRoot) : afterSettingCleanupNodes
        if (cancelled) return
        setOutlineNodes(nodes)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [dataVersion, project])

  const handleMoveFile = useCallback(
    async (sourcePath: string, targetFolderPath: string) => {
      if (!project) return
      const outlineRoot = getOutlineRoot(project.path)
      const initialPlan = planOutlineFileMove({
        outlineRoot,
        sourcePath,
        targetFolderPath,
        targetExists: false,
      })
      if (!initialPlan.ok) throw new Error(initialPlan.error)

      const exists = await fileExists(initialPlan.targetPath)
      const plan = planOutlineFileMove({
        outlineRoot,
        sourcePath,
        targetFolderPath,
        targetExists: exists,
      })
      if (!plan.ok) throw new Error(plan.error)

      await copyFile(sourcePath, plan.targetPath)
      await deleteFile(sourcePath)
      if (selectedFile === sourcePath) {
        setSelectedFile(plan.targetPath)
      }
      await refreshTrees()
    },
    [project, refreshTrees, selectedFile, setSelectedFile],
  )

  const handleRenameFile = useCallback(
    async (sourcePath: string, nextName: string) => {
      if (!project) return
      const fileName = ensureMarkdownFileName(nextName)
      if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
        throw new Error("文件名不能包含路径分隔符。")
      }
      const source = normalizePath(sourcePath)
      const targetPath = `${getDirName(source)}/${fileName}`
      if (targetPath === source) return

      const exists = await fileExists(targetPath)
      if (exists) throw new Error("目标文件已存在，请更换文件名。")

      await copyFile(source, targetPath)
      await deleteFile(source)
      if (selectedFile === sourcePath || normalizePath(selectedFile ?? "") === source) {
        setSelectedFile(targetPath)
      }
      await refreshTrees()
    },
    [project, refreshTrees, selectedFile, setSelectedFile],
  )

  const handleRenameFolder = useCallback(
    async (sourcePath: string, nextName: string) => {
      if (!project) return
      const folderName = nextName.trim()
      assertSafeName(folderName, "文件夹名称")
      const source = normalizePath(sourcePath)
      const targetPath = `${getDirName(source)}/${folderName}`
      if (targetPath === source) return

      const exists = await fileExists(targetPath)
      if (exists) throw new Error("目标文件夹已存在，请更换名称。")

      await copyDirectory(source, targetPath)
      await deleteFile(source)
      const normalizedSelected = normalizePath(selectedFile ?? "")
      if (normalizedSelected === source || normalizedSelected.startsWith(`${source}/`)) {
        setSelectedFile(normalizedSelected ? normalizedSelected.replace(source, targetPath) : null)
      }
      await refreshTrees()
    },
    [project, refreshTrees, selectedFile, setSelectedFile],
  )

  const handleCreateFile = useCallback(
    async (folderPath: string) => {
      const rawName = window.prompt("请输入新文档名称")
      if (rawName === null) return
      const fileName = ensureMarkdownFileName(rawName)
      assertSafeName(fileName, "文件名")
      const baseTitle = fileName.replace(/\.md$/i, "")
      const targetPath = `${normalizePath(folderPath)}/${fileName}`
      const exists = await fileExists(targetPath)
      if (exists) throw new Error("目标文件已存在，请更换文件名。")
      await writeFile(targetPath, `# ${baseTitle}\n\n`)
      setSelectedFile(targetPath)
      await refreshTrees()
    },
    [refreshTrees, setSelectedFile],
  )

  const handleCreateFolder = useCallback(
    async (folderPath: string) => {
      const rawName = window.prompt("请输入新文件夹名称")
      if (rawName === null) return
      const folderName = rawName.trim()
      assertSafeName(folderName, "文件夹名称")
      const targetPath = `${normalizePath(folderPath)}/${folderName}`
      const exists = await fileExists(targetPath)
      if (exists) throw new Error("目标文件夹已存在，请更换名称。")
      await createDirectory(targetPath)
      await refreshTrees()
    },
    [refreshTrees],
  )

  const handleDeleteFile = useCallback(
    async (sourcePath: string) => {
      const sourceName = getBaseName(sourcePath)
      if (!window.confirm(`确认删除大纲文件“${sourceName}”吗？此操作不可撤销。`)) return
      const source = normalizePath(sourcePath)
      await deleteFile(source)
      if (normalizePath(selectedFile ?? "") === source) {
        setSelectedFile(null)
      }
      await refreshTrees()
    },
    [refreshTrees, selectedFile, setSelectedFile],
  )

  const handleDeleteFolder = useCallback(
    async (sourcePath: string) => {
      const sourceName = getBaseName(sourcePath)
      if (!window.confirm(`确认删除文件夹“${sourceName}”及其全部内容吗？此操作不可撤销。`)) return
      const source = normalizePath(sourcePath)
      await deleteFile(source)
      const normalizedSelected = normalizePath(selectedFile ?? "")
      if (normalizedSelected === source || normalizedSelected.startsWith(`${source}/`)) {
        setSelectedFile(null)
      }
      await refreshTrees()
    },
    [refreshTrees, selectedFile, setSelectedFile],
  )

  const handleSendToOutlineChat = useCallback(
    (sourcePath: string, sourceName: string) => {
      const normalizedPath = normalizePath(sourcePath)
      enqueueOutlineReferenceTokens([
        {
          id: `outline:${normalizedPath}`,
          category: "outline",
          title: sourceName,
          path: normalizedPath,
          displayTitle: sourceName,
        },
      ])
    },
    [enqueueOutlineReferenceTokens],
  )

  if (!project) {
    return (
      <div className="px-3 py-4 text-xs text-muted-foreground">
        请先打开项目
      </div>
    )
  }

  if (error) {
    return (
      <div className="m-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        大纲目录加载失败：{error}
      </div>
    )
  }

  if (loading && outlineNodes.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-muted-foreground">
        正在加载大纲目录...
      </div>
    )
  }

  return (
    <OutlineFileTree
      nodes={outlineNodes}
      selectedPath={selectedFile}
      onSelectFile={setSelectedFile}
      onMoveFile={handleMoveFile}
      onRenameFile={handleRenameFile}
      onRenameFolder={handleRenameFolder}
      onDeleteFile={handleDeleteFile}
      onDeleteFolder={handleDeleteFolder}
      onCreateFile={handleCreateFile}
      onCreateFolder={handleCreateFolder}
      onSendToOutlineChat={handleSendToOutlineChat}
      showHeader={showHeader}
    />
  )
}
