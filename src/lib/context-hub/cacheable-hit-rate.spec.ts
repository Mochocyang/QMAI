import { describe, expect, it } from "vitest"
import { cacheableHitRate } from "./cacheable-hit-rate"

function counters(overrides: Partial<Parameters<typeof cacheableHitRate>[0]> = {}) {
  return {
    cacheHits: 0,
    reloaded: 0,
    empty: 0,
    fallbackUsed: 0,
    readFailed: 0,
    writeFailed: 0,
    ...overrides,
  }
}

describe("cacheableHitRate", () => {
  it("excludes task-scoped hits from the cacheable rate", () => {
    // 可缓存 2 hit + 2 reload，任务级 2 hit → 真实可缓存命中率 50%，旧公式会算出 100%。
    expect(cacheableHitRate(counters({
      cacheHits: 4,
      reloaded: 2,
      taskScopedLoaded: 2,
      taskScopedHits: 2,
    }))).toBe(50)
  })

  it("does not exceed 100% when only task-scoped sources hit", () => {
    // 任务级全命中、可缓存几乎全 miss：旧公式 cacheHits / cacheableTotal = 3/1 = 300%。
    expect(cacheableHitRate(counters({
      cacheHits: 3,
      reloaded: 1,
      taskScopedLoaded: 3,
      taskScopedHits: 3,
    }))).toBe(0)
  })

  it("treats missing task-scoped fields as 0 for old snapshots", () => {
    expect(cacheableHitRate(counters({ cacheHits: 2, reloaded: 2 }))).toBe(50)
  })

  it("returns 0 when there is no cacheable total", () => {
    expect(cacheableHitRate(counters({
      cacheHits: 2,
      taskScopedLoaded: 2,
      taskScopedHits: 2,
    }))).toBe(0)
  })
})
