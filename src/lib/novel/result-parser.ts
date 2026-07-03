export interface ChapterValidationResult {
  valid: boolean
  hasFrontmatter: boolean
  hasTitle: boolean
  hasBody: boolean
  chapterNumber?: number
  title?: string
  wordCount: number
  warnings: string[]
  errors: string[]
}

export interface OutlineValidationResult {
  valid: boolean
  hasStructure: boolean
  nodeCount: number
  warnings: string[]
  errors: string[]
}

export interface ResultProtocolTrace {
  type: "chapter" | "outline" | "memory" | "other"
  valid: boolean
  wordCount?: number
  nodeCount?: number
  hasFrontmatter?: boolean
  hasTitle?: boolean
  warnings: string[]
  errors: string[]
  validatedAt: number
}

export function validateChapterContent(content: string): ChapterValidationResult {
  const warnings: string[] = []
  const errors: string[] = []
  let hasFrontmatter = false
  let chapterNumber: number | undefined
  let title: string | undefined
  let hasTitle = false
  let hasBody = false

  const trimmed = content.trim()
  const wordCount = content.replace(/\s/g, "").length

  if (!trimmed) {
    errors.push("内容为空")
    return { valid: false, hasFrontmatter: false, hasTitle: false, hasBody: false, wordCount: 0, warnings, errors }
  }

  if (trimmed.startsWith("---")) {
    const fmEnd = trimmed.indexOf("---", 3)
    if (fmEnd > 0) {
      hasFrontmatter = true
      const fmText = trimmed.slice(3, fmEnd)
      const chNumMatch = fmText.match(/chapter_number:\s*(\d+)/)
      if (chNumMatch) {
        chapterNumber = Number(chNumMatch[1])
      }
      const titleMatch = fmText.match(/title:\s*"([^"]+)"|title:\s*'([^']+)'|title:\s*(.+)/)
      if (titleMatch) {
        title = titleMatch[1] || titleMatch[2] || titleMatch[3]
      }
    }
  }

  const bodyStart = hasFrontmatter
    ? trimmed.indexOf("---", 3) + 3
    : 0
  const body = trimmed.slice(bodyStart).trim()

  if (body) {
    hasBody = true
    const firstLine = body.split("\n")[0]?.trim() || ""
    if (/^#\s+.+/.test(firstLine) || /^第.+章.+/.test(firstLine) || /^第.+节.+/.test(firstLine)) {
      hasTitle = true
      if (!title) {
        title = firstLine.replace(/^#+\s*/, "")
      }
    }
  }

  if (!hasFrontmatter) {
    warnings.push("缺少 frontmatter 元数据")
  }
  if (!hasTitle && !title) {
    warnings.push("未检测到章节标题")
  }
  if (wordCount < 50) {
    warnings.push(`字数过少（${wordCount} 字）`)
  }
  if (wordCount > 20000) {
    warnings.push(`字数超过上限（${wordCount} 字 / 20000 字上限）`)
  }

  const valid = errors.length === 0 && hasBody

  return {
    valid,
    hasFrontmatter,
    hasTitle: hasTitle || Boolean(title),
    hasBody,
    chapterNumber,
    title,
    wordCount,
    warnings,
    errors,
  }
}

export function validateOutlineContent(content: string): OutlineValidationResult {
  const warnings: string[] = []
  const errors: string[] = []
  let hasStructure = false
  let nodeCount = 0

  const trimmed = content.trim()

  if (!trimmed) {
    errors.push("内容为空")
    return { valid: false, hasStructure: false, nodeCount: 0, warnings, errors }
  }

  const headingRegex = /^#{1,6}\s+.+$/gm
  const headings = content.match(headingRegex) || []
  nodeCount = headings.length

  if (nodeCount > 0) {
    hasStructure = true
  } else {
    warnings.push("未检测到标题结构")
  }

  if (nodeCount < 2) {
    warnings.push("大纲节点过少")
  }

  const valid = errors.length === 0 && hasStructure

  return {
    valid,
    hasStructure,
    nodeCount,
    warnings,
    errors,
  }
}

export function buildResultProtocolTrace(
  type: "chapter" | "outline",
  content: string,
): ResultProtocolTrace {
  if (type === "chapter") {
    const result = validateChapterContent(content)
    return {
      type: "chapter",
      valid: result.valid,
      wordCount: result.wordCount,
      hasFrontmatter: result.hasFrontmatter,
      hasTitle: result.hasTitle,
      warnings: result.warnings,
      errors: result.errors,
      validatedAt: Date.now(),
    }
  }

  const result = validateOutlineContent(content)
  return {
    type: "outline",
    valid: result.valid,
    nodeCount: result.nodeCount,
    warnings: result.warnings,
    errors: result.errors,
    validatedAt: Date.now(),
  }
}
