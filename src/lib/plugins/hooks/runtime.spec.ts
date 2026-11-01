/**
 * 钩子运行时集成层的单测。
 *
 * 这里防的是三类"上线后极难复现"的故障：
 *   1. 无钩子时的**零开销直通**（共享空数组、同步判定，不建 Promise）；
 *   2. 钩子自己调模型时的**重入**（不置位就会递归到爆栈）；
 *   3. 同步失败时**保留旧缓存**（否则一次 IPC 抖动就让已生效的钩子消失）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))

import {
  __resetPluginHooksForTests,
  __setPluginHooksForTests,
  createHookDeps,
  getHooksFor,
  isInsideHookCall,
  runEventHooks,
  runWithHookBypass,
  setHookDepsFactory,
  syncPluginHooks,
  takeHooksFor,
} from "./runtime"
import type { PluginHookView } from "./types"

function view(
  event: PluginHookView["hook"]["on"],
  overrides: Partial<PluginHookView["hook"]> = {},
  pluginId = "p1",
): PluginHookView {
  return {
    pluginId,
    pluginName: `插件${pluginId}`,
    hook: { on: event, impl: "process", tool: "t", ...overrides },
  }
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  invoke.mockReset()
  __resetPluginHooksForTests()
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  __resetPluginHooksForTests()
  warn.mockRestore()
})

describe("零开销直通", () => {
  it("没有钩子时 getHooksFor 返回同一个空数组（不分配）", () => {
    const first = getHooksFor("beforeLlmRequest")
    const second = getHooksFor("afterLlmResponse")
    expect(first).toHaveLength(0)
    // 同一个引用 = 每次请求都不会新建数组（高频路径上的隐性分配）
    expect(first).toBe(second)
  })

  it("没有钩子时 takeHooksFor 返回 null（调用方连 await 都不会发生）", () => {
    expect(takeHooksFor("beforeLlmRequest")).toBeNull()
    expect(takeHooksFor("onChapterCompleted")).toBeNull()
  })

  it("有钩子时按事件取值，且预先按 priority 排好序", () => {
    __setPluginHooksForTests([
      view("beforeLlmRequest", { priority: 5 }, "slow"),
      view("beforeLlmRequest", { priority: 1 }, "fast"),
      view("afterLlmResponse"),
    ])

    expect(getHooksFor("beforeLlmRequest").map((entry) => entry.pluginId)).toEqual(["fast", "slow"])
    expect(getHooksFor("afterLlmResponse")).toHaveLength(1)
    // 没有声明这个事件的插件不能被误跑
    expect(takeHooksFor("beforeReview")).toBeNull()
  })

  it("清空清单后立刻回到共享空数组", () => {
    __setPluginHooksForTests([view("beforeLlmRequest")])
    expect(getHooksFor("beforeLlmRequest")).toHaveLength(1)
    __setPluginHooksForTests([])
    expect(getHooksFor("beforeLlmRequest")).toHaveLength(0)
    expect(takeHooksFor("beforeLlmRequest")).toBeNull()
  })
})

describe("syncPluginHooks：失败保留旧缓存", () => {
  it("成功时建立缓存并按事件索引", async () => {
    invoke.mockResolvedValue([
      { pluginId: "p1", pluginName: "去AI味", hook: { on: "afterLlmResponse", impl: "prompt", template: "改：{{text}}" } },
    ])

    await syncPluginHooks()

    expect(invoke).toHaveBeenCalledWith("plugins_hooks")
    expect(getHooksFor("afterLlmResponse")).toHaveLength(1)
  })

  it("命令失败时**保留**已有缓存（一次 IPC 抖动不该让钩子消失）", async () => {
    invoke.mockResolvedValueOnce([
      { pluginId: "p1", pluginName: "去AI味", hook: { on: "afterLlmResponse", impl: "prompt", template: "改：{{text}}" } },
    ])
    await syncPluginHooks()
    expect(getHooksFor("afterLlmResponse")).toHaveLength(1)

    invoke.mockRejectedValueOnce(new Error("命令未注册"))
    await syncPluginHooks()

    expect(getHooksFor("afterLlmResponse")).toHaveLength(1)
    expect(warn).toHaveBeenCalled()
  })

  it("命令返回脏数据时按空清单降级，不抛错", async () => {
    invoke.mockResolvedValue("not-an-array")
    await expect(syncPluginHooks()).resolves.toBeUndefined()
    expect(getHooksFor("beforeLlmRequest")).toHaveLength(0)
  })
})

describe("重入保护（陷阱 1）", () => {
  it("runWithHookBypass 期间 isInsideHookCall 为真、takeHooksFor 被挡掉", async () => {
    __setPluginHooksForTests([view("beforeLlmRequest")])

    expect(isInsideHookCall()).toBe(false)
    await runWithHookBypass(async () => {
      expect(isInsideHookCall()).toBe(true)
      // 钩子内部的调用拿不到钩子清单 → 不会再触发一层钩子
      expect(takeHooksFor("beforeLlmRequest")).toBeNull()
    })
    expect(isInsideHookCall()).toBe(false)
    // 退出后恢复
    expect(takeHooksFor("beforeLlmRequest")).not.toBeNull()
  })

  it("钩子抛错也一定会复位标记（否则此后所有请求都不再有钩子）", async () => {
    await expect(runWithHookBypass(async () => {
      throw new Error("钩子崩了")
    })).rejects.toThrow("钩子崩了")
    expect(isInsideHookCall()).toBe(false)
  })

  it("嵌套 bypass 只在最外层退出时复位", async () => {
    await runWithHookBypass(async () => {
      await runWithHookBypass(async () => {})
      expect(isInsideHookCall()).toBe(true)
    })
    expect(isInsideHookCall()).toBe(false)
  })
})

describe("runEventHooks：fail-open 与门禁", () => {
  it("没有条目直接返回 null（不建 Promise 链的外层也不需要处理结果）", async () => {
    await expect(runEventHooks([], { event: "beforeLlmRequest" })).resolves.toBeNull()
  })

  it("钩子内部出错不会让调用方失败（记 failures 并 warn）", async () => {
    setHookDepsFactory(() => createHookDeps({
      runHookImpl: async () => {
        throw new Error("插件崩了")
      },
    }))

    const outcome = await runEventHooks([view("beforeLlmRequest")], {
      event: "beforeLlmRequest",
      llm: { provider: "openai", model: "m", messages: [{ role: "user", content: "hi" }] },
    })

    expect(outcome).not.toBeNull()
    expect(outcome?.blocked).toBeUndefined()
    expect(outcome?.failures).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("未生效"))
  })

  it("deps 装配本身出错也只是 warn（钩子机制再怎么坏也不能挡住用户）", async () => {
    setHookDepsFactory(() => {
      throw new Error("deps 装配失败")
    })

    await expect(runEventHooks([view("beforeLlmRequest")], {
      event: "beforeLlmRequest",
    })).resolves.toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("按无钩子继续"), expect.anything())
  })

  it("gate 钩子返回 block → blocked 被上报，由调用方决定中止", async () => {
    setHookDepsFactory(() => createHookDeps({
      runHookImpl: async () => ({ block: { reason: "内容不合规" } }),
    }))

    const outcome = await runEventHooks([view("beforeLlmRequest", { gate: true })], {
      event: "beforeLlmRequest",
    })

    expect(outcome?.blocked).toEqual({ reason: "内容不合规", pluginId: "p1" })
  })

  it("正在钩子内部时直接返回 null（重入的第二道保险）", async () => {
    const entries = [view("beforeLlmRequest")]
    await runWithHookBypass(async () => {
      await expect(runEventHooks(entries, { event: "beforeLlmRequest" })).resolves.toBeNull()
    })
  })
})
