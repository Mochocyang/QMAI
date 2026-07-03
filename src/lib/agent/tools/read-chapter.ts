import type { Tool } from "../types"
import { readMarkdownResource } from "./read-markdown-resource"

export function createReadChapterTool(chaptersDir: string): Tool {
  return {
    name: "read_chapter",
    description: "读取指定章节的完整内容。参数 name 为章节名称（如「第1章-无我绝响」），或 path 为完整文件路径。",
    category: "read",
    parameters: {
      name: { type: "string", description: "章节名称，系统会自动查找对应 .md 文件" },
      path: { type: "string", description: "章节文件的完整路径（可选，与 name 二选一）" },
    },
    execute: async (params) => readMarkdownResource(chaptersDir, params, "章节"),
  }
}
