import { useEffect, useState } from "react"
import { FolderOpen, Plus, BookOpen, RectangleVertical } from "lucide-react"
import type { WikiProject } from "@/types/wiki"
import { getExecutableDir, listDirectory, moveProjectToSystemTrash, openProjectFolder, readFile, renameProject } from "@/commands/fs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { buildDefaultNovelDir } from "@/lib/default-paths"
import { flattenMdFiles } from "@/lib/novel/chapter-utils"
import { countChapterBodyWords } from "@/lib/chapter-word-count"
import { normalizeComparablePath } from "@/lib/path-utils"
import { getRecentProjects, removeProjectRecords } from "@/lib/project-store"
import { getUiTestProjects, mergeUiTestProjects, registerUiTestProjects, replaceUiTestProjectPath } from "@/lib/ui-test-library"
import "./ui-test-shelf.css"

const COVER_COLORS = Array.from({ length: 8 }, (_, index) => `var(--ui-shelf-cover-${index + 1})`)
const COVER_SIZE_KEY = "qm-uitest-shelf-cover-size-v1"
const COVER_SIZES = [
  { id: "large", label: "大封面", size: 22 },
  { id: "medium", label: "中封面", size: 17 },
  { id: "small", label: "小封面", size: 13 },
] as const
type CoverSize = (typeof COVER_SIZES)[number]["id"]

function readCoverSize(): CoverSize {
  try {
    const value = localStorage.getItem(COVER_SIZE_KEY)
    return COVER_SIZES.some((item) => item.id === value) ? value as CoverSize : "medium"
  } catch {
    return "medium"
  }
}

interface ShelfBook {
  project: WikiProject
  wordCount: number | null
  coverIndex: number
}

interface ShelfMenu {
  project: WikiProject
  x: number
  y: number
}

interface UiTestShelfProps {
  onCreateProject: () => void
  onOpenProject: () => void
  onSelectProject: (project: WikiProject) => void
}

async function countBookWords(projectPath: string): Promise<number> {
  const chaptersPath = `${normalizeComparablePath(projectPath)}/wiki/chapters`
  const nodes = await listDirectory(chaptersPath)
  const files = flattenMdFiles(nodes)
  let total = 0
  for (const file of files) {
    if (!/\.md$/i.test(file.path)) continue
    try {
      const content = await readFile(file.path)
      total += countChapterBodyWords(content)
    } catch {
      // 单章读取失败不隐藏整本书，已读章节仍累计。
    }
  }
  return total
}

function formatWords(n: number): string {
  return `${n.toLocaleString("zh-CN")} 字`
}

async function discoverDefaultProjects(cancelled: () => boolean): Promise<WikiProject[]> {
  const executableDir = await getExecutableDir()
  const defaultDir = buildDefaultNovelDir(executableDir)
  const root = normalizeComparablePath(defaultDir)
  const nodes = await listDirectory(defaultDir, { maxDepth: 1 })
  const projects: WikiProject[] = []
  for (const node of nodes) {
    if (cancelled()) break
    if (!node.is_dir || node.name.startsWith(".")) continue
    const path = normalizeComparablePath(node.path)
    // 只发现测试默认目录的直接子目录，不跟随列表中的其他磁盘或父目录路径。
    if (!path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) continue
    const relative = path.slice(root.length + 1)
    if (!relative || relative.includes("/") || relative === "..") continue
    try {
      // openProject 会迁移目录并写正式项目登记；书架发现只读既有身份文件。
      const identity = JSON.parse(await readFile(`${path}/.qmai/project.json`)) as { id?: unknown }
      if (typeof identity?.id === "string" && identity.id.trim()) {
        projects.push({ id: identity.id, name: node.name, path })
      }
    } catch {
      // 普通文件夹不伪造为书；已有索引仍保留，旧项目可通过“打开已有”登记。
    }
  }
  return projects
}

export function UiTestShelf({
  onCreateProject,
  onOpenProject,
  onSelectProject,
}: UiTestShelfProps) {
  const [books, setBooks] = useState<ShelfBook[]>([])
  const [loading, setLoading] = useState(true)
  const [scanError, setScanError] = useState("")
  const [actionError, setActionError] = useState("")
  const [menu, setMenu] = useState<ShelfMenu | null>(null)
  const [renaming, setRenaming] = useState<WikiProject | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [coverSize, setCoverSize] = useState<CoverSize>(readCoverSize)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const warnings: string[] = []
      let indexed: WikiProject[] = []
      let recents: WikiProject[] = []
      let scanned: WikiProject[] = []
      try {
        indexed = getUiTestProjects()
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : "书架索引读取失败，原始记录已保留。")
      }
      try {
        recents = mergeUiTestProjects(await getRecentProjects())
      } catch {
        warnings.push("最近记录暂不可读，可通过“打开已有”添加小说。")
      }
      try {
        scanned = await discoverDefaultProjects(() => cancelled)
      } catch {
        warnings.push("默认测试目录暂不可读，可通过“打开已有”选择小说。")
      }
      if (cancelled) return

      // 独立目录的顺序与已登记位置优先，最近十条仅作为补充，不取代完整书库。
      const merged = mergeUiTestProjects(indexed, scanned, recents, indexed)
      try {
        if (merged.length) registerUiTestProjects(merged)
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : "书架索引保存失败，小说文件未受影响。")
      }
      setScanError([...new Set(warnings)].join(" "))
      setBooks(merged.map((project, index) => ({ project, wordCount: null, coverIndex: index % COVER_COLORS.length })))
      setLoading(false)

      for (const project of merged) {
        if (cancelled) return
        const wordCount = await countBookWords(project.path).catch(() => -1)
        if (cancelled) return
        setBooks((current) => current.map((book) => book.project.path === project.path
          ? { ...book, wordCount }
          : book))
      }
    }

    void load().catch(() => {
      if (cancelled) return
      setLoading(false)
      setScanError("书架读取失败，原始记录未改动，请通过“打开已有”重新选择小说。")
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function renameBook() {
    if (!renaming) return
    try {
      const renamed = await renameProject(renaming.path, renameValue)
      await removeProjectRecords(renaming.path)
      replaceUiTestProjectPath(renaming.path, renamed)
      setBooks((current) => current.map((book) => book.project.path === renaming.path ? { ...book, project: renamed } : book))
      setRenaming(null)
      setActionError("")
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "重命名失败，原小说未改动。")
    }
  }

  async function removeBook(project: WikiProject) {
    if (!window.confirm(`确定将“${project.name}”移入系统回收站？`)) return
    try {
      await moveProjectToSystemTrash(project.path)
      await removeProjectRecords(project.path)
      const remaining = getUiTestProjects().filter((item) => item.path !== project.path)
      localStorage.setItem("qm-uitest-library", JSON.stringify({ schemaVersion: 1, projects: remaining }))
      setBooks((current) => current.filter((book) => book.project.path !== project.path))
      setMenu(null)
      setActionError("")
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "移入系统回收站失败，小说未删除。")
    }
  }

  const countLabel = loading ? "正在读取书架…" : `${books.length} 部小说`

  return (
    <div className="ui-test-shelf">
      <div className="ui-test-shelf-inner">
        <div className="ui-test-shelf-hero">
          <div className="ui-test-shelf-actions">
            <button type="button" className="ui-test-btn primary" onClick={onCreateProject}>
              <Plus aria-hidden="true" />
              新建小说
            </button>
            <button type="button" className="ui-test-btn ghost" onClick={onOpenProject}>
              <FolderOpen aria-hidden="true" />
              打开已有
            </button>
          </div>
          <div className="ui-test-cover-sizes" role="group" aria-label="封面大小">
            {COVER_SIZES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ui-test-cover-size${coverSize === item.id ? " is-active" : ""}`}
                aria-label={item.label}
                aria-pressed={coverSize === item.id}
                title={item.label}
                onClick={() => {
                  setCoverSize(item.id)
                  try { localStorage.setItem(COVER_SIZE_KEY, item.id) } catch { /* 尺寸切换仍对当前页面生效。 */ }
                }}
              >
                <RectangleVertical aria-hidden="true" size={item.size} strokeWidth={1.8} />
              </button>
            ))}
          </div>
        </div>

        <div className="ui-test-shelf-count">
          <span role="status" aria-live="polite">{countLabel}</span>
        </div>
        {scanError && <p className="ui-test-shelf-alert" role="alert">{scanError}</p>}
        {actionError && <p className="ui-test-shelf-alert" role="alert">{actionError}</p>}

        {loading ? (
          <div className="ui-test-empty" role="status"><p>正在读取本地书架…</p></div>
        ) : books.length === 0 ? (
          <div className="ui-test-empty">
            <BookOpen aria-hidden="true" className="h-8 w-8" />
            <h2>这里还没有书</h2>
            <p>新建一本小说，或打开已有目录，开始写作。</p>
            <button type="button" className="ui-test-btn primary" onClick={onCreateProject}>
              <Plus aria-hidden="true" />
              新建小说
            </button>
          </div>
        ) : (
          <div className={`ui-test-books-grid is-${coverSize}`}>
            {books.map((book) => {
              const name = book.project.name.trim().replace(/^《(.+)》$/s, "$1")
              const coverChar = Array.from(name)[0] || "书"
              return (
                <Tooltip key={book.project.path}>
                  <TooltipTrigger render={
                    <button
                      type="button"
                      className="ui-test-book-card"
                      onClick={() => onSelectProject(book.project)}
                      onContextMenu={(event) => { event.preventDefault(); setMenu({ project: book.project, x: event.clientX, y: event.clientY }) }}
                      aria-label={`打开小说：${name}`}
                    />
                  }>
                    <span className="ui-test-cover" data-char={coverChar} aria-hidden="true" style={{ backgroundColor: COVER_COLORS[book.coverIndex] }}>
                      <small>青幕 · 原创书稿</small>
                      <span className="ui-test-cover-title">{name}</span>
                    </span>
                    <span className="ui-test-book-info">
                      <span className="ui-test-book-title" role="heading" aria-level={2}>{name}</span>
                      <span className="ui-test-book-words">{book.wordCount == null ? "字数读取中" : book.wordCount < 0 ? "字数不可用" : formatWords(book.wordCount)}</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="ui-test-shelf-tooltip" side="bottom">{name}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        )}
        {menu && <div className="ui-test-shelf-menu" role="menu" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
          <button type="button" role="menuitem" onClick={() => { setRenaming(menu.project); setRenameValue(menu.project.name); setMenu(null) }}>重命名</button>
          <button type="button" role="menuitem" onClick={() => { void openProjectFolder(menu.project.path).catch((error) => setActionError(error instanceof Error ? error.message : "打开文件夹失败。")); setMenu(null) }}>打开文件夹</button>
          <button type="button" role="menuitem" onClick={() => void removeBook(menu.project)}>删除</button>
        </div>}
        {renaming && <div className="ui-test-shelf-rename">
          <form onSubmit={(event) => { event.preventDefault(); void renameBook() }}>
            <label>小说名称<input aria-label="小说名称" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus /></label>
            <div className="ui-test-shelf-rename-actions"><button type="button" onClick={() => setRenaming(null)}>取消</button><button type="submit">保存</button></div>
          </form>
        </div>}
      </div>
    </div>
  )
}
