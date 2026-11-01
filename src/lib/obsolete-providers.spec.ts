import { describe, expect, it } from "vitest"

import {
  OBSOLETE_PROVIDER_IDS,
  clearObsoleteLlmProvider,
  isObsoleteProviderId,
  pruneObsoleteProviders,
} from "./obsolete-providers"
import { normalizeProviderConfigs } from "./llm-context-size"
import { isProviderAvailable } from "./llm-model-keys"

/**
 * 「代码里删了 provider，用户机器上的配置还留着」的回归守卫。
 *
 * 用户卸载插件后仍然看到：
 *   · 设置 → 模型设置 里一张「WorkBuddy 国内版 / 未选择模型」的空卡片；
 *   · AI 对话模型下拉里一个「WORKBUDDY 国内版」分组。
 * 两者都来自持久化的 `providerConfigs.workbuddy` —— 删代码不会删数据。
 */
describe("已移除 provider 的清理", () => {
  it("workbuddy 在已移除清单里", () => {
    expect(OBSOLETE_PROVIDER_IDS).toContain("workbuddy")
    expect(isObsoleteProviderId("workbuddy")).toBe(true)
    expect(isObsoleteProviderId("deepseek")).toBe(false)
    expect(isObsoleteProviderId(null)).toBe(false)
  })

  it("剔除残留配置，但不动用户自建 / 其它内置 provider", () => {
    const { configs, removed } = pruneObsoleteProviders({
      workbuddy: { enabled: true, label: "WorkBuddy 国内版" },
      deepseek: { enabled: true, apiKey: "sk-a" },
      "custom-123": { enabled: true, apiKey: "sk-b" },
      "plugin:wb-connect": { enabled: true },
    })

    expect(removed).toEqual(["workbuddy"])
    expect(configs).not.toHaveProperty("workbuddy")
    expect(configs).toHaveProperty("deepseek")
    expect(configs).toHaveProperty("custom-123")
    expect(configs).toHaveProperty("plugin:wb-connect")
  })

  it("没有残留时原样返回（不产生新对象，避免无意义重渲染）", () => {
    const input = { deepseek: { enabled: true } }
    const result = pruneObsoleteProviders(input)
    expect(result.removed).toEqual([])
    expect(result.configs).toBe(input)
  })

  it("normalizeProviderConfigs 也会剔除（load / save 都经过它）", () => {
    const normalized = normalizeProviderConfigs({
      workbuddy: { enabled: true, label: "WorkBuddy 国内版" },
      deepseek: { enabled: true, apiKey: "sk-a", savedModels: [{ id: "m", name: "m", model: "deepseek-v4.1", createdAt: 1 }] },
    } as never)
    expect(normalized).not.toHaveProperty("workbuddy")
    expect(normalized).toHaveProperty("deepseek")
  })

  it("模型下拉不再把这些 provider 当可用（分组消失）", () => {
    // 残留配置即使还在，也必须判为不可用，否则下拉里会挂一个点了没用的分组
    expect(isProviderAvailable("workbuddy", { enabled: true, savedModels: [{ id: "m", name: "m", model: "x", createdAt: 1 }] })).toBe(false)
    expect(isProviderAvailable("deepseek", { enabled: true })).toBe(true)
  })

  it("选中的 provider 被移除时清空选择，避免拿不存在的 provider 发请求", () => {
    const { config, cleared } = clearObsoleteLlmProvider({
      provider: "workbuddy",
      model: "deepseek-v4.1-flash",
      customEndpoint: "http://127.0.0.1:12345/v1",
      apiKey: "token",
    })
    expect(cleared).toBe(true)
    expect(config.provider).toBe("")
    expect(config.model).toBe("")
    expect(config.customEndpoint).toBe("")

    // 正常 provider 不受影响
    const untouched = clearObsoleteLlmProvider({ provider: "deepseek", model: "deepseek-v4.1" })
    expect(untouched.cleared).toBe(false)
    expect(untouched.config.provider).toBe("deepseek")
  })
})
