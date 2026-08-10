import { beforeEach, describe, expect, it, vi } from "vitest"

const fsMocks = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  fileExists: vi.fn(),
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFileAtomic: vi.fn(),
}))

const ingestMocks = vi.hoisted(() => ({
  deleteChapterSnapshotArtifacts: vi.fn(),
  deleteChapterSnapshots: vi.fn(),
  rebuildDerivedMemoryFromSnapshots: vi.fn(),
}))

const graphMocks = vi.hoisted(() => ({
  clearGraphCache: vi.fn(),
}))

const storeMocks = vi.hoisted(() => ({
  bumpDataVersion: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  deleteFile: fsMocks.deleteFile,
  fileExists: fsMocks.fileExists,
  listDirectory: fsMocks.listDirectory,
  readFile: fsMocks.readFile,
  writeFileAtomic: fsMocks.writeFileAtomic,
}))

vi.mock("@/lib/novel/chapter-ingest", () => ingestMocks)
vi.mock("@/lib/graph-relevance", () => graphMocks)
vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: () => storeMocks,
  },
}))

import {
  deleteNovelSourceMemory,
  flushDeletedChapterMemoryCleanup,
  getOutlineSnapshotNumberFromPath,
  shouldCleanupDeletedChapterMemory,
} from "./delete-source-memory"

function chapterContent(status: string | null, chapterNumber = 12): string {
  return [
    "---",
    "type: chapter",
    `chapter_number: ${chapterNumber}`,
    ...(status === null ? [] : [`chapter_status: ${status}`]),
    "---",
    `# 第${chapterNumber}章`,
  ].join("\n")
}

function entityContent(sources: string[]): string {
  return [
    "---",
    "type: entity",
    `sources: [${sources.map((source) => `"${source}"`).join(", ")}]`,
    'source_type: "chapter"',
    "---",
    "# 主角",
  ].join("\n")
}

describe("deleteNovelSourceMemory", () => {
  beforeEach(async () => {
    await flushDeletedChapterMemoryCleanup()
    vi.clearAllMocks()
    fsMocks.listDirectory.mockResolvedValue([])
    fsMocks.fileExists.mockResolvedValue(false)
    fsMocks.readFile.mockResolvedValue("")
    ingestMocks.deleteChapterSnapshotArtifacts.mockResolvedValue(true)
    ingestMocks.rebuildDerivedMemoryFromSnapshots.mockResolvedValue(undefined)
    ingestMocks.deleteChapterSnapshots.mockResolvedValue(undefined)
  })

  it.each(["outline", "draft", "revised", "archived"])(
    "does not clean memory for non-final chapter status %s",
    async (status) => {
      await deleteNovelSourceMemory("/project", {
        kind: "chapter",
        pagePath: "/project/wiki/chapters/chapter-012.md",
        content: chapterContent(status),
      })
      await flushDeletedChapterMemoryCleanup()

      expect(ingestMocks.deleteChapterSnapshotArtifacts).not.toHaveBeenCalled()
      expect(ingestMocks.rebuildDerivedMemoryFromSnapshots).not.toHaveBeenCalled()
      expect(fsMocks.listDirectory).not.toHaveBeenCalled()
    },
  )

  it.each([null, "unknown"])(
    "treats missing or invalid status %s as non-final",
    async (status) => {
      const content = chapterContent(status)
      expect(shouldCleanupDeletedChapterMemory(content)).toBe(false)
    },
  )

  it("queues final chapter cleanup and returns before the background batch runs", async () => {
    await deleteNovelSourceMemory("/project", {
      kind: "chapter",
      pagePath: "/project/wiki/chapters/chapter-012.md",
      content: chapterContent("final"),
    })

    expect(ingestMocks.deleteChapterSnapshotArtifacts).not.toHaveBeenCalled()

    await flushDeletedChapterMemoryCleanup()
    expect(ingestMocks.deleteChapterSnapshotArtifacts).toHaveBeenCalledWith("/project", 12)
    expect(ingestMocks.rebuildDerivedMemoryFromSnapshots).toHaveBeenCalledTimes(1)
  })

  it("coalesces consecutive final deletions into one rebuild and one entity scan", async () => {
    fsMocks.listDirectory.mockImplementation(async (path: string) => {
      if (path.endsWith("/wiki/entities")) {
        return [{ name: "主角.md", path: "/project/wiki/entities/主角.md", is_dir: false }]
      }
      return []
    })
    fsMocks.readFile.mockResolvedValue(entityContent(["012.snapshot.json", "013.snapshot.json", "014.snapshot.json"]))

    await Promise.all([
      deleteNovelSourceMemory("/project", {
        kind: "chapter",
        pagePath: "/project/wiki/chapters/chapter-012.md",
        content: chapterContent("final", 12),
      }),
      deleteNovelSourceMemory("/project", {
        kind: "chapter",
        pagePath: "/project/wiki/chapters/chapter-013.md",
        content: chapterContent("final", 13),
      }),
    ])
    await flushDeletedChapterMemoryCleanup()

    expect(ingestMocks.deleteChapterSnapshotArtifacts).toHaveBeenCalledTimes(2)
    expect(ingestMocks.rebuildDerivedMemoryFromSnapshots).toHaveBeenCalledTimes(1)
    expect(fsMocks.listDirectory).toHaveBeenCalledWith("/project/wiki/entities")
    expect(fsMocks.writeFileAtomic).toHaveBeenCalledWith(
      "/project/wiki/entities/主角.md",
      expect.stringContaining("014.snapshot.json"),
    )
    expect(fsMocks.writeFileAtomic).toHaveBeenCalledWith(
      "/project/wiki/entities/主角.md",
      expect.not.stringContaining("012.snapshot.json"),
    )
  })

  it("deletes an entity whose only source belongs to the deleted chapter", async () => {
    fsMocks.listDirectory.mockImplementation(async (path: string) => {
      if (path.endsWith("/wiki/entities")) {
        return [{ name: "主角.md", path: "/project/wiki/entities/主角.md", is_dir: false }]
      }
      return []
    })
    fsMocks.readFile.mockResolvedValue(entityContent(["012.snapshot.json"]))

    await deleteNovelSourceMemory("/project", {
      kind: "chapter",
      pagePath: "/project/wiki/chapters/chapter-012.md",
      content: chapterContent("final"),
    })
    await flushDeletedChapterMemoryCleanup()

    expect(fsMocks.deleteFile).toHaveBeenCalledWith("/project/wiki/entities/主角.md")
  })

  it("scans entity files concurrently with a maximum of 16 readers", async () => {
    const files = Array.from({ length: 40 }, (_, index) => ({
      name: `实体-${index}.md`,
      path: `/project/wiki/entities/实体-${index}.md`,
      is_dir: false,
    }))
    fsMocks.listDirectory.mockImplementation(async (path: string) => path.endsWith("/wiki/entities") ? files : [])

    let activeReads = 0
    let maxActiveReads = 0
    fsMocks.readFile.mockImplementation(async () => {
      activeReads += 1
      maxActiveReads = Math.max(maxActiveReads, activeReads)
      await new Promise((resolve) => setTimeout(resolve, 2))
      activeReads -= 1
      return entityContent(["999.snapshot.json"])
    })

    await deleteNovelSourceMemory("/project", {
      kind: "chapter",
      pagePath: "/project/wiki/chapters/chapter-012.md",
      content: chapterContent("final"),
    })
    await flushDeletedChapterMemoryCleanup()

    expect(maxActiveReads).toBeGreaterThan(1)
    expect(maxActiveReads).toBeLessThanOrEqual(16)
  })

  it("continues cleaning other entities when one entity read fails", async () => {
    fsMocks.listDirectory.mockImplementation(async (path: string) => {
      if (path.endsWith("/wiki/entities")) {
        return [
          { name: "损坏.md", path: "/project/wiki/entities/损坏.md", is_dir: false },
          { name: "正常.md", path: "/project/wiki/entities/正常.md", is_dir: false },
        ]
      }
      return []
    })
    fsMocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("/损坏.md")) throw new Error("read failed")
      return entityContent(["012.snapshot.json"])
    })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    await deleteNovelSourceMemory("/project", {
      kind: "chapter",
      pagePath: "/project/wiki/chapters/chapter-012.md",
      content: chapterContent("final"),
    })
    await flushDeletedChapterMemoryCleanup()

    expect(fsMocks.deleteFile).toHaveBeenCalledWith("/project/wiki/entities/正常.md")
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("skips cleanup if the chapter number exists again before the worker runs", async () => {
    fsMocks.listDirectory.mockImplementation(async (path: string) => {
      if (path.endsWith("/wiki/chapters")) {
        return [{ name: "restored.md", path: "/project/wiki/chapters/restored.md", is_dir: false }]
      }
      return []
    })
    fsMocks.readFile.mockResolvedValue(chapterContent("final"))

    await deleteNovelSourceMemory("/project", {
      kind: "chapter",
      pagePath: "/project/wiki/chapters/chapter-012.md",
      content: chapterContent("final"),
    })
    await flushDeletedChapterMemoryCleanup()

    expect(ingestMocks.deleteChapterSnapshotArtifacts).not.toHaveBeenCalled()
    expect(ingestMocks.rebuildDerivedMemoryFromSnapshots).not.toHaveBeenCalled()
  })

  it("skips cleanup if the original chapter path was restored", async () => {
    fsMocks.fileExists.mockResolvedValue(true)

    await deleteNovelSourceMemory("/project", {
      kind: "chapter",
      pagePath: "/project/wiki/chapters/chapter-012.md",
      content: chapterContent("final"),
    })
    await flushDeletedChapterMemoryCleanup()

    expect(ingestMocks.deleteChapterSnapshotArtifacts).not.toHaveBeenCalled()
    expect(fsMocks.listDirectory).not.toHaveBeenCalled()
  })

  it("keeps outline deletion synchronous and uses its ingest hash", async () => {
    const outlinePath = "/project/wiki/outlines/人物小传/主角.md"
    const expected = getOutlineSnapshotNumberFromPath(outlinePath)

    await deleteNovelSourceMemory("/project", {
      kind: "outline",
      pagePath: outlinePath,
    })

    expect(expected).toBeLessThan(0)
    expect(ingestMocks.deleteChapterSnapshots).toHaveBeenCalledWith("/project", expected)
  })
})
