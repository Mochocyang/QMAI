import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { BookAnalysisUsageSummary } from "./book-analysis-usage-summary"

const render = (task: Parameters<typeof BookAnalysisUsageSummary>[0]["task"]) => renderToStaticMarkup(createElement(BookAnalysisUsageSummary, { task }))
describe("拆书用量账本", () => {
  it("本地结果复用与供应商输入缓存分开显示，汇总总量不取32条明细的子集", () => {
    const html = render({ requestUsageTotals: { requestCount: 40, inputTokens: 4000, outputTokens: 400, cachedInputTokens: 3200, cacheWriteInputTokens: 0 },
      omittedRequestTraceCount: 8, resultReuse: { chunkChecks: 3, chunkHits: 2, aggregateChecks: 1, aggregateHits: 1 } })
    expect(html).toContain("模型输入缓存命中率")
    expect(html).toContain("80.0%")
    expect(html).toContain("已记录请求：40")
    expect(html).toContain("本地结果复用：区块 2/3，汇总 1/1")
    expect(html).toContain("8 条较早明细")
    expect(html).toContain("max-h-48")
    expect(html).toContain("overflow-y-auto")
    expect(html).not.toContain("节省费用")
  })
  it("缺失供应商字段不伪装为0%，明确零命中才显示0%", () => {
    expect(render({ requestUsageTotals: { requestCount: 2, inputTokens: 100 } })).toContain("未完整提供")
    expect(render({ requestUsageTotals: { requestCount: 1, inputTokens: 100, cachedInputTokens: 0 } })).toContain("0.0%")
    expect(render({})).toBe("")
  })
})
