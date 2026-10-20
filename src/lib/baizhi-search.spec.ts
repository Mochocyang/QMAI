import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SearchApiConfig } from "@/stores/wiki-store"
import { normalizeBaizhiToolResult, parseMcpResponseBody, BAIZHI_MCP_URL } from "./baizhi-search"
import { providerRequiresApiKey, resolveSearchConfig, webSearch } from "./web-search"

const fetchMock = vi.fn()
vi.mock("@/lib/tauri-fetch", () => ({
  getHttpFetch: async () => fetchMock,
  isFetchNetworkError: () => false,
}))

// 合成凭据，仅用于测试。
const FAKE_KEY = "bz-test-synthetic-key"

function json(body: unknown, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}
function sse(body: unknown): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}

const toolPayload = {
  code: 0,
  message: "success",
  data: {
    results: [
      { rank: 1, title: "T-80BVM", url: "https://example.com/t80", summary: "坦克摘要", site_name: "Example" },
      { rank: 2, title: "无链接", url: "", summary: "生成式回答，不应进入结果" },
    ],
  },
}

/** initialize → initialized 通知 → tools/call → DELETE 会话 */
function mockHappyPath(callResult: unknown = { content: [{ type: "text", text: JSON.stringify(toolPayload) }] }) {
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    if (!init) return new Response("{}") // vitest 偶尔无参探测 mock
    if (init.method === "DELETE") return new Response(null, { status: 200 })
    const body = JSON.parse(String(init.body))
    if (body.method === "initialize") {
      return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }, { "mcp-session-id": "sess-1" })
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 })
    if (body.method === "tools/call") return sse({ jsonrpc: "2.0", id: body.id, result: callResult })
    throw new Error(`unexpected ${body.method}`)
  })
}

function baizhiConfig(extra: Partial<SearchApiConfig> = {}): SearchApiConfig {
  return { provider: "baizhi", apiKey: "", providerConfigs: { baizhi: { apiKey: FAKE_KEY } }, ...extra }
}

describe("百智 MCP 搜索后端", () => {
  beforeEach(() => fetchMock.mockReset())

  it("需要 Key", () => {
    expect(providerRequiresApiKey("baizhi")).toBe(true)
  })

  it("缺 Key 时不发请求并给出提示", async () => {
    await expect(webSearch("q", { provider: "baizhi", apiKey: "", providerConfigs: {} })).rejects.toThrow(/API key/)
    await expect(webSearch("q", { provider: "baizhi", apiKey: "", providerConfigs: { baizhi: { apiKey: "  " } } })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("不继承其他服务的凭据（顶层 apiKey / 别的卡片）", async () => {
    const cfg: SearchApiConfig = {
      provider: "baizhi",
      apiKey: "tavily-secret",
      providerConfigs: { tavily: { apiKey: "tavily-secret" }, bocha: { apiKey: "bocha-secret" } },
    }
    expect(resolveSearchConfig(cfg).apiKey).toBe("")
    await expect(webSearch("q", cfg)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("从其他 provider 切到百智时不带上旧 Key；切回去旧 Key 还在", () => {
    const tavily = resolveSearchConfig({ provider: "tavily", apiKey: "", providerConfigs: { tavily: { apiKey: "tv" } } })
    expect(tavily.apiKey).toBe("tv")
    const toBaizhi = resolveSearchConfig({ ...tavily, provider: "baizhi" })
    expect(toBaizhi.apiKey).toBe("")
    const withKey = resolveSearchConfig({ ...toBaizhi, providerConfigs: { ...toBaizhi.providerConfigs, baizhi: { apiKey: FAKE_KEY } } })
    expect(withKey.apiKey).toBe(FAKE_KEY)
    const back = resolveSearchConfig({ ...withKey, provider: "tavily" })
    expect(back.apiKey).toBe("tv")
    expect(back.providerConfigs?.baizhi?.apiKey).toBe(FAKE_KEY)
  })

  it("旧版只有顶层 apiKey 的百智配置仍可解析", () => {
    expect(resolveSearchConfig({ provider: "baizhi", apiKey: FAKE_KEY }).apiKey).toBe(FAKE_KEY)
  })

  it("用独立 Key 走 MCP 流程并映射结果，丢弃无 URL 条目，最后清理会话", async () => {
    mockHappyPath()
    const results = await webSearch("T-80BVM", baizhiConfig(), 5)
    expect(results).toEqual([
      { title: "T-80BVM", url: "https://example.com/t80", snippet: "坦克摘要", source: "Example" },
    ])
    const calls = fetchMock.mock.calls
    for (const [url, init] of calls) {
      expect(url).toBe(BAIZHI_MCP_URL)
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`)
    }
    const call = calls.map(([, init]) => (init.body ? JSON.parse(String(init.body)) : null)).find((b) => b?.method === "tools/call")
    expect(call.params).toEqual({ name: "websearch_search", arguments: { query: "T-80BVM", count: 5 } })
    expect((calls[2][1].headers as Record<string, string>)["Mcp-Session-Id"]).toBe("sess-1")
    await Promise.resolve()
    expect(calls.some(([, init]) => init.method === "DELETE")).toBe(true)
  })

  it("structuredContent 也能映射；空结果返回空数组", async () => {
    mockHappyPath({ structuredContent: { results: [{ title: "a", url: "https://a.cn/x", summary: "s" }] }, content: [] })
    expect(await webSearch("q", baizhiConfig())).toEqual([{ title: "a", url: "https://a.cn/x", snippet: "s", source: "a.cn" }])
    fetchMock.mockReset()
    mockHappyPath({ content: [{ type: "text", text: JSON.stringify({ code: 0, data: { results: [] } }) }] })
    expect(await webSearch("q", baizhiConfig())).toEqual([])
  })

  it("纯文字（无来源）回答不当成结果", () => {
    expect(normalizeBaizhiToolResult({ content: [{ type: "text", text: "这是一段总结回答" }] }, 10)).toEqual([])
  })

  it("工具 isError / 业务 code 非 0 / JSON-RPC 错误 / 401 都给出中文失败提示", async () => {
    mockHappyPath({ isError: true, content: [{ type: "text", text: "额度不足" }] })
    await expect(webSearch("q", baizhiConfig())).rejects.toThrow("百智搜索失败：额度不足")

    fetchMock.mockReset()
    mockHappyPath({ content: [{ type: "text", text: JSON.stringify({ code: 40001, message: "无权限" }) }] })
    await expect(webSearch("q", baizhiConfig())).rejects.toThrow("百智搜索失败：无权限")

    fetchMock.mockReset()
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"))
      if (body.method === "initialize") return json({ jsonrpc: "2.0", id: body.id, result: {} })
      if (body.method === "tools/call") return json({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "Unknown tool" } })
      return new Response(null, { status: 202 })
    })
    await expect(webSearch("q", baizhiConfig())).rejects.toThrow("百智搜索失败：Unknown tool")

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(json({ code: "unauthorized" }, {}, 401))
    await expect(webSearch("q", baizhiConfig())).rejects.toThrow(/百智鉴权失败（401）/)
  })

  it("切回其他 provider 时不再请求百智", async () => {
    fetchMock.mockResolvedValue(json({ results: [{ title: "t", url: "https://t.com", content: "c" }] }))
    const cfg = { ...baizhiConfig(), provider: "tavily" as const, providerConfigs: { baizhi: { apiKey: FAKE_KEY }, tavily: { apiKey: "tv" } } }
    await webSearch("q", cfg)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.tavily.com/search")
  })

  it("解析 SSE 和 JSON 响应体", () => {
    expect(parseMcpResponseBody('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":1}}\n\n', 2)?.result).toEqual({ ok: 1 })
    expect(parseMcpResponseBody('{"jsonrpc":"2.0","id":3,"result":1}', 3)?.result).toBe(1)
    expect(parseMcpResponseBody("garbage", 1)).toBeNull()
  })
})
