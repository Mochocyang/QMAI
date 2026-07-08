import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronDown, ChevronRight, FileText, FilePlus, Folder, FolderInput, FolderPlus, MessageCircle, Pencil, Trash2 } from "lucide-react"
import type { FileNode } from "@/types/wiki"

interface OutlineFileTreeProps {
  nodes: FileNode[]
  selectedPath: string | null
  onSelectFile: (path: string) => void
  onMoveFile: (sourcePath: string, targetFolderPath: string) => Promise<void> | void
  onRenameFile?: (sourcePath: string, nextName: string) => Promise<void> | void
  onRenameFolder?: (sourcePath: string, nextName: string) => Promise<void> | void
  onDeleteFile?: (sourcePath: string) => Promise<void> | void
  onDeleteFolder?: (sourcePath: string) => Promise<void> | void
  onCreateFile?: (folderPath: string) => Promise<void> | void
  onCreateFolder?: (folderPath: string) => Promise<void> | void
  onSendToOutlineChat?: (sourcePath: string, sourceName: string) => void
  showHeader?: boolean
}

interface ContextMenuState {
  sourcePath: string
  sourceName: string
  isDir: boolean
  x: number
  y: number
}

interface RenameState {
  sourcePath: string
  isDir: boolean
  value: string
}

function collectFolders(nodes: FileNode[]): FileNode[] {
  const folders: FileNode[] = []
  for (const node of nodes) {
    if (!node.is_dir) continue
    folders.push(node)
    if (node.children?.length) {
      folders.push(...collectFolders(node.children))
    }
  }
  return folders
}

function collectFolderPaths(nodes: FileNode[], result = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (!node.is_dir) continue
    result.add(node.path)
    if (node.children?.length) collectFolderPaths(node.children, result)
  }
  return result
}

function OutlineContextMenu({
  menu,
  folders,
  moveMenuOpen,
  onOpenMoveSubmenu,
  onMoveToFolder,
  onCreateFile,
  onCreateFolder,
  onStartRename,
  onDeleteNode,
  onSendToOutlineChat,
}: {
  menu: ContextMenuState
  folders: FileNode[]
  moveMenuOpen: boolean
  onOpenMoveSubmenu: (sourcePath: string) => void
  onMoveToFolder: (targetFolderPath: string) => void
  onCreateFile?: (folderPath: string) => void
  onCreateFolder?: (folderPath: string) => void
  onStartRename: (sourcePath: string, sourceName: string, isDir: boolean) => void
  onDeleteNode?: (sourcePath: string, isDir: boolean) => void
  onSendToOutlineChat?: (sourcePath: string, sourceName: string) => void
}) {
  return createPortal(
    <div
      className="fixed z-50 w-44 rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-md"
      data-testid="outline-file-context-menu"
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.isDir ? (
        <>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => onCreateFile?.(menu.sourcePath)}
          >
            <FilePlus className="h-3.5 w-3.5" />
            新建文档
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => onCreateFolder?.(menu.sourcePath)}
          >
            <FolderPlus className="h-3.5 w-3.5" />
            新建文件夹
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => onStartRename(menu.sourcePath, menu.sourceName, true)}
          >
            <Pencil className="h-3.5 w-3.5" />
            重命名
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
            onClick={() => onDeleteNode?.(menu.sourcePath, true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => onStartRename(menu.sourcePath, menu.sourceName, false)}
          >
            <Pencil className="h-3.5 w-3.5" />
            重命名
          </button>
          <div className="relative">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => onOpenMoveSubmenu(menu.sourcePath)}
            >
              <FolderInput className="h-3.5 w-3.5" />
              移动
              <ChevronRight className="ml-auto h-3 w-3" />
            </button>
            {moveMenuOpen ? (
              <div
                className="absolute left-full top-0 z-50 flex max-h-44 w-44 flex-col gap-1 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
                data-testid="outline-move-submenu"
              >
                {folders.map((folder) => (
                  <button
                    key={folder.path}
                    type="button"
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                    onClick={() => onMoveToFolder(folder.path)}
                    title={folder.path}
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                    <span className="truncate">{folder.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {onSendToOutlineChat ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => onSendToOutlineChat(menu.sourcePath, menu.sourceName)}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              发送到AI大纲会话
            </button>
          ) : null}
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
            onClick={() => onDeleteNode?.(menu.sourcePath, false)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}

function TreeNode({
  node,
  depth,
  folders,
  expandedPaths,
  contextMenu,
  moveSubmenuPath,
  renaming,
  renameValue,
  dragSourcePath,
  selectedPath,
  onToggle,
  onSelectFile,
  onOpenContextMenu,
  onOpenFolderContextMenu,
  onOpenMoveSubmenu,
  onCreateFile,
  onCreateFolder,
  onMoveToFolder,
  onStartRename,
  onDeleteNode,
  onRenameValueChange,
  onSubmitRename,
  onCancelRename,
  onSendToOutlineChat,
  onDragSourceChange,
}: {
  node: FileNode
  depth: number
  folders: FileNode[]
  expandedPaths: Set<string>
  contextMenu: ContextMenuState | null
  moveSubmenuPath: string | null
  renaming: RenameState | null
  renameValue: string
  dragSourcePath: string | null
  selectedPath: string | null
  onToggle: (path: string) => void
  onSelectFile: (path: string) => void
  onOpenContextMenu: (sourcePath: string, sourceName: string, x: number, y: number) => void
  onOpenFolderContextMenu: (sourcePath: string, sourceName: string, x: number, y: number) => void
  onOpenMoveSubmenu: (sourcePath: string) => void
  onCreateFile?: (folderPath: string) => void
  onCreateFolder?: (folderPath: string) => void
  onMoveToFolder: (targetFolderPath: string) => void
  onStartRename: (sourcePath: string, sourceName: string, isDir: boolean) => void
  onDeleteNode?: (sourcePath: string, isDir: boolean) => void
  onRenameValueChange: (value: string) => void
  onSubmitRename: (value?: string) => void
  onCancelRename: () => void
  onSendToOutlineChat?: (sourcePath: string, sourceName: string) => void
  onDragSourceChange: (sourcePath: string | null) => void
}) {
  const paddingLeft = 10 + depth * 14

  if (node.is_dir) {
    const expanded = expandedPaths.has(node.path)
    const dropActive = dragSourcePath !== null
    const contextMenuOpen = contextMenu?.sourcePath === node.path
    const isRenaming = renaming?.sourcePath === node.path
    return (
      <div>
        <button
          type="button"
          className={`flex w-full min-w-0 items-center gap-1 rounded px-1 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground ${
            dropActive ? "outline outline-1 outline-primary/25" : ""
          }`}
          style={{ paddingLeft }}
          onClick={() => {
            if (isRenaming) return
            onToggle(node.path)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            onOpenFolderContextMenu(node.path, node.name, event.clientX, event.clientY)
          }}
          onDragOver={(event) => {
            if (!dragSourcePath) return
            event.preventDefault()
          }}
          onDrop={(event) => {
            event.preventDefault()
            if (!dragSourcePath) return
            onMoveToFolder(node.path)
            onDragSourceChange(null)
          }}
          title={node.name}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <Folder className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          {isRenaming ? (
            <input
              data-testid="outline-rename-input"
              className="min-w-0 flex-1 rounded border bg-background px-1 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
              value={renameValue}
              onChange={(event) => onRenameValueChange(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === "Enter") {
                  event.preventDefault()
                  onSubmitRename(event.currentTarget.value)
                } else if (event.key === "Escape") {
                  event.preventDefault()
                  onCancelRename()
                }
              }}
              autoFocus
            />
          ) : (
            <span className="truncate">{node.name}</span>
          )}
        </button>
        {contextMenuOpen ? (
          <OutlineContextMenu
            menu={contextMenu}
            folders={folders}
            moveMenuOpen={false}
            onOpenMoveSubmenu={onOpenMoveSubmenu}
            onMoveToFolder={onMoveToFolder}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onStartRename={onStartRename}
            onDeleteNode={onDeleteNode}
          />
        ) : null}
        {expanded && node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            folders={folders}
            expandedPaths={expandedPaths}
            contextMenu={contextMenu}
            moveSubmenuPath={moveSubmenuPath}
            renaming={renaming}
            renameValue={renameValue}
            dragSourcePath={dragSourcePath}
            selectedPath={selectedPath}
            onToggle={onToggle}
            onSelectFile={onSelectFile}
            onOpenContextMenu={onOpenContextMenu}
            onOpenFolderContextMenu={onOpenFolderContextMenu}
            onOpenMoveSubmenu={onOpenMoveSubmenu}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onMoveToFolder={onMoveToFolder}
            onStartRename={onStartRename}
            onDeleteNode={onDeleteNode}
            onRenameValueChange={onRenameValueChange}
            onSubmitRename={onSubmitRename}
            onCancelRename={onCancelRename}
            onSendToOutlineChat={onSendToOutlineChat}
            onDragSourceChange={onDragSourceChange}
          />
        ))}
      </div>
    )
  }

  const selected = selectedPath === node.path
  const contextMenuOpen = contextMenu?.sourcePath === node.path
  const moveMenuOpen = moveSubmenuPath === node.path
  const isRenaming = renaming?.sourcePath === node.path
  return (
    <div className="relative flex min-w-0 items-start gap-1">
      <button
        type="button"
        draggable={!isRenaming}
        className={`flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left text-xs ${
          selected ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
        style={{ paddingLeft: paddingLeft + 18 }}
        onClick={() => {
          if (isRenaming) return
          onSelectFile(node.path)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          onOpenContextMenu(node.path, node.name, event.clientX, event.clientY)
        }}
        onDragStart={() => {
          onDragSourceChange(node.path)
        }}
        onDragEnd={() => {
          onDragSourceChange(null)
        }}
        title={`${node.name}。右键可重命名、移动或发送到AI大纲会话。`}
      >
        <FileText className="h-3.5 w-3.5 shrink-0" />
        {isRenaming ? (
          <input
            data-testid="outline-rename-input"
            className="min-w-0 flex-1 rounded border bg-background px-1 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
            value={renameValue}
            onChange={(event) => onRenameValueChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === "Enter") {
                event.preventDefault()
                onSubmitRename(event.currentTarget.value)
              } else if (event.key === "Escape") {
                event.preventDefault()
                onCancelRename()
              }
            }}
            autoFocus
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
      </button>
      {contextMenuOpen ? (
        <OutlineContextMenu
          menu={contextMenu}
          folders={folders}
          moveMenuOpen={moveMenuOpen}
          onOpenMoveSubmenu={onOpenMoveSubmenu}
          onMoveToFolder={onMoveToFolder}
          onStartRename={onStartRename}
          onDeleteNode={onDeleteNode}
          onSendToOutlineChat={onSendToOutlineChat}
        />
      ) : null}
    </div>
  )
}

export function OutlineFileTree({
  nodes,
  selectedPath,
  onSelectFile,
  onMoveFile,
  onRenameFile,
  onRenameFolder,
  onDeleteFile,
  onDeleteFolder,
  onCreateFile,
  onCreateFolder,
  onSendToOutlineChat,
  showHeader = true,
}: OutlineFileTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => collectFolderPaths(nodes))
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [moveSubmenuPath, setMoveSubmenuPath] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<RenameState | null>(null)
  const [dragSourcePath, setDragSourcePath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const folders = useMemo(() => collectFolders(nodes), [nodes])

  useEffect(() => {
    setExpandedPaths((current) => {
      const next = new Set(current)
      for (const path of collectFolderPaths(nodes)) next.add(path)
      return next
    })
  }, [nodes])

  function toggle(path: string) {
    setExpandedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function handleMove(targetFolderPath: string) {
    if (!contextMenu && !dragSourcePath) return
    const sourcePath = contextMenu?.sourcePath ?? dragSourcePath
    if (!sourcePath) return
    setError(null)
    try {
      await onMoveFile(sourcePath, targetFolderPath)
      setContextMenu(null)
      setMoveSubmenuPath(null)
      setDragSourcePath(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function submitRename(valueOverride?: string) {
    if (!renaming) return
    const nextName = (valueOverride ?? renaming.value).trim()
    if (!nextName) return
    setError(null)
    try {
      if (renaming.isDir) {
        if (!onRenameFolder) return
        await onRenameFolder(renaming.sourcePath, nextName)
      } else {
        if (!onRenameFile) return
        await onRenameFile(renaming.sourcePath, nextName)
      }
      setRenaming(null)
      setContextMenu(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleCreateFile(folderPath: string) {
    if (!onCreateFile) return
    setError(null)
    try {
      await onCreateFile(folderPath)
      setContextMenu(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleCreateFolder(folderPath: string) {
    if (!onCreateFolder) return
    setError(null)
    try {
      await onCreateFolder(folderPath)
      setContextMenu(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleDeleteNode(sourcePath: string, isDir: boolean) {
    setError(null)
    try {
      if (isDir) {
        if (!onDeleteFolder) return
        await onDeleteFolder(sourcePath)
      } else {
        if (!onDeleteFile) return
        await onDeleteFile(sourcePath)
      }
      setContextMenu(null)
      setMoveSubmenuPath(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="outline-file-tree">
      {showHeader ? (
          <div className="shrink-0 border-b px-2 py-2">
          <div className="text-xs font-semibold text-foreground">大纲文件树</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">右键文件可重命名、移动或发送到AI大纲会话</div>
        </div>
      ) : null}

      {error ? (
        <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {nodes.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs text-muted-foreground">
            暂无大纲文件
          </div>
        ) : (
          nodes.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              folders={folders}
              expandedPaths={expandedPaths}
              contextMenu={contextMenu}
              moveSubmenuPath={moveSubmenuPath}
              renaming={renaming}
              renameValue={renaming?.value ?? ""}
              dragSourcePath={dragSourcePath}
              selectedPath={selectedPath}
              onToggle={toggle}
              onSelectFile={onSelectFile}
              onOpenContextMenu={(sourcePath, sourceName, x, y) => {
                setError(null)
                setRenaming(null)
                setMoveSubmenuPath(null)
                setContextMenu({ sourcePath, sourceName, isDir: false, x, y })
              }}
              onOpenFolderContextMenu={(sourcePath, sourceName, x, y) => {
                setError(null)
                setRenaming(null)
                setMoveSubmenuPath(null)
                setContextMenu({ sourcePath, sourceName, isDir: true, x, y })
              }}
              onOpenMoveSubmenu={setMoveSubmenuPath}
              onCreateFile={(folderPath) => void handleCreateFile(folderPath)}
              onCreateFolder={(folderPath) => void handleCreateFolder(folderPath)}
              onMoveToFolder={(targetFolderPath) => void handleMove(targetFolderPath)}
              onStartRename={(sourcePath, sourceName, isDir) => {
                setMoveSubmenuPath(null)
                setContextMenu(null)
                setRenaming({ sourcePath, isDir, value: sourceName })
              }}
              onDeleteNode={(sourcePath, isDir) => void handleDeleteNode(sourcePath, isDir)}
              onRenameValueChange={(value) => {
                setRenaming((current) => current ? { ...current, value } : current)
              }}
              onSubmitRename={(value) => void submitRename(value)}
              onCancelRename={() => setRenaming(null)}
              onSendToOutlineChat={(sourcePath, sourceName) => {
                onSendToOutlineChat?.(sourcePath, sourceName)
                setContextMenu(null)
              }}
              onDragSourceChange={setDragSourcePath}
            />
          ))
        )}
      </div>
    </div>
  )
}
