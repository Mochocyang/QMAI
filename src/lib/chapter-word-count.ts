import { parseFrontmatter } from "@/lib/frontmatter"

export function countChapterBodyWords(markdown: string): number {
  const { body } = parseFrontmatter(markdown)
  const withoutHeading = body.replace(/^#\s+.+?(?:\r?\n|$)/, "")
  const normalized = withoutHeading.replace(/[\s　]+/g, "")
  return normalized.length
}
