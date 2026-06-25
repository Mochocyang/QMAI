import { beforeEach, describe, expect, it, vi } from "vitest"

const fsMocks = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFileAtomic: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  deleteFile: fsMocks.deleteFile,
  listDirectory: fsMocks.listDirectory,
  readFile: fsMocks.readFile,
  writeFileAtomic: fsMocks.writeFileAtomic,
}))

import {
  deleteNovelSourceMemory,
  getOutlineSnapshotNumberFromPath,
} from "./delete-source-memory"
import { deleteChapterSnapshots } from "@/lib/novel/chapter-ingest"

vi.mock("@/lib/novel/chapter-ingest", () => ({
  deleteChapterSnapshots: vi.fn(),
}))

describe("deleteNovelSourceMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("deletes chapter snapshots by chapter_number before the page disappears", async () => {
    await deleteNovelSourceMemory("/project", {
      kind: "chapter",
      pagePath: "/project/wiki/chapters/chapter-012.md",
      content: "---\nchapter_number: 12\n---\n# 第十二章\n",
    })

    expect(deleteChapterSnapshots).toHaveBeenCalledWith("/project", 12)
  })

  it("deletes outline snapshots using the same filename hash as outline ingest", async () => {
    const outlinePath = "/project/wiki/outlines/人物小传/主角.md"
    const expected = getOutlineSnapshotNumberFromPath(outlinePath)

    await deleteNovelSourceMemory("/project", {
      kind: "outline",
      pagePath: outlinePath,
    })

    expect(expected).toBeLessThan(0)
    expect(deleteChapterSnapshots).toHaveBeenCalledWith("/project", expected)
  })

  it("deletes entity pages that only came from the deleted chapter source", async () => {
    fsMocks.listDirectory.mockResolvedValueOnce([
      { name: "主角.md", path: "/project/wiki/entities/主角.md", is_dir: false },
    ])
    fsMocks.readFile.mockResolvedValueOnce([
      "---",
      "type: entity",
      'sources: ["012.snapshot.json"]',
      'source_type: "chapter"',
      "source_sequence: 12",
      "---",
      "# 主角",
    ].join("\n"))

    await deleteNovelSourceMemory("/project", {
      kind: "chapter",
      pagePath: "/project/wiki/chapters/chapter-012.md",
      content: "---\nchapter_number: 12\n---\n# 第十二章\n",
    })

    expect(fsMocks.deleteFile).toHaveBeenCalledWith("/project/wiki/entities/主角.md")
  })

  it("preserves entity pages that still reference other sources", async () => {
    fsMocks.listDirectory.mockResolvedValueOnce([
      { name: "主角.md", path: "/project/wiki/entities/主角.md", is_dir: false },
    ])
    fsMocks.readFile.mockResolvedValueOnce([
      "---",
      "type: entity",
      'sources: ["012.snapshot.json", "013.snapshot.json"]',
      'source_type: "chapter"',
      "source_sequence: 13",
      "---",
      "# 主角",
      "",
      "## 章节信息",
      "",
      "- **相关章节**: 12",
      "",
      "## 章节信息",
      "",
      "- **相关章节**: 13",
    ].join("\n"))

    await deleteNovelSourceMemory("/project", {
      kind: "chapter",
      pagePath: "/project/wiki/chapters/chapter-012.md",
      content: "---\nchapter_number: 12\n---\n# 第十二章\n",
    })

    expect(fsMocks.deleteFile).not.toHaveBeenCalledWith("/project/wiki/entities/主角.md")
    expect(fsMocks.writeFileAtomic).toHaveBeenCalledWith(
      "/project/wiki/entities/主角.md",
      expect.not.stringContaining("012.snapshot.json"),
    )
  })
})
