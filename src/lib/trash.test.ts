import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanupExpiredTrashItems,
  moveFileToTrash,
  restoreTrashItem,
} from "./trash"
vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  createDirectory: vi.fn(),
  deleteFile: vi.fn(),
  fileExists: vi.fn(),
  listDirectory: vi.fn(),
  copyDirectory: vi.fn(),
}))

import {
  copyDirectory,
  createDirectory,
  deleteFile,
  fileExists,
  listDirectory,
  readFile,
  writeFile,
} from "@/commands/fs"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockDeleteFile = vi.mocked(deleteFile)
const mockFileExists = vi.mocked(fileExists)
const mockListDirectory = vi.mocked(listDirectory)
const mockCopyDirectory = vi.mocked(copyDirectory)

const projectPath = "E:/Novel"
const chapterPath = "E:/Novel/wiki/chapters/001.md"
const now = Date.UTC(2026, 4, 20, 8, 30, 0)

beforeEach(() => {
  vi.restoreAllMocks()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockCreateDirectory.mockReset()
  mockDeleteFile.mockReset()
  mockFileExists.mockReset()
  mockListDirectory.mockReset()
  mockCopyDirectory.mockReset()
  // 默认视为"非目录"（isDirectory 通过 listDirectory 抛错判断）；目录测试单独覆盖
  mockListDirectory.mockRejectedValue(new Error("not a directory"))
  vi.spyOn(Math, "random").mockReturnValue(0.123456)
})

describe("trash", () => {
  it("删除文件时写入回收站文件和记录，并删除原文件", async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === chapterPath) return "# 第1章"
      if (path === "E:/Novel/.trash/items.json") throw new Error("missing")
      throw new Error(`unexpected read ${path}`)
    })

    const item = await moveFileToTrash(projectPath, chapterPath, "chapter", now)

    expect(item.name).toBe("001.md")
    expect(item.originalPath).toBe(chapterPath)
    expect(item.trashPath).toBe("E:/Novel/.trash/files/20260520-083000-4fzyo8.md")
    expect(item.expiresAt).toBe(now + 30 * 24 * 60 * 60 * 1000)
    expect(mockCreateDirectory).toHaveBeenCalledWith("E:/Novel/.trash")
    expect(mockCreateDirectory).toHaveBeenCalledWith("E:/Novel/.trash/files")
    expect(mockWriteFile).toHaveBeenCalledWith(item.trashPath, "# 第1章")
    expect(mockWriteFile).toHaveBeenCalledWith(
      "E:/Novel/.trash/items.json",
      JSON.stringify([item], null, 2),
    )
    expect(mockDeleteFile).toHaveBeenCalledWith(chapterPath)
  })

  it("恢复时原路径无冲突则恢复到原路径并移除回收站记录", async () => {
    const item = {
      id: "20260520-083000-4fzyo8",
      name: "001.md",
      originalPath: chapterPath,
      trashPath: "E:/Novel/.trash/files/20260520-083000-4fzyo8.md",
      deletedAt: now,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
      kind: "chapter" as const,
    }
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === "E:/Novel/.trash/items.json") return JSON.stringify([item])
      if (path === item.trashPath) return "# 第1章"
      throw new Error(`unexpected read ${path}`)
    })
    mockFileExists.mockResolvedValue(false)

    const result = await restoreTrashItem(projectPath, item.id, now)

    expect(result.restoredPath).toBe(chapterPath)
    expect(result.renamed).toBe(false)
    expect(mockCreateDirectory).toHaveBeenCalledWith("E:/Novel/wiki/chapters")
    expect(mockWriteFile).toHaveBeenCalledWith(chapterPath, "# 第1章")
    expect(mockDeleteFile).toHaveBeenCalledWith(item.trashPath)
    expect(mockWriteFile).toHaveBeenCalledWith("E:/Novel/.trash/items.json", "[]")
  })

  it("恢复章节时原路径冲突则按章节标题改名且不覆盖现有文件", async () => {
    const item = {
      id: "20260520-083000-4fzyo8",
      name: "001.md",
      originalPath: chapterPath,
      trashPath: "E:/Novel/.trash/files/20260520-083000-4fzyo8.md",
      deletedAt: now,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
      kind: "chapter" as const,
    }
    const trashedContent = [
      "---",
      "type: chapter",
      "title: \"第1章 马皇后\"",
      "chapter_number: 1",
      "---",
      "",
      "# 第1章 马皇后",
    ].join("\n")
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === "E:/Novel/.trash/items.json") return JSON.stringify([item])
      if (path === item.trashPath) return trashedContent
      throw new Error(`unexpected read ${path}`)
    })
    mockFileExists.mockImplementation(async (path: string) => path === chapterPath)

    const result = await restoreTrashItem(projectPath, item.id, now)

    expect(result.restoredPath).toBe("E:/Novel/wiki/chapters/第1章-马皇后.md")
    expect(result.renamed).toBe(true)
    expect(mockWriteFile).toHaveBeenCalledWith(result.restoredPath, trashedContent)
    expect(mockWriteFile).not.toHaveBeenCalledWith(chapterPath, trashedContent)
  })

  it("清理过期记录时只永久删除超过30天的回收站文件", async () => {
    const expired = {
      id: "expired",
      name: "旧章.md",
      originalPath: "E:/Novel/wiki/chapters/old.md",
      trashPath: "E:/Novel/.trash/files/expired.md",
      deletedAt: now - 31 * 24 * 60 * 60 * 1000,
      expiresAt: now - 1,
      kind: "chapter" as const,
    }
    const active = {
      id: "active",
      name: "新章.md",
      originalPath: "E:/Novel/wiki/chapters/new.md",
      trashPath: "E:/Novel/.trash/files/active.md",
      deletedAt: now,
      expiresAt: now + 1,
      kind: "chapter" as const,
    }
    mockReadFile.mockResolvedValue(JSON.stringify([expired, active]))

    const result = await cleanupExpiredTrashItems(projectPath, now)

    expect(result.deletedCount).toBe(1)
    expect(mockDeleteFile).toHaveBeenCalledWith(expired.trashPath)
    expect(mockDeleteFile).not.toHaveBeenCalledWith(active.trashPath)
    expect(mockWriteFile).toHaveBeenLastCalledWith(
      "E:/Novel/.trash/items.json",
      JSON.stringify([active], null, 2),
    )
  })

  it("删除目录（如故事导图）时整目录移入回收站且不保留扩展名", async () => {
    const dirPath = "E:/Novel/拆书库/作品A/story-maps/story-map-1756100000000"
    mockListDirectory.mockResolvedValue([])
    mockCopyDirectory.mockResolvedValue([
      `${dirPath}/story-map.json`,
      `${dirPath}/story-map.html`,
    ])

    const item = await moveFileToTrash(projectPath, dirPath, "storymap", now)

    expect(item.name).toBe("story-map-1756100000000")
    expect(item.trashPath).toBe("E:/Novel/.trash/files/20260520-083000-4fzyo8")
    expect(item.kind).toBe("storymap")
    expect(mockListDirectory).toHaveBeenCalledWith(dirPath)
    expect(mockCopyDirectory).toHaveBeenCalledWith(dirPath, item.trashPath)
    expect(mockWriteFile).not.toHaveBeenCalledWith(
      item.trashPath,
      expect.any(String),
    )
    expect(mockDeleteFile).toHaveBeenCalledWith(dirPath)
  })

  it("恢复目录时整目录复制回原位置并移除回收站记录", async () => {
    const dirPath = "E:/Novel/拆书库/作品A/story-maps/story-map-1756100000000"
    const trashDir = "E:/Novel/.trash/files/20260520-083000-4fzyo8"
    const item = {
      id: "20260520-083000-4fzyo8",
      name: "story-map-1756100000000",
      originalPath: dirPath,
      trashPath: trashDir,
      deletedAt: now,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
      kind: "storymap" as const,
    }
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === "E:/Novel/.trash/items.json") return JSON.stringify([item])
      throw new Error(`unexpected read ${path}`)
    })
    mockListDirectory.mockResolvedValue([])
    mockFileExists.mockResolvedValue(false)

    const result = await restoreTrashItem(projectPath, item.id, now)

    expect(result.restoredPath).toBe(dirPath)
    expect(result.renamed).toBe(false)
    expect(mockCreateDirectory).toHaveBeenCalledWith(
      "E:/Novel/拆书库/作品A/story-maps",
    )
    expect(mockCopyDirectory).toHaveBeenCalledWith(trashDir, dirPath)
    expect(mockDeleteFile).toHaveBeenCalledWith(trashDir)
    expect(mockWriteFile).toHaveBeenLastCalledWith(
      "E:/Novel/.trash/items.json",
      "[]",
    )
  })
})
