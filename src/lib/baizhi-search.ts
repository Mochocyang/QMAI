import { getHttpFetch, isFetchNetworkError } from "@/lib/tauri-fetch"
import type { WebSearchResult } from "@/lib/web-search"

/**
 * 百智云 Agent Toolkit（Baizhi MCP）搜索后端。
 *
 * 契约（来自百智公开文档 github.com/chaitin/baizhi-agent-toolkit 与
 * websearch.app.baizhi.cloud 接入文档）：
 * - 服务地址 https://agent-toolkit.app.baizhi.cloud/mcp，MCP Streamable HTTP；
 * - 鉴权 `Authorization: Bearer <BAIZHI_API_KEY>`（无 Key 时服务端返回 401）；
 * - 网页搜索工具 `websearch_search`，参数 `query`、`count`（默认 10，最大 50）；
 * - 结果为 `results[]`：rank / title / url / summary / site_name / published_at。
 *
 * 只用 `websearch_search`（结果列表），不用 `websearch_aisearch`：
 * 无来源的生成式回答不能当作搜索结果。
 */
export const BAIZHI_MCP_URL = "https://agent-toolkit.app.baizhi.cloud/mcp"
export const BAIZHI_SEARCH_TOOL = "websearch_search"
const MCP_PROTOCOL_VERSION = "2025-06-18"
const MAX_COUNT = 50

interface JsonRpcResponse {
  jsonrpc?: string
  id?: number | string | null
  result?: unknown
  error?: { code?: number; message?: string }
}

/** 解析 JSON 或 SSE（text/event-stream）响应，取出 id 对应的 JSON-RPC 消息。 */
export function parseMcpResponseBody(body: string, id: number): JsonRpcResponse | null {
  const trimmed = body.trim()
  if (!trimmed) return null
  const candidates: unknown[] = []
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed)
      candidates.push(...(Array.isArray(parsed) ? parsed : [parsed]))
    } catch {
      /* fall through */
    }
  } else {
    for (const event of trimmed.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
      if (!data) continue
      try {
        candidates.push(JSON.parse(data))
      } catch {
        /* ignore non-JSON events */
      }
    }
  }
  for (const c of candidates) {
    const msg = c as JsonRpcResponse
    if (msg && typeof msg === "object" && msg.id === id) return msg
  }
  return null
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

function findResultsArray(value: unknown): unknown[] | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  if (Array.isArray(v.results)) return v.results
  if (v.data && typeof v.data === "object") {
    const d = v.data as Record<string, unknown>
    if (Array.isArray(d.results)) return d.results
  }
  return null
}

/**
 * 把 `websearch_search` 的 tools/call 结果映射为 WebSearchResult。
 * 没有 URL 的条目一律丢弃——不把无来源的文字当搜索结果。
 */
export function normalizeBaizhiToolResult(result: unknown, maxResults: number): WebSearchResult[] {
  if (!result || typeof result !== "object") return []
  const r = result as { isError?: boolean; structuredContent?: unknown; content?: unknown[] }
  const textParts = (Array.isArray(r.content) ? r.content : [])
    .map((c) => (c && typeof c === "object" && (c as { type?: string }).type === "text"
      ? String((c as { text?: unknown }).text ?? "")
      : ""))
    .filter(Boolean)

  if (r.isError) {
    const msg = textParts.join(" ").trim().slice(0, 300)
    throw new Error(`百智搜索失败：${msg || "工具返回错误"}`)
  }

  let items = findResultsArray(r.structuredContent)
  if (!items) {
    for (const text of textParts) {
      try {
        const parsed = JSON.parse(text)
        if (parsed && typeof parsed === "object" && "code" in parsed
          && typeof (parsed as { code: unknown }).code === "number" && (parsed as { code: number }).code !== 0) {
          throw new Error(`百智搜索失败：${(parsed as { message?: string }).message || `code ${(parsed as { code: number }).code}`}`)
        }
        items = findResultsArray(parsed)
        if (items) break
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("百智搜索失败")) throw err
      }
    }
  }
  if (!items) return []

  return items
    .map((item) => {
      const it = (item ?? {}) as {
        title?: string; url?: string; link?: string; summary?: string; snippet?: string
        content?: string; site_name?: string; siteName?: string
      }
      const url = String(it.url ?? it.link ?? "").trim()
      return {
        title: (it.title ?? "").trim() || "Untitled",
        url,
        snippet: it.summary ?? it.snippet ?? it.content ?? "",
        source: it.site_name || it.siteName || hostnameFromUrl(url),
      }
    })
    .filter((it) => /^https?:\/\//i.test(it.url))
    .slice(0, maxResults)
}

export async function baizhiSearch(
  query: string,
  apiKey: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const key = apiKey.trim()
  if (!key) {
    throw new Error("未配置百智 API Key，请在「设置 → 网页搜索 → 百智云」中填写自己的 Key。")
  }
  const httpFetch = await getHttpFetch()
  let sessionId: string | null = null
  let protocolAccepted = false
  let nextId = 1

  const post = async (payload: Record<string, unknown>): Promise<Response> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${key}`,
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    }
    if (sessionId) headers["Mcp-Session-Id"] = sessionId
    try {
      return await httpFetch(BAIZHI_MCP_URL, { method: "POST", headers, body: JSON.stringify(payload) })
    } catch (err) {
      if (isFetchNetworkError(err)) {
        throw new Error("无法连接百智服务（agent-toolkit.app.baizhi.cloud），请检查网络和百智 API Key 是否有效。")
      }
      throw err
    }
  }

  const rpc = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const id = nextId++
    const response = await post({ jsonrpc: "2.0", id, method, params })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      if (response.status === 401 || response.status === 403) {
        throw new Error(`百智鉴权失败（${response.status}），请检查百智 API Key 及其工具权限。`)
      }
      throw new Error(`百智搜索失败（${response.status}）：${text.slice(0, 300) || "未知错误"}`)
    }
    const sid = response.headers.get("mcp-session-id")
    if (sid) sessionId = sid
    const msg = parseMcpResponseBody(await response.text(), id)
    if (!msg) throw new Error("百智搜索失败：服务返回了无法解析的响应。")
    if (msg.error) throw new Error(`百智搜索失败：${msg.error.message || `错误码 ${msg.error.code}`}`)
    return msg.result
  }

  try {
    const initialization = await rpc("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "QMAI", version: "1" },
    })
    if (!initialization || typeof initialization !== "object"
      || (initialization as { protocolVersion?: unknown }).protocolVersion !== MCP_PROTOCOL_VERSION) {
      throw new Error(`百智搜索失败：服务返回的 MCP 协议版本不兼容，客户端仅支持 ${MCP_PROTOCOL_VERSION}。`)
    }
    protocolAccepted = true
    // 初始化确认失败时停止，避免尚未建立会话就继续搜索。
    const initialized = await post({ jsonrpc: "2.0", method: "notifications/initialized" })
    if (!initialized.ok) {
      throw new Error(`百智初始化确认失败（${initialized.status}），未执行搜索。`)
    }
    const result = await rpc("tools/call", {
      name: BAIZHI_SEARCH_TOOL,
      arguments: { query, count: Math.max(1, Math.min(MAX_COUNT, Math.floor(maxResults) || 10)) },
    })
    return normalizeBaizhiToolResult(result, maxResults)
  } finally {
    if (sessionId && protocolAccepted) {
      // 会话清理：尽力而为。
      const sid = sessionId
      httpFetch(BAIZHI_MCP_URL, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${key}`, "Mcp-Session-Id": sid, "MCP-Protocol-Version": MCP_PROTOCOL_VERSION },
      }).catch(() => undefined)
    }
  }
}
