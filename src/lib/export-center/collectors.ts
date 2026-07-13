import { listDirectory, readFile } from "@/commands/fs"
import { parseFrontmatter } from "@/lib/frontmatter"
import type { FileNode, WikiProject } from "@/types/wiki"
import type { ExportDocument, ExportDocumentBlock, ExportSource } from "./types"

export interface CollectorFileApi {
  listDirectory(path: string): Promise<FileNode[]>
  readFile(path: string): Promise<string>
}

const defaultFileApi: CollectorFileApi = { listDirectory, readFile }
const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" })
export const EXPORT_SOURCES: ExportSource[] = [
  "chapters",
  "outlines",
  "book-analysis",
  "story-simulation",
  "soul-works",
]

function joinPath(...parts: string[]): string {
  return parts.map((part, index) => index === 0 ? part.replace(/[\\/]+$/g, "") : part.replace(/^[\\/]+|[\\/]+$/g, "")).join("/")
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/i, "") || "未命名内容"
}

function parseChineseOrderNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10)
  const digits: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  }
  const tenIndex = value.indexOf("十")
  if (tenIndex >= 0) {
    const left = value.slice(0, tenIndex)
    const right = value.slice(tenIndex + 1)
    return (left ? digits[left] ?? 0 : 1) * 10 + (right ? digits[right] ?? 0 : 0)
  }
  let result = 0
  for (const character of value) {
    if (digits[character] === undefined) return null
    result = result * 10 + digits[character]
  }
  return result || null
}

function extractPageOrderFromTitle(title: string): number | null {
  const structured = title.match(/第\s*([0-9零一二两三四五六七八九十]+)\s*[章节卷]/)
  if (structured?.[1]) return parseChineseOrderNumber(structured[1])
  const numeric = title.match(/(\d+)/)
  return numeric?.[1] ? Number.parseInt(numeric[1], 10) : null
}

function readFrontmatterChapterNumber(content: string): number | null {
  const raw = parseFrontmatter(content).frontmatter?.chapter_number
  const number = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN
  return Number.isFinite(number) && number > 0 ? number : null
}

function contentBlock(content: string, fallbackTitle: string): ExportDocumentBlock {
  const parsed = parseFrontmatter(content)
  const normalized = parsed.body.replace(/\r\n/g, "\n").trim()
  const lines = normalized.split("\n")
  const headingIndex = lines.findIndex((line) => /^#\s+/.test(line))
  const headingTitle = headingIndex >= 0
    ? lines[headingIndex].replace(/^#\s+/, "").trim()
    : ""
  const frontmatterTitle = typeof parsed.frontmatter?.title === "string"
    ? parsed.frontmatter.title.trim()
    : ""
  const title = frontmatterTitle || headingTitle || fallbackTitle
  if (headingIndex >= 0) lines.splice(headingIndex, 1)
  const paragraphs = lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  return { title, paragraphs }
}

function flattenMarkdownFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir) {
      if (node.children) files.push(...flattenMarkdownFiles(node.children))
    } else if (node.name.toLowerCase().endsWith(".md")) {
      files.push(node)
    }
  }
  return files.sort((a, b) => collator.compare(a.name, b.name))
}

interface CollectedMarkdown {
  block: ExportDocumentBlock
  fileName: string
  order: number | null
}

function displayTitleFromFileName(fileName: string): string {
  return baseName(fileName).replace(/-/g, " ")
}

function sortCollectedMarkdown(items: CollectedMarkdown[]): CollectedMarkdown[] {
  return items.sort((left, right) => {
    if (left.order !== null && right.order !== null && left.order !== right.order) {
      return left.order - right.order
    }
    if (left.order !== null && right.order === null) return -1
    if (left.order === null && right.order !== null) return 1
    return collator.compare(left.block.title, right.block.title)
      || collator.compare(left.fileName, right.fileName)
  })
}

async function collectMarkdownTree(
  nodes: FileNode[],
  source: "chapters" | "outlines",
  api: CollectorFileApi,
): Promise<CollectedMarkdown[]> {
  const directories = nodes
    .filter((node) => node.is_dir)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
  const result: CollectedMarkdown[] = []

  // KnowledgeTree 同级顺序：目录始终排在文件之前，并递归输出目录内容。
  for (const directory of directories) {
    result.push(...await collectMarkdownTree(directory.children ?? [], source, api))
  }

  const siblingFiles: CollectedMarkdown[] = []
  for (const file of nodes.filter((node) => !node.is_dir && node.name.toLowerCase().endsWith(".md"))) {
    try {
      const content = await api.readFile(file.path)
      const fallbackTitle = displayTitleFromFileName(file.name)
      const block = contentBlock(content, fallbackTitle)
      siblingFiles.push({
        block,
        fileName: file.name,
        order: source === "chapters"
          ? (readFrontmatterChapterNumber(content)
            ?? extractPageOrderFromTitle(block.title)
            ?? extractPageOrderFromTitle(fallbackTitle))
          : (extractPageOrderFromTitle(block.title)
            ?? extractPageOrderFromTitle(fallbackTitle)),
      })
    } catch {
      // 单个文件不可读时跳过，其余内容仍可导出。
    }
  }
  result.push(...sortCollectedMarkdown(siblingFiles))
  return result
}

async function collectMarkdownDirectory(
  project: WikiProject,
  source: "chapters" | "outlines",
  directory: string,
  api: CollectorFileApi,
): Promise<ExportDocument[]> {
  let nodes: FileNode[]
  try {
    nodes = await api.listDirectory(directory)
  } catch {
    return []
  }
  const collected = await collectMarkdownTree(nodes, source, api)
  const blocks = collected.map((item) => item.block)
  if (blocks.length === 0) return []
  return [{
    title: `${project.name}-${source === "chapters" ? "章节" : "大纲"}`,
    source,
    blocks,
  }]
}
interface BookLibraryEntry {
  bookId: string
  title: string
  sourcePath: string
}

async function collectBookAnalysis(project: WikiProject, api: CollectorFileApi): Promise<ExportDocument[]> {
  let entries: BookLibraryEntry[]
  try {
    const parsed = JSON.parse(await api.readFile(joinPath(project.path, "book-analysis/library.json"))) as { entries?: BookLibraryEntry[] }
    entries = Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }

  const documents: ExportDocument[] = []
  for (const entry of entries) {
    let blocks: ExportDocumentBlock[] = []
    try {
      blocks = [contentBlock(await api.readFile(entry.sourcePath), "正文")]
    } catch {
      try {
        const chapterDir = joinPath(project.path, "book-analysis", entry.bookId, "chapters")
        const chapterFiles = flattenMarkdownFiles(await api.listDirectory(chapterDir))
        for (const file of chapterFiles) {
          try {
            blocks.push(contentBlock(await api.readFile(file.path), baseName(file.name)))
          } catch {
            // 单个拆书章节损坏时保留其他可读章节。
          }
        }
      } catch {
        blocks = []
      }
    }
    if (blocks.length > 0) {
      documents.push({ title: entry.title || entry.bookId, source: "book-analysis", blocks })
    }
  }
  return documents.sort((a, b) => collator.compare(a.title, b.title))
}

function flattenResultFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir) {
      if (node.children) files.push(...flattenResultFiles(node.children))
    } else if (/\.(?:json|md)$/i.test(node.name)) {
      files.push(node)
    }
  }
  return files.sort((a, b) => collator.compare(a.name, b.name))
}

function simulationResultBlock(content: string, fallbackTitle: string): {
  block: ExportDocumentBlock
  createdAt: string
} {
  const parsed = JSON.parse(content) as {
    report?: {
      recommendation?: string
      createdAt?: string
      branches?: unknown[]
      characterAnalyses?: unknown[]
    }
    draft?: { chapters?: Array<{ title?: string; content?: string }> } | null
    timelineEvents?: unknown[]
    rumors?: unknown[]
  }
  const paragraphs: string[] = []
  if (parsed.report?.recommendation) paragraphs.push(`推荐：${parsed.report.recommendation}`)
  for (const branch of parsed.report?.branches ?? []) {
    paragraphs.push(`剧情分支：\n${JSON.stringify(branch, null, 2)}`)
  }
  for (const analysis of parsed.report?.characterAnalyses ?? []) {
    paragraphs.push(`角色分析：\n${JSON.stringify(analysis, null, 2)}`)
  }
  for (const chapter of parsed.draft?.chapters ?? []) {
    paragraphs.push(`${chapter.title?.trim() || "未命名章节"}\n${chapter.content?.trim() || ""}`.trim())
  }
  if (parsed.timelineEvents?.length) paragraphs.push(`时间线：\n${JSON.stringify(parsed.timelineEvents, null, 2)}`)
  if (parsed.rumors?.length) paragraphs.push(`传闻：\n${JSON.stringify(parsed.rumors, null, 2)}`)
  return {
    block: { title: fallbackTitle, paragraphs },
    createdAt: typeof parsed.report?.createdAt === "string" ? parsed.report.createdAt : "",
  }
}

async function collectStorySimulation(project: WikiProject, api: CollectorFileApi): Promise<ExportDocument[]> {
  const frameworksDir = joinPath(project.path, ".qmai/simulations/frameworks")
  let frameworks: FileNode[]
  try {
    frameworks = flattenMarkdownFiles(await api.listDirectory(frameworksDir))
  } catch {
    return []
  }

  const documents: ExportDocument[] = []
  for (const framework of frameworks) {
    let frameworkBlock: ExportDocumentBlock
    try {
      frameworkBlock = contentBlock(await api.readFile(framework.path), baseName(framework.name))
    } catch {
      continue
    }
    const frameworkId = baseName(framework.name)
    const blocks = [frameworkBlock]
    try {
      const resultFiles = flattenResultFiles(
        await api.listDirectory(joinPath(project.path, ".qmai/simulations/results", frameworkId)),
      )
      const structuredIds = new Set(
        resultFiles.filter((file) => file.name.toLowerCase().endsWith(".json")).map((file) => baseName(file.name)),
      )
      const preferredFiles = resultFiles.filter(
        (file) => file.name.toLowerCase().endsWith(".json") || !structuredIds.has(baseName(file.name)),
      )
      const collectedResults: Array<{
        block: ExportDocumentBlock
        createdAt: string
        fileName: string
      }> = []
      for (const result of preferredFiles) {
        try {
          const raw = await api.readFile(result.path)
          if (result.name.toLowerCase().endsWith(".json")) {
            const parsed = simulationResultBlock(raw, baseName(result.name).replace(/^result-/i, "推演结果"))
            collectedResults.push({ ...parsed, fileName: result.name })
          } else {
            const createdAt = raw.match(/^-\s*生成时间：\s*(.+)$/m)?.[1]?.trim() ?? ""
            collectedResults.push({
              block: contentBlock(raw, baseName(result.name)),
              createdAt,
              fileName: result.name,
            })
          }
        } catch {
          // 跳过损坏的单个推演结果。
        }
      }
      collectedResults.sort((left, right) => {
        if (left.createdAt && right.createdAt && left.createdAt !== right.createdAt) {
          return left.createdAt < right.createdAt ? 1 : -1
        }
        if (left.createdAt && !right.createdAt) return -1
        if (!left.createdAt && right.createdAt) return 1
        return collator.compare(left.fileName, right.fileName)
      })
      blocks.push(...collectedResults.map((result) => result.block))
    } catch {
      // 没有推演结果时仍导出框架。
    }
    documents.push({ title: frameworkBlock.title, source: "story-simulation", blocks })
  }
  return documents.sort((a, b) => collator.compare(a.title, b.title))
}

interface SoulWork {
  name?: string
  sourceNote?: string
  corpus?: string
  styleDescription?: string
  behaviorRules?: string
  boundaries?: string
  notes?: string
  expressionDna?: string
  mentalModel?: string
  decisionHeuristics?: string
  valueAntiPatterns?: string
  honestyBoundaries?: string
  sourceUrls?: string
  localDocumentPaths?: string
  generationPrompt?: string
}

async function collectSoulWorks(project: WikiProject, api: CollectorFileApi): Promise<ExportDocument[]> {
  let works: SoulWork[]
  try {
    const parsed = JSON.parse(await api.readFile(joinPath(project.path, ".qmai/character-aura.json"))) as { customAuras?: SoulWork[] }
    works = Array.isArray(parsed.customAuras)
      ? parsed.customAuras.filter((work): work is SoulWork => typeof work === "object" && work !== null && !Array.isArray(work))
      : []
  } catch {
    return []
  }
  const fieldLabels: Array<[keyof SoulWork, string]> = [
    ["sourceNote", "来源说明"],
    ["corpus", "语料"],
    ["styleDescription", "风格描述"],
    ["behaviorRules", "行为规则"],
    ["boundaries", "边界"],
    ["notes", "备注"],
    ["expressionDna", "表达 DNA"],
    ["mentalModel", "心智模型"],
    ["decisionHeuristics", "决策启发"],
    ["valueAntiPatterns", "价值反模式"],
    ["honestyBoundaries", "诚实边界"],
    ["sourceUrls", "来源链接"],
    ["localDocumentPaths", "本地资料"],
    ["generationPrompt", "生成提示词"],
  ]
  return works.map((work, index) => ({
    title: work.name?.trim() || `未命名灵魂作品${index + 1}`,
    source: "soul-works" as const,
    blocks: fieldLabels
      .filter(([key]) => typeof work[key] === "string" && work[key]?.trim())
      .map(([key, title]) => ({ title, paragraphs: [String(work[key]).trim()] })),
  })).filter((document) => document.blocks.length > 0)
    .sort((a, b) => collator.compare(a.title, b.title))
}

export async function collectSourceDocuments(
  project: WikiProject,
  source: ExportSource,
  api: CollectorFileApi = defaultFileApi,
): Promise<ExportDocument[]> {
  switch (source) {
    case "chapters":
      return collectMarkdownDirectory(project, source, joinPath(project.path, "wiki/chapters"), api)
    case "outlines":
      return collectMarkdownDirectory(project, source, joinPath(project.path, "wiki/outlines"), api)
    case "book-analysis":
      return collectBookAnalysis(project, api)
    case "story-simulation":
      return collectStorySimulation(project, api)
    case "soul-works":
      return collectSoulWorks(project, api)
  }
}

export async function collectAllProjectSources(
  project: WikiProject,
  api: CollectorFileApi = defaultFileApi,
): Promise<Record<ExportSource, ExportDocument[]>> {
  const settled = await Promise.allSettled(
    EXPORT_SOURCES.map((source) => collectSourceDocuments(project, source, api)),
  )
  return Object.fromEntries(EXPORT_SOURCES.map((source, index) => [
    source,
    settled[index].status === "fulfilled" ? settled[index].value : [],
  ])) as Record<ExportSource, ExportDocument[]>
}
