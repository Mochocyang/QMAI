import { describe, expect, it, vi } from "vitest"
import {
  BUILTIN_TOKEN_NAME,
  GatewayError,
  ensureBuiltinToken,
  formatQuotaUsd,
  gatewayListModels,
  gatewayLogin,
  gatewayProbeChat,
  gatewayPublicStatus,
  gatewayRegister,
  gatewayRedeem,
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
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} }
    calls.push(call)
    for (const [pattern, handler] of routes) {
      if (pattern.test(call.url)) return handler(call)
    }
    return jsonResponse({ success: false, message: `unmatched ${call.url}` }, 404)
  }) as typeof fetch
  return { fetchImpl, calls }
}

describe("normalizeGatewayBaseUrl", () => {
  it("接受带 /v1、结尾斜杠或整段 completions 的地址", () => {
    expect(normalizeGatewayBaseUrl("http://localhost:3000/v1")).toBe("http://localhost:3000")
    expect(normalizeGatewayBaseUrl("http://localhost:3000/v1/")).toBe("http://localhost:3000")
    expect(normalizeGatewayBaseUrl("http://localhost:3000/v1/chat/completions")).toBe("http://localhost:3000")
    expect(normalizeGatewayBaseUrl("https://api.example.com/")).toBe("https://api.example.com")
    expect(normalizeGatewayBaseUrl("  ")).toBe("")
  })
})

describe("formatQuotaUsd / isAccessTokenExpired", () => {
  it("500000 quota 记为 1 美元", () => {
    expect(formatQuotaUsd(0, 500000)).toBe("$0.00")
    expect(formatQuotaUsd(500000, 500000)).toBe("$1.00")
    expect(formatQuotaUsd(1250000, 500000)).toBe("$2.50")
  })

  it("提前 60 秒判定过期", () => {
    const now = Math.floor(Date.now() / 1000)
    expect(isAccessTokenExpired(now + 30)).toBe(true)
    expect(isAccessTokenExpired(now + 3600)).toBe(false)
    expect(isAccessTokenExpired(0)).toBe(false)
  })
})

describe("gatewayLogin", () => {
  it("转发账号密码并返回 access_token 与用户余额", async () => {
    const { fetchImpl, calls } = fakeFetch([[
      /\/api\/user\/login$/,
      () => jsonResponse({
        success: true,
        message: "",
        data: {
          access_token: "jwt-token",
          access_expires_at: 1792911499,
          user: { id: 2, username: "qmai_test", display_name: "测试作者", quota: 500000, used_quota: 1000, group: "default", role: 1 },
        },
      }),
    ]])

    const result = await gatewayLogin("http://localhost:3000/v1", "qmai_test", "secret", fetchImpl)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("http://localhost:3000/api/user/login")
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ username: "qmai_test", password: "secret" })
    expect(result.accessToken).toBe("jwt-token")
    expect(result.user.username).toBe("qmai_test")
    expect(result.user.quota).toBe(500000)
  })

  it("旧版网关（只有 user 没有 access_token）给出可执行的提示", async () => {
    const { fetchImpl } = fakeFetch([[
      /\/api\/user\/login$/,
      () => jsonResponse({ success: true, message: "", data: { id: 3, username: "old" } }),
    ]])
    await expect(gatewayLogin("http://localhost:3000", "old", "secret", fetchImpl))
      .rejects.toThrow(/旧版 New API/)
  })

  it("账号密码错误时把网关 message 抛出来", async () => {
    const { fetchImpl } = fakeFetch([[
      /\/api\/user\/login$/,
      () => jsonResponse({ success: false, message: "用户名或密码错误" }),
    ]])
    await expect(gatewayLogin("http://localhost:3000", "a", "b", fetchImpl))
      .rejects.toThrow("用户名或密码错误")
  })
})

describe("gatewayRegister", () => {
  it("注册不发送 password2，且带空邮箱字段", async () => {
    const { fetchImpl, calls } = fakeFetch([[
      /\/api\/user\/register$/,
      () => jsonResponse({ success: true, message: "" }),
    ]])
    await gatewayRegister("http://localhost:3000", "new_user", "password123", fetchImpl)
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    expect(body.username).toBe("new_user")
    expect(body.password).toBe("password123")
    expect(body.password2).toBeUndefined()
  })
})

describe("ensureBuiltinToken", () => {
  it("复用同名、无限额度、状态正常的令牌，不重复创建", async () => {
    const { fetchImpl, calls } = fakeFetch([
      [/\/api\/token\/\?p=1&size=100$/, () => jsonResponse({
        success: true,
        data: { items: [{ id: 7, name: BUILTIN_TOKEN_NAME, key: "abcd****wxyz", status: 1, unlimited_quota: true, remain_quota: 0, used_quota: 10 }] },
      })],
      [/\/api\/token\/7\/key$/, () => jsonResponse({ success: true, data: { key: "rawkey123" } })],
    ])

    const token = await ensureBuiltinToken("http://localhost:3000", "jwt", fetchImpl)

    expect(token).toEqual({ tokenId: 7, key: "sk-rawkey123", created: false })
    expect(calls.some((call) => call.url.endsWith("/api/token/"))).toBe(false)
  })

  it("没有可用令牌时新建一枚无限额度、永不过期的令牌再取回密钥", async () => {
    let listCalls = 0
    const { fetchImpl, calls } = fakeFetch([
      [/\/api\/token\/\?p=1&size=100$/, () => {
        listCalls += 1
        return jsonResponse({
          success: true,
          data: {
            items: listCalls === 1
              ? []
              : [{ id: 9, name: BUILTIN_TOKEN_NAME, key: "xxxx****yyyy", status: 1, unlimited_quota: true, remain_quota: 0, used_quota: 0 }],
          },
        })
      }],
      [/\/api\/token\/$/, () => jsonResponse({ success: true, message: "" })],
      [/\/api\/token\/9\/key$/, () => jsonResponse({ success: true, data: { key: "newkey" } })],
    ])

    const token = await ensureBuiltinToken("http://localhost:3000", "jwt", fetchImpl)

    expect(token).toEqual({ tokenId: 9, key: "sk-newkey", created: true })
    const create = calls.find((call) => call.url.endsWith("/api/token/"))
    expect(create).toBeDefined()
    const body = JSON.parse(String(create!.init.body)) as Record<string, unknown>
    expect(body.unlimited_quota).toBe(true)
    expect(body.expired_time).toBe(-1)
    expect(body.name).toBe(BUILTIN_TOKEN_NAME)
  })
})

describe("gatewayListModels / gatewayProbeChat", () => {
  it("列表请求带 sk- 前缀，且不会重复加前缀", async () => {
    const { fetchImpl, calls } = fakeFetch([[
      /\/v1\/models$/,
      () => jsonResponse({ object: "list", data: [{ id: "glm-5.3" }, { id: "grok-chat-fast" }, { id: "glm-5.3" }] }),
    ]])
    const ids = await gatewayListModels("http://localhost:3000", "sk-abc", fetchImpl)
    expect(calls[0].url).toBe("http://localhost:3000/v1/models")
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sk-abc")
    expect(ids).toEqual(["glm-5.3", "grok-chat-fast"])
  })

  it("额度不足的 403 翻译成中文提示，不把英文 JSON 甩给作者", async () => {
    const { fetchImpl } = fakeFetch([[
      /\/v1\/chat\/completions$/,
      () => jsonResponse({ error: { message: "Insufficient user quota, remaining quota: ＄0.000000", type: "new_api_error", code: "insufficient_user_quota" } }, 403),
    ]])
    await expect(gatewayProbeChat("http://localhost:3000", "sk-abc", "glm-5.3", fetchImpl))
      .rejects.toThrow("账户额度不足，请先充值或兑换额度后再使用内置模型。")
  })

  it("正常返回时带内容与延迟", async () => {
    const { fetchImpl } = fakeFetch([[
      /\/v1\/chat\/completions$/,
      () => jsonResponse({ choices: [{ message: { content: "你好" } }], usage: { total_tokens: 8 } }),
    ]])
    const result = await gatewayProbeChat("http://localhost:3000", "sk-abc", "glm-5.3", fetchImpl)
    expect(result.content).toBe("你好")
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })
})

describe("兑换与状态", () => {
  it("兑换码请求体是 { key }，并返回网关提示", async () => {
    const { fetchImpl, calls } = fakeFetch([[
      /\/api\/user\/topup$/,
      () => jsonResponse({ success: true, message: "兑换成功", data: 500000 }),
    ]])
    const message = await gatewayRedeem("http://localhost:3000", "jwt", "CODE-1", fetchImpl)
    expect(message).toBe("兑换成功")
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ key: "CODE-1" })
  })

  it("读取 quota_per_unit / 汇率 / 注册开关", async () => {
    const { fetchImpl } = fakeFetch([[
      /\/api\/status$/,
      () => jsonResponse({ data: { system_name: "New API", quota_per_unit: 500000, price: 7.3, usd_exchange_rate: 7.3, register_enabled: true, password_register_enabled: true } }),
    ]])
    const status = await gatewayPublicStatus("http://localhost:3000", fetchImpl)
    expect(status.quotaPerUnit).toBe(500000)
    expect(status.usdExchangeRate).toBe(7.3)
    expect(status.registerEnabled).toBe(true)
  })
})

describe("toGatewayError", () => {
  it("401 提示重新登录，5xx 提示网关不可用", () => {
    expect(toGatewayError({}, 401).message).toContain("重新登录")
    expect(toGatewayError({}, 500).message).toContain("网关暂时不可用")
    expect(toGatewayError({ success: false, message: "用户已存在" }, 200).message).toBe("用户已存在")
    expect(new GatewayError("x", "code", 400).code).toBe("code")
  })
})

describe("网络异常", () => {
  it("连接失败时带上地址并说明检查方向", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("Failed to fetch") }) as unknown as typeof fetch
    await expect(gatewayLogin("http://127.0.0.1:3999", "a", "b", fetchImpl))
      .rejects.toThrow(/无法连接到内置模型网关/)
  })
})
