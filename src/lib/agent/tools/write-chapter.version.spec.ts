import { beforeEach, describe, expect, it, vi } from "vitest"

const versionMocks = vi.hoisted(() => ({
  saveVersion: vi.fn(),
  pruneVersions: vi.fn(),
}))
vi.mock("@/lib/novel/version-store", () => versionMocks)

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  fileExists: vi.fn(),
  createDirectory: vi.fn(),
}))
vi.mock("@/commands/fs", () => fsMocks)
vi.mock("@/lib/novel/draft-manager", () => ({ writeDraft: vi.fn() }))
vi.mock("@/stores/writing-stats-store", () => ({
  useWritingStatsStore: { getState: () => ({ recordChapter: vi.fn() }) },
}))

import { createWriteChapterTool } from "./write-chapter"

describe("AI 覆盖章节前留历史版本", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    versionMocks.saveVersion.mockResolvedValue({ saved: true })
    versionMocks.pruneVersions.mockResolvedValue(0)
    fsMocks.createDirectory.mockResolvedValue(undefined)
    fsMocks.writeFile.mockResolvedValue(undefined)
    fsMocks.fileExists.mockResolvedValue(true)
  })

  it("文件已存在时，先把旧正文存成历史版本", async () => {
    fsMocks.readFile.mockImplementation(async (path: string) =>
      path.endsWith("第1章.md") ? "旧的正文" : "旧的正文",
    )

    const tool = createWriteChapterTool("/书/wiki/chapters", { projectPath: "/书" })
    await tool.execute({ name: "第1章", content: "新的正文" })

    expect(versionMocks.saveVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: "/书",
        kind: "chapter",
        key: 1,
        content: "旧的正文",
      }),
    )
  })

  it("落版本之后会顺手清理旧版本（不阻塞写入）", async () => {
    fsMocks.readFile.mockResolvedValue("旧的正文")
    const tool = createWriteChapterTool("/书/wiki/chapters", { projectPath: "/书" })
    await tool.execute({ name: "第1章", content: "新的正文" })

    expect(versionMocks.pruneVersions).toHaveBeenCalledWith("/书", "chapter", 1)
  })

  it("新文件不产生历史版本（没东西可回退）", async () => {
    fsMocks.fileExists.mockResolvedValue(false)
    fsMocks.readFile.mockRejectedValue(new Error("ENOENT"))

    const tool = createWriteChapterTool("/书/wiki/chapters", { projectPath: "/书" })
    await tool.execute({ name: "第1章", content: "新的正文" })

    expect(versionMocks.saveVersion).not.toHaveBeenCalled()
  })

  it("没有 projectPath 时安全跳过", async () => {
    fsMocks.readFile.mockResolvedValue("旧的正文")
    const tool = createWriteChapterTool("/书/wiki/chapters", {})
    await tool.execute({ name: "第1章", content: "新的正文" })
    expect(versionMocks.saveVersion).not.toHaveBeenCalled()
  })

  it("落版本失败也不能挡住这次写入", async () => {
    fsMocks.readFile.mockResolvedValue("旧的正文")
    versionMocks.saveVersion.mockRejectedValue(new Error("磁盘满了"))

    const tool = createWriteChapterTool("/书/wiki/chapters", { projectPath: "/书" })
    const result = await tool.execute({ name: "第1章", content: "新的正文" })

    expect(fsMocks.writeFile).toHaveBeenCalled()
    expect(String(result)).toContain("第1章")
  })

  it("章节名里没有数字时 key 传 null", async () => {
    fsMocks.readFile.mockResolvedValue("旧的正文")
    const tool = createWriteChapterTool("/书/wiki/chapters", { projectPath: "/书" })
    await tool.execute({ name: "序章", content: "新的正文" })

    expect(versionMocks.saveVersion).toHaveBeenCalledWith(
      expect.objectContaining({ key: null }),
    )
  })
})
