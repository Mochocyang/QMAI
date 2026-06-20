import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ContextLoadContext } from "./context-data-source"
import { writingStyleDataSource } from "./context-data-sources"

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
