import type { Tool } from "../types"
import { readFile } from "@/commands/fs"

export function createReadDeductionTool(simDir: string): Tool {
  return {
    name: "read_deduction",
    description: "读取推演室的推演结果或故事框架内容。参数 name 为推演结果名称。",
    category: "read",
    parameters: {
      name: { type: "string", description: "推演结果名称", required: true },
    },
    execute: async (params) => {
      const name = params.name as string
      try {
        return await readFile(`${simDir}/${name}.json`)
      } catch {
        return `错误：无法读取推演结果「${name}」`
      }
    },
  }
}
