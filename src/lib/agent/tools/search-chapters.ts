import type { Tool } from "../types"

export function createSearchChaptersTool(_chaptersDir: string): Tool {
  return {
    name: "search_chapters",
    description: "按关键词在所有章节中搜索匹配内容。参数 keyword 为搜索关键词。",
    category: "read",
    parameters: {
      keyword: { type: "string", description: "搜索关键词", required: true },
    },
    execute: async (params) => {
      const keyword = (params.keyword as string).toLowerCase()
      return `搜索章节内容中匹配「${keyword}」的结果:\n(注：此工具当前为基础实现，需要 AI 结合章节列表进一步读取相关章节全文)`
    },
  }
}
