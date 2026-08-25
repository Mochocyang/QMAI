import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  type LlmConfig,
  type NovelConfig,
  type ProviderConfigs,
} from "@/stores/wiki-store"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import {
  resolveDefaultModel,
  resolveNovelModel,
} from "./model-resolver"

const SAVED_AT = 1

function savedModel(id: string, name: string, model: string) {
  return { id, name, model, createdAt: SAVED_AT }
}

const baseLlmConfig: LlmConfig = {
  provider: "claude-code",
  apiKey: "",
  model: "claude-sonnet",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 204800,
  reasoning: { mode: "auto" },
  localCliIsolation: false,
}

const openAiProviderConfigs: ProviderConfigs = {
  openai: {
    enabled: true,
    apiKey: "sk-test",
    savedModels: [savedModel("1", "GPT-4o", "gpt-4o")],
  },
}

const dualProviderConfigs: ProviderConfigs = {
  ...openAiProviderConfigs,
  deepseek: {
    enabled: true,
    apiKey: "ds-test",
    savedModels: [savedModel("2", "DeepSeek V3", "deepseek-chat")],
  },
}

const cliProviderConfigs: ProviderConfigs = {
  "claude-code-cli": {
    enabled: true,
    savedModels: [savedModel("3", "Claude Sonnet", "claude-sonnet-4")],
  },
}

const storeState = vi.hoisted(() => ({
  llmConfig: {
    provider: "claude-code" as const,
    apiKey: "",
    model: "claude-sonnet",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "",
    maxContextSize: 204800,
    reasoning: { mode: "auto" as const },
    localCliIsolation: false,
  } as LlmConfig,
  defaultLlmModel: "",
  aiChatModel: "",
  providerConfigs: {
    openai: {
      enabled: true,
      apiKey: "sk-test",
      savedModels: [{ id: "1", name: "GPT-4o", model: "gpt-4o", createdAt: 1 }],
    },
  } as ProviderConfigs,
  novelConfig: {
    contextTokenBudget: 0,
    recentSummaryWindow: 8,
    searchTopK: 5,
    chapterTargetChars: 3000,
    autoIngestOnSave: true,
    autoExtractOnImport: true,
    reviewBeforeSave: false,
    deepPreviousChaptersAnalysis: false,
    deepChapterReview: true,
    reviewReasoningEffort: "high" as const,
    defaultLlmModel: "",
    writingModel: "",
    reviewModel: "",
    summaryModel: "",
    extractModel: "",
    deAiModel: "",
    communitySummaryEnabled: true,
    communitySummaryInterval: 5,
    communitySummaryAsync: true,
    autoGenerateChapterTitle: true,
  } as NovelConfig,
}))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: () => storeState,
  },
}))

describe("resolveDefaultModel", () => {
  beforeEach(() => {
    storeState.llmConfig = { ...baseLlmConfig }
    storeState.defaultLlmModel = ""
    storeState.aiChatModel = ""
    storeState.providerConfigs = { ...openAiProviderConfigs }
    storeState.novelConfig.defaultLlmModel = ""
  })

  it("returns the configured default model when registered and usable", () => {
    storeState.novelConfig.defaultLlmModel = "openai/gpt-4o"

    const cfg = resolveDefaultModel(storeState.llmConfig)

    expect(cfg.provider).toBe("openai")
    expect(cfg.apiKey).toBe("sk-test")
    expect(cfg.model).toBe("gpt-4o")
  })

  it("falls back to legacy global defaultLlmModel when novelConfig is empty", () => {
    storeState.defaultLlmModel = "openai/gpt-4o"

    const cfg = resolveDefaultModel(storeState.llmConfig)

    expect(cfg.model).toBe("gpt-4o")
  })

  it("falls back to aiChatModel when defaultLlmModel is empty", () => {
    storeState.aiChatModel = "openai/gpt-4o"

    const cfg = resolveDefaultModel(storeState.llmConfig)

    expect(cfg.model).toBe("gpt-4o")
    expect(cfg.provider).toBe("openai")
  })

  it("skips stale defaultLlmModel and uses aiChatModel instead of baseConfig", () => {
    storeState.llmConfig = { ...baseLlmConfig }
    storeState.providerConfigs = { ...cliProviderConfigs }
    storeState.novelConfig.defaultLlmModel = "nonexistent/stale-model"
    storeState.aiChatModel = "claude-code-cli/claude-sonnet-4"

    const cfg = resolveDefaultModel(storeState.llmConfig)

    expect(cfg.provider).toBe("claude-code")
    expect(cfg.model).toBe("claude-sonnet-4")
    expect(hasUsableLlm(cfg, cliProviderConfigs)).toBe(true)
  })

  it("returns unusable config when no registered model is available", () => {
    storeState.llmConfig = { ...baseLlmConfig }
    storeState.providerConfigs = { ...cliProviderConfigs }

    const cfg = resolveDefaultModel(storeState.llmConfig)

    expect(hasUsableLlm(cfg, cliProviderConfigs)).toBe(false)
    expect(cfg.model).toBe("")
    expect(cfg.apiKey).toBe("")
  })
})

describe("resolveNovelModel", () => {
  beforeEach(() => {
    storeState.llmConfig = {
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o",
      ollamaUrl: "http://localhost:11434",
      customEndpoint: "",
      maxContextSize: 204800,
      reasoning: { mode: "auto" },
      localCliIsolation: false,
    }
    storeState.defaultLlmModel = ""
    storeState.aiChatModel = ""
    storeState.providerConfigs = { ...dualProviderConfigs }
    storeState.novelConfig = {
      ...storeState.novelConfig,
      defaultLlmModel: "",
      reviewModel: "",
      summaryModel: "",
      extractModel: "",
    }
  })

  it("prefers defaultLlmModel over aiChatModel for extract when task model is empty", () => {
    storeState.aiChatModel = "openai/gpt-4o"
    storeState.novelConfig.defaultLlmModel = "deepseek/deepseek-chat"

    const cfg = resolveNovelModel(storeState.llmConfig, storeState.novelConfig, "extract")

    expect(cfg.model).toBe("deepseek-chat")
    expect(cfg.apiKey).toBe("ds-test")
  })

  it("falls back to defaultLlmModel when aiChatModel is empty", () => {
    storeState.novelConfig.defaultLlmModel = "deepseek/deepseek-chat"

    const cfg = resolveNovelModel(storeState.llmConfig, storeState.novelConfig, "extract")

    expect(cfg.model).toBe("deepseek-chat")
    expect(cfg.apiKey).toBe("ds-test")
  })

  it("uses the configured task model when present", () => {
    storeState.novelConfig = {
      ...storeState.novelConfig,
      extractModel: "deepseek/deepseek-chat",
    }
    storeState.aiChatModel = "openai/gpt-4o"

    const cfg = resolveNovelModel(storeState.llmConfig, storeState.novelConfig, "extract")

    expect(cfg.model).toBe("deepseek-chat")
  })
})
