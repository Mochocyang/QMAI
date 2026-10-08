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

  it("去抖窗口被后续 schedule 重置 —— 这是 debounce 的定义本身", async () => {
    // 为什么单独立一条：上面那条用例的三次 schedule 全在 t=0，
    // 所以它证明不了"窗口会重置"。若 schedule 忘了 clearTimeout，
    // 旧定时器会在第一次 schedule 之后 400ms 就落盘 ——
    // 那条用例照样绿，而模块已经坏掉。这一条专门钉住那件事。
    const calls: string[] = []
    const d = createDebouncedPersist(400)
    d.schedule(async () => { calls.push("early") })
    await vi.advanceTimersByTimeAsync(300)      // t=300，旧定时器还剩 100ms
    d.schedule(async () => { calls.push("late") })  // 应当把窗口重置到 t=700
    await vi.advanceTimersByTimeAsync(399)      // t=699，仍未到期
    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(1)        // t=700，到期
    expect(calls).toEqual(["late"])
  })

  it("模拟一次真实拖动：每 100ms 一格、拖 1 秒，只落盘 1 次", async () => {
    // 这条把用户可见的诉求直接写成断言。上面的正确实现落盘 1 次（[900]）；
    // schedule 忘了 clearTimeout 的实现会落盘 7 次
    // （[300,400,500,600,700,800,900]）—— 就是"一次拖动写几十遍"。
    const calls: number[] = []
    const d = createDebouncedPersist(400)
    for (let t = 0; t < 1000; t += 100) {
      d.schedule(async () => { calls.push(t) })
      await vi.advanceTimersByTimeAsync(100)
    }
    await vi.advanceTimersByTimeAsync(400)
    expect(calls).toEqual([900])
  })

  it("定时器已自动落盘后再 flush，不会重复落盘", async () => {
    // runPending 之后若不清 pending，后面的 flush 会把同一次动作再跑一遍
    // —— 表现为"点了关闭又多写一次"，且两次内容相同、很难发现。
    const calls: string[] = []
    const d = createDebouncedPersist(400)
    d.schedule(async () => { calls.push("a") })
    await vi.advanceTimersByTimeAsync(400)
    expect(calls).toEqual(["a"])
    d.flush()
    expect(calls).toEqual(["a"])
  })

  it("dispose 之后 flush 不能把已丢弃的内容跑起来", async () => {
    // dispose 的契约是"丢弃待落盘动作，不再触发"。
    // 若 dispose 只清定时器不清 pending，随后一次 flush 就能把它复活 ——
    // 组件已卸载却仍在写盘。
    const calls: string[] = []
    const d = createDebouncedPersist(400)
    d.schedule(async () => { calls.push("a") })
    d.dispose()
    d.flush()
    expect(calls).toEqual([])
  })

  it("flush 与 dispose 都不留悬挂的定时器", () => {
    // 残留定时器在常规断言下看不出差异（到点时 pending 已是 null），
    // 但它是真实的资源泄漏：闭包与回调被多留 400ms 才释放。
    // 用 getTimerCount 把"不留悬挂任务"变成可断言的不变量。
    const a = createDebouncedPersist(400)
    a.schedule(async () => {})
    expect(vi.getTimerCount()).toBe(1)
    a.flush()
    expect(vi.getTimerCount()).toBe(0)

    const b = createDebouncedPersist(400)
    b.schedule(async () => {})
    b.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
