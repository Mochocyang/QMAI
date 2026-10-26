import { beforeEach, describe, expect, it, vi } from "vitest"

const versionMocks = vi.hoisted(() => ({ saveVersion: vi.fn(), pruneVersions: vi.fn() }))
vi.mock("@/lib/novel/version-store", () => versionMocks)

import { snapshotChapterBeforeSave } from "./chapter-save-version"

describe("编辑器保存章节前留版本", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    versionMocks.saveVersion.mockResolvedValue({ saved: true })
    versionMocks.pruneVersions.mockResolvedValue(0)
  })

  it("用文件名里的章节号作为 key", async () => {
    await snapshotChapterBeforeSave({
      projectPath: "C:/书", path: "C:/书/wiki/chapters/第12章.md", previousContent: "旧正文",
    })
    expect(versionMocks.saveVersion).toHaveBeenCalledWith({
      projectPath: "C:/书", kind: "chapter", key: 12, content: "旧正文",
    })
  })

  it("文件名没有数字时 key 为 null", async () => {
    await snapshotChapterBeforeSave({
      projectPath: "C:/书", path: "C:/书/wiki/chapters/序章.md", previousContent: "旧正文",
    })
    expect(versionMocks.saveVersion).toHaveBeenCalledWith(expect.objectContaining({ key: null }))
  })

  it("旧内容是空白时不留版本", async () => {
    await snapshotChapterBeforeSave({
      projectPath: "C:/书", path: "C:/书/wiki/chapters/第1章.md", previousContent: "   ",
    })
    expect(versionMocks.saveVersion).not.toHaveBeenCalled()
  })

  it("留版本失败不抛错（不能挡住保存）", async () => {
    versionMocks.saveVersion.mockRejectedValue(new Error("磁盘满了"))
    await expect(snapshotChapterBeforeSave({
      projectPath: "C:/书", path: "C:/书/wiki/chapters/第1章.md", previousContent: "旧正文",
    })).resolves.toBeUndefined()
  })

  it("成功后顺手清理旧版本", async () => {
    await snapshotChapterBeforeSave({
      projectPath: "C:/书", path: "C:/书/wiki/chapters/第3章.md", previousContent: "旧正文",
    })
    expect(versionMocks.pruneVersions).toHaveBeenCalledWith("C:/书", "chapter", 3)
  })
})
