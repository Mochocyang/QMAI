import { listDirectory, readFile } from "@/commands/fs"
import { mapWithConcurrency } from "@/lib/async-pool"
import { parseFrontmatter } from "@/lib/frontmatter"
import { normalizePath } from "@/lib/path-utils"
import type { FileNode } from "@/types/wiki"

export type OutlineSegmentKind =
  | "master"
  | "volume"
  | "chapter-plan"
  | "chapter"
  | "character"
  | "setting"
  | "foreshadowing"
  | "unknown"

export interface OutlineDocument {
  path: string
  relativePath: string
  folder?: string
  kind: OutlineSegmentKind
  content: string
  frontmatter: Record<string, unknown> | null
}

export interface OutlineSegment {
  path: string
  relativePath: string
  folder?: string
  kind: OutlineSegmentKind
  content: string
  volumeScopeId?: string
  frontmatter: Record<string, unknown> | null
}

export interface OutlineDocumentIndex {
  projectPath: string
  documents: OutlineDocument[]
  segments: OutlineSegment[]
}

export interface ChapterOutlineResolution {
  content: string
  sourceKind: "standalone" | "volume" | "chapter-plan" | "master" | "none"
  sourcePaths: string[]
}

export interface ResolvedVolume {
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
  const lines = document.content.split(/\r?\n/)
  const segments: OutlineSegment[] = []
  const stack: HeadingState[] = []
  let volumeCounter = 0
  let currentKind = document.kind
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

export function createOutlineDocumentIndex(
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
    const arabic = heading.match(/^第0*(\d+)章(?:章纲|细纲|[：:、\-—]|$)/)
    if (arabic && Number(arabic[1]) === chapterNumber) return true
    return labels.some((label) =>
      heading === label || heading === `${label}章纲` || heading === `${label}细纲` ||
      heading.startsWith(`${label}：`) || heading.startsWith(`${label}:`) || heading.startsWith(`${label}-`) || heading.startsWith(`${label}—`),
    )
  })
}

function pathMatchesChapter(path: string, chapterNumber: number): boolean {
  const compact = path.replace(/\s+/g, "")
  return new RegExp(`第0*${chapterNumber}章`).test(compact) ||
    compact.includes(`第${numberToChinese(chapterNumber)}章`) ||
    new RegExp(`(?:chapter|ch)[-_ ]*0*${chapterNumber}(?:\\D|$)`, "i").test(path)
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

export function resolveTargetVolumes(index: OutlineDocumentIndex, chapterNumber: number): ResolvedVolume[] {
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

export function buildOutlineContext(index: OutlineDocumentIndex, chapterNumber?: number): string {
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
  return uniqueSourceBlocks(groupSourcesByDocument([...master, ...volumes, ...chapterPlans, ...settings])).join("\n\n")
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

function extractStructuredChapterContent(content: string, chapterNumber: number): string {
  const headingSection = extractHeadingSection(content, chapterNumber)
  const rows = chapterTableRows(content, chapterNumber)
  const lines = explicitChapterLines(content, chapterNumber)
  const base = [headingSection, ...rows, ...lines].filter(Boolean)
  const ids = stableIdentifiers(base)
  const identifierSections = extractIdentifierSections(content, ids)
  const relatedLines = ids.length > 0
    ? content.split(/\r?\n/).filter((line) => ids.some((id) => line.includes(id)))
    : []
  return Array.from(new Set([...base, ...identifierSections, ...relatedLines])).join("\n\n").trim()
}

function standaloneChapterMatches(document: OutlineDocument, chapterNumber: number): boolean {
  const titleLine = document.content.match(/^#{1,6}\s+.+$/m)?.[0] ?? ""
  return frontmatterChapterNumber(document.frontmatter) === chapterNumber ||
    pathMatchesChapter(document.relativePath, chapterNumber) ||
    exactChapterHeading(titleLine, chapterNumber)
}

export function resolveChapterOutline(index: OutlineDocumentIndex, chapterNumber: number): ChapterOutlineResolution {
  const standalone = index.documents.find((document) =>
    document.kind === "chapter" && standaloneChapterMatches(document, chapterNumber),
  )
  if (standalone) {
    return {
      content: excerptHeadTail(standalone.content, MAX_CHAPTER_CONTEXT_CHARS),
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
        `【章纲来源：卷纲兜底】未找到第${chapterNumber}章独立章纲，以下内容从目标卷纲按章节结构精确摘录。`,
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
  return resolveTargetVolumes(index, chapterNumber).map((volume) => [
    `所属卷纲：${volume.title}`,
    `来源：${volume.sourcePaths.join("、")}`,
    ...chapterTableRows(volume.content, chapterNumber),
  ].filter(Boolean).join("\n")).join("\n\n")
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
