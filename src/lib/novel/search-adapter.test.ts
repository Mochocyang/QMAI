import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFile } from "@/commands/fs"
import { searchWiki } from "@/lib/search"
import { searchByEmbedding } from "@/lib/embedding"
import { useWikiStore } from "@/stores/wiki-store"
import { novelMixedSearch } from "./search-adapter"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
}))

vi.mock("@/lib/search", () => ({
  searchWiki: vi.fn(),
}))

vi.mock("@/lib/embedding", () => ({
  searchByEmbedding: vi.fn(),
}))

vi.mock("./chapter-ingest", () => ({
  listSnapshots: vi.fn(async () => []),
  loadSnapshot: vi.fn(async () => null),
}))

const mockReadFile = vi.mocked(readFile)
const mockSearchWiki = vi.mocked(searchWiki)
const mockSearchByEmbedding = vi.mocked(searchByEmbedding)

const searchHit = (path: string, title: string, score: number) => ({
  path,
  title,
  snippet: `${title} snippet`,
  titleMatch: false,
  score,
  images: [],
})

describe("novelMixedSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWikiStore.setState({
      embeddingConfig: {
        enabled: true,
        endpoint: "http://localhost:11434/api/embeddings",
        apiKey: "",
        model: "nomic-embed-text",
      },
    })
  })

  it("uses fused ranking instead of always putting keyword results first", async () => {
    mockSearchWiki.mockResolvedValue([
      searchHit("/project/wiki/entities/keyword.md", "Keyword Hit", 0.01),
    ])
    mockSearchByEmbedding.mockResolvedValue([{ id: "vector-hit", score: 0.99 }])
    mockReadFile.mockResolvedValue("# Vector Hit\n\nstrong semantic memory")

    const results = await novelMixedSearch({
      projectPath: "/project",
      query: "semantic memory",
      topK: 2,
      includeKeyword: true,
      includeVector: true,
      includeGraph: false,
      includeRecentChapters: false,
      includeCanon: false,
    })

    expect(results.map((r) => r.title)).toEqual(["Vector Hit", "Keyword Hit"])
  })

  it("merges the same page across retrieval sources and boosts it", async () => {
    mockSearchWiki.mockResolvedValue([
      searchHit("/project/wiki/entities/keyword-only.md", "Keyword Only", 0.8),
      searchHit("/project/wiki/entities/shared.md", "Shared Keyword", 0.7),
    ])
    mockSearchByEmbedding.mockResolvedValue([
      { id: "shared", score: 0.95 },
      { id: "vector-only", score: 0.93 },
    ])
    mockReadFile.mockImplementation(async (path) => {
      if (path.endsWith("/shared.md")) return "# Shared Vector\n\nshared semantic memory"
      if (path.endsWith("/vector-only.md")) return "# Vector Only\n\nvector semantic memory"
      throw new Error(`unexpected read: ${path}`)
    })

    const results = await novelMixedSearch({
      projectPath: "/project",
      query: "shared memory",
      topK: 3,
      includeKeyword: true,
      includeVector: true,
      includeGraph: false,
      includeRecentChapters: false,
      includeCanon: false,
    })

    expect(results[0].path).toBe("/project/wiki/entities/shared.md")
    expect(results.filter((r) => r.path === "/project/wiki/entities/shared.md")).toHaveLength(1)
  })

  it("returns completed sources even when one retrieval branch stalls", async () => {
    vi.useFakeTimers()
    try {
      mockSearchWiki.mockImplementation(() => new Promise(() => {}))
      mockSearchByEmbedding.mockResolvedValue([{ id: "vector-hit", score: 0.99 }])
      mockReadFile.mockResolvedValue("# Vector Hit\n\nstrong semantic memory")

      const searchPromise = novelMixedSearch({
        projectPath: "/project",
        query: "semantic memory",
        topK: 2,
        includeKeyword: true,
        includeVector: true,
        includeGraph: false,
        includeRecentChapters: false,
        includeCanon: false,
      })

      const timeoutSentinel = Symbol("timeout")
      const raced = Promise.race([
        searchPromise,
        new Promise<typeof timeoutSentinel>((resolve) => {
          setTimeout(() => resolve(timeoutSentinel), 3000)
        }),
      ])

      await vi.advanceTimersByTimeAsync(3000)
      const results = await raced

      expect(results).not.toBe(timeoutSentinel)
      expect(Array.isArray(results)).toBe(true)
      expect((results as Awaited<typeof searchPromise>).map((r) => r.title)).toEqual(["Vector Hit"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("excludes query-log pages when authoritativeOnly retrieval is enabled", async () => {
    mockSearchWiki.mockResolvedValue([
      searchHit("/project/wiki/queries/old-phone-query.md", "Old Query", 0.95),
      searchHit("/project/wiki/entities/spirit-stone.md", "Spirit Stone", 0.7),
    ])
    mockSearchByEmbedding.mockResolvedValue([])

    const results = await novelMixedSearch({
      projectPath: "/project",
      query: "write chapter 10 spirit stone",
      topK: 3,
      authoritativeOnly: true,
      includeKeyword: true,
      includeVector: false,
      includeGraph: false,
      includeRecentChapters: false,
      includeCanon: false,
    })

    expect(results.map((item) => item.path)).toEqual(["/project/wiki/entities/spirit-stone.md"])
  })
})
