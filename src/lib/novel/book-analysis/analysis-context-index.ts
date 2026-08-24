import {
  createDirectory,
  fileExists,
  listDirectory,
  readFile,
  writeFileAtomic,
} from "@/commands/fs"
import { joinPath, normalizePath } from "@/lib/path-utils"
import type {
  AnalysisChapterRange,
  AnalysisEvidenceSnippet,
  AnalysisSkill,
  BookAnalysisModuleManifest,
} from "./analysis-pipeline-types"

interface BookAnalysisContextModule {
  skill: AnalysisSkill
  summary: string
  range: AnalysisChapterRange
  updatedAt: number
}

interface BookAnalysisContextBookInput {
  bookId: string
  title: string
  modules: BookAnalysisContextModule[]
  evidence: AnalysisEvidenceSnippet[]
}

interface BookAnalysisContextIndex {
  version: 1
  books: BookAnalysisContextBookInput[]
  updatedAt: number
}

interface ContextIndexEntry {
  name: string
  path: string
  is_dir: boolean
}

interface BookAnalysisContextIndexIo {
  createDirectory(path: string): Promise<void>
  fileExists(path: string): Promise<boolean>
  listDirectory(path: string): Promise<ContextIndexEntry[]>
  readFile(path: string): Promise<string>
  writeFileAtomic(path: string, contents: string): Promise<void>
}

const defaultIo: BookAnalysisContextIndexIo = {
  createDirectory,
  fileExists,
  listDirectory: async (path) => listDirectory(path),
  readFile,
  writeFileAtomic,
}

function normalized(path: string): string {
  return normalizePath(path).replace(/\/+$/, "")
}

function indexPath(projectPath: string): string {
  return normalized(joinPath(projectPath, ".qmai", "book-analysis-context.json"))
}

export function buildBookAnalysisContextIndex(
  books: BookAnalysisContextBookInput[],
  updatedAt = Date.now(),
): BookAnalysisContextIndex {
  return {
    version: 1,
    books: books.map((book) => ({
      ...book,
      modules: book.modules.filter((module) => module.summary.trim()),
      evidence: book.evidence.filter((item) => item.enabled),
    })),
    updatedAt,
  }
}

function normalizedText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, "")
}

function evidenceScore(query: string, item: AnalysisEvidenceSnippet): number {
  let score = 0
  for (const tag of item.tags) {
    if (query.includes(normalizedText(tag))) score += 3
  }
  if (item.purpose && query.includes(normalizedText(item.purpose))) score += 2
  if (item.reason && query.includes(normalizedText(item.reason))) score += 2
  if (item.text && query.includes(normalizedText(item.text))) score += 1
  return score
}

const SKILL_QUERY_TERMS: Record<AnalysisSkill, string[]> = {
  characters: ["角色", "人物", "人设", "动机", "成长弧", "说话方式"],
  story: ["故事", "剧情", "情节", "框架", "爽点", "钩子", "铺垫"],
  style: ["文风", "风格", "幽默", "热血", "高燃", "句式", "词汇", "叙事视角"],
}

export function searchBookAnalysisContextIndex(
  index: BookAnalysisContextIndex,
  task: string,
  maxEvidence = 8,
): string {
  const query = normalizedText(task)
  if (!query) return ""
  const sections: Array<{ score: number; text: string }> = []

  for (const book of index.books) {
    const titleScore = query.includes(normalizedText(book.title)) ? 4 : 0
    const moduleMatches = book.modules.filter((module) => (
      titleScore > 0 || SKILL_QUERY_TERMS[module.skill].some((term) => query.includes(normalizedText(term)))
    ))
    const scoredEvidence = book.evidence
      .map((item) => ({ item, score: evidenceScore(query, item) + titleScore }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, maxEvidence)
    const score = titleScore + moduleMatches.length * 2 + scoredEvidence.reduce((sum, entry) => sum + entry.score, 0)
    if (score === 0) continue

    const lines = [`拆书作品：《${book.title}》`]
    for (const module of moduleMatches) {
      lines.push(`${module.skill} 分析（第 ${module.range.startOrder}～${module.range.endOrder} 章）：${module.summary}`)
    }
    for (const { item } of scoredEvidence) {
      lines.push(
        `证据 · 第 ${item.chapterOrder} 章 · ${item.tags.join("、") || item.skill}：${item.text}`,
        `用途：${item.purpose}；保存原因：${item.reason}`,
      )
    }
    sections.push({ score, text: lines.join("\n") })
  }

  return sections
    .sort((left, right) => right.score - left.score)
    .map((section) => section.text)
    .join("\n\n")
}

async function readJson<T>(path: string, io: BookAnalysisContextIndexIo): Promise<T | null> {
  if (!(await io.fileExists(path))) return null
  try {
    return JSON.parse(await io.readFile(path)) as T
  } catch {
    return null
  }
}

export async function rebuildBookAnalysisContextIndex(
  projectPath: string,
  io: BookAnalysisContextIndexIo = defaultIo,
): Promise<BookAnalysisContextIndex> {
  const booksRoot = normalized(joinPath(projectPath, "book-analysis"))
  const books: BookAnalysisContextBookInput[] = []
  if (await io.fileExists(booksRoot)) {
    for (const entry of await io.listDirectory(booksRoot)) {
      if (!entry.is_dir || !entry.name.startsWith("book-")) continue
      const metadata = await readJson<{ title?: string }>(joinPath(entry.path, "metadata.json"), io)
      if (!metadata?.title) continue
      const manifest = await readJson<BookAnalysisModuleManifest>(joinPath(entry.path, "analysis", "manifest.json"), io)
      const evidence = await readJson<{ snippets?: AnalysisEvidenceSnippet[] }>(joinPath(entry.path, "analysis", "evidence.json"), io)
      const modules = Object.values(manifest?.modules ?? {})
        .filter((module): module is NonNullable<typeof module> => Boolean(module?.summary?.trim()))
        .map((module) => ({
          skill: module.skill,
          summary: module.summary ?? "",
          range: module.range,
          updatedAt: module.updatedAt,
        }))
      books.push({
        bookId: entry.name,
        title: metadata.title,
        modules,
        evidence: Array.isArray(evidence?.snippets) ? evidence.snippets : [],
      })
    }
  }

  const index = buildBookAnalysisContextIndex(books)
  await io.createDirectory(normalized(joinPath(projectPath, ".qmai")))
  await io.writeFileAtomic(indexPath(projectPath), JSON.stringify(index, null, 2))
  return index
}

async function loadBookAnalysisContextIndex(
  projectPath: string,
  io: BookAnalysisContextIndexIo = defaultIo,
): Promise<BookAnalysisContextIndex> {
  return (await readJson<BookAnalysisContextIndex>(indexPath(projectPath), io))
    ?? buildBookAnalysisContextIndex([], 0)
}

export async function searchBookAnalysisContext(
  projectPath: string,
  task: string,
  io: BookAnalysisContextIndexIo = defaultIo,
): Promise<string> {
  return searchBookAnalysisContextIndex(await loadBookAnalysisContextIndex(projectPath, io), task)
}
