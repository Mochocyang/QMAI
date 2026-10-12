import { describe, expect, it } from "vitest"
import { consumeUserMemoryLearningBudget, dayKey, loadUserMemoryLearningBudget } from "./learning-budget"

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe("user memory learning budget", () => {
  it("达到每日调用上限后拒绝继续学习", () => {
    const storage = new MemoryStorage()
    const now = new Date("2026-07-18T08:00:00+08:00").getTime()

    expect(consumeUserMemoryLearningBudget(storage, 2, 100, now)).toBe(true)
    expect(consumeUserMemoryLearningBudget(storage, 2, 120, now)).toBe(true)
    expect(consumeUserMemoryLearningBudget(storage, 2, 80, now)).toBe(false)
    expect(loadUserMemoryLearningBudget(storage, now)).toMatchObject({ calls: 2, inputChars: 220 })
  })

  it("跨自然日自动重置", () => {
    const storage = new MemoryStorage()
    const firstDay = new Date("2026-07-18T08:00:00+08:00").getTime()
    const nextDay = new Date("2026-07-19T08:00:00+08:00").getTime()

    expect(consumeUserMemoryLearningBudget(storage, 1, 100, firstDay)).toBe(true)
    expect(consumeUserMemoryLearningBudget(storage, 1, 100, firstDay)).toBe(false)
    expect(consumeUserMemoryLearningBudget(storage, 1, 50, nextDay)).toBe(true)
    expect(loadUserMemoryLearningBudget(storage, nextDay)).toMatchObject({ calls: 1, inputChars: 50 })
  })
})

/*
 * `dayKey` 必须导出。
 *
 * 原先它是模块私有的，只有这个文件自己用。但「文风自进化」的节律也要按
 * **打开日**计数，而它一旦自己重写一份日期算法，两份口径迟早会漂移 ——
 * 最典型的就是一份用本地日期、另一份用 `toISOString()`（UTC），
 * 于是东八区用户在清晨打开时，两个功能会算成不同的两天。
 * 所以这里把它导出并测住「本地日期」这个口径，供两边共用。
 */
describe("dayKey：日期口径", () => {
  const pad = (n: number) => String(n).padStart(2, "0")

  it("用**本地**日期，不是 UTC（东八区清晨不能算成前一天）", () => {
    // 刻意用本地时间构造，期望值因此在任何时区都成立。
    const morning = new Date(2026, 9, 11, 7, 30).getTime()
    const expected = `2026-10-11`
    expect(dayKey(morning)).toBe(expected)

    /*
     * 反向断言：若实现改成 `new Date(now).toISOString().slice(0, 10)`，
     * 在东八区这一刻会得到前一天。用 `!==` 前置条件让它只在两者真的不同时才断言，
     * 这样在 UTC 时区跑也不会假红。
     */
    const utc = new Date(morning).toISOString().slice(0, 10)
    if (utc !== expected) {
      expect(dayKey(morning)).not.toBe(utc)
    }
  })

  it("格式是 YYYY-MM-DD，月与日补零", () => {
    const january = new Date(2026, 0, 5, 12, 0).getTime()
    expect(dayKey(january)).toBe("2026-01-05")
    expect(dayKey(january)).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const local = new Date(january)
    expect(dayKey(january)).toBe(
      `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
    )
  })

  it("同一天的任意时刻给出同一个值，跨天才变", () => {
    const early = new Date(2026, 9, 11, 0, 1).getTime()
    const late = new Date(2026, 9, 11, 23, 59).getTime()
    const nextDay = new Date(2026, 9, 12, 0, 1).getTime()

    expect(dayKey(early)).toBe(dayKey(late))
    expect(dayKey(nextDay)).not.toBe(dayKey(early))
  })
})
