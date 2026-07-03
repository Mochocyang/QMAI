import type { Tool } from "../types"
import { resolveSearchConfig, webSearch } from "@/lib/web-search"
import type { SearchApiConfig } from "@/stores/wiki-store"

export interface WebSearchToolResult {
  status: "ok" | "not_configured" | "error"
  query: string
  provider: string
  resultCount: number
  results: Array<{
    title: string
    url: string
    snippet: string
    source: string
  }>
  message?: string
}

function toPositiveInteger(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(max, Math.floor(n))
}

function isSearchConfigured(config: SearchApiConfig | null | undefined): config is SearchApiConfig {
  if (!config) return false
  const resolved = resolveSearchConfig(config)
  if (resolved.provider === "none") return false
  if ((resolved.provider === "tavily" || resolved.provider === "serpapi") && !resolved.apiKey?.trim()) return false
  if (resolved.provider === "searxng" && !resolved.searXngUrl?.trim()) return false
  return true
}

export function createWebSearchTool(getSearchApiConfig?: () => SearchApiConfig | null | undefined): Tool {
  return {
    name: "web_search",
    description: "联网搜索外部资料。用户明确要求搜索、联网查询、查外部资料或最新信息时使用；未配置搜索时会返回中文降级说明。",
    category: "read",
    parameters: {
      query: { type: "string", description: "搜索关键词", required: true },
      maxResults: { type: "integer", description: "最多返回结果数量，默认 5，最大 10" },
    },
    execute: async (params) => {
      const query = String(params.query ?? "").trim()
      const maxResults = toPositiveInteger(params.maxResults, 5, 10)
      const config = getSearchApiConfig?.()
      const provider = config ? resolveSearchConfig(config).provider : "none"

      if (!query) {
        const result: WebSearchToolResult = {
          status: "error",
          query,
          provider,
          resultCount: 0,
          results: [],
          message: "搜索关键词为空，未执行联网搜索。",
        }
        return JSON.stringify(result)
      }

      if (!isSearchConfigured(config)) {
        const result: WebSearchToolResult = {
          status: "not_configured",
          query,
          provider,
          resultCount: 0,
          results: [],
          message: "当前未配置外部搜索，无法联网查询。未执行联网搜索；我可以基于模型已有知识回答，或你可以先在设置中配置 Web Search 后重试。",
        }
        return JSON.stringify(result)
      }

      try {
        const results = await webSearch(query, config, maxResults)
        const result: WebSearchToolResult = {
          status: "ok",
          query,
          provider: resolveSearchConfig(config).provider,
          resultCount: results.length,
          results: results.map((item) => ({
            title: item.title,
            url: item.url,
            snippet: item.snippet,
            source: item.source,
          })),
        }
        return JSON.stringify(result)
      } catch (error) {
        const result: WebSearchToolResult = {
          status: "error",
          query,
          provider: resolveSearchConfig(config).provider,
          resultCount: 0,
          results: [],
          message: `外部搜索失败，本次未使用联网资料。原因：${error instanceof Error ? error.message : String(error)}`,
        }
        return JSON.stringify(result)
      }
    },
  }
}
