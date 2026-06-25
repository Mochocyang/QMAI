import { beforeEach, describe, expect, it, vi } from "vitest"

const fsMocks = vi.hoisted(() => ({
  createDirectory: vi.fn(),
  fileExists: vi.fn(),
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  createDirectory: fsMocks.createDirectory,
  fileExists: fsMocks.fileExists,
  listDirectory: fsMocks.listDirectory,
  readFile: fsMocks.readFile,
  writeFile: fsMocks.writeFile,
}))

import {
  buildImportedChapterMarkdown,
  collectChapterImportCandidatesFromFolder,
  extractImportedChapterNumber,
  importChapterFiles,
  runImportedChapterMemoryExtraction,
  sortChapterImportCandidates,
} from "./chapter-import"

describe("chapter import", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMocks.createDirectory.mockResolvedValue(undefined)
  })

  it("extracts Arabic and Chinese chapter numbers from file names", () => {
    expect(extractImportedChapterNumber("第1章 开局.txt")).toBe(1)
    expect(extractImportedChapterNumber("第十章 真相.docx")).toBe(10)
    expect(extractImportedChapterNumber("chapter-002.md")).toBe(2)
    expect(extractImportedChapterNumber("番外.txt")).toBeNull()
  })

  it("matches chapter numbers after book and volume prefixes without treating volume as the chapter", () => {
    expect(extractImportedChapterNumber("万古逍遥游-第一卷-第1章 前言.docx")).toBe(1)
    expect(extractImportedChapterNumber("万古逍遥游-第一卷-第2章 浮生苍穹为寒.docx")).toBe(2)
    expect(extractImportedChapterNumber("万古逍遥游-第一卷-第3章 十又五载.docx")).toBe(3)
  })

  it("sorts imported chapters by detected chapter number before unknown files", () => {
    const sorted = sortChapterImportCandidates([
      { path: "E:/book/第10章.txt", name: "第10章.txt" },
      { path: "E:/book/番外.txt", name: "番外.txt" },
      { path: "E:/book/第2章.txt", name: "第2章.txt" },
      { path: "E:/book/第1章.txt", name: "第1章.txt" },
    ])

    expect(sorted.map((item) => item.name)).toEqual([
      "第1章.txt",
      "第2章.txt",
      "第10章.txt",
      "番外.txt",
    ])
  })

  it("collects and sorts importable chapter files from a selected folder before confirmation", async () => {
    fsMocks.listDirectory.mockResolvedValueOnce([
      { name: "notes.tmp", path: "E:/book/notes.tmp", is_dir: false },
      { name: "chapter-002.md", path: "E:/book/chapter-002.md", is_dir: false },
      {
        name: "volume",
        path: "E:/book/volume",
        is_dir: true,
        children: [
          { name: "chapter-001.txt", path: "E:/book/volume/chapter-001.txt", is_dir: false },
        ],
      },
    ])

    const candidates = await collectChapterImportCandidatesFromFolder("E:\\book")

    expect(fsMocks.listDirectory).toHaveBeenCalledWith("E:/book")
    expect(candidates.map((candidate) => candidate.path)).toEqual([
      "E:/book/volume/chapter-001.txt",
      "E:/book/chapter-002.md",
    ])
  })

  it("builds chapter markdown as final only when memory extraction is requested", () => {
    const draft = buildImportedChapterMarkdown({
      title: "第1章 开局",
      chapterNumber: 1,
      body: "# 原标题\n\n正文",
      finalForMemoryExtraction: false,
    })
    const final = buildImportedChapterMarkdown({
      title: "第1章 开局",
      chapterNumber: 1,
      body: "正文",
      finalForMemoryExtraction: true,
    })

    expect(draft).toContain("chapter_status: draft")
    expect(final).toContain("chapter_status: final")
    expect(final).toContain("# 第1章 开局")
  })

  it("imports prefixed book-volume chapter files with clean chapter titles", async () => {
    fsMocks.fileExists.mockResolvedValue(false)
    fsMocks.readFile.mockImplementation(async (path: string) => `正文 ${path}`)

    await importChapterFiles("E:/Novel", [
      "E:/book/万古逍遥游-第一卷-第3章 十又五载.docx",
      "E:/book/万古逍遥游-第一卷-第1章 前言.docx",
      "E:/book/万古逍遥游-第一卷-第2章 浮生苍穹为寒.docx",
    ], { finalForMemoryExtraction: false })

    const written = fsMocks.writeFile.mock.calls.map(([path, content]) => ({
      path,
      content: String(content),
    }))
    expect(written.map((item) => item.path)).toEqual([
      "E:/Novel/wiki/chapters/chapter-001-前言.md",
      "E:/Novel/wiki/chapters/chapter-002-浮生苍穹为寒.md",
      "E:/Novel/wiki/chapters/chapter-003-十又五载.md",
    ])
    expect(written[0].content).toContain('title: "第1章 前言"')
    expect(written[0].content).toContain("# 第1章 前言")
    expect(written[1].content).toContain('title: "第2章 浮生苍穹为寒"')
    expect(written[2].content).toContain('title: "第3章 十又五载"')
  })

  it("extracts imported chapter memories one by one and stops after cancellation", async () => {
    const abortController = new AbortController()
    const ingestChapter = vi.fn(async () => {
      abortController.abort()
      return { snapshot: { chapterNumber: 1 } }
    })
    const onProgress = vi.fn()

    const result = await runImportedChapterMemoryExtraction({
      projectPath: "E:/Novel",
      chapterPaths: ["E:/Novel/wiki/chapters/chapter-001.md", "E:/Novel/wiki/chapters/chapter-002.md"],
      signal: abortController.signal,
      ingestChapter,
      onProgress,
    })

    expect(ingestChapter).toHaveBeenCalledTimes(1)
    expect(result.cancelled).toBe(true)
    expect(result.completed).toBe(1)
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ completed: 0, total: 2 }))
  })
})
