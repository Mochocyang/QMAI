/**
 * 候选角色的「轻量预览」数据：出场分布 + 章节原句片段。
 *
 * ── 为什么要读正文章节 ──
 * 候选只存在于 `sightings.json`（一份出场计数），磁盘上没有档案、没有正文。
 * 用户要判断「这个人值不值得建档」，唯一有用的依据是**他出场时原文怎么写他**。
 * 所以这里按章号去读正文，摘出提到他的句子。
 *
 * ── 为什么最多读 3 章（首次 1 章 + 最近 2 章）──
 * 出场 20 章就逐个读，等于每次点一个候选都读 20 个文件，慢且没必要：
 * · **首次出场**回答「他是谁、怎么被介绍进来的」；
 * · **最近两章**回答「他现在还在不在、戏份有没有变重」。
 * 这两头一夹，判断依据就够了；中间章节对「要不要建档」几乎没有增量信息。
 * 出场 ≤ 3 章时全取 —— 本来就没几章，没必要挑。
 */

/** 一次预览最多读几章正文。 */
export const SIGHTING_PREVIEW_MAX_CHAPTERS = 3

/** 每章最多摘几句。超过两句会把预览变成原文摘抄。 */
const MAX_SENTENCES_PER_CHAPTER = 2

/** 单句最长字符数：太长的句子截断，避免整段铺满。 */
const MAX_SENTENCE_CHARS = 120

/**
 * 选出要读的章节号（升序返回）。
 * 首次 1 章 + 最近 2 章；总数 ≤ 3 时按原样全取。
 */
export function selectExcerptChapters(chapters: readonly number[]): number[] {
  const unique = [...new Set(chapters.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b)
  if (unique.length <= SIGHTING_PREVIEW_MAX_CHAPTERS) return unique
  const first = unique[0]
  const tail = unique.slice(-(SIGHTING_PREVIEW_MAX_CHAPTERS - 1))
  return [...new Set([first, ...tail])].sort((a, b) => a - b)
}

/**
 * 从一章正文里摘出提到这些名字的句子。
 *
 * 按中英文句末标点切句，逐句判断是否含任一名（或别名），
 * 命中就收；每章最多 {@link MAX_SENTENCES_PER_CHAPTER} 句。
 */
export function extractMentionExcerpts(
  chapterBody: string,
  names: readonly string[],
): string[] {
  const needles = names.map((name) => name.trim()).filter(Boolean)
  if (needles.length === 0) return []

  const sentences = chapterBody
    .replace(/\r\n/g, "\n")
    .split(/(?<=[。！？…!?])|\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

  const hits: string[] = []
  for (const sentence of sentences) {
    if (!needles.some((needle) => sentence.includes(needle))) continue
    const trimmed =
      sentence.length > MAX_SENTENCE_CHARS ? `${sentence.slice(0, MAX_SENTENCE_CHARS)}…` : sentence
    hits.push(trimmed)
    if (hits.length >= MAX_SENTENCES_PER_CHAPTER) break
  }
  return hits
}

export interface SightingExcerpt {
  chapter: number
  sentences: string[]
}

export interface LoadSightingExcerptsInput {
  projectPath: string
  /** 候选名 + 别名：正文可能用别名提到他。 */
  names: readonly string[]
  chapters: readonly number[]
  /** 注入点：便于测试替身，缺省用真实的章号 → 路径解析与读文件。 */
  resolveChapterPath?: (chapterNumber: number) => Promise<string | null>
  readChapterBody?: (path: string) => Promise<string>
}

/**
 * 组装预览所需的章节摘句。永不抛：任何一章读不到就跳过那一章，
 * 预览宁可少一条，也不能因为某章缺失而整块打不开。
 */
export async function loadSightingExcerpts(
  input: LoadSightingExcerptsInput,
): Promise<SightingExcerpt[]> {
  const targets = selectExcerptChapters(input.chapters)
  if (targets.length === 0) return []

  const resolve = input.resolveChapterPath ?? defaultResolveChapterPath(input.projectPath)
  const read = input.readChapterBody ?? defaultReadChapterBody

  const results: SightingExcerpt[] = []
  for (const chapter of targets) {
    try {
      const path = await resolve(chapter)
      if (!path) continue
      const body = await read(path)
      const sentences = extractMentionExcerpts(body, input.names)
      if (sentences.length > 0) results.push({ chapter, sentences })
    } catch {
      // 单章失败不影响整体预览。
    }
  }
  return results
}

function defaultResolveChapterPath(projectPath: string) {
  return async (chapterNumber: number): Promise<string | null> => {
    const { findChapterFileByNumber } = await import("./chapter-utils")
    return findChapterFileByNumber(projectPath, chapterNumber)
  }
}

async function defaultReadChapterBody(path: string): Promise<string> {
  const { readFile } = await import("@/commands/fs")
  return readFile(path)
}
