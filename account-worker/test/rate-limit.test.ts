import { describe, expect, it } from "vitest"

import { evaluateRateLimit, peekRateLimitDecision } from "../src/rate-limit"

describe("evaluateRateLimit（count 已含本次）", () => {
  it("starts a fresh window for an unseen bucket", () => {
    const decision = evaluateRateLimit(null, 5, 3600, 1000)
    expect(decision).toEqual({
      allowed: true,
      state: { windowStart: 1000, count: 1 },
      retryAfterSeconds: 0,
    })
  })

  it("increments inside the current window and allows exactly at the limit", () => {
    const decision = evaluateRateLimit({ windowStart: 1000, count: 4 }, 5, 3600, 1500)
    expect(decision.allowed).toBe(true)
    expect(decision.state).toEqual({ windowStart: 1000, count: 5 })
    expect(decision.retryAfterSeconds).toBe(0)
  })

  it("denies over the limit and records the denied attempt in count", () => {
    const decision = evaluateRateLimit({ windowStart: 1000, count: 5 }, 5, 3600, 1500)
    expect(decision.allowed).toBe(false)
    expect(decision.state).toEqual({ windowStart: 1000, count: 6 })
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

describe("peekRateLimitDecision（只读，不消费）", () => {
  it("allows an unseen or expired bucket", () => {
    expect(peekRateLimitDecision(null, 10, 900, 1000)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    })
    expect(peekRateLimitDecision({ windowStart: 1000, count: 10 }, 10, 900, 1900)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    })
  })

  it("allows while count is below the limit", () => {
    expect(peekRateLimitDecision({ windowStart: 1000, count: 9 }, 10, 900, 1200)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    })
  })

  it("blocks at the limit with the remaining window as retry-after", () => {
    expect(peekRateLimitDecision({ windowStart: 1000, count: 10 }, 10, 900, 1200)).toEqual({
      allowed: false,
      retryAfterSeconds: 700,
    })
  })

  it("never reports a retry-after below one second", () => {
    expect(peekRateLimitDecision({ windowStart: 1000, count: 10 }, 10, 900, 1899)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    })
  })
})
