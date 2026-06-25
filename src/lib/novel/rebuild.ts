/**
 * 索引和图谱重建模块
 * 支持一键重建所有章节快照、图谱节点和搜索索引
 */

import { readFile, listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { parseFrontmatter } from "@/lib/frontmatter"
import { isChapterPage, isFinalChapter } from "./chapter-meta"
import { ingestChapter } from "./chapter-ingest"
import { useWikiStore } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"

export interface RebuildProgress {
  total: number
  completed: number
  current: string
  errors: string[]
}

export type RebuildProgressCallback = (progress: RebuildProgress) => void

function flattenMdFiles(nodes: FileNode[]): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = []
  for (const node of nodes) {
    if (node.is_dir) {
      if (node.children) out.push(...flattenMdFiles(node.children))
      continue
    }
    if (node.name.endsWith(".md")) out.push({ name: node.name, path: node.path })
  }
  return out
}

/**
 * 重建所有正式章节的快照和图谱
 * 会按章节号顺序依次重新摄取
 */
export async function rebuildAllSnapshots(
  projectPath: string,
  onProgress?: RebuildProgressCallback,
): Promise<{ success: number; failed: number; errors: string[] }> {
  const pp = normalizePath(projectPath)
  const novelMode = useWikiStore.getState().novelMode
  if (!novelMode) {
    return { success: 0, failed: 0, errors: ["小说模式未开启"] }
  }

  // 找到所有章节文件
  const chaptersDir = `${pp}/wiki/chapters`
  let files: { name: string; path: string }[] = []
  try {
    const tree = await listDirectory(chaptersDir)
    files = flattenMdFiles(tree)
  } catch {
    // 尝试从 wiki 根目录搜索
    try {
      const tree = await listDirectory(`${pp}/wiki`)
      files = flattenMdFiles(tree)
    } catch {
      return { success: 0, failed: 0, errors: ["无法读取章节目录"] }
    }
  }

  // 筛选正式章节并排序
  const chapters: { path: string; chapterNumber: number }[] = []
  for (const file of files) {
    try {
      const content = await readFile(file.path)
      const parsed = parseFrontmatter(content)
      const fm = parsed.frontmatter as Record<string, unknown> | null
      if (!fm) continue
      if (!isChapterPage(fm)) continue
      if (!isFinalChapter(fm)) continue
      const num = typeof fm.chapter_number === "number" ? fm.chapter_number : 0
      chapters.push({ path: file.path, chapterNumber: num })
    } catch {
      // skip unreadable
    }
  }

  chapters.sort((a, b) => a.chapterNumber - b.chapterNumber)

  const errors: string[] = []
  let success = 0
  let failed = 0

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i]
    onProgress?.({
      total: chapters.length,
      completed: i,
      current: `第${chapter.chapterNumber}章`,
      errors,
    })

    try {
      const result = await ingestChapter(pp, chapter.path)
      if (result.snapshot) {
        success++
      } else {
        failed++
        const reason = result.failReason === "invalid_chapter_number" ? "章节编号无效" : result.failReason === "no_llm" ? "LLM 未配置" : "摄取返回空结果"
        errors.push(`第${chapter.chapterNumber}章：${reason}`)
      }
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`第${chapter.chapterNumber}章：${msg}`)
    }
  }

  onProgress?.({
    total: chapters.length,
    completed: chapters.length,
    current: "完成",
    errors,
  })

  return { success, failed, errors }
}

/**
 * 重建向量索引
 * 重新嵌入所有 wiki 页面
 */
export async function rebuildVectorIndex(
  projectPath: string,
  onProgress?: RebuildProgressCallback,
): Promise<{ indexed: number; errors: string[] }> {
  const pp = normalizePath(projectPath)
  const embCfg = useWikiStore.getState().embeddingConfig

  if (!embCfg.enabled || !embCfg.model) {
    return { indexed: 0, errors: ["向量嵌入未启用或未配置模型"] }
  }

  const wikiDir = `${pp}/wiki`
  let files: { name: string; path: string }[] = []
  try {
    const tree = await listDirectory(wikiDir)
    files = flattenMdFiles(tree)
  } catch {
    return { indexed: 0, errors: ["无法读取 wiki 目录"] }
  }

  const errors: string[] = []
  let indexed = 0

  const { embedPage } = await import("@/lib/embedding")

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    onProgress?.({
      total: files.length,
      completed: i,
      current: file.name,
      errors,
    })

    try {
      const content = await readFile(file.path)
      const pageId = file.name.replace(/\.md$/, "")
      const titleMatch = content.match(/^#\s+(.+)/m)
      const title = titleMatch?.[1]?.trim() ?? pageId
      await embedPage(pp, pageId, title, content, embCfg)
      indexed++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${file.name}：${msg}`)
    }
  }

  onProgress?.({
    total: files.length,
    completed: files.length,
    current: "完成",
    errors,
  })

  return { indexed, errors }
}
