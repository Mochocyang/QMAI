import type { Tool } from "../types"
import { listDirectory } from "@/commands/fs"

export function createListDeductionsTool(simDir: string): Tool {
  return {
    name: "list_deductions",
    description: "列出所有推演结果文件的名称列表。无需参数。",
    category: "read",
    parameters: {},
    execute: async () => {
      try {
        const files = await listDirectory(simDir)
        const deductions = files
          .filter((f) => !f.is_dir && f.name.endsWith(".json"))
          .map((f) => f.name.replace(/\.json$/, ""))
        return `可用推演结果列表:\n${deductions.map((d, i) => `${i + 1}. ${d}`).join("\n")}`
      } catch {
        return "错误：无法列出推演结果目录"
      }
    },
  }
}
