import type { Tool } from "../types"
import { readFile } from "@/commands/fs"
import {
  buildOutlineListToolResult,
  listOutlineEntries,
} from "./outline-list-helpers"

interface ListOutlinesToolOptions {
  readTextFile?: (path: string) => Promise<string>
  /** 模型未传 chapterNumber 时的默认目标章号（通常来自当前任务路由） */
  getDefaultChapterNumber?: () => number | undefined
}

function parseChapterNumberParam(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw)
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const n = Number.parseInt(raw.trim(), 10)
    return n > 0 ? n : undefined
  }
  return undefined
}

export function createListOutlinesTool(
  outlinesDir: string,
  readTextFileOrOptions: ((path: string) => Promise<string>) | ListOutlinesToolOptions = readFile,
): Tool {
  const options: ListOutlinesToolOptions =
    typeof readTextFileOrOptions === "function"
      ? { readTextFile: readTextFileOrOptions }
      : readTextFileOrOptions
  const readTextFile = options.readTextFile ?? readFile

  return {
    name: "list_outlines",
    description:
      "列出大纲目录下全部 Markdown 文件（含子目录），优先标注标准文件夹（大纲/卷纲/章纲/设定等），旧 frontmatter 的 type / outline_type 仅作兼容附加。可选参数 chapterNumber 用于在结果中标注本次目标章号。写章节前应先调用本工具，再按文件夹分流并用 read_outline 读正文判断哪份对应该章。",
    category: "read",
    parameters: {
      chapterNumber: {
        type: "number",
        description: "本次要写的目标章号（可选）。传入后会在列表末尾标注，便于对照正文找纲。",
      },
    },
    execute: async (params) => {
      try {
        const chapterNumber =
          parseChapterNumberParam(params.chapterNumber) ?? options.getDefaultChapterNumber?.()

        const entries = await listOutlineEntries(outlinesDir, readTextFile)
        return buildOutlineListToolResult(entries, chapterNumber)
      } catch {
        return "错误：无法列出大纲目录"
      }
    },
  }
}
