import { describe, expect, it } from "vitest"
import { chapterSnapshotNumbersFrom, chapterSnapshotNumbersFromFileNames, resolveChapterMemoryDotState } from "./chapter-memory-dot"

const snapshots = (...numbers: number[]) => new Set(numbers)

describe("resolveChapterMemoryDotState", () => {
  it("已提取记忆的章节显示绿点", () => {
    expect(resolveChapterMemoryDotState({
      snapshotChapterNumbers: snapshots(3), chapterNumber: 3, running: false,
    })).toBe("done")
  })

  it("没有快照的章节什么都不显示", () => {
    expect(resolveChapterMemoryDotState({
      snapshotChapterNumbers: snapshots(3), chapterNumber: 4, running: false,
    })).toBe("none")
  })

  /**
   * 重新提取一章时旧快照仍在盘上：若「已提取」优先，用户点下提取后绿点纹丝不动，
   * 看起来像按钮坏了。所以提取中必须压过已提取。
   */
  it("提取中压过已提取，即使这一章早就有快照", () => {
    expect(resolveChapterMemoryDotState({
      snapshotChapterNumbers: snapshots(3), chapterNumber: 3, running: true,
    })).toBe("running")
  })

  it("提取中的章节即使从未提取过也显示提取中", () => {
    expect(resolveChapterMemoryDotState({
      snapshotChapterNumbers: snapshots(), chapterNumber: 9, running: true,
    })).toBe("running")
  })

  /**
   * 树推不出章号时（frontmatter 没有 chapter_number、标题里也没有数字）回退到文件名里的数字：
   * chapter-003.md 这种「章号只在文件名里」的章节，提取时 ingestChapter 也是这么推的。
   */
  it("树推不出章号时回退到文件名里的数字", () => {
    expect(resolveChapterMemoryDotState({
      snapshotChapterNumbers: snapshots(3), chapterNumber: undefined, fileChapterNumber: 3, running: false,
    })).toBe("done")
  })

  /**
   * 树已知章号时**不许**再退回文件名：真实作品里 chapter-015.md 的 frontmatter 是 13、
   * 文件名是 15、标题写着第 8 章。批量提取用的正是树已知的那个号，
   * 拿文件名去比对会指向另一个章号的快照。
   */
  it("树已知章号时以它为准，不回退文件名", () => {
    expect(resolveChapterMemoryDotState({
      snapshotChapterNumbers: snapshots(15), chapterNumber: 13, fileChapterNumber: 15, running: false,
    })).toBe("none")
  })

  it("两个章号来源都没有时不显示", () => {
    expect(resolveChapterMemoryDotState({
      snapshotChapterNumbers: snapshots(1, 2, 3), chapterNumber: undefined, fileChapterNumber: undefined, running: false,
    })).toBe("none")
  })

  it("章号非法（0、负数、非有限数）一律不显示，绝不误配到别的章", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveChapterMemoryDotState({
        snapshotChapterNumbers: snapshots(0, 1, 2, 3), chapterNumber: bad, running: false,
      })).toBe("none")
      expect(resolveChapterMemoryDotState({
        snapshotChapterNumbers: snapshots(0, 1, 2, 3), chapterNumber: undefined, fileChapterNumber: bad, running: false,
      })).toBe("none")
    }
  })
})

describe("chapterSnapshotNumbersFrom", () => {
  /**
   * listSnapshots 把大纲快照编码成负数（outline-001 → -1），章节是正数。
   * 若不滤掉负数，一个 outline-003 的快照会让「第 3 章」错误地亮起绿点。
   */
  it("只保留章节号，滤掉大纲的负数", () => {
    expect(chapterSnapshotNumbersFrom([-1, -312, 2, 7])).toEqual([2, 7])
  })

  it("滤掉 0 与非有限数", () => {
    expect(chapterSnapshotNumbersFrom([0, Number.NaN, Number.POSITIVE_INFINITY, 5])).toEqual([5])
  })

  it("空列表返回空", () => {
    expect(chapterSnapshotNumbersFrom([])).toEqual([])
  })
})

/*
 * 章节目录的绿点不再走 chapter-ingest 的 listSnapshots（那要先加载整个重模块），
 * 改成自己读目录名，解析规则抽到了 chapterSnapshotNumbersFromFileNames。
 * 这两条链必须给出同一组号，否则「绿点亮不亮」和「一键提取跳过谁」就会打架。
 */
describe("chapterSnapshotNumbersFromFileNames", () => {
  it("解析出章节正数号与大纲负数号，升序", () => {
    expect(chapterSnapshotNumbersFromFileNames([
      "007.snapshot.json", "002.snapshot.json", "outline-001.snapshot.json", "outline-013.snapshot.json",
    ])).toEqual([-13, -1, 2, 7])
  })

  it("只认 .snapshot.json 结尾的文件", () => {
    expect(chapterSnapshotNumbersFromFileNames([
      "003.snapshot.json", "readme.md", "004.json", "005.snapshot.json.bak",
    ])).toEqual([3])
  })

  it("解析不出数字的文件名丢掉，不产生 NaN", () => {
    expect(chapterSnapshotNumbersFromFileNames([
      "abc.snapshot.json", "outline-x.snapshot.json", "008.snapshot.json",
    ])).toEqual([8])
  })

  it("与 listSnapshots 的契约一致：喂给 chapterSnapshotNumbersFrom 后只剩章节号", () => {
    const all = chapterSnapshotNumbersFromFileNames([
      "002.snapshot.json", "outline-001.snapshot.json", "outline-002.snapshot.json",
    ])
    expect(chapterSnapshotNumbersFrom(all)).toEqual([2])
  })
})
