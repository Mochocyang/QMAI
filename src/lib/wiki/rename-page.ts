import { fileExists } from "@/commands/fs"
import {
  extractChapterNumberFromContent,
  extractPageOrderFromTitle,
} from "@/lib/novel/chapter-utils"
import { makeChapterFileName, makeDefaultChapterTitle, makeSafeFileSlug } from "@/lib/wiki-filename"

export interface RenameSibling {
  path: string
  title: string
  type: "chapter" | "outline"
  chapterNumber?: number | null
}

export interface PageRenamePlan {
  status: "unchanged" | "rejected" | "ready"
  message?: string
  content?: string
  fileName?: string
  normalizedTitle?: string
}

export function updatePageTitleContent(content: string, newTitle: string, newChapterNumber?: number | null): string {
  const escapedTitle = newTitle.replace(/"/g, '\\"')
  let next = content
  const frontmatterMatch = next.match(/^---\n([\s\S]*?)\n---/)
  if (frontmatterMatch) {
    let frontmatterBody = frontmatterMatch[1]
    if (/^title:\s*.*$/m.test(frontmatterBody)) {
      frontmatterBody = frontmatterBody.replace(/^title:\s*.*$/m, `title: "${escapedTitle}"`)
    } else {
      frontmatterBody = `${frontmatterBody}\ntitle: "${escapedTitle}"`
    }
    if (typeof newChapterNumber === "number" && newChapterNumber > 0) {
      if (/^chapter_number:\s*.*$/m.test(frontmatterBody)) {
        frontmatterBody = frontmatterBody.replace(/^chapter_number:\s*.*$/m, `chapter_number: ${newChapterNumber}`)
      } else {
        frontmatterBody = `${frontmatterBody}\nchapter_number: ${newChapterNumber}`
      }
    }
    next = next.replace(/^---\n[\s\S]*?\n---/, `---\n${frontmatterBody}\n---`)
  }
  if (/^#\s+.+$/m.test(next)) {
    next = next.replace(/^#\s+.+$/m, `# ${newTitle}`)
  }
  return next
}

export function planPageRename(input: {
  path: string
  nextTitle: string
  content: string
  type: "chapter" | "outline"
  currentTitle: string
  siblings: RenameSibling[]
}): PageRenamePlan {
  const newTitle = input.nextTitle.trim()
  if (!newTitle || input.currentTitle === newTitle) return { status: "unchanged" }

  const duplicate = input.siblings.some((page) => (
    page.path !== input.path && page.type === input.type && page.title.trim() === newTitle
  ))
  if (duplicate) return { status: "rejected", message: "已有同名文件" }

  const oldChapterNumber = extractChapterNumberFromContent(input.content) ?? extractPageOrderFromTitle(input.currentTitle)
  const userChapterNumber = extractPageOrderFromTitle(newTitle)
  const chapterNumber = input.type === "chapter" && userChapterNumber !== null
    ? userChapterNumber
    : oldChapterNumber
  const chapterNumberConflict = input.type === "chapter"
    && typeof chapterNumber === "number"
    && input.siblings.some((page) => (
      page.path !== input.path
      && page.type === "chapter"
      && page.chapterNumber === chapterNumber
    ))
  if (chapterNumberConflict) return { status: "rejected", message: "章节号与已有章节冲突" }

  const normalizedTitle = input.type === "chapter" && chapterNumber
    ? makeDefaultChapterTitle(chapterNumber, newTitle)
    : newTitle
  return {
    status: "ready",
    content: updatePageTitleContent(input.content, normalizedTitle, input.type === "chapter" ? chapterNumber : null),
    fileName: input.type === "chapter"
      ? makeChapterFileName(normalizedTitle, chapterNumber)
      : `${makeSafeFileSlug(newTitle)}.md`,
    normalizedTitle,
  }
}

export async function allocateUniqueSiblingPath(
  dir: string,
  fileName: string,
  excludePath: string | undefined,
  exists: (path: string) => Promise<boolean> = fileExists,
): Promise<string> {
  const firstPath = `${dir}/${fileName}`
  if (firstPath === excludePath || !(await exists(firstPath))) return firstPath

  const extensionIndex = fileName.lastIndexOf(".")
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ""
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${dir}/${stem}-${index}${extension}`
    if (candidate === excludePath || !(await exists(candidate))) return candidate
  }
  return `${dir}/${stem}-${Date.now()}${extension}`
}
