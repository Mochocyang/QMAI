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
  // 生成 bookId
  const now = Date.now()
  const bookId = `book-${now}`

  onProgress?.({
    stage: "reading_file",
    stageLabel: "读取文件中",
    completed: 0,
    total: 100,
    percentage: 0,
  })

  // 创建目录结构
  const bookPath = await createAnalysisDirectories(projectPath, bookId)

  // 读取源文件
  let content: string
  try {
    content = await readFile(sourcePath)
  } catch (error) {
    throw new Error(`读取文件失败: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (signal?.aborted) {
    throw new Error("用户取消分析")
  }

  onProgress?.({
    stage: "splitting_chapters",
    stageLabel: "识别章节中",
    completed: 10,
    total: 100,
    percentage: 10,
  })

  // 章节拆分（支持多种格式）
  const chapterRegex = /第[一二三四五六七八九十百千0-9]+章[^\n]*/gi
  const matches = Array.from(content.matchAll(chapterRegex))

  if (matches.length === 0) {
    throw new Error("未能识别到章节标记，请确保小说文件包含\"第X章\"格式的章节标题")
  }

  const chapters: Array<{
    id: string
    title: string
    order: number
    wordCount: number
    path: string
  }> = []

  const totalChapters = matches.length
  let totalWords = 0

  for (let i = 0; i < matches.length; i++) {
    if (signal?.aborted) {
      throw new Error("用户取消分析")
    }

    const match = matches[i]
    const title = match[0].trim()
    const startIdx = match.index!
    const endIdx = matches[i + 1]?.index ?? content.length

    const chapterContent = content.slice(startIdx, endIdx).trim()
    const wordCount = chapterContent.length
    totalWords += wordCount

    const chapterId = `ch-${String(i + 1).padStart(4, "0")}`
    const chapterPath = joinPath(bookPath, "chapters", `${chapterId}.md`)

    // 生成 markdown 格式
    const markdown = `---
id: ${chapterId}
title: ${title}
order: ${i + 1}
wordCount: ${wordCount}
---

${chapterContent}
`

    await writeFile(chapterPath, markdown)

    chapters.push({
      id: chapterId,
      title,
      order: i + 1,
      wordCount,
      path: chapterPath,
    })

    // 更新进度
    const progress = Math.floor(10 + (i + 1) / totalChapters * 20)
    onProgress?.({
      stage: "splitting_chapters",
      stageLabel: "拆分章节中",
      completed: i + 1,
      total: totalChapters,
      percentage: progress,
      currentItem: title,
    })
  }

  // 提取书名（从文件名或第一章）
  const sourceFileName = sourcePath.split(/[/\\]/).pop()?.replace(/\.txt$/i, "") || "未命名作品"
  const bookTitle = sourceFileName

  // 保存元数据
  const metadata: BookAnalysisMetadata = {
    title: bookTitle,
    author: undefined,
    totalChapters: chapters.length,
    totalWords,
    sourceType: "file",
    createdAt: now,
    updatedAt: now,
  }

  await writeFile(
    joinPath(bookPath, "metadata.json"),
    JSON.stringify(metadata, null, 2)
  )

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
