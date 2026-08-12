import { beforeEach, describe, expect, it, vi } from "vitest"

const fileExistsMock = vi.fn()
const findChapterFileByNumberMock = vi.fn()
const loadSnapshotMock = vi.fn()

vi.mock("@/commands/fs", () => ({
  fileExists: (...args: unknown[]) => fileExistsMock(...args),
}))

vi.mock("@/lib/novel/chapter-utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/novel/chapter-utils")>("@/lib/novel/chapter-utils")
  return {
    ...actual,
    findChapterFileByNumber: (...args: unknown[]) => findChapterFileByNumberMock(...args),
  }
})

vi.mock("@/lib/novel/chapter-ingest", () => ({
  loadSnapshot: (...args: unknown[]) => loadSnapshotMock(...args),
}))

import {
  buildFoldedChapterPointer,
  buildHistoryContentForModel,
  CHAPTER_BODY_FOLD_MIN_CHARS,
  isFoldableChapterBody,
  resolveChapterNumberFromMessage,
} from "./chapter-body-injection"

const longBody = `${"正文内容。".repeat(400)}\n第12章完`
const projectPath = "/Novel/Demo"

describe("chapter body injection", () => {
  beforeEach(() => {
    fileExistsMock.mockReset()
    findChapterFileByNumberMock.mockReset()
    loadSnapshotMock.mockReset()
  })

  it("rejects short bodies and chapter_plan messages", () => {
    expect(isFoldableChapterBody("短文")).toBe(false)
    expect(isFoldableChapterBody(`${"x".repeat(CHAPTER_BODY_FOLD_MIN_CHARS)}\n<!-- chapter_plan -->`)).toBe(false)
    expect(isFoldableChapterBody(longBody)).toBe(true)
  })

  it("resolves chapter numbers from chapterRef, tool params, then text", () => {
    expect(resolveChapterNumberFromMessage({
      role: "assistant",
      content: longBody,
      chapterRef: { chapterNumber: 9, path: "wiki/chapters/chapter-009.md", savedAt: 1 },
      agentToolCalls: [{ name: "run_chapter_workflow", params: { chapterNumber: 12 } }],
    })).toBe(9)

    expect(resolveChapterNumberFromMessage({
      role: "assistant",
      content: "无关正文",
      agentToolCalls: [{ name: "run_chapter_workflow", params: { chapterNumber: 12 } }],
    })).toBe(12)

    expect(resolveChapterNumberFromMessage({
      role: "assistant",
      content: "第15章正式开篇……",
    })).toBe(15)
  })

  it("injects full body when chapter is not on disk", async () => {
    fileExistsMock.mockResolvedValue(false)
    findChapterFileByNumberMock.mockResolvedValue(null)

    const content = await buildHistoryContentForModel({
      role: "assistant",
      content: longBody,
      chapterRef: { chapterNumber: 12, path: `${projectPath}/wiki/chapters/chapter-012.md`, savedAt: 1 },
    }, {
      projectPath,
      novelMode: true,
      readChapterToolAvailable: true,
    })

    expect(content).toBe(longBody)
  })

  it("folds saved chapters into a pointer and keeps summary when available", async () => {
    fileExistsMock.mockResolvedValue(true)
    loadSnapshotMock.mockResolvedValue({ summary: "主角在车站发现旧照片。" })

    const content = await buildHistoryContentForModel({
      role: "assistant",
      content: longBody,
      chapterRef: { chapterNumber: 12, path: `${projectPath}/wiki/chapters/chapter-012.md`, savedAt: 1 },
    }, {
      projectPath,
      novelMode: true,
      readChapterToolAvailable: true,
    })

    expect(content).toContain("第12章正文已入库")
    expect(content).toContain("wiki/chapters/chapter-012.md")
    expect(content).toContain("提要：主角在车站发现旧照片。")
    expect(content).toContain("read_chapter")
    expect(content).not.toContain("正文内容。正文内容。")
  })

  it("falls back to full body after the saved chapter file is deleted", async () => {
    fileExistsMock.mockResolvedValue(false)
    findChapterFileByNumberMock.mockResolvedValue(null)

    const content = await buildHistoryContentForModel({
      role: "assistant",
      content: longBody,
      chapterRef: { chapterNumber: 12, path: `${projectPath}/wiki/chapters/chapter-012.md`, savedAt: 1 },
    }, {
      projectPath,
      novelMode: true,
    })

    expect(content).toBe(longBody)
  })

  it("does not fold when read_chapter is unavailable or chapter number is missing", async () => {
    fileExistsMock.mockResolvedValue(true)
    const withoutTool = await buildHistoryContentForModel({
      role: "assistant",
      content: longBody,
      chapterRef: { chapterNumber: 12, path: `${projectPath}/wiki/chapters/chapter-012.md`, savedAt: 1 },
    }, {
      projectPath,
      novelMode: true,
      readChapterToolAvailable: false,
    })
    expect(withoutTool).toBe(longBody)

    const noNumberBody = "x".repeat(CHAPTER_BODY_FOLD_MIN_CHARS + 10)
    const withoutNumber = await buildHistoryContentForModel({
      role: "assistant",
      content: noNumberBody,
    }, {
      projectPath,
      novelMode: true,
    })
    expect(withoutNumber).toBe(noNumberBody)
  })

  it("omits summary line when snapshot is missing", () => {
    const pointer = buildFoldedChapterPointer({
      chapterNumber: 3,
      relativePath: "wiki/chapters/chapter-003.md",
      originalChars: 2000,
    })
    expect(pointer).toContain("第3章正文已入库")
    expect(pointer).not.toContain("提要：")
  })
})
