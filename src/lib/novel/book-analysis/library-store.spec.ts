// library-store.spec.ts
// 库存储模块测试（feature/book-analysis-reuse）
import { describe, it, expect, beforeEach, vi } from "vitest"

const memStore = new Map<string, string>()

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async (path: string) => memStore.get(path) ?? ""),
  writeFile: vi.fn(async (path: string, content: string) => { memStore.set(path, content) }),
  createDirectory: vi.fn(async () => undefined),
  listDirectory: vi.fn(async () => []),
}))

import { loadBookLibrary, upsertBookLibraryEntry, findBookLibraryEntry } from "./library-store"

beforeEach(() => { memStore.clear() })

describe("library-store", () => {
  it("loadBookLibrary: 文件不存在或损坏 → 返回空库", async () => {
    const lib = await loadBookLibrary("E:/Proj")
    expect(lib.entries).toEqual([])
  })
  it("upsertBookLibraryEntry: 新增", async () => {
    await upsertBookLibraryEntry("E:/Proj", {
      bookId: "book-1", sourcePath: "E:/a.txt", contentHash: "abc",
      title: "A", totalChapters: 1, totalWords: 100,
      charactersCount: 0, skillsCount: 0, status: "completed",
      createdAt: 1, updatedAt: 1,
    })
    const lib = await loadBookLibrary("E:/Proj")
    expect(lib.entries).toHaveLength(1)
    expect(lib.entries[0].bookId).toBe("book-1")
  })
  it("upsertBookLibraryEntry: 同 bookId 覆盖", async () => {
    await upsertBookLibraryEntry("E:/Proj", {
      bookId: "book-1", sourcePath: "E:/a.txt", contentHash: "abc",
      title: "A", totalChapters: 1, totalWords: 100,
      charactersCount: 0, skillsCount: 0, status: "completed",
      createdAt: 1, updatedAt: 1,
    })
    await upsertBookLibraryEntry("E:/Proj", {
      bookId: "book-1", sourcePath: "E:/a.txt", contentHash: "abc",
      title: "A (改)", totalChapters: 2, totalWords: 200,
      charactersCount: 0, skillsCount: 0, status: "completed",
      createdAt: 1, updatedAt: 2,
    })
    const lib = await loadBookLibrary("E:/Proj")
    expect(lib.entries).toHaveLength(1)
    expect(lib.entries[0].title).toBe("A (改)")
    expect(lib.entries[0].totalChapters).toBe(2)
  })
  it("findBookLibraryEntry: 按 sourcePath 命中", async () => {
    await upsertBookLibraryEntry("E:/Proj", {
      bookId: "book-1", sourcePath: "E:/a.txt", contentHash: "abc",
      title: "A", totalChapters: 1, totalWords: 100,
      charactersCount: 0, skillsCount: 0, status: "completed",
      createdAt: 1, updatedAt: 1,
    })
    const found = await findBookLibraryEntry("E:/Proj", "E:/a.txt", "abc")
    expect(found?.bookId).toBe("book-1")
  })
  it("findBookLibraryEntry: hash 不一致返回 undefined", async () => {
    await upsertBookLibraryEntry("E:/Proj", {
      bookId: "book-1", sourcePath: "E:/a.txt", contentHash: "abc",
      title: "A", totalChapters: 1, totalWords: 100,
      charactersCount: 0, skillsCount: 0, status: "completed",
      createdAt: 1, updatedAt: 1,
    })
    const found = await findBookLibraryEntry("E:/Proj", "E:/a.txt", "different")
    expect(found).toBeUndefined()
  })
})
