/**
 * 拆书分析引擎 - 主入口（精简版）
 * 专注于：章节拆分 → 角色提取 → Skill 生成
 */

import type { LlmConfig } from "@/stores/wiki-store"
import type {
  BookAnalysisMetadata,
  ChapterSelectionState,
} from "./types"
import { createDirectory, writeFile, readFile, listDirectory } from "@/commands/fs"
import { normalizePath, joinPath } from "@/lib/path-utils"
import { fingerprintFileSample } from "./content-fingerprint"
import { findBookLibraryEntry, upsertBookLibraryEntry } from "./library-store"

export interface SplitChaptersInput {
  sourcePath: string
  projectPath: string
  llmConfig: LlmConfig
  onProgress?: (progress: {
    stage: string
    stageLabel: string
    completed: number
    total: number
    percentage: number
    currentItem?: string
  }) => void
  signal?: AbortSignal
}

export interface SplitChaptersResult {
  success: boolean
  bookId: string
  bookPath: string
  metadata: BookAnalysisMetadata
  chapters: Array<{
    id: string
    title: string
    order: number
    wordCount: number
    path: string
  }>
}

export interface ParsedNovelChapter {
  title: string
  content: string
  order: number
}

export function parseNovelChapters(content: string): ParsedNovelChapter[] {
  const chapterRegex = /第[零〇一二三四五六七八九十百千万两0-9]+章[^\n]*/gi
  const matches = Array.from(content.matchAll(chapterRegex))

  if (matches.length === 0) {
    throw new Error("未能识别到章节标记，请确保小说文件包含\"第X章\"格式的章节标题")
  }

  return matches.map((match, index) => {
    const startIdx = match.index!
    const endIdx = matches[index + 1]?.index ?? content.length
    return {
      title: match[0].trim(),
      content: content.slice(startIdx, endIdx).trim(),
      order: index + 1,
    }
  })
}

export function buildChapterMarkdown(
  bookId: string,
  chapter: ParsedNovelChapter,
): string {
  void bookId
  const chapterId = `ch-${String(chapter.order).padStart(4, "0")}`
  return `---
id: ${chapterId}
title: ${chapter.title}
order: ${chapter.order}
wordCount: ${chapter.content.length}
---

${chapter.content}
`
}

/**
 * 创建拆书分析目录结构
 */
async function createAnalysisDirectories(projectPath: string, bookId: string): Promise<string> {
  const bookPath = normalizePath(joinPath(projectPath, "book-analysis", bookId))

  await createDirectory(normalizePath(joinPath(projectPath, "book-analysis")))
  await createDirectory(bookPath)
  await createDirectory(joinPath(bookPath, "chapters"))
  await createDirectory(joinPath(bookPath, "characters"))
  await createDirectory(joinPath(bookPath, "skills"))

  return bookPath
}

/**
 * 读取并拆分小说章节
 */
export async function splitNovelIntoChapters(
  sourcePath: string,
  projectPath: string,
  _llmConfig: LlmConfig,
  onProgress?: (progress: any) => void,
  signal?: AbortSignal
): Promise<SplitChaptersResult> {
  // 生成 bookId - 顶部声明一次（feature/book-analysis-reuse）
  const now = Date.now()

  onProgress?.({
    stage: "reading_file",
    stageLabel: "读取文件中",
    completed: 0,
    total: 100,
    percentage: 0,
  })

  // 读取源文件 + 算指纹（feature/book-analysis-reuse：先读后算 hash）
  let content: string
  try {
    content = await readFile(sourcePath)
  } catch (error) {
    throw new Error(`读取文件失败: ${error instanceof Error ? error.message : String(error)}`)
  }
  const contentHash = fingerprintFileSample(content)
  const normalizedSource = normalizePath(sourcePath)

  // 查重（feature/book-analysis-reuse）：命中则复用 bookId，跳过目录创建
  const existing = await findBookLibraryEntry(projectPath, normalizedSource, contentHash)
  let bookId: string
  let bookPath: string
  if (existing) {
    bookId = existing.bookId
    bookPath = normalizePath(joinPath(projectPath, "book-analysis", bookId))
    onProgress?.({
      stage: "reading_file",
      stageLabel: "复用历史分析",
      completed: 10,
      total: 100,
      percentage: 10,
    })
  } else {
    bookId = `book-${now}`
    bookPath = await createAnalysisDirectories(projectPath, bookId)
  }

  if (signal?.aborted) {
    throw new Error("用户取消分析")
  }

  onProgress?.({
    stage: "splitting_chapters",
    stageLabel: existing ? "复用章节中" : "识别章节中",
    completed: 10,
    total: 100,
    percentage: 10,
  })

  // 章节拆分（支持多种格式）
  const parsedChapters = parseNovelChapters(content)
  const chapters: Array<{
    id: string
    title: string
    order: number
    wordCount: number
    path: string
  }> = []

  const totalChapters = parsedChapters.length
  let totalWords = 0

  for (const chapter of parsedChapters) {
    if (signal?.aborted) {
      throw new Error("用户取消分析")
    }

    const chapterId = `ch-${String(chapter.order).padStart(4, "0")}`
    const chapterPath = joinPath(bookPath, "chapters", `${chapterId}.md`)
    const wordCount = chapter.content.length
    totalWords += wordCount

    await writeFile(chapterPath, buildChapterMarkdown(bookId, chapter))

    chapters.push({
      id: chapterId,
      title: chapter.title,
      order: chapter.order,
      wordCount,
      path: chapterPath,
    })

    // 更新进度
    const progress = Math.floor(10 + chapter.order / totalChapters * 20)
    onProgress?.({
      stage: "splitting_chapters",
      stageLabel: "拆分章节中",
      completed: chapter.order,
      total: totalChapters,
      percentage: progress,
      currentItem: chapter.title,
    })
  }

  // 提取书名（从文件名或第一章）
  const sourceFileName = sourcePath.split(/[/\\]/).pop()?.replace(/\.txt$/i, "") || "未命名作品"
  const bookTitle = sourceFileName

  // 保存元数据（feature/book-analysis-reuse：复用时保留原 createdAt）
  const metadata: BookAnalysisMetadata = {
    title: bookTitle,
    author: undefined,
    totalChapters: chapters.length,
    totalWords,
    sourceType: "file",
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  }

  await writeFile(
    joinPath(bookPath, "metadata.json"),
    JSON.stringify(metadata, null, 2)
  )

  // 注册到 library（feature/book-analysis-reuse）
  await upsertBookLibraryEntry(projectPath, {
    bookId,
    sourcePath: normalizedSource,
    contentHash,
    title: bookTitle,
    totalChapters: chapters.length,
    totalWords,
    charactersCount: existing?.charactersCount ?? 0,
    skillsCount: existing?.skillsCount ?? 0,
    status: "completed",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })

  onProgress?.({
    stage: "splitting_chapters",
    stageLabel: "章节拆分完成",
    completed: totalChapters,
    total: totalChapters,
    percentage: 30,
  })

  return {
    success: true,
    bookId,
    bookPath,
    metadata,
    chapters,
  }
}

/**
 * 读取已拆分的章节列表
 */
export async function loadChapterList(bookPath: string): Promise<ChapterSelectionState[]> {
  const chaptersDir = joinPath(bookPath, "chapters")

  try {
    const files = await listDirectory(chaptersDir)
    const chapters: ChapterSelectionState[] = []

    // 只处理 .md 文件
    const mdFiles = files.filter((f) => f.name.endsWith(".md") && !f.is_dir)

    for (const file of mdFiles) {
      try {
        const content = await readFile(file.path)

        // 解析 frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1]
          const idMatch = frontmatter.match(/id:\s*(.+)/)
          const titleMatch = frontmatter.match(/title:\s*(.+)/)
          const orderMatch = frontmatter.match(/order:\s*(\d+)/)
          const wordCountMatch = frontmatter.match(/wordCount:\s*(\d+)/)

          if (idMatch && titleMatch && orderMatch) {
            chapters.push({
              chapterId: idMatch[1].trim(),
              title: titleMatch[1].trim(),
              order: parseInt(orderMatch[1], 10),
              wordCount: wordCountMatch ? parseInt(wordCountMatch[1], 10) : 0,
              selected: false,
              analyzed: false,
            })
          }
        }
      } catch (err) {
        console.error(`Failed to read chapter ${file.path}:`, err)
      }
    }

    // 按顺序排序
    chapters.sort((a, b) => a.order - b.order)
    // 用户选择的是作品中的连续章节序号；导入旧数据可能存在 0 起始或断号，统一为 1..N。
    chapters.forEach((chapter, index) => {
      chapter.order = index + 1
    })

    return chapters
  } catch (error) {
    console.error("Failed to load chapter list:", error)
    return []
  }
}

/**
 * 读取元数据
 */
export async function loadMetadata(bookPath: string): Promise<BookAnalysisMetadata | null> {
  try {
    const metadataPath = joinPath(bookPath, "metadata.json")
    const content = await readFile(metadataPath)
    return JSON.parse(content) as BookAnalysisMetadata
  } catch (error) {
    console.error("Failed to load metadata:", error)
    return null
  }
}
