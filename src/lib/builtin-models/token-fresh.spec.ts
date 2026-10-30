import { beforeEach, describe, expect, it } from "vitest"
import { ensureBuiltinTicket, resetTicketCache } from "./token-fresh"
import type { BuiltinSession } from "./session"

function session(overrides: Partial<BuiltinSession> = {}): BuiltinSession {
  const now = Math.floor(Date.now() / 1000)
  return {
    serverUrl: "https://relay.qmai.work",
    tokenKey: "old-ticket",
    expiresAt: now + 1800,
    userId: 7,
    updatedAt: Date.now(),
    ...overrides,
  }
}

const ACCOUNT = "https://account.qmai.work"

beforeEach(() => {
  resetTicketCache()
})

describe("ensureBuiltinTicket", () => {
  it("票据仍新鲜时不换票", async () => {
    let exchanges = 0
    const result = await ensureBuiltinTicket({
      session: session(),
      accountBaseUrl: ACCOUNT,
      accountAccessToken: "access",
      userId: 7,
      exchange: async () => {
        exchanges += 1
        return { token: "new", expiresAt: 1 }
      },
    })
    expect(result.refreshed).toBe(false)
    expect(result.session?.tokenKey).toBe("old-ticket")
    expect(exchanges).toBe(0)
  })

  it("票据快过期（<120 秒）时换一张新的，并回调持久化", async () => {
    const now = Math.floor(Date.now() / 1000)
    let persisted: BuiltinSession | null = null

    const result = await ensureBuiltinTicket({
      session: session({ expiresAt: now + 60 }),
      accountBaseUrl: ACCOUNT,
      accountAccessToken: "access",
      userId: 7,
      exchange: async () => ({ token: "fresh", expiresAt: now + 1800 }),
      onRefreshed: (next) => {
        persisted = next
      },
    })

    expect(result.refreshed).toBe(true)
    expect(result.session?.tokenKey).toBe("fresh")
    expect(result.session?.serverUrl).toBe("https://relay.qmai.work")
    expect(persisted?.tokenKey).toBe("fresh")
  })

  it("还没有会话（首次启用）时换票", async () => {
    const now = Math.floor(Date.now() / 1000)
    const result = await ensureBuiltinTicket({
      session: null,
      accountBaseUrl: ACCOUNT,
      accountAccessToken: "access",
      userId: 7,
      exchange: async () => ({ token: "first", expiresAt: now + 1800 }),
    })
    expect(result.refreshed).toBe(true)
    expect(result.session?.tokenKey).toBe("first")
    expect(result.session?.userId).toBe(7)
  })

  it("换账号后旧票作废并重换", async () => {
    const now = Math.floor(Date.now() / 1000)
    const result = await ensureBuiltinTicket({
      session: session({ userId: 7, expiresAt: now + 1800 }),
      accountBaseUrl: ACCOUNT,
      accountAccessToken: "access-of-user-9",
      userId: 9,
      exchange: async () => ({ token: "ticket-9", expiresAt: now + 1800 }),
    })
    expect(result.refreshed).toBe(true)
    expect(result.session?.tokenKey).toBe("ticket-9")
    expect(result.session?.userId).toBe(9)
  })

  it("未登录时不动旧票，交给上层引导登录", async () => {
    let exchanges = 0
    const result = await ensureBuiltinTicket({
      session: null,
      accountBaseUrl: ACCOUNT,
      accountAccessToken: null,
      userId: null,
      exchange: async () => {
        exchanges += 1
        return { token: "x", expiresAt: 1 }
      },
    })
    expect(result.refreshed).toBe(false)
    expect(result.session).toBeNull()
    expect(exchanges).toBe(0)
  })

  it("换票失败时不抛错，回退旧票（让上层按 401 引导重登）", async () => {
    const now = Math.floor(Date.now() / 1000)
    const old = session({ expiresAt: now + 30 })
    const result = await ensureBuiltinTicket({
      session: old,
      accountBaseUrl: ACCOUNT,
      accountAccessToken: "access",
      userId: 7,
      exchange: async () => {
        throw new Error("boom")
      },
    })
    expect(result.refreshed).toBe(false)
    expect(result.session?.tokenKey).toBe("old-ticket")
  })

  it("并发调用只换一次票", async () => {
    const now = Math.floor(Date.now() / 1000)
    let exchanges = 0
    const exchange = async () => {
      exchanges += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { token: `t-${exchanges}`, expiresAt: now + 1800 }
    }

    const results = await Promise.all([
      ensureBuiltinTicket({ session: null, accountBaseUrl: ACCOUNT, accountAccessToken: "access", userId: 7, exchange }),
      ensureBuiltinTicket({ session: null, accountBaseUrl: ACCOUNT, accountAccessToken: "access", userId: 7, exchange }),
      ensureBuiltinTicket({ session: null, accountBaseUrl: ACCOUNT, accountAccessToken: "access", userId: 7, exchange }),
    ])

    expect(exchanges).toBe(1)
    expect(results.every((item) => item.session?.tokenKey === "t-1")).toBe(true)
  })
})
