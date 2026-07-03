import type { Tool } from "../types"
import { listDirectory, readFile } from "@/commands/fs"

interface ChapterSearchMatch {
  chapterName: string
  path: string
  location: "正文" | "文件名"
  snippet: string
}

const MAX_RESULTS = 10
const SNIPPET_RADIUS = 80

function normalizeSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function createContentSnippet(content: string, index: number, keywordLength: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(content.length, index + keywordLength + SNIPPET_RADIUS)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < content.length ? "..." : ""
  return `${prefix}${normalizeSnippet(content.slice(start, end))}${suffix}`
}

function createLeadingSnippet(content: string): string {
  const normalized = normalizeSnippet(content)
  if (!normalized) return "（章节内容为空）"
  return normalized.length > 160 ? `${normalized.slice(0, 160)}...` : normalized
}

export function createSearchChaptersTool(chaptersDir: string): Tool {
  return {
    name: "search_chapters",
    description: "按关键词在所有章节中搜索匹配内容。参数 keyword 为搜索关键词。",
    category: "read",
    parameters: {
      keyword: { type: "string", description: "搜索关键词", required: true },
    },
    execute: async (params) => {
      const keyword = typeof params.keyword === "string" ? params.keyword.trim() : ""
      if (!keyword) {
        return "错误：缺少搜索关键词，无法搜索章节。"
      }

      let files
      try {
        files = await listDirectory(chaptersDir)
      } catch {
        return "错误：无法搜索章节目录，请确认章节库存在。"
      }

      const keywordLower = keyword.toLowerCase()
      const chapterFiles = files
        .filter((file) => !file.is_dir && file.name.toLowerCase().endsWith(".md"))
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }))

      const matches: ChapterSearchMatch[] = []
      const failedFiles: string[] = []

      for (const file of chapterFiles) {
        if (matches.length >= MAX_RESULTS) break

        let content: string
        try {
          content = await readFile(file.path)
        } catch {
          failedFiles.push(file.name)
          continue
        }

        const chapterName = file.name.replace(/\.md$/i, "")
        const nameMatches = chapterName.toLowerCase().includes(keywordLower)
        const contentIndex = content.toLowerCase().indexOf(keywordLower)
        if (!nameMatches && contentIndex === -1) continue

        matches.push({
          chapterName,
          path: file.path,
          location: contentIndex >= 0 ? "正文" : "文件名",
          snippet: contentIndex >= 0
            ? createContentSnippet(content, contentIndex, keyword.length)
            : createLeadingSnippet(content),
        })
      }

      if (matches.length === 0) {
        const failedText = failedFiles.length > 0 ? `\n另有 ${failedFiles.length} 个章节读取失败，未纳入搜索。` : ""
        return `未找到匹配章节：${keyword}\n已搜索 ${chapterFiles.length - failedFiles.length} 个章节文件。${failedText}`
      }

      const lines = [`搜索章节内容中匹配「${keyword}」的结果：`]
      for (const [index, match] of matches.entries()) {
        lines.push(`${index + 1}. ${match.chapterName}`)
        lines.push(`路径：${match.path}`)
        lines.push(`命中位置：${match.location}`)
        lines.push(`命中片段：${match.snippet}`)
      }
      if (matches.length >= MAX_RESULTS) {
        lines.push(`仅显示前 ${MAX_RESULTS} 条匹配结果。`)
      }
      if (failedFiles.length > 0) {
        lines.push(`另有 ${failedFiles.length} 个章节读取失败，未纳入搜索。`)
      }
      return lines.join("\n")
    },
  }
}
