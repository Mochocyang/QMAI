import { beforeEach, expect, test, vi } from "vitest"

vi.mock("@/lib/search", () => ({
  searchWiki: vi.fn(async () => []),
}))

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async () => {
    throw new Error("missing")
  }),
}))

vi.mock("@/lib/rerank", () => ({
  rerankCandidates: vi.fn(async (_query: string, candidates: unknown[]) => candidates),
}))

import { searchWiki } from "@/lib/search"
import { novelMixedSearch } from "./search-adapter"

beforeEach(() => {
  vi.clearAllMocks()
})

test("keyword branch disables searchWiki vector pass when mixed search has its own vector branch", async () => {
  await novelMixedSearch({
    projectPath: "/Project",
    query: "第4章 审稿",
    topK: 5,
    includeKeyword: true,
    includeVector: true,
    includeGraph: false,
    includeRecentChapters: false,
    includeCanon: false,
  })

  expect(searchWiki).toHaveBeenCalledWith(
    "/Project",
    "第4章 审稿",
    expect.objectContaining({ includeVector: false }),
  )
})
