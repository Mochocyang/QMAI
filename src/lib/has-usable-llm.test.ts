import { describe, expect, it, vi } from "vitest"

// 插件 provider 的「是否已注入」来自运行期同步（provider-sync 的登记表）。
// 这里只测本函数的判定分支，所以把那个登记表换成可控的集合。
const pluginSeam = vi.hoisted(() => ({ injected: new Set<string>() }))
vi.mock("@/lib/plugins/provider-sync", () => ({
  isPluginProviderInjected: (providerId: string) => pluginSeam.injected.has(providerId),
}))

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
  it.each([
    ["claude-code", "claude-code-cli"],
    ["codex-cli", "codex-cli"],
    ["cursor-cli", "cursor-cli"],
    ["antigravity-cli", "antigravity-cli"],
    ["ollama", "ollama-local"],
  ] as const)("accepts configured legacy %s presets without an enabled field", (provider, presetId) => {
    const cfg: LlmConfig = { ...baseCfg, provider, apiKey: "", model: "legacy-model" }
    const legacy = { savedModels: [{ id: "legacy", name: "Legacy", model: cfg.model, createdAt: 1 }] }
    expect(hasUsableLlm(cfg, { [presetId]: legacy })).toBe(true)
    expect(hasUsableLlm(cfg, { [presetId]: { ...legacy, enabled: false } })).toBe(false)
    expect(hasUsableLlm(cfg, { [presetId]: {} })).toBe(false)
    expect(hasUsableLlm(cfg, {})).toBe(false)
  })

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

  it("accepts antigravity-cli when the preset is enabled without an API key or model", () => {
    const providers: ProviderConfigs = {
      "antigravity-cli": { enabled: true },
    }
    const cfg: LlmConfig = { ...baseCfg, provider: "antigravity-cli", apiKey: "", model: "" }
    expect(hasUsableLlm(cfg, providers)).toBe(true)
  })

  it("rejects antigravity-cli when the preset is not enabled", () => {
    const cfg: LlmConfig = { ...baseCfg, provider: "antigravity-cli", apiKey: "", model: "gemini-3.8-flash-high" }
    expect(hasUsableLlm(cfg, {})).toBe(false)
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

  // ── 插件 provider（运行期注入）────────────────────────────────
  // 按设计 token 不落盘（计划第 0 节），所以插件 provider 的 `apiKey` **永远为空**。
  // 用「apiKey 非空」判定会把它一律判成不可用，整条链路在聊天前的守卫就被挡住。
  it("accepts an injected plugin provider by baseUrl + model without apiKey", () => {
    pluginSeam.injected.add("wb-connect")
    try {
      const providers: ProviderConfigs = {
        "wb-connect": {
          label: "插件样例直连",
          baseUrl: "http://127.0.0.1:43210",
          savedModels: [{ id: "glm-5.3", name: "GLM-5.3", model: "glm-5.3", createdAt: 0 }],
        },
      }
      const cfg: LlmConfig = { ...baseCfg, provider: "wb-connect", apiKey: "", model: "glm-5.3" }
      expect(hasUsableLlm(cfg, providers)).toBe(true)

      // 端点没注入（例如插件刚停用、同步还没跑）时必须判不可用，不能靠 apiKey 兜底。
      expect(hasUsableLlm(cfg, { "wb-connect": { savedModels: providers["wb-connect"].savedModels } })).toBe(false)
      // 模型为空同样不可用。
      expect(hasUsableLlm({ ...cfg, model: "" }, providers)).toBe(false)
    } finally {
      pluginSeam.injected.delete("wb-connect")
    }
  })

  it("does not treat a non-injected unknown provider as a plugin provider", () => {
    const cfg: LlmConfig = { ...baseCfg, provider: "not-a-plugin", apiKey: "", model: "x" }
    // 没注入过就不是插件 provider：照旧走 apiKey 判定（也就是不可用），
    // 不能因为 id 长得陌生就放行。
    expect(hasUsableLlm(cfg, { "not-a-plugin": { baseUrl: "http://127.0.0.1:1" } })).toBe(false)
  })
})
