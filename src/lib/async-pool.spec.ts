import { describe, expect, it, vi } from "vitest"
import { mapWithConcurrency } from "./async-pool"

describe("mapWithConcurrency", () => {
  it("preserves result order", async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => value * 2)
    expect(results).toEqual([2, 4, 6, 8])
  })

  it("limits active workers", async () => {
    let active = 0
    let maxActive = 0

    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
      return value
    })

    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it("stops scheduling when signal is aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const fn = vi.fn(async (value: number) => value)

    await mapWithConcurrency([1, 2, 3], 2, fn, { signal: controller.signal })

    expect(fn).not.toHaveBeenCalled()
  })
})
