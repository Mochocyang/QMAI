import type { Tool } from "../types"
import { readFile, writeFile, fileExists } from "@/commands/fs"

export function createWriteMemoryTool(memoryDir: string): Tool {
  return {
    name: "write_memory",
    description: "写入或更新记忆条目。参数 name 为记忆名称，content 为记忆内容。",
    category: "write",
    permission: "confirm",
    parameters: {
      name: { type: "string", description: "记忆条目名称", required: true },
      content: { type: "string", description: "记忆内容", required: true },
    },
    generatePreview: async (params) => {
      const name = params.name as string
      const content = params.content as string
      const path = `${memoryDir}/${name}.md`
      let isNew = true
      try {
        if (await fileExists(path)) {
          isNew = false
        }
      } catch {}
      if (isNew) {
        return `将新建记忆「${name}」\n\n预览：\n${content}`
      } else {
        return `将更新记忆「${name}」\n\n预览：\n${content}\n原记忆将被覆盖。`
      }
    },
    execute: async (params) => {
      const name = params.name as string
      const content = params.content as string
      const path = `${memoryDir}/${name}.md`
      try {
        await writeFile(path, content)
        const verified = await readFile(path)
        if (verified !== content) {
          return `已写入记忆「${name}」，警告：写入后读回验证失败，请手动检查文件内容。`
        }
        return `已写入记忆「${name}」，读回验证通过。`
      } catch (err) {
        return `错误：写入记忆失败 — ${err instanceof Error ? err.message : String(err)}`
      }
    },
  }
}
