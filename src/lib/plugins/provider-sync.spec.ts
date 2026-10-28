/**
 * 插件 provider → zustand `providerConfigs` 的同步（T4）测试。
 *
 * 这一组测试守的是 v2 全链路最脆弱的两点：
 *   1. **token 绝不写进 providerConfigs**（计划第 0 节：token 不落盘）；
 *   2. **绝不误删用户手工配置的 provider**（内置 provider 的配置是用户的，不是我们的）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const apiMocks = vi.hoisted(() => ({ providers: vi.fn() }))
const authMocks = vi.hoisted(() => ({ clear: vi.fn() }))

// 只 mock 命令层：同步逻辑本身要跑真实代码。
vi.mock("./api", () => ({ pluginsApi: { providers: apiMocks.providers } }))
// 清 token 缓存是副作用，用 spy 断言「停用即失效」这条契约。
vi.mock("./provider-auth", () => ({ clearPluginProviderAuth: authMocks.clear }))

import { useWikiStore } from "@/stores/wiki-store"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { resolveModelConfig } from "@/lib/novel/model-resolver"
import type { LlmConfig } from "@/stores/wiki-store"
import { syncPluginProviders } from "./provider-sync"
import type { PluginProviderView } from "./types"

function readyProvider(overrides: Partial<PluginProviderView> = {}): PluginProviderView {
  return {
    pluginId: "wb-plugin",
    providerId: "wb-connect",
    name: "WorkBuddy 直连",
    baseUrl: "http://127.0.0.1:43210",
    authKind: "none",
    capabilities: [],
    models: [
      {
        id: "glm-5.3",
        name: "GLM-5.3",
        maxInputTokens: 1_000_000,
        maxOutputTokens: 8192,
        supportsToolCall: true,
        supportsVision: false,
      },
      {
        id: "glm-4.7",
        name: "GLM-4.7",
        maxInputTokens: 128_000,
        maxOutputTokens: 4096,
        supportsToolCall: true,
        supportsVision: false,
      },
    ],
    ready: true,
    ...overrides,
  }
}

const baseLlmConfig: LlmConfig = {
  provider: "custom",
  apiKey: "sk-user",
  model: "",
  ollamaUrl: "",
  customEndpoint: "https://example.test/v1",
  maxContextSize: 8192,
}

describe("syncPluginProviders", () => {
  beforeEach(() => {
    apiMocks.providers.mockReset()
    authMocks.clear.mockReset()
    useWikiStore.setState({ providerConfigs: {} })
  })

  it("writes_ready_provider_without_api_key", async () => {
    apiMocks.providers.mockResolvedValue([readyProvider()])

    await syncPluginProviders()

    const config = useWikiStore.getState().providerConfigs["wb-connect"]
    expect(config).toBeDefined()
    expect(config.label).toBe("WorkBuddy 直连")
    expect(config.baseUrl).toBe("http://127.0.0.1:43210")
    // 模型清单要能被 getEffectiveSavedModels 直接消费：id/name/model/createdAt。
    expect(config.savedModels).toEqual([
      { id: "glm-5.3", name: "GLM-5.3", model: "glm-5.3", createdAt: 0 },
      { id: "glm-4.7", name: "GLM-4.7", model: "glm-4.7", createdAt: 0 },
    ])
    // 多个模型取最大窗口，裁剪用得到（设计 3.4）。
    expect(config.maxContextSize).toBe(1_000_000)
    expect(config.maxOutputTokens).toBe(8192)

    // 核心安全断言：token 只活在 Rust 内存里，落盘的配置里绝不能有它。
    // 一旦写进来，project-store 就会把它持久化，直接违反计划第 0 节。
    expect(config).not.toHaveProperty("apiKey")
    expect(JSON.stringify(config)).not.toContain("apiKey")
  })

  it("skips_unready_provider_but_warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    apiMocks.providers.mockResolvedValue([
      readyProvider({
        providerId: "local-llm",
        pluginId: "local-plugin",
        ready: false,
        lastError: "健康检查超时（10s）",
      }),
    ])

    try {
      await syncPluginProviders()

      // 不可用的 provider 写进配置，用户就能在模型选择器里选到一个必然打不通的模型。
      expect(useWikiStore.getState().providerConfigs["local-llm"]).toBeUndefined()
      expect(warn).toHaveBeenCalled()
      expect(warn.mock.calls.flat().join(" ")).toContain("健康检查超时（10s）")
    } finally {
      warn.mockRestore()
    }
  })

  it("removes_previously_injected_provider_when_it_disappears", async () => {
    apiMocks.providers.mockResolvedValueOnce([readyProvider()])
    await syncPluginProviders()
    expect(useWikiStore.getState().providerConfigs["wb-connect"]).toBeDefined()

    // 插件被停用/卸载：providers() 里不再有它。
    apiMocks.providers.mockResolvedValueOnce([])
    const result = await syncPluginProviders()

    expect(useWikiStore.getState().providerConfigs["wb-connect"]).toBeUndefined()
    expect(result.removed).toContain("wb-connect")
    // 停用即失效：旧 token 不能留在缓存里继续打到已关闭的端口上。
    expect(authMocks.clear).toHaveBeenCalledWith("wb-connect")
  })

  it("never_touches_builtin_provider_configs", async () => {
    const userOpenAi = { apiKey: "sk-user-key", model: "gpt-5", baseUrl: "https://api.openai.com/v1" }
    useWikiStore.setState({ providerConfigs: { openai: userOpenAi } })
    apiMocks.providers.mockResolvedValue([
      readyProvider({ providerId: "second-plugin", pluginId: "second" }),
    ])

    await syncPluginProviders()

    const configs = useWikiStore.getState().providerConfigs
    expect(configs.openai).toEqual(userOpenAi)
    expect(configs["second-plugin"]).toBeDefined()
    // 只增删自己注入过的 id：用户手工配置的条目（这里连 preset id 都不是）不能被当垃圾清掉。
    expect(Object.keys(configs).sort()).toEqual(["openai", "second-plugin"])
  })

  it("同步之后既有链路零改动可用：模型可判可用、解析出插件 provider 与宿主端点", async () => {
    // 这三条断言是 T4 的支点：写进 providerConfigs 之后，
    // has-usable-llm / model-resolver / llm-providers 都不需要知道「插件」的存在。
    apiMocks.providers.mockResolvedValue([readyProvider()])
    await syncPluginProviders()

    const configs = useWikiStore.getState().providerConfigs
    const pluginLlmConfig = { ...baseLlmConfig, provider: "wb-connect", apiKey: "", model: "glm-5.3" }

    // apiKey 按设计永远为空，可用性改判 baseUrl + model。
    expect(hasUsableLlm(pluginLlmConfig, configs)).toBe(true)

    const resolved = resolveModelConfig("wb-connect/glm-5.3", baseLlmConfig, configs)
    // provider 必须保持插件 id：请求分派要落到 llm-providers 的插件分支，
    // 被改写成 "custom" 就会用空 apiKey 发一个没有 Bearer 的请求（插件侧 401）。
    expect(resolved.provider).toBe("wb-connect")
    expect(resolved.model).toBe("glm-5.3")
    // 宿主分配的 baseUrl 通过 customEndpoint 传给请求层（与 workbuddy 同构）。
    expect(resolved.customEndpoint).toBe("http://127.0.0.1:43210")
    expect(resolved.maxContextSize).toBe(1_000_000)
    expect(resolved.apiKey).toBe("")
  })
})
