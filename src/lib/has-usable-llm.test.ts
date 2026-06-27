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
})
