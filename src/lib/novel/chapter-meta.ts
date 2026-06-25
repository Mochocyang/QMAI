import yaml from "js-yaml"
import { parseFrontmatter } from "@/lib/frontmatter"

export type ChapterStatus = "outline" | "draft" | "revised" | "final" | "archived"
export type OutlineType = "chapter-outline" | "volume-outline" | "story-outline"

export interface ChapterMeta {
  chapterNumber: number
  status: ChapterStatus
  outlineType?: OutlineType
}

export function parseChapterMeta(frontmatter: Record<string, unknown>): ChapterMeta | null {
  const chapterNumber = parseChapterNumber(frontmatter.chapter_number)
  if (chapterNumber === null) return null
  const status = normalizeChapterStatus(frontmatter.chapter_status)
  const outlineType = validateOutlineType(frontmatter.outline_type)
  return { chapterNumber, status, outlineType }
}

export function parseChapterNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function normalizeChapterStatus(value: unknown): ChapterStatus {
  const valid = ["outline", "draft", "revised", "final", "archived"]
  if (typeof value === "string" && valid.includes(value)) return value as ChapterStatus
  return "draft"
}

function validateOutlineType(value: unknown): OutlineType | undefined {
  if (value === "chapter-outline" || value === "volume-outline" || value === "story-outline") return value
  return undefined
}

export function isChapterPage(frontmatter: Record<string, unknown>): boolean {
  return frontmatter.type === "chapter" || parseChapterNumber(frontmatter.chapter_number) !== null
}

export function isOutlinePage(frontmatter: Record<string, unknown>): boolean {
  return frontmatter.type === "outline" || typeof frontmatter.outline_type === "string"
}

export function isFinalChapter(frontmatter: Record<string, unknown>): boolean {
  return normalizeChapterStatus(frontmatter.chapter_status) === "final"
}

export function updateChapterStatus(content: string, status: ChapterStatus): string {
  const { frontmatter, body } = parseFrontmatter(content)
  const nextFrontmatter: Record<string, unknown> = {
    ...(frontmatter ?? {}),
    chapter_status: status,
  }

  const yamlPayload = yaml.dump(nextFrontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  }).trimEnd()

  return `---\n${yamlPayload}\n---\n\n${body.replace(/^\s*/, "")}`
}
