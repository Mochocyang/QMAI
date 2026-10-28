/**
 * 删除大纲时必须连 `.html` / `.json` 一起删掉（用户 2026-10-28 报的重大缺陷）：
 * 只删 `.md` 会让 AI 继续通过目录扫描读到残留的 HTML/JSON 内容。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

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
  cleanupExpiredTrashItems,
  moveFileToTrash,
  permanentlyDeleteTrashItem,
  restoreTrashItem,
} from "./trash"

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
const outlinePath = "E:/Novel/wiki/outlines/卷纲/卷纲-第01卷.md"
const outlineHtml = "E:/Novel/wiki/outlines/卷纲/卷纲-第01卷.html"
const outlineJson = "E:/Novel/wiki/outlines/卷纲/卷纲-第01卷.json"
const now = Date.UTC(2026, 9, 28, 4, 0, 0)

/** 用一个内存文件表模拟磁盘。 */
function fakeDisk(files: Record<string, string>) {
  const disk = new Map(Object.entries(files))
  mockReadFile.mockImplementation(async (path: string) => {
    if (!disk.has(path)) throw new Error(`ENOENT ${path}`)
    return disk.get(path) as string
  })
  mockWriteFile.mockImplementation(async (path: string, contents: string) => {
    disk.set(path, contents)
  })
  mockDeleteFile.mockImplementation(async (path: string) => {
    if (!disk.delete(path)) throw new Error(`ENOENT ${path}`)
  })
  mockFileExists.mockImplementation(async (path: string) => disk.has(path))
  return disk
}

beforeEach(() => {
  vi.restoreAllMocks()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockCreateDirectory.mockReset()
  mockDeleteFile.mockReset()
  mockFileExists.mockReset()
  mockListDirectory.mockReset()
  mockCopyDirectory.mockReset()
  // 成员都不是目录（isDirectory 靠 listDirectory 抛错判断）
  mockListDirectory.mockRejectedValue(new Error("not a directory"))
  vi.spyOn(Math, "random").mockReturnValue(0.42)
})

describe("删除大纲时连伴生文件一起处理", () => {
  it("删除 .md 会把 .html 与 .json 一起移入回收站并删除原文件", async () => {
    const disk = fakeDisk({
      [outlinePath]: "# 卷一 残灯有火",
      [outlineHtml]: "<!DOCTYPE html><html><body>旧网页</body></html>",
      [outlineJson]: '{"title":"卷一"}',
    })

    const item = await moveFileToTrash(projectPath, outlinePath, "outline", now)

    // 三个原文件都不在了
    expect(disk.has(outlinePath)).toBe(false)
    expect(disk.has(outlineHtml)).toBe(false)
    expect(disk.has(outlineJson)).toBe(false)

    // 伴生文件进了回收站，并记录了原始路径
    expect(item.companions?.map((entry) => entry.originalPath).sort()).toEqual(
      [outlineHtml, outlineJson].sort(),
    )
    for (const companion of item.companions ?? []) {
      expect(disk.has(companion.trashPath)).toBe(true)
    }
  })

  it("没有伴生文件时保持原行为（不写 companions 字段）", async () => {
    fakeDisk({ [outlinePath]: "# 只有正文" })
    const item = await moveFileToTrash(projectPath, outlinePath, "outline", now)
    expect(item.companions).toBeUndefined()
  })

  it("还原时把伴生文件一起放回原位", async () => {
    const disk = fakeDisk({
      [outlinePath]: "# 卷一",
      [outlineHtml]: "<html><body>网页</body></html>",
      [outlineJson]: '{"a":1}',
      "E:/Novel/.trash/items.json": "[]",
    })
    const item = await moveFileToTrash(projectPath, outlinePath, "outline", now)

    // 还原前把记录写进索引，restoreTrashItem 会重新读盘
    disk.set("E:/Novel/.trash/items.json", JSON.stringify([item]))
    const result = await restoreTrashItem(projectPath, item.id, now + 1000)

    expect(result.restoredPath).toBe(outlinePath)
    expect(disk.get(outlinePath)).toBe("# 卷一")
    expect(disk.get(outlineHtml)).toContain("网页")
    expect(disk.get(outlineJson)).toBe('{"a":1}')
  })

  it("永久删除会连伴生文件的回收站副本一起清掉", async () => {
    const disk = fakeDisk({
      [outlinePath]: "# 卷一",
      [outlineHtml]: "<html></html>",
      [outlineJson]: "{}",
      "E:/Novel/.trash/items.json": "[]",
    })
    const item = await moveFileToTrash(projectPath, outlinePath, "outline", now)
    disk.set("E:/Novel/.trash/items.json", JSON.stringify([item]))

    await permanentlyDeleteTrashItem(projectPath, item.id)

    expect(disk.has(item.trashPath)).toBe(false)
    for (const companion of item.companions ?? []) {
      expect(disk.has(companion.trashPath)).toBe(false)
    }
  })

  it("过期清理同样清掉伴生副本", async () => {
    const disk = fakeDisk({
      [outlinePath]: "# 卷一",
      [outlineHtml]: "<html></html>",
      "E:/Novel/.trash/items.json": "[]",
    })
    const item = await moveFileToTrash(projectPath, outlinePath, "outline", now)
    disk.set("E:/Novel/.trash/items.json", JSON.stringify([item]))

    const result = await cleanupExpiredTrashItems(projectPath, now + 31 * 24 * 60 * 60 * 1000)

    expect(result.deletedCount).toBe(1)
    for (const companion of item.companions ?? []) {
      expect(disk.has(companion.trashPath)).toBe(false)
    }
  })
})
