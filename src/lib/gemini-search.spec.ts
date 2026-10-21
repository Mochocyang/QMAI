import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SearchApiConfig } from "@/stores/wiki-store"

const fetchMock = vi.fn()
vi.mock("@/lib/tauri-fetch", () => ({
  getHttpFetch: async () => fetchMock,
  isFetchNetworkError: (err: unknown) => err instanceof TypeError,
}))

import { geminiSearchDetailed, parseGeminiGenerateContent, parseGeminiInteraction, sliceUtf8 } from "./gemini-search"
import { webSearch, webSearchDetailed } from "./web-search"
import { collectWebResearch, buildWebResearchContext } from "./web-research"

const enc = new TextEncoder()
const byteIndex = (text: string, part: string) => enc.encode(text.slice(0, text.indexOf(part))).length
const byteEnd = (text: string, part: string) => byteIndex(text, part) + enc.encode(part).length

// 结构取自真实响应（中文查询「2024年巴黎奥运会中国金牌数」），下标是 UTF-8 字节偏移。
const TEXT = "在2024年巴黎奥运会上，中国体育代表团共获得了 **40枚金牌**。\n\n银牌27枚，铜牌24枚。"
const PART_A = "在2024年巴黎奥运会上，中国体育代表团共获得了 **40枚金牌**"
const PART_B = "银牌27枚，铜牌24枚。"
const interaction = {
  steps: [
    { type: "google_search_call", arguments: { queries: ["2024年巴黎奥运会中国金牌数"] } },
    { type: "google_search_result", result: [{ search_suggestions: "<div class=\"chip\">建议</div>" }] },
    { type: "thought", summary: [] },
    {
      type: "model_output",
      content: [{
        type: "text",
        text: TEXT,
        annotations: [
          { type: "url_citation", url: "https://r.example/a", title: "chinadaily.com.cn", start_index: byteIndex(TEXT, PART_A), end_index: byteEnd(TEXT, PART_A) },
          { type: "url_citation", url: "https://r.example/b", title: "olympics.com", start_index: byteIndex(TEXT, PART_A), end_index: byteEnd(TEXT, PART_A) },
          { type: "url_citation", url: "https://r.example/a", title: "chinadaily.com.cn", start_index: byteIndex(TEXT, PART_B), end_index: byteEnd(TEXT, PART_B) },
        ],
      }],
    },
  ],
}

const generateContent = {
  candidates: [{
    content: { parts: [{ text: TEXT }] },
    groundingMetadata: {
      webSearchQueries: ["2024 巴黎奥运会 中国 金牌数"],
      searchEntryPoint: { renderedContent: "<div>chips</div>" },
      groundingChunks: [{ web: { uri: "https://r.example/w", title: "wikipedia.org" } }, { web: { uri: "https://r.example/c", title: "chinadaily.com.cn" } }],
      groundingSupports: [{ segment: { endIndex: byteEnd(TEXT, PART_A), text: PART_A }, groundingChunkIndices: [0, 1] }],
    },
  }],
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const config = (extra: Partial<SearchApiConfig> = {}): SearchApiConfig => ({
  provider: "gemini",
  apiKey: "",
  providerConfigs: { gemini: { apiKey: "test-key", geminiModel: "", geminiBaseUrl: "" } },
  ...extra,
})

beforeEach(() => fetchMock.mockReset())

describe("Gemini 搜索解析", () => {
  it("按 UTF-8 字节偏移切中文引用片段", () => {
    expect(sliceUtf8(TEXT, byteIndex(TEXT, PART_B), byteEnd(TEXT, PART_B))).toBe(PART_B)
  })

  it("Interactions：搜索词、按来源合并的引用、摘要、搜索建议", () => {
    const out = parseGeminiInteraction(interaction)
    expect(out.queries).toEqual(["2024年巴黎奥运会中国金牌数"])
    expect(out.summary).toBe(TEXT)
    expect(out.searchSuggestionsHtml).toContain("chip")
    expect(out.results).toEqual([
      { title: "chinadaily.com.cn", url: "https://r.example/a", snippet: `${PART_A.replace(/\*\*/g, "")} … ${PART_B}`, source: "chinadaily.com.cn" },
      { title: "olympics.com", url: "https://r.example/b", snippet: PART_A.replace(/\*\*/g, ""), source: "olympics.com" },
    ])
  })

  it("generateContent：groundingMetadata 映射", () => {
    const out = parseGeminiGenerateContent(generateContent)
    expect(out.queries).toEqual(["2024 巴黎奥运会 中国 金牌数"])
    expect(out.results.map((r) => [r.source, r.snippet])).toEqual([["wikipedia.org", PART_A.replace(/\*\*/g, "")], ["chinadaily.com.cn", PART_A.replace(/\*\*/g, "")]])
    expect(out.searchSuggestionsHtml).toBe("<div>chips</div>")
  })
})

describe("Gemini 搜索请求", () => {
  it("默认走 Interactions，带 key 头与默认模型", async () => {
    fetchMock.mockResolvedValueOnce(json(200, interaction))
    const out = await geminiSearchDetailed("中国金牌数", { apiKey: "k" })
    expect(out.endpoint).toBe("interactions")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions")
    expect(init.headers["x-goog-api-key"]).toBe("k")
    const body = JSON.parse(init.body)
    expect(body.model).toBe("gemini-3.8-flash")
    expect(body.tools).toEqual([{ type: "google_search" }])
  })

  it("Interactions 404 时回退 generateContent（自定义地址、自定义模型）", async () => {
    fetchMock.mockResolvedValueOnce(json(404, { error: { message: "not found" } })).mockResolvedValueOnce(json(200, generateContent))
    const out = await geminiSearchDetailed("q", { apiKey: "k", baseUrl: "proxy.example.com/v1beta/", model: "gemini-2.5-flash" })
    expect(out.endpoint).toBe("generateContent")
    expect(fetchMock.mock.calls[1][0]).toBe("https://proxy.example.com/v1beta/models/gemini-2.5-flash:generateContent")
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).tools).toEqual([{ google_search: {} }])
  })

  it.each([
    [401, "API Key 无效"],
    [429, "额度或频率超限"],
    [503, "服务暂时不可用"],
  ])("HTTP %i 给出中文错误", async (status, text) => {
    fetchMock.mockResolvedValueOnce(json(status, { error: { message: "x" } }))
    await expect(geminiSearchDetailed("q", { apiKey: "k" })).rejects.toThrow(text)
  })

  it("key 无效时（实测为 400 + API_KEY_INVALID）提示检查 key", async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } }))
    await expect(geminiSearchDetailed("q", { apiKey: "bad" })).rejects.toThrow("API Key 无效或已过期")
  })

  it("缺 key、无引用、网络错误", async () => {
    await expect(geminiSearchDetailed("q", { apiKey: " " })).rejects.toThrow("未配置 Gemini API Key")
    fetchMock.mockResolvedValueOnce(json(200, { steps: [{ type: "model_output", content: [{ type: "text", text: "凭记忆回答" }] }] }))
    await expect(geminiSearchDetailed("q", { apiKey: "k" })).rejects.toThrow("没有给出引用来源")
    fetchMock.mockRejectedValueOnce(new TypeError("Load failed"))
    await expect(geminiSearchDetailed("q", { apiKey: "k" })).rejects.toThrow("无法连接 Gemini")
  })
})

describe("接入现有联网查询流程", () => {
  it("webSearch / webSearchDetailed 选择 gemini 后端", async () => {
    fetchMock.mockImplementation(async () => json(200, interaction))
    expect((await webSearch("q", config())).length).toBe(2)
    const detailed = await webSearchDetailed("q", config())
    expect(detailed.queries).toEqual(["2024年巴黎奥运会中国金牌数"])
    expect(detailed.summary).toBe(TEXT)
  })

  it("未填 key 时 webSearch 报中文错误且不发请求", async () => {
    await expect(webSearch("q", { provider: "gemini", apiKey: "", providerConfigs: { gemini: {} } })).rejects.toThrow("Gemini API Key")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("联网研究上下文带上实际搜索词与 Gemini 摘要；搜索失败只记一条说明", async () => {
    fetchMock.mockResolvedValueOnce(json(200, interaction))
    const research = await collectWebResearch({ text: "搜索 巴黎奥运会金牌", searchApiConfig: config(), allowReadUrls: false })
    const { markdown } = buildWebResearchContext(research)
    expect(markdown).toContain("实际搜索词：2024年巴黎奥运会中国金牌数")
    expect(markdown).toContain("搜索摘要")
    expect(markdown).toContain(TEXT)
    expect(markdown).not.toContain("chinadaily.com.cn") // Gemini 来源只在时间线展示

    fetchMock.mockResolvedValueOnce(json(500, {}))
    const failed = await collectWebResearch({ text: "搜索 巴黎奥运会金牌", searchApiConfig: config(), allowReadUrls: false })
    expect(failed.searchResults).toEqual([])
    expect(failed.notes[0]).toContain("Gemini 服务暂时不可用")
  })
})
