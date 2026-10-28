/**
 * 登录窗口事件的订阅层测试（`provider-events.ts`）。
 *
 * 守两件事：
 *   1. 事件真的被接到了 —— 这条链路是「后端悄悄刷新 + 前端被动跟随」，
 *      订阅一旦失灵，界面就永远停在关窗前的快照，而且没有任何报错。
 *   2. `unlisten` 真的会生效 —— 不生效的话热更新 / 严格模式会让一次登录触发多次同步。
 *
 * 最后一组是 App.tsx 的**接线源码断言**（与本仓 `project-sync.wiring.spec.ts`、
 * `analytics-wiring.test.ts` 同一类守卫）：模块写得再对，只要启动处没人调用它，
 * 功能就等于不存在，而单测不会红。
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MockInstance } from "vitest"

type EventHandler = (event: { payload: unknown }) => void

/** Tauri 事件打桩：记住 handler，测试可以手动「发事件」，unlisten 会真的摘掉它。 */
const tauriEvent = vi.hoisted(() => {
  const handlers = new Map<string, EventHandler[]>()
  const listenCalls: string[] = []
  const listen = vi.fn(async (name: string, handler: EventHandler) => {
    listenCalls.push(name)
    const current = handlers.get(name) ?? []
    current.push(handler)
    handlers.set(name, current)
    return () => {
      const list = handlers.get(name) ?? []
      handlers.set(
        name,
        list.filter((item) => item !== handler),
      )
    }
  })
  return {
    listen,
    listenCalls,
    reset() {
      handlers.clear()
      listenCalls.length = 0
      listen.mockClear()
    },
    emit(name: string, payload: unknown) {
      for (const handler of handlers.get(name) ?? []) handler({ payload })
    },
    handlerCount(name: string) {
      return (handlers.get(name) ?? []).length
    },
  }
})

const listenMock = tauriEvent.listen

vi.mock("@tauri-apps/api/event", () => ({ listen: tauriEvent.listen }))

import {
  PROVIDER_MODELS_REFRESHED_EVENT,
  PROVIDER_NAVIGATION_BLOCKED_EVENT,
  describeNavigationBlocked,
  resetNavigationBlockedThrottle,
  subscribeProviderModelsRefreshed,
  subscribeProviderNavigationBlocked,
} from "./provider-events"

const ROOT = resolve(__dirname, "../../..")

let warnSpy: MockInstance

beforeEach(() => {
  tauriEvent.reset()
  resetNavigationBlockedThrottle()
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("provider 模型刷新事件", () => {
  it("收到事件时把 payload 透传给回调（只一次）", async () => {
    const seen: unknown[] = []
    const unlisten = await subscribeProviderModelsRefreshed((payload) => seen.push(payload))
    expect(tauriEvent.listenCalls).toEqual([PROVIDER_MODELS_REFRESHED_EVENT])

    const payload = {
      pluginId: "wb-plugin",
      providerId: "wb-connect",
      ok: true,
      modelCount: 3,
      error: "",
    }
    tauriEvent.emit(PROVIDER_MODELS_REFRESHED_EVENT, payload)

    expect(seen).toEqual([payload])
    unlisten()
  })

  it("unlisten 之后不再回调（热更新累积监听器的回归守卫）", async () => {
    const seen: unknown[] = []
    const unlisten = await subscribeProviderModelsRefreshed((payload) => seen.push(payload))
    expect(tauriEvent.handlerCount(PROVIDER_MODELS_REFRESHED_EVENT)).toBe(1)

    unlisten()
    expect(tauriEvent.handlerCount(PROVIDER_MODELS_REFRESHED_EVENT)).toBe(0)

    tauriEvent.emit(PROVIDER_MODELS_REFRESHED_EVENT, {
      pluginId: "wb-plugin",
      providerId: "wb-connect",
      ok: true,
      modelCount: 1,
      error: "",
    })
    expect(seen).toEqual([])
  })

  it("listen 抛错时不抛给调用方，返回可调用的 no-op unlisten，并留下 warn", async () => {
    listenMock.mockRejectedValueOnce(new Error("event capability missing"))

    const unlisten = await subscribeProviderModelsRefreshed(() => {
      throw new Error("回调不该被调用")
    })

    expect(typeof unlisten).toBe("function")
    expect(() => unlisten()).not.toThrow()
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe("登录窗口跳转拦截事件", () => {
  const payload = { pluginId: "wb-plugin", providerId: "wb-connect", host: "evil.example.com" }

  it("收到事件时把 payload 透传给回调", async () => {
    const seen: unknown[] = []
    const unlisten = await subscribeProviderNavigationBlocked((item) => seen.push(item), { now: () => 0 })
    expect(tauriEvent.listenCalls).toEqual([PROVIDER_NAVIGATION_BLOCKED_EVENT])

    tauriEvent.emit(PROVIDER_NAVIGATION_BLOCKED_EVENT, payload)

    expect(seen).toEqual([payload])
    unlisten()
  })

  it("unlisten 之后不再回调", async () => {
    const seen: unknown[] = []
    const unlisten = await subscribeProviderNavigationBlocked((item) => seen.push(item), { now: () => 0 })
    unlisten()

    tauriEvent.emit(PROVIDER_NAVIGATION_BLOCKED_EVENT, payload)
    expect(seen).toEqual([])
  })

  it("同一个 host 在 3 秒内连发 3 次只提示一次；超过 3 秒或换 host 才再提示", async () => {
    let clock = 1_000
    const seen: unknown[] = []
    const unlisten = await subscribeProviderNavigationBlocked((item) => seen.push(item), { now: () => clock })

    tauriEvent.emit(PROVIDER_NAVIGATION_BLOCKED_EVENT, payload)
    tauriEvent.emit(PROVIDER_NAVIGATION_BLOCKED_EVENT, payload)
    tauriEvent.emit(PROVIDER_NAVIGATION_BLOCKED_EVENT, payload)
    expect(seen).toHaveLength(1)

    // 另一个域名不受上一个域名的节流影响。
    tauriEvent.emit(PROVIDER_NAVIGATION_BLOCKED_EVENT, { ...payload, host: "other.example.com" })
    expect(seen).toHaveLength(2)

    // 同一域名超过 3 秒后再被拦，重新提示一次（用户确实又撞了一次）。
    clock += 3_001
    tauriEvent.emit(PROVIDER_NAVIGATION_BLOCKED_EVENT, payload)
    expect(seen).toHaveLength(3)

    unlisten()
  })

  it("提示文案说明「这是安全拦截」，并点名域名与 authDomains", () => {
    const text = describeNavigationBlocked(payload)
    expect(text).toContain("evil.example.com")
    expect(text).toContain("白名单")
    // 关键：不能让用户以为窗口坏了，必须指向插件的 authDomains 声明。
    expect(text).toContain("authDomains")
  })

  it("listen 抛错时同样只 warn，返回 no-op unlisten", async () => {
    listenMock.mockRejectedValueOnce(new Error("event capability missing"))
    const unlisten = await subscribeProviderNavigationBlocked(() => {
      throw new Error("回调不该被调用")
    })
    expect(() => unlisten()).not.toThrow()
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe("App.tsx 的接线（源码断言）", () => {
  const app = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8")

  it("启动时订阅了模型刷新事件，并在回调里同步 provider", () => {
    expect(app).toContain("subscribeProviderModelsRefreshed(")
    // 只订阅不 sync 等于没做：界面拿不到新模型。
    const subscribeAt = app.indexOf("subscribeProviderModelsRefreshed(")
    expect(subscribeAt).toBeGreaterThan(-1)
    expect(app.slice(subscribeAt, subscribeAt + 900)).toContain("syncPluginProviders()")
  })

  it("启动时订阅了跳转拦截事件，并把可读提示交给用户", () => {
    expect(app).toContain("subscribeProviderNavigationBlocked(")
    const subscribeAt = app.indexOf("subscribeProviderNavigationBlocked(")
    expect(app.slice(subscribeAt, subscribeAt + 700)).toContain("describeNavigationBlocked(")
  })

  it("卸载时调用 unlisten（否则多次挂载会累积监听器）", () => {
    expect(app).toContain("for (const unlisten of unlisteners.splice(0)) unlisten()")
  })
})
