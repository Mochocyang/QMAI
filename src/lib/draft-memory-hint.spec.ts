import { describe, expect, it } from "vitest"
import { chapterHasLaterChapter, chapterOrdersFromTree, resolveDraftMemoryHint, type DraftMemoryHintArrival } from "./draft-memory-hint"

function hint(overrides: Partial<Parameters<typeof resolveDraftMemoryHint>[0]> = {}) {
  return resolveDraftMemoryHint({
    isChapter: true,
    status: "draft",
    wordCount: 12,
    arrival: "select",
    dismissed: false,
    extracting: false,
    enabled: true,
    bookHintSeen: false,
    hasLaterChapter: false,
    currentlyVisible: false,
    ...overrides,
  })
}

describe("草稿提取记忆提示", () => {
  it("点进已有正文的草稿章会显示", () => {
    expect(hint({ arrival: "select" })).toBe(true)
  })

  it("空正文第一次保存成功后显示", () => {
    expect(hint({ arrival: "first-save" as DraftMemoryHintArrival, wordCount: 8 })).toBe(true)
    expect(hint({ arrival: "first-save", wordCount: 0 })).toBe(false)
  })

  it("同一章后续保存不重新打开已关掉的提示", () => {
    expect(hint({ arrival: "stay", currentlyVisible: false })).toBe(false)
    expect(hint({ arrival: "stay", currentlyVisible: true })).toBe(true)
  })

  it("正式章节、非章节、已关闭和提取中都不显示", () => {
    expect(hint({ status: "final" })).toBe(false)
    expect(hint({ status: "revised" })).toBe(false)
    expect(hint({ isChapter: false })).toBe(false)
    expect(hint({ dismissed: true })).toBe(false)
    expect(hint({ extracting: true })).toBe(false)
    expect(hint({ enabled: false })).toBe(false)
  })

  it("这本书已经提示过后，再点开没有更大章号的草稿不显示", () => {
    expect(hint({ bookHintSeen: true, hasLaterChapter: false, arrival: "select" })).toBe(false)
    expect(hint({ bookHintSeen: true, hasLaterChapter: false, arrival: "first-save" })).toBe(false)
  })

  it("这本书已经提示过后，点开仍是草稿且后面已有章节会显示", () => {
    expect(hint({ bookHintSeen: true, hasLaterChapter: true, arrival: "select" })).toBe(true)
    expect(hint({ bookHintSeen: true, hasLaterChapter: true, arrival: "first-save" })).toBe(false)
  })

  it("同一次打开里记下本书已提示后，正在显示的提示不收起", () => {
    expect(hint({ bookHintSeen: true, hasLaterChapter: false, arrival: "select", currentlyVisible: true })).toBe(true)
  })

  it("后面已有章节只比较更大章号", () => {
    expect(chapterHasLaterChapter(4, [4, 5])).toBe(true)
    expect(chapterHasLaterChapter(5, [4, 5])).toBe(false)
    expect(chapterHasLaterChapter(null, [5])).toBe(false)
  })

  it("从章节目录里取出章号", () => {
    expect(chapterOrdersFromTree([
      {
        name: "第一卷",
        path: "C:/book/wiki/chapters/第一卷",
        is_dir: true,
        children: [
          { name: "第4章.md", path: "C:/book/wiki/chapters/第一卷/第4章.md", is_dir: false },
          { name: "第5章-标题.md", path: "C:/book/wiki/chapters/第一卷/第5章-标题.md", is_dir: false },
        ],
      },
      { name: "笔记.md", path: "C:/book/wiki/notes/笔记.md", is_dir: false },
    ])).toEqual([4, 5])
  })
})
