import { describe, expect, it } from "vitest"
import { chapterOrdersFromTree, isLatestDraftReopen, resolveDraftMemoryHint, type DraftMemoryHintArrival } from "./draft-memory-hint"

function hint(overrides: Partial<Parameters<typeof resolveDraftMemoryHint>[0]> = {}) {
  return resolveDraftMemoryHint({
    isChapter: true,
    status: "draft",
    wordCount: 12,
    arrival: "select",
    dismissed: false,
    extracting: false,
    enabled: true,
    latestAlreadyHinted: false,
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

  it("再次点开已经提示过的最新草稿章不再显示，停留中的提示不因此收起", () => {
    expect(hint({ arrival: "select", latestAlreadyHinted: true, currentlyVisible: false })).toBe(false)
    expect(hint({ arrival: "select", latestAlreadyHinted: true, currentlyVisible: true })).toBe(true)
    expect(hint({ arrival: "first-save", latestAlreadyHinted: false })).toBe(true)
  })

  it("只有再次打开全书最新章才算已经提示过", () => {
    expect(isLatestDraftReopen({ chapterNumber: 5, maxChapterNumber: 5, hintedLatestChapter: 5 })).toBe(true)
    expect(isLatestDraftReopen({ chapterNumber: 4, maxChapterNumber: 5, hintedLatestChapter: 5 })).toBe(false)
    expect(isLatestDraftReopen({ chapterNumber: 5, maxChapterNumber: 5, hintedLatestChapter: null })).toBe(false)
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
