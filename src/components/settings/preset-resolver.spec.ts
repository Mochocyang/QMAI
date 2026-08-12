import { describe, expect, it } from "vitest"
import { resolveConfig } from "./preset-resolver"
import { LLM_PRESETS, type LlmPreset } from "./llm-presets"
import type { LlmConfig } from "@/stores/wiki-store"

const fallback: LlmConfig = {
  provider: "openai",
  apiKey: "",
  model: "",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 131072,
}

const customPreset: LlmPreset = {
  id: "custom",
  label: "Custom",
  provider: "custom",
  baseUrl: "https://example.test/v1",
  apiMode: "chat_completions",
  defaultModel: "demo-model",
}

describe("resolveConfig functionCallingEnabled", () => {
  it("defaults to enabled when override omits the flag", () => {
    const config = resolveConfig(customPreset, { apiKey: "sk", model: "m" }, fallback)
    expect(config.functionCallingEnabled).toBe(true)
  })

  it("passes false through to LlmConfig", () => {
    const config = resolveConfig(
      customPreset,
      { apiKey: "sk", model: "m", functionCallingEnabled: false },
      fallback,
    )
    expect(config.functionCallingEnabled).toBe(false)
  })
})

describe("resolveConfig context and output limits", () => {
  const deepseekPreset = LLM_PRESETS.find((preset) => preset.id === "deepseek")!

  it("keeps the DeepSeek suggestion when the user has not chosen a window", () => {
    const config = resolveConfig(deepseekPreset, { apiKey: "sk" }, fallback)
    expect(config.maxContextSize).toBe(1_000_000)
    expect(config.maxOutputTokens).toBe(393_216)
  })

  it("does not override a window the user set explicitly", () => {
    // The window used to be forced back up to 1M here, so the DeepSeek slider
    // looked adjustable but never took effect.
    const config = resolveConfig(
      deepseekPreset,
      { apiKey: "sk", maxContextSize: 262_144 },
      fallback,
    )
    expect(config.maxContextSize).toBe(262_144)
  })

  it("falls back to the default output limit for presets without a published figure", () => {
    const config = resolveConfig(customPreset, { apiKey: "sk", model: "m" }, fallback)
    expect(config.maxOutputTokens).toBe(131_072)
  })

  it("prefers an explicit output limit over the preset suggestion", () => {
    const config = resolveConfig(
      deepseekPreset,
      { apiKey: "sk", maxOutputTokens: 65_536 },
      fallback,
    )
    expect(config.maxOutputTokens).toBe(65_536)
  })
})
