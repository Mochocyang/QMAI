import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { findLlmPresetById } from "@/components/settings/llm-presets"
import { resolveConfig } from "@/components/settings/preset-resolver"
import {
  BUILTIN_PROVIDER_ID,
  applyBuiltinModels,
  buildBuiltinProviderOverride,
  builtinModelKey,
} from "./provider-bridge"

const saved = vi.hoisted(() => ({
  saveProviderConfigs: vi.fn(async () => {}),
  saveDefaultLlmModel: vi.fn(async () => {}),
  saveNovelConfig: vi.fn(async () => {}),
  saveAiChatModel: vi.fn(async () => {}),
  saveLlmConfig: vi.fn(async () => {}),
  saveActivePresetId: vi.fn(async () => {}),
}))

vi.mock("@/lib/project-store", () => saved)

beforeEach(() => {
  vi.clearAllMocks()
  useWikiStore.setState({
    project: null,
    providerConfigs: {},
    defaultLlmModel: "",
    aiChatModel: "",
    activePresetId: null,
    llmConfig: {
      provider: "openai",
      apiKey: "",
      model: "",
      ollamaUrl: "http://localhost:11434",
      customEndpoint: "",
      maxContextSize: 204800,
    },
    novelConfig: { ...useWikiStore.getState().novelConfig, defaultLlmModel: "" },
  })
})

describe("builtinModelKey", () => {
  it("模型键沿用现有 providerId/model 格式", () => {
    expect(builtinModelKey("glm-5.3")).toBe("qmai-builtin/glm-5.3")
    expect(BUILTIN_PROVIDER_ID).toBe("qmai-builtin")
  })
})

describe("buildBuiltinProviderOverride", () => {
  it("把网关登记成 OpenAI 兼容 provider，并写入用户令牌", () => {
    const override = buildBuiltinProviderOverride(
      { serverUrl: "http://localhost:3000/", tokenKey: "sk-test-key" },
      ["glm-5.3", "grok-chat-fast"],
    )

    expect(override.label).toBe("青幕内置模型")
    expect(override.apiKey).toBe("sk-test-key")
    expect(override.baseUrl).toBe("http://localhost:3000/v1")
    expect(override.apiMode).toBe("chat_completions")
    expect(override.enabled).toBe(true)
    expect(override.model).toBe("glm-5.3")
    expect(override.savedModels?.map((model) => model.model)).toEqual(["glm-5.3", "grok-chat-fast"])
    expect(override.savedModels?.[0].name).toBe("GLM 5.3")
    expect(override.savedModels?.[0].description).toContain("中文")
  })

  it("上下文上限取所选模型里最小的，避免小窗口模型被拒绝", () => {
    const override = buildBuiltinProviderOverride(
      { serverUrl: "http://localhost:3000", tokenKey: "sk-test-key" },
      ["kimi-k3", "glm-5.3"],
    )
    // kimi-k3 262144，glm-5.3 204800 → 取 204800（也是 QMAI 的上下文下限）
    expect(override.maxContextSize).toBe(204800)
    expect(override.maxOutputTokens).toBe(32768)
  })

  it("去重且空列表时仍给出保守默认值", () => {
    const deduped = buildBuiltinProviderOverride(
      { serverUrl: "http://localhost:3000", tokenKey: "sk-test-key" },
      ["glm-5.3", "glm-5.3"],
    )
    expect(deduped.savedModels).toHaveLength(1)

    const empty = buildBuiltinProviderOverride(
      { serverUrl: "http://localhost:3000", tokenKey: "sk-test-key" },
      [],
    )
    expect(empty.model).toBe("")
    expect(empty.savedModels).toEqual([])
    expect(empty.maxContextSize).toBe(204800)
    expect(empty.maxOutputTokens).toBe(32768)
  })

  it("保留已有的推理与工具调用设置，不覆盖用户选择", () => {
    const override = buildBuiltinProviderOverride(
      { serverUrl: "http://localhost:3000", tokenKey: "sk-test-key" },
      ["glm-5.3"],
      { reasoning: { mode: "high" }, functionCallingEnabled: false },
    )
    expect(override.reasoning).toEqual({ mode: "high" })
    expect(override.functionCallingEnabled).toBe(false)
  })
})

describe("applyBuiltinModels", () => {
  it("写入配置后立刻通过 hasUsableLlm，并把默认模型、对话模型、生效预设一起落盘", async () => {
    const result = await applyBuiltinModels({
      session: { serverUrl: "http://localhost:3000", tokenKey: "sk-test-key" },
      modelIds: ["glm-5.3", "grok-chat-fast"],
    })

    expect(result.modelKey).toBe("qmai-builtin/glm-5.3")
    expect(result.modelCount).toBe(2)

    const state = useWikiStore.getState()
    expect(state.providerConfigs[BUILTIN_PROVIDER_ID]?.enabled).toBe(true)
    expect(state.providerConfigs[BUILTIN_PROVIDER_ID]?.savedModels).toHaveLength(2)
    expect(state.defaultLlmModel).toBe("qmai-builtin/glm-5.3")
    expect(state.novelConfig.defaultLlmModel).toBe("qmai-builtin/glm-5.3")
    expect(state.aiChatModel).toBe("qmai-builtin/glm-5.3")
    expect(state.activePresetId).toBe(BUILTIN_PROVIDER_ID)

    // 关键：写作守卫只看 llmConfig，必须把它切到内置网关。
    expect(state.llmConfig.provider).toBe("custom")
    expect(state.llmConfig.apiKey).toBe("sk-test-key")
    expect(state.llmConfig.model).toBe("glm-5.3")
    expect(state.llmConfig.customEndpoint).toBe("http://localhost:3000/v1")
    expect(state.llmConfig.apiMode).toBe("chat_completions")
    expect(hasUsableLlm(state.llmConfig, state.providerConfigs)).toBe(true)

    expect(saved.saveProviderConfigs).toHaveBeenCalledTimes(1)
    expect(saved.saveLlmConfig).toHaveBeenCalledTimes(1)
    expect(saved.saveActivePresetId).toHaveBeenCalledWith(BUILTIN_PROVIDER_ID)
    expect(saved.saveDefaultLlmModel).toHaveBeenCalledWith("qmai-builtin/glm-5.3")
    expect(saved.saveAiChatModel).toHaveBeenCalledWith("qmai-builtin/glm-5.3")
  })

  it("makeDefault=false 时只登记提供方，不动当前写作配置", async () => {
    await applyBuiltinModels({
      session: { serverUrl: "http://localhost:3000", tokenKey: "sk-test-key" },
      modelIds: ["glm-5.3"],
      makeDefault: false,
    })

    const state = useWikiStore.getState()
    expect(state.providerConfigs[BUILTIN_PROVIDER_ID]).toBeDefined()
    expect(state.llmConfig.provider).toBe("openai")
    expect(state.defaultLlmModel).toBe("")
    expect(saved.saveLlmConfig).not.toHaveBeenCalled()
    expect(saved.saveActivePresetId).not.toHaveBeenCalled()
  })

  it("下次启动按预设 + 覆盖配置重新解析时，网关地址与密钥不会丢", () => {
    const preset = findLlmPresetById(BUILTIN_PROVIDER_ID)
    expect(preset).toBeDefined()
    expect(preset!.provider).toBe("custom")
    expect(preset!.apiMode).toBe("chat_completions")

    const override = buildBuiltinProviderOverride(
      { serverUrl: "http://localhost:3000", tokenKey: "sk-test-key" },
      ["glm-5.3"],
    )
    const resolved = resolveConfig(preset!, override, useWikiStore.getState().llmConfig)
    expect(resolved.provider).toBe("custom")
    expect(resolved.customEndpoint).toBe("http://localhost:3000/v1")
    expect(resolved.apiKey).toBe("sk-test-key")
    expect(resolved.model).toBe("glm-5.3")
    expect(resolved.apiMode).toBe("chat_completions")
  })
})
