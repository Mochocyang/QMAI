import { describe, expect, it, vi } from "vitest"

import {
  BAIDU_SCOPE,
  handleBaiduBegin,
  handleBaiduCallback,
  handleBaiduPoll,
  handleBaiduRefresh,
  normalizeAuthorizedPaths,
} from "../src/baidu-oauth"
import type { Env } from "../src/types"

/**
 * 轻量 D1 替身：只实现本模块用到的 prepare/bind/first/run。
 *
 * 不引真 D1（miniflare）是为了让这批用例保持纯 node、毫秒级跑完；
 * SQL 语义我们不做通用解析，只按语句特征分派。
 */
class FakeD1 {
  rows = new Map<string, Record<string, unknown>>()
  /** 记录执行过的语句，便于断言「poll 成功后会删除会话」。 */
  statements: string[] = []

  prepare(sql: string) {
    const self = this
    const normalized = sql.replace(/\s+/g, " ").trim()
    return {
      bind(...args: unknown[]) {
        return {
          async first<T>(): Promise<T | null> {
            self.statements.push(`first:${normalized.slice(0, 40)}`)
            if (normalized.includes("WHERE state = ?")) {
              const state = args[0] as string
              for (const row of self.rows.values()) {
                if (row.state === state) return row as T
              }
              return null
            }
            if (normalized.includes("WHERE session_id = ?")) {
              const id = args[0] as string
              return (self.rows.get(id) as T) ?? null
            }
            return null
          },
          async run(): Promise<{ meta: { changes: number } }> {
            self.statements.push(`run:${normalized.slice(0, 40)}`)
            if (normalized.startsWith("INSERT INTO baidu_oauth_sessions")) {
              const [sessionId, state, createdAt, expiresAt] = args as [
                string,
                string,
                number,
                number,
              ]
              self.rows.set(sessionId, {
                session_id: sessionId,
                state,
                status: "pending",
                token_cipher: null,
                token_iv: null,
                scope: null,
                authorized_paths: null,
                error_code: null,
                created_at: createdAt,
                expires_at: expiresAt,
              })
              return { meta: { changes: 1 } }
            }
            if (normalized.startsWith("UPDATE baidu_oauth_sessions")) {
              if (normalized.includes("status = 'authorized'")) {
                const [cipher, iv, scope, paths, expiresAt, sessionId] = args as [
                  string,
                  string,
                  string,
                  string,
                  number,
                  string,
                ]
                const row = self.rows.get(sessionId)
                if (row) {
                  Object.assign(row, {
                    status: "authorized",
                    token_cipher: cipher,
                    token_iv: iv,
                    scope,
                    authorized_paths: paths,
                    expires_at: expiresAt,
                  })
                }
                return { meta: { changes: row ? 1 : 0 } }
              }
              // failSession
              const [errorCode, expiresAt, sessionId] = args as [string, number, string]
              const row = self.rows.get(sessionId)
              if (row) {
                Object.assign(row, {
                  status: "failed",
                  error_code: errorCode,
                  expires_at: expiresAt,
                })
              }
              return { meta: { changes: row ? 1 : 0 } }
            }
            if (normalized.startsWith("DELETE FROM baidu_oauth_sessions")) {
              const id = args[0] as string
              const existed = self.rows.delete(id)
              return { meta: { changes: existed ? 1 : 0 } }
            }
            return { meta: { changes: 0 } }
          },
        }
      },
    }
  }
}

function makeEnv(overrides: Partial<Env> = {}): { env: Env; db: FakeD1 } {
  const db = new FakeD1()
  const env = {
    DB: db as unknown as D1Database,
    AUTH_CODE_PEPPER: "test-pepper-at-least-16-bytes",
    BAIDU_APP_KEY: "TEST_APP_KEY",
    BAIDU_APP_SECRET: "TEST_APP_SECRET",
    BAIDU_REDIRECT_URI: "https://qmai.pro/oauth/baidu/callback",
    ...overrides,
  } as Env
  return { env, db }
}

describe("normalizeAuthorizedPaths", () => {
  it("keeps plain strings and trims them", () => {
    expect(normalizeAuthorizedPaths(["/apps/青幕AI写作", "  /我的小说  "])).toEqual([
      "/apps/青幕AI写作",
      "/我的小说",
    ])
  })

  it("accepts object shapes the API may return", () => {
    expect(
      normalizeAuthorizedPaths([{ path: "/apps/a" }, { dir: "/b" }, { dirname: "/c" }]),
    ).toEqual(["/apps/a", "/b", "/c"])
  })

  it("drops empty and non-string junk instead of throwing", () => {
    expect(normalizeAuthorizedPaths([null, undefined, 42, "", "   ", "/ok"])).toEqual(["/ok"])
    expect(normalizeAuthorizedPaths(undefined)).toEqual([])
    expect(normalizeAuthorizedPaths("not-an-array")).toEqual([])
  })
})

describe("handleBaiduBegin", () => {
  it("builds a directory-scoped authorize url and persists a pending session", async () => {
    const { env, db } = makeEnv()
    const response = await handleBaiduBegin(
      new Request("https://qmai.pro/v1/oauth/baidu/begin", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
      env,
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(typeof body.sessionId).toBe("string")
    expect(body.expiresIn).toBe(600)
    // 换机恢复依赖应用专属文件夹，客户端要据此提示用户保持勾选。
    expect(body.requireAppFolder).toBe(true)

    const url = new URL(String(body.authorizeUrl))
    // 目录级授权走 pan.baidu.com/union/oauth，不是 openapi 的通用授权端点。
    expect(url.host).toBe("pan.baidu.com")
    expect(url.pathname).toBe("/union/oauth/authorize")
    expect(url.searchParams.get("client_id")).toBe("TEST_APP_KEY")
    expect(url.searchParams.get("scope")).toBe(BAIDU_SCOPE)
    expect(url.searchParams.get("scope")).toBe("nd_open_read,nd_open_write")
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://qmai.pro/oauth/baidu/callback",
    )
    expect(url.searchParams.get("state")).toBeTruthy()
    // 通用授权才有的参数不该出现在目录级授权里。
    expect(url.searchParams.get("response_type")).toBeNull()

    expect(db.rows.size).toBe(1)
    const row = [...db.rows.values()][0]
    expect(row.status).toBe("pending")
    expect(row.state).toBe(url.searchParams.get("state"))
  })

  it("fails closed when AppKey or secret is missing", async () => {
    const { env } = makeEnv({ BAIDU_APP_KEY: undefined })
    const response = await handleBaiduBegin(
      new Request("https://qmai.pro/v1/oauth/baidu/begin", { method: "POST" }),
      env,
    )
    expect(response.status).toBe(500)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.errorCode).toBe("server.misconfigured")
  })
})

describe("handleBaiduPoll", () => {
  it("returns pending while the user has not authorized yet", async () => {
    const { env, db } = makeEnv()
    const begin = (await (
      await handleBaiduBegin(new Request("https://qmai.pro/v1/oauth/baidu/begin", { method: "POST" }), env)
    ).json()) as Record<string, unknown>
    const sessionId = String(begin.sessionId)

    const response = await handleBaiduPoll(
      new Request(`https://qmai.pro/v1/oauth/baidu/poll?sessionId=${sessionId}`),
      env,
    )
    expect(await response.json()).toEqual({ ok: true, status: "pending" })
    expect(db.rows.size).toBe(1)
  })

  it("rejects malformed session ids without touching the database", async () => {
    const { env, db } = makeEnv()
    const response = await handleBaiduPoll(
      new Request("https://qmai.pro/v1/oauth/baidu/poll?sessionId=short"),
      env,
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, errorCode: "invalid_session" })
    expect(db.statements).toHaveLength(0)
  })

  it("reports expired for unknown sessions", async () => {
    const { env } = makeEnv()
    const response = await handleBaiduPoll(
      new Request(
        `https://qmai.pro/v1/oauth/baidu/poll?sessionId=${"a".repeat(43)}`,
      ),
      env,
    )
    expect(await response.json()).toEqual({ ok: true, status: "expired" })
  })
})

describe("handleBaiduCallback", () => {
  it("stores an encrypted token and hands it over exactly once", async () => {
    const { env, db } = makeEnv()

    // 先把会话造出来（state 是回调时的校验依据）。
    const begin = (await (
      await handleBaiduBegin(new Request("https://qmai.pro/v1/oauth/baidu/begin", { method: "POST" }), env)
    ).json()) as Record<string, unknown>
    const sessionId = String(begin.sessionId)
    const state = new URL(String(begin.authorizeUrl)).searchParams.get("state")!

    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(
        JSON.stringify({
          access_token: "AT-123",
          refresh_token: "RT-456",
          expires_in: 2_592_000,
          scope: BAIDU_SCOPE,
          authorized_paths: ["/apps/青幕AI写作"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    try {
      const response = await handleBaiduCallback(
        new Request(`https://qmai.pro/oauth/baidu/callback?code=CODE-1&state=${state}`),
        env,
      )
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/html")
      expect(await response.text()).toContain("授权成功")

      // 换 token 的请求必须带 secret，且 redirect_uri 与发起授权一致。
      const called = new URL(String(fetchMock.mock.calls[0][0]))
      expect(called.host).toBe("pan.baidu.com")
      expect(called.searchParams.get("method")).toBe("token")
      expect(called.searchParams.get("client_secret")).toBe("TEST_APP_SECRET")
      expect(called.searchParams.get("redirect_uri")).toBe(
        "https://qmai.pro/oauth/baidu/callback",
      )

      // token 不能明文落库。
      const stored = db.rows.get(sessionId)!
      expect(stored.status).toBe("authorized")
      expect(String(stored.token_cipher)).not.toContain("AT-123")

      // 第一次 poll 交付 token。
      const first = (await (
        await handleBaiduPoll(
          new Request(`https://qmai.pro/v1/oauth/baidu/poll?sessionId=${sessionId}`),
          env,
        )
      ).json()) as Record<string, unknown>
      expect(first.status).toBe("authorized")
      expect(first.authorizedPaths).toEqual(["/apps/青幕AI写作"])
      const tokens = first.tokens as Record<string, unknown>
      expect(tokens.accessToken).toBe("AT-123")
      expect(tokens.refreshToken).toBe("RT-456")

      // 会话已销毁：第二次 poll 只能拿到 expired（token 一次性）。
      expect(db.rows.size).toBe(0)
      const second = (await (
        await handleBaiduPoll(
          new Request(`https://qmai.pro/v1/oauth/baidu/poll?sessionId=${sessionId}`),
          env,
        )
      ).json()) as Record<string, unknown>
      expect(second.status).toBe("expired")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("marks the session failed when the user denies", async () => {
    const { env, db } = makeEnv()
    const begin = (await (
      await handleBaiduBegin(new Request("https://qmai.pro/v1/oauth/baidu/begin", { method: "POST" }), env)
    ).json()) as Record<string, unknown>
    const sessionId = String(begin.sessionId)
    const state = new URL(String(begin.authorizeUrl)).searchParams.get("state")!

    const response = await handleBaiduCallback(
      new Request(
        `https://qmai.pro/oauth/baidu/callback?error=access_denied&state=${state}`,
      ),
      env,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toContain("取消")

    expect(db.rows.get(sessionId)!.status).toBe("failed")
    const poll = (await (
      await handleBaiduPoll(
        new Request(`https://qmai.pro/v1/oauth/baidu/poll?sessionId=${sessionId}`),
        env,
      )
    ).json()) as Record<string, unknown>
    expect(poll.status).toBe("failed")
    expect(poll.errorCode).toBe("access_denied")
  })

  it("rejects an unknown state (forged callback)", async () => {
    const { env } = makeEnv()
    const response = await handleBaiduCallback(
      new Request("https://qmai.pro/oauth/baidu/callback?code=X&state=forged"),
      env,
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toContain("会话不存在")
  })

  it("never leaks the secret into the rendered page", async () => {
    const { env } = makeEnv()
    const begin = (await (
      await handleBaiduBegin(new Request("https://qmai.pro/v1/oauth/baidu/begin", { method: "POST" }), env)
    ).json()) as Record<string, unknown>
    const state = new URL(String(begin.authorizeUrl)).searchParams.get("state")!

    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error: "invalid_client" }), { status: 200 }),
    )
    try {
      const response = await handleBaiduCallback(
        new Request(`https://qmai.pro/oauth/baidu/callback?code=C&state=${state}`),
        env,
      )
      const html = await response.text()
      expect(html).not.toContain("TEST_APP_SECRET")
      expect(html).toContain("百度没有返回访问凭证")
    } finally {
      vi.unstubAllGlobals()
    }
  })
})


describe("handleBaiduRefresh", () => {
  it("refreshes through the server so the secret never reaches the client", async () => {
    const { env } = makeEnv()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(
        JSON.stringify({
          access_token: "AT-NEW",
          refresh_token: "RT-NEW",
          expires_in: 2_592_000,
          scope: BAIDU_SCOPE,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)
    try {
      const response = await handleBaiduRefresh(
        new Request("https://qmai.pro/v1/oauth/baidu/refresh", {
          method: "POST",
          body: JSON.stringify({ refreshToken: "RT-OLD" }),
          headers: { "content-type": "application/json" },
        }),
        env,
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as Record<string, unknown>
      expect(body.ok).toBe(true)
      const tokens = body.tokens as Record<string, unknown>
      expect(tokens.accessToken).toBe("AT-NEW")
      // 百度 refresh_token 单次有效，必须把新值带回给客户端覆盖保存。
      expect(tokens.refreshToken).toBe("RT-NEW")

      const called = new URL(String(fetchMock.mock.calls[0][0]))
      expect(called.searchParams.get("method")).toBe("refresh_token")
      expect(called.searchParams.get("client_secret")).toBe("TEST_APP_SECRET")
      expect(called.searchParams.get("refresh_token")).toBe("RT-OLD")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("tells the client to reauthorize when the refresh token is dead", async () => {
    const { env } = makeEnv()
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 200 }),
    )
    try {
      const response = await handleBaiduRefresh(
        new Request("https://qmai.pro/v1/oauth/baidu/refresh", {
          method: "POST",
          body: JSON.stringify({ refreshToken: "DEAD" }),
        }),
        env,
      )
      expect(response.status).toBe(401)
      const body = (await response.json()) as Record<string, unknown>
      // 明确区分「网络问题可重试」与「授权失效必须重登」。
      expect(body.errorCode).toBe("reauthorize_required")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("rejects an empty refresh token without calling Baidu", async () => {
    const { env } = makeEnv()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    try {
      const response = await handleBaiduRefresh(
        new Request("https://qmai.pro/v1/oauth/baidu/refresh", {
          method: "POST",
          body: JSON.stringify({}),
        }),
        env,
      )
      expect(response.status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
