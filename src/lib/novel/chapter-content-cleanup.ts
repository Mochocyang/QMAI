import { isThoughtDumpText, stripThoughtDumpFromText } from "@/lib/thought-dump"

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

/** 完成通知类伪标题（如「第 32 章正文已按章纲重写完成。」）不得当作章名。 */
const CHAPTER_TITLE_STATUS_RE = /(?:完成|重写|已按|生成|工作流)/

/**
 * 判断一行是否像真实章节标题（「第N章 查分夜」），而不是完成通知。
 * 要求「第N章」后有分隔与短标题名，且不含完成态动词簇。
 */
export function isPlausibleChapterTitleLine(line: string): boolean {
  const trimmed = line.trim().replace(/^#{1,6}\s*/, "")
  const match = trimmed.match(/^第\s*\d+\s*章(?:\s*[：:\-—–]?\s*|\s+)(.+)$/)
  if (!match?.[1]) return false
  const name = match[1].trim()
  if (!name || name.length > 40) return false
  if (CHAPTER_TITLE_STATUS_RE.test(name)) return false
  return true
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
  if (!isPlausibleChapterTitleLine(firstLine)) {
    return { lines, title: null }
  }

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

/**
 * 独占一行的正文标签，如「正文：」「以下是本章正文」「【正文】」「**正文**」。
 * 必须整行匹配，避免误删以「正文」开头的叙述句。
 */
const LEADING_BODY_LABEL_RE =
  /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*[【[]?\s*(?:以下(?:是|为)\s*)?(?:本章)?正文(?:如下)?\s*[\]】]?\s*[：:]?\s*(?:\*\*|__)?$/

/** 剥掉开头的正文标签行（含其后空行）。 */
function stripLeadingBodyLabel(lines: string[]): string[] {
  let index = 0

  while (index < lines.length && !lines[index].trim()) index += 1

  while (index < lines.length && LEADING_BODY_LABEL_RE.test(lines[index].trim())) {
    index += 1
    while (index < lines.length && !lines[index].trim()) index += 1
  }

  return index > 0 ? lines.slice(index) : lines
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

  // 标签也可能出现在章节标题之后，例如「第240章 归零 / 正文：」。
  return stripLeadingBodyLabel(lines.slice(index))
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

interface CleanedChapterContent {
  content: string
  title: string | null
}

function cleanChapterContentCore(
  content: string,
  options: { dropTrailingOffer: boolean },
): CleanedChapterContent {
  const withoutThoughtDump = stripThoughtDumpFromText(content)
  const withoutThinking = stripThinkingBlocks(withoutThoughtDump).replace(/\r\n?/g, "\n")
  const withoutCitations = stripCitationSyntax(withoutThinking)
  // 标签先剥，否则「正文：」挡在前面会让章节标题识别不到。
  const allLines = stripLeadingBodyLabel(withoutCitations.split("\n"))
  const { lines: linesWithoutTitle, title } = extractLeadingTitle(allLines)
  const strippedLines = stripLeadingMeta(linesWithoutTitle)
  const cleanedLines = options.dropTrailingOffer
    ? stripTrailingAssistantOffer(strippedLines)
    : strippedLines

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
 * 清理生成的章节内容，同时提取标题。
 * 返回对象包含：
 * - content: 清理后的纯正文（移除已提取的标题行）
 * - title: 提取到的标题文字（如 "第3章 初入江湖"），如果没有则为 null
 */
export function cleanGeneratedChapterContentWithTitle(content: string): CleanedChapterContent {
  return cleanChapterContentCore(content, { dropTrailingOffer: true })
}

/**
 * 清理章节正文用于会话内展示：与保存共用同一套剥离规则，但
 * - 保留开头的章节标题行（保存路径会把标题拆成独立字段）；
 * - 不做结尾「要不要我继续」裁剪，避免正文里的对白被当成助手话术截断。
 */
export function cleanGeneratedChapterContentForDisplay(content: string): string {
  const { content: body, title } = cleanChapterContentCore(content, { dropTrailingOffer: false })
  if (!body.trim()) {
    // Thought dumps must not bounce back as the chapter bubble.
    if (isThoughtDumpText(content) || !stripThoughtDumpFromText(content).trim()) {
      return ""
    }
    return content.trim()
  }
  if (!title) return body
  // 章节草稿要求首行是「# 第X章 标题」，按原样保留标题行的 Markdown 形态。
  const originalTitleLine = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.replace(/^#{1,6}\s*/, "") === title)
  return `${originalTitleLine ?? title}\n\n${body}`
}

/**
 * 清理生成的章节内容用于保存。
 * 保持向后兼容：返回纯字符串（去掉标题行）。
 */
export function cleanGeneratedChapterContentForSave(content: string): string {
  return cleanGeneratedChapterContentWithTitle(content).content
}
