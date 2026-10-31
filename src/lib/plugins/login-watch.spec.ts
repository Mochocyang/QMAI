/**
 * 登录完成观察器的测试。
 *
 * 守的是这个真实死角：账号类插件的登录在受控窗口**内部**完成，
 * 用户看到"登录成功"就不管那个窗口了，而宿主的模型刷新挂在窗口关闭事件上 ——
 * 于是登录成功了、模型列表却一直空着。
 *
 * 这一层改成看**插件状态**：ready 且有模型 = 登录成了，立刻刷新。
 */
import { describe, expect, it, vi } from "vitest"

import { LOGIN_WATCH_INTERVAL_MS, LOGIN_WATCH_TIMEOUT_MS, watchProviderLogin } from "./login-watch"
import type { PluginProviderView } from "./types"

function view(overrides: Partial<PluginProviderView> = {}): PluginProviderView {
  return {
    pluginId: "workbuddy-account",
    providerId: "workbuddy",
    name: "WorkBuddy 国内版",
    baseUrl: "http://127.0.0.1:1234",
    authKind: "browser-login",
    capabilities: [],
    models: [],
    ready: false,
    ...overrides,
  }
}

const model = (id: string) => ({
  id,
  name: id,
  maxInputTokens: 128000,
  maxOutputTokens: 8192,
})

/**
 * 一个可控的调度器：测试点一次就前进一拍，不用等真实时间。
 * 用真实 setTimeout 会让这些用例变成几秒级，而它们逻辑上是瞬间的。
 */
function makeScheduler() {
  const queue: Array<() => void> = []
  return {
    schedule: (fn: () => void) => {
      queue.push(fn)
      return queue.length
    },
    cancel: () => {},
    /** 跑完当前这一拍（含它内部 await 的微任务）。 */
    async tick() {
      const fn = queue.shift()
      if (!fn) return false
      fn()
      // 让 tick 内部的 await 走完
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      return true
    },
    get pending() {
      return queue.length
    },
  }
}

describe("watchProviderLogin", () => {
  it("provider 就绪且有模型时，刷新模型并回调", async () => {
    const scheduler = makeScheduler()
    const refresh = vi.fn().mockResolvedValue([])
    const sync = vi.fn().mockResolvedValue({ added: [], removed: [] })
    const onReady = vi.fn()

    watchProviderLogin({
      providerId: "workbuddy",
      onReady,
      listProviders: async () => [view({ ready: true, models: [model("m1")] })],
      refresh,
      sync,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    })

    await scheduler.tick()

    expect(refresh).toHaveBeenCalledWith("workbuddy")
    expect(sync).toHaveBeenCalled()
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it("只有就绪但没有模型时继续等（起来≠登录成功）", async () => {
    const scheduler = makeScheduler()
    const refresh = vi.fn()
    const onReady = vi.fn()

    watchProviderLogin({
      providerId: "workbuddy",
      onReady,
      listProviders: async () => [view({ ready: true, models: [] })],
      refresh,
      sync: async () => undefined,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    })

    await scheduler.tick()
    expect(onReady).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    // 还会再排下一拍
    expect(scheduler.pending).toBe(1)
  })

  it("没就绪时继续等，直到就绪才结束", async () => {
    const scheduler = makeScheduler()
    let ready = false
    const onReady = vi.fn()

    watchProviderLogin({
      providerId: "workbuddy",
      onReady,
      listProviders: async () => [view({ ready, models: ready ? [model("m1")] : [] })],
      refresh: async () => [],
      sync: async () => undefined,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    })

    await scheduler.tick()
    expect(onReady).not.toHaveBeenCalled()

    ready = true
    await scheduler.tick()
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it("没找到该 provider 时继续等，不报错", async () => {
    const scheduler = makeScheduler()
    const onReady = vi.fn()

    watchProviderLogin({
      providerId: "workbuddy",
      onReady,
      listProviders: async () => [],
      refresh: async () => [],
      sync: async () => undefined,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    })

    await scheduler.tick()
    expect(onReady).not.toHaveBeenCalled()
    expect(scheduler.pending).toBe(1)
  })

  it("刷新失败不影响「登录成功」的认定", async () => {
    const scheduler = makeScheduler()
    const onReady = vi.fn()

    watchProviderLogin({
      providerId: "workbuddy",
      onReady,
      listProviders: async () => [view({ ready: true, models: [model("m1")] })],
      refresh: async () => {
        throw new Error("刷新炸了")
      },
      sync: async () => undefined,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    })

    await scheduler.tick()
    // 登录确实成功了，不该因为刷新失败就不告诉用户
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it("超时后回调 onTimeout 并停止", async () => {
    const scheduler = makeScheduler()
    const onTimeout = vi.fn()
    // 固定时钟：watch 在构造时读一次（算 deadline），之后每拍读一次。
    // 用固定值让它一定超过 timeoutMs，而不是去模拟真实时间流逝。
    let clock = 0
    const timeoutMs = 100

    watchProviderLogin({
      providerId: "workbuddy",
      onTimeout,
      timeoutMs,
      listProviders: async () => [view({ ready: false })],
      refresh: async () => [],
      sync: async () => undefined,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      // 第一次（构造）返回 0，之后返回已超时的值
      now: () => (clock === 0 ? ((clock = 1), 0) : timeoutMs + 1000),
    })

    await scheduler.tick()
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(scheduler.pending).toBe(0)
  })

  it("stop() 之后不再轮询，且可重复调用", async () => {
    const scheduler = makeScheduler()
    const listProviders = vi.fn().mockResolvedValue([])

    const stop = watchProviderLogin({
      providerId: "workbuddy",
      listProviders,
      refresh: async () => [],
      sync: async () => undefined,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    })

    stop()
    stop()
    await scheduler.tick()
    expect(listProviders).not.toHaveBeenCalled()
  })

  it("成功后不再排下一拍（不常驻轮询）", async () => {
    const scheduler = makeScheduler()

    watchProviderLogin({
      providerId: "workbuddy",
      listProviders: async () => [view({ ready: true, models: [model("m1")] })],
      refresh: async () => [],
      sync: async () => undefined,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    })

    await scheduler.tick()
    expect(scheduler.pending).toBe(0)
  })
})

describe("常量", () => {
  it("间隔 3 秒、超时 5 分钟（与插件侧登录超时一致）", () => {
    expect(LOGIN_WATCH_INTERVAL_MS).toBe(3000)
    expect(LOGIN_WATCH_TIMEOUT_MS).toBe(5 * 60 * 1000)
  })
})
