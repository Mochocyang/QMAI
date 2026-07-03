import type { Tool } from "../types"
import { listDirectory } from "@/commands/fs"

export function createListOutlinesTool(outlinesDir: string): Tool {
  return {
    name: "list_outlines",
    description: "列出所有大纲文件的名称列表。无需参数。",
    category: "read",
    parameters: {},
    execute: async () => {
      try {
        const files = await listDirectory(outlinesDir)
        const outlines = files
          .filter((f) => !f.is_dir && f.name.endsWith(".md"))
          .map((f) => f.name.replace(/\.md$/, ""))
        return `可用大纲列表:\n${outlines.map((o, i) => `${i + 1}. ${o}`).join("\n")}`
      } catch {
        return "错误：无法列出大纲目录"
      }
    },
  }
}
