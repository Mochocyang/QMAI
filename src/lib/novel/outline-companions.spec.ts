/**
 * 伴生文件（.html / .json）的路径推导与搬移。
 *
 * 这些函数是「删大纲留下孤儿 HTML/JSON」缺陷的修复基础：
 * - 删除走回收站（trash.ts）；
 * - 改名/移动走这里的 moveOutlineCompanions；
 * - 直接清理走 deleteOutlineCompanions。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  fileExists: vi.fn(),
}))

import {
  OUTLINE_COMPANION_EXTENSIONS,
  deleteOutlineCompanions,
  moveOutlineCompanions,
  outlineCompanionPaths,
} from "./outline-companions"

import { deleteFile, fileExists, readFile, writeFile } from "@/commands/fs"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockDeleteFile = vi.mocked(deleteFile)
const mockFileExists = vi.mocked(fileExists)

const mdPath = "E:/Novel/wiki/outlines/卷纲/卷纲-第01卷.md"

beforeEach(() => {
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockDeleteFile.mockReset()
  mockFileExists.mockReset()
})

describe("outlineCompanionPaths", () => {
  it("由 .md 推出 .html 与 .json", () => {
    expect(outlineCompanionPaths(mdPath)).toEqual([
      "E:/Novel/wiki/outlines/卷纲/卷纲-第01卷.html",
      "E:/Novel/wiki/outlines/卷纲/卷纲-第01卷.json",
    ])
    expect(OUTLINE_COMPANION_EXTENSIONS).toEqual(["html", "json"])
  })

  it("反斜杠路径归一化后再推导", () => {
    expect(outlineCompanionPaths("E:\\Novel\\wiki\\outlines\\a.md")[0]).toBe(
      "E:/Novel/wiki/outlines/a.html",
    )
  })

  it("非 .md 文件没有伴生文件", () => {
    expect(outlineCompanionPaths("E:/Novel/wiki/outlines/a.html")).toEqual([])
  })
})

describe("deleteOutlineCompanions", () => {
  it("只删存在的伴生文件，返回删除个数", async () => {
    mockFileExists.mockImplementation(async (path: string) => path.endsWith(".html"))
    mockDeleteFile.mockResolvedValue(undefined)

    const deleted = await deleteOutlineCompanions(mdPath)

    expect(deleted).toBe(1)
    expect(mockDeleteFile).toHaveBeenCalledTimes(1)
    expect(mockDeleteFile).toHaveBeenCalledWith("E:/Novel/wiki/outlines/卷纲/卷纲-第01卷.html")
  })

  it("删除失败不抛出（删主文件不能被伴生文件拖住）", async () => {
    mockFileExists.mockResolvedValue(true)
    mockDeleteFile.mockRejectedValue(new Error("EBUSY"))
    await expect(deleteOutlineCompanions(mdPath)).resolves.toBe(0)
  })
})

describe("moveOutlineCompanions", () => {
  it("搬到新主名旁边并删掉旧文件", async () => {
    const destMd = "E:/Novel/wiki/outlines/卷纲/卷一 残灯有火.md"
    // 只有源 .html 存在；目标位置为空 → 应当写入并删除旧文件
    mockFileExists.mockImplementation(
      async (path: string) => path === "E:/Novel/wiki/outlines/卷纲/卷纲-第01卷.html",
    )
    mockReadFile.mockResolvedValue("<html>旧</html>")
    mockWriteFile.mockResolvedValue(undefined)
    mockDeleteFile.mockResolvedValue(undefined)

    const moved = await moveOutlineCompanions(mdPath, destMd)

    expect(moved).toBe(1)
    expect(mockWriteFile).toHaveBeenCalledWith(
      "E:/Novel/wiki/outlines/卷纲/卷一 残灯有火.html",
      "<html>旧</html>",
    )
    expect(mockDeleteFile).toHaveBeenCalledWith("E:/Novel/wiki/outlines/卷纲/卷纲-第01卷.html")
  })

  it("目标位置已有同名文件时不覆盖（用户可能已重新生成）", async () => {
    const destMd = "E:/Novel/wiki/outlines/卷纲/卷一.md"
    mockFileExists.mockResolvedValue(true)
    mockReadFile.mockResolvedValue("old")
    mockDeleteFile.mockResolvedValue(undefined)

    await moveOutlineCompanions(mdPath, destMd)

    // 两个伴生文件都"存在"，但目标也存在 → 不写，只删旧的
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockDeleteFile).toHaveBeenCalledTimes(2)
  })
})
