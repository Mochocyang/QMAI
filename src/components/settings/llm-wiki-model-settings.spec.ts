import { describe, expect, it } from "vitest"
import { getProviderConfig } from "@/lib/llm-providers"
import type { LlmConfig } from "@/stores/wiki-store"
import zh from "@/i18n/zh.json"
import { LLM_PRESETS } from "./llm-presets"
import { resolveConfig } from "./preset-resolver"

const fallback: LlmConfig = {
  provider: "custom",
  apiKey: "",
  model: "",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 204800,
  apiMode: "chat_completions",
  reasoning: { mode: "auto" },
}

function preset(id: string) {
  const found = LLM_PRESETS.find((item) => item.id === id)
  if (!found) throw new Error(`Missing preset ${id}`)
  return found
}

describe("QMAI model settings", () => {
  it("includes the built-in provider rows below the custom row", () => {
    expect(LLM_PRESETS[0]?.id).toBe("custom")

    expect(LLM_PRESETS.map((item) => item.id)).toEqual([
      "custom",
      "anthropic",
      "claude-code-cli",
      "codex-cli",
      "cursor-cli",
      "openai",
      "google",
      "azure",
      "deepseek",
      "atlascloud",
      "groq",
      "xai",
      "nvidia-nim",
      "kimi",
      "kimi-cn",
      "kimi-coding-plan",
      "zhipu",
      "minimax-global",
      "minimax-cn",
      "bailian-coding",
      "xiaomi-mimo",
      "volcengine-ark",
      "ollama-local",
      "ollama-cloud",
    ])
  })

  it("resolves DeepSeek to an OpenAI-compatible custom endpoint", () => {
    const config = resolveConfig(preset("deepseek"), { apiKey: "sk-test" }, fallback)
    expect(config.provider).toBe("custom")
    expect(config.customEndpoint).toBe("https://api.deepseek.com/v1")
    expect(config.model).toBe("deepseek-v4-flash")

    const provider = getProviderConfig(config)
    expect(provider.url).toBe("https://api.deepseek.com/v1/chat/completions")
    expect(provider.headers.Authorization).toBe("Bearer sk-test")
  })

  it("resolves Azure OpenAI deployment settings into the Azure chat endpoint", () => {
    const config = resolveConfig(
      preset("azure"),
      {
        apiKey: "azure-key",
        baseUrl: "https://qmai-test.openai.azure.com",
        model: "writer-prod",
        azureApiVersion: "2024-10-21",
        azureModelFamily: "gpt5",
      },
      fallback,
    )

    expect(config.provider).toBe("azure")
    expect(config.azureModelFamily).toBe("gpt5")

    const provider = getProviderConfig(config)
    expect(provider.url).toBe(
      "https://qmai-test.openai.azure.com/openai/deployments/writer-prod/chat/completions?api-version=2024-10-21",
    )
    expect(provider.headers["api-key"]).toBe("azure-key")
  })

  it("keeps local CLI provider options available in the resolved config", () => {
    const claude = resolveConfig(
      preset("claude-code-cli"),
      { localCliIsolation: true },
      fallback,
    )
    expect(claude.provider).toBe("claude-code")
    expect(claude.localCliIsolation).toBe(true)
    expect(claude.model).toBe("")

    const codex = resolveConfig(
      preset("codex-cli"),
      { localCliIsolation: true, codexCliTimeoutMinutes: 45 },
      fallback,
    )
    expect(codex.provider).toBe("codex-cli")
    expect(codex.localCliIsolation).toBe(true)
    expect(codex.model).toBe("")
    expect(codex.codexCliTimeoutMinutes).toBe(45)

    const cursor = resolveConfig(
      preset("cursor-cli"),
      { baseUrl: "http://127.0.0.1:8765/v1" },
      fallback,
    )
    expect(cursor.provider).toBe("cursor-cli")
    expect(cursor.customEndpoint).toBe("http://127.0.0.1:8765/v1")
    expect(cursor.model).toBe("composer-2-fast")
    expect(cursor.apiKey).toBe("")

    const cursorProvider = getProviderConfig(cursor)
    expect(cursorProvider.url).toBe("http://127.0.0.1:8765/v1/chat/completions")
    expect(cursorProvider.headers.Authorization).toBe("Bearer unused")
  })

  it("has Chinese labels for the built-in model settings instead of placeholder question marks", () => {
    const llm = zh.settings.sections.llm
    expect(llm.collapse).toBe("收起配置")
    expect(llm.apiKeyPlaceholder).toBe("输入 API Key")
    expect(llm.activeBadge).toBe("当前使用")
    expect(JSON.stringify(llm)).not.toContain("??")
  })
})
