import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  REMEMBERED_PASSWORD_TTL_MS,
  clearRememberedPassword,
  loadRememberedPassword,
  remainingDays,
  saveRememberedPassword,
} from "./remembered-credential"

/**
 * 「记住密码」的 30 天有效期。
 *
 * 这不是装饰性规则，而是这个功能的边界：
 * 用户勾的是「记住密码」，不是「永久托管密码」。
 * 超过 30 天必须失效，否则磁盘上就会长期躺着一份能直接登录的凭据。
 *
 * 时间基准：从**登录成功的那一刻**算起，不做「每次自动登录就续期」——
 * 那等于只要经常打开软件就永不过期，30 天形同虚设。
 */

/** 后端凭据存储的内存替身，模拟 DPAPI 那层的行为。 */
const store = new Map<string, { password: string; savedAt: number }>()

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/platform", () => ({ isTauri: vi.fn(() => true) }))

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date("2026-11-02T12:00:00Z").getTime()

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

describe("记住密码的有效期", () => {
  it("保存时把时间戳一起交给后端", async () => {
    const ok = await saveRememberedPassword("pass1234", NOW)

    expect(ok).toBe(true)
    expect(store.get("credential")?.savedAt).toBe(Math.floor(NOW / 1000))
  })

  it("30 天内可以取回密码", async () => {
    await saveRememberedPassword("pass1234", NOW)

    // 第 29 天：仍应免输。
    await expect(loadRememberedPassword(NOW + 29 * DAY)).resolves.toBe("pass1234")
  })

  it("刚好满 30 天仍有效，超过 30 天失效", async () => {
    await saveRememberedPassword("pass1234", NOW)

    await expect(loadRememberedPassword(NOW + REMEMBERED_PASSWORD_TTL_MS)).resolves.toBe("pass1234")
    await expect(loadRememberedPassword(NOW + REMEMBERED_PASSWORD_TTL_MS + 1000)).resolves.toBe("")
  })

  it("过期后顺手删除凭据，不在磁盘上留失效密文", async () => {
    await saveRememberedPassword("pass1234", NOW)

    await loadRememberedPassword(NOW + REMEMBERED_PASSWORD_TTL_MS + 1000)
    // 清理是 fire-and-forget 的（不阻塞读取）：用真实计时器等它跑完。
    await vi.waitFor(() => expect(store.has("credential")).toBe(false))

    expect(store.has("credential")).toBe(false)
  })

  it("不做续期：中途多次读取不会延长有效期", async () => {
    await saveRememberedPassword("pass1234", NOW)

    // 第 10、20、29 天各读一次。
    await loadRememberedPassword(NOW + 10 * DAY)
    await loadRememberedPassword(NOW + 20 * DAY)
    await loadRememberedPassword(NOW + 29 * DAY)

    // 从保存时刻算满 30 天后仍然失效 —— 读取次数不影响期限。
    await expect(loadRememberedPassword(NOW + 30 * DAY + 1000)).resolves.toBe("")
  })

  it("旧格式（没有时间戳）按已过期处理", async () => {
    store.set("credential", { password: "old", savedAt: 0 })

    await expect(loadRememberedPassword(NOW)).resolves.toBe("")
  })

  it("系统时间被回拨时不认这个凭据", async () => {
    await saveRememberedPassword("pass1234", NOW)

    // 比保存时刻还早：说明时间被改动过，不能据此放行。
    await expect(loadRememberedPassword(NOW - DAY)).resolves.toBe("")
  })

  it("从未保存过时返回空串", async () => {
    await expect(loadRememberedPassword(NOW)).resolves.toBe("")
  })

  it("取消勾选可以清除凭据", async () => {
    await saveRememberedPassword("pass1234", NOW)
    await clearRememberedPassword()

    expect(store.has("credential")).toBe(false)
    await expect(loadRememberedPassword(NOW)).resolves.toBe("")
  })

  it("剩余天数按天向上取整，过期后为 0", () => {
    expect(remainingDays(NOW, NOW)).toBe(30)
    expect(remainingDays(NOW, NOW + 29 * DAY)).toBe(1)
    expect(remainingDays(NOW, NOW + 30 * DAY)).toBe(0)
  })
})
