import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createDebouncedPersist } from "@/lib/debounced-persist"

describe("createDebouncedPersist", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("连续多次 schedule 只落盘一次，且执行的是最后一次", async () => {
    const calls: string[] = []
    const d = createDebouncedPersist(400)
    d.schedule(async () => { calls.push("a") })
    d.schedule(async () => { calls.push("b") })
    d.schedule(async () => { calls.push("c") })
    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(399)
    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toEqual(["c"])
  })

  it("未到期时 flush 立即落盘一次，且不会重复落盘", async () => {
    const calls: string[] = []
    const d = createDebouncedPersist(400)
    d.schedule(async () => { calls.push("a") })
    d.flush()
    expect(calls).toEqual(["a"])
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toEqual(["a"])
  })

  it("没有待落盘内容时 flush 什么也不做", async () => {
    const calls: string[] = []
    const d = createDebouncedPersist(400)
    d.flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toEqual([])
  })

  it("dispose 丢弃待落盘内容，不再触发", async () => {
    const calls: string[] = []
    const d = createDebouncedPersist(400)
    d.schedule(async () => { calls.push("a") })
    d.dispose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toEqual([])
  })

  it("落盘后再次 schedule 能正常触发（定时器被正确清空）", async () => {
    const calls: string[] = []
    const d = createDebouncedPersist(400)
    d.schedule(async () => { calls.push("a") })
    await vi.advanceTimersByTimeAsync(400)
    d.schedule(async () => { calls.push("b") })
    await vi.advanceTimersByTimeAsync(400)
    expect(calls).toEqual(["a", "b"])
  })
})
