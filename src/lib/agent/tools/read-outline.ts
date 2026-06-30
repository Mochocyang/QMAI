import type { Tool } from "../types"
import { readFile } from "@/commands/fs"

export function createReadOutlineTool(outlinesDir: string): Tool {
  return {
    name: "read_outline",
    description: "读取指定大纲文件的完整内容。参数 path 为大纲文件的完整路径，或 name 为大纲名称。",
    category: "read",
    parameters: {
      name: { type: "string", description: "大纲名称" },
      path: { type: "string", description: "大纲文件完整路径（可选，与 name 二选一）" },
    },
    execute: async (params) => {
      const name = params.name as string | undefined
      const path = params.path as string | undefined
      const filePath = path || `${outlinesDir}/${name}.md`
      try {
        return await readFile(filePath)
      } catch {
        return `错误：无法读取大纲「${name || path}」，请确认文件存在`
      }
    },
  }
}
