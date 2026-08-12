import { listDirectory, readFile } from "@/commands/fs"
import { getFileName, normalizePath } from "@/lib/path-utils"

/**
 * Resolve a saved citation path to a readable markdown file on disk.
 *
 * Handles:
 * - wiki/ ↔ QM/ virtualization
 * - nested outline folders (设定/章纲/卷纲/…) when the citation dropped the folder
 * - chapter titles with suffixes (第40章.md → 第40章-三百人.md)
 * - spaced chapter labels (第 40 章.md)
 * - skipping directories (卷纲/章纲 are folders, not files)
 */
export async function resolveCitedPagePath(
  projectPath: string,
  pagePath: string,
): Promise<string | null> {
  const pp = normalizePath(projectPath)
  const normalizedPage = pagePath.replace(/\\/g, "/").replace(/^\/+/, "")
  const bareId = getFileName(
    normalizedPage
      .replace(/^(wiki|QM)\//i, "")
      .replace(/\.md$/i, ""),
  )
  const withMd = bareId.toLowerCase().endsWith(".md") ? bareId : `${bareId}.md`
  const compactName = compactResourceName(bareId)

  // Folder-only citations are never openable as files.
  if (isKnownDirectoryCitation(normalizedPage, bareId)) return null

  const candidates = [
    `${pp}/${normalizedPage}`,
    `${pp}/${normalizedPage.replace(/^wiki\//i, "QM/")}`,
    `${pp}/${normalizedPage.replace(/^QM\//i, "wiki/")}`,
    `${pp}/wiki/outlines/${withMd}`,
    `${pp}/QM/outlines/${withMd}`,
    `${pp}/wiki/chapters/${withMd}`,
    `${pp}/QM/chapters/${withMd}`,
    `${pp}/wiki/memory/${withMd}`,
    `${pp}/QM/memory/${withMd}`,
    `${pp}/wiki/entities/${withMd}`,
    `${pp}/wiki/concepts/${withMd}`,
    `${pp}/wiki/sources/${withMd}`,
    `${pp}/wiki/queries/${withMd}`,
    `${pp}/wiki/synthesis/${withMd}`,
    `${pp}/wiki/comparisons/${withMd}`,
    `${pp}/wiki/${withMd}`,
    `${pp}/QM/${withMd}`,
  ]

  for (const candidate of unique(candidates)) {
    if (await isReadableMarkdownFile(candidate)) return candidate
  }

  const chapterNumber = extractChapterNumber(bareId)
  const searchRoots = [
    `${pp}/wiki/chapters`,
    `${pp}/QM/chapters`,
    `${pp}/wiki/outlines`,
    `${pp}/QM/outlines`,
    `${pp}/wiki/memory`,
    `${pp}/QM/memory`,
  ]

  for (const root of searchRoots) {
    const nested = await findMarkdownByQuery(root, {
      fileName: withMd,
      compactName,
      chapterNumber,
    }, 4)
    if (nested) return nested
  }

  return null
}

function unique(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const path of paths) {
    const key = normalizePath(path).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalizePath(path))
  }
  return out
}

function bareStem(fileName: string): string {
  return fileName.replace(/\.md$/i, "")
}

function compactResourceName(value: string): string {
  return bareStem(value)
    .toLowerCase()
    .replace(/[\s\-_\u2013\u2014,，、.。:：;；"'“”‘’《》<>【】\[\]()（）{}]/g, "")
}

function extractChapterNumber(value: string): number | null {
  const raw = value.replace(/\.md$/i, "")
  const patterns = [
    /第\s*0*(\d{1,5})\s*章/,
    /chapter[\s\-_]*0*(\d{1,5})/i,
    /\bch[\s\-_]*0*(\d{1,5})\b/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(raw)
    if (match?.[1]) return Number.parseInt(match[1], 10)
  }
  return null
}

function isKnownDirectoryCitation(pagePath: string, bareId: string): boolean {
  const compact = compactResourceName(bareId)
  if (compact === "卷纲" || compact === "章纲" || compact === "设定" || compact === "总纲") {
    // Only treat as a folder citation when the path has no .md suffix and no
    // chapter/title remainder (e.g. 章纲/第1章.md is a file under 章纲).
    if (/\.md$/i.test(pagePath)) return false
    const relative = pagePath
      .replace(/^(wiki|QM)\//i, "")
      .replace(/^(大纲|outlines)\//i, "")
    return relative === bareId || relative.endsWith(`/${bareId}`)
  }
  return false
}

async function isReadableMarkdownFile(path: string): Promise<boolean> {
  if (!/\.md$/i.test(path)) return false
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

interface MarkdownQuery {
  fileName: string
  compactName: string
  chapterNumber: number | null
}

async function findMarkdownByQuery(
  rootDir: string,
  query: MarkdownQuery,
  maxDepth: number,
  depth = 0,
): Promise<string | null> {
  let entries: Array<{ name: string; path: string; is_dir: boolean }>
  try {
    entries = await listDirectory(rootDir)
  } catch {
    return null
  }

  const targetName = query.fileName.toLowerCase()
  let chapterMatch: string | null = null

  for (const entry of entries) {
    if (entry.is_dir) continue
    if (!entry.name.toLowerCase().endsWith(".md")) continue

    if (entry.name.toLowerCase() === targetName) {
      if (await isReadableMarkdownFile(entry.path)) return normalizePath(entry.path)
    }

    const entryCompact = compactResourceName(entry.name)
    if (query.compactName) {
      // Exact compact match, or titled chapter/outline like 第40章-三百人.
      const titledPrefix = entryCompact.startsWith(query.compactName)
        && (
          entryCompact === query.compactName
          || entry.name.replace(/\.md$/i, "").includes(`${bareStem(query.fileName)}-`)
          || entry.name.replace(/\.md$/i, "").includes(`${bareStem(query.fileName)}—`)
        )
      if (entryCompact === query.compactName || titledPrefix) {
        if (await isReadableMarkdownFile(entry.path)) return normalizePath(entry.path)
      }
    }

    if (query.chapterNumber !== null && chapterMatch === null) {
      const entryChapter = extractChapterNumber(entry.name)
      if (entryChapter === query.chapterNumber) {
        chapterMatch = entry.path
      }
    }
  }

  if (chapterMatch && await isReadableMarkdownFile(chapterMatch)) {
    return normalizePath(chapterMatch)
  }

  if (depth >= maxDepth) return null

  for (const entry of entries) {
    if (!entry.is_dir) continue
    const nested = await findMarkdownByQuery(entry.path, query, maxDepth, depth + 1)
    if (nested) return nested
  }
  return null
}
