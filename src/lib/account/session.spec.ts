// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  ACCOUNT_SESSION_STORAGE_KEY,
  clearAccountSession,
  createStoredSession,
  isAccessTokenFresh,
  loadAccountSession,
  saveAccountSession,
} from "./session"
import type { AccountAuthPayload, StoredAccountSession } from "./types"

function authPayload(overrides: Partial<AccountAuthPayload> = {}): AccountAuthPayload {
  return {
    user: {
      id: 12,
      email: "author@example.com",
      displayName: "作者",
      createdAt: 1793000000,
      avatarUpdatedAt: null, avatarToken: null, displayNameUpdatedAt: null,
    },
    accessToken: "access-token",
    accessExpiresAt: 1793000900,
    refreshToken: "refresh-token",
    refreshExpiresAt: 1800776000,
    ...overrides,
  }
}

function storedSession(overrides: Partial<StoredAccountSession> = {}): StoredAccountSession {
  return {
    ...createStoredSession("https://account.test", authPayload()),
    ...overrides,
  }
}

describe("account session", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("createStoredSession 归一化地址、写入 savedAt 并复制用户", () => {
    const payload = authPayload()
    const before = Math.floor(Date.now() / 1000)
    const session = createStoredSession("https://account.test/", payload)

    expect(session.baseUrl).toBe("https://account.test")
    expect(session.accessToken).toBe("access-token")
    expect(session.refreshToken).toBe("refresh-token")
    expect(session.savedAt).toBeGreaterThanOrEqual(before)
    expect(session.user).toEqual(payload.user)
    expect(session.user).not.toBe(payload.user)
  })

  it("保存后可以读回", () => {
    const session = storedSession()
    saveAccountSession(session)

    expect(loadAccountSession()).toEqual(session)
  })

  it("损坏 JSON 会删除并返回 null", () => {
    localStorage.setItem(ACCOUNT_SESSION_STORAGE_KEY, "{not-json")
    expect(loadAccountSession()).toBeNull()
    expect(localStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY)).toBeNull()
  })

  it("字段缺失或 token 为空会删除并返回 null", () => {
    localStorage.setItem(ACCOUNT_SESSION_STORAGE_KEY, JSON.stringify(storedSession({
      accessToken: "",
    })))
    expect(loadAccountSession()).toBeNull()
    expect(localStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY)).toBeNull()

    localStorage.setItem(ACCOUNT_SESSION_STORAGE_KEY, JSON.stringify({
      ...storedSession(),
      user: { id: 12, email: "author@example.com" },
    }))
    expect(loadAccountSession()).toBeNull()
    expect(localStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY)).toBeNull()
  })

  it("savedAt 缺失视为坏数据", () => {
    const withoutSavedAt: Record<string, unknown> = { ...storedSession() }
    delete withoutSavedAt.savedAt
    localStorage.setItem(ACCOUNT_SESSION_STORAGE_KEY, JSON.stringify(withoutSavedAt))
    expect(loadAccountSession()).toBeNull()
    expect(localStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY)).toBeNull()
  })

  it("非法 baseUrl 拒绝整份会话，不静默指向默认服务", () => {
    for (const baseUrl of ["   ", "ftp://account.test", "https://user:pass@account.test", "https://account.test?x=1"]) {
      localStorage.setItem(ACCOUNT_SESSION_STORAGE_KEY, JSON.stringify(storedSession({ baseUrl })))
      expect(loadAccountSession()).toBeNull()
      expect(localStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY)).toBeNull()
    }
  })

  it("老的 workers.dev 会话会被迁移到自定义域名（令牌继续有效）", () => {
    localStorage.setItem(
      ACCOUNT_SESSION_STORAGE_KEY,
      JSON.stringify(storedSession({ baseUrl: "https://qmai-account.qmai.workers.dev" })),
    )

    const loaded = loadAccountSession()

    expect(loaded?.baseUrl).toBe("https://account.qmai.pro")
    // 迁移结果要落盘，否则每次启动都重复迁移
    expect(JSON.parse(localStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY)!).baseUrl).toBe(
      "https://account.qmai.pro",
    )
  })

  it("读取 localStorage 抛异常时回 null", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled")
    })
    try {
      expect(loadAccountSession()).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })

  it("clearAccountSession 删除存储", () => {
    saveAccountSession(storedSession())
    clearAccountSession()
    expect(localStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY)).toBeNull()
  })

  it("access 过期按 60 秒提前量判断", () => {
    const now = Math.floor(Date.now() / 1000)

    expect(isAccessTokenFresh(storedSession({ accessExpiresAt: now + 61 }))).toBe(true)
    expect(isAccessTokenFresh(storedSession({ accessExpiresAt: now + 59 }))).toBe(false)
    expect(isAccessTokenFresh(storedSession({ accessExpiresAt: now + 31 }), 30)).toBe(true)
  })
})
