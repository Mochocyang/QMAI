import { parseFrontmatter } from "@/lib/frontmatter"

function withSingleTrailingNewline(value: string): string {
  const trimmed = value.trim()
  return trimmed ? `${trimmed}\n` : ""
}

export function stripOutlineFrontmatter(content: string): string {
  return withSingleTrailingNewline(parseFrontmatter(content).body)
}

export function buildPureOutlineMarkdown(title: string, content: string): string {
  const body = stripOutlineFrontmatter(content).trim()
  if (/^#\s+\S/m.test(body) && body.match(/^#\s+\S/m)?.index === 0) {
    return `${body}\n`
  }

  const cleanTitle = title.trim()
  if (!cleanTitle) return body ? `${body}\n` : ""
  return body ? `# ${cleanTitle}\n\n${body}\n` : `# ${cleanTitle}\n`
}
