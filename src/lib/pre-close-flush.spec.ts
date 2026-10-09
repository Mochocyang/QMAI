// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  registerPreCloseFlush,
  runPreCloseFlushes,
  preCloseFlushCount,
  __resetPreCloseFlushesForTest,
} from "@/lib/pre-close-flush"
import { createDebouncedPersist } from "@/lib/debounced-persist"

const REPO = resolve(__dirname, "../..")
const read = (p: string) => readFileSync(resolve(REPO, p), "utf8").replace(/\r\n/g, "\n")

beforeEach(() => { __resetPreCloseFlushesForTest() })

describe("pre-close-flush 注册表", () => {
  it("执行全部已注册动作，且每个都真的 await 完", async () => {
    const order: string[] = []
    registerPreCloseFlush(async () => { await new Promise((r) => setTimeout(r, 20)); order.push("a") })
    registerPreCloseFlush(async () => { order.push("b") })
    const res = await runPreCloseFlushes()
    // 关键：runPreCloseFlushes resolve 之后，动作必须**已经跑完**。
    // 若这里不 await，destroy() 会把写盘切断，缺陷原样保留。
    expect(order).toEqual(["a", "b"])
    expect(res).toEqual({ ran: 2, failed: 0 })
  })

  it("一个失败不阻断其它（否则一个模块写盘失败会连带丢掉另一个模块的设置）", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const done: string[] = []
    registerPreCloseFlush(() => { throw new Error("写盘失败") })
    registerPreCloseFlush(async () => { done.push("second") })
    const res = await runPreCloseFlushes()
    expect(done).toEqual(["second"])
    expect(res).toEqual({ ran: 1, failed: 1 })
    spy.mockRestore()
  })

  it("注销后不再执行（组件卸载必须注销，否则残留闭包）", async () => {
    const fn = vi.fn()
    const unregister = registerPreCloseFlush(fn)
    expect(preCloseFlushCount()).toBe(1)
    unregister()
    expect(preCloseFlushCount()).toBe(0)
    await runPreCloseFlushes()
    expect(fn).not.toHaveBeenCalled()
  })

  it("空注册表不报错（没有写作现场时也要能正常关窗）", async () => {
    await expect(runPreCloseFlushes()).resolves.toEqual({ ran: 0, failed: 0 })
  })
})

describe("flushAsync 与 flush 的差别（这个差别正是缺陷的根）", () => {
  it("flushAsync 等到写盘结束；flush 只启动、不等待", async () => {
    let writeFinished = false
    const slow = () => new Promise<void>((r) => setTimeout(() => { writeFinished = true; r() }, 30))

    const p1 = createDebouncedPersist(10_000)
    p1.schedule(slow)
    await p1.flushAsync()
    expect(writeFinished, "flushAsync 必须等到写盘结束").toBe(true)

    // 反向对照：flush() 不等 —— 这正是为什么关窗流程不能用它。
    writeFinished = false
    const p2 = createDebouncedPersist(10_000)
    p2.schedule(slow)
    p2.flush()
    expect(writeFinished, "flush() 是 void task()，返回时写盘尚未完成").toBe(false)
    await new Promise((r) => setTimeout(r, 60))
    expect(writeFinished).toBe(true)
  })

  it("flushAsync 会取消定时器，不会让同一次改动写两遍", async () => {
    const fn = vi.fn(async () => {})
    const p = createDebouncedPersist(40)
    p.schedule(fn)
    await p.flushAsync()
    await new Promise((r) => setTimeout(r, 90))
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe("接线：必须真的接上，否则注册表再对也没用", () => {
  it("preview-panel 注册了关窗前落盘，且用的是 flushAsync 而不是 flush", () => {
    const src = read("src/components/layout/preview-panel.tsx")
    expect(src, "preview-panel 未注册关窗前落盘 —— 关窗口仍会丢最后一次改动")
      .toContain("registerPreCloseFlush(")
    expect(src, "关窗前落盘必须用 flushAsync（flush 只启动不等待，destroy 会切断写盘）")
      .toContain("persist.flushAsync()")
    // 反向：不许回退成只启动不等待的那个
    expect(src, "关窗前落盘不能用 flush()（不等待，等于白做）").not.toMatch(/registerPreCloseFlush\(\(\)\s*=>\s*persist\.flush\(\)\)/)
  })

  it("preview-panel 卸载时注销注册（否则残留已卸载组件的闭包）", () => {
    const src = read("src/components/layout/preview-panel.tsx")
    expect(src, "注册了却没注销：卸载后旧闭包会留在表里").toContain("unregister()")
  })

  it("App 的关闭流程在 destroy 之前 await 执行了这些落盘", () => {
    const src = read("src/App.tsx")
    const flushIdx = src.indexOf("await runPreCloseFlushes()")
    const destroyIdx = src.indexOf("getCurrentWindow().destroy()")
    expect(flushIdx, "App 未调用 runPreCloseFlushes（排版设置会在关窗时丢）").toBeGreaterThan(-1)
    expect(destroyIdx).toBeGreaterThan(-1)
    expect(flushIdx, "runPreCloseFlushes 必须在 destroy 之前，否则窗口已经销毁").toBeLessThan(destroyIdx)
    expect(src, "runPreCloseFlushes 必须 await，否则 destroy 切掉未完成的写盘").toMatch(/await runPreCloseFlushes\(\)/)
  })

  it("注释不许再声称「关窗口那条路径已被卸载 flush 覆盖」（那正是旧注释的错误）", () => {
    const src = read("src/components/layout/preview-panel.tsx")
    // 实测确认：destroy() 销毁 webview，React 不走 unmount。
    // 旧注释把①这条路径说成已被覆盖，属于"说谎注释"，必须改成说明注册表。
    expect(src, "注释仍把「关窗口」说成由卸载 flush 覆盖").not.toMatch(/拖完滑块 400ms 内直接关窗口 \/ Alt\+F4（走 Tauri 的关闭，没有 mousedown）\s*\n\s*\*?\s*②/)
    expect(src).toContain("React 不走 unmount")
  })
})
