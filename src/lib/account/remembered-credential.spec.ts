import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  REMEMBERED_PASSWORD_TTL_MS,
  clearRememberedPassword,
  loadRememberedCredential,
  remainingDays,
  saveRememberedCredential,
} from "./remembered-credential"

/**
 * 「记住密码」：凭据 = 邮箱 + 密码，30 天有效。
 *
 * 邮箱必须一起记：只记密码的话，下次打开是「邮箱空着、密码填好」的
 * 半吊子状态，用户还是得手输邮箱，"免输登录"根本没成立（用户 2026-11-02
 * 指出）。两者打包成**一个** JSON 交给 DPAPI 密文——原子性：一起存、
 * 一起清、一起过期，不会出现有邮箱没密码的半截凭据；邮箱也不额外明文
 * 落一份。Rust 端把它整体当不透明字节，零改动。
 *
 * 有效期是功能的边界：用户勾的是「记住密码」，不是「永久托管密码」。
 * 超过 30 天必须失效，否则磁盘上长期躺着一份能直接登录的凭据。
 * 时间基准：登录成功那一刻起算，不做「每次自动登录就续期」——
 * 那等于只要经常打开软件就永不过期，30 天形同虚设。
 */

/** 后端凭据存储的内存替身：password 字段存的是整个凭据 JSON 字符串。 */
const store = new Map<string, { password: string; savedAt: number }>()

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/platform", () => ({ isTauri: vi.fn(() => true) }))

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date("2026-11-02T12:00:00Z").getTime()
const CRED = { email: "writer@example.com", password: "pass1234" }

beforeEach(() => {
  store.clear()
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "account_credential_save") {
      store.set("credential", {
        password: String(args?.password ?? ""),
        savedAt: Number(args?.savedAt ?? 0),
      })
      return undefined
    }
    if (command === "account_credential_load") {
      const record = store.get("credential")
      if (!record) return { password: "", saved_at: 0 }
      return { password: record.password, saved_at: record.savedAt }
    }
    if (command === "account_credential_clear") {
      store.delete("credential")
      return undefined
    }
    throw new Error(`unexpected command: ${command}`)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("记住密码（邮箱 + 密码）", () => {
  it("保存的凭据同时包含邮箱与密码", async () => {
    const ok = await saveRememberedCredential(CRED, NOW)

    expect(ok).toBe(true)
    const raw = store.get("credential")?.password ?? ""
    expect(raw).toContain("writer@example.com")
    expect(raw).toContain("pass1234")
  })

  it("取回时邮箱与密码都还原", async () => {
    await saveRememberedCredential(CRED, NOW)

    await expect(loadRememberedCredential(NOW)).resolves.toEqual(CRED)
  })

  it("旧格式（裸密码，没有邮箱）仍能取回：升级后不把用户已存的密码作废", async () => {
    store.set("credential", { password: "legacy-pass", savedAt: Math.floor(NOW / 1000) })

    await expect(loadRememberedCredential(NOW)).resolves.toEqual({ email: "", password: "legacy-pass" })
  })

  it("保存时把时间戳一起交给后端", async () => {
    await saveRememberedCredential(CRED, NOW)

    expect(store.get("credential")?.savedAt).toBe(Math.floor(NOW / 1000))
  })

  it("30 天内可以取回", async () => {
    await saveRememberedCredential(CRED, NOW)

    await expect(loadRememberedCredential(NOW + 29 * DAY)).resolves.toEqual(CRED)
  })

  it("刚好满 30 天仍有效，超过 30 天失效", async () => {
    await saveRememberedCredential(CRED, NOW)

    await expect(loadRememberedCredential(NOW + REMEMBERED_PASSWORD_TTL_MS)).resolves.toEqual(CRED)
    await expect(loadRememberedCredential(NOW + REMEMBERED_PASSWORD_TTL_MS + 1000)).resolves.toBeNull()
  })

  it("过期后顺手删除凭据，不在磁盘上留失效密文", async () => {
    await saveRememberedCredential(CRED, NOW)

    await loadRememberedCredential(NOW + REMEMBERED_PASSWORD_TTL_MS + 1000)
    // 清理是 fire-and-forget 的（不阻塞读取）：用真实计时器等它跑完。
    await vi.waitFor(() => expect(store.has("credential")).toBe(false))
  })

  it("不做续期：中途多次读取不会延长有效期", async () => {
    await saveRememberedCredential(CRED, NOW)

    await loadRememberedCredential(NOW + 10 * DAY)
    await loadRememberedCredential(NOW + 20 * DAY)
    await loadRememberedCredential(NOW + 29 * DAY)

    await expect(loadRememberedCredential(NOW + 30 * DAY + 1000)).resolves.toBeNull()
  })

  it("没有时间戳按已过期处理", async () => {
    store.set("credential", { password: "old", savedAt: 0 })

    await expect(loadRememberedCredential(NOW)).resolves.toBeNull()
  })

  it("系统时间被回拨时不认这个凭据", async () => {
    await saveRememberedCredential(CRED, NOW)

    await expect(loadRememberedCredential(NOW - DAY)).resolves.toBeNull()
  })

  it("从未保存过时返回 null", async () => {
    await expect(loadRememberedCredential(NOW)).resolves.toBeNull()
  })

  it("缺密码的凭据视为无效（只有邮箱不算记住）", async () => {
    store.set("credential", {
      password: JSON.stringify({ email: "writer@example.com", password: "" }),
      savedAt: Math.floor(NOW / 1000),
    })

    await expect(loadRememberedCredential(NOW)).resolves.toBeNull()
  })

  it("取消勾选可以清除凭据", async () => {
    await saveRememberedCredential(CRED, NOW)
    await clearRememberedPassword()

    expect(store.has("credential")).toBe(false)
    await expect(loadRememberedCredential(NOW)).resolves.toBeNull()
  })

  it("剩余天数按天向上取整，过期后为 0", () => {
    expect(remainingDays(NOW, NOW)).toBe(30)
    expect(remainingDays(NOW, NOW + 29 * DAY)).toBe(1)
    expect(remainingDays(NOW, NOW + 30 * DAY)).toBe(0)
  })
})
