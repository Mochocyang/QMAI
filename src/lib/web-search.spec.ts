import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SearchApiConfig } from "@/stores/wiki-store"
import {
  normalizeBochaResults,
  normalizeMetasoResults,
  normalizeQiniuResults,
  providerRequiresApiKey,
  webSearch,
} from "./web-search"

const fetchMock = vi.fn()

vi.mock("@/lib/tauri-fetch", () => ({
  getHttpFetch: async () => fetchMock,
  isFetchNetworkError: () => false,
}))

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function config(provider: SearchApiConfig["provider"], apiKey = "test-key"): SearchApiConfig {
  return {
    provider,
    apiKey,
    serpApiEngine: "google",
    searXngUrl: "",
    searXngCategories: ["general"],
    providerConfigs: {
      [provider]: { apiKey },
    },
  }
}

describe("CN web search providers", () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  afterEach(() => {
    fetchMock.mockReset()
  })

  it("providerRequiresApiKey covers domestic and international key-based providers", () => {
    expect(providerRequiresApiKey("bocha")).toBe(true)
    expect(providerRequiresApiKey("qiniu")).toBe(true)
    expect(providerRequiresApiKey("metaso")).toBe(true)
    expect(providerRequiresApiKey("tavily")).toBe(true)
    expect(providerRequiresApiKey("serpapi")).toBe(true)
    expect(providerRequiresApiKey("searxng")).toBe(false)
    expect(providerRequiresApiKey("none")).toBe(false)
  })

  it("normalizeBochaResults maps nested data.webPages.value and bare webPages", () => {
    const nested = normalizeBochaResults(
      {
        code: 200,
        data: {
          webPages: {
            value: [
              {
                name: "博查结果",
                url: "https://www.example.com/a",
                snippet: "摘要",
                siteName: "example",
              },
              {
                title: "fallback title",
                url: "https://news.example.com/b",
                summary: "summary only",
              },
              { name: "no url" },
            ],
          },
        },
      },
      10,
    )

    expect(nested).toEqual([
      {
        title: "博查结果",
        url: "https://www.example.com/a",
        snippet: "摘要",
        source: "example",
      },
      {
        title: "fallback title",
        url: "https://news.example.com/b",
        snippet: "summary only",
        source: "news.example.com",
      },
    ])

    // Prefer summary over short snippet when both exist.
    expect(
      normalizeBochaResults(
        {
          code: 200,
          data: {
            webPages: {
              value: [
                {
                  name: "both",
                  url: "https://example.com/both",
                  snippet: "short",
                  summary: "long summary",
                  siteName: "ex",
                },
              ],
            },
          },
        },
        5,
      )[0].snippet,
    ).toBe("long summary")

    expect(
      normalizeBochaResults(
        {
          webPages: {
            value: [{ name: "bare", url: "https://bare.example/", snippet: "x" }],
          },
        },
        5,
      ),
    ).toHaveLength(1)

    expect(() => normalizeBochaResults({ code: 401, msg: "unauthorized" }, 5)).toThrow("unauthorized")
  })

  it("normalizeQiniuResults maps data.results and rejects non-success", () => {
    expect(() =>
      normalizeQiniuResults({ success: false, message: "quota exceeded" }, 5),
    ).toThrow("quota exceeded")
    expect(() => normalizeQiniuResults({ success: undefined }, 5)).toThrow("Qiniu web search failed")

    const results = normalizeQiniuResults(
      {
        success: true,
        data: {
          results: [
            {
              title: "七牛结果",
              url: "https://baidu.example.com/x",
              content: "正文",
              source: "百度",
            },
          ],
        },
      },
      5,
    )
    expect(results).toEqual([
      {
        title: "七牛结果",
        url: "https://baidu.example.com/x",
        snippet: "正文",
        source: "百度",
      },
    ])
  })

  it("normalizeMetasoResults maps webpages link/snippet", () => {
    const results = normalizeMetasoResults(
      {
        webpages: [
          {
            title: "秘塔结果",
            link: "https://www.metaso.example/page",
            snippet: "干净摘要",
          },
        ],
      },
      3,
    )
    expect(results).toEqual([
      {
        title: "秘塔结果",
        url: "https://www.metaso.example/page",
        snippet: "干净摘要",
        source: "metaso.example",
      },
    ])
  })

  it("bochaSearch posts Bearer auth and returns normalized results", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        code: 200,
        data: {
          webPages: {
            value: [
              {
                name: "博查",
                url: "https://example.com/bocha",
                snippet: "ok",
                siteName: "example",
              },
            ],
          },
        },
      }),
    )

    const results = await webSearch("黄蓉", config("bocha"), 3)

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.bochaai.com/v1/web-search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    )
    expect(results[0]).toMatchObject({
      title: "博查",
      url: "https://example.com/bocha",
      source: "example",
    })
  })

  it("qiniuSearch posts Bearer auth and returns normalized results", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        success: true,
        data: {
          results: [
            {
              title: "七牛",
              url: "https://example.com/qiniu",
              content: "baidu",
              source: "baidu",
            },
          ],
        },
      }),
    )

    const results = await webSearch("黄蓉", config("qiniu"), 2)

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.qnaigc.com/v1/search/web",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    )
    expect(results[0].title).toBe("七牛")
  })

  it("metasoSearch posts Bearer auth and returns normalized results", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        webpages: [
          {
            title: "秘塔",
            link: "https://example.com/metaso",
            snippet: "clean",
          },
        ],
      }),
    )

    const results = await webSearch("黄蓉", config("metaso"), 2)

    expect(fetchMock).toHaveBeenCalledWith(
      "https://metaso.cn/api/v1/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    )
    expect(results[0]).toMatchObject({
      title: "秘塔",
      url: "https://example.com/metaso",
      source: "example.com",
    })
  })

  it("rejects missing api key for domestic providers", async () => {
    await expect(webSearch("q", config("bocha", ""))).rejects.toThrow("Settings → 网页搜索")
    await expect(webSearch("q", config("qiniu", ""))).rejects.toThrow("Settings → 网页搜索")
    await expect(webSearch("q", config("metaso", ""))).rejects.toThrow("Settings → 网页搜索")
  })
})
