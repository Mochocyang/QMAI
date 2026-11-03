import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFile } from "@/commands/fs"
import { chapterBodyCleared, savedChapterBodyWasCleared } from "./saved-chapter-body"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
}))

const savedPath = "C:/book/wiki/chapters/chapter-020.md"
const withBody = "---\ntype: chapter\nchapter_number: 20\n---\n\n杨寒还在檐下。\n"
const emptyBody = "---\ntype: chapter\nchapter_number: 20\n---\n\n"

describe("savedChapterBodyWasCleared", () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset()
  })

  it("编辑器里的正文已经被删掉时，不等磁盘自动保存", async () => {
    vi.mocked(readFile).mockResolvedValue(withBody)
    await expect(savedChapterBodyWasCleared({
      savedPath,
      openPath: savedPath,
      openMarkdown: emptyBody,
    })).resolves.toBe(true)
    expect(readFile).not.toHaveBeenCalled()
  })

  it("编辑器里还有正文时，不允许把同一条回复再存成另一章", async () => {
    await expect(savedChapterBodyWasCleared({
      savedPath,
      openPath: savedPath,
      openMarkdown: withBody,
    })).resolves.toBe(false)
  })

  it("章节文件不在了，视为正文已删除", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("missing"))
    await expect(savedChapterBodyWasCleared({ savedPath })).resolves.toBe(true)
  })

  it("只剩标题不算还有正文", () => {
    expect(chapterBodyCleared("---\ntype: chapter\n---\n\n# 第20章\n")).toBe(true)
  })
})
