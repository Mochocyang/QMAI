/**
 * `plugins_hooks` 命令封装的测试。
 *
 * 防的是**并行开发的时序风险**：Rust 侧命令还没注册时，宿主不能崩、不能不生成，
 * 但也**不能假装"这个插件没有钩子"** —— 所以失败要 warn（每命令只一次）。
 * 另一半是归一化：插件清单是第三方写的 JSON，脏数据必须在入口收住。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))

import { fetchPluginHooks, normalizeHookView, normalizeHookViews, resetHooksApiWarnings } from "./api"

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  invoke.mockReset()
  resetHooksApiWarnings()
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("fetchPluginHooks：命令不可用时降级", () => {
  it("命令失败 → 空数组，不抛错", async () => {
    invoke.mockRejectedValue("命令 plugins_hooks 未注册")
    await expect(fetchPluginHooks()).resolves.toEqual([])
  })

  it("同一个命令只 warn 一次（避免每次请求刷屏）", async () => {
    invoke.mockRejectedValue(new Error("not found"))
    await fetchPluginHooks()
    await fetchPluginHooks()
    await fetchPluginHooks()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("返回非数组 → 空数组", async () => {
    invoke.mockResolvedValue({ nope: true })
    await expect(fetchPluginHooks()).resolves.toEqual([])
  })

  it("正常返回 → 归一化后的视图", async () => {
    invoke.mockResolvedValue([
      {
        pluginId: "p1",
        pluginName: "去 AI 味",
        hook: { on: "afterLlmResponse", impl: "prompt", template: "改写：{{text}}", priority: 2, timeoutMs: 5000, gate: true },
      },
    ])

    await expect(fetchPluginHooks()).resolves.toEqual([
      {
        pluginId: "p1",
        pluginName: "去 AI 味",
        hook: { on: "afterLlmResponse", impl: "prompt", template: "改写：{{text}}", priority: 2, timeoutMs: 5000, gate: true },
      },
    ])
  })
})

describe("normalizeHookView：脏数据在入口收住", () => {
  it("未知事件 / 未知 impl / 缺插件 id → 丢弃", () => {
    expect(normalizeHookView({ pluginId: "p", hook: { on: "onSomethingElse", impl: "prompt" } })).toBeNull()
    expect(normalizeHookView({ pluginId: "p", hook: { on: "afterReview", impl: "magic" } })).toBeNull()
    expect(normalizeHookView({ pluginId: "  ", hook: { on: "afterReview", impl: "prompt" } })).toBeNull()
    expect(normalizeHookView(null)).toBeNull()
    expect(normalizeHookView("string")).toBeNull()
  })

  it("pluginName 缺失时用 pluginId 兜底（界面不能出现空名字）", () => {
    const view = normalizeHookView({ pluginId: "p1", hook: { on: "beforeReview", impl: "process", tool: "check" } })
    expect(view?.pluginName).toBe("p1")
  })

  it("gate 只认显式 true；priority/timeoutMs 的非法值不写进结果", () => {
    const view = normalizeHookView({
      pluginId: "p1",
      hook: {
        on: "beforeReview",
        impl: "process",
        tool: "check",
        gate: "yes",
        priority: "3",
        timeoutMs: 0,
      },
    })

    // priority 是字符串 → 当没写（调度器按 0 处理）；timeoutMs 0 无意义 → 交给事件默认值
    expect(view?.hook.priority).toBeUndefined()
    expect(view?.hook.timeoutMs).toBeUndefined()
    expect(view?.hook.gate).toBeUndefined()
  })

  it("prompt 钩子缺 template 也保留（运行期给出可读错误，而不是静默消失）", () => {
    const view = normalizeHookView({ pluginId: "p1", hook: { on: "afterLlmResponse", impl: "prompt" } })
    expect(view?.hook.template).toBeUndefined()
    expect(view?.hook.on).toBe("afterLlmResponse")
  })

  it("normalizeHookViews 过滤掉坏项但保留好项", () => {
    const views = normalizeHookViews([
      { pluginId: "good", hook: { on: "afterReview", impl: "process", tool: "t" } },
      { pluginId: "bad", hook: { on: "nope", impl: "prompt" } },
    ])
    expect(views.map((view) => view.pluginId)).toEqual(["good"])
  })
})
