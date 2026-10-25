import { describe, expect, it } from "vitest"

import { evaluateRateLimit } from "../src/rate-limit"

describe("evaluateRateLimit", () => {
  it("starts a fresh window for an unseen bucket", () => {
    const decision = evaluateRateLimit(null, 5, 3600, 1000)
    expect(decision).toEqual({
      allowed: true,
      state: { windowStart: 1000, count: 1 },
      retryAfterSeconds: 0,
    })
  })

  it("increments inside the current window", () => {
    const decision = evaluateRateLimit({ windowStart: 1000, count: 4 }, 5, 3600, 1500)
    expect(decision.allowed).toBe(true)
    expect(decision.state).toEqual({ windowStart: 1000, count: 5 })
    expect(decision.retryAfterSeconds).toBe(0)
  })

  it("denies at the limit without inflating the count", () => {
    const decision = evaluateRateLimit({ windowStart: 1000, count: 5 }, 5, 3600, 1500)
    expect(decision.allowed).toBe(false)
    expect(decision.state).toEqual({ windowStart: 1000, count: 5 })
    expect(decision.retryAfterSeconds).toBe(3100)
  })

  it("resets after the window elapses", () => {
    const decision = evaluateRateLimit({ windowStart: 1000, count: 5 }, 5, 3600, 4600)
    expect(decision.allowed).toBe(true)
    expect(decision.state).toEqual({ windowStart: 4600, count: 1 })
  })

  it("resets when the stored window is in the future", () => {
    const decision = evaluateRateLimit({ windowStart: 5000, count: 5 }, 5, 3600, 4000)
    expect(decision.allowed).toBe(true)
    expect(decision.state).toEqual({ windowStart: 4000, count: 1 })
  })

  it("never reports a retry-after below one second", () => {
    const decision = evaluateRateLimit({ windowStart: 1000, count: 1 }, 1, 1, 1000)
    expect(decision.allowed).toBe(false)
    expect(decision.retryAfterSeconds).toBe(1)
  })

  it("supports the 60-second send cooldown and hourly limits", () => {
    expect(evaluateRateLimit({ windowStart: 10_000, count: 1 }, 1, 60, 10_030).allowed).toBe(false)
    expect(evaluateRateLimit({ windowStart: 10_000, count: 1 }, 1, 60, 10_060).allowed).toBe(true)
    expect(evaluateRateLimit({ windowStart: 10_000, count: 5 }, 5, 3600, 10_001).allowed).toBe(false)
  })
})
