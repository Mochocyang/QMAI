import { parseFrontmatter } from "./frontmatter"

export interface OutlineSaveDraft {
  title: string
  content: string
}

const DEFAULT_TITLE_PREFIX = "AI大纲"

export function prepareOutlineSaveDraft(content: string, existingTitles: string[]): OutlineSaveDraft {
  const parsed = parseFrontmatter(content)
  const body = normalizeOutlineMarkdown(parsed.body).trim()
  const baseTitle = sanitizeOutlineTitle(extractOutlineTitle(body))
  const title = makeDistinctOutlineTitle(baseTitle, existingTitles)
  return { title, content: body }
}

export function normalizeOutlineMarkdown(content: string): string {
  return content
    .replace(/```(?:markdown|md)\s*\r?\n([\s\S]*?)\r?\n```/gi, (_, inner: string) => inner.trim())
    .replace(/^\\(#{1,6}\s)/gm, "$1")
    .replace(/^\\([-*+]\s)/gm, "$1")
    .replace(/^\\(>\s)/gm, "$1")
    .replace(/^\\(\d+\.\s)/gm, "$1")
    .replace(/\\([*_`[\]])/g, "$1")
}

function extractOutlineTitle(content: string): string {
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean)
  for (const line of lines.slice(0, 8)) {
    const headingMatch = line.match(/^#+\s+(.+)/)
    if (headingMatch) return headingMatch[1].trim()
    if (
      line.length > 2 &&
      line.length < 40 &&
      !line.startsWith("-") &&
      !line.startsWith("*") &&
      !line.includes(":")
    ) {
      return line
    }
  }
  return `${DEFAULT_TITLE_PREFIX}-${new Date().toISOString().slice(0, 10)}`
}

function sanitizeOutlineTitle(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|#`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24)
  return cleaned || `${DEFAULT_TITLE_PREFIX}-${new Date().toISOString().slice(0, 10)}`
}

function makeDistinctOutlineTitle(title: string, existingTitles: string[]): string {
  const existing = new Set(existingTitles.map((item) => item.trim()).filter(Boolean))
  if (!existing.has(title)) return title

  const first = `${title}-AI生成`
  if (!existing.has(first)) return first

  for (let index = 2; index <= 99; index++) {
    const candidate = `${first}-${index}`
    if (!existing.has(candidate)) return candidate
  }
  return `${first}-${Date.now()}`
}
