import type { Tool } from "../types"
import { listDirectory } from "@/commands/fs"
import { flattenMdFiles } from "@/lib/novel/chapter-utils"

/** 仅匹配「第N章/节/回」，避免 backup-2024 等文件名污染最新章号 */
function extractStrictChapterNumber(text: string): number | null {
  const m = text.match(/第\s*(\d+)\s*[章节回]/)
  if (!m?.[1]) return null
  const n = Number.parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function createListChaptersTool(chaptersDir: string): Tool {
  return {
    name: "list_chapters",
    description:
      "列出所有章节文件的名称列表，并标注最新已写章节号。续写「下一章」时可用最新章号+1 作为目标章号。无需参数。",
    category: "read",
    parameters: {},
    execute: async () => {
      try {
        const files = await listDirectory(chaptersDir)
        const chapters = flattenMdFiles(files).map((f) => f.name.replace(/\.md$/i, ""))
        const numbers = chapters
          .map((name) => extractStrictChapterNumber(name))
          .filter((n): n is number => n !== null)
        const latest = numbers.length > 0 ? Math.max(...numbers) : null

        const lines = [
          "可用章节列表:",
          ...chapters.map((c, i) => `${i + 1}. ${c}`),
        ]
        if (latest !== null) {
          lines.push("")
          lines.push(`最新已写章节：第 ${latest} 章。若任务是续写下一章，可推断目标为第 ${latest + 1} 章。`)
          lines.push("找大纲时以「本次要写的目标章号」为准，不要用最新已写章号直接当卷纲匹配锚点。")
        }
        return lines.join("\n")
      } catch {
        return "错误：无法列出章节目录"
      }
    },
  }
}
