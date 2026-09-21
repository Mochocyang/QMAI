import { describe, expect, it } from "vitest"
import { resolveConfig } from "./preset-resolver"
import type { LlmConfig } from "@/stores/wiki-store"
import type { LlmPreset } from "./llm-presets"

function fallbackConfig(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    provider: "openai",
    apiKey: "sk-old",
    model: "gpt-4o",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "https://example.test/v1",
    maxContextSize: 8192,
    reasoning: { mode: "high" },
    ...overrides,
  }
}

describe("resolveConfig", () => {
  it("defaults reasoning to auto instead of inheriting another preset's fallback", () => {
    const preset: LlmPreset = {
      id: "deepseek",
      label: "DeepSeek",
      provider: "custom",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      apiMode: "chat_completions",
    }

    const resolved = resolveConfig(preset, undefined, fallbackConfig())

    expect(resolved.reasoning).toEqual({ mode: "auto" })
  })

  it("keeps an explicit provider-level reasoning override", () => {
    const preset: LlmPreset = {
      id: "qwen",
      label: "Qwen",
      provider: "custom",
      baseUrl: "http://localhost:8000/v1",
      defaultModel: "Qwen3.5-122B",
      apiMode: "chat_completions",
    }

    const resolved = resolveConfig(
      preset,
      { reasoning: { mode: "off" } },
      fallbackConfig(),
    )

    expect(resolved.reasoning).toEqual({ mode: "off" })
  })
})
