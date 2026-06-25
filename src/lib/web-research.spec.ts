import { describe, expect, it } from "vitest"
import {
  buildWebResearchContext,
  extractWebUrls,
  shouldUseWebResearch,
} from "./web-research"

describe("web research helpers", () => {
  it("detects explicit web research requests and URLs", () => {
    expect(shouldUseWebResearch("联网搜索一下都市小说热门题材")).toBe(true)
    expect(shouldUseWebResearch("打开 https://example.com/book/1 分析这个网页")).toBe(true)
    expect(shouldUseWebResearch("帮我生成第七章内容")).toBe(false)
  })

  it("extracts http and https URLs without trailing punctuation", () => {
    expect(extractWebUrls("参考 https://example.com/a，另一个是 http://foo.test/b.")).toEqual([
      "https://example.com/a",
      "http://foo.test/b",
    ])
  })

  it("builds a bounded research context with sources", () => {
    const context = buildWebResearchContext({
      query: "玄幻小说热门套路",
      searchResults: [
        {
          title: "热门趋势",
          url: "https://example.com/hot",
          source: "example.com",
          snippet: "近期读者更关注强冲突开篇。",
        },
      ],
      importedDocuments: [
        {
          title: "榜单分析",
          url: "https://example.com/rank",
          source: "example.com",
          content: "榜单前排作品普遍在前三百字给出危机，并在第一章结尾留下明确钩子。".repeat(80),
        },
      ],
      failedUrls: ["https://example.com/fail"],
    })

    expect(context.markdown).toContain("## 联网研究资料")
    expect(context.markdown).toContain("搜索问题：玄幻小说热门套路")
    expect(context.markdown).toContain("https://example.com/hot")
    expect(context.markdown).toContain("https://example.com/rank")
    expect(context.markdown).toContain("读取失败")
    expect(context.sources).toEqual([
      "热门趋势 - https://example.com/hot",
      "榜单分析 - https://example.com/rank",
    ])
    expect(context.markdown.length).toBeLessThan(5200)
  })
})
