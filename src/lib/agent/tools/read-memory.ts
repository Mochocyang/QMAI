import type { Tool } from "../types"
import { readFile } from "@/commands/fs"

export function createReadMemoryTool(memoryDir: string): Tool {
  return {
    name: "read_memory",
    description: "读取记忆库中的指定条目内容。参数 name 为记忆条目名称。",
    category: "read",
    parameters: {
      name: { type: "string", description: "记忆条目名称", required: true },
    },
    execute: async (params) => {
      const name = params.name as string
      try {
        return await readFile(`${memoryDir}/${name}.md`)
      } catch {
        return `错误：无法读取记忆条目「${name}」，请确认文件存在`
      }
    },
  }
}
