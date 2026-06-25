import { beforeEach, describe, expect, it, vi } from "vitest"
import { backupChapterFile } from "./chapter-backup"

const fsMocks = vi.hoisted(() => ({
  createDirectory: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}))

vi.mock("@/commands/fs", () => ({
  createDirectory: fsMocks.createDirectory,
  writeFile: fsMocks.writeFile,
}))

describe("backupChapterFile", () => {
  beforeEach(() => {
    fsMocks.createDirectory.mockClear()
    fsMocks.writeFile.mockClear()
  })

  it("writes backups into .qmai/chapter-backups with a timestamped chapter name", async () => {
    const backupPath = await backupChapterFile({
      projectPath: "E:/Novel",
      chapterPath: "E:/Novel/wiki/chapters/第1章.md",
      chapterNumber: 1,
      content: "原始章节内容",
      now: new Date("2026-06-09T15:30:12.000Z"),
    })

    expect(fsMocks.createDirectory).toHaveBeenCalledWith("E:/Novel/.qmai/chapter-backups")
    expect(backupPath).toBe("E:/Novel/.qmai/chapter-backups/chapter-001-20260609-153012.md")
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "E:/Novel/.qmai/chapter-backups/chapter-001-20260609-153012.md",
      "原始章节内容",
    )
  })

  it("surfaces write failures so callers can block overwrite", async () => {
    fsMocks.writeFile.mockRejectedValueOnce(new Error("disk full"))

    await expect(backupChapterFile({
      projectPath: "E:/Novel",
      chapterPath: "E:/Novel/wiki/chapters/第1章.md",
      chapterNumber: 1,
      content: "原始章节内容",
      now: new Date("2026-06-09T15:30:12.000Z"),
    })).rejects.toThrow("disk full")
  })
})
