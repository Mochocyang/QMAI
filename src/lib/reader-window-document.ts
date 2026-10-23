/**
 * 独立窗口的文档读写层：读什么、写什么、怎么判断"改过了"。
 *
 * ── 为什么单独一层 ──
 * 独立窗口跑在**另一个 webview** 里，拿不到主窗口的 `fileContent` / 磁盘轮询 /
 * 章节保存定时器，整条"打开 → 编辑 → 落盘"链路要自己走一遍。但"章节正文保存前
 * 必须走 `normalizeChapterWriting`""大纲的伴生 HTML 与 MD 是两个文件"这类规则
 * 与主窗口**必须一致**，所以规则收敛在这里，主窗口那边将来也能挪过来共用。
 *
 * 这里只放纯逻辑与薄 IO，不放 React 状态 —— 状态机在
 * `hooks/use-reader-document.ts`，UI 在 `components/reader/reader-window.tsx`。
 */
import { fileExists, readFile } from "@/commands/fs"
import { normalizeChapterWriting } from "@/lib/chapter-formatting"
import { splitChapterHeading } from "@/lib/chapter-selection"
import { parseFrontmatter } from "@/lib/frontmatter"
import { renderOutlineHtmlForPath } from "@/lib/novel/outline-save-request"
import { isChapterPath, normalizePath } from "@/lib/path-utils"
import type { ReaderWindowKind } from "@/lib/reader-window"

export interface ReaderDocumentContent {
  /** 磁盘原文（含 frontmatter）。编辑器要整份，因为它自己负责把 YAML 头原样带回去。 */
  markdown: string
  /** 大纲的伴生 HTML；章节恒为 null。没有伴生文件时是即时渲染结果。 */
  html: string | null
  /** 顶栏标题：章节取正文首行 `# 标题`，其余取文件名。 */
  heading: string
}

/** 文件名去掉扩展名，用作标题兜底。 */
export function readerDocumentBaseName(path: string): string {
  const name = normalizePath(path).split("/").pop() ?? path
  return name.replace(/\.(md|html)$/i, "")
}

/**
 * 大纲伴生 HTML 的路径。
 *
 * 只有 `.md` 才有伴生文件；已经是 `.html` 的文档不存在"另一份"。
 */
export function companionHtmlPath(mdPath: string): string | null {
  if (!/\.md$/i.test(mdPath)) return null
  return mdPath.replace(/\.md$/i, ".html")
}

/**
 * 保存前要写进磁盘的内容。
 *
 * 章节走 `normalizeChapterWriting`（补齐首行缩进、同步 frontmatter 里的字数等），
 * 与主窗口 `handleSave` 完全同一条口径 —— 两个窗口写同一个文件时不能各写一套格式，
 * 否则光是"排版差异"就会让对方的磁盘轮询误判成外部改动。
 */
export function normalizeDocumentForSave(path: string, markdown: string): string {
  return isChapterPath(path) ? normalizeChapterWriting(markdown) : markdown
}

/**
 * 两份内容是否等价。
 *
 * 先比原文（绝大多数情况直接命中），不等再按保存口径归一化后比 —— 否则
 * 用户只是把光标挪了一下、编辑器回吐一份"排版等价但字面不同"的正文，
 * 就会被判成有改动，白写一次盘、还会让另一个窗口弹冲突。
 */
export function documentContentMatches(path: string, left: string, right: string): boolean {
  if (left === right) return true
  return normalizeDocumentForSave(path, left) === normalizeDocumentForSave(path, right)
}

/** 读盘；文件不在（或被锁）时返回 null，调用方按"读不到"处理而不是当空文件。 */
export async function readDiskDocument(path: string): Promise<string | null> {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}

/**
 * 从磁盘载入一份文档。
 *
 * 大纲优先读同名 `.html`（新保存的大纲都落了这份"好看的那一份"），没有才按
 * 正文即时渲染；两条都落空就只给 MD（`html: null`，UI 退回 MD 视图）。
 */
export async function loadReaderDocument(
  kind: ReaderWindowKind,
  path: string,
): Promise<ReaderDocumentContent> {
  const markdown = await readFile(path)

  if (kind === "chapter") {
    // frontmatter 要先剥：`splitChapterHeading` 只认正文首行，YAML 头会让它落空。
    const heading = splitChapterHeading(parseFrontmatter(markdown).body)
    return { markdown, html: null, heading: heading.heading || readerDocumentBaseName(path) }
  }

  let html: string | null = null
  const htmlPath = companionHtmlPath(path)
  if (htmlPath) {
    const raw = await readDiskDocument(htmlPath)
    if (raw?.trim()) html = raw
  }
  if (!html) html = renderOutlineHtmlForPath(path, markdown)
  return { markdown, html, heading: readerDocumentBaseName(path) }
}

/** 伴生 HTML 是否存在且非空——保存时用来区分"新建"与"覆盖"。 */
export async function hasCompanionHtml(mdPath: string): Promise<boolean> {
  const htmlPath = companionHtmlPath(mdPath)
  if (!htmlPath) return false
  try {
    if (!(await fileExists(htmlPath))) return false
    const raw = await readFile(htmlPath)
    return Boolean(raw.trim())
  } catch {
    return false
  }
}
