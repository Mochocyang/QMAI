import type { Tool } from "../types"
import { writeFile } from "@/commands/fs"

export function createWriteMemoryTool(memoryDir: string): Tool {
  return {
    name: "write_memory",
    description: "写入或更新记忆条目。参数 name 为记忆名称，content 为记忆内容。",
    category: "write",
    parameters: {
      name: { type: "string", description: "记忆条目名称", required: true },
      content: { type: "string", description: "记忆内容", required: true },
    },
    execute: async (params) => {
      const name = params.name as string
      const content = params.content as string
      try {
        await writeFile(`${memoryDir}/${name}.md`, content)
        return `已写入记忆「${name}」`
      } catch (err) {
        return `错误：写入记忆失败 — ${err instanceof Error ? err.message : String(err)}`
      }
    },
  }
}
