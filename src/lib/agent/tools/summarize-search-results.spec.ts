import { describe, expect, it } from "vitest"
import type { Tool } from "../types"
import { createSummarizeSearchResultsTool } from "./summarize-search-results"

const MOCK_OK_RESULTS = JSON.stringify({
  status: "ok",
  query: "黄蓉 人物介绍",
  provider: "tavily",
  resultCount: 3,
  results: [
    {
      title: "黄蓉 - 百度百科",
      url: "https://baike.baidu.com/item/%E9%BB%84%E8%93%89",
      snippet: "黄蓉是金庸小说《射雕英雄传》中的女主角...",
      source: "baike.baidu.com",
    },
    {
      title: "黄蓉角色分析",
      url: "https://example.com/huangrong",
      snippet: "黄蓉聪明伶俐，多才多艺...",
      source: "example.com",
    },
    {
      title: "射雕英雄传人物关系",
      url: "https://example.com/shediao",
      snippet: "黄蓉与郭靖的感情线是主线...",
      source: "example.com",
    },
  ],
})

const MOCK_NOT_CONFIGURED_RESULT = JSON.stringify({
  status: "not_configured",
  query: "测试",
  provider: "none",
  resultCount: 0,
  results: [],
  message: "当前未配置外部搜索，无法联网查询。",
})

describe("createSummarizeSearchResultsTool", () => {
  it("压缩有效搜索结果，输出关键信息摘要、来源列表和不确定说明", async () => {
    const tool: Tool = createSummarizeSearchResultsTool()

    const raw = await tool.execute({ results: MOCK_OK_RESULTS, query: "黄蓉 人物介绍" })
    const result = JSON.parse(raw)

    expect(result.status).toBe("ok")
    expect(result.query).toBe("黄蓉 人物介绍")
    expect(result.sourceCount).toBe(3)
    expect(result.summary).toContain("黄蓉")
    expect(result.sources).toContain("baike.baidu.com")
    expect(result.sources).toContain("example.com")
    expect(typeof result.summary).toBe("string")
    expect(result.summary.length).toBeGreaterThan(20)
  })

  it("未配置搜索的结果被识别并输出降级摘要", async () => {
    const tool: Tool = createSummarizeSearchResultsTool()

    const raw = await tool.execute({ results: MOCK_NOT_CONFIGURED_RESULT })
    const result = JSON.parse(raw)

    expect(result.status).toBe("not_configured")
    expect(result.query).toBe("测试")
    expect(result.sourceCount).toBe(0)
    expect(result.summary).toContain("未配置外部搜索")
    expect(result.sources).toEqual([])
  })

  it("空结果或无效 JSON 时返回错误摘要", async () => {
    const tool: Tool = createSummarizeSearchResultsTool()

    const raw = await tool.execute({ results: "invalid json" })
    const result = JSON.parse(raw)

    expect(result.status).toBe("error")
    expect(result.summary).toContain("解析失败")
    expect(result.sourceCount).toBe(0)
  })

  it("不传 results 参数时返回错误", async () => {
    const tool: Tool = createSummarizeSearchResultsTool()

    const raw = await tool.execute({})
    const result = JSON.parse(raw)

    expect(result.status).toBe("error")
    expect(result.sourceCount).toBe(0)
  })
})
