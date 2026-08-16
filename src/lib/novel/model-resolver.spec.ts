import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_NOVEL_CONFIG, useWikiStore, type LlmConfig, type ProviderConfigs } from "@/stores/wiki-store"
import { resolveAgentSessionModel } from "./model-resolver"

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
