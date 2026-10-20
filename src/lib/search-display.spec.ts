import { describe, expect, it } from "vitest"
import { buildWebResearchContext } from "@/lib/web-research"
import {
  formatWritingEntitySearchMarkdown,
  parseWritingEntitySearchWorkflowResult,
  serializeWritingEntitySearchWorkflowResult,
} from "@/lib/novel/writing-entity-web-search"
import { extractSearchDisplayDetail, splitToolResultForModel, truncateSummaryAtParagraph } from "./search-display"

const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQ" + "x".repeat(200)
const summary = "### 一、官职\n* **指挥使**：正三品。\n* **千户**：正五品。\n\n### 二、职责\n掌直驾侍卫、巡查缉捕。".padEnd(3500, "。")
const results = [
  { title: "wikipedia.org", url: REDIRECT + "1", snippet: "指挥使：正三品", source: "wikipedia.org" },
  { title: "cssn.cn", url: REDIRECT + "2", snippet: "千户：正五品 … 南镇抚司掌军匠", source: "cssn.cn" },
]

describe("Gemini 结果写给模型的上下文", () => {
  it("联网研究：只有搜索词 + 完整摘要；没有来源、编号、链接、片段", () => {
    const full = "### 一、官职\n* **指挥使**：正三品。\n\n### 二、职责\n" + "掌直驾侍卫、巡查缉捕。".repeat(250)
    const { markdown, sources } = buildWebResearchContext({
      query: "锦衣卫", searchResults: results, importedDocuments: [], failedUrls: [],
      searchQueries: ["明朝 锦衣卫 官职"], searchSummary: full,
    })
    expect(sources).toEqual([])
    expect(markdown).toContain("实际搜索词：明朝 锦衣卫 官职")
    expect(markdown).toContain(full) // 摘要完整（2750+ 字，超过旧的 1200 上限）
    expect(markdown).not.toContain("vertexaisearch")
    expect(markdown).not.toContain("[S1]")
    expect(markdown).not.toContain("wikipedia.org")
    expect(markdown).not.toContain("### 搜索结果")
    expect(markdown).not.toContain("南镇抚司掌军匠") // 片段不进上下文
    expect(markdown.length).toBeLessThanOrEqual(5000)
  })

  it("摘要单独超过预算时才截断，且截在段落边界", () => {
    const { markdown } = buildWebResearchContext({
      query: "q", searchResults: results, importedDocuments: [], failedUrls: [], searchSummary: summary.repeat(3),
    })
    expect(markdown.length).toBeLessThanOrEqual(5000)
    expect(markdown).toContain("[摘要超出预算，以下省略]")
    expect(truncateSummaryAtParagraph("A".repeat(20) + "\n\n" + "B".repeat(50), 50)).toBe("A".repeat(20) + "\n...[摘要超出预算，以下省略]")
  })

  it("写作联网补搜：同样只有搜索词 + 完整摘要", () => {
    const markdown = formatWritingEntitySearchMarkdown([
      { name: "锦衣卫", results, summary: "指挥使：正三品。", searchQueries: ["q1"] },
      { name: "东厂", results: [results[0]], summary: "东厂由宦官掌领。" },
    ])
    expect(markdown).toBe([
      "## 外部检索（仅补本地缺失实体）",
      "",
      "### 锦衣卫\n实际搜索词：q1\n搜索摘要：\n指挥使：正三品。",
      "",
      "### 东厂\n搜索摘要：\n东厂由宦官掌领。",
    ].join("\n"))
  })
})

describe("持久化与时间线数据", () => {
  it("Gemini 附加信息随写作记录保存、读回，并能取出时间线视图数据", () => {
    const text = serializeWritingEntitySearchWorkflowResult({
      searchedNames: ["锦衣卫"], notes: [], markdown: "",
      items: [{ name: "锦衣卫", results, searchQueries: ["q1", "q2"], summary: "摘要", searchSuggestionsHtml: "<div>chips</div>" }],
    })
    expect(parseWritingEntitySearchWorkflowResult(text)?.items[0]).toMatchObject({ searchQueries: ["q1", "q2"], summary: "摘要" })
    const detail = extractSearchDisplayDetail(text)
    expect(detail?.queries).toEqual(["q1", "q2"])
    expect(detail?.sources.map((s) => [s.id, s.source])).toEqual([["S1", "wikipedia.org"], ["S2", "cssn.cn"]])
    expect(detail?.suggestionsHtml).toBe("<div>chips</div>")
  })

  it("旧记录（没有附加字段）读取不变、没有结构化视图", () => {
    const old = JSON.stringify({ content: "已搜索：x", searchedNames: ["x"], notes: [], items: [{ name: "x", results: [{ title: "t", url: "https://a.com", snippet: "s", source: "a.com" }] }] })
    expect(parseWritingEntitySearchWorkflowResult(old)?.items[0]).toEqual({ name: "x", results: [{ title: "t", url: "https://a.com", snippet: "s", source: "a.com" }] })
    expect(extractSearchDisplayDetail(old)).toBeNull()
    expect(extractSearchDisplayDetail("纯文本结果")).toBeNull()
    expect(extractSearchDisplayDetail(undefined)).toBeNull()
  })

  it("web_search 工具结果：uiDisplay 只留在记录里，发给模型时去掉", () => {
    const full = JSON.stringify({ status: "ok", query: "q", provider: "gemini", resultCount: 1, results: [results[0]], queries: ["q"], summary: "s", uiDisplay: { searchSuggestionsHtml: "<div/>" } })
    const forModel = splitToolResultForModel(full)
    expect(forModel).not.toContain("uiDisplay")
    expect(JSON.parse(forModel).summary).toBe("s")
    expect(extractSearchDisplayDetail(full)?.suggestionsHtml).toBe("<div/>")
  })
})
