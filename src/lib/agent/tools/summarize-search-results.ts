import type { Tool } from "../types"

export interface SummarizeSearchResultsResult {
  status: "ok" | "not_configured" | "error"
  query: string
  sourceCount: number
  summary: string
  sources: string[]
  message?: string
}

interface RawSearchResult {
  status?: string
  query?: string
  provider?: string
  resultCount?: number
  results?: Array<{ title: string; url: string; snippet: string; source: string }>
  message?: string
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + "..." + `（已截断，原文${str.length}字符）`
}

export function createSummarizeSearchResultsTool(): Tool {
  return {
    name: "summarize_search_results",
    description: "把 web_search 返回的原始搜索结果压缩成适合 AI 上下文的知识摘要。提取关键信息、来源列表和不确定说明。",
    category: "action",
    parameters: {
      results: { type: "string", description: "web_search 工具返回的原始 JSON 结果字符串", required: true },
      query: { type: "string", description: "搜索时使用的关键词" },
      maxSummaryChars: { type: "integer", description: "摘要最大字符数，默认 2000，最大 8000" },
    },
    execute: async (params) => {
      const resultsJson = String(params.results ?? "").trim()
      const query = String(params.query ?? "").trim()

      if (!resultsJson) {
        const result: SummarizeSearchResultsResult = {
          status: "error",
          query,
          sourceCount: 0,
          summary: "未提供搜索结果数据，无法生成摘要。",
          sources: [],
        }
        return JSON.stringify(result)
      }

      let parsed: RawSearchResult
      try {
        parsed = JSON.parse(resultsJson)
      } catch {
        const result: SummarizeSearchResultsResult = {
          status: "error",
          query,
          sourceCount: 0,
          summary: "搜索结果解析失败：提供的 JSON 格式不正确，无法生成摘要。",
          sources: [],
        }
        return JSON.stringify(result)
      }

      const results = Array.isArray(parsed.results) ? parsed.results : []
      const status = parsed.status ?? "error"
      const rawQuery = parsed.query ?? query

      if (status === "not_configured") {
        const result: SummarizeSearchResultsResult = {
          status: "not_configured",
          query: rawQuery,
          sourceCount: 0,
          summary: `搜索未执行：${parsed.message ?? "当前未配置外部搜索"}。本次未使用联网资料。`,
          sources: [],
        }
        return JSON.stringify(result)
      }

      if (results.length === 0) {
        const result: SummarizeSearchResultsResult = {
          status: status === "error" ? "error" : "ok",
          query: rawQuery,
          sourceCount: 0,
          summary: status === "error"
            ? `搜索失败：${parsed.message ?? "未知错误"}。本次未使用联网资料。`
            : `搜索未返回结果。关键词：${rawQuery}。`,
          sources: [],
        }
        return JSON.stringify(result)
      }

      const sourceList = results.map((r) => r.source || new URL(r.url).hostname.replace("www.", "")).filter(Boolean)
      const uniqueSources = [...new Set(sourceList)]

      let summaryText = `搜索关键词：${rawQuery}\n`
      summaryText += `共查到 ${results.length} 条结果，来自 ${uniqueSources.length} 个来源。\n\n`

      results.forEach((r, i) => {
        summaryText += `${i + 1}. ${r.title}\n`
        summaryText += `   摘要：${r.snippet.replace(/\s+/g, " ").trim()}\n`
        summaryText += `   来源：${r.source || new URL(r.url).hostname}\n\n`
      })

      summaryText += `来源列表：${uniqueSources.join("、")}\n`
      summaryText += `注意：以上内容来自公开网页搜索结果，可能存在时效性和准确性偏差。`

      const max = typeof params.maxSummaryChars === "number" ? Math.min(Math.max(params.maxSummaryChars, 500), 8000) : 2000
      summaryText = truncate(summaryText, max)

      const result: SummarizeSearchResultsResult = {
        status: "ok",
        query: rawQuery,
        sourceCount: results.length,
        summary: summaryText,
        sources: uniqueSources,
      }
      return JSON.stringify(result)
    },
  }
}
