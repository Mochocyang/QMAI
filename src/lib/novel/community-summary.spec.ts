import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFile, writeFile, createDirectory, listDirectory } from "@/commands/fs"
import { buildWikiGraph } from "@/lib/wiki-graph"
import { streamChat } from "@/lib/llm-client"
import { resolveNovelModel } from "@/lib/novel/model-resolver"
import { embedPage, searchByEmbedding } from "@/lib/embedding"
import { useWikiStore, type LlmConfig, type NovelConfig } from "@/stores/wiki-store"
import {
  MIN_COMMUNITY_SUMMARY_NODE_COUNT,
  __resetCommunitySummaryLocksForTesting,
  communityMemberFingerprint,
  generateCommunitySummaries,
  searchCommunitySummaries,
  shouldRebuildCommunitySummaries,
} from "./community-summary"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  createDirectory: vi.fn(),
  listDirectory: vi.fn(),
}))
vi.mock("@/lib/wiki-graph", () => ({ buildWikiGraph: vi.fn() }))
vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(),
  DEFAULT_LLM_REQUEST_TIMEOUT_MS: 45000,
}))
vi.mock("@/lib/novel/model-resolver", () => ({ resolveNovelModel: vi.fn() }))
vi.mock("@/lib/embedding", () => ({
  embedPage: vi.fn(),
  searchByEmbedding: vi.fn(),
}))

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockListDirectory = vi.mocked(listDirectory)
const mockBuildWikiGraph = vi.mocked(buildWikiGraph)
const mockStreamChat = vi.mocked(streamChat)
const mockResolveNovelModel = vi.mocked(resolveNovelModel)
const mockEmbedPage = vi.mocked(embedPage)
const mockSearchByEmbedding = vi.mocked(searchByEmbedding)

const llmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "sk",
  model: "gpt-4o",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 8192,
}

const novelConfig: NovelConfig = {
  contextTokenBudget: 0,
  recentSummaryWindow: 8,
  searchTopK: 5,
  chapterTargetChars: 3000,
  autoIngestOnSave: true,
  autoExtractOnImport: true,
  deepPreviousChaptersAnalysis: false,
  reviewReasoningEffort: "high",
  defaultLlmModel: "",
  writingModel: "",
  reviewModel: "",
  summaryModel: "",
  extractModel: "",
  deAiModel: "",
  deAiBatchConcurrency: 3,
  communitySummaryEnabled: true,
  communitySummaryInterval: 5,
  communitySummaryAsync: true,
  autoGenerateChapterTitle: true,
}

function node(id: string, community: number) {
  return {
    id,
    label: id,
    type: "character",
    path: `/project/wiki/${id}.md`,
    linkCount: 2,
    community,
  }
}

function community(id: number, memberIds: string[]) {
  return {
    id,
    nodeCount: memberIds.length,
    cohesion: 1,
    topNodes: memberIds.slice(0, 3),
  }
}

function graphWithCommunity(id: number, memberIds: string[]) {
  return {
    nodes: memberIds.map((memberId) => node(memberId, id)),
    communities: [community(id, memberIds)],
  }
}

describe("community member fingerprint", () => {
  it("is stable regardless of member order", () => {
    expect(communityMemberFingerprint(["b", "a", "c"])).toBe(
      communityMemberFingerprint(["c", "a", "b"]),
    )
  })

  it("changes when membership changes", () => {
    expect(communityMemberFingerprint(["a", "b", "c", "d", "e"])).not.toBe(
      communityMemberFingerprint(["a", "b", "c", "d", "f"]),
    )
  })
})

describe("shouldRebuildCommunitySummaries", () => {
  it("only triggers on interval chapter numbers", () => {
    expect(shouldRebuildCommunitySummaries(5, novelConfig)).toBe(true)
    expect(shouldRebuildCommunitySummaries(6, novelConfig)).toBe(false)
    expect(shouldRebuildCommunitySummaries(5, { ...novelConfig, communitySummaryEnabled: false })).toBe(false)
  })
})

describe("community summary incremental rebuild", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCommunitySummaryLocksForTesting()
    mockCreateDirectory.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
    mockListDirectory.mockResolvedValue([])
    mockReadFile.mockImplementation(async (path: string) => `body of ${path}`)
    mockResolveNovelModel.mockImplementation((config) => config)
    mockStreamChat.mockImplementation(async (_config, _messages, cb) => {
      cb.onToken("A community summary.")
      cb.onDone()
    })
    mockEmbedPage.mockResolvedValue(undefined)
    useWikiStore.setState({
      embeddingConfig: {
        enabled: true,
        endpoint: "http://localhost:11434/api/embeddings",
        apiKey: "",
        model: "nomic-embed-text",
      },
    })
  })

  it("locks the minimum community size at 5", () => {
    expect(MIN_COMMUNITY_SUMMARY_NODE_COUNT).toBe(5)
  })

  it("skips communities smaller than the minimum size", async () => {
    mockBuildWikiGraph.mockResolvedValue(graphWithCommunity(0, ["a", "b", "c", "d"]))

    await generateCommunitySummaries("/project", llmConfig, novelConfig)

    expect(mockStreamChat).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it("skips LLM and embed when the member fingerprint already exists", async () => {
    const members = ["a", "b", "c", "d", "e"]
    const fingerprint = communityMemberFingerprint(members)
    mockBuildWikiGraph.mockResolvedValue(graphWithCommunity(7, members))
    mockListDirectory.mockResolvedValue([{
      name: `${fingerprint}.json`,
      path: `/project/.novel/community-summaries/${fingerprint}.json`,
      is_dir: false,
    }])
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".json")) {
        return JSON.stringify({
          communityId: 0,
          memberFingerprint: fingerprint,
          memberIds: members,
          summary: "cached",
          nodeCount: 5,
          topNodes: members.slice(0, 3),
          generatedAt: "2026-01-01T00:00:00.000Z",
        })
      }
      return `body of ${path}`
    })

    await generateCommunitySummaries("/project", llmConfig, novelConfig)

    expect(mockStreamChat).not.toHaveBeenCalled()
    expect(mockEmbedPage).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it("reuses a fingerprint after Louvain renumbers the community id", async () => {
    const members = ["north", "seal", "lin", "guard", "tower"]
    const fingerprint = communityMemberFingerprint([...members].reverse())
    mockBuildWikiGraph.mockResolvedValue(graphWithCommunity(99, members))
    mockListDirectory.mockResolvedValue([{
      name: "0.json",
      path: "/project/.novel/community-summaries/0.json",
      is_dir: false,
    }])
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith("0.json")) {
        return JSON.stringify({
          communityId: 0,
          memberFingerprint: fingerprint,
          memberIds: members,
          summary: "old id, same members",
          nodeCount: 5,
          topNodes: members,
          generatedAt: "2026-01-01T00:00:00.000Z",
        })
      }
      return `body of ${path}`
    })

    await generateCommunitySummaries("/project", llmConfig, novelConfig)

    expect(mockStreamChat).not.toHaveBeenCalled()
  })

  it("calls LLM once for a large community without a stored fingerprint", async () => {
    const members = ["a", "b", "c", "d", "e"]
    const fingerprint = communityMemberFingerprint(members)
    mockBuildWikiGraph.mockResolvedValue(graphWithCommunity(1, members))

    await generateCommunitySummaries("/project", llmConfig, novelConfig)

    expect(mockStreamChat).toHaveBeenCalledTimes(1)
    expect(mockWriteFile).toHaveBeenCalledWith(
      `/project/.novel/community-summaries/${fingerprint}.json`,
      expect.stringContaining(fingerprint),
    )
    expect(mockEmbedPage).toHaveBeenCalledWith(
      "/project",
      `community:${fingerprint}`,
      expect.stringContaining("社区摘要"),
      "A community summary.",
      expect.anything(),
    )
  })

  it("coalesces concurrent rebuilds for the same project", async () => {
    const members = ["a", "b", "c", "d", "e"]
    mockBuildWikiGraph.mockResolvedValue(graphWithCommunity(1, members))
    let release!: () => void
    mockStreamChat.mockImplementation(
      () => new Promise((resolve) => {
        release = () => {
          resolve(undefined)
        }
      }),
    )

    const first = generateCommunitySummaries("/project", llmConfig, novelConfig)
    const second = generateCommunitySummaries("/project", llmConfig, novelConfig)
    await vi.waitFor(() => {
      expect(mockStreamChat).toHaveBeenCalledTimes(1)
    })
    release()
    await Promise.all([first, second])
    expect(mockStreamChat).toHaveBeenCalledTimes(1)
  })

  it("stops the loop when the ingest signal aborts", async () => {
    const members = ["a", "b", "c", "d", "e"]
    mockBuildWikiGraph.mockResolvedValue(graphWithCommunity(1, members))
    const controller = new AbortController()
    controller.abort()

    await expect(
      generateCommunitySummaries("/project", llmConfig, novelConfig, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(mockStreamChat).not.toHaveBeenCalled()
  })
})

describe("community summary vector noise control", () => {
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

  it("returns only community summaries with a strong raw chunk match", async () => {
    mockSearchByEmbedding.mockResolvedValue([
      {
        id: "community:1",
        score: 0.99,
        matchedChunks: [{ text: "Weak neighboring faction", headingPath: "Weak", score: 0.4 }],
      },
      {
        id: "community:2",
        score: 0.88,
        matchedChunks: [{
          text: "The northern faction controls the seal and opposes Lin.",
          headingPath: "Northern faction",
          score: 0.8,
        }],
      },
    ])

    const output = await searchCommunitySummaries("/project", "who controls the seal", 3)

    expect(output).toContain("社区摘要")
    expect(output).toContain("Northern faction")
    expect(output).not.toContain("Weak neighboring faction")
  })

  it("returns empty context when every community match is weak", async () => {
    mockSearchByEmbedding.mockResolvedValue([{
      id: "community:1",
      score: 0.95,
      matchedChunks: [{ text: "Weak neighboring faction", headingPath: "Weak", score: 0.4 }],
    }])

    await expect(searchCommunitySummaries("/project", "unrelated chapter task", 3)).resolves.toBe("")
  })
})
