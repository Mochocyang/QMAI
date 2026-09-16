/**
 * 章节元数据标注（feature/writing-dna）
 *
 * 对应 writing-dna-skill 的 `_meta/` 目录：给每一章打上 hook 类型、结构类型、
 * 场景数、题材标签。这是"写作前读 5 篇体裁题材最接近的原文"能落地的前提——
 * 没有它就只能注入固定 samples，无法按当前要写的章去检索。
 *
 * 落盘：<bookPath>/analysis/chapter-meta.json
 * 标注来源：能脚本算的（字数、场景数、对白占比）就脚本算，
 * 只有 hook 类型 / 结构类型 / 题材标签需要模型判断，且折进 L2 结构分析同一次调用，不额外加调用。
 */
import { createDirectory, fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { joinPath, normalizePath } from "@/lib/path-utils"
import { splitSentences } from "./style-metrics"

export interface ChapterMetaEntry {
  chapterId: string
  order: number
  title: string
  wordCount: number
  /** 开场 hook 类型：冲突式 / 场景式 / 对白式 / 悬念式 / 叙述式 / 问题式 */
  hookType: string
  /** 章节结构类型：推进章 / 冲突章 / 过渡章 / 爆点章 / 信息章 */
  structurePattern: string
  /** 本章场景数（脚本估算，按空行与场景分隔符切） */
  sceneCount: number
  /** 题材标签，用于按题材检索 */
  topicTags: string[]
  /** 含引号对白的段落占比（脚本算） */
  dialogueRatio: number
  updatedAt: number
}

export interface ChapterMetaCollection {
  version: 1
  bookId: string
  entries: ChapterMetaEntry[]
  updatedAt: number
}

/** 模型在 L2 调用里顺带返回的标注（只含它才能判断的字段）。 */
export interface ChapterMetaAnnotation {
  chapterId: string
  hookType: string
  structurePattern: string
  topicTags: string[]
}

export interface ChapterMetaStoreIo {
  createDirectory(path: string): Promise<void>
  fileExists(path: string): Promise<boolean>
  readFile(path: string): Promise<string>
  writeFileAtomic(path: string, contents: string): Promise<void>
}

const defaultIo: ChapterMetaStoreIo = { createDirectory, fileExists, readFile, writeFileAtomic }

/** 场景分隔：连续空行，或整行只有分隔符号。 */
const SCENE_SEPARATOR = /\n\s*\n\s*\n|\n\s*(?:[*＊·•]{3,}|[-—─]{3,}|={3,})\s*\n/

function normalized(path: string): string {
  return normalizePath(path).replace(/\/+$/, "")
}

function metaPath(bookPath: string): string {
  return normalized(joinPath(bookPath, "analysis", "chapter-meta.json"))
}

function analysisDir(bookPath: string): string {
  return normalized(joinPath(bookPath, "analysis"))
}

function bookIdFromPath(bookPath: string): string {
  return normalized(bookPath).split("/").pop() || "unknown-book"
}

function emptyCollection(bookPath: string): ChapterMetaCollection {
  return { version: 1, bookId: bookIdFromPath(bookPath), entries: [], updatedAt: 0 }
}

function isCollection(value: unknown): value is ChapterMetaCollection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Partial<ChapterMetaCollection>
  return candidate.version === 1 && typeof candidate.bookId === "string" && Array.isArray(candidate.entries)
}

/** 脚本估算场景数：至少 1。 */
export function estimateSceneCount(body: string): number {
  const text = body.trim()
  if (!text) return 0
  return text.split(SCENE_SEPARATOR).filter((part) => part.trim().length > 0).length || 1
}

/** 脚本算含对白段落占比。 */
export function computeDialogueRatio(body: string): number {
  const paragraphs = body.split(/\r?\n+/).map((item) => item.trim()).filter(Boolean)
  if (paragraphs.length === 0) return 0
  const withDialogue = paragraphs.filter((item) => /[“”「」『』]/.test(item)).length
  return Number((withDialogue / paragraphs.length).toFixed(4))
}

/**
 * 合成一条章节元数据：脚本字段现算，模型字段取标注，缺标注时留空字符串。
 * 留空而不是瞎猜——检索时空标签只是匹配不上，不会污染结果。
 */
export function buildChapterMetaEntry(input: {
  chapterId: string
  order: number
  title: string
  body: string
  annotation?: ChapterMetaAnnotation
  now: number
}): ChapterMetaEntry {
  const body = input.body.trim()
  return {
    chapterId: input.chapterId,
    order: input.order,
    title: input.title,
    wordCount: body.length,
    hookType: input.annotation?.hookType ?? "",
    structurePattern: input.annotation?.structurePattern ?? "",
    sceneCount: estimateSceneCount(body),
    topicTags: input.annotation?.topicTags ?? [],
    dialogueRatio: computeDialogueRatio(body),
    updatedAt: input.now,
  }
}

export async function loadChapterMeta(
  bookPath: string,
  io: ChapterMetaStoreIo = defaultIo,
): Promise<ChapterMetaCollection> {
  const path = metaPath(bookPath)
  if (!(await io.fileExists(path))) return emptyCollection(bookPath)
  try {
    const parsed = JSON.parse(await io.readFile(path)) as unknown
    return isCollection(parsed) ? parsed : emptyCollection(bookPath)
  } catch {
    return emptyCollection(bookPath)
  }
}

/** 按 chapterId 覆盖写入；未涉及的章节保持不变。 */
export async function upsertChapterMeta(
  bookPath: string,
  incoming: ChapterMetaEntry[],
  io: ChapterMetaStoreIo = defaultIo,
): Promise<ChapterMetaCollection> {
  const current = await loadChapterMeta(bookPath, io)
  const byId = new Map(current.entries.map((item) => [item.chapterId, item]))
  for (const item of incoming) byId.set(item.chapterId, item)
  const next: ChapterMetaCollection = {
    ...current,
    entries: [...byId.values()].sort((a, b) => a.order - b.order),
    updatedAt: Date.now(),
  }
  await io.createDirectory(analysisDir(bookPath))
  await io.writeFileAtomic(metaPath(bookPath), JSON.stringify(next, null, 2))
  return next
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,，。、；;：:!！?？"'“”「」()（）\[\]【】/\\|-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
}

/**
 * 按当前写作任务描述给章节打分：题材标签命中权重最高，其次标题命中，
 * 再其次 hook / 结构类型命中。全都不命中时得 0 分。
 */
export function scoreChapterMeta(entry: ChapterMetaEntry, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0
  let score = 0
  const tags = entry.topicTags.map((item) => item.toLowerCase())
  const title = entry.title.toLowerCase()
  const structural = `${entry.hookType}${entry.structurePattern}`.toLowerCase()
  for (const token of queryTokens) {
    if (tags.some((tag) => tag.includes(token) || token.includes(tag))) score += 3
    if (title.includes(token)) score += 2
    if (structural.includes(token)) score += 1
  }
  return score
}

/**
 * 挑出与当前写作任务最接近的若干章。
 * 对齐 writing-dna-skill 的取法：命中项超额时取 order 最大（最近）的，
 * 命中不足时用篇幅达标的章节补齐，保证总是给够条数。
 */
export function selectRelevantChapters(
  entries: ChapterMetaEntry[],
  query: string,
  limit: number,
): ChapterMetaEntry[] {
  if (entries.length === 0 || limit <= 0) return []
  const tokens = tokenizeQuery(query)
  const scored = entries
    .map((entry) => ({ entry, score: scoreChapterMeta(entry, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.order - a.entry.order)
    .slice(0, limit)
    .map((item) => item.entry)

  if (scored.length >= limit) return scored

  const taken = new Set(scored.map((item) => item.chapterId))
  const median = [...entries].sort((a, b) => a.wordCount - b.wordCount)[Math.floor(entries.length / 2)]
  const minWordCount = Math.min(median?.wordCount ?? 0, 800)
  const filler = entries
    .filter((entry) => !taken.has(entry.chapterId) && entry.wordCount >= minWordCount)
    .sort((a, b) => b.order - a.order)
  const fallback = entries.filter((entry) => !taken.has(entry.chapterId)).sort((a, b) => b.order - a.order)
  for (const entry of [...filler, ...fallback]) {
    if (scored.length >= limit) break
    if (taken.has(entry.chapterId)) continue
    taken.add(entry.chapterId)
    scored.push(entry)
  }
  return scored
}

/** 从章节正文里截一段代表性片段：跳过标题行，取前若干句凑到 limit 字。 */
export function excerptChapterBody(body: string, limit: number): string {
  const text = body.replace(/^#{1,6}\s+[^\n]*\n/, "").trim()
  if (!text) return ""
  if (text.length <= limit) return text
  const sentences = splitSentences(text)
  let excerpt = ""
  for (const sentence of sentences) {
    if (excerpt.length + sentence.length > limit) break
    excerpt += sentence
  }
  return excerpt || text.slice(0, limit)
}

/** 章节元数据的可读渲染，写进 语言DNA.md / 章节结构模板.md 的附录。 */
export function formatChapterMetaForMarkdown(entries: ChapterMetaEntry[]): string {
  if (entries.length === 0) return "（无章节标注）"
  const lines = [
    "| 章节 | 标题 | 字数 | hook | 结构 | 场景数 | 对白占比 | 题材标签 |",
    "| - | - | - | - | - | - | - | - |",
  ]
  for (const entry of entries) {
    lines.push([
      entry.chapterId,
      entry.title || "—",
      String(entry.wordCount),
      entry.hookType || "—",
      entry.structurePattern || "—",
      String(entry.sceneCount),
      `${(entry.dialogueRatio * 100).toFixed(1)}%`,
      entry.topicTags.length > 0 ? entry.topicTags.join("、") : "—",
    ].join(" | ").replace(/^/, "| ").concat(" |"))
  }
  return lines.join("\n")
}
