import type { Tool } from "../types"
import { readFile } from "@/commands/fs"

export function createReadDeductionTool(simDir: string): Tool {
  return {
    name: "read_deduction",
    description: "读取推演室的推演结果或故事框架内容。参数 name 为推演结果名称，或 path 为完整文件路径。",
    category: "read",
    parameters: {
      name: { type: "string", description: "推演结果名称" },
      path: { type: "string", description: "推演室文件完整路径（可选，与 name 二选一）" },
    },
    execute: async (params) => {
      const name = params.name as string | undefined
      const path = params.path as string | undefined
      const filePath = path || `${simDir}/${name}.json`
      try {
        return await readFile(filePath)
      } catch {
        return `错误：无法读取推演室内容「${name || path}」`
      }
    },
  }
}
