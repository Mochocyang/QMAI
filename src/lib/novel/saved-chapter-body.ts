import { readFile } from "@/commands/fs"
import { countChapterBodyWords } from "@/lib/chapter-word-count"
import { normalizePath } from "@/lib/path-utils"

/** 去掉 frontmatter 和章节标题后，正文是否已经一个字都不剩。 */
export function chapterBodyCleared(markdown: string): boolean {
  return countChapterBodyWords(markdown) === 0
}

export function sameChapterPath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right)
}

/**
 * 这条消息上次保存进去的章节，现在还能不能再存一次。
 *
 * 编辑器里正在打开的那一份优先于磁盘：自动保存要等几分钟，
 * 用户刚把正文删掉时磁盘上往往还是旧稿。文件读不到视为已经不在。
 */
export async function savedChapterBodyWasCleared(input: {
  savedPath: string
  openPath?: string | null
  openMarkdown?: string | null
}): Promise<boolean> {
  if (input.openPath && sameChapterPath(input.openPath, input.savedPath)) {
    return chapterBodyCleared(input.openMarkdown ?? "")
  }
  try {
    return chapterBodyCleared(await readFile(input.savedPath))
  } catch {
    return true
  }
}
