import { describe, expect, it } from "vitest"
import { resolveConfig } from "./preset-resolver"
import type { LlmPreset } from "./llm-presets"
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
