import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SearchApiConfig } from "@/stores/wiki-store"
import { createWebSearchTool } from "./web-search"

const webSearchMock = vi.fn()
/** 内置插件「网页搜索」是否开启；默认 true，个别用例会临时关掉。 */
let webSearchEnabledFlag = true

vi.mock("@/lib/web-search", () => ({
  resolveSearchConfig: (config: SearchApiConfig) => config,
  providerRequiresApiKey: (provider: SearchApiConfig["provider"]) =>
    provider === "bocha" ||
    provider === "qiniu" ||
    provider === "metaso" ||
    provider === "tavily" ||
    provider === "serpapi" ||
    provider === "gemini",
  // 工具层要读内置插件开关；本文件整体 mock 了 @/lib/web-search，
  // 所以这两个新导出也必须给出，否则执行时会报 "No export defined on the mock"。
  isWebSearchEnabled: () => webSearchEnabledFlag,
  WEB_SEARCH_DISABLED_MESSAGE: "网页搜索已在「插件」中关闭，本次未联网搜索",
  webSearch: (...args: unknown[]) => webSearchMock(...args),
  webSearchDetailed: async (...args: unknown[]) => {
    const value = await webSearchMock(...args)
    return Array.isArray(value) ? { results: value } : value
  },
}))

const notConfigured: SearchApiConfig = {
  provider: "none",
  apiKey: "",
  serpApiEngine: "google",
  searXngUrl: "",
  searXngCategories: ["general"],
  providerConfigs: {},
}

const configured: SearchApiConfig = {
  provider: "tavily",
  apiKey: "test-key",
  serpApiEngine: "google",
  searXngUrl: "",
  searXngCategories: ["general"],
  providerConfigs: {},
}

describe("createWebSearchTool", () => {
  beforeEach(() => {
  webSearchMock.mockReset()
  // 每个用例从"开启"开始，避免某条关掉后污染后面的用例
  webSearchEnabledFlag = true
  })

  it("未配置外部搜索时返回中文降级结果，且不假装已经搜索", async () => {
    const tool = createWebSearchTool(() => notConfigured)

    const raw = await tool.execute({ query: "黄蓉", maxResults: 3 })
    const result = JSON.parse(raw)

    expect(result.status).toBe("not_configured")
    expect(result.query).toBe("黄蓉")
    expect(result.resultCount).toBe(0)
    expect(result.message).toContain("当前未配置外部搜索")
    expect(result.message).toContain("未执行联网搜索")
    expect(result.message).toContain("设置 → 网页搜索")
    expect(result.message).toContain("博查")
    expect(webSearchMock).not.toHaveBeenCalled()
  })

  it("已配置外部搜索时返回标题、摘要、链接和来源", async () => {
    webSearchMock.mockResolvedValueOnce([
      {
        title: "黄蓉 - 人物资料",
        url: "https://example.com/huang-rong",
        snippet: "黄蓉是金庸小说中的人物。",
        source: "example.com",
      },
    ])
    const tool = createWebSearchTool(() => configured)

    const raw = await tool.execute({ query: "黄蓉", maxResults: 1 })
    const result = JSON.parse(raw)

    expect(webSearchMock).toHaveBeenCalledWith("黄蓉", configured, 1)
    expect(result.status).toBe("ok")
    expect(result.provider).toBe("tavily")
    expect(result.resultCount).toBe(1)
    expect(result.results[0]).toMatchObject({
      title: "黄蓉 - 人物资料",
      url: "https://example.com/huang-rong",
      snippet: "黄蓉是金庸小说中的人物。",
      source: "example.com",
    })
  })

  it("搜索失败时返回中文失败结果，明确本次未使用联网资料", async () => {
    webSearchMock.mockRejectedValueOnce(new Error("timeout"))
    const tool = createWebSearchTool(() => configured)

    const raw = await tool.execute({ query: "黄蓉" })
    const result = JSON.parse(raw)

    expect(result.status).toBe("error")
    expect(result.resultCount).toBe(0)
    expect(result.message).toContain("外部搜索失败")
    expect(result.message).toContain("本次未使用联网资料")
  })

  it("Gemini 后端返回实际搜索词与综合摘要", async () => {
    webSearchMock.mockResolvedValueOnce({
      results: [{ title: "olympics.com", url: "https://r.example/a", snippet: "中国获得40枚金牌", source: "olympics.com" }],
      queries: ["2024年巴黎奥运会中国金牌数"],
      summary: "中国获得40枚金牌。",
    })
    const tool = createWebSearchTool(() => ({ provider: "gemini", apiKey: "k" }))
    const result = JSON.parse(await tool.execute({ query: "中国金牌数" }))
    expect(result.status).toBe("ok")
    expect(result.queries).toEqual(["2024年巴黎奥运会中国金牌数"])
    expect(result.summary).toBe("中国获得40枚金牌。")
    expect(result.resultCount).toBe(1)
  })
})

describe("web_search 工具超时随反重力设置变化", () => {
  it("未设置时按 180 秒 + 余量；设置后跟随", () => {
    let config = { provider: "antigravity", apiKey: "" } as unknown as SearchApiConfig
    const tool = createWebSearchTool(() => config)
    expect(tool.executeTimeoutMs).toBe(210_000)
    config = { provider: "antigravity", apiKey: "", providerConfigs: { antigravity: { antigravityTimeoutSecs: 600 } } } as unknown as SearchApiConfig
    expect(tool.executeTimeoutMs).toBe(630_000)
    expect(createWebSearchTool().executeTimeoutMs).toBe(210_000)
  })
})

  describe("内置插件「网页搜索」关闭后", () => {
    const configured: SearchApiConfig = {
      provider: "bocha",
      apiKey: "k",
      serpApiEngine: "google",
      searXngUrl: "",
      searXngCategories: ["general"],
      providerConfigs: {},
    }

    it("工具仍在清单里，执行时返回 disabled 并指向插件页", async () => {
      webSearchEnabledFlag = false
      const tool = createWebSearchTool(() => configured)

      const raw = await tool.execute({ query: "测试" })
      const result = JSON.parse(String(raw))

      expect(result.status).toBe("disabled")
      expect(result.resultCount).toBe(0)
      expect(result.message).toContain("插件")
      // 关键：不能悄悄去搜
      expect(webSearchMock).not.toHaveBeenCalled()
    })

    it("开启后照常搜索（关闭不是永久态）", async () => {
      webSearchEnabledFlag = true
      webSearchMock.mockResolvedValue([{ title: "t", url: "u", snippet: "s", source: "bocha" }])
      const tool = createWebSearchTool(() => configured)

      const raw = await tool.execute({ query: "测试" })
      const result = JSON.parse(String(raw))

      expect(result.status).toBe("ok")
      expect(webSearchMock).toHaveBeenCalled()
    })
  })
