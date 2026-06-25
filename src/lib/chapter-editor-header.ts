import { countChapterBodyWords } from "@/lib/chapter-word-count"
import { buildChapterWordCountLabel, getChapterStatusLabel } from "@/lib/chapter-display"
import { parseFrontmatter } from "@/lib/frontmatter"
import { normalizeChapterStatus, type ChapterStatus } from "@/lib/novel/chapter-meta"

function getChapterTitleInputWidth(heading: string): number {
  const visualWidth = Array.from(heading).reduce((total, char) => {
    return total + (char.charCodeAt(0) > 255 ? 2 : 1)
  }, 0)
  return Math.max(visualWidth, 4)
}

export function buildChapterEditorHeader(markdown: string): {
  heading: string
  status: ChapterStatus
  statusLabel: string
  wordCountLabel: string
  titleInputWidthCh: number
} {
  const { frontmatter } = parseFrontmatter(markdown)
  const match = markdown.match(/^#\s+(.+)$/m)
  const heading = match?.[1]
    ?? (typeof frontmatter?.title === "string" ? frontmatter.title.trim() : "")
  const status = normalizeChapterStatus(frontmatter?.chapter_status)
  const wordCount = countChapterBodyWords(markdown)
  return {
    heading,
    status,
    statusLabel: getChapterStatusLabel(status),
    wordCountLabel: buildChapterWordCountLabel(wordCount),
    titleInputWidthCh: getChapterTitleInputWidth(heading),
  }
}
