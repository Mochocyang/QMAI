import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { findLlmPresetById } from "@/components/settings/llm-presets"
import { resolveConfig } from "@/components/settings/preset-resolver"
import {
  BUILTIN_PLACEHOLDER_KEY,
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

const RELAY = "https://relay.qmai.work"
const TICKET = "relay-ticket"
const SESSION = { serverUrl: RELAY }

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
    expect(builtinModelKey("qmai-standard")).toBe("qmai-builtin/qmai-standard")
    expect(BUILTIN_PROVIDER_ID).toBe("qmai-builtin")
  })
})

describe("buildBuiltinProviderOverride", () => {
  it("把中转站登记成 OpenAI 兼容 provider（凭证由请求期注入，配置里不存）", () => {
    const override = buildBuiltinProviderOverride(SESSION, ["qmai-standard", "qmai-fast"])

    expect(override.label).toBe("青幕内置模型")
    expect(override.apiKey).toBe(BUILTIN_PLACEHOLDER_KEY)
    expect(override.baseUrl).toBe(`${RELAY}/v1`)
    expect(override.apiMode).toBe("chat_completions")
    expect(override.enabled).toBe(true)
    expect(override.model).toBe("qmai-standard")
    expect(override.savedModels?.map((model) => model.model)).toEqual(["qmai-standard", "qmai-fast"])
    expect(override.savedModels?.[0].name).toBe("青幕标准版")
    expect(override.savedModels?.[0].description).toContain("正文")
  })

  it("地址末尾的斜杠会被收敛，不会拼出 //v1", () => {
    const override = buildBuiltinProviderOverride({ serverUrl: `${RELAY}/` }, ["qmai-long"])
    expect(override.baseUrl).toBe(`${RELAY}/v1`)
  })

  it("上下文上限取所选模型里最小的，避免小窗口模型被拒绝", () => {
    const override = buildBuiltinProviderOverride(SESSION, ["qmai-standard", "qmai-fast"])
    // 两个都是 204800 / 输出 32768 与 16384 → 输出取小的
    expect(override.maxContextSize).toBe(204800)
    expect(override.maxOutputTokens).toBe(16384)
  })

  it("去重且空列表时仍给出保守默认值", () => {
    const deduped = buildBuiltinProviderOverride(SESSION, ["qmai-standard", "qmai-standard"])
    expect(deduped.savedModels).toHaveLength(1)

    const empty = buildBuiltinProviderOverride(SESSION, [])
    expect(empty.model).toBe("")
    expect(empty.savedModels).toEqual([])
    expect(empty.maxContextSize).toBe(204800)
    expect(empty.maxOutputTokens).toBe(32768)
  })

  it("保留已有的推理与工具调用设置，不覆盖用户选择", () => {
    const override = buildBuiltinProviderOverride(SESSION, ["qmai-standard"], {
      reasoning: { mode: "high" },
      functionCallingEnabled: false,
    })
    expect(override.reasoning).toEqual({ mode: "high" })
    expect(override.functionCallingEnabled).toBe(false)
  })

  it("把网关下发的倍率写进 savedModels.rating（下拉框就显示这个值）", () => {
    const override = buildBuiltinProviderOverride(
      SESSION,
      ["qmai-standard", "qmai-long"],
      undefined,
      [
        { id: "qmai-standard", displayName: "青幕标准版", ratio: 0.08, baseRatio: 0.1, rule: "夜间折扣", tier: "standard" },
        { id: "qmai-long", displayName: "青幕长文版", ratio: 0.33 },
      ],
    )

    expect(override.savedModels?.[0].name).toBe("青幕标准版")
    expect(override.savedModels?.[0].rating).toMatchObject({ ratio: 0.08, baseRatio: 0.1, rule: "夜间折扣", tier: "standard" })
    expect(override.savedModels?.[1].rating).toMatchObject({ ratio: 0.33, rule: null })
  })

  it("网关没给倍率（老网关）时不写 rating，界面也就不会画出倍率", () => {
    const override = buildBuiltinProviderOverride(SESSION, ["qmai-standard"], undefined, [{ id: "qmai-standard" }])
    expect(override.savedModels?.[0].rating).toBeUndefined()
    // 展示名仍然回落到本地表，老网关不会变成裸 id
    expect(override.savedModels?.[0].name).toBe("青幕标准版")
  })

  it("倍率变化时写入的是新值（控制台改完 → 同步 → 下拉框跟着变）", () => {
    const before = buildBuiltinProviderOverride(SESSION, ["qmai-standard"], undefined, [{ id: "qmai-standard", ratio: 0.1 }])
    const after = buildBuiltinProviderOverride(SESSION, ["qmai-standard"], before, [{ id: "qmai-standard", ratio: 0.08 }])
    expect(before.savedModels?.[0].rating?.ratio).toBe(0.1)
    expect(after.savedModels?.[0].rating?.ratio).toBe(0.08)
  })
})

describe("applyBuiltinModels", () => {
  it("写入配置后立刻通过 hasUsableLlm，并把默认模型、对话模型、生效预设一起落盘", async () => {
    const result = await applyBuiltinModels({
      session: SESSION,
      modelIds: ["qmai-standard", "qmai-fast"],
    })

    expect(result.modelKey).toBe("qmai-builtin/qmai-standard")
    expect(result.modelCount).toBe(2)

    const state = useWikiStore.getState()
    expect(state.providerConfigs[BUILTIN_PROVIDER_ID]?.enabled).toBe(true)
    expect(state.providerConfigs[BUILTIN_PROVIDER_ID]?.savedModels).toHaveLength(2)
    expect(state.defaultLlmModel).toBe("qmai-builtin/qmai-standard")
    expect(state.novelConfig.defaultLlmModel).toBe("qmai-builtin/qmai-standard")
    expect(state.aiChatModel).toBe("qmai-builtin/qmai-standard")
    expect(state.activePresetId).toBe(BUILTIN_PROVIDER_ID)

    // 关键：写作守卫只看 llmConfig，必须把它切到内置中转站。
    expect(state.llmConfig.provider).toBe("custom")
    expect(state.llmConfig.apiKey).toBe(BUILTIN_PLACEHOLDER_KEY)
    expect(state.llmConfig.model).toBe("qmai-standard")
    expect(state.llmConfig.customEndpoint).toBe(`${RELAY}/v1`)
    expect(state.llmConfig.apiMode).toBe("chat_completions")
    expect(hasUsableLlm(state.llmConfig, state.providerConfigs)).toBe(true)

    expect(saved.saveProviderConfigs).toHaveBeenCalledTimes(1)
    expect(saved.saveLlmConfig).toHaveBeenCalledTimes(1)
    expect(saved.saveActivePresetId).toHaveBeenCalledWith(BUILTIN_PROVIDER_ID)
    expect(saved.saveDefaultLlmModel).toHaveBeenCalledWith("qmai-builtin/qmai-standard")
    expect(saved.saveAiChatModel).toHaveBeenCalledWith("qmai-builtin/qmai-standard")
  })

  it("makeDefault=false 时只登记提供方，不动当前写作配置", async () => {
    await applyBuiltinModels({ session: SESSION, modelIds: ["qmai-standard"], makeDefault: false })

    const state = useWikiStore.getState()
    expect(state.providerConfigs[BUILTIN_PROVIDER_ID]).toBeDefined()
    expect(state.llmConfig.provider).toBe("openai")
    expect(state.defaultLlmModel).toBe("")
    expect(saved.saveLlmConfig).not.toHaveBeenCalled()
    expect(saved.saveActivePresetId).not.toHaveBeenCalled()
  })

  it("下次启动按预设 + 覆盖配置重新解析时，中转站地址不会丢", () => {
    const preset = findLlmPresetById(BUILTIN_PROVIDER_ID)
    expect(preset).toBeDefined()
    expect(preset!.provider).toBe("custom")
    expect(preset!.apiMode).toBe("chat_completions")

    const override = buildBuiltinProviderOverride(SESSION, ["qmai-standard"])
    const resolved = resolveConfig(preset!, override, useWikiStore.getState().llmConfig)
    expect(resolved.provider).toBe("custom")
    expect(resolved.customEndpoint).toBe(`${RELAY}/v1`)
    expect(resolved.apiKey).toBe(BUILTIN_PLACEHOLDER_KEY)
    expect(resolved.model).toBe("qmai-standard")
    expect(resolved.apiMode).toBe("chat_completions")
  })
})
