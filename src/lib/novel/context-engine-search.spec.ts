import { beforeEach, expect, test, vi } from "vitest"
import { useWikiStore, DEFAULT_NOVEL_CONFIG } from "@/stores/wiki-store"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(async () => []),
  readFile: vi.fn(async () => {
    throw new Error("missing")
  }),
}))

vi.mock("@/lib/search", () => ({
  searchWiki: vi.fn(async () => []),
  tokenizeQuery: (query: string) => query.split(/[\s,，。！？、]+/).filter(Boolean),
}))

vi.mock("@/lib/rerank", () => ({
  rerankCandidates: vi.fn(async (_query: string, candidates: unknown[]) => candidates),
}))

vi.mock("./search-adapter", () => ({
  isAuthoritativeGenerationPath: vi.fn(() => true),
  isHistoricalProjectionSnippet: vi.fn(() => false),
  novelMixedSearch: vi.fn(async () => []),
}))

vi.mock("./chapter-ingest", () => ({
  listSnapshots: vi.fn(async () => []),
  loadSnapshot: vi.fn(async () => null),
}))

vi.mock("./revision-feedback", () => ({
  buildRevisionDirectives: vi.fn(() => ""),
  loadRevisionFeedbackForContext: vi.fn(async () => []),
}))

vi.mock("./character-cognition", () => ({
  cognitionToContextText: vi.fn(() => ""),
  loadCognitionState: vi.fn(async () => null),
}))

vi.mock("./volume", () => ({
  getChapterVolumes: vi.fn(async () => []),
}))

vi.mock("./character-aura", () => ({
  buildCharacterAuraContext: vi.fn(async () => ""),
}))

vi.mock("./soul-doc", () => ({
  readSoulDoc: vi.fn(async () => ""),
}))

import { buildContextPack } from "./context-engine"
import { novelMixedSearch } from "./search-adapter"

beforeEach(() => {
  vi.clearAllMocks()
  useWikiStore.setState({
    novelMode: true,
    novelConfig: {
      ...DEFAULT_NOVEL_CONFIG,
      recentSummaryWindow: 1,
      searchTopK: 3,
    },
    revisionFeedbackWindowConfig: {
      currentChapterIncludeShouldImprove: true,
      previousChapterCarryEnabled: true,
      lookbackChapterCount: 1,
      lookbackIncludeMustFixOnly: true,
    },
  })
})

test("context mixed search leaves graph search to the dedicated graph context branch", async () => {
  await buildContextPack("/Project", "审核第2章", 2)

  expect(novelMixedSearch).toHaveBeenCalledWith(expect.objectContaining({
    includeGraph: false,
    includeKeyword: true,
    includeVector: true,
  }))
})
