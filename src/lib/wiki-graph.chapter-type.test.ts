import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildWikiGraph } from "./wiki-graph"
import { listDirectory, readFile } from "@/commands/fs"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock("./graph-relevance", () => ({
  buildRetrievalGraph: vi.fn().mockResolvedValue(null),
  calculateRelevance: vi.fn(() => 1),
}))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: () => ({ dataVersion: 1 }),
  },
}))

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)

describe("buildWikiGraph chapter type compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("treats chapter files with chapter_number as chapter nodes even without explicit type", async () => {
    mockListDirectory.mockResolvedValue([
      { name: "001.md", path: "E:/project/wiki/chapters/001.md", is_dir: false },
    ])
    mockReadFile.mockResolvedValue(`---
title: 第1章
chapter_number: 1
chapter_status: draft
---
# 第1章`)

    const graph = await buildWikiGraph("E:/project")

    expect(graph.nodes).toEqual([
      expect.objectContaining({
        id: "001",
        label: "第1章",
        type: "chapter",
      }),
    ])
  })
})
