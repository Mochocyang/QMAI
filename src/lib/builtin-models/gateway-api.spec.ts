import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  GatewayError,
  gatewayListModels,
  gatewayProbeChat,
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

const CARD = "netcard-value"

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("normalizeGatewayBaseUrl", () => {
  it("接受带 /v1、结尾斜杠或整段 completions 的地址", () => {
    expect(normalizeGatewayBaseUrl("https://relay.qmai.work/v1")).toBe("https://relay.qmai.work")
    expect(normalizeGatewayBaseUrl("https://relay.qmai.work/v1/")).toBe("https://relay.qmai.work")
    expect(normalizeGatewayBaseUrl("https://relay.qmai.work/v1/chat/completions")).toBe("https://relay.qmai.work")
    expect(normalizeGatewayBaseUrl("  ")).toBe("")
  })
})

describe("gatewayListModels", () => {
  it("带上网关卡请求 /v1/models 并去重", async () => {
    const { fetchImpl, calls } = fakeFetch([
      [/\/v1\/models$/, () => jsonResponse({ object: "list", data: [{ id: "qmai-standard" }, { id: "qmai-long" }, { id: "qmai-standard" }] })],
    ])

    const ids = await gatewayListModels("https://relay.qmai.work", CARD, fetchImpl)

    expect(ids).toEqual(["qmai-standard", "qmai-long"])
    expect(calls[0]!.url).toBe("https://relay.qmai.work/v1/models")
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CARD}`)
  })

  it("没有网关卡时直接报 unauthorized，不发请求", async () => {
    const { fetchImpl, calls } = fakeFetch([])
    await expect(gatewayListModels("https://relay.qmai.work", "", fetchImpl)).rejects.toMatchObject({
      code: "unauthorized",
    })
    expect(calls).toHaveLength(0)
  })

  it("403（不在白名单）翻译成 forbidden", async () => {
    const { fetchImpl } = fakeFetch([
      [/\/v1\/models$/, () => jsonResponse({ error: { message: "当前账号没有使用内置模型的权限。", type: "invalid_request_error" } }, 403)],
    ])
    await expect(gatewayListModels("https://relay.qmai.work", CARD, fetchImpl)).rejects.toMatchObject({
      code: "forbidden",
    })
  })

  it("401（卡被吊销/无效）翻译成「重新登录」", async () => {
    const { fetchImpl } = fakeFetch([
      [/\/v1\/models$/, () => jsonResponse({ error: { message: "" } }, 401)],
    ])
    const error = await gatewayListModels("https://relay.qmai.work", CARD, fetchImpl).catch((e) => e)
    expect(error).toBeInstanceOf(GatewayError)
    expect(error.code).toBe("unauthorized")
    expect(error.message).toContain("重新登录")
  })
})

describe("gatewayProbeChat", () => {
  it("发一条非流式最小请求并返回内容与耗时", async () => {
    const { fetchImpl, calls } = fakeFetch([
      [/\/v1\/chat\/completions$/, () => jsonResponse({ choices: [{ message: { content: "你好" } }] })],
    ])

    const result = await gatewayProbeChat("https://relay.qmai.work", CARD, "qmai-standard", fetchImpl)

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
