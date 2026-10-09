import type { Tool } from "../types"
import { readFile, writeFile, fileExists, createDirectory } from "@/commands/fs"
import { writeDraft } from "@/lib/novel/draft-manager"
import { useWritingStatsStore } from "@/stores/writing-stats-store"

/**
 * AI 直接写章节正文（非草稿路径）：内容整份记到「今日 AI 生成」。
 *
 * 但**只在文件此前不存在时**才是「整份」。这个工具的说明书写着「会覆盖已有文件」，
 * 覆盖一份几万字的旧稿时，把整份都算成今天 AI 新写的会严重虚报——所以覆盖前
 * 先把旧正文读出来交给记账层差分，只有真正被换掉的字才算今天产出。
 */
function recordAiChapterWrite(path: string, content: string, previousMarkdown?: string): void {
  useWritingStatsStore.getState().recordChapter(path, content, "ai", previousMarkdown)
}

interface WriteChapterOptions {
  draftMode?: boolean
  projectPath?: string
  sourceConversationId?: string
  sourceMessageId?: string
}

export function createWriteChapterTool(chaptersDir: string, options: WriteChapterOptions = {}): Tool {
  const { draftMode = false, projectPath, sourceConversationId, sourceMessageId } = options

  return {
    name: "write_chapter",
    description: draftMode
      ? "将章节内容写入草稿区，等待用户确认后保存到正式库。参数 name 为章节名称，content 为完整 Markdown 内容。"
      : "写入或更新章节内容。参数 name 为章节名称，content 为完整 Markdown 内容。会覆盖已有文件。",
    category: "write",
    permission: "confirm",
    parameters: {
      name: { type: "string", description: "章节名称（不含 .md 后缀）", required: true },
      content: { type: "string", description: "章节完整 Markdown 内容", required: true },
    },
    execute: async (params) => {
      const name = params.name as string
      const content = params.content as string

      if (!name || name.includes("/") || name.includes("\\")) {
        return `错误：无效的章节名称「${name}」`
      }

      if (draftMode && projectPath) {
        try {
          const draft = await writeDraft(projectPath, name, content, {
            sourceConversationId,
            sourceMessageId,
          })
          return `已生成章节草稿「${name}」，等待确认保存。\n草稿ID: ${draft.id}\n字数：${content.length}字`
        } catch (err) {
          return `错误：写入草稿失败 — ${err instanceof Error ? err.message : String(err)}`
        }
      }

      const path = `${chaptersDir}/${name}.md`
      try {
        const dir = chaptersDir
        if (!await fileExists(dir)) {
          await createDirectory(dir)
        }
        // 覆盖已有文件前先取旧正文：文件不存在时是 `undefined`，
        // 记账层据此判定「这是新章」，整份算 AI。
        const previousMarkdown = await readFile(path).catch(() => undefined)
        await writeFile(path, content)
        recordAiChapterWrite(path, content, previousMarkdown)
        const verified = await readFile(path)
        if (verified !== content) {
          return `已写入章节「${name}」，警告：写入后读回验证失败，请手动检查文件内容。`
        }
        return `已写入章节「${name}」，读回验证通过。`
      } catch (err) {
        return `错误：写入章节失败 — ${err instanceof Error ? err.message : String(err)}`
      }
    },
  }
}
