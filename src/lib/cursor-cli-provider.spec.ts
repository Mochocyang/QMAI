import { describe, expect, it } from "vitest"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { modelSupportsTools } from "@/lib/agent/config"
import { getProviderConfig } from "@/lib/llm-providers"
import type { LlmConfig } from "@/stores/wiki-store"
import { toCursorProxyV1Endpoint } from "@/lib/cursor-cli-proxy"

const base: LlmConfig = {
  provider: "cursor-cli",
  apiKey: "",
  model: "composer-2-fast",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "http://127.0.0.1:8765/v1",
  maxContextSize: 200000,
  apiMode: "chat_completions",
  reasoning: { mode: "auto" },
}

describe("cursor-cli provider", () => {
  it("is usable when the preset is enabled without an API key", () => {
    expect(hasUsableLlm(base, {})).toBe(false)
    expect(hasUsableLlm(base, { "cursor-cli": { enabled: true } })).toBe(true)
  })

  it("does not support agent tools", () => {
    expect(modelSupportsTools("composer-2-fast", "cursor-cli")).toBe(false)
    expect(modelSupportsTools("gpt-4o", "openai")).toBe(true)
  })

  it("builds an OpenAI-compatible chat completions URL", () => {
    const cfg = getProviderConfig(base)
    expect(cfg.url).toBe("http://127.0.0.1:8765/v1/chat/completions")
    expect(cfg.headers.Authorization).toBe("Bearer unused")
  })

  it("uses an optional bridge API key when provided", () => {
    const cfg = getProviderConfig({ ...base, apiKey: "secret" })
    expect(cfg.headers.Authorization).toBe("Bearer secret")
  })

  it("normalizes dynamic proxy bases to /v1", () => {
    expect(toCursorProxyV1Endpoint("http://127.0.0.1:9123")).toBe("http://127.0.0.1:9123/v1")
    expect(toCursorProxyV1Endpoint("http://127.0.0.1:9123/v1")).toBe("http://127.0.0.1:9123/v1")
  })
})
