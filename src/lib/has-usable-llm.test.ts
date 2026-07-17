import { describe, expect, it } from "vitest"
import { hasUsableLlm } from "./has-usable-llm"
import type { LlmConfig, ProviderConfigs } from "@/stores/wiki-store"

const baseCfg: LlmConfig = {
  provider: "openai",
  apiKey: "sk-test",
  model: "gpt-4o",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 204800,
  apiMode: "chat_completions",
  reasoning: { mode: "auto" },
}

describe("hasUsableLlm", () => {
  it("accepts a hosted provider with apiKey and model", () => {
    const providers: ProviderConfigs = {}
    expect(hasUsableLlm(baseCfg, providers)).toBe(true)
  })

  it("accepts hosted provider with default providerConfigs parameter (backward compatibility)", () => {
    expect(hasUsableLlm(baseCfg)).toBe(true)
  })

  it("rejects hosted provider without apiKey", () => {
    const providers: ProviderConfigs = {}
    expect(hasUsableLlm({ ...baseCfg, apiKey: "" }, providers)).toBe(false)
  })

  it("rejects hosted provider without model", () => {
    const providers: ProviderConfigs = {}
    expect(hasUsableLlm({ ...baseCfg, model: "" }, providers)).toBe(false)
  })

  it("accepts claude-code when the preset is enabled", () => {
    const providers: ProviderConfigs = {
      "claude-code-cli": { enabled: true },
    }
    const cfg: LlmConfig = { ...baseCfg, provider: "claude-code", apiKey: "", model: "" }
    expect(hasUsableLlm(cfg, providers)).toBe(true)
  })

  it("rejects claude-code when the preset is explicitly disabled", () => {
    const providers: ProviderConfigs = {
      "claude-code-cli": { enabled: false },
    }
    const cfg: LlmConfig = { ...baseCfg, provider: "claude-code", apiKey: "", model: "" }
    expect(hasUsableLlm(cfg, providers)).toBe(false)
  })

  it("rejects claude-code when there is no provider config entry at all (never enabled by user)", () => {
    const providers: ProviderConfigs = {}
    const cfg: LlmConfig = { ...baseCfg, provider: "claude-code", apiKey: "", model: "" }
    expect(hasUsableLlm(cfg, providers)).toBe(false)
  })

  it("rejects codex-cli when disabled, even if binary exists on disk", () => {
    const providers: ProviderConfigs = {
      "codex-cli": { enabled: false },
    }
    const cfg: LlmConfig = { ...baseCfg, provider: "codex-cli", apiKey: "", model: "gpt-5" }
    expect(hasUsableLlm(cfg, providers)).toBe(false)
  })

  it("accepts codex-cli when the preset is enabled", () => {
    const providers: ProviderConfigs = {
      "codex-cli": { enabled: true },
    }
    const cfg: LlmConfig = { ...baseCfg, provider: "codex-cli", apiKey: "", model: "gpt-5" }
    expect(hasUsableLlm(cfg, providers)).toBe(true)
  })

  it("accepts cursor-cli when the preset is enabled without an API key", () => {
    const providers: ProviderConfigs = {
      "cursor-cli": { enabled: true },
    }
    const cfg: LlmConfig = {
      ...baseCfg,
      provider: "cursor-cli",
      apiKey: "",
      model: "composer-2-fast",
      customEndpoint: "http://127.0.0.1:8765/v1",
    }
    expect(hasUsableLlm(cfg, providers)).toBe(true)
  })

  it("rejects cursor-cli when the preset is not enabled", () => {
    const providers: ProviderConfigs = {}
    const cfg: LlmConfig = {
      ...baseCfg,
      provider: "cursor-cli",
      apiKey: "",
      model: "composer-2-fast",
      customEndpoint: "http://127.0.0.1:8765/v1",
    }
    expect(hasUsableLlm(cfg, providers)).toBe(false)
  })

  it("accepts ollama without apiKey when enabled", () => {
    const providers: ProviderConfigs = {
      "ollama-local": { enabled: true, model: "qwen2.5" },
    }
    const cfg: LlmConfig = { ...baseCfg, provider: "ollama", apiKey: "", model: "qwen2.5", ollamaUrl: "http://localhost:11434" }
    expect(hasUsableLlm(cfg, providers)).toBe(true)
  })

  it("accepts custom endpoint with apiKey", () => {
    const providers: ProviderConfigs = {}
    const cfg: LlmConfig = { ...baseCfg, provider: "custom", apiKey: "sk-test", model: "qwen-plus", customEndpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1" }
    expect(hasUsableLlm(cfg, providers)).toBe(true)
  })

  it("rejects custom with apiKey but no model", () => {
    const providers: ProviderConfigs = {}
    const cfg: LlmConfig = { ...baseCfg, provider: "custom", apiKey: "sk-test", model: "", customEndpoint: "https://example.com/v1" }
    expect(hasUsableLlm(cfg, providers)).toBe(false)
  })

  it("rejects custom without apiKey when no custom-xxx preset is enabled", () => {
    const providers: ProviderConfigs = {}
    const cfg: LlmConfig = { ...baseCfg, provider: "custom", apiKey: "", model: "qwen-plus", customEndpoint: "http://localhost:1234/v1" }
    expect(hasUsableLlm(cfg, providers)).toBe(false)
  })

  it("accepts custom without apiKey when a custom-xxx preset is explicitly enabled", () => {
    const providers: ProviderConfigs = {
      "custom-123456": { enabled: true, model: "qwen2.5-7b", baseUrl: "http://localhost:1234/v1", apiKey: "" },
    }
    const cfg: LlmConfig = { ...baseCfg, provider: "custom", apiKey: "", model: "qwen2.5-7b", customEndpoint: "http://localhost:1234/v1" }
    expect(hasUsableLlm(cfg, providers)).toBe(true)
  })
})
