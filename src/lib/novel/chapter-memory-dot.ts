/**
 * 章节目录里「是否已提取记忆」那枚小圆点的判定。
 *
 * 为什么不看 frontmatter：章节记忆提取**不往章节文件写任何标记**
 * （`chapter-ingest.ts` 只落 `.novel/snapshots/NNN.snapshot.json`），
 * 所以「已提取」的唯一依据就是该章号的快照文件存在。
 *
 * 单独抽成纯函数是因为它有两条容易写错的分支：章号有两个来源、
 * 以及「提取中」与「已提取」的优先级。放在这里可以被直接单测，
 * 而不是只能靠断言组件源码里出现过某个字符串。
 */

export type ChapterMemoryDotState = "done" | "running" | "none"

export interface ResolveChapterMemoryDotStateInput {
  /** `listSnapshots` 的结果（只含章节正数号），来自盘上现状。 */
  snapshotChapterNumbers: ReadonlySet<number>
  /**
   * 树已知的章号：frontmatter 的 chapter_number，退一步是标题里的数字。
   * 批量提取时 `ingestChapter` 收到的就是这个号，所以它优先。
   */
  chapterNumber?: number
  /**
   * 文件名里的数字。只在树推不出章号时才用：
   * `chapter-003.md` 这种「章号只写在文件名里」的章节，`ingestChapter`
   * 自己也是回退到文件名取号的，不回退就会漏报一枚本该亮的绿点。
   */
  fileChapterNumber?: number
  /** 该章是否正在提取中（由运行中的章节提取任务按路径判定）。 */
  running: boolean
}

/**
 * 「提取中」压过「已提取」：重新提取一章时旧快照仍在盘上，
 * 若已提取优先，用户点下提取后绿点纹丝不动，看起来像按钮坏了。
 */
export function resolveChapterMemoryDotState(input: ResolveChapterMemoryDotStateInput): ChapterMemoryDotState {
  if (input.running) return "running"
  // 树已知章号时**不许**再退回文件名：真实作品里 chapter-015.md 的 frontmatter 是 13、
  // 文件名是 15、标题写着第 8 章。批量提取用的是树已知的那个号，
  // 拿文件名去比对会指向另一个章号的快照，从而给出错误的绿点。
  const number = input.chapterNumber ?? input.fileChapterNumber
  // 章号非法时返回 none，绝不落进「集合里有 0」这类误配。
  if (typeof number !== "number" || !Number.isFinite(number) || number <= 0) return "none"
  return input.snapshotChapterNumbers.has(number) ? "done" : "none"
}

/**
 * `listSnapshots` 把大纲快照编码成负数（`outline-001` → -1），章节是正数。
 * 不滤掉负数的话，一个 `outline-003` 的大纲快照会让「第 3 章」错误地亮起绿点。
 */
export function chapterSnapshotNumbersFrom(snapshotNumbers: readonly number[]): number[] {
  return snapshotNumbers.filter((number) => Number.isFinite(number) && number > 0)
}

/**
 * `.novel/snapshots` 目录里的文件名 → 快照号（大纲是负数，章节是正数），升序。
 *
 * 这是 `listSnapshots` 的解析部分，单独抽出来是为了让**只需要这几个数字**的调用方
 * （章节目录的绿点）不必再去动态 import `chapter-ingest` 这个重模块。
 * 那条懒加载路径看起来省了首屏，实际代价是：目录第一次渲染时绿点要等整个
 * chapter-ingest 模块图加载完才亮，而它本来只是读一个目录名列表。
 * 两者解析规则必须完全一致，所以 `listSnapshots` 现在也调用这个函数。
 */
export function chapterSnapshotNumbersFromFileNames(fileNames: readonly string[]): number[] {
  return fileNames
    .filter((name) => name.endsWith(".snapshot.json"))
    .map((name) => {
      const stem = name.split(".")[0]
      // outline-001 → -1, outline-002 → -2
      const outlineMatch = stem.match(/^outline-(\d+)$/)
      if (outlineMatch) return -parseInt(outlineMatch[1], 10)
      return parseInt(stem, 10)
    })
    .filter((number) => !Number.isNaN(number))
    .sort((left, right) => left - right)
}
