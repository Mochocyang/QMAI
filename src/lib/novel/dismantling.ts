import { createDirectory, fileExists, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export type DismantlingChapterStatus = "pending" | "running" | "done" | "failed"

export interface DismantlingChapter {
  id: string
  chapterNumber: number
  title: string
  content: string
  status: DismantlingChapterStatus
  error?: string
}

export interface DismantlingAnalysis {
  id: string
  chapterIds: string[]
  title: string
  createdAt: number
  markdown: string
  structureMemory: string[]
}

export interface DismantlingProject {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  chapters: DismantlingChapter[]
  analyses: DismantlingAnalysis[]
  structureMemory: string[]
  useInChat?: boolean
}

export interface DismantlingLibrary {
  version: 1
  projects: DismantlingProject[]
  selectedProjectId?: string | null
}

export interface DismantlingBatchOptions {
  selectedChapterIds: string[]
  batchSize: number
}

const DEFAULT_LIBRARY: DismantlingLibrary = {
  version: 1,
  projects: [],
  selectedProjectId: null,
}

export const DISMANTLING_NO_PREPROCESSING_NEEDED = "no preprocessing needed"

export function getDismantlingLibraryPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/dismantling/library.json`
}

export function getDismantlingLibraryDir(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/dismantling`
}

export async function loadDismantlingLibrary(projectPath: string): Promise<DismantlingLibrary> {
  const path = getDismantlingLibraryPath(projectPath)
  if (!(await fileExists(path))) return { ...DEFAULT_LIBRARY }
  try {
    const parsed = JSON.parse(await readFile(path)) as Partial<DismantlingLibrary>
    return normalizeDismantlingLibrary(parsed)
  } catch {
    return { ...DEFAULT_LIBRARY }
  }
}

export async function saveDismantlingLibrary(projectPath: string, library: DismantlingLibrary): Promise<void> {
  await createDirectory(getDismantlingLibraryDir(projectPath)).catch(() => {})
  await writeFile(getDismantlingLibraryPath(projectPath), JSON.stringify(normalizeDismantlingLibrary(library), null, 2))
}

export function normalizeDismantlingLibrary(input: Partial<DismantlingLibrary> | null | undefined): DismantlingLibrary {
  const projects = dedupeDismantlingProjects(
    Array.isArray(input?.projects) ? input.projects.map(normalizeDismantlingProject).filter(Boolean) : [],
  )
  const selectedProjectId = projects.some((project) => project.id === input?.selectedProjectId)
    ? input?.selectedProjectId
    : projects[0]?.id ?? null
  return {
    version: 1,
    projects,
    selectedProjectId,
  }
}

export function normalizeDismantlingProjectTitle(title: string): string {
  return title
    .normalize("NFKC")
    .trim()
    .replace(/\.(txt|md|mdx|doc|docx)$/i, "")
    .replace(/\s+/g, "")
    .toLowerCase()
}

export function shouldReadDismantlingOriginalFile(preprocessedText: string): boolean {
  return preprocessedText.trim().toLowerCase() === DISMANTLING_NO_PREPROCESSING_NEEDED
}

function dedupeDismantlingProjects(projects: DismantlingProject[]): DismantlingProject[] {
  const seen = new Set<string>()
  return projects.filter((project) => {
    const key = normalizeDismantlingProjectTitle(project.title)
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeDismantlingProject(input: Partial<DismantlingProject> | null | undefined): DismantlingProject {
  const now = Date.now()
  const chapters = Array.isArray(input?.chapters)
    ? input.chapters.map((chapter, index) => normalizeDismantlingChapter(chapter, index + 1))
    : []
  const analyses = Array.isArray(input?.analyses)
    ? input.analyses.map(normalizeDismantlingAnalysis)
    : []
  return {
    id: input?.id || `dismantling-${now}`,
    title: input?.title || "未命名拆文作品",
    createdAt: Number(input?.createdAt) || now,
    updatedAt: Number(input?.updatedAt) || now,
    chapters,
    analyses,
    structureMemory: Array.isArray(input?.structureMemory) ? input.structureMemory.filter(Boolean) : [],
    useInChat: Boolean(input?.useInChat),
  }
}

function normalizeDismantlingChapter(input: Partial<DismantlingChapter>, fallbackNumber: number): DismantlingChapter {
  return {
    id: input.id || `chapter-${fallbackNumber}`,
    chapterNumber: Number(input.chapterNumber) || fallbackNumber,
    title: input.title || `第${fallbackNumber}章`,
    content: input.content || "",
    status: input.status ?? "pending",
    error: input.error,
  }
}

function normalizeDismantlingAnalysis(input: Partial<DismantlingAnalysis>): DismantlingAnalysis {
  return {
    id: input.id || `analysis-${Date.now()}`,
    chapterIds: Array.isArray(input.chapterIds) ? input.chapterIds : [],
    title: input.title || "拆文结果",
    createdAt: Number(input.createdAt) || Date.now(),
    markdown: input.markdown || "",
    structureMemory: Array.isArray(input.structureMemory) ? input.structureMemory.filter(Boolean) : [],
  }
}

export function splitDismantlingTextIntoChapters(text: string): DismantlingChapter[] {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .trim()
  if (!normalized) return []

  const matches = collectDismantlingChapterStarts(normalized)
  if (matches.length === 0) {
    return [{
      id: "chapter-001",
      chapterNumber: 1,
      title: "第1章",
      content: normalized,
      status: "pending",
    }]
  }

  return matches.map((match, index) => {
    const start = match.index
    const nextStart = matches[index + 1]?.index ?? normalized.length
    const raw = normalized.slice(start, nextStart).trim()
    const { title, content } = splitDismantlingChapterSegment(raw, index + 1)
    const chapterNumber = extractDismantlingChapterNumber(title) ?? index + 1
    return {
      id: `chapter-${String(chapterNumber).padStart(3, "0")}`,
      chapterNumber,
      title,
      content,
      status: "pending",
    }
  })
}

export function extractDismantlingChapterNumber(value: string): number | null {
  const normalized = value.normalize("NFKC")
  const digitMatches = [...normalized.matchAll(/(?:第\s*0*(\d+)\s*[章节回]|chapter\s*0*(\d+))/gi)]
  const digit = digitMatches[digitMatches.length - 1]
  if (digit) return Number.parseInt(digit[1] ?? digit[2], 10)
  const chineseMatches = [...normalized.matchAll(/第\s*([零〇一二三四五六七八九十百千万两]+)\s*[章节回]/g)]
  const chinese = chineseMatches[chineseMatches.length - 1]?.[1]
  return chinese ? parseChineseNumber(chinese) : null
}

function createDismantlingChapterHeadingPattern(): RegExp {
  const chineseNumber = "零〇一二三四五六七八九十百千万两"
  const chapterNumber = `(?:\\d+|[${chineseNumber}]+)`
  const chapterMarker = `第\\s*${chapterNumber}\\s*[章节回]`
  const volumePrefix = `(?:(?:正文卷|第\\s*${chapterNumber}\\s*卷|[^\\n]{1,24}卷)[^\\n]{0,32}?)`
  return new RegExp(`^[ \\t]*(?:#{1,3}[ \\t]*)?(?:${volumePrefix}[ \\t]*)?(?:${chapterMarker}[^\\n]*|chapter[ \\t]*\\d+[^\\n]*)$`, "gim")
}

function collectDismantlingChapterStarts(text: string): { index: number }[] {
  const lineMatches = [...text.matchAll(createDismantlingChapterHeadingPattern())]
    .map((match) => ({ index: match.index ?? 0 }))
  const inlineMatches = [...text.matchAll(createDismantlingInlineChapterPattern())]
    .map((match) => ({ index: (match.index ?? 0) + (match[1]?.length ?? 0) }))
  return inlineMatches.length > lineMatches.length ? inlineMatches : lineMatches
}

function createDismantlingInlineChapterPattern(): RegExp {
  const chineseNumber = "零〇一二三四五六七八九十百千万两"
  const chapterNumber = `(?:\\d+|[${chineseNumber}]+)`
  const chapterMarker = `第\\s*${chapterNumber}\\s*[章节回]`
  const volumePrefix = `(?:(?:正文卷|第\\s*${chapterNumber}\\s*卷|[^。！？!?\\n]{1,24}卷)[^。！？!?\\n]{0,32}?)`
  return new RegExp(`(^|\\n|\\s{2,})((?:#{1,3}[ \\t]*)?(?:${volumePrefix}[ \\t]*)?(?:${chapterMarker}|chapter[ \\t]*\\d+))`, "gim")
}

function splitDismantlingChapterSegment(raw: string, fallbackNumber: number): { title: string; content: string } {
  const [firstLine = `第${fallbackNumber}章`, ...bodyLines] = raw.split("\n")
  const cleanedFirstLine = cleanDismantlingChapterTitle(firstLine)
  if (bodyLines.length > 0 && cleanedFirstLine.length <= 100) {
    return {
      title: cleanedFirstLine,
      content: bodyLines.join("\n").trim(),
    }
  }
  return splitInlineDismantlingChapter(raw, fallbackNumber)
}

function splitInlineDismantlingChapter(raw: string, fallbackNumber: number): { title: string; content: string } {
  const cleaned = cleanDismantlingChapterTitle(raw)
  const markerMatch = cleaned.match(/^(.*?(?:第\s*(?:\d+|[零〇一二三四五六七八九十百千万两]+)\s*[章节回]|chapter\s*\d+))/i)
  const marker = markerMatch?.[1]?.trim() || `第${fallbackNumber}章`
  const afterMarker = cleaned.slice(marker.length).trim()
  const beforePunctuation = afterMarker.split(/[。！？!?]/)[0]?.trim() ?? ""
  const titleTail = beforePunctuation.split(/\s+/)[0]?.trim() ?? ""
  const title = [marker, titleTail].filter(Boolean).join(" ")
  const contentStart = Math.min(cleaned.length, title.length)
  return {
    title,
    content: cleaned.slice(contentStart).trim(),
  }
}

function cleanDismantlingChapterTitle(value: string): string {
  return value
    .replace(/^\s*#{1,3}\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
}

function parseChineseNumber(value: string): number | null {
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
  let total = 0
  let section = 0
  let number = 0
  let seen = false
  for (const char of value) {
    if (digits[char] !== undefined) {
      number = digits[char]
      seen = true
      continue
    }
    const unit = units[char]
    if (!unit) return null
    seen = true
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
  return seen && result > 0 ? result : null
}

export function selectNextDismantlingBatch(
  project: DismantlingProject,
  options: DismantlingBatchOptions,
): DismantlingChapter[] {
  const selected = new Set(options.selectedChapterIds)
  const batchSize = Math.max(1, Math.min(10, Math.floor(options.batchSize || 1)))
  return project.chapters
    .filter((chapter) => selected.has(chapter.id) && chapter.status !== "done")
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
    .slice(0, batchSize)
}

export function buildDismantlingAnalysisPrompt(input: {
  projectTitle: string
  chapters: DismantlingChapter[]
}): string {
  return [
    "你是小说拆文分析助手。请把下面章节拆成可复用的写法结构，结果写入独立拆文记忆库。",
    "",
    "重要边界：",
    "- 拆文结果只服务写作结构参考，不得把原作人物、设定、剧情当成当前小说事实。",
    "- 不要复述大段原文，不要输出可替代原文的连续文本。",
    "- 只输出结构化写法分析，重点分析章节结构、冲突推进、爽点、情绪节奏、人物作用、信息增量、结尾钩子和可复用模板。",
    "- 后续 AI 写作只能学习节奏、冲突推进、爽点安排和章节钩子，不得复用原作人物、设定、剧情和具体表达。",
    "",
    `拆文作品：${input.projectTitle}`,
    "",
    "请按以下 Markdown 结构输出：",
    "## 本批总览",
    "## 章节拆解",
    "## 人物与关系写法",
    "## 冲突与爽点",
    "## 结尾钩子",
    "## 可复用结构记忆",
    "",
    "章节内容：",
    input.chapters.map((chapter) => [
      `### ${chapter.title}`,
      `章节序号：${chapter.chapterNumber}`,
      chapter.content,
    ].join("\n")).join("\n\n"),
  ].join("\n")
}

export function buildDismantlingWebResearchPrompt(input: {
  projectTitle: string
  userRequest: string
  webResearchContext: string
}): string {
  return [
    "你是小说拆文与市场趋势分析助手。请基于用户指定的网页资料或联网搜索资料，输出网页热门分析。",
    "",
    "重要边界：",
    "- 本结果只写入独立拆文记忆库，不要写入当前小说事实、章节记忆或大纲记忆。",
    "- 只能提炼题材趋势、开篇结构、卖点、爽点、冲突推进、读者期待和可复用写法。",
    "- 不要复述网页大段原文，不要复制原作人物、设定、剧情和具体表达。",
    "- 如果网页资料不足，请直接说明资料不足，并列出还需要补充的资料方向。",
    "",
    `拆文作品：${input.projectTitle}`,
    `用户要求：${input.userRequest}`,
    "",
    input.webResearchContext,
    "",
    "请按以下 Markdown 结构输出：",
    "## 网页热门分析",
    "## 题材与卖点趋势",
    "## 开篇与章节节奏",
    "## 冲突、爽点与钩子",
    "## 可复用结构记忆",
  ].join("\n")
}

export function extractStructureMemoryFromAnalysis(markdown: string): string[] {
  const sectionMatch = markdown.match(/##\s*可复用结构记忆\s*\n([\s\S]*)$/)
  const raw = sectionMatch?.[1] ?? markdown
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter((line) => line.length >= 6)
    .slice(0, 30)
}

export function buildDismantlingReferenceDirective(input: {
  title: string
  structureMemory: string[]
}): string {
  if (input.structureMemory.length === 0) return ""
  return [
    "## 参考拆文结构",
    `当前用户选择参考拆文作品：${input.title}`,
    "",
    "使用规则：",
    "- 只学习节奏、冲突推进、爽点安排和章节钩子。",
    "- 不得复用原作人物、不得复用原作设定、不得复用原作剧情、不得复用原作具体表达。",
    "- 拆文结构不是当前小说记忆，不得把它当成当前小说已经发生的事实。",
    "",
    "可参考的结构记忆：",
    ...input.structureMemory.map((item) => `- ${item}`),
  ].join("\n")
}
