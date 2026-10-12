import { countChapterBodyWords } from "@/lib/chapter-word-count"
import { buildChapterWordCountLabel, getChapterStatusBadge, getChapterStatusLabel } from "@/lib/chapter-display"
import { parseFrontmatter } from "@/lib/frontmatter"
import { normalizeChapterStatus, type ChapterStatus } from "@/lib/novel/chapter-meta"

function getChapterTitleInputWidth(heading: string): number {
  const visualWidth = Array.from(heading).reduce((total, char) => {
    return total + (char.charCodeAt(0) > 255 ? 2 : 1)
  }, 0)
  return Math.max(visualWidth, 4)
}

export function buildChapterEditorHeader(
  markdown: string,
  options?: {
    /**
     * 该章的记忆快照是否存在。
     *
     * 给了它，标题行的状态就**以记忆为准**（用户口径「正式 = 已提取记忆」）；
     * 不传则仍按 `chapter_status`（文件里的定稿状态）。
     *
     * ⚠️ 两者是**不同的概念**，不能合并：
     *   · `chapter_status: final` 由 `handleSaveAsFinal` 写入，只表示"已标记为正式章节"；
     *     它按用户先前的要求**不**顺带提取记忆，所以「正式但无快照」是可达状态；
     *   · 快照（`.novel/snapshots/NNN.snapshot.json`）才是侧栏绿点的依据。
     *
     * 之所以做成可选参数而不是把 `status` 直接改成读快照：本函数的其它调用方
     * （以及既有的状态测试）问的是"这章的定稿状态是什么"，改掉全局语义会答非所问。
     * 由调用方声明它要哪一个口径，歧义就留在调用点上。
     */
    memoryExtracted?: boolean
  },
): {
  heading: string
  status: ChapterStatus
  statusLabel: string
  /** 标题行徽章的两个字（「正式」/「草稿」），见 getChapterStatusBadge。 */
  statusBadge: string
  wordCountLabel: string
  titleInputWidthCh: number
} {
  const { frontmatter } = parseFrontmatter(markdown)
  const match = markdown.match(/^#\s+(.+)$/m)
  const heading = match?.[1]
    ?? (typeof frontmatter?.title === "string" ? frontmatter.title.trim() : "")
  /*
   * 定稿状态先按 frontmatter 算出来（`chapter_number` 之类的字段不受影响），
   * 再由调用方决定要不要用记忆口径覆盖它。
   */
  const statusFromFrontmatter = normalizeChapterStatus(frontmatter?.chapter_status)
  const status: ChapterStatus = options?.memoryExtracted === undefined
    ? statusFromFrontmatter
    : (options.memoryExtracted ? "final" : "draft")
  const wordCount = countChapterBodyWords(markdown)
  return {
    heading,
    status,
    statusLabel: getChapterStatusLabel(status),
    statusBadge: getChapterStatusBadge(status),
    wordCountLabel: buildChapterWordCountLabel(wordCount),
    titleInputWidthCh: getChapterTitleInputWidth(heading),
  }
}
