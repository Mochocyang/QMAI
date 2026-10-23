import { listDirectory, readFile } from "@/commands/fs"
import { mapWithConcurrency } from "@/lib/async-pool"
import { parseFrontmatter } from "@/lib/frontmatter"
import { normalizePath } from "@/lib/path-utils"
import type { FileNode } from "@/types/wiki"

type OutlineSegmentKind =
  | "master"
  | "volume"
  | "chapter-plan"
  | "chapter"
  | "character"
  | "setting"
  | "foreshadowing"
  | "material"
  | "unknown"

interface OutlineDocument {
  path: string
  relativePath: string
  folder?: string
  kind: OutlineSegmentKind
  content: string
  frontmatter: Record<string, unknown> | null
}

interface OutlineSegment {
  path: string
  relativePath: string
  folder?: string
  kind: OutlineSegmentKind
  content: string
  volumeScopeId?: string
  frontmatter: Record<string, unknown> | null
}

interface OutlineDocumentIndex {
  projectPath: string
  documents: OutlineDocument[]
  segments: OutlineSegment[]
}

interface ChapterOutlineResolution {
  content: string
  sourceKind: "standalone" | "volume" | "chapter-plan" | "master" | "none"
  sourcePaths: string[]
}

interface ResolvedVolume {
  scopeId: string
  title: string
  sourcePaths: string[]
  content: string
  score: number
}

const STANDARD_FOLDER_KINDS: Record<string, OutlineSegmentKind> = {
  大纲: "master",
  总大纲: "master",
  完整新书规划: "master",
  卷纲: "volume",
  章纲: "chapter",
  章节细纲: "chapter",
  章节规划表: "chapter-plan",
  章节计划表: "chapter-plan",
  人物小传: "character",
  设定: "setting",
  世界观: "setting",
  地点设定: "setting",
  势力设定: "setting",
  力量体系: "setting",
  金手指设定: "setting",
  背景设定: "setting",
  地理设定: "setting",
  组织: "setting",
  伏笔: "foreshadowing",
  伏笔表: "foreshadowing",
  伏笔计划: "foreshadowing",
  材料: "material",
}

const SOURCE_START = "<!-- qmai-outline-source:start -->"
const SOURCE_END = "<!-- qmai-outline-source:end -->"
const INDEX_READ_CONCURRENCY = 16
const MAX_OUTLINE_DOCUMENT_CHARS = 18_000
const MAX_CHAPTER_CONTEXT_CHARS = 14_000
const indexRequests = new Map<string, Promise<OutlineDocumentIndex>>()

function flattenMarkdownFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir) {
      if (node.children) files.push(...flattenMarkdownFiles(node.children))
      continue
    }
    if (node.name.toLowerCase().endsWith(".md")) files.push(node)
  }
  return files
}

function relativeOutlinePath(root: string, path: string): string {
  const normalizedRoot = normalizePath(root).replace(/\/$/, "")
  const normalizedPath = normalizePath(path)
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath.split("/").pop() ?? normalizedPath
}

function scalarText(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return ""
}

function kindFromFrontmatter(frontmatter: Record<string, unknown> | null): OutlineSegmentKind {
  if (!frontmatter) return "unknown"
  const type = scalarText(frontmatter.type).toLowerCase()
  const outlineType = scalarText(frontmatter.outline_type).toLowerCase()
  if (outlineType === "chapter-outline" || scalarText(frontmatter.chapter_number)) return "chapter"
  if (outlineType === "volume-outline" || type === "volume" || scalarText(frontmatter.volume_number)) return "volume"
  if (outlineType === "story-outline" || outlineType === "master-outline" || type === "overview") return "master"
  if (outlineType === "setting-outline" || type === "concept" || type === "setting") return "setting"
  if (type === "character") return "character"
  if (type === "foreshadowing") return "foreshadowing"
  if (type === "outline") return "master"
  return "unknown"
}

function kindFromHeading(title: string): OutlineSegmentKind | null {
  const compact = title.replace(/\s+/g, "")
  if (/^第(?:\d+|[一二三四五六七八九十百千万]+)章(?:章纲|细纲|[：:、\-—]|$)/i.test(compact) || /^chapter\d+\b/i.test(compact)) {
    return "chapter"
  }
  if (/章节规划表|章节计划表|章节节拍表|章序表|卷节拍表|章节列表|章节安排/.test(compact)) return "chapter-plan"
  if (/^第(?:\d+|[一二三四五六七八九十百千万]+)卷(?:[：:、\-—]|$)|卷纲|分卷大纲/.test(compact)) return "volume"
  if (/人物小传|人物设定|角色设定|主要人物|核心主角|核心配角|人物状态变化/.test(compact)) return "character"
  if (/伏笔表|伏笔计划|伏笔清单|伏笔设计/.test(compact)) return "foreshadowing"
  if (/世界观|背景设定|核心设定|规则设定|力量体系|能力体系|金手指|地理设定|地点设定|组织势力|势力设定/.test(compact)) return "setting"
  if (/完整新书规划|总纲|故事大纲|全书大纲|总体规划/.test(compact)) return "master"
  return null
}

function classifyDocument(relativePath: string, body: string, frontmatter: Record<string, unknown> | null): OutlineSegmentKind {
  const firstPart = relativePath.split("/").filter(Boolean)[0] ?? ""
  const folderKind = STANDARD_FOLDER_KINDS[firstPart]
  if (folderKind) return folderKind
  const fmKind = kindFromFrontmatter(frontmatter)
  const firstHeading = body.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? ""
  const headingKind = kindFromHeading(firstHeading)
  // 旧文件常把所有大纲统一写成 type:outline；此值不应盖过明确的卷/章/设定标题。
  if (fmKind !== "unknown" && fmKind !== "master") return fmKind
  return headingKind ?? fmKind
}

interface HeadingState {
  level: number
  kind: OutlineSegmentKind
  volumeScopeId?: string
}

function splitSemanticSegments(document: OutlineDocument): OutlineSegment[] {
  // 材料不按标题拆段。标题里的「第 N 章 / 世界观」不能把这篇改写成章纲或设定，否则会漏进稳定大纲。
  // 正文不在这里预选，只在材料目录里列出路径。
  if (document.kind === "material") {
    const content = document.content.trim()
    if (!content) return []
    return [{
      path: document.path,
      relativePath: document.relativePath,
      folder: document.folder,
      kind: "material",
      content,
      frontmatter: document.frontmatter,
    }]
  }

  const lines = document.content.split(/\r?\n/)
  const segments: OutlineSegment[] = []
  const stack: HeadingState[] = []
  let volumeCounter = 0
  let currentKind: OutlineSegmentKind = document.kind
  let currentVolumeScope = document.kind === "volume" ? `${document.path}#document` : undefined
  let currentLines: string[] = []

  const flush = () => {
    const content = currentLines.join("\n").trim()
    if (content) {
      segments.push({
        path: document.path,
        relativePath: document.relativePath,
        folder: document.folder,
        kind: currentKind,
        content,
        volumeScopeId: currentVolumeScope,
        frontmatter: document.frontmatter,
      })
    }
    currentLines = []
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (!heading) {
      currentLines.push(line)
      continue
    }

    const level = heading[1].length
    const explicitKind = kindFromHeading(heading[2])
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop()
    const parent = stack[stack.length - 1]
    const nextKind = explicitKind ?? parent?.kind ?? document.kind
    let nextVolumeScope = parent?.volumeScopeId ?? (document.kind === "volume" ? `${document.path}#document` : undefined)
    if (explicitKind === "volume") {
      volumeCounter += 1
      nextVolumeScope = `${document.path}#volume-${volumeCounter}`
    }

    // 每个标题独立成段，既能识别“完整新书规划”中的混合目标，也能按人物名精确取小传。
    if (currentLines.length > 0) flush()
    currentKind = nextKind
    currentVolumeScope = nextVolumeScope
    currentLines.push(line)
    stack.push({ level, kind: nextKind, volumeScopeId: nextVolumeScope })
  }
  flush()
  return segments
}

async function buildIndex(projectPath: string): Promise<OutlineDocumentIndex> {
  const pp = normalizePath(projectPath)
  const outlinesRoot = `${pp}/wiki/outlines`
  const tree = await listDirectory(outlinesRoot)
  const files = flattenMarkdownFiles(tree).sort((left, right) =>
    left.path.localeCompare(right.path, "zh-Hans-CN", { numeric: true }),
  )
  const loadedFiles = await mapWithConcurrency(files, INDEX_READ_CONCURRENCY, async (file) => ({
    path: file.path,
    content: await readFile(file.path).catch(() => ""),
  }))
  return createOutlineDocumentIndex(pp, loadedFiles)
}

function createOutlineDocumentIndex(
  projectPath: string,
  files: Array<{ path: string; content: string }>,
): OutlineDocumentIndex {
  const pp = normalizePath(projectPath)
  const outlinesRoot = `${pp}/wiki/outlines`
  const loadedDocuments = files.map((file) => {
    const raw = file.content
    if (!raw.trim()) return null
    const parsed = parseFrontmatter(raw)
    const relativePath = relativeOutlinePath(outlinesRoot, file.path)
    const folder = relativePath.includes("/") ? relativePath.split("/")[0] : undefined
    const content = parsed.body.trim()
    return {
      path: file.path,
      relativePath,
      folder,
      kind: classifyDocument(relativePath, content, parsed.frontmatter),
      content,
      frontmatter: parsed.frontmatter as Record<string, unknown> | null,
    } satisfies OutlineDocument
  })
  const documents: OutlineDocument[] = loadedDocuments.filter(
    (document): document is Exclude<typeof document, null> => document !== null,
  )

  return {
    projectPath: pp,
    documents,
    segments: documents.flatMap(splitSemanticSegments),
  }
}

export async function loadOutlineDocumentIndex(projectPath: string): Promise<OutlineDocumentIndex> {
  const key = normalizePath(projectPath)
  const pending = indexRequests.get(key)
  if (pending) return pending
  const request = buildIndex(key).finally(() => indexRequests.delete(key))
  indexRequests.set(key, request)
  return request
}

function numberToChinese(value: number): string {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"]
  if (value < 10) return digits[value] ?? String(value)
  if (value === 10) return "十"
  if (value < 20) return `十${digits[value - 10]}`
  if (value < 100) return `${digits[Math.floor(value / 10)]}十${value % 10 ? digits[value % 10] : ""}`
  if (value < 1000) {
    const hundreds = Math.floor(value / 100)
    const rest = value % 100
    if (rest === 0) return `${digits[hundreds]}百`
    return `${digits[hundreds]}百${rest < 10 ? "零" : ""}${numberToChinese(rest)}`
  }
  return String(value)
}

function chapterLabels(chapterNumber: number): string[] {
  return [`第${chapterNumber}章`, `第${numberToChinese(chapterNumber)}章`, `Chapter ${chapterNumber}`, `chapter ${chapterNumber}`]
}

function exactChapterHeading(content: string, chapterNumber: number): boolean {
  const labels = chapterLabels(chapterNumber).map((label) => label.replace(/\s+/g, "").toLowerCase())
  return content.split(/\r?\n/).some((line) => {
    const heading = line.match(/^#{1,6}\s*(.+)$/)?.[1]?.replace(/\s+/g, "").toLowerCase()
    if (!heading) return false
    // 章纲 MD 的章标题可能写作「## 第5章 无我」/「## 第5章：无我」，
    // 因此只要求「第N章」后面不是数字即可（(?!\d) 防止 第23章 命中 第230章）。
    const arabic = heading.match(/^第0*(\d+)章(?!\d)/)
    if (arabic && Number(arabic[1]) === chapterNumber) return true
    return labels.some((label) =>
      heading === label || heading === `${label}章纲` || heading === `${label}细纲` ||
      heading.startsWith(`${label}：`) || heading.startsWith(`${label}:`) || heading.startsWith(`${label}-`) || heading.startsWith(`${label}—`),
    )
  })
}

/**
 * 正文里出现过的章号（只认标题行里的「第N章」）。
 *
 * 用途：判断一份多章章纲到底含不含某一章。返回空数组说明正文没有逐章标题，
 * 此时「切不出本章」是格式问题而不是缺内容，调用方应保留旧行为。
 */
function chapterHeadingNumbers(content: string): number[] {
  const numbers: number[] = []
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s*(.+)$/)?.[1]?.replace(/\s+/g, "")
    if (!heading) continue
    const match = heading.match(/第0*(\d+)章(?!\d)/)
    if (match) numbers.push(Number(match[1]))
  }
  return numbers
}

function pathMatchesChapter(path: string, chapterNumber: number): boolean {
  const compact = path.replace(/\s+/g, "")
  return new RegExp(`第0*${chapterNumber}章`).test(compact) ||
    compact.includes(`第${numberToChinese(chapterNumber)}章`) ||
    new RegExp(`(?:chapter|ch)[-_ ]*0*${chapterNumber}(?:\\D|$)`, "i").test(path)
}

interface ChapterRange {
  start: number
  end: number
}

const CHAPTER_RANGE_SEPARATORS = "[-—–－~～至到]"

/** 去掉「章纲 / 细纲」等前缀，得到以「第…章」开头的命名主体。 */
function chapterRangeSubject(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/^(?:章纲|细纲|章节细纲|章节大纲|chapter[-_ ]*outline)/i, "")
    .replace(/^[-—–－~～:：、_]+/, "")
}

function toChapterRange(match: RegExpMatchArray | null): ChapterRange | null {
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= start) return null
  return { start, end }
}

/**
 * 文件名形如「章纲-第01–12章.md」时，解析出覆盖的章号区间。
 * 要求区间出现在命名主体开头且以「章」收尾，避免「第001章-标题」这类单章命名被误判。
 */
function pathChapterRange(path: string): ChapterRange | null {
  const stem = (path.split("/").pop() ?? "").replace(/\.md$/i, "")
  const subject = chapterRangeSubject(stem)
  return toChapterRange(subject.match(new RegExp(`^第0*(\\d+)章?${CHAPTER_RANGE_SEPARATORS}第?0*(\\d+)章`)))
}

/** 标题形如「# 章纲-第01–12章：雨夜无我」时，解析出覆盖的章号区间。 */
function titleChapterRange(content: string): ChapterRange | null {
  const title = content.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? ""
  const subject = chapterRangeSubject(title)
  return toChapterRange(subject.match(new RegExp(`^第0*(\\d+)章?${CHAPTER_RANGE_SEPARATORS}第?0*(\\d+)章`)))
}

/** 一份章纲覆盖多章（如「第01–12章」）时返回其区间，单章命名返回 null。 */
function standaloneDocumentRange(document: OutlineDocument): ChapterRange | null {
  return pathChapterRange(document.relativePath) ?? titleChapterRange(document.content)
}

function rangeContainsChapter(range: ChapterRange | null, chapterNumber: number): boolean {
  if (!range) return false
  return chapterNumber >= range.start && chapterNumber <= range.end
}

function frontmatterChapterNumber(frontmatter: Record<string, unknown> | null): number | undefined {
  const value = Number(scalarText(frontmatter?.chapter_number))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function parseMarkdownTableRows(content: string): Array<{ headers: string[]; cells: string[]; raw: string }> {
  const rows: Array<{ headers: string[]; cells: string[]; raw: string }> = []
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length - 2; index += 1) {
    const headerLine = lines[index].trim()
    const divider = lines[index + 1].trim()
    if (!headerLine.includes("|") || !/^\|?\s*:?-{3,}/.test(divider)) continue
    const headers = headerLine.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim())
    let rowIndex = index + 2
    while (rowIndex < lines.length && lines[rowIndex].includes("|")) {
      const raw = lines[rowIndex].trim()
      const cells = raw.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim())
      if (cells.some(Boolean)) rows.push({ headers, cells, raw })
      rowIndex += 1
    }
    index = rowIndex - 1
  }
  return rows
}

function chapterCellMatches(cell: string, chapterNumber: number): boolean {
  const compact = cell.replace(/[*_`\s]/g, "")
  const single = compact.match(/^第?0*(\d+)章?$/)
  if (single && Number(single[1]) === chapterNumber) return true
  if (compact === `第${numberToChinese(chapterNumber)}章`) return true
  const range = compact.match(/^第?(\d+)章?[-—–~至](?:第)?(\d+)章?$/)
  if (!range) return false
  return chapterNumber >= Number(range[1]) && chapterNumber <= Number(range[2])
}

function chapterTableRows(content: string, chapterNumber: number): string[] {
  const chapterHeader = /章节|章号|实际章号|chapter/i
  return parseMarkdownTableRows(content)
    .filter((row) => row.headers.some((header) => chapterHeader.test(header)))
    .filter((row) => row.headers.some((header, index) => chapterHeader.test(header) && chapterCellMatches(row.cells[index] ?? "", chapterNumber)))
    .map((row) => row.raw)
}

function explicitChapterLines(content: string, chapterNumber: number): string[] {
  const exact = new RegExp(`^(?:[-*+]\\s+|\\d+[.)]\\s+)?(?:#{1,6}\\s*)?第\\s*0*${chapterNumber}\\s*章(?:[：:、\\s\\-—]|$)`, "i")
  return content.split(/\r?\n/).filter((line) => exact.test(line.trim()))
}

function bodyRangeContains(content: string, chapterNumber: number): boolean {
  const patterns = [
    /章节范围[^\d]{0,12}第?\s*(\d+)\s*章?\s*[-—–~至]\s*第?\s*(\d+)\s*章?/gi,
    /章号[^\d]{0,12}(\d+)\s*[-—–~至]\s*(\d+)/gi,
  ]
  return patterns.some((pattern) => {
    for (const match of content.matchAll(pattern)) {
      if (chapterNumber >= Number(match[1]) && chapterNumber <= Number(match[2])) return true
    }
    return false
  })
}

function frontmatterRangeContains(frontmatter: Record<string, unknown> | null, chapterNumber: number): boolean {
  const start = Number(scalarText(frontmatter?.chapter_range_start))
  const end = Number(scalarText(frontmatter?.chapter_range_end))
  return Number.isFinite(start) && Number.isFinite(end) && chapterNumber >= start && chapterNumber <= end
}

function volumeMatchScore(segments: OutlineSegment[], chapterNumber: number): number {
  const content = segments.map((segment) => segment.content).join("\n\n")
  if (chapterTableRows(content, chapterNumber).length > 0) return 100
  if (exactChapterHeading(content, chapterNumber) || explicitChapterLines(content, chapterNumber).length > 0) return 90
  if (segments.some((segment) => frontmatterRangeContains(segment.frontmatter, chapterNumber))) return 70
  if (bodyRangeContains(content, chapterNumber)) return 60
  return 0
}

function firstHeading(content: string): string {
  return content.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() ?? "卷纲"
}

function resolveTargetVolumes(index: OutlineDocumentIndex, chapterNumber: number): ResolvedVolume[] {
  const grouped = new Map<string, OutlineSegment[]>()
  for (const segment of index.segments) {
    if (!segment.volumeScopeId) continue
    const list = grouped.get(segment.volumeScopeId) ?? []
    list.push(segment)
    grouped.set(segment.volumeScopeId, list)
  }
  const candidates = Array.from(grouped.entries()).map(([scopeId, segments]) => {
    // 卷匹配和章纲兜底需要看到卷内的章节段；outline 主上下文会在 buildOutlineContext 中另行排除这些段。
    const content = segments.map((segment) => segment.content).join("\n\n")
    return {
      scopeId,
      title: firstHeading(content),
      sourcePaths: Array.from(new Set(segments.map((segment) => segment.relativePath))),
      content,
      score: volumeMatchScore(segments, chapterNumber),
    }
  }).filter((candidate) => candidate.score > 0)
  const bestScore = Math.max(0, ...candidates.map((candidate) => candidate.score))
  return candidates.filter((candidate) => candidate.score === bestScore)
}

function excerptHeadTail(content: string, maxChars: number): string {
  const trimmed = content.trim()
  if (trimmed.length <= maxChars) return trimmed
  const marker = "\n\n【本资料过长，中段已按上下文预算省略】\n\n"
  const room = Math.max(0, maxChars - marker.length)
  const headChars = Math.floor(room * 0.58)
  return `${trimmed.slice(0, headChars).trimEnd()}${marker}${trimmed.slice(-(room - headChars)).trimStart()}`
}

function sourceBlock(kind: OutlineSegmentKind, relativePath: string, content: string): string {
  return [
    SOURCE_START,
    `## 大纲来源：${relativePath}（${kind}）`,
    "",
    excerptHeadTail(content, MAX_OUTLINE_DOCUMENT_CHARS),
    SOURCE_END,
  ].join("\n")
}

function uniqueSourceBlocks(sources: Array<{ kind: OutlineSegmentKind; relativePath: string; content: string }>): string[] {
  const seen = new Set<string>()
  const blocks: string[] = []
  for (const source of sources) {
    const normalized = source.content.trim()
    if (!normalized) continue
    const key = `${source.kind}\u0000${source.relativePath}\u0000${normalized}`
    if (seen.has(key)) continue
    seen.add(key)
    blocks.push(sourceBlock(source.kind, source.relativePath, normalized))
  }
  return blocks
}

function groupSourcesByDocument(
  sources: Array<{ kind: OutlineSegmentKind; relativePath: string; content: string }>,
): Array<{ kind: OutlineSegmentKind; relativePath: string; content: string }> {
  const grouped = new Map<string, { kind: OutlineSegmentKind; relativePath: string; contents: string[] }>()
  for (const source of sources) {
    const key = `${source.kind}\u0000${source.relativePath}`
    const existing = grouped.get(key)
    if (existing) {
      existing.contents.push(source.content)
    } else {
      grouped.set(key, {
        kind: source.kind,
        relativePath: source.relativePath,
        contents: [source.content],
      })
    }
  }
  return Array.from(grouped.values()).map((source) => ({
    kind: source.kind,
    relativePath: source.relativePath,
    content: source.contents.map((content) => content.trim()).filter(Boolean).join("\n\n"),
  }))
}

/** 材料只列路径，不按文件名或章号预选正文。模型读过之后自己决定用不用。 */
function renderMaterialCatalog(index: OutlineDocumentIndex): string {
  const paths = index.documents
    .filter((document) => document.kind === "material")
    .map((document) => document.relativePath)
    .sort((left, right) => left.localeCompare(right, "zh-Hans-CN", { numeric: true }))
  if (paths.length === 0) return ""
  return [
    "材料目录（只列路径，不含正文）。与大纲列表相同：先看清单，读过正文后再判断本章要不要用。不要按文件名或章号机械选定。",
    ...paths.map((path) => `- ${path}`),
  ].join("\n")
}

export interface OutlineContextLayers {
  full: string
  project: string
  task: string
  /** 材料路径清单。不含正文，不进入 project / full。 */
  materials: string
}

export function buildOutlineContextLayers(index: OutlineDocumentIndex, chapterNumber?: number): OutlineContextLayers {
  const master = index.segments.filter((segment) => segment.kind === "master")
  const settings = index.segments.filter((segment) => segment.kind === "setting")
  let volumes: OutlineSegment[] = []
  let chapterPlans: OutlineSegment[] = []
  if (chapterNumber) {
    const scopeIds = new Set(resolveTargetVolumes(index, chapterNumber).map((volume) => volume.scopeId))
    volumes = index.segments.filter((segment) => segment.volumeScopeId && scopeIds.has(segment.volumeScopeId) && segment.kind === "volume")
    chapterPlans = index.segments.filter((segment) =>
      segment.kind === "chapter-plan" && (!segment.volumeScopeId || scopeIds.has(segment.volumeScopeId)),
    )
  } else {
    volumes = index.segments.filter((segment) => segment.kind === "volume")
    chapterPlans = index.segments.filter((segment) => segment.kind === "chapter-plan")
  }
  const render = (segments: OutlineSegment[]) => uniqueSourceBlocks(groupSourcesByDocument(segments)).join("\n\n")
  return {
    full: render([...master, ...volumes, ...chapterPlans, ...settings]),
    project: render([...master, ...settings]),
    task: render([...volumes, ...chapterPlans]),
    materials: renderMaterialCatalog(index),
  }
}

export function buildOutlineContext(index: OutlineDocumentIndex, chapterNumber?: number): string {
  return buildOutlineContextLayers(index, chapterNumber).full
}

function extractHeadingSection(content: string, chapterNumber: number): string {
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+(.+)$/)
    if (!heading || !exactChapterHeading(lines[index], chapterNumber)) continue
    const level = heading[1].length
    let end = index + 1
    while (end < lines.length) {
      const next = lines[end].match(/^(#{1,6})\s+/)
      if (next && next[1].length <= level) break
      end += 1
    }
    return lines.slice(index, end).join("\n").trim()
  }
  return ""
}

function stableIdentifiers(lines: string[]): string[] {
  const ids = new Set<string>()
  for (const line of lines) {
    for (const match of line.matchAll(/\b[A-Z][A-Z0-9]*-\d{2,}\b/g)) ids.add(match[0])
  }
  return Array.from(ids)
}

function extractIdentifierSections(content: string, identifiers: string[]): string[] {
  if (identifiers.length === 0) return []
  const lines = content.split(/\r?\n/)
  const sections: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+(.+)$/)
    if (!heading || !identifiers.some((identifier) => heading[2].includes(identifier))) continue
    const level = heading[1].length
    let end = index + 1
    while (end < lines.length) {
      const next = lines[end].match(/^(#{1,6})\s+/)
      if (next && next[1].length <= level) break
      end += 1
    }
    sections.push(lines.slice(index, end).join("\n").trim())
    index = end - 1
  }
  return sections
}

/**
 * 卷纲里没有任何「第 N 章」字样时，退到「故事」粒度兜底。
 *
 * 🔴 为什么必须要有这一层：结构化-only 之后的卷纲由 `renderVolumeOutlineMarkdown`
 * 生成，一个章号都不出现（只有「## 故事N：标题 / 章号范围 / 环节」）。旧格式靠
 * 模型自己写的 `章序表` 或 `第N章` 行兜底，新格式这两样都没有 —— 缺了这层，
 * 用户「只生成了卷纲、还没生成章纲」就开写正文时，`resolveChapterOutline` 会
 * 返回 `sourceKind: "none"` + 空串，写作上下文里连一份大纲都拿不到。
 *
 * 取「包含本章号范围的最小那一节」：H1 通常是整卷（也包含本章号），按长度升序
 * 挑最短的，才能落到 `## 故事N` 这一节而不是整卷。
 */
function extractStorySection(content: string, chapterNumber: number): string {
  const lines = content.split(/\r?\n/)
  const candidates: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+(.+)$/)
    if (!heading) continue
    const level = heading[1].length
    let end = index + 1
    while (end < lines.length) {
      const next = lines[end].match(/^(#{1,6})\s+/)
      if (next && next[1].length <= level) break
      end += 1
    }
    const section = lines.slice(index, end).join("\n").trim()
    if (section && bodyRangeContains(section, chapterNumber)) candidates.push(section)
    /*
     * 这里**不能** `index = end - 1` 跳过整节：H1 是整卷、也包含全部章号范围，
     * 跳过去就再也看不到里面更精确的 `## 故事N` 了（实测会退回整卷全文）。
     * 每个标题各自独立成候选，最后按长度挑最短的那个。
     */
  }
  if (candidates.length === 0) return ""
  return candidates.sort((left, right) => left.length - right.length)[0]
}

function extractStructuredChapterContent(content: string, chapterNumber: number): string {
  const headingSection = extractHeadingSection(content, chapterNumber)
  const rows = chapterTableRows(content, chapterNumber)
  /*
   * 章标题那一行会同时被 `extractHeadingSection`（整节）和 `explicitChapterLines`
   * （单行）抓到，`new Set` 按整串去重挡不住 —— 落进写作上下文的摘录里会出现
   * 同一行「## 第 13 章 断线」两遍（一次在节首、一次在末尾）。按「行」去重。
   */
  const headingLines = new Set(headingSection.split(/\r?\n/).map((line) => line.trim()))
  const lines = explicitChapterLines(content, chapterNumber).filter((line) => !headingLines.has(line.trim()))
  const base = [headingSection, ...rows, ...lines].filter(Boolean)
  const ids = stableIdentifiers(base)
  const identifierSections = extractIdentifierSections(content, ids)
  const relatedLines = ids.length > 0
    ? content.split(/\r?\n/).filter((line) => ids.some((id) => line.includes(id)))
    : []
  const structured = Array.from(new Set([...base, ...identifierSections, ...relatedLines])).join("\n\n").trim()
  // 逐章信息缺失（新格式卷纲）时退到所属故事的环节，别让写作上下文空手而归。
  return structured || extractStorySection(content, chapterNumber)
}

function standaloneChapterMatches(document: OutlineDocument, chapterNumber: number): boolean {
  const titleLine = document.content.match(/^#{1,6}\s+.+$/m)?.[0] ?? ""
  return frontmatterChapterNumber(document.frontmatter) === chapterNumber ||
    pathMatchesChapter(document.relativePath, chapterNumber) ||
    exactChapterHeading(titleLine, chapterNumber) ||
    rangeContainsChapter(standaloneDocumentRange(document), chapterNumber)
}

export function resolveChapterOutline(index: OutlineDocumentIndex, chapterNumber: number): ChapterOutlineResolution {
  const standaloneDocs = index.documents.filter((document) =>
    document.kind === "chapter" && standaloneChapterMatches(document, chapterNumber),
  )
  for (const standalone of standaloneDocs) {
    // 一份章纲覆盖多章（如「章纲-第01–12章」）时，只取本章那一节；单章文件仍返回整份内容。
    const range = standaloneDocumentRange(standalone)
    const scoped = range ? extractStructuredChapterContent(standalone.content, chapterNumber) : ""
    const headings = range ? chapterHeadingNumbers(standalone.content) : []
    /*
     * 文件名覆盖本章、正文里却没有本章 —— 不能拿整份顶替。
     *
     * 真实场景：模型被要求写 1–12 章的章纲，只写完了第 1 章就产出
     * `chapterOutlineData`，而保存请求的文件名是按故事区间生成的
     * 「章纲-第01–12章.md」。于是写第 5 章时 `standaloneChapterMatches` 命中这个文件，
     * 切片拿不到内容，旧实现退回整份 ⇒ 写作上下文里塞进的是**第 1 章**的 17 节。
     * 模型会照着第一章的节拍、事件、钩子去写第五章，而且不报任何错。
     *
     * 判据：正文里存在明确的「第N章」标题、且没有任何一个等于本章号 ⇒ 这份文件
     * 确实不含本章，跳到下一份候选（最终落到卷纲兜底）。
     * 正文里根本没有逐章标题时才退回整份 —— 那是格式不认识导致切不出来，
     * 旧行为必须保留，否则非标准章纲会一律读不到。
     */
    if (range && !scoped.trim() && headings.length > 0) continue
    return {
      content: excerptHeadTail(scoped.trim() ? scoped : standalone.content, MAX_CHAPTER_CONTEXT_CHARS),
      sourceKind: "standalone",
      sourcePaths: [standalone.relativePath],
    }
  }

  const volumes = resolveTargetVolumes(index, chapterNumber)
  const volumeExtracts = volumes.map((volume) => extractStructuredChapterContent(volume.content, chapterNumber)).filter(Boolean)
  if (volumeExtracts.length > 0) {
    const sourcePaths = Array.from(new Set(volumes.flatMap((volume) => volume.sourcePaths)))
    return {
      content: [
        `【章纲来源：卷纲兜底】未找到第${chapterNumber}章独立章纲，以下内容从目标卷纲摘录：章号精确命中时给本章那一节，只有故事粒度的卷纲则给本章所属故事的环节。`,
        ...volumeExtracts,
      ].join("\n\n").slice(0, MAX_CHAPTER_CONTEXT_CHARS),
      sourceKind: "volume",
      sourcePaths,
    }
  }

  for (const kind of ["chapter-plan", "master"] as const) {
    const matches = index.segments
      .filter((segment) => segment.kind === kind)
      .map((segment) => ({ segment, content: extractStructuredChapterContent(segment.content, chapterNumber) }))
      .filter((item) => item.content)
    if (matches.length > 0) {
      return {
        content: [
          `【章纲来源：${kind === "chapter-plan" ? "章节规划表" : "总纲"}兜底】未找到第${chapterNumber}章独立章纲，以下为结构化目标摘录。`,
          ...matches.map((item) => item.content),
        ].join("\n\n").slice(0, MAX_CHAPTER_CONTEXT_CHARS),
        sourceKind: kind,
        sourcePaths: Array.from(new Set(matches.map((item) => item.segment.relativePath))),
      }
    }
  }
  return { content: "", sourceKind: "none", sourcePaths: [] }
}

export function buildVolumeContext(index: OutlineDocumentIndex, chapterNumber: number): string {
  return resolveTargetVolumes(index, chapterNumber).map((volume) => {
    // 逐章表格是旧格式卷纲才有的；新格式只有故事粒度，同样要给出所属故事的环节，
    // 否则这里只剩「所属卷纲 / 来源」两行标题、正文全空。
    const rows = chapterTableRows(volume.content, chapterNumber)
    return [
      `所属卷纲：${volume.title}`,
      `来源：${volume.sourcePaths.join("、")}`,
      ...(rows.length > 0 ? rows : [extractStorySection(volume.content, chapterNumber)].filter(Boolean)),
    ].filter(Boolean).join("\n")
  }).join("\n\n")
}

function parseMarkedSourceBlocks(outline: string): string[] {
  const escapedStart = SOURCE_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const escapedEnd = SOURCE_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, "g")
  return Array.from(outline.matchAll(regex), (match) => `${SOURCE_START}${match[1]}${SOURCE_END}`.trim())
}

export function capOutlineSourcesToBudget(outline: string, charCap: number): string {
  const trimmed = outline.trim()
  if (charCap <= 0 || trimmed.length <= charCap) return trimmed
  const blocks = parseMarkedSourceBlocks(trimmed)
  if (blocks.length === 0) return excerptHeadTail(trimmed, charCap)

  const kept = new Array<string>(blocks.length)
  const pending = new Set(blocks.map((_, index) => index))
  let remaining = charCap - Math.max(0, blocks.length - 1) * 2
  while (pending.size > 0 && remaining > 0) {
    const share = Math.floor(remaining / pending.size)
    let consumedSmallBlock = false
    for (const index of Array.from(pending)) {
      if (blocks[index].length <= share) {
        kept[index] = blocks[index]
        remaining -= blocks[index].length
        pending.delete(index)
        consumedSmallBlock = true
      }
    }
    if (!consumedSmallBlock) {
      for (const index of pending) kept[index] = excerptHeadTail(blocks[index], share)
      remaining = 0
    }
  }
  return kept.filter(Boolean).join("\n\n").slice(0, charCap)
}

function characterAliases(segment: OutlineSegment): string[] {
  const aliases = new Set<string>()
  const stem = segment.relativePath.split("/").pop()?.replace(/\.md$/i, "").replace(/^(?:角色|人物小传)[-_：:]*/, "").trim()
  if (stem) aliases.add(stem)
  const title = scalarText(segment.frontmatter?.title)
  const name = scalarText(segment.frontmatter?.name)
  if (title) aliases.add(title.replace(/^(?:角色|人物小传)[-_：:]*/, "").trim())
  if (name) aliases.add(name)
  const heading = firstHeading(segment.content).replace(/^(?:人物小传|人物设定|角色设定)[-_：:]*/, "").trim()
  if (heading && heading.length <= 24) aliases.add(heading)
  return Array.from(aliases).filter((alias) => alias.length >= 2)
}

export function buildRelevantCharacterBriefs(index: OutlineDocumentIndex, matchingText: string): string {
  const matches = index.segments.filter((segment) =>
    segment.kind === "character" && characterAliases(segment).some((alias) => matchingText.includes(alias)),
  )
  return uniqueSourceBlocks(groupSourcesByDocument(matches)).join("\n\n")
}

export function buildRelevantForeshadowing(index: OutlineDocumentIndex, chapterNumber: number, matchingText: string): string {
  const hintMatches = Array.from(matchingText.matchAll(/(?:伏笔|铺垫|悬念)[：:]\s*([^\n]+)/gi), (match) => match[1].trim()).filter(Boolean)
  const results: Array<{ kind: OutlineSegmentKind; relativePath: string; content: string }> = []
  for (const segment of index.segments.filter((item) => item.kind === "foreshadowing")) {
    const rows = parseMarkdownTableRows(segment.content).filter((row) => {
      const chapterColumnsMatch = row.headers.some((header, index) =>
        /章节|埋设|推进|回收|resolve|chapter/i.test(header) && chapterCellMatches(row.cells[index] ?? "", chapterNumber),
      )
      const hintMatch = hintMatches.some((hint) => row.raw.includes(hint))
      return chapterColumnsMatch || hintMatch
    }).map((row) => row.raw)
    const lines = segment.content.split(/\r?\n/).filter((line) =>
      (/伏笔|埋设|推进|回收/.test(line) && line.replace(/\s+/g, "").includes(`第${chapterNumber}章`)) ||
      hintMatches.some((hint) => line.includes(hint)),
    )
    const content = Array.from(new Set([...rows, ...lines])).join("\n")
    if (content.trim()) results.push({ kind: "foreshadowing", relativePath: segment.relativePath, content })
  }
  return uniqueSourceBlocks(results).join("\n\n")
}
