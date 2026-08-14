const TOOL_ERROR_PREFIX = /^\s*错误\s*[：:]/

export const DEFAULT_TOOL_RESULT_CONTEXT_LIMIT = 10000

/**
 * 这些工具的返回值就是给用户的交付物（章节终稿），不是给模型当「证据摘录」的资料。
 * 头尾截断会先切掉任务书、丢掉正文中段，外层模型只能按残片另写一章。
 */
const FULL_TOOL_RESULT_FOR_MODEL = new Set(["run_chapter_workflow"])

export function isToolErrorResult(result: string): boolean {
  return TOOL_ERROR_PREFIX.test(result)
}

export function keepsFullToolResultForModel(toolName: string): boolean {
  return FULL_TOOL_RESULT_FOR_MODEL.has(toolName)
}

export function formatToolResultForModel(
  toolName: string,
  result: string,
  limit = DEFAULT_TOOL_RESULT_CONTEXT_LIMIT,
): string {
  if (keepsFullToolResultForModel(toolName)) return result
  if (result.length <= limit) return result

  const safeLimit = Math.max(200, limit)
  const header = `工具 ${toolName} 返回内容较长，已压缩给模型使用。原始长度：${result.length} 字。`
  const bodyLimit = Math.max(120, safeLimit - header.length - 80)
  const headLength = Math.floor(bodyLimit * 0.6)
  const tailLength = Math.max(60, bodyLimit - headLength)
  const head = result.slice(0, headLength).trim()
  const tail = result.slice(-tailLength).trim()

  return [
    header,
    "",
    "## 开头片段",
    head,
    "",
    "## 结尾片段",
    tail,
  ].join("\n")
}
