import { beforeEach, describe, expect, it, vi } from "vitest"

const antigravitySearchDetailed = vi.fn()
vi.mock("@/lib/antigravity-search", () => ({ antigravitySearchDetailed: (...a: unknown[]) => antigravitySearchDetailed(...a) }))

import { providerRequiresApiKey, resolveSearchConfig, webSearch, webSearchDetailed } from "./web-search"
import { formatWritingEntitySearchMarkdown } from "./novel/writing-entity-web-search"
import { buildWebResearchContext } from "./web-research"
import type { SearchApiConfig } from "@/stores/wiki-store"

const config = (provider: SearchApiConfig["provider"], extra: Partial<SearchApiConfig> = {}): SearchApiConfig =>
  ({ provider, apiKey: "", ...extra }) as SearchApiConfig

describe("反重力 CLI 搜索源", () => {
  beforeEach(() => {
    antigravitySearchDetailed.mockReset()
    antigravitySearchDetailed.mockResolvedValue({
      queries: ["T-80BVM"],
      summary: "第一段。\n\n第二段。",
      results: [{ title: "src", url: "https://example.com/a", snippet: "片段", source: "example.com" }],
    })
  })

  it("不需要 Key，切换后走反重力 CLI 并带上模型设置", async () => {
    expect(providerRequiresApiKey("antigravity")).toBe(false)
    const cfg = config("antigravity", { providerConfigs: { antigravity: { antigravityModel: "gemini-x" } } })
    const out = await webSearchDetailed("T-80BVM", cfg, 6)
    expect(antigravitySearchDetailed).toHaveBeenCalledWith("T-80BVM", { model: "gemini-x", maxResults: 6 })
    expect(out.queries).toEqual(["T-80BVM"])
    expect(out.summary).toBe("第一段。\n\n第二段。")
    expect(out.searchSuggestionsHtml).toBeUndefined()
    expect((await webSearch("T-80BVM", cfg)).map((r) => r.url)).toEqual(["https://example.com/a"])
  })

  it("不会继承顶层 Key，也不影响其它来源的解析", () => {
    const resolved = resolveSearchConfig(config("antigravity"))
    expect(resolved.provider).toBe("antigravity")
    const tavily = resolveSearchConfig(config("tavily", { apiKey: "k" }))
    expect(tavily.apiKey).toBe("k")
    expect(antigravitySearchDetailed).not.toHaveBeenCalled()
  })

  it("切回其它来源时不调用反重力 CLI", async () => {
    await expect(webSearchDetailed("x", config("none"))).rejects.toThrow()
    expect(antigravitySearchDetailed).not.toHaveBeenCalled()
  })

  it("错误原样向上抛（中文说明），由调用方记进 notes", async () => {
    antigravitySearchDetailed.mockRejectedValue(new Error("Antigravity CLI 未登录。"))
    await expect(webSearchDetailed("x", config("antigravity"))).rejects.toThrow("未登录")
  })

  it("写作上下文与 Gemini 一致：只有搜索词 + 完整摘要，没有来源和片段", () => {
    const md = formatWritingEntitySearchMarkdown([
      { name: "T-80BVM", results: [{ title: "src", url: "https://example.com/a", snippet: "片段", source: "example.com" }], searchQueries: ["T-80BVM"], summary: "第一段。\n\n第二段。" },
    ])
    expect(md).toContain("### T-80BVM\n实际搜索词：T-80BVM\n搜索摘要：\n第一段。\n\n第二段。")
    expect(md).not.toContain("https://example.com/a")
    expect(md).not.toContain("片段")
    const ctx = buildWebResearchContext({
      query: "T-80BVM",
      urls: [],
      searchResults: [{ title: "src", url: "https://example.com/a", snippet: "片段", source: "example.com" }],
      importedDocuments: [],
      failedUrls: [],
      notes: [],
      searchQueries: ["T-80BVM"],
      searchSummary: "第一段。\n\n第二段。",
    } as Parameters<typeof buildWebResearchContext>[0])
    expect(ctx.markdown).toContain("实际搜索词：T-80BVM")
    expect(ctx.markdown).toContain("第一段。\n\n第二段。")
    expect(ctx.markdown).not.toContain("https://example.com/a")
    expect(ctx.markdown).not.toContain("片段")
  })
})
