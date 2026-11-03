// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 登录态落在系统加密仓库（Windows DPAPI），不再以明文躺在 localStorage。
 *
 * ## 为什么必须锁住
 *
 * 会话里有三样长命凭据：`refreshToken`（90 天，可换发 accessToken）、
 * `netcard`（10 年，直接代表内置模型额度）、`accessToken`（15 分钟）。
 * 它们此前是一份明文 JSON。审计结论是：被 DPAPI 保护的反而只有价值最低、
 * 寿命最短的登录密码 —— 本末倒置。
 *
 * 这组用例锁四件事：
 *   1. Tauri 下读写都走 `secret_get` / `secret_set`，不碰 localStorage 明文；
 *   2. 升级迁移：旧明文先写进加密仓库、再删掉，顺序不能反（否则中间态丢登录态）；
 *   3. 未 hydrate 时同步读返回 null —— 不给明文旁路；
 *   4. 清除时两处都清（DPAPI + 残留明文）。
 */

const secrets = new Map<string, string>()
const invokeMock = vi.hoisted(() => vi.fn())
const tauriFlag = vi.hoisted(() => ({ value: true }))

vi.mock("@/lib/platform", () => ({ isTauri: () => tauriFlag.value }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

const USER = {
  id: 12,
  email: "writer@example.com",
  displayName: "青禾",
  createdAt: 1_793_000_000,
  avatarUpdatedAt: null,
  displayNameUpdatedAt: null,
}

function sessionJson(refreshToken = "refresh-token-1"): string {
  return JSON.stringify({
    baseUrl: "https://account.test",
    accessToken: "access-token",
    accessExpiresAt: 1_793_000_900,
    refreshToken,
    refreshExpiresAt: 1_800_776_000,
    user: USER,
    savedAt: 1_793_000_000,
    netcard: "netcard-abc",
  })
}

let session: typeof import("./session")

beforeEach(async () => {
  secrets.clear()
  invokeMock.mockReset()
  tauriFlag.value = true
  localStorage.clear()

  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "secret_get") return secrets.get(String(args?.name)) ?? null
    if (command === "secret_set") {
      secrets.set(String(args?.name), String(args?.value))
      return undefined
    }
    if (command === "secret_clear") {
      secrets.delete(String(args?.name))
      return undefined
    }
    return undefined
  })

  vi.resetModules()
  session = await import("./session")
})

describe("登录态存进系统加密仓库", () => {
  it("hydrate 从 secret_get 读，不读 localStorage", async () => {
    secrets.set("account-session", sessionJson())
    localStorage.setItem("qmai.account.session.v1", sessionJson("from-plaintext"))

    await session.hydrateAccountSession()

    const loaded = session.loadAccountSession()
    // 加密仓库里的那份优先：明文是待删的旧副本。
    expect(loaded?.refreshToken).toBe("refresh-token-1")
  })

  it("保存只写加密仓库，不再往 localStorage 写明文", async () => {
    await session.hydrateAccountSession()
    const stored = {
      baseUrl: "https://account.test",
      accessToken: "a",
      accessExpiresAt: 1,
      refreshToken: "new-refresh",
      refreshExpiresAt: 2,
      user: USER,
      savedAt: 3,
      netcard: null,
    }

    session.saveAccountSession(stored)

    // 落盘是 fire-and-forget：等它真的落地（内部有多层 await，不能用
    // 固定次数的 Promise.resolve 赌时序）。
    await vi.waitFor(() => expect(secrets.get("account-session")).toContain("new-refresh"))
    expect(localStorage.getItem("qmai.account.session.v1")).toBeNull()
  })

  it("清除时两处都清（DPAPI + 可能残留的明文）", async () => {
    secrets.set("account-session", sessionJson())
    localStorage.setItem("qmai.account.session.v1", sessionJson())
    await session.hydrateAccountSession()

    session.clearAccountSession()

    await vi.waitFor(() => expect(secrets.has("account-session")).toBe(false))
    expect(localStorage.getItem("qmai.account.session.v1")).toBeNull()
    expect(session.loadAccountSession()).toBeNull()
  })

  it("未 hydrate 时同步读返回 null：不给明文旁路", () => {
    // 即使明文还在，也不该被读出来（Tauri 下必须先 hydrate）。
    localStorage.setItem("qmai.account.session.v1", sessionJson())

    expect(session.loadAccountSession()).toBeNull()
  })
})

describe("旧明文会话的升级迁移", () => {
  it("先写进加密仓库，再删明文", async () => {
    localStorage.setItem("qmai.account.session.v1", sessionJson("legacy-refresh"))

    await session.hydrateAccountSession()

    // 新副本已就位。
    expect(secrets.get("account-session")).toContain("legacy-refresh")
    // 明文已删。
    expect(localStorage.getItem("qmai.account.session.v1")).toBeNull()
    // 登录态可用。
    expect(session.loadAccountSession()?.refreshToken).toBe("legacy-refresh")
  })

  it("加密仓库已有数据时不覆盖（迁移只发生在首次）", async () => {
    secrets.set("account-session", sessionJson("authoritative"))
    localStorage.setItem("qmai.account.session.v1", sessionJson("stale-plaintext"))

    await session.hydrateAccountSession()

    expect(secrets.get("account-session")).toContain("authoritative")
    expect(session.loadAccountSession()?.refreshToken).toBe("authoritative")
  })

  it("坏数据：连存储一起清掉，不会每次启动都解析同一份垃圾", async () => {
    secrets.set("account-session", "{ not json")

    await session.hydrateAccountSession()

    expect(session.loadAccountSession()).toBeNull()
    expect(secrets.has("account-session")).toBe(false)
  })
})

describe("非 Tauri 环境保持旧行为（浏览器预览 / 测试）", () => {
  it("退回 localStorage，同步读写立即可见", async () => {
    tauriFlag.value = false
    vi.resetModules()
    const browserSession = await import("./session")
    const stored = {
      baseUrl: "https://account.test",
      accessToken: "a",
      accessExpiresAt: 1,
      refreshToken: "browser-refresh",
      refreshExpiresAt: 2,
      user: USER,
      savedAt: 3,
      netcard: null,
    }

    browserSession.saveAccountSession(stored)
    // 不需要 await：localStorage 分支在同一个同步调用里就写完了。
    expect(browserSession.loadAccountSession()?.refreshToken).toBe("browser-refresh")
  })
})
