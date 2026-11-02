import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ACCOUNT_REQUEST_TIMEOUT_MS,
  DEFAULT_ACCOUNT_BASE_URL,
  fetchAccountMe,
  loginAccount,
  logoutAccount,
  normalizeAccountBaseUrl,
  parseAccountBaseUrl,
  refreshAccountSession,
  registerAccount,
  resetAccountPassword,
  resolveAccountBaseUrl,
  sendCode,
} from "./api"
import { AccountApiError, accountErrorMessage, isAccountApiError } from "./errors"
import type { AccountAuthPayload } from "./types"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

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
      avatarUpdatedAt: null, displayNameUpdatedAt: null },
    accessToken: "access-token",
    accessExpiresAt: 1793000900,
    refreshToken: "refresh-token",
    refreshExpiresAt: 1800776000,
    ...overrides,
  }
}

describe("parseAccountBaseUrl / normalizeAccountBaseUrl", () => {
  it("严格解析合法 http(s) 绝对地址并归一化尾斜杠", () => {
    expect(parseAccountBaseUrl("  https://account.test/  ")).toBe("https://account.test")
    expect(parseAccountBaseUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787")
    expect(parseAccountBaseUrl("https://account.test/api/")).toBe("https://account.test/api")
    expect(parseAccountBaseUrl("http://localhost:8787")).toBe("http://localhost:8787")
  })

  it("严格 parse 拒绝无协议、空串、非法协议、userinfo、query、hash 与无主机地址", () => {
    expect(parseAccountBaseUrl("account.test/")).toBeNull()
    expect(parseAccountBaseUrl("")).toBeNull()
    expect(parseAccountBaseUrl("   ")).toBeNull()
    expect(parseAccountBaseUrl("https://")).toBeNull()
    expect(parseAccountBaseUrl("http:///")).toBeNull()
    expect(parseAccountBaseUrl("ftp://account.test")).toBeNull()
    expect(parseAccountBaseUrl("https://user:pass@account.test")).toBeNull()
    expect(parseAccountBaseUrl("https://account.test?x=1")).toBeNull()
    expect(parseAccountBaseUrl("https://account.test#frag")).toBeNull()
  })

  it("normalize 仍会补 https，非法/空回默认地址", () => {
    expect(normalizeAccountBaseUrl("account.test/")).toBe("https://account.test")
    expect(normalizeAccountBaseUrl("localhost:8787")).toBe("https://localhost:8787")
    expect(normalizeAccountBaseUrl("  ")).toBe(DEFAULT_ACCOUNT_BASE_URL)
    expect(normalizeAccountBaseUrl("ftp://account.test")).toBe(DEFAULT_ACCOUNT_BASE_URL)
    expect(normalizeAccountBaseUrl("https://user@account.test")).toBe(DEFAULT_ACCOUNT_BASE_URL)
    expect(normalizeAccountBaseUrl("https://account.test/")).toBe("https://account.test")
  })
})

describe("resolveAccountBaseUrl", () => {
  it("没有环境变量时使用默认地址", () => {
    expect(resolveAccountBaseUrl()).toBe(DEFAULT_ACCOUNT_BASE_URL)
  })

  it("优先使用 VITE_QMAI_ACCOUNT_URL，非法环境地址回默认", () => {
    vi.stubEnv("VITE_QMAI_ACCOUNT_URL", "https://env-account.test/")
    expect(resolveAccountBaseUrl()).toBe("https://env-account.test")

    vi.stubEnv("VITE_QMAI_ACCOUNT_URL", "ftp://evil.test")
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

  it("void 接口的空 body / 204 视为成功", async () => {
    const empty = fakeFetch(() => new Response(null, { status: 204 }))
    await expect(logoutAccount(BASE, "refresh-token", empty.fetchImpl)).resolves.toBeUndefined()
    await expect(resetAccountPassword(BASE, {
      email: "author@example.com",
      code: "654321",
      password: "new-password",
    }, empty.fetchImpl)).resolves.toBeUndefined()
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
    // NOT_FOUND 现在是客户端认识的正规错误码，未知码换一个真正陌生的值。
    const { fetchImpl } = fakeFetch(() => failure("SOMETHING_ELSE" as never, "未知。", 500))
    const error = await captureError(sendCode(BASE, "a@b.com", "register", fetchImpl))
    expect(error.code).toBe("SERVER_ERROR")
  })

  it("HTTP 403 无 code 或 HTML 页兜底为 SERVER_ERROR，不误判停用", async () => {
    const html = fakeFetch(() => new Response("<html>Forbidden</html>", {
      status: 403,
      headers: { "Content-Type": "text/html" },
    }))
    const htmlError = await captureError(sendCode(BASE, "a@b.com", "register", html.fetchImpl))
    expect(htmlError.code).toBe("SERVER_ERROR")
    expect(htmlError.status).toBe(403)
    expect(accountErrorMessage(htmlError)).toBe("账号服务暂时不可用，请稍后再试。")

    const coded = fakeFetch(() => failure("ACCOUNT_DISABLED", "账号已停用", 403))
    const codedError = await captureError(sendCode(BASE, "a@b.com", "register", coded.fetchImpl))
    expect(codedError.code).toBe("ACCOUNT_DISABLED")
  })

  it("20 秒无响应按 NETWORK 超时，并清理 signal 定时器", async () => {
    vi.useFakeTimers()
    // 故意不监听 abort：计时器必须能自己结束请求，不能依赖 fetch 实现。
    const { fetchImpl, calls } = fakeFetch(() => new Promise<Response>(() => undefined))

    const request = sendCode(BASE, "a@b.com", "register", fetchImpl)
    const assertion = expect(request).rejects.toMatchObject({ code: "NETWORK", status: 0 })

    await vi.advanceTimersByTimeAsync(ACCOUNT_REQUEST_TIMEOUT_MS - 1)
    expect(calls[0]?.init.signal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await assertion
    expect(calls[0]?.init.signal?.aborted).toBe(true)
  })

  it("网络异常映射为 NETWORK / status 0", async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new TypeError("Failed to fetch")
    })

    const error = await captureError(sendCode(BASE, "a@b.com", "register", fetchImpl))
    expect(error).toBeInstanceOf(AccountApiError)
    expect(error.code).toBe("NETWORK")
    expect(error.status).toBe(0)
    expect(accountErrorMessage(error)).toBe("网络不可用，请检查连接后重试。")
  })
})/*
 * 设备指纹与设备密钥在测试里 mock 成「取不到」：
 * 真实实现会调 Tauri 命令 / WebCrypto，Node 下会真的生成一对密钥，
 * 让下面「请求体只有这些字段」的断言变得依赖运行环境。
 * 设备相关的行为由 device.spec / request-sign.spec 单独覆盖。
 *
 * 用 hoisted ref 而不是写死 null：注册/登录已各自有「带 deviceLabel」的用例，
 * 续期上报 dev/dpk 是后补的关键路径（refresh 丢字段会把网关卡的设备绑定洗掉），
 * 需要一个能开能关的 mock。默认仍是取不到 = 旧断言不受影响。
 */
const deviceStub = vi.hoisted(() => ({
  fingerprint: null as string | null,
  publicKey: null as string | null,
}))
vi.mock("@/lib/account/device", () => ({
  getDeviceFingerprint: async () => deviceStub.fingerprint,
}))
vi.mock("@/lib/account/request-sign", () => ({
  ensureDeviceKey: async () => (deviceStub.publicKey ? { publicKey: deviceStub.publicKey, privateKey: {} } : null),
  signRequestHeaders: async () => ({}),
}))

describe("refresh 携带设备绑定字段", () => {
  afterEach(() => {
    deviceStub.fingerprint = null
    deviceStub.publicKey = null
  })

  it("能取到设备指纹与公钥时，续期请求体带上 deviceHash / devicePublicKey", async () => {
    deviceStub.fingerprint = "0123456789abcdef0123456789abcdef"
    deviceStub.publicKey = "pubkey-43-chars-base64url-xxxxxxxxxxxxxxxxxxx"
    const next = authPayload({ refreshToken: "rotated" })
    const { fetchImpl, calls } = fakeFetch(() => success(next))

    await refreshAccountSession(BASE, "old-refresh", fetchImpl)

    const body = JSON.parse(String(calls[0]?.init.body))
    expect(body.refreshToken).toBe("old-refresh")
    expect(body.deviceHash).toBe("0123456789abcdef0123456789abcdef")
    expect(body.devicePublicKey).toBe("pubkey-43-chars-base64url-xxxxxxxxxxxxxxxxxxx")
  })

  it("取不到时不上传空字段（服务端沿用旧行为跳过设备限额）", async () => {
    const { fetchImpl, calls } = fakeFetch(() => success(authPayload()))

    await refreshAccountSession(BASE, "old-refresh", fetchImpl)

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ refreshToken: "old-refresh" })
  })
})


