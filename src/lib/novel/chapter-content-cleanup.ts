function stripThinkingBlocks(content: string): string {
  let result = content
  // 1. 移除完整的 <think>...</think> 或 <thinking>...</thinking> 块
  result = result.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")

  // 2. 移除未闭合的开头思考块（有 <think> 但没有 </think>）
  result = result.replace(/<think(?:ing)?>[\s\S]*$/gi, "")

  // 3. 移除只有结尾标签的情况：如果内容开头到第一个 </think> 之间没有 <think> 开头标签，
  //    说明思考内容直接输出在了正文前面，需要一并移除
  const firstCloseIndex = result.search(/<\/think(?:ing)?>/i)
  if (firstCloseIndex >= 0) {
    const beforeClose = result.slice(0, firstCloseIndex)
    if (!/<think(?:ing)?>/i.test(beforeClose)) {
      // 前面没有开头标签，把开头到第一个结尾标签都删掉
      result = result.replace(/^[\s\S]*?<\/think(?:ing)?>\s*/i, "")
    }
  }

  return result
}

/**
 * 从内容开头提取章节标题，并返回清理后的行数组和提取到的标题。
 * 标题格式：# 第X章 标题名 或 第X章 标题名
 * 如果没有提取到标题，title 返回 null。
 */
function extractLeadingTitle(lines: string[]): { lines: string[]; title: string | null } {
  let index = 0

  // 跳过开头空行
  while (index < lines.length && !lines[index].trim()) index += 1

  const firstLine = lines[index]?.trim() ?? ""

  // 匹配 # 第X章 标题 格式
  const headingMatch = firstLine.match(/^#{1,6}\s*(第\s*\d+\s*章.*)$/)
  if (headingMatch?.[1]) {
    const title = headingMatch[1].trim()
    index += 1
    // 跳过标题后的空行
    while (index < lines.length && !lines[index].trim()) index += 1
    return { lines: lines.slice(index), title }
  }

  // 匹配 第X章 标题 格式（没有 # 号）
  const plainMatch = firstLine.match(/^(第\s*\d+\s*章.*)$/)
  if (plainMatch?.[1]) {
    const title = plainMatch[1].trim()
    index += 1
    // 跳过标题后的空行
    while (index < lines.length && !lines[index].trim()) index += 1
    return { lines: lines.slice(index), title }
  }

  return { lines, title: null }
}

function stripLeadingMeta(lines: string[]): string[] {
  let index = 0

  while (index < lines.length && !lines[index].trim()) index += 1

  // 旧行为：删除开头的 # 第N章 标题行
  // 保留这个行为以保持向后兼容
  if (/^#{1,6}\s*第\s*\d+\s*章/.test(lines[index]?.trim() ?? "")) {
    index += 1
  }

  while (index < lines.length && !lines[index].trim()) index += 1

  while (/^>\s*/.test(lines[index]?.trim() ?? "")) {
    index += 1
  }

  while (index < lines.length && !lines[index].trim()) index += 1

  if (/^[-*_]{3,}$/.test(lines[index]?.trim() ?? "")) {
    index += 1
  }

  return lines.slice(index)
}

function stripTrailingAssistantOffer(lines: string[]): string[] {
  const offerIndex = lines.findIndex((line) =>
    /(如果你愿意|我也可以|需要的话).*(继续|下一章|第\s*\d+\s*章|为你写)/.test(line),
  )
  return offerIndex >= 0 ? lines.slice(0, offerIndex) : lines
}

function stripCitationSyntax(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\[\d+\]:\s+.*$/gm, "")
    .replace(/\[\[[^\]]+?\]\]\s*\[\d+\]/g, "")
    .replace(/\[\[[^\]]+?\]\]/g, "")
    .replace(/\[(?:\d+(?:\s*,\s*\d+)*)\]/g, "")
}

export interface CleanedChapterContent {
  content: string
  title: string | null
}

/**
 * 清理生成的章节内容，同时提取标题。
 * 返回对象包含：
 * - content: 清理后的纯正文（移除已提取的标题行）
 * - title: 提取到的标题文字（如 "第3章 初入江湖"），如果没有则为 null
 */
export function cleanGeneratedChapterContentWithTitle(content: string): CleanedChapterContent {
  const withoutThinking = stripThinkingBlocks(content).replace(/\r\n?/g, "\n")
  const withoutCitations = stripCitationSyntax(withoutThinking)
  const allLines = withoutCitations.split("\n")
  const { lines: linesWithoutTitle, title } = extractLeadingTitle(allLines)
  const cleanedLines = stripTrailingAssistantOffer(stripLeadingMeta(linesWithoutTitle))

  const cleanedContent = cleanedLines
    .join("\n")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .replace(/\s+([，。！？；：、,.!?;:])/g, "$1")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")

  const finalContent = cleanedContent
    .split("\n")
    .filter((line, index, all) => {
      if (line.trim()) return true
      const hasBefore = all.slice(0, index).some((item) => item.trim())
      const hasAfter = all.slice(index + 1).some((item) => item.trim())
      return hasBefore && hasAfter
    })
    .join("\n")

  return {
    content: finalContent,
    title,
  }
}

/**
 * 清理生成的章节内容用于保存。
 * 保持向后兼容：返回纯字符串（去掉标题行）。
 */
export function cleanGeneratedChapterContentForSave(content: string): string {
  return cleanGeneratedChapterContentWithTitle(content).content
}
