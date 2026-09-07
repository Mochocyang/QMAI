import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LintResult } from "@/lib/lint"
import type { NovelReviewResult } from "./review-adapter"
import {
  deleteGenerationHistoryEntry,
  listGenerationHistory,
  saveGenerationHistoryEntry,
} from "./generation-history"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  createDirectory: vi.fn(),
  listDirectory: vi.fn(),
  deleteFile: vi.fn(),
  fileExists: vi.fn(),
}))

vi.mock("@/lib/trash", () => ({
  moveFileToTrash: vi.fn(),
}))

import { createDirectory, listDirectory, readFile, writeFile } from "@/commands/fs"
import { moveFileToTrash } from "@/lib/trash"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockListDirectory = vi.mocked(listDirectory)
const mockMoveFileToTrash = vi.mocked(moveFileToTrash)

const projectPath = "E:/Novel"
const now = Date.UTC(2026, 4, 20, 9, 0, 0)

beforeEach(() => {
  vi.restoreAllMocks()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockCreateDirectory.mockReset()
  mockListDirectory.mockReset()
  mockMoveFileToTrash.mockReset()
  vi.spyOn(Date, "now").mockReturnValue(now)
  vi.spyOn(Math, "random").mockReturnValue(0.123456)
})

describe("generation-history", () => {
  it("保存连贯性检查历史到项目内独立文件", async () => {
    const results: LintResult[] = [
      {
        type: "semantic",
        severity: "warning",
        page: "chapters/001.md",
        detail: "第1章角色动机与上一章不一致",
      },
    ]

    const entry = await saveGenerationHistoryEntry(projectPath, {
      kind: "lint",
      title: "第1章连贯性检查",
      chapterNumber: 1,
      sourcePath: "E:/Novel/wiki/chapters/001.md",
      results,
    })

    expect(entry.id).toBe("20260520-090000-4fzyo8")
    expect(entry.createdAt).toBe("2026-05-20T09:00:00.000Z")
    expect(entry.filePath).toBe("E:/Novel/.qmai/generation-history/lint/20260520-090000-4fzyo8.json")
    expect(mockCreateDirectory).toHaveBeenCalledWith("E:/Novel/.qmai")
    expect(mockCreateDirectory).toHaveBeenCalledWith("E:/Novel/.qmai/generation-history")
    expect(mockCreateDirectory).toHaveBeenCalledWith("E:/Novel/.qmai/generation-history/lint")
    expect(mockWriteFile).toHaveBeenCalledWith(entry.filePath, JSON.stringify(entry, null, 2))
  })

  it("按类型读取历史并按创建时间倒序展示", async () => {
    const older = {
      id: "older",
      kind: "review" as const,
      title: "旧审稿",
      chapterNumber: 1,
      sourcePath: "E:/Novel/wiki/chapters/001.md",
      results: [
        {
          severity: "warning",
          type: "plot",
          message: "旧问题",
          evidence: "",
          relatedMemory: "",
          suggestion: "",
        } satisfies NovelReviewResult,
      ],
      createdAt: "2026-05-19T09:00:00.000Z",
      filePath: "E:/Novel/.llm-wiki/generation-history/review/older.json",
    }
    const newer = {
      ...older,
      id: "newer",
      title: "新审稿",
      createdAt: "2026-05-20T09:00:00.000Z",
      filePath: "E:/Novel/.llm-wiki/generation-history/review/newer.json",
    }

    mockListDirectory.mockResolvedValue([
      { name: "older.json", path: older.filePath, is_dir: false },
      { name: "newer.json", path: newer.filePath, is_dir: false },
    ])
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === older.filePath) return JSON.stringify(older)
      if (path === newer.filePath) return JSON.stringify(newer)
      throw new Error(`unexpected read ${path}`)
    })

    const entries = await listGenerationHistory(projectPath, "review")

    expect(entries.map((entry) => entry.id)).toEqual(["newer", "older"])
  })

  it("删除历史记录时移动对应历史文件到回收站", async () => {
    const filePath = "E:/Novel/.llm-wiki/generation-history/lint/20260520-090000-4fzyo8.json"

    await deleteGenerationHistoryEntry(projectPath, filePath)

    expect(mockMoveFileToTrash).toHaveBeenCalledWith(projectPath, filePath, "history")
  })
})
