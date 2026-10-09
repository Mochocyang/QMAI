/**
 * Normalize a path to use forward slashes (works on both macOS and Windows).
 * Windows APIs accept forward slashes, so normalizing to / is safe everywhere.
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/")
}

/** Strip trailing slashes after normalize (except bare root forms). */
export function normalizeComparablePath(p: string): string {
  return normalizePath(p).replace(/\/+$/, "")
}

/** True when `path` is `parent` or a descendant under `parent/`. */
export function isPathInside(path: string, parent: string): boolean {
  const normalizedPath = normalizeComparablePath(path)
  const normalizedParent = normalizeComparablePath(parent)
  if (!normalizedPath || !normalizedParent) return false
  return (
    normalizedPath === normalizedParent ||
    normalizedPath.startsWith(`${normalizedParent}/`)
  )
}

/** True when `chapterPath` is a chapter markdown file under the project's wiki/chapters. */
export function isChapterPathInProject(chapterPath: string, projectPath: string): boolean {
  const chaptersRoot = `${normalizeComparablePath(projectPath)}/wiki/chapters`
  const normalizedChapter = normalizeComparablePath(chapterPath)
  if (!isPathInside(normalizedChapter, chaptersRoot)) return false
  return normalizedChapter.toLowerCase().endsWith(".md")
}

/**
 * True for the chapter *body* directory regardless of which project it belongs to.
 *
 * 只看路径形状，不比对项目根：写作统计要在「AI 刚写完一个新的章节文件」那一刻
 * 判断该不该记账，此时手头只有绝对路径，没有可靠的 projectPath 可比。
 */
export function isChapterPath(path: string): boolean {
  return normalizePath(path).includes("/wiki/chapters/")
}

/**
 * Join path segments with forward slashes.
 */
export function joinPath(...segments: string[]): string {
  return segments
    .map((s) => s.replace(/\\/g, "/"))
    .join("/")
    .replace(/\/+/g, "/")
}

/**
 * Get the filename from a path (handles both / and \).
 */
export function getFileName(p: string): string {
  const normalized = p.replace(/\\/g, "/")
  return normalized.split("/").pop() ?? p
}

/**
 * Get the file stem (filename without extension).
 */
export function getFileStem(p: string): string {
  const name = getFileName(p)
  const lastDot = name.lastIndexOf(".")
  return lastDot > 0 ? name.slice(0, lastDot) : name
}

/**
 * Get relative path from base.
 */
export function getRelativePath(fullPath: string, basePath: string): string {
  const normalFull = normalizePath(fullPath)
  const normalBase = normalizePath(basePath).replace(/\/$/, "")
  if (normalFull.startsWith(normalBase + "/")) {
    return normalFull.slice(normalBase.length + 1)
  }
  return normalFull
}

/**
 * Cross-platform absolute-path detection.
 *
 * Unix:     "/foo/bar"
 * Windows:  "C:\foo", "C:/foo", "\\server\share", "//server/share"
 *
 * A bare `.startsWith("/")` check wrongly treats Windows paths like
 * "C:/project/file.pdf" as relative, which produced double-joined
 * garbage like "C:/project/C:/project/file.pdf" in the ingest queue.
 */
export function isAbsolutePath(p: string): boolean {
  if (!p) return false
  if (p.startsWith("/")) return true
  if (/^[A-Za-z]:[\\/]/.test(p)) return true
  if (p.startsWith("\\\\") || p.startsWith("//")) return true
  return false
}
