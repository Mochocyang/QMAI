import { describe, expect, it } from "vitest"
import { getDataSourceNamesForCategories } from "./context-data-sources"

describe("getDataSourceNamesForCategories", () => {
  it("returns only data sources that belong to allowed classification categories", () => {
    const names = getDataSourceNamesForCategories(["soul", "settings", "outline"])

    expect(names).toContain("soulDoc")
    expect(names).toContain("relatedSettings")
    expect(names).toContain("canonRules")
    expect(names).toContain("outline")
    expect(names).toContain("chapterOutline")
    expect(names).not.toContain("recentChapterContents")
    expect(names).not.toContain("searchResults")
    expect(names).not.toContain("graphSearchResults")
  })

  it("keeps multi-purpose snapshot and retrieval sources when any matching category is allowed", () => {
    const names = getDataSourceNamesForCategories(["recent_summaries"])

    expect(names).toContain("retrieval")
    expect(names).toContain("snapshots")
    expect(names).toContain("fallbackRecentSummaries")
    expect(names).not.toContain("recentChapterContents")
  })
})
