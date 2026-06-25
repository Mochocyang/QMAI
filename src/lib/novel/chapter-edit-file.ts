import { parseFrontmatter } from "@/lib/frontmatter"

export function normalizeChapterEditFile(input: {
  content: string
  targetChapterNumber: number
  /**
   * 章节文件的原始内容。模型返回的修改稿经常只有正文、没有
   * frontmatter（编辑提示词本身只要求输出正文），此时自动沿用
   * 原文件的 frontmatter，而不是拒绝写回（issue #10）。
   */
  originalContent?: string
}): { ok: true; content: string } | { ok: false; message: string } {
  const normalized = stripModelWrapping(input.content, input.targetChapterNumber)
  const parsed = parseFrontmatter(normalized)

  let frontmatterFields = parsed.frontmatter
  let body = parsed.body.trim()

  if (!frontmatterFields) {
    // 模型没有返回 frontmatter：优先沿用原章节文件的 frontmatter，
    // 原文件也没有时按章节库默认格式补一份，保证修改稿不丢失。
    const original = input.originalContent ? parseFrontmatter(input.originalContent) : null
    frontmatterFields = original?.frontmatter ?? {
      type: "chapter",
      chapter_number: String(input.targetChapterNumber),
      chapter_status: "draft",
      title: `第${input.targetChapterNumber}章`,
    }
    body = normalized.trim()
  }

  if (!body) {
    return {
      ok: false,
      message: `第${input.targetChapterNumber}章返回内容缺少正文，已停止写回。`,
    }
  }

  const correctedTitle = `第${input.targetChapterNumber}章`
  const frontmatter = {
    ...frontmatterFields,
    chapter_number: String(input.targetChapterNumber),
    title: correctedTitle,
  }

  const frontmatterLines = Object.entries(frontmatter).map(([key, value]) => {
    const safeValue = String(value ?? "")
    return key === "title" ? `${key}: "${safeValue.replace(/"/g, '\\"')}"` : `${key}: ${safeValue}`
  })

  // 正文缺少标题行时自动补一行章节标题，而不是拒绝写回。
  const hasHeading = /^#\s+.+$/m.test(body)
  const correctedBody = hasHeading
    ? body.replace(/^#\s+.+$/m, `# ${correctedTitle}`)
    : `# ${correctedTitle}\n\n${body}`

  return {
    ok: true,
    content: `---\n${frontmatterLines.join("\n")}\n---\n\n${correctedBody}\n`,
  }
}

/**
 * 剥离模型输出常见的包装：
 * - 整段包在 ``` / ```markdown 代码围栏里
 * - 按编辑提示词格式输出的【第N章】标记行
 */
function stripModelWrapping(content: string, targetChapterNumber: number): string {
  let normalized = content.replace(/\r\n?/g, "\n").trim()

  const fenceMatch = normalized.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/)
  if (fenceMatch?.[1]) {
    normalized = fenceMatch[1].trim()
  }

  normalized = normalized
    .replace(new RegExp(`^【第${targetChapterNumber}章(?:原文)?】\\s*\\n?`), "")
    .replace(/^【第\d+章(?:原文)?】\s*\n?/, "")
    .trim()

  return normalized
}
