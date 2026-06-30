import type { Tool } from "../types"
import { listDirectory } from "@/commands/fs"

export function createListMemoriesTool(memoryDir: string): Tool {
  return {
    name: "list_memories",
    description: "列出所有记忆条目文件的名称列表。无需参数。",
    category: "read",
    parameters: {},
    execute: async () => {
      try {
        const files = await listDirectory(memoryDir)
        const memories = files
          .filter((f) => !f.is_dir && f.name.endsWith(".md"))
          .map((f) => f.name.replace(/\.md$/, ""))
        return `可用记忆条目列表:\n${memories.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
      } catch {
        return "错误：无法列出记忆目录"
      }
    },
  }
}
