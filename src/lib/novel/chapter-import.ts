import { createDirectory, fileExists, listDirectory, readFile, writeFile } from "@/commands/fs"
import { getFileName, getFileStem, normalizePath } from "@/lib/path-utils"
import { makeSafeFileSlug } from "@/lib/wiki-filename"
import type { FileNode } from "@/types/wiki"

export const CHAPTER_IMPORT_EXTENSIONS = ["txt", "md", "mdx", "doc", "docx"] as const

const CHAPTER_IMPORT_EXTENSION_SET = new Set<string>(CHAPTER_IMPORT_EXTENSIONS)

export interface ChapterImportCandidate {
  path: string
  name: string
}

export interface ImportedChapter {
  sourcePath: string
  path: string
  title: string
  chapterNumber: number
}

export interface ChapterImportFilenameMatch {
  chapterNumber: number
  titleSuffix: string
}

export interface ImportedChapterMemoryProgress {
  completed: number
  total: number
  currentPath: string | null
}

export interface ImportedChapterMemoryResult {
  completed: number
  failed: number
  cancelled: boolean
  errors: string[]
}

type IngestChapterDependency = (
  projectPath: string,
  chapterPath: string,
  reviewModel?: string,
) => Promise<{ snapshot: unknown | null; failReason?: string }>

function yamlEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function normalizeFullWidthDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10))
}

function parseChineseInteger(value: string): number | null {
  const normalized = value.replace(/两/g, "二").replace(/[零〇]/g, "")
  if (!normalized) return 0
  const digitMap: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  const unitMap: Record<string, number> = {
    十: 10,
    百: 100,
    千: 1000,
    万: 10000,
  }

  let total = 0
  let section = 0
  let number = 0
  let hasValue = false

  for (const char of normalized) {
    if (digitMap[char] !== undefined) {
      number = digitMap[char]
      hasValue = true
      continue
    }
    const unit = unitMap[char]
    if (!unit) return null
    hasValue = true
    if (unit === 10000) {
      section = (section + (number || 1)) * unit
      total += section
      section = 0
    } else {
      section += (number || 1) * unit
    }
    number = 0
  }

  const result = total + section + number
  return hasValue && result > 0 ? result : null
}

export function extractImportedChapterNumber(text: string): number | null {
  const chapterMatch = matchChapterImportFilename(text)
  if (chapterMatch) return chapterMatch.chapterNumber

  const normalized = normalizeFullWidthDigits(text.normalize("NFKC"))

  const englishMatch = normalized.match(/chapter\s*[-_ ]*0*([0-9]+)/i)
  if (englishMatch?.[1]) return Number.parseInt(englishMatch[1], 10)

  const leadingNumberMatch = normalized.match(/^0*([0-9]{1,5})(?:\D|$)/)
  if (leadingNumberMatch?.[1]) return Number.parseInt(leadingNumberMatch[1], 10)

  return null
}

function parseChapterNumberToken(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10)
  return parseChineseInteger(raw)
}

export function matchChapterImportFilename(text: string): ChapterImportFilenameMatch | null {
  const stem = getFileStem(getFileName(text) || text)
  const normalized = normalizeFullWidthDigits(stem.normalize("NFKC"))

  const chapterPatterns = [
    /(?:^|[-_—–\s/\\])第\s*([0-9]+|[零〇一二三四五六七八九十百千万两]+)\s*[章节回]\s*[-_:：，、.。\s]*(.*)$/i,
    /(?:^|[-_—–\s/\\])chapter\s*[-_ ]*0*([0-9]+)\s*[-_:：，、.。\s]*(.*)$/i,
  ]

  for (const pattern of chapterPatterns) {
    const match = normalized.match(pattern)
    const rawNumber = match?.[1]
    if (!rawNumber) continue
    const chapterNumber = parseChapterNumberToken(rawNumber)
    if (!chapterNumber || chapterNumber <= 0) continue
    return {
      chapterNumber,
      titleSuffix: cleanImportedChapterTitleSuffix(match[2] ?? ""),
    }
  }

  return null
}

function chapterSortNumber(candidate: ChapterImportCandidate): number | null {
  return extractImportedChapterNumber(candidate.name) ?? extractImportedChapterNumber(candidate.path)
}

export function sortChapterImportCandidates(
  candidates: readonly ChapterImportCandidate[],
): ChapterImportCandidate[] {
  return [...candidates].sort((a, b) => {
    const aNumber = chapterSortNumber(a)
    const bNumber = chapterSortNumber(b)
    if (aNumber !== null && bNumber !== null && aNumber !== bNumber) return aNumber - bNumber
    if (aNumber !== null && bNumber === null) return -1
    if (aNumber === null && bNumber !== null) return 1
    return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true })
  })
}

function stripFrontmatter(content: string): string {
  return content.replace(/^\uFEFF/, "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
}

function stripLeadingHeading(content: string): string {
  return content.replace(/^#\s+.+(?:\r?\n){1,2}/, "").trim()
}

function stripChapterPrefix(title: string): string {
  const matched = matchChapterImportFilename(title)
  if (matched) return matched.titleSuffix
  return cleanImportedChapterTitleSuffix(
    title
      .normalize("NFKC")
      .replace(/^第\s*(?:\d+|[零〇一二三四五六七八九十百千万两]+)\s*[章节回]\s*[-_:：，、.。]?\s*/, ""),
  )
}

function cleanImportedChapterTitleSuffix(title: string): string {
  return title
    .replace(/\.(txt|mdx?|docx?|rtf)$/i, "")
    .replace(/^[-_—–\s:：，、.。]+/, "")
    .trim()
}

function titleFromCandidate(candidate: ChapterImportCandidate, chapterNumber: number): string {
  const stem = getFileStem(candidate.name).trim()
  const suffix = matchChapterImportFilename(candidate.name)?.titleSuffix || stripChapterPrefix(stem)
  return suffix ? `第${chapterNumber}章 ${suffix}` : `第${chapterNumber}章`
}

export function buildImportedChapterMarkdown({
  title,
  chapterNumber,
  body,
  finalForMemoryExtraction,
}: {
  title: string
  chapterNumber: number
  body: string
  finalForMemoryExtraction: boolean
}): string {
  const cleanedBody = stripLeadingHeading(stripFrontmatter(body))
  return [
    "---",
    "type: chapter",
    `title: "${yamlEscape(title)}"`,
    `chapter_number: ${chapterNumber}`,
    `chapter_status: ${finalForMemoryExtraction ? "final" : "draft"}`,
    "---",
    "",
    `# ${title}`,
    "",
    cleanedBody,
    "",
  ].join("\n")
}

function isChapterImportablePath(path: string): boolean {
  const fileName = getFileName(path)
  if (!fileName || fileName.startsWith(".")) return false
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : ""
  return CHAPTER_IMPORT_EXTENSION_SET.has(extension)
}

function collectImportableChapterFiles(nodes: readonly FileNode[]): ChapterImportCandidate[] {
  const files: ChapterImportCandidate[] = []
  for (const node of nodes) {
    if (node.name.startsWith(".")) continue
    if (node.is_dir) {
      if (node.children) files.push(...collectImportableChapterFiles(node.children))
      continue
    }
    if (isChapterImportablePath(node.path)) {
      files.push({ path: node.path, name: node.name })
    }
  }
  return files
}

export async function collectChapterImportCandidatesFromFolder(selectedFolder: string): Promise<ChapterImportCandidate[]> {
  const tree = await listDirectory(normalizePath(selectedFolder))
  return sortChapterImportCandidates(collectImportableChapterFiles(tree))
}

async function getUniqueChapterImportPath(chaptersDir: string, chapterNumber: number, title: string): Promise<string> {
  const safeSuffix = makeSafeFileSlug(stripChapterPrefix(title), "")
  const baseName = safeSuffix
    ? `chapter-${String(chapterNumber).padStart(3, "0")}-${safeSuffix}.md`
    : `chapter-${String(chapterNumber).padStart(3, "0")}.md`
  const firstPath = `${chaptersDir}/${baseName}`
  if (!(await fileExists(firstPath))) return firstPath

  const stem = baseName.replace(/\.md$/i, "")
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${chaptersDir}/${stem}-${index}.md`
    if (!(await fileExists(candidate))) return candidate
  }
  return `${chaptersDir}/${stem}-${Date.now()}.md`
}

export async function importChapterFiles(
  projectPath: string,
  sourcePaths: readonly string[],
  options: { finalForMemoryExtraction: boolean },
): Promise<ImportedChapter[]> {
  const candidates = sourcePaths
    .map((path) => ({ path: normalizePath(path), name: getFileName(path) }))
    .filter((candidate) => isChapterImportablePath(candidate.path))
  return importChapterCandidates(projectPath, candidates, options)
}

export async function importChapterFolder(
  projectPath: string,
  selectedFolder: string,
  options: { finalForMemoryExtraction: boolean },
): Promise<ImportedChapter[]> {
  const candidates = await collectChapterImportCandidatesFromFolder(selectedFolder)
  return importChapterCandidates(projectPath, candidates, options)
}

async function importChapterCandidates(
  projectPath: string,
  candidates: readonly ChapterImportCandidate[],
  options: { finalForMemoryExtraction: boolean },
): Promise<ImportedChapter[]> {
  const pp = normalizePath(projectPath)
  const chaptersDir = `${pp}/wiki/chapters`
  await createDirectory(chaptersDir).catch(() => {})

  const imported: ImportedChapter[] = []
  const sorted = sortChapterImportCandidates(candidates)

  for (let index = 0; index < sorted.length; index += 1) {
    const candidate = sorted[index]
    const detectedNumber = chapterSortNumber(candidate)
    const chapterNumber = detectedNumber ?? index + 1
    const title = titleFromCandidate(candidate, chapterNumber)
    try {
      const content = await readFile(candidate.path)
      const targetPath = await getUniqueChapterImportPath(chaptersDir, chapterNumber, title)
      await writeFile(targetPath, buildImportedChapterMarkdown({
        title,
        chapterNumber,
        body: content,
        finalForMemoryExtraction: options.finalForMemoryExtraction,
      }))
      imported.push({ sourcePath: candidate.path, path: targetPath, title, chapterNumber })
    } catch (error) {
      console.error("[chapter-import] failed to import chapter file:", candidate.path, error)
    }
  }

  return imported
}

export async function runImportedChapterMemoryExtraction({
  projectPath,
  chapterPaths,
  signal,
  reviewModel,
  ingestChapter,
  onProgress,
}: {
  projectPath: string
  chapterPaths: readonly string[]
  signal?: AbortSignal
  reviewModel?: string
  ingestChapter: IngestChapterDependency
  onProgress?: (progress: ImportedChapterMemoryProgress) => void
}): Promise<ImportedChapterMemoryResult> {
  const errors: string[] = []
  let completed = 0
  let failed = 0

  for (const chapterPath of chapterPaths) {
    if (signal?.aborted) {
      return { completed, failed, cancelled: true, errors }
    }
    onProgress?.({ completed, total: chapterPaths.length, currentPath: chapterPath })
    try {
      const result = await ingestChapter(projectPath, chapterPath, reviewModel)
      if (result.snapshot) {
        completed += 1
      } else {
        failed += 1
        errors.push(`${getFileName(chapterPath)}：${result.failReason ?? "提取失败"}`)
      }
    } catch (error) {
      failed += 1
      errors.push(`${getFileName(chapterPath)}：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { completed, failed, cancelled: Boolean(signal?.aborted), errors }
}
