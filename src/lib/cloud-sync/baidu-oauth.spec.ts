import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  OAUTH_REDIRECT_URI,
  OAUTH_TOKEN_URL,
  randomState,
  refreshAccessToken,
  type FetchLike,
} from "./baidu-oauth"

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function okFetch(payload: Record<string, unknown>): FetchLike {
  return vi.fn(async () => jsonResponse(payload)) as unknown as FetchLike
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("buildAuthorizeUrl", () => {
  it("包含授权码模式、AppKey、回调地址与 state", () => {
    const url = new URL(buildAuthorizeUrl("AppKeyTest", "state01"))
    expect(url.origin + url.pathname).toBe("https://openapi.baidu.com/oauth/2.0/authorize")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("client_id")).toBe("AppKeyTest")
    expect(url.searchParams.get("redirect_uri")).toBe(OAUTH_REDIRECT_URI)
    expect(url.searchParams.get("scope")).toBe("basic,netdisk")
    expect(url.searchParams.get("state")).toBe("state01")
  })

  it("redirect_uri 与控制台登记的回调一致（固定端口 17653）", () => {
    expect(OAUTH_REDIRECT_URI).toBe("http://127.0.0.1:17653/callback")
  })
})

describe("randomState", () => {
  it("生成 32 位 hex 且不重复", () => {
    const a = randomState()
    const b = randomState()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(b).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })
})

describe("exchangeCodeForTokens", () => {
  it("成功时映射 access/refresh token 并换算绝对过期时间", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"))
    const fetchFn = okFetch({
      access_token: "at-1",
      refresh_token: "rt-1",
      expires_in: 2592000,
      scope: "basic netdisk",
    })
    const tokens = await exchangeCodeForTokens(fetchFn, {
      appKey: "k",
      secretKey: "s",
      code: "c",
    })
    expect(tokens.accessToken).toBe("at-1")
    expect(tokens.refreshToken).toBe("rt-1")
    expect(tokens.expiresAtMs).toBe(Date.now() + 2592000 * 1000)
    expect(tokens.scope).toBe("basic netdisk")
    vi.useRealTimers()
  })

  it("授权地址登记错误时给出回调地址提示", async () => {
    const fetchFn = okFetch(
      { error: "invalid_redirect_uri", error_description: "mismatch" },
      false,
      400,
    )
    await expect(
      exchangeCodeForTokens(fetchFn, { appKey: "k", secretKey: "s", code: "c" }),
    ).rejects.toThrow("http://127.0.0.1:17653/callback")
  })

  it("授权码失效时提示重新授权", async () => {
    const fetchFn = okFetch({ error: "invalid_grant" }, false, 400)
    await expect(
      exchangeCodeForTokens(fetchFn, { appKey: "k", secretKey: "s", code: "c" }),
    ).rejects.toThrow("重新发起授权")
  })
})

describe("refreshAccessToken", () => {
  it("走 refresh_token 授权类型并返回新令牌", async () => {
    const seen: string[] = []
    const fetchFn = vi.fn(async (url: string) => {
      seen.push(url)
      return jsonResponse({ access_token: "at-2", refresh_token: "rt-2", expires_in: 100 })
    }) as unknown as FetchLike
    const tokens = await refreshAccessToken(fetchFn, {
      appKey: "k",
      secretKey: "s",
      refreshToken: "rt-old",
    })
    expect(tokens.accessToken).toBe("at-2")
    expect(seen[0]).toContain(OAUTH_TOKEN_URL)
    expect(seen[0]).toContain("grant_type=refresh_token")
    expect(seen[0]).toContain("refresh_token=rt-old")
  })
})
