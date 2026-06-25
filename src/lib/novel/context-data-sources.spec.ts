import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ContextLoadContext } from "./context-data-source"
import { recentChapterContentsDataSource, writingStyleDataSource } from "./context-data-sources"

const mocks = vi.hoisted(() => ({
  buildWritingStyleContext: vi.fn(),
  readFile: vi.fn(),
  searchWiki: vi.fn(),
}))

vi.mock("./writing-style-store", () => ({
  buildWritingStyleContext: mocks.buildWritingStyleContext,
}))

vi.mock("@/commands/fs", () => ({
  readFile: mocks.readFile,
}))

vi.mock("@/lib/search", () => ({
  searchWiki: mocks.searchWiki,
}))

vi.mock("@/lib/web-fs", () => ({
  getWebFs: () => ({
    readFile: mocks.readFile,
  }),
}))

vi.mock("@/lib/http-adapter", () => ({
  httpProject: {},
  httpFs: {},
  httpClip: {},
  httpBackup: {},
  httpCli: {},
  httpSync: {},
  httpVector: {},
}))

const context: ContextLoadContext = {
  projectPath: "E:/Novel",
  task: "生成第三章正文",
  chapterNumber: 3,
  config: {
    recentSummaryWindow: 8,
    searchTopK: 5,
    snapshotLookback: 3,
    revisionFeedbackWindowConfig: {},
  },
}

describe("writingStyleDataSource", () => {
  beforeEach(() => {
    mocks.buildWritingStyleContext.mockReset()
    mocks.readFile.mockReset()
    mocks.searchWiki.mockReset()
  })

  it("优先读取当前启用的拆书库文风", async () => {
    mocks.buildWritingStyleContext.mockResolvedValue("目标文风来源：《长夜书》\n风格硬约束：冷峻克制")
    mocks.searchWiki.mockResolvedValue([{ path: "E:/Novel/wiki/style.md" }])
    mocks.readFile.mockResolvedValue("旧 wiki 风格")

    const result = await writingStyleDataSource.load(context)

    expect(result).toContain("目标文风来源：《长夜书》")
    expect(result).toContain("冷峻克制")
    expect(mocks.searchWiki).not.toHaveBeenCalled()
    expect(mocks.readFile).not.toHaveBeenCalled()
  })

  it("没有启用拆书库文风时回退读取 wiki 风格页", async () => {
    mocks.buildWritingStyleContext.mockResolvedValue("")
    mocks.searchWiki.mockResolvedValue([{ path: "E:/Novel/wiki/style.md" }])
    mocks.readFile.mockResolvedValue("wiki 中的写作风格")

    const result = await writingStyleDataSource.load(context)

    expect(result).toBe("wiki 中的写作风格")
    expect(mocks.searchWiki).toHaveBeenCalled()
    expect(mocks.readFile).toHaveBeenCalledWith("E:/Novel/wiki/style.md")
  })
})

describe("recentChapterContentsDataSource", () => {
  beforeEach(() => {
    mocks.readFile.mockReset()
    mocks.searchWiki.mockReset()
  })

  it("按最近章节数量窗口读取目标章节之前的章节正文片段", async () => {
    const chapterContext: ContextLoadContext = {
      ...context,
      chapterNumber: 6,
      config: {
        ...context.config,
        recentSummaryWindow: 5,
      },
    }
    mocks.searchWiki.mockImplementation(async (_projectPath: string, query: string) => {
      const matched = query.match(/chapter_number:(\d+)/)
      return matched ? [{ path: `E:/Novel/wiki/chapters/chapter-${matched[1]}.md` }] : []
    })
    mocks.readFile.mockImplementation(async (path: string) => {
      const matched = path.match(/chapter-(\d+)\.md$/)
      const number = matched?.[1] ?? "0"
      return `---\ntype: chapter\nchapter_number: ${number}\nstatus: final\n---\n第${number}章正文开头\n第${number}章正文关键事实\n第${number}章正文结尾`
    })

    const result = await recentChapterContentsDataSource.load(chapterContext)

    expect(result).toHaveLength(5)
    expect(result[0]).toContain("第1章正文关键事实")
    expect(result[4]).toContain("第5章正文结尾")
    expect(mocks.searchWiki).toHaveBeenCalledWith("E:/Novel", "chapter_number:1")
    expect(mocks.searchWiki).toHaveBeenCalledWith("E:/Novel", "chapter_number:5")
  })

  it("长章节正文片段保留开头和结尾，避免只读取章节开头", async () => {
    const chapterContext: ContextLoadContext = {
      ...context,
      chapterNumber: 2,
      config: {
        ...context.config,
        recentSummaryWindow: 1,
      },
    }
    mocks.searchWiki.mockResolvedValue([{ path: "E:/Novel/wiki/chapters/chapter-1.md" }])
    mocks.readFile.mockResolvedValue(`---\ntype: chapter\nchapter_number: 1\nstatus: final\n---\n开头事实${"中段".repeat(4000)}结尾事实`)

    const result = await recentChapterContentsDataSource.load(chapterContext)

    expect(result).toHaveLength(1)
    expect(result[0]).toContain("开头事实")
    expect(result[0]).toContain("结尾事实")
    expect(result[0]).toContain("章节正文中段已按上下文预算省略")
  })
})
