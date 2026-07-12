// library-store.spec.ts
// 库存储模块测试（feature/book-analysis-reuse）
import { describe, it, expect, beforeEach, vi } from "vitest"

const memStore = new Map<string, string>()
const unreadablePaths = new Set<string>()

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async (path: string) => {
    if (unreadablePaths.has(path)) throw new Error("文件不可读")
    return memStore.get(path) ?? ""
  }),
  writeFile: vi.fn(async (path: string, content: string) => { memStore.set(path, content) }),
  writeFileAtomic: vi.fn(async (path: string, content: string) => { memStore.set(path, content) }),
  createDirectory: vi.fn(async () => undefined),
  fileExists: vi.fn(async (path: string) => memStore.has(path)),
  listDirectory: vi.fn(async () => []),
}))

vi.mock("./batch-import-hash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./batch-import-hash")>()
  return { ...actual, hashNormalizedNovel: vi.fn(actual.hashNormalizedNovel) }
})

import { writeFileAtomic } from "@/commands/fs"
import { __resetProjectLocksForTesting } from "@/lib/project-mutex"
import { hashNormalizedNovel } from "./batch-import-hash"
import {
  findBookLibraryEntry,
  findBookLibraryEntryBySha256,
  loadBookLibrary,
  removeBookLibraryEntry,
  upsertBookLibraryEntry,
} from "./library-store"

const projectPath = "E:/Proj"
const libraryFilePath = "E:/Proj/book-analysis/library.json"

function entry(overrides: Record<string, unknown> = {}) {
  return {
    bookId: "book-1",
    sourcePath: "E:/a.txt",
    contentHash: "sample-hash",
    title: "A",
    totalChapters: 1,
    totalWords: 100,
    charactersCount: 0,
    skillsCount: 0,
    status: "completed" as const,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function seedLibrary(entries: ReturnType<typeof entry>[]) {
  memStore.set(libraryFilePath, JSON.stringify({ version: 1, entries }))
}

beforeEach(() => {
  memStore.clear()
  unreadablePaths.clear()
  __resetProjectLocksForTesting()
  vi.clearAllMocks()
})

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
  it("removeBookLibraryEntry: 原子删除指定条目并保留其他作品", async () => {
    seedLibrary([
      entry({ bookId: "book-1" }),
      entry({ bookId: "book-2", title: "B" }),
    ])

    await removeBookLibraryEntry(projectPath, "book-1")

    expect((await loadBookLibrary(projectPath)).entries.map((item) => item.bookId)).toEqual([
      "book-2",
    ])
    expect(writeFileAtomic).toHaveBeenCalledTimes(1)
    expect(writeFileAtomic).toHaveBeenCalledWith(
      libraryFilePath,
      JSON.stringify({ version: 1, entries: [entry({ bookId: "book-2", title: "B" })] }, null, 2),
    )
  })

  it("removeBookLibraryEntry: 条目不存在时不重写索引", async () => {
    seedLibrary([entry({ bookId: "book-2" })])

    await removeBookLibraryEntry(projectPath, "book-missing")

    expect((await loadBookLibrary(projectPath)).entries).toHaveLength(1)
    expect(writeFileAtomic).not.toHaveBeenCalled()
  })

  it("removeBookLibraryEntry: 索引文件不存在时才按空库处理", async () => {
    await expect(removeBookLibraryEntry(projectPath, "book-1")).resolves.toBeUndefined()
    expect(writeFileAtomic).not.toHaveBeenCalled()
  })

  it("removeBookLibraryEntry: 已存在索引读取失败时拒绝且不写回", async () => {
    seedLibrary([entry()])
    unreadablePaths.add(libraryFilePath)

    await expect(removeBookLibraryEntry(projectPath, "book-1")).rejects.toThrow("文件不可读")
    expect(writeFileAtomic).not.toHaveBeenCalled()
  })

  it("removeBookLibraryEntry: 已存在索引 JSON 损坏时拒绝且不写回", async () => {
    memStore.set(libraryFilePath, "{损坏 JSON")

    await expect(removeBookLibraryEntry(projectPath, "book-1")).rejects.toBeInstanceOf(SyntaxError)
    expect(writeFileAtomic).not.toHaveBeenCalled()
  })

  it("removeBookLibraryEntry: 已存在索引 schema 错误时拒绝且不写回", async () => {
    memStore.set(libraryFilePath, JSON.stringify({ version: 1, entries: null }))

    await expect(removeBookLibraryEntry(projectPath, "book-1")).rejects.toThrow(
      "作品库索引数据无效",
    )
    expect(writeFileAtomic).not.toHaveBeenCalled()
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
  it("findBookLibraryEntryBySha256: 优先返回已有 contentSha256 并继续迁移旧条目", async () => {
    seedLibrary([
      entry({ sourcePath: "E:/existing.txt", contentSha256: "sha-a" }),
      entry({ bookId: "book-2", sourcePath: "E:/legacy.txt", contentSha256: undefined }),
    ])
    memStore.set("E:/legacy.txt", "其他正文")

    const found = await findBookLibraryEntryBySha256(projectPath, "sha-a")
    const persisted = JSON.parse(memStore.get(libraryFilePath)!)

    expect(found?.bookId).toBe("book-1")
    expect(persisted.entries[1].contentSha256).toBe(await hashNormalizedNovel("其他正文"))
    expect(writeFileAtomic).toHaveBeenCalledTimes(1)
  })

  it("loadBookLibrary: 旧索引没有 contentSha256 时仍可正常读取", async () => {
    seedLibrary([entry({ contentSha256: undefined })])

    const library = await loadBookLibrary(projectPath)

    expect(library.entries).toHaveLength(1)
    expect(library.entries[0].contentSha256).toBeUndefined()
  })

  it("findBookLibraryEntryBySha256: 旧条目完整正文哈希相同时回填并原子保存", async () => {
    const sourceContent = "\ufeff第一章\r\n正文"
    const contentSha256 = await hashNormalizedNovel(sourceContent)
    seedLibrary([entry({ sourcePath: "E:/legacy.txt", contentSha256: undefined })])
    memStore.set("E:/legacy.txt", sourceContent)

    const found = await findBookLibraryEntryBySha256(projectPath, contentSha256)

    expect(found?.bookId).toBe("book-1")
    expect(found?.contentSha256).toBe(contentSha256)
    expect(JSON.parse(memStore.get(libraryFilePath)!).entries[0].contentSha256).toBe(contentSha256)
    expect(writeFileAtomic).toHaveBeenCalledTimes(1)
  })

  it("findBookLibraryEntryBySha256: 旧源文件不可读时不凭 contentHash 认定重复", async () => {
    const contentSha256 = await hashNormalizedNovel("待导入正文")
    seedLibrary([
      entry({
        sourcePath: "E:/missing.txt",
        contentHash: contentSha256,
        contentSha256: undefined,
      }),
    ])
    unreadablePaths.add("E:/missing.txt")

    const found = await findBookLibraryEntryBySha256(projectPath, contentSha256)

    expect(found).toBeUndefined()
    expect(JSON.parse(memStore.get(libraryFilePath)!).entries[0].contentSha256).toBeUndefined()
    expect(writeFileAtomic).not.toHaveBeenCalled()
  })

  it("findBookLibraryEntryBySha256: 完整哈希不同时不认定重复但仍回填旧条目", async () => {
    const contentSha256 = await hashNormalizedNovel("待导入正文")
    const sourceSha256 = await hashNormalizedNovel("不同正文")
    seedLibrary([
      entry({
        sourcePath: "E:/same-name.txt",
        contentHash: contentSha256,
        contentSha256: undefined,
      }),
    ])
    memStore.set("E:/same-name.txt", "不同正文")

    const found = await findBookLibraryEntryBySha256(projectPath, contentSha256)

    expect(found).toBeUndefined()
    expect(JSON.parse(memStore.get(libraryFilePath)!).entries[0].contentSha256).toBe(sourceSha256)
    expect(writeFileAtomic).toHaveBeenCalledTimes(1)
  })
  it("findBookLibraryEntryBySha256: 回填原子保存失败时不认定重复", async () => {
    const sourceContent = "旧条目正文"
    const contentSha256 = await hashNormalizedNovel(sourceContent)
    seedLibrary([entry({ sourcePath: "E:/legacy.txt", contentSha256: undefined })])
    memStore.set("E:/legacy.txt", sourceContent)
    vi.mocked(writeFileAtomic).mockRejectedValueOnce(new Error("保存失败"))

    await expect(findBookLibraryEntryBySha256(projectPath, contentSha256)).rejects.toThrow("保存失败")
    expect(JSON.parse(memStore.get(libraryFilePath)!).entries[0].contentSha256).toBeUndefined()
  })
  it("upsertBookLibraryEntry: 同项目并发交错时保留两个新增条目", async () => {
    let notifyFirstWrite!: () => void
    const firstWriteStarted = new Promise<void>((resolve) => { notifyFirstWrite = resolve })
    let releaseFirstWrite!: () => void
    const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve })
    vi.mocked(writeFileAtomic).mockImplementationOnce(async (path, content) => {
      notifyFirstWrite()
      await firstWriteGate
      memStore.set(path, content)
    })

    const first = upsertBookLibraryEntry(projectPath, entry({ bookId: "book-1" }))
    await firstWriteStarted
    const second = upsertBookLibraryEntry(projectPath, entry({ bookId: "book-2" }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    releaseFirstWrite()
    await Promise.all([first, second])

    const library = await loadBookLibrary(projectPath)
    expect(library.entries.map((item) => item.bookId).sort()).toEqual(["book-1", "book-2"])
  })

  it("upsertBookLibraryEntry: 新建和更新时原样保存调用方提供的 contentSha256", async () => {
    await upsertBookLibraryEntry(projectPath, entry({ contentSha256: "created-sha" }))
    expect((await loadBookLibrary(projectPath)).entries[0].contentSha256).toBe("created-sha")

    await upsertBookLibraryEntry(projectPath, entry({ contentSha256: "updated-sha" }))
    const library = await loadBookLibrary(projectPath)
    expect(library.entries).toHaveLength(1)
    expect(library.entries[0].contentSha256).toBe("updated-sha")
  })

  it("findBookLibraryEntryBySha256: 一次扫描回填所有可读旧条目并只保存一次", async () => {
    const firstContent = "第一本旧书"
    const secondContent = "第二本旧书"
    const firstSha256 = await hashNormalizedNovel(firstContent)
    const secondSha256 = await hashNormalizedNovel(secondContent)
    seedLibrary([
      entry({ bookId: "book-1", sourcePath: "E:/first.txt", contentSha256: undefined }),
      entry({ bookId: "book-2", sourcePath: "E:/second.txt", contentSha256: undefined }),
      entry({ bookId: "book-3", sourcePath: "E:/missing.txt", contentSha256: undefined }),
      entry({ bookId: "book-4", sourcePath: "E:/known.txt", contentSha256: "known-sha" }),
    ])
    memStore.set("E:/first.txt", firstContent)
    memStore.set("E:/second.txt", secondContent)
    unreadablePaths.add("E:/missing.txt")

    const found = await findBookLibraryEntryBySha256(projectPath, firstSha256)
    const persisted = JSON.parse(memStore.get(libraryFilePath)!)

    expect(found?.bookId).toBe("book-1")
    expect(persisted.entries.map((item: { contentSha256?: string }) => item.contentSha256)).toEqual([
      firstSha256,
      secondSha256,
      undefined,
      "known-sha",
    ])
    expect(writeFileAtomic).toHaveBeenCalledTimes(1)
  })

  it("findBookLibraryEntryBySha256: hashNormalizedNovel 异常向上传播", async () => {
    seedLibrary([entry({ sourcePath: "E:/legacy.txt", contentSha256: undefined })])
    memStore.set("E:/legacy.txt", "旧条目正文")
    vi.mocked(hashNormalizedNovel).mockRejectedValueOnce(new Error("哈希失败"))

    await expect(findBookLibraryEntryBySha256(projectPath, "target-sha")).rejects.toThrow("哈希失败")
    expect(writeFileAtomic).not.toHaveBeenCalled()
  })
})
