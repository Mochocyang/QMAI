import { listDirectory, readFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"

interface MarkdownCandidate {
  name: string
  path: string
}

interface DirectoryCandidate {
  name: string
  path: string
  children: MarkdownCandidate[]
}

export type ReadTextFile = (path: string) => Promise<string>

function ensureMarkdownName(name: string): string {
  return name.toLowerCase().endsWith(".md") ? name : `${name}.md`
}

function stripMarkdownExt(name: string): string {
  return name.replace(/\.md$/i, "")
}

function normalizeResourceName(value: string): string {
  return stripMarkdownExt(value)
    .toLowerCase()
    .replace(/[\s\-_\u2013\u2014,，、.。:：;；"'“”‘’《》<>【】\[\]()（）{}]/g, "")
}

function extractChapterNumber(value: string): number | null {
  const raw = stripMarkdownExt(value).toLowerCase()
  const patterns = [
    /第\s*0*(\d{1,5})\s*章/,
    /chapter[\s\-_]*0*(\d{1,5})/,
    /\bch[\s\-_]*0*(\d{1,5})\b/,
  ]
  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (match?.[1]) return Number.parseInt(match[1], 10)
  }
  return null
}

async function safeListDirectory(path: string): Promise<FileNode[]> {
  try {
    return await listDirectory(path)
  } catch {
    return []
  }
}

async function collectMarkdownCandidates(
  rootDir: string,
  depth = 0,
  maxDepth = 3,
): Promise<{ files: MarkdownCandidate[]; directories: DirectoryCandidate[] }> {
  const entries = await safeListDirectory(rootDir)
  const files: MarkdownCandidate[] = []
  const directories: DirectoryCandidate[] = []

  for (const entry of entries) {
    if (!entry.is_dir) {
      if (entry.name.toLowerCase().endsWith(".md")) {
        files.push({ name: stripMarkdownExt(entry.name), path: entry.path })
      }
      continue
    }

    if (depth >= maxDepth) {
      directories.push({ name: entry.name, path: entry.path, children: [] })
      continue
    }

    const childResult = await collectMarkdownCandidates(entry.path, depth + 1, maxDepth)
    directories.push({ name: entry.name, path: entry.path, children: childResult.files })
    files.push(...childResult.files)
    directories.push(...childResult.directories)
  }

  return { files, directories }
}

function scoreCandidate(query: string, candidate: MarkdownCandidate): number {
  const normalizedQuery = normalizeResourceName(query)
  const normalizedName = normalizeResourceName(candidate.name)
  if (!normalizedQuery || !normalizedName) return 0
  if (normalizedName === normalizedQuery) return 100
  if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) return 80

  const chapterMatch = normalizedQuery.match(/第?(\d+)章/)
  if (chapterMatch && normalizedName.includes(chapterMatch[1]) && normalizedName.includes("章")) {
    return 60
  }

  const queryChapterNumber = extractChapterNumber(query)
  const candidateChapterNumber = extractChapterNumber(candidate.name)
  if (
    queryChapterNumber !== null &&
    candidateChapterNumber !== null &&
    queryChapterNumber === candidateChapterNumber
  ) {
    return 70
  }

  return 0
}

function formatCandidateList(candidates: MarkdownCandidate[], limit = 8): string {
  return candidates
    .slice(0, limit)
    .map((candidate, index) => `${index + 1}. ${candidate.name}`)
    .join("\n")
}

function pickSingleMatch(query: string, candidates: MarkdownCandidate[]): MarkdownCandidate | null {
  const ranked = candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(query, candidate) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)

  if (ranked.length === 0) return null
  if (ranked.length === 1) return ranked[0].candidate
  return ranked[0].score > ranked[1].score ? ranked[0].candidate : null
}

function findDirectoryMatch(query: string, directories: DirectoryCandidate[]): DirectoryCandidate | null {
  const normalizedQuery = normalizeResourceName(query)
  return directories.find((directory) => normalizeResourceName(directory.name) === normalizedQuery) ?? null
}

export async function readMarkdownResource(
  baseDir: string,
  params: Record<string, unknown>,
  label: string,
  readTextFile: ReadTextFile = readFile,
): Promise<string> {
  const name = typeof params.name === "string" ? params.name.trim() : ""
  const explicitPath = typeof params.path === "string" ? params.path.trim() : ""
  const displayName = name || explicitPath

  if (explicitPath) {
    try {
      return await readTextFile(explicitPath)
    } catch {
      return `错误：无法读取${label}「${displayName}」，请确认文件存在`
    }
  }

  if (!name) {
    return `错误：缺少${label}名称或文件路径`
  }

  const directPath = `${baseDir}/${ensureMarkdownName(name)}`
  try {
    return await readTextFile(directPath)
  } catch {
    // 继续用目录候选纠错。
  }

  const { files, directories } = await collectMarkdownCandidates(baseDir)
  const directoryMatch = findDirectoryMatch(name, directories)
  if (directoryMatch) {
    const nestedList = formatCandidateList(directoryMatch.children)
    return nestedList
      ? `「${name}」是目录，不是单个${label}。可读取以下条目：\n${nestedList}`
      : `「${name}」是目录，但目录下没有找到可读取的 .md 条目。`
  }

  const singleMatch = pickSingleMatch(name, files)
  if (singleMatch) {
    try {
      return await readTextFile(singleMatch.path)
    } catch {
      return `错误：已匹配到${label}「${singleMatch.name}」，但无法读取文件，请确认文件存在`
    }
  }

  const available = formatCandidateList(files)
  return available
    ? `错误：无法读取${label}「${displayName}」。可用候选：\n${available}`
    : `错误：无法读取${label}「${displayName}」，请确认文件存在`
}
