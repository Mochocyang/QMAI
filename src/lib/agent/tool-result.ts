export const DEFAULT_TOOL_RESULT_CONTEXT_LIMIT = 6000

export function formatToolResultForModel(
  toolName: string,
  result: string,
  limit = DEFAULT_TOOL_RESULT_CONTEXT_LIMIT,
): string {
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
