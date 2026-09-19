import { useEffect, useMemo, useState } from "react"
import { FolderOpen, Plus, Search, ArrowRight, BookOpen } from "lucide-react"
import type { WikiProject } from "@/types/wiki"
import { getExecutableDir, listDirectory, readFile } from "@/commands/fs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { buildDefaultNovelDir } from "@/lib/default-paths"
import { flattenMdFiles } from "@/lib/novel/chapter-utils"
import { countChapterBodyWords } from "@/lib/chapter-word-count"
import { normalizeComparablePath } from "@/lib/path-utils"
import { getRecentProjects } from "@/lib/project-store"
import { IS_UI_TEST_BUILD } from "@/lib/ui-test"
import { getUiTestProjects, mergeUiTestProjects, registerUiTestProjects } from "@/lib/ui-test-library"
import "./ui-test-shelf.css"

const COVER_COLORS = Array.from({ length: 8 }, (_, index) => `var(--ui-shelf-cover-${index + 1})`)

interface ShelfBook {
  project: WikiProject
  wordCount: number | null
  wordCountError: boolean
  coverIndex: number
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
    const content = await readFile(file.path)
    total += countChapterBodyWords(content)
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
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | "writing" | "planning">("all")
  const [scanError, setScanError] = useState("")

  useEffect(() => {
    if (!IS_UI_TEST_BUILD) return
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
      setBooks(merged.map((project, index) => ({ project, wordCount: null, wordCountError: false, coverIndex: index % COVER_COLORS.length })))
      setLoading(false)

      for (const project of merged) {
        if (cancelled) return
        let wordCount: number | null = null
        let wordCountError = false
        try {
          wordCount = await countBookWords(project.path)
        } catch {
          wordCountError = true
        }
        if (cancelled) return
        setBooks((current) => current.map((book) => book.project.path === project.path
          ? { ...book, wordCount, wordCountError }
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

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    return books.filter((book) => {
      const matchQuery = !q || book.project.name.toLocaleLowerCase().includes(q)
      const matchStatus = status === "all" || (book.wordCount !== null
        && (status === "writing" ? book.wordCount > 0 : book.wordCount === 0))
      return matchQuery && matchStatus
    })
  }, [books, query, status])

  if (!IS_UI_TEST_BUILD) return null

  const countLabel = loading ? "正在读取书架…" : `${filtered.length} 部小说`
  const hasFilter = !!query.trim() || status !== "all"

  return (
    <div className="ui-test-shelf">
      <div className="ui-test-shelf-inner">
        <div className="ui-test-shelf-hero">
          <div className="ui-test-shelf-heading">
            <div className="ui-test-eyebrow">你的私人书架 · 每一本，都是一个世界</div>
            <h1 className="ui-test-hero-title">每个故事，都有自己的位置。</h1>
            <p className="ui-test-hero-sub">开一本新书，或接着上次的灵感。不必从头寻找。</p>
          </div>
          <div className="ui-test-shelf-actions">
            <button type="button" className="ui-test-btn ghost" onClick={onOpenProject}>
              <FolderOpen aria-hidden="true" />
              打开已有
            </button>
            <button type="button" className="ui-test-btn primary" onClick={onCreateProject}>
              <Plus aria-hidden="true" />
              新建小说
            </button>
          </div>
        </div>

        <div className="ui-test-shelf-controls">
          <div className="ui-test-tabs" role="group" aria-label="按创作状态筛选">
            {(["all", "writing", "planning"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`ui-test-tab${status === value ? " is-active" : ""}`}
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {value === "all" ? "全部小说" : value === "writing" ? "创作中" : "构思中"}
              </button>
            ))}
          </div>
          <label className="ui-test-searchbox">
            <Search aria-hidden="true" />
            <input
              type="search"
              aria-label="搜索小说"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="找一本书…"
            />
          </label>
        </div>

        <div className="ui-test-shelf-count">
          <span role="status" aria-live="polite">{countLabel}</span>
          <span>点击书封，直接继续上次的创作</span>
        </div>
        {scanError && <p className="ui-test-shelf-alert" role="alert">{scanError}</p>}

        {loading ? (
          <div className="ui-test-empty" role="status"><p>正在读取本地书架…</p></div>
        ) : filtered.length === 0 ? (
          <div className="ui-test-empty">
            <BookOpen aria-hidden="true" className="h-8 w-8" />
            <h2>{hasFilter ? "没有找到匹配的小说" : "这里还没有书"}</h2>
            <p>{hasFilter ? "试试其他书名，或清除筛选查看全部小说。" : "新建一本小说，或打开已有目录，开始写作。"}</p>
            {hasFilter ? (
              <button type="button" className="ui-test-btn" onClick={() => { setQuery(""); setStatus("all") }}>
                清除筛选
              </button>
            ) : (
              <button type="button" className="ui-test-btn primary" onClick={onCreateProject}>
                <Plus aria-hidden="true" />
                新建小说
              </button>
            )}
          </div>
        ) : (
          <div className="ui-test-books-grid">
            {filtered.map((book) => {
              const name = book.project.name.trim().replace(/^《(.+)》$/s, "$1")
              const isWriting = book.wordCount !== null && book.wordCount > 0
              const isPlanning = book.wordCount === 0
              const coverChar = Array.from(name)[0] || "书"
              const words = book.wordCountError ? "读取失败" : book.wordCount === null ? "统计中…" : formatWords(book.wordCount)
              return (
                <Tooltip key={book.project.path}>
                  <TooltipTrigger render={
                    <button
                      type="button"
                      className="ui-test-book-card"
                      onClick={() => onSelectProject(book.project)}
                      aria-label={`打开小说：${name}`}
                    />
                  }>
                    <span className="ui-test-cover" data-char={coverChar} aria-hidden="true" style={{ backgroundColor: COVER_COLORS[book.coverIndex] }}>
                      <small>青幕 · 原创书稿</small>
                      <span className="ui-test-cover-title">{name}</span>
                    </span>
                    <span className="ui-test-book-info">
                      <span className="ui-test-book-title" role="heading" aria-level={2}>{name}</span>
                      <span className="ui-test-book-stats">
                        <strong aria-live="polite">{words}</strong>
                        <span className="ui-test-book-status">
                          {(isWriting || isPlanning) && <i className="ui-test-status-dot" aria-hidden="true" />}
                          {isWriting ? "创作中" : isPlanning ? "构思中" : "状态待确认"}
                        </span>
                      </span>
                      <span className="ui-test-book-next">
                        <span>{isPlanning ? "从大纲开始" : "打开小说"}</span>
                        <ArrowRight aria-hidden="true" />
                      </span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="ui-test-shelf-tooltip" side="bottom">{name}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
