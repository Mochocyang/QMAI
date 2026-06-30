import type { Tool } from "../types"
import { writeFile } from "@/commands/fs"

export function createWriteChapterTool(chaptersDir: string): Tool {
  return {
    name: "write_chapter",
    description: "写入或更新章节内容。参数 name 为章节名称，content 为完整 Markdown 内容。会覆盖已有文件。",
    category: "write",
    parameters: {
      name: { type: "string", description: "章节名称（不含 .md 后缀）", required: true },
      content: { type: "string", description: "章节完整 Markdown 内容", required: true },
    },
    execute: async (params) => {
      const name = params.name as string
      const content = params.content as string
      if (!name.includes("/") && !name.includes("\\")) {
        try {
          await writeFile(`${chaptersDir}/${name}.md`, content)
          return `已写入章节「${name}」`
        } catch (err) {
          return `错误：写入章节失败 — ${err instanceof Error ? err.message : String(err)}`
        }
      }
      return `错误：无效的章节名称「${name}」`
    },
  }
}
