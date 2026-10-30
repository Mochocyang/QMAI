import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  GatewayError,
  fetchRelayTicket,
  gatewayListModels,
  gatewayProbeChat,
  isAccessTokenExpired,
  normalizeGatewayBaseUrl,
  toGatewayError,
} from "./gateway-api"

type Call = { url: string; init: RequestInit }

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/** 按路由返回固定响应，并记录调用，便于断言请求体与鉴权头。 */
function fakeFetch(routes: Array<[RegExp, (call: Call) => Response]>): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} }
    calls.push(call)
    for (const [pattern, handler] of routes) {
      if (pattern.test(call.url)) return handler(call)
    }
    return jsonResponse({ error: { message: `unmatched ${call.url}` } }, 404)
  }) as typeof fetch
  return { fetchImpl, calls }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("normalizeGatewayBaseUrl", () => {
  it("接受带 /v1、结尾斜杠或整段 completions 的地址", () => {
    expect(normalizeGatewayBaseUrl("https://relay.qmai.work/v1")).toBe("https://relay.qmai.work")
    expect(normalizeGatewayBaseUrl("https://relay.qmai.work/v1/")).toBe("https://relay.qmai.work")
    expect(normalizeGatewayBaseUrl("https://relay.qmai.work/v1/chat/completions")).toBe("https://relay.qmai.work")
    expect(normalizeGatewayBaseUrl("https://qmai-account.qmai.workers.dev/")).toBe("https://qmai-account.qmai.workers.dev")
    expect(normalizeGatewayBaseUrl("  ")).toBe("")
  })
})

describe("isAccessTokenExpired", () => {
  it("默认提前 120 秒判定过期（票据 30 分钟，留 2 分钟余量）", () => {
    const now = Math.floor(Date.now() / 1000)
    // 剩 60 秒：已经进入 120 秒余量窗口，必须换票
    expect(isAccessTokenExpired(now + 60)).toBe(true)
    // 剩 180 秒：还在窗口外
    expect(isAccessTokenExpired(now + 180)).toBe(false)
    expect(isAccessTokenExpired(now + 600)).toBe(false)
    // 0 表示"网关没说有效期"，由调用方另行处理，这里不判过期
    expect(isAccessTokenExpired(0)).toBe(false)
  })
})

describe("fetchRelayTicket", () => {
  it("用登录态打账号服务的 /v1/relay/token，并取回票据与有效期", async () => {
    const { fetchImpl, calls } = fakeFetch([
      [/\/v1\/relay\/token$/, () => jsonResponse({ success: true, data: { token: "jwt-ticket", expiresAt: 1793000000 } })],
    ])

    const ticket = await fetchRelayTicket("https://account.qmai.work", "account-access", fetchImpl)

    expect(ticket).toEqual({ token: "jwt-ticket", expiresAt: 1793000000 })
    expect(calls[0]!.url).toBe("https://account.qmai.work/v1/relay/token")
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer account-access")
    expect(calls[0]!.init.method).toBe("POST")
  })

  it("没登录态时直接报 unauthorized，不发请求", async () => {
    const { fetchImpl, calls } = fakeFetch([])
    await expect(fetchRelayTicket("https://account.qmai.work", "", fetchImpl)).rejects.toMatchObject({
      code: "unauthorized",
    })
    expect(calls).toHaveLength(0)
  })

  it("账号服务返回 401 时翻译成「重新登录」", async () => {
    const { fetchImpl } = fakeFetch([
      [/relay\/token$/, () => jsonResponse({ success: false, code: "TOKEN_EXPIRED", message: "" }, 401)],
    ])
    await expect(fetchRelayTicket("https://account.qmai.work", "expired", fetchImpl)).rejects.toMatchObject({
      code: "unauthorized",
    })
  })

  it("票据为空时报 bad_relay_token（说明主站没配私钥）", async () => {
    const { fetchImpl } = fakeFetch([[/relay\/token$/, () => jsonResponse({ success: true, data: {} })]])
    await expect(fetchRelayTicket("https://account.qmai.work", "ok", fetchImpl)).rejects.toMatchObject({
      code: "bad_relay_token",
    })
  })

  it("有效期缺失或非法时拒绝，不存一张「永不过期」的假票", async () => {
    const { fetchImpl } = fakeFetch([
      [/relay\/token$/, () => jsonResponse({ success: true, data: { token: "jwt", expiresAt: 0 } })],
    ])
    await expect(fetchRelayTicket("https://account.qmai.work", "ok", fetchImpl)).rejects.toMatchObject({
      code: "bad_relay_token",
    })
  })

  it("网络失败翻译成 network_error", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED")
    }) as unknown as typeof fetch
    await expect(fetchRelayTicket("https://account.qmai.work", "ok", fetchImpl)).rejects.toMatchObject({
      code: "network_error",
    })
  })
})

describe("gatewayListModels", () => {
  it("带上票据请求 relay /v1/models 并去重", async () => {
    const { fetchImpl, calls } = fakeFetch([
      [/\/v1\/models$/, () => jsonResponse({ object: "list", data: [{ id: "qmai-standard" }, { id: "qmai-long" }, { id: "qmai-standard" }] })],
    ])

    const ids = await gatewayListModels("https://relay.qmai.work", "jwt", fetchImpl)

    expect(ids).toEqual(["qmai-standard", "qmai-long"])
    expect(calls[0]!.url).toBe("https://relay.qmai.work/v1/models")
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer jwt")
  })

  it("403（不在白名单）翻译成 forbidden", async () => {
    const { fetchImpl } = fakeFetch([
      [/\/v1\/models$/, () => jsonResponse({ error: { message: "当前账号没有使用内置模型的权限。", type: "invalid_request_error" } }, 403)],
    ])
    await expect(gatewayListModels("https://relay.qmai.work", "jwt", fetchImpl)).rejects.toMatchObject({
      code: "forbidden",
    })
  })
})

describe("gatewayProbeChat", () => {
  it("发一条非流式最小请求并返回内容与耗时", async () => {
    const { fetchImpl, calls } = fakeFetch([
      [/\/v1\/chat\/completions$/, () => jsonResponse({ choices: [{ message: { content: "你好" } }] })],
    ])

    const result = await gatewayProbeChat("https://relay.qmai.work", "jwt", "qmai-standard", fetchImpl)

    expect(result.content).toBe("你好")
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.model).toBe("qmai-standard")
    expect(body.stream).toBe(false)
  })
})

describe("toGatewayError", () => {
  it("识别「没有可用的上游通道」为配置问题", () => {
    const error = toGatewayError({ error: { message: "内置模型暂不可用：没有可用的上游通道。" } }, 503)
    expect(error).toBeInstanceOf(GatewayError)
    expect(error.code).toBe("upstream_missing")
    expect(error.message).toContain("尚未配置")
  })

  it("404 提示模型不存在", () => {
    expect(toGatewayError({ error: { message: "" } }, 404).code).toBe("not_found")
  })

  it("429 提示限流", () => {
    expect(toGatewayError({ error: { message: "上游限流，请稍后再试。" } }, 429).code).toBe("rate_limited")
  })

  it("5xx 提示服务不可用", () => {
    expect(toGatewayError({}, 502).code).toBe("server_error")
  })
})
