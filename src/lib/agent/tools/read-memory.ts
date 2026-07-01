import type { Tool } from "../types"
import { readFile } from "@/commands/fs"

export function createReadMemoryTool(memoryDir: string): Tool {
  return {
    name: "read_memory",
    description: "读取记忆库中的指定条目内容。参数 name 为记忆条目名称，或 path 为完整文件路径。",
    category: "read",
    parameters: {
      name: { type: "string", description: "记忆条目名称" },
      path: { type: "string", description: "记忆文件的完整路径（可选，与 name 二选一）" },
    },
    execute: async (params) => {
      const name = params.name as string | undefined
      const path = params.path as string | undefined
      const filePath = path || `${memoryDir}/${name}.md`
      try {
        return await readFile(filePath)
      } catch {
        return `错误：无法读取记忆条目「${name || path}」，请确认文件存在`
      }
    },
  }
}
