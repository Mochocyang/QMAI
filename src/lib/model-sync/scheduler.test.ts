import { describe, expect, it } from "vitest"

import {
  EDIT_QUIET_MS,
  PULL_MIN_INTERVAL_MS,
  PUSH_COOLDOWN_MS,
  PUSH_DEBOUNCE_MS,
  pushDelay,
  retryDelay,
  shouldPull,
} from "./scheduler"

describe("shouldPull", () => {
  it("从未拉过 → 拉", () => {
    expect(shouldPull(null, 1_000)).toBe(true)
  })

  it("距上次不足 15 分钟 → 不拉（省请求）", () => {
    const now = 10_000_000
    expect(shouldPull(now - 60_000, now)).toBe(false)
    expect(shouldPull(now - (PULL_MIN_INTERVAL_MS - 1), now)).toBe(false)
  })

  it("距上次超过 15 分钟 → 拉", () => {
    const now = 10_000_000
    expect(shouldPull(now - PULL_MIN_INTERVAL_MS, now)).toBe(true)
  })
})

describe("pushDelay", () => {
  const now = 1_000_000

  it("没有待推改动 → null", () => {
    expect(pushDelay({ dirtyAt: null, now })).toBeNull()
    expect(pushDelay({ dirtyAt: undefined, now })).toBeNull()
  })

  it("刚改动：要等满 3 秒防抖", () => {
    expect(pushDelay({ dirtyAt: now, now })).toBe(PUSH_DEBOUNCE_MS)
    expect(pushDelay({ dirtyAt: now - PUSH_DEBOUNCE_MS, now })).toBe(0)
  })

  it("用户还在连续编辑：要等停止 30 秒", () => {
    expect(pushDelay({ dirtyAt: now - 5_000, lastEditAt: now, now })).toBe(EDIT_QUIET_MS)
  })

  it("刚推送过：受 60 秒冷却约束", () => {
    const lastPushAt = now - 10_000
    expect(pushDelay({ dirtyAt: now - 10_000, lastPushAt, now })).toBe(PUSH_COOLDOWN_MS - 10_000)
  })

  it("三个约束同时存在时取最晚的那个", () => {
    const lastPushAt = now - 55_000 // 还要再等 5 秒
    const lastEditAt = now - 20_000 // 还要再等 10 秒
    expect(pushDelay({ dirtyAt: now - 40_000, lastPushAt, lastEditAt, now })).toBe(10_000)
  })
})

describe("retryDelay", () => {
  it("按 30s → 2min → 10min 退避，超过 3 次返回 null", () => {
    expect(retryDelay(0)).toBe(30_000)
    expect(retryDelay(1)).toBe(120_000)
    expect(retryDelay(2)).toBe(600_000)
    expect(retryDelay(3)).toBeNull()
  })
})
