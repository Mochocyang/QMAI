import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  LEGAL_PRIVACY_URL,
  LEGAL_TERMS_URL,
  LEGAL_TERMS_VERSION,
  clearLegalConsent,
  hasAcceptedLegalTerms,
  readLegalConsent,
  recordLegalConsent,
} from "./legal-consent"

/**
 * 「同意服务条款」的留痕规则。
 *
 * 这组用例锁住三件事，任何一条坏掉都会让合规留痕失效：
 * 1. 没同意过 = 没同意过（不能因为读不到就当默认同意）；
 * 2. 同意绑定版本号，条款改版后旧同意不能自动续期；
 * 3. 存储层坏掉时不能抛错拖垮登录。
 */

const STORAGE_KEY = "qmai.legalConsent"

function installStorage() {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  })
  return store
}

beforeEach(() => {
  installStorage()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("法律条款同意记录", () => {
  it("初始状态为未同意", () => {
    expect(hasAcceptedLegalTerms()).toBe(false)
    expect(readLegalConsent()).toBeNull()
  })

  it("记录同意后可以读到，并带上版本与时间", () => {
    recordLegalConsent(1_700_000_000_000)

    const record = readLegalConsent()
    expect(record).not.toBeNull()
    expect(record?.version).toBe(LEGAL_TERMS_VERSION)
    expect(record?.acceptedAt).toBe(1_700_000_000_000)
    expect(hasAcceptedLegalTerms()).toBe(true)
  })

  it("条款改版后，旧版本的同意不算数", () => {
    // 模拟用户同意的是旧版条款。
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: "v0.9", acceptedAt: 1_700_000_000_000 }),
    )

    expect(readLegalConsent()).toBeNull()
    expect(hasAcceptedLegalTerms()).toBe(false)
  })

  it("存档损坏时视为未同意，不抛错", () => {
    localStorage.setItem(STORAGE_KEY, "{ not json")

    expect(() => readLegalConsent()).not.toThrow()
    expect(hasAcceptedLegalTerms()).toBe(false)
  })

  it("缺少字段的记录同样视为未同意", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: LEGAL_TERMS_VERSION }))
    expect(hasAcceptedLegalTerms()).toBe(false)

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ acceptedAt: 123 }))
    expect(hasAcceptedLegalTerms()).toBe(false)
  })

  it("清除后回到未同意", () => {
    recordLegalConsent()
    expect(hasAcceptedLegalTerms()).toBe(true)

    clearLegalConsent()
    expect(hasAcceptedLegalTerms()).toBe(false)
  })

  it("写存储抛错时静默失败，不阻断调用方", () => {
    // 换成会抛错的 storage：模拟隐私模式 / 配额已满。
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError")
        },
        removeItem: () => undefined,
      },
    })

    expect(() => recordLegalConsent()).not.toThrow()
    // 写失败也不能让读取逻辑崩掉。
    expect(() => hasAcceptedLegalTerms()).not.toThrow()
    expect(hasAcceptedLegalTerms()).toBe(false)
  })
})

describe("条款在线地址", () => {
  it("两个链接都指向已上线的 Pages 站点，且带正确的锚点", () => {
    /*
     * 回归：曾经把链接写成 https://qmai.pro/legal，而该路径在营销站上并不存在，
     * 会落到首页的 SPA 回退 —— 用户点「同意」看到的是产品介绍而不是条款，
     * 等于没有给出可读入口。链接必须是确定存在的那一个。
     */
    expect(LEGAL_TERMS_URL).toBe("https://qmai.pro/legal#terms")
    expect(LEGAL_PRIVACY_URL).toBe("https://qmai.pro/legal#privacy")
    expect(LEGAL_TERMS_URL).toMatch(/^https:\/\/qmai\.pro\//)
    expect(LEGAL_PRIVACY_URL).toMatch(/^https:\/\/qmai\.pro\//)
  })
})