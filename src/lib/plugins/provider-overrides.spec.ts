// @vitest-environment jsdom
/**
 * 插件 provider 用户覆盖表的测试。
 *
 * 这一层守的是"用户改的东西不会被插件刷新冲掉"——真实故障是：
 * 用户在设置页把 41 个模型勾成 3 个，下次启动插件时 `syncPluginProviders()`
 * 整体覆盖回去，41 个又回来了，而且没有任何提示。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  PLUGIN_PROVIDER_OVERRIDE_STORAGE_KEY,
  __resetPluginProviderOverrideCacheForTests,
  applySelectedModels,
  forgetPluginProviderOverrides,
  getPluginProviderOverride,
  getPluginProviderOverrides,
  mergePluginProviderConfig,
  parseOverrides,
  setPluginProviderOverride,
  subscribePluginProviderOverrides,
} from "./provider-overrides"

const model = (id: string) => ({ id, name: id, model: id, createdAt: 0 })

beforeEach(() => {
  localStorage.clear()
  __resetPluginProviderOverrideCacheForTests()
})

describe("覆盖表：基本读写", () => {
  it("没写过时返回 undefined，不影响合并", () => {
    expect(getPluginProviderOverride("workbuddy")).toBeUndefined()
    const reported = { label: "WorkBuddy 国内版", savedModels: [model("a"), model("b")] }
    expect(mergePluginProviderConfig(reported, undefined)).toEqual(reported)
  })

  it("写入后能读回，并持久化到 localStorage", () => {
    setPluginProviderOverride("workbuddy", { label: "我的 WorkBuddy" })
    expect(getPluginProviderOverride("workbuddy")?.label).toBe("我的 WorkBuddy")

    __resetPluginProviderOverrideCacheForTests()
    expect(getPluginProviderOverride("workbuddy")?.label).toBe("我的 WorkBuddy")
    expect(localStorage.getItem(PLUGIN_PROVIDER_OVERRIDE_STORAGE_KEY)).toBeTruthy()
  })

  it("多次写入是浅合并，不丢之前改的字段", () => {
    setPluginProviderOverride("wb", { label: "名字" })
    setPluginProviderOverride("wb", { maxContextSize: 200000 })
    const override = getPluginProviderOverride("wb")
    expect(override?.label).toBe("名字")
    expect(override?.maxContextSize).toBe(200000)
  })

  it("订阅者在写入时被通知", () => {
    const listener = vi.fn()
    const unsubscribe = subscribePluginProviderOverrides(listener)
    setPluginProviderOverride("wb", { label: "x" })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    setPluginProviderOverride("wb", { label: "y" })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe("覆盖表：与插件上报合并", () => {
  const reported = {
    label: "WorkBuddy 国内版",
    baseUrl: "http://127.0.0.1:1234",
    maxContextSize: 1000000,
    maxOutputTokens: 32000,
    enabled: true,
    savedModels: [model("a"), model("b"), model("c")],
  }

  it("用户改名后，名称用用户的；baseUrl 永远是插件的", () => {
    const merged = mergePluginProviderConfig(reported, { label: "我起的名字" })
    expect(merged.label).toBe("我起的名字")
    // 关键：baseUrl 由宿主分配，用户覆盖不能碰它（碰了就打不通）
    expect(merged.baseUrl).toBe("http://127.0.0.1:1234")
  })

  it("用户只勾 2 个模型时，savedModels 只剩这 2 个", () => {
    const merged = mergePluginProviderConfig(reported, { selectedModels: ["a", "c"] })
    expect(merged.savedModels?.map((m) => m.id)).toEqual(["a", "c"])
  })

  it("没勾过时用插件的全部模型（首次登录即全选）", () => {
    const merged = mergePluginProviderConfig(reported, { label: "x" })
    expect(merged.savedModels?.map((m) => m.id)).toEqual(["a", "b", "c"])
  })

  it("用户勾的模型插件已下架时，退回全部（而不是显示『一个都没有』）", () => {
    const merged = mergePluginProviderConfig(reported, { selectedModels: ["gone-1", "gone-2"] })
    expect(merged.savedModels?.map((m) => m.id)).toEqual(["a", "b", "c"])
  })

  it("用户改窗口大小与启用状态会生效", () => {
    const merged = mergePluginProviderConfig(reported, { maxContextSize: 200000, enabled: false })
    expect(merged.maxContextSize).toBe(200000)
    expect(merged.enabled).toBe(false)
    // 没改的输出上限保持插件上报值
    expect(merged.maxOutputTokens).toBe(32000)
  })
})

describe("覆盖表：容错与清理", () => {
  it("坏 JSON 回到空表而不是抛错", () => {
    expect(parseOverrides("{not json")).toEqual({})
    expect(parseOverrides("[]")).toEqual({})
    expect(parseOverrides("null")).toEqual({})
  })

  it("非法的数值被丢弃（0 / 负数 / 小数）", () => {
    const parsed = parseOverrides(
      JSON.stringify({ wb: { maxContextSize: 0, maxOutputTokens: -5 } }),
    )
    expect(parsed.wb?.maxContextSize).toBeUndefined()
    expect(parsed.wb?.maxOutputTokens).toBeUndefined()
  })

  it("未知字段被忽略", () => {
    const parsed = parseOverrides(JSON.stringify({ wb: { apiKey: "偷塞的", baseUrl: "http://evil" } }))
    expect(parsed.wb).toBeUndefined()
  })

  it("卸载插件时清掉它的覆盖", () => {
    setPluginProviderOverride("wb", { label: "x" })
    forgetPluginProviderOverrides("wb")
    expect(getPluginProviderOverride("wb")).toBeUndefined()
    expect(getPluginProviderOverrides()).toEqual({})
  })

  it("同一字段再写 undefined 表示『恢复插件默认』", () => {
    setPluginProviderOverride("wb", { label: "x" })
    setPluginProviderOverride("wb", { label: undefined })
    expect(getPluginProviderOverride("wb")?.label).toBeUndefined()
  })

  it("清空能落盘：写 [] 后读回仍是 []（而不是被当成『没勾过』删掉）", () => {
    setPluginProviderOverride("wb", { selectedModels: ["a"] })
    setPluginProviderOverride("wb", { selectedModels: [] })
    expect(getPluginProviderOverride("wb")?.selectedModels).toEqual([])
    // 持久化后重读也在：parseOverrides 不再把空数组丢掉，否则重启后清空变回全选。
    __resetPluginProviderOverrideCacheForTests()
    expect(getPluginProviderOverride("wb")?.selectedModels).toEqual([])
  })

  it("全选 = 写 undefined：字段被删掉，回到『没勾过 = 全选』语义", () => {
    setPluginProviderOverride("wb", { selectedModels: ["a"] })
    setPluginProviderOverride("wb", { selectedModels: undefined })
    expect(getPluginProviderOverride("wb")?.selectedModels).toBeUndefined()
  })
})

describe("applySelectedModels", () => {
  it("按 id 或 model 匹配都算命中", () => {
    const models = [
      { id: "id-1", name: "A", model: "model-a", createdAt: 0 },
      { id: "id-2", name: "B", model: "model-b", createdAt: 0 },
    ]
    expect(applySelectedModels(models, { selectedModels: ["model-a"] }).map((m) => m.id)).toEqual(["id-1"])
    expect(applySelectedModels(models, { selectedModels: ["id-2"] }).map((m) => m.id)).toEqual(["id-2"])
  })

  it("顺序按插件上报的顺序，不按用户勾选顺序（避免列表每次刷新都跳来跳去）", () => {
    const models = [model("a"), model("b"), model("c")]
    expect(applySelectedModels(models, { selectedModels: ["c", "a"] }).map((m) => m.id)).toEqual(["a", "c"])
  })

  it("空数组 = 显式清空：返回 []（『清空』就是清空，不能清完又变回全选）", () => {
    const models = [model("a"), model("b")]
    expect(applySelectedModels(models, { selectedModels: [] })).toEqual([])
  })

  it("undefined（没写过）仍返回全部（首次登录即全选）", () => {
    const models = [model("a"), model("b")]
    expect(applySelectedModels(models, undefined).map((m) => m.id)).toEqual(["a", "b"])
    expect(applySelectedModels(models, {}).map((m) => m.id)).toEqual(["a", "b"])
  })
})
