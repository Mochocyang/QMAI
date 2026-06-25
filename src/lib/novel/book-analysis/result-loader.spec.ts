import { describe, it, expect, vi, beforeEach } from "vitest"
import { loadBookAnalysisResult } from "./result-loader"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  listDirectory: vi.fn(),
}))

import { readFile, listDirectory } from "@/commands/fs"

const mockedRead = vi.mocked(readFile)
const mockedList = vi.mocked(listDirectory)

describe("loadBookAnalysisResult", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reads metadata, characters and skills, returns assembled result", async () => {
    mockedRead.mockImplementation(async (p) => {
      if (p.endsWith("metadata.json")) {
        return JSON.stringify({
          title: "书名",
          author: "作者",
          totalChapters: 10,
          totalWords: 1000,
          sourceType: "file",
          createdAt: 1,
          updatedAt: 2,
        })
      }
      // character
      if (p.endsWith("c1.json")) {
        return JSON.stringify({ id: "c1", name: "主角" })
      }
      // skill
      if (p.endsWith("主角-skill.md")) {
        return "# 主角 skill"
      }
      return ""
    })
    mockedList.mockImplementation(async (dir) => {
      if (dir.endsWith("characters")) {
        return [{ name: "c1.json", is_dir: false, path: `${dir}/c1.json` }]
      }
      if (dir.endsWith("skills")) {
        return [{ name: "主角-skill.md", is_dir: false, path: `${dir}/主角-skill.md` }]
      }
      return []
    })

    const result = await loadBookAnalysisResult("/proj", "book-x")

    expect(result).not.toBeNull()
    expect(result?.bookId).toBe("book-x")
    expect(result?.metadata.title).toBe("书名")
    expect(result?.characters).toHaveLength(1)
    expect(result?.characters[0].name).toBe("主角")
    expect(result?.skills).toHaveLength(1)
    expect(result?.skills[0].characterName).toBe("主角")
  })

  it("returns null when metadata is missing", async () => {
    mockedRead.mockRejectedValue(new Error("not found"))
    mockedList.mockResolvedValue([])

    const result = await loadBookAnalysisResult("/proj", "book-y")
    expect(result).toBeNull()
  })

  it("returns result with empty characters and skills when those dirs are absent", async () => {
    mockedRead.mockImplementation(async (p) => {
      if (p.endsWith("metadata.json")) {
        return JSON.stringify({
          title: "T", totalChapters: 1, totalWords: 1,
          sourceType: "file", createdAt: 0, updatedAt: 0,
        })
      }
      return ""
    })
    mockedList.mockImplementation(async () => {
      throw new Error("no such dir")
    })

    const result = await loadBookAnalysisResult("/proj", "book-z")
    expect(result).not.toBeNull()
    expect(result?.characters).toEqual([])
    expect(result?.skills).toEqual([])
  })
})
