import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SearchApiConfig } from "@/stores/wiki-store"
import { createWebSearchTool } from "./web-search"

const webSearchMock = vi.fn()

vi.mock("@/lib/web-search", () => ({
  resolveSearchConfig: (config: SearchApiConfig) => config,
  webSearch: (...args: unknown[]) => webSearchMock(...args),
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
})
