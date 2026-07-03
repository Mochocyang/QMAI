import type { Tool } from "../types"
import { listDirectory } from "@/commands/fs"

export function createListChaptersTool(chaptersDir: string): Tool {
  return {
    name: "list_chapters",
    description: "列出所有章节文件的名称列表。无需参数。",
    category: "read",
    parameters: {},
    execute: async () => {
      try {
        const files = await listDirectory(chaptersDir)
        const chapters = files
          .filter((f) => !f.is_dir && f.name.endsWith(".md"))
          .map((f) => f.name.replace(/\.md$/, ""))
        return `可用章节列表:\n${chapters.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
      } catch {
        return "错误：无法列出章节目录"
      }
    },
  }
}
