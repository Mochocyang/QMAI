import { parseFrontmatter } from "@/lib/frontmatter"
import { parseChapterMeta } from "@/lib/novel/chapter-meta"
import { extractChapterNumber } from "@/lib/novel/chapter-utils"

/** AI / chat draft files such as `chapter-046.md`. */
export function isDraftChapterPath(path: string): boolean {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? ""
  return /^chapter-\d+\.md$/i.test(name)
}

export function getDraftChapterPath(chapterDir: string, chapterNumber: number): string {
  return `${chapterDir.replace(/\\/g, "/").replace(/\/$/, "")}/chapter-${String(chapterNumber).padStart(3, "0")}.md`
}

export function extractChapterNumberFromPath(path: string): number | null {
  const stem = (path.replace(/\\/g, "/").split("/").pop() ?? "").replace(/\.md$/i, "")
  const draftMatch = stem.match(/^chapter-(\d+)$/i)
  if (draftMatch?.[1]) return Number.parseInt(draftMatch[1], 10)
  return extractChapterNumber(stem)
}

export function extractChapterNumberFromMarkdown(markdown: string): number | null {
  const { frontmatter } = parseFrontmatter(markdown)
  if (!frontmatter || typeof frontmatter !== "object") return null
  return parseChapterMeta(frontmatter as Record<string, unknown>)?.chapterNumber ?? null
}

/** Avoid flushing an empty in-memory snapshot over a chapter that still has disk content. */
export function shouldSkipEmptyChapterFlush(markdown: string, lastLoadedForPath: string): boolean {
  return !markdown.trim() && Boolean(lastLoadedForPath.trim())
}

export function chapterContentMatchesPath(path: string, markdown: string): boolean {
  const pathNumber = extractChapterNumberFromPath(path)
  const markdownNumber = extractChapterNumberFromMarkdown(markdown)
  if (pathNumber === null || markdownNumber === null) return true
  return pathNumber === markdownNumber
}

export function resolveChapterFlushMarkdown(
  path: string,
  markdown: string,
  lastLoadedByPath: ReadonlyMap<string, string>,
): string {
  const trimmed = markdown.trim()
  if (trimmed) return markdown
  return lastLoadedByPath.get(path) ?? ""
}

export function shouldSyncChapterOnLeave(
  path: string,
  markdown: string,
  lastLoadedForPath: string,
): boolean {
  const resolved = resolveChapterFlushMarkdown(path, markdown, new Map([[path, lastLoadedForPath]]))
  if (!resolved.trim()) return false
  if (shouldSkipEmptyChapterFlush(resolved, lastLoadedForPath)) return false
  if (!chapterContentMatchesPath(path, resolved)) return false
  return resolved !== lastLoadedForPath
}
