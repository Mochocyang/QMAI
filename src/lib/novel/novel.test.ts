import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FileNode } from "@/types/wiki"
import type { ChapterSnapshot } from "./chapter-ingest"
import { searchWiki } from "@/lib/search"
import { buildRetrievalGraph, getRelatedNodes } from "@/lib/graph-relevance"
import { DEFAULT_NOVEL_CONFIG, useWikiStore } from "@/stores/wiki-store"
import { buildContextPack } from "./context-engine"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  writeFileAtomic: vi.fn(),
  createDirectory: vi.fn(),
  fileExists: vi.fn(),
  listDirectory: vi.fn(),
  deleteFile: vi.fn(),
}))

vi.mock("@/lib/search", () => ({
  searchWiki: vi.fn(),
  tokenizeQuery: (query: string) => query.split(/\s+/).filter(Boolean),
}))

vi.mock("@/lib/embedding", () => ({
  searchByEmbedding: vi.fn(),
  embedPage: vi.fn(),
}))

vi.mock("@/lib/graph-relevance", () => ({
  buildRetrievalGraph: vi.fn(async () => ({ nodes: new Map(), dataVersion: 0 })),
  getRelatedNodes: vi.fn(() => []),
  clearGraphCache: vi.fn(),
}))

vi.mock("./revision-feedback", () => ({
  loadRevisionFeedbackForContext: vi.fn(async () => ({ mustFix: [], shouldImprove: [], carryToNextChapter: [] })),
  buildRevisionDirectives: vi.fn(() => ""),
}))

vi.mock("./character-cognition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./character-cognition")>()
  return {
    ...actual,
    loadCognitionState: vi.fn(async () => null),
    cognitionToContextText: vi.fn(() => ""),
  }
})

vi.mock("./volume", () => ({
  getChapterVolumes: vi.fn(() => []),
}))

import { createDirectory, fileExists, listDirectory, readFile, writeFile, writeFileAtomic } from "@/commands/fs"

const mockCreateDirectory = vi.mocked(createDirectory)
const mockFileExists = vi.mocked(fileExists)
const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)
const mockSearchWiki = vi.mocked(searchWiki)
const mockBuildRetrievalGraph = vi.mocked(buildRetrievalGraph)
const mockGetRelatedNodes = vi.mocked(getRelatedNodes)
const mockWriteFile = vi.mocked(writeFile)
const mockWriteFileAtomic = vi.mocked(writeFileAtomic)

describe("snapshot-history", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWikiStore.setState({
      novelMode: true,
      novelConfig: DEFAULT_NOVEL_CONFIG,
      revisionFeedbackWindowConfig: {
        currentChapterIncludeShouldImprove: false,
        previousChapterCarryEnabled: false,
        lookbackChapterCount: 1,
        lookbackIncludeMustFixOnly: false,
      },
      embeddingConfig: {
        enabled: false,
        endpoint: "",
        apiKey: "",
        model: "",
      },
    })
  })

  it("restores a historical snapshot back into the current snapshot file", async () => {
    const { restoreSnapshotHistory } = await vi.importActual<typeof import("./chapter-ingest")>("./chapter-ingest")
    mockCreateDirectory.mockReset()
    mockWriteFileAtomic.mockReset()
    mockReadFile.mockReset()
    mockFileExists.mockReset()
    mockFileExists.mockResolvedValue(false)

    const historySnapshot = {
      chapterId: "chapter-3",
      chapterNumber: 3,
      summary: "历史摘要",
      characters: [],
      locations: [],
      organizations: [],
      items: [],
      events: [],
      characterStateChanges: [],
      relationshipChanges: [],
      knowledgeChanges: [],
      foreshadowingChanges: [],
      newCanonFacts: [],
      timelineEvents: [],
      conflicts: [],
      endingHook: "",
      graphNodes: [],
      graphEdges: [],
    }
    mockReadFile.mockResolvedValue(JSON.stringify(historySnapshot))

    const restored = await restoreSnapshotHistory("/project", 3, "2026-05-22T09-30-00-000Z.snapshot.json")

    expect(restored.summary).toBe("历史摘要")
    expect(mockWriteFileAtomic).toHaveBeenCalledWith(
      "/project/.novel/snapshots/003.snapshot.json",
      expect.stringContaining('"revision": 2'),
    )
    expect(mockWriteFileAtomic).toHaveBeenCalledWith(
      "/project/.novel/snapshots/003.snapshot.md",
      expect.stringContaining("历史摘要"),
    )
  })

  it("restoreSnapshotHistory creates a new current revision instead of reviving the archived one unchanged", async () => {
    const { restoreSnapshotHistory } = await vi.importActual<typeof import("./chapter-ingest")>("./chapter-ingest")
    mockCreateDirectory.mockReset()
    mockWriteFileAtomic.mockReset()
    mockReadFile.mockReset()
    mockFileExists.mockReset()
    mockFileExists.mockResolvedValue(false)

    const archivedSnapshot = {
      chapterId: "chapter-3",
      chapterNumber: 3,
      summary: "历史摘要",
      characters: [],
      locations: [],
      organizations: [],
      items: [],
      events: [],
      characterStateChanges: [],
      relationshipChanges: [],
      knowledgeChanges: [],
      foreshadowingChanges: [],
      newCanonFacts: [],
      timelineEvents: [],
      conflicts: [],
      endingHook: "",
      graphNodes: [],
      graphEdges: [],
      sourceType: "chapter",
      sourceSequence: 3,
      revision: 1,
      snapshotId: "chapter-3-r1",
      isHistorical: true,
    } satisfies ChapterSnapshot
    mockReadFile.mockResolvedValue(JSON.stringify(archivedSnapshot))

    const restored = await restoreSnapshotHistory("/project", 3, "2026-05-22T09-30-00-000Z.snapshot.json")

    expect(restored.summary).toBe("历史摘要")
    expect(restored.revision).toBe(2)
    expect(restored.snapshotId).toBe("chapter-3-r2")
    expect(restored.supersedes).toBe("chapter-3-r1")
    expect(restored.isHistorical).toBe(false)
  })

  it("rebuilds current projection and derived memory files when restoring snapshot history", async () => {
    const { restoreSnapshotHistory } = await vi.importActual<typeof import("./chapter-ingest")>("./chapter-ingest")
    mockCreateDirectory.mockReset()
    mockWriteFileAtomic.mockReset()
    mockWriteFile.mockReset()
    mockReadFile.mockReset()
    mockFileExists.mockReset()
    mockFileExists.mockResolvedValue(false)

    const archivedSnapshot = {
      chapterId: "chapter-3",
      chapterNumber: 3,
      summary: "历史摘要",
      characters: ["林烬"],
      locations: [],
      organizations: [],
      items: ["手机"],
      events: [],
      characterStateChanges: ["林烬:重伤"],
      relationshipChanges: [],
      knowledgeChanges: ["林烬知道手机不是这个世界的产物"],
      foreshadowingChanges: ["新增伏笔: 手机 - 外来物"],
      newCanonFacts: [],
      timelineEvents: ["第3章：手机再次出现"],
      conflicts: [],
      endingHook: "",
      graphNodes: [],
      graphEdges: [],
      sourceType: "chapter",
      sourceSequence: 3,
      revision: 1,
      snapshotId: "chapter-3-r1",
      isHistorical: true,
    } satisfies ChapterSnapshot
    mockReadFile.mockResolvedValue(JSON.stringify(archivedSnapshot))

    await restoreSnapshotHistory("/project", 3, "2026-05-22T09-30-00-000Z.snapshot.json")

    expect(mockWriteFileAtomic).toHaveBeenCalledWith(
      "/project/wiki/entities/林烬.md",
      expect.stringContaining('snapshot_id: "chapter-3-r2"'),
    )
    expect(mockWriteFileAtomic).toHaveBeenCalledWith(
      "/project/wiki/entities/手机.md",
      expect.stringContaining('source_revision: 2'),
    )
    expect(mockWriteFileAtomic).toHaveBeenCalledWith(
      "/project/wiki/memory/character-states.md",
      expect.stringContaining("林烬"),
    )
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/.novel/character-states.json",
      expect.stringContaining('"characterName": "林烬"'),
    )
    expect(mockWriteFileAtomic).toHaveBeenCalledWith(
      "/project/.novel/cognition-state.json",
      expect.stringContaining("手机不是这个世界的产物"),
    )
  })
})

describe("context-pack freshness", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWikiStore.setState({
      novelMode: true,
      novelConfig: DEFAULT_NOVEL_CONFIG,
      revisionFeedbackWindowConfig: {
        currentChapterIncludeShouldImprove: false,
        previousChapterCarryEnabled: false,
        lookbackChapterCount: 1,
        lookbackIncludeMustFixOnly: false,
      },
      embeddingConfig: {
        enabled: false,
        endpoint: "",
        apiKey: "",
        model: "",
      },
    })
  })

  it("buildContextPack excludes stale query matches and keeps the latest authoritative memory", async () => {
    const emptyTree: FileNode[] = []
    mockListDirectory.mockResolvedValue(emptyTree)
    mockSearchWiki.mockImplementation(async (_projectPath, query) => {
      if (query.includes("关键词索引") || query.includes("向量索引")) {
        return [
          {
            path: "/project/wiki/queries/old-phone-query.md",
            title: "旧查询",
            snippet: "手机 仍然在旧查询里出现",
            titleMatch: false,
            score: 0.95,
            images: [],
          },
        ]
      }
      return [
        {
          path: "/project/wiki/queries/old-phone-query.md",
          title: "旧查询",
          snippet: "手机 仍然在旧查询里出现",
          titleMatch: false,
          score: 0.99,
          images: [],
        },
        {
          path: "/project/wiki/entities/spirit-stone.md",
          title: "灵石",
          snippet: "灵石 是当前有效设定",
          titleMatch: true,
          score: 0.7,
          images: [],
        },
      ]
    })
    mockBuildRetrievalGraph.mockResolvedValue({ nodes: new Map(), dataVersion: 0 })
    mockGetRelatedNodes.mockReturnValue([])
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath === "/project/wiki/entities/spirit-stone.md") {
        return [
          "---",
          'type: entity',
          'title: "灵石"',
          'snapshot_id: "chapter-12-r3"',
          'source_type: "chapter"',
          "source_sequence: 12",
          "source_revision: 3",
          "is_historical: false",
          'sources: ["012.snapshot.json"]',
          "---",
          "",
          "# 灵石",
          "",
          "灵石 是当前有效设定。",
        ].join("\n")
      }
      if (filePath === "/project/wiki/queries/old-phone-query.md") {
        return "# 旧查询\n\n手机 仍然在旧查询里出现"
      }
      throw new Error(`unexpected read: ${filePath}`)
    })

    const pack = await buildContextPack("/project", "写第12章，继续推进修炼体系", 12)

    expect(pack.searchResults).toContain("灵石")
    expect(pack.searchResults).not.toContain("旧查询")
    expect(pack.searchResults).not.toContain("手机")
  })
})
