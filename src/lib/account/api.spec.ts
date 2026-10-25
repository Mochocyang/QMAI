import { describe, expect, it } from "vitest"

import {
  DEFAULT_ACCOUNT_BASE_URL,
  fetchAccountMe,
  loginAccount,
  logoutAccount,
  normalizeAccountBaseUrl,
  refreshAccountSession,
  registerAccount,
  resetAccountPassword,
  resolveAccountBaseUrl,
  sendCode,
} from "./api"
import { AccountApiError, accountErrorMessage, isAccountApiError } from "./errors"
import type { AccountAuthPayload } from "./types"

const BASE = "https://account.test"

type Call = { url: string; init: RequestInit }

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function success(data: unknown, status = 200): Response {
  return jsonResponse({ success: true, data }, status)
}

function failure(code: string | undefined, message: string, status: number): Response {
  const body: Record<string, unknown> = { success: false, message }
  if (code !== undefined) body.code = code
  return jsonResponse(body, status)
}

/** 返回固定的响应，同时记录 URL / 请求头 / body，便于断言线上契约。 */
function fakeFetch(
  responder: (call: Call) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} }
    calls.push(call)
    return responder(call)
  }) as typeof fetch
  return { fetchImpl, calls }
}

async function captureError(task: Promise<unknown>): Promise<AccountApiError> {
  try {
    await task
  } catch (error) {
    if (isAccountApiError(error)) return error
    throw error
  }
  throw new Error("预期抛出 AccountApiError")
}

function authPayload(overrides: Partial<AccountAuthPayload> = {}): AccountAuthPayload {
  return {
    user: {
      id: 12,
      email: "author@example.com",
      displayName: "作者",
      createdAt: 1793000000,
    },
    accessToken: "access-token",
    accessExpiresAt: 1793000900,
    refreshToken: "refresh-token",
    refreshExpiresAt: 1800776000,
    ...overrides,
  }
}

describe("normalizeAccountBaseUrl", () => {
  it("trim、去尾斜杠、补 https、空串回默认", () => {
    expect(normalizeAccountBaseUrl("  https://account.test/  ")).toBe("https://account.test")
    expect(normalizeAccountBaseUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787")
    expect(normalizeAccountBaseUrl("account.test/")).toBe("https://account.test")
    expect(normalizeAccountBaseUrl("  ")).toBe(DEFAULT_ACCOUNT_BASE_URL)
    expect(normalizeAccountBaseUrl("")).toBe(DEFAULT_ACCOUNT_BASE_URL)
  })

  it("只有协议没有主机时回默认地址", () => {
    expect(normalizeAccountBaseUrl("https://")).toBe(DEFAULT_ACCOUNT_BASE_URL)
    expect(normalizeAccountBaseUrl("http:///")).toBe(DEFAULT_ACCOUNT_BASE_URL)
  })
})

describe("resolveAccountBaseUrl", () => {
  it("没有任何覆盖时使用默认地址", () => {
    expect(resolveAccountBaseUrl()).toBe(DEFAULT_ACCOUNT_BASE_URL)
  })
})

describe("sendCode", () => {
  it("POST 正确路径与 JSON body，并返回 devCode", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      success({ cooldownSeconds: 60, devCode: "123456" }),
    )

    const result = await sendCode(`${BASE}/`, "  Author@Example.COM ", "register", fetchImpl)

    expect(result).toEqual({ cooldownSeconds: 60, devCode: "123456" })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${BASE}/v1/auth/send-code`)
    expect(calls[0]?.init.method).toBe("POST")

    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get("Content-Type")).toBe("application/json")
    expect(headers.get("Accept")).toBe("application/json")
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      email: "author@example.com",
      purpose: "register",
    })
  })

  it("成功但缺少 cooldownSeconds 视为结构非法", async () => {
    const { fetchImpl } = fakeFetch(() => success({ devCode: "123456" }))
    const error = await captureError(sendCode(BASE, "a@b.com", "reset", fetchImpl))
    expect(error.code).toBe("SERVER_ERROR")
  })
})

describe("loginAccount / registerAccount / refreshAccountSession", () => {
  it("登录返回登录态，并携带可选 deviceLabel", async () => {
    const payload = authPayload()
    const { fetchImpl, calls } = fakeFetch(() => success(payload))

    await expect(loginAccount(BASE, {
      email: "Author@Example.COM",
      password: "password123",
      deviceLabel: "Windows 桌面端",
    }, fetchImpl)).resolves.toEqual(payload)

    expect(calls[0]?.url).toBe(`${BASE}/v1/auth/login`)
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      email: "author@example.com",
      password: "password123",
      deviceLabel: "Windows 桌面端",
    })
  })

  it("注册返回登录态；未填 displayName 时不发送该字段", async () => {
    const payload = authPayload()
    const { fetchImpl, calls } = fakeFetch(() => success(payload, 201))

    await expect(registerAccount(BASE, {
      email: "author@example.com",
      code: "123456",
      password: "password123",
    }, fetchImpl)).resolves.toEqual(payload)

    expect(calls[0]?.url).toBe(`${BASE}/v1/auth/register`)
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      email: "author@example.com",
      code: "123456",
      password: "password123",
    })
  })

  it("refresh 轮换后返回新的 refreshToken", async () => {
    const next = authPayload({ refreshToken: "rotated-refresh" })
    const { fetchImpl, calls } = fakeFetch(() => success(next))

    await expect(refreshAccountSession(BASE, "old-refresh", fetchImpl)).resolves.toEqual(next)

    expect(calls[0]?.url).toBe(`${BASE}/v1/auth/refresh`)
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ refreshToken: "old-refresh" })
  })

  it("reset / logout 成功返回 void，并发送 refreshToken 或新密码", async () => {
    const reset = fakeFetch(() => success(null))
    await expect(resetAccountPassword(BASE, {
      email: "author@example.com",
      code: "654321",
      password: "new-password",
    }, reset.fetchImpl)).resolves.toBeUndefined()
    expect(reset.calls[0]?.url).toBe(`${BASE}/v1/auth/password/reset`)
    expect(JSON.parse(String(reset.calls[0]?.init.body))).toEqual({
      email: "author@example.com",
      code: "654321",
      password: "new-password",
    })

    const logout = fakeFetch(() => success(null))
    await expect(logoutAccount(BASE, "refresh-token", logout.fetchImpl)).resolves.toBeUndefined()
    expect(logout.calls[0]?.url).toBe(`${BASE}/v1/auth/logout`)
    expect(JSON.parse(String(logout.calls[0]?.init.body))).toEqual({
      refreshToken: "refresh-token",
    })
  })

  it("成功信封但登录态字段缺失时不返回半截对象", async () => {
    const { fetchImpl } = fakeFetch(() => success({
      ...authPayload(),
      accessToken: "",
    }))
    const error = await captureError(loginAccount(BASE, {
      email: "author@example.com",
      password: "password123",
    }, fetchImpl))
    expect(error.code).toBe("SERVER_ERROR")
  })
})

describe("fetchAccountMe", () => {
  it("GET /v1/auth/me，带 Bearer 且不发送 Content-Type", async () => {
    const user = authPayload().user
    const { fetchImpl, calls } = fakeFetch(() => success({ user }))

    await expect(fetchAccountMe(BASE, "access-token", fetchImpl)).resolves.toEqual(user)

    expect(calls[0]?.url).toBe(`${BASE}/v1/auth/me`)
    expect(calls[0]?.init.method).toBe("GET")
    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get("Authorization")).toBe("Bearer access-token")
    expect(headers.get("Accept")).toBe("application/json")
    expect(headers.get("Content-Type")).toBeNull()
    expect(calls[0]?.init.body).toBeUndefined()
  })

  it("响应缺少 user 时视为结构非法", async () => {
    const { fetchImpl } = fakeFetch(() => success({}))
    const error = await captureError(fetchAccountMe(BASE, "access-token", fetchImpl))
    expect(error.code).toBe("SERVER_ERROR")
  })
})

describe("错误映射", () => {
  it("优先使用服务端 code / message", async () => {
    const { fetchImpl } = fakeFetch(() => failure("EMAIL_TAKEN", "server says taken", 409))
    const error = await captureError(registerAccount(BASE, {
      email: "author@example.com",
      code: "123456",
      password: "password123",
    }, fetchImpl))

    expect(error.code).toBe("EMAIL_TAKEN")
    expect(error.status).toBe(409)
    expect(error.message).toBe("server says taken")
    expect(accountErrorMessage(error)).toBe("这个邮箱已经注册过，直接登录即可。")
  })

  it("HTTP 401 无 code 时按路径兜底", async () => {
    const login = fakeFetch(() => failure(undefined, "", 401))
    const loginError = await captureError(loginAccount(BASE, {
      email: "author@example.com",
      password: "password123",
    }, login.fetchImpl))
    expect(loginError.code).toBe("INVALID_CREDENTIALS")

    const refresh = fakeFetch(() => failure(undefined, "", 401))
    const refreshError = await captureError(refreshAccountSession(BASE, "refresh-token", refresh.fetchImpl))
    expect(refreshError.code).toBe("INVALID_REFRESH")
    expect(refreshError.status).toBe(401)

    const me = fakeFetch(() => failure(undefined, "", 401))
    const meError = await captureError(fetchAccountMe(BASE, "access-token", me.fetchImpl))
    expect(meError.code).toBe("TOKEN_EXPIRED")
  })

  it("HTTP 429 / 500 无 code 时兜底为 RATE_LIMITED / SERVER_ERROR", async () => {
    const limited = fakeFetch(() => failure(undefined, "", 429))
    const limitedError = await captureError(sendCode(BASE, "a@b.com", "register", limited.fetchImpl))
    expect(limitedError.code).toBe("RATE_LIMITED")
    expect(limitedError.status).toBe(429)

    const server = fakeFetch(() => failure(undefined, "", 500))
    const serverError = await captureError(sendCode(BASE, "a@b.com", "register", server.fetchImpl))
    expect(serverError.code).toBe("SERVER_ERROR")
    expect(serverError.status).toBe(500)
  })

  it("未知服务端 code 时按状态兜底，不暴露未知码", async () => {
    const { fetchImpl } = fakeFetch(() => failure("NOT_FOUND", "接口不存在。", 404))
    const error = await captureError(sendCode(BASE, "a@b.com", "register", fetchImpl))
    expect(error.code).toBe("SERVER_ERROR")
  })

  it("网络异常映射为 NETWORK / status 0", async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new TypeError("Failed to fetch")
    })

    const error = await captureError(sendCode(BASE, "a@b.com", "register", fetchImpl))
    expect(error).toBeInstanceOf(AccountApiError)
    expect(error.code).toBe("NETWORK")
    expect(error.status).toBe(0)
    expect(accountErrorMessage(error)).toBe("网络连接失败，请检查网络后重试。")
  })
})
