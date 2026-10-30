import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_NOVEL_CONFIG, useWikiStore, type LlmConfig, type ProviderConfigs } from "@/stores/wiki-store"
import { resolveAgentSessionModel , resolveModelConfig } from "./model-resolver"

const baseConfig: LlmConfig = {
  provider: "custom",
  apiKey: "test-key",
  model: "",
  ollamaUrl: "",
  customEndpoint: "https://example.test/v1",
  maxContextSize: 8192,
}

const providerConfigs: ProviderConfigs = {
  custom: {
    enabled: true,
    apiKey: "test-key",
    savedModels: [
      { id: "writer", name: "Writer", model: "writer-model", createdAt: 1 },
      { id: "workflow", name: "Workflow", model: "workflow-model", createdAt: 2 },
    ],
  },
}

describe("resolveAgentSessionModel", () => {
  afterEach(() => {
    useWikiStore.setState({
      aiChatModel: "",
      defaultLlmModel: "",
      providerConfigs: {},
      novelConfig: { ...DEFAULT_NOVEL_CONFIG },
    })
  })

  it("uses the selected chat model in fast mode instead of the default orchestration model", () => {
    const previous = useWikiStore.getState()
    useWikiStore.setState({
      aiChatModel: "custom/writer-model",
      defaultLlmModel: "custom/workflow-model",
      providerConfigs,
      novelConfig: { ...previous.novelConfig, defaultLlmModel: "custom/workflow-model" },
    })

    const novelConfig = useWikiStore.getState().novelConfig
    expect(resolveAgentSessionModel(baseConfig, novelConfig, "fast").model).toBe("writer-model")
    expect(resolveAgentSessionModel(baseConfig, novelConfig, "standard").model).toBe("workflow-model")
    expect(resolveAgentSessionModel(baseConfig, novelConfig, "strict").model).toBe("workflow-model")
  })
})

describe("resolveModelConfig：复合键必须保留渠道", () => {
  /*
   * 回归来源：一次真实故障 —— 用户 aiChatModel 是
   * `custom-x/gemini-3.8-flash-high`，而该渠道 savedModels 里只有
   * `gemini-3.8-flash`。旧实现在「模型不在列表里」时退回 fallback，
   * 只改了 model 却把 provider 留成 baseConfig 的 `openai`，
   * 请求于是发到 api.openai.com，用户看到「HTTP 401，你需要提供 API key」。
   *
   * 模型名对不对是服务商的判断；宿主只该保证渠道/key/baseUrl 不丢。
   */
  it("模型不在 savedModels 里时，仍然使用该渠道的 baseUrl 与 apiKey", () => {
    const providerConfigs = {
      "custom-abc": {
        apiKey: "sk-test",
        baseUrl: "https://example.invalid/v1",
        apiMode: "chat_completions",
        model: "known-model",
        savedModels: [{ id: "1", model: "known-model" }],
      },
    }

    const resolved = resolveModelConfig(
      "custom-abc/newer-model-not-in-list",
      { provider: "openai", model: "", apiKey: "" } as never,
      providerConfigs as never,
    ) as Record<string, unknown>

    expect(resolved.model).toBe("newer-model-not-in-list")
    // 这两条是这次修复的核心：不能被退回官方 openai 端点
    expect(resolved.provider).not.toBe("openai")
    expect(String(resolved.customEndpoint ?? "")).toContain("example.invalid")
    expect(resolved.apiKey).toBeTruthy()
  })
})
